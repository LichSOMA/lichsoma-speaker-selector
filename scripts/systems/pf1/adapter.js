import { registerChatSystemModule } from '../../lichsoma-chat-system-registry.js';
import { LICHSOMA_SYSTEM_PAYLOAD_CLASS } from '../../lichsoma-chat-payload-classifier.js';
import { fetchTextAsset } from '../../lichsoma-shared-utils.js';

const SYSTEM_ID = 'pf1';
const PF1_SYSTEM_CSS_PATH = 'systems/pf1/pf1.css';
const PF1_MODULE_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/systems/pf1/export.css';

// PF1 v11.11 puts these semantic classes directly on the rendered ChatMessage root.
// `damage-card` and `defense-card` are harmless forward/legacy compatibility signals.
const PF1_ROOT_PAYLOAD_CLASSES = [
    'basic-check',
    'basic-roll',
    'item-card',
    'action-card',
    'damage-card',
    'defense-card'
];

// Some PF1 messages (notably level-up and older defense/damage cards) are ordinary
// ChatMessages whose ownership signal lives inside `.message-content` instead.
const PF1_CONTENT_PAYLOAD_SELECTOR = [
    ':scope > .pf1.chat-card',
    ':scope > .pf1.level-up',
    ':scope > .pf1.item-card',
    ':scope > .pf1.action-card',
    ':scope > .pf1.damage-card',
    ':scope > .pf1.defense-card'
].join(', ');

const PF1_INTERACTIVE_SELECTOR = [
    // v11 item/action card description toggle. GM-only identified info is not interactive.
    '.pf1.chat-card header .item-name',
    // v11 target controls are DIV/IMG click targets without data-action/role semantics.
    '.pf1.chat-card .attack-targets .target[data-uuid] img.target-image',
    '.pf1.chat-card .attack-targets .target[data-uuid] .ac',
    '.pf1.chat-card .attack-targets .target[data-uuid] .saving-throws .click'
].join(', ');

const PF1_EXPORT_SELECTOR_HINTS = [
    '.pf1.chat-card',
    '.chat-message.pf1',
    '.message.pf1',
    '.pf1.basic-check',
    '.pf1.basic-roll',
    '.pf1.item-card',
    '.pf1.action-card',
    '.pf1.damage-card',
    '.pf1.defense-card',
    '.pf1.level-up',
    '.attack-targets',
    '.chat-attack',
    '.property-group',
    '.type-color',
    '.fake-inline-roll',
    '.icon-pf'
];

function getMessageContent(element) {
    if (!(element instanceof HTMLElement)) return null;
    return element.querySelector(':scope > .message-content')
        || element.querySelector('.message-content');
}

function isPf1SystemPayload(element, messageContent = getMessageContent(element)) {
    if (!(element instanceof HTMLElement) || !(messageContent instanceof HTMLElement)) return false;

    if (element.classList.contains('pf1')) {
        if (PF1_ROOT_PAYLOAD_CLASSES.some((className) => element.classList.contains(className))) return true;
    }

    return !!messageContent.querySelector(PF1_CONTENT_PAYLOAD_SELECTOR);
}

function markPf1SystemPayload(element) {
    const messageContent = getMessageContent(element);
    if (!isPf1SystemPayload(element, messageContent)) return false;

    messageContent.classList.add(LICHSOMA_SYSTEM_PAYLOAD_CLASS);
    return true;
}

/**
 * PF1 v11 has several clickable chat-card elements that predate data-action semantics.
 * Speaker Selector's reviser already respects role=button, so annotate only those
 * PF1-owned controls instead of adding PF1 selectors to generic core code.
 */
function markLegacyPf1InteractiveTargets(element) {
    const messageContent = getMessageContent(element);
    if (!(messageContent instanceof HTMLElement)) return;

    for (const target of messageContent.querySelectorAll(PF1_INTERACTIVE_SELECTOR)) {
        if (!(target instanceof HTMLElement)) continue;
        if (target.closest('.identified-info')) continue;
        // Newer PF1 revisions use data-action on the interactive ancestor; no shim needed.
        if (target.closest('[data-action], [role="button"]')) continue;
        target.setAttribute('role', 'button');
        target.dataset.lichsomaPf1Interactive = 'true';
    }
}

function prepareLivePresentation({ element }) {
    const marked = markPf1SystemPayload(element);
    if (marked) markLegacyPf1InteractiveTargets(element);

    // PF1 does not own Speaker Selector's outer sender/portrait header. Returning false
    // intentionally keeps the existing generic presentation path intact.
    return false;
}

function prepareExportPresentation({ element }) {
    markPf1SystemPayload(element);
    return false;
}

function isPf1Stylesheet(sheet) {
    const href = String(sheet?.href || '');
    return /\/systems\/pf1\/pf1\.css(?:[?#].*)?$/i.test(href);
}

function isPf1ChatCssText(cssText) {
    const text = String(cssText || '');
    if (!text) return false;
    if (/^\s*@font-face\b/i.test(text)) return true;
    // Keep theme/root variable definitions used by PF1 chat without importing unrelated sheets.
    if (/--pf1-[\w-]+\s*:/i.test(text)) return true;
    // PF1 common-chat.less intentionally has shared `.message <child>` rules. Keep descendants,
    // but not a broad rule whose target is the outer message frame itself.
    if (/\.(?:chat-)?message\s+(?!\{)/i.test(text)) return true;
    return PF1_EXPORT_SELECTOR_HINTS.some((hint) => text.includes(hint));
}

function filterPf1ChatCssRules(rules) {
    const parts = [];
    for (const rule of Array.from(rules || [])) {
        const cssText = rule?.cssText || '';
        if (isPf1ChatCssText(cssText)) parts.push(cssText);
    }
    return parts.join('\n');
}

function filterPf1ChatCssText(css) {
    const raw = String(css || '');
    if (!raw) return '';

    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(raw);
        return filterPf1ChatCssRules(sheet.cssRules);
    } catch (error) {
        console.warn('[lichsoma-speaker-selector] PF1 fetched CSS could not be parsed; skipping system CSS fallback.', error);
        return '';
    }
}

function collectLoadedPf1ChatCss() {
    for (const sheet of Array.from(document.styleSheets || [])) {
        if (!isPf1Stylesheet(sheet)) continue;

        try {
            const filtered = filterPf1ChatCssRules(sheet.cssRules);
            if (filtered) return filtered;
        } catch (error) {
            console.warn('[lichsoma-speaker-selector] PF1 stylesheet CSSOM read failed; using fetch fallback.', error);
        }
    }
    return '';
}

function rewritePf1CssUrls(css) {
    if (!css) return '';
    const base = `${window.location.origin}/systems/pf1/`;

    return String(css).replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^'")]+)\1\s*\)/gi, (_match, _quote, rawUrl) => {
        const value = String(rawUrl || '').trim();
        if (!value) return 'url("")';
        try {
            return `url("${new URL(value, base).href}")`;
        } catch (_error) {
            return `url("${base}${value.replace(/^\.\//, '')}")`;
        }
    });
}

function buildPf1ExportVariableSnapshot(css) {
    const names = new Set();
    const variablePattern = /var\(\s*(--[A-Za-z0-9_-]+)/g;
    let match;
    while ((match = variablePattern.exec(String(css || ''))) !== null) names.add(match[1]);
    if (!names.size) return '';

    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const declarations = [];
    for (const name of [...names].sort()) {
        const value = (bodyStyle.getPropertyValue(name) || rootStyle.getPropertyValue(name) || '').trim();
        if (!value) continue;
        declarations.push(`  ${name}: ${value};`);
    }
    return declarations.length ? `:root {\n${declarations.join('\n')}\n}` : '';
}

let exportCssPromise = null;

async function fetchPf1LogExportAdditionalCss() {
    if (game.system?.id !== SYSTEM_ID) return '';
    if (exportCssPromise) return exportCssPromise;

    exportCssPromise = (async () => {
        let systemCss = collectLoadedPf1ChatCss();

        // A normal PF1 world has a same-origin loaded stylesheet. Fetch is only a
        // compatibility fallback for browsers/builds where CSSOM access is unavailable.
        if (!systemCss) {
            const rawSystemCss = await fetchTextAsset(PF1_SYSTEM_CSS_PATH, { label: 'PF1 system CSS' });
            systemCss = filterPf1ChatCssText(rawSystemCss);
        }

        systemCss = rewritePf1CssUrls(systemCss);
        const variableSnapshot = buildPf1ExportVariableSnapshot(systemCss);
        const moduleCss = await fetchTextAsset(PF1_MODULE_EXPORT_CSS_PATH, { label: 'PF1 export CSS' });

        return [
            systemCss ? `/* --- PF1 chat CSS collected from systems/pf1/pf1.css --- */\n${systemCss}` : '',
            variableSnapshot ? `/* --- PF1/Foundry variables used by the collected chat CSS --- */\n${variableSnapshot}` : '',
            moduleCss ? `/* --- pf1/export.css --- */\n${moduleCss}` : ''
        ].filter(Boolean).join('\n\n');
    })();

    return exportCssPromise;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== SYSTEM_ID) return;
    initialized = true;

    registerChatSystemModule('pf1', {
        prepareLivePresentation,
        prepareExportPresentation
    });

    const registerExportHook = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchPf1LogExportAdditionalCss());
    };

    if (game.ready) registerExportHook();
    else Hooks.once('ready', registerExportHook);
}
