import { registerChatSystemModule } from '../../lichsoma-chat-system-registry.js';
import { LICHSOMA_SYSTEM_PAYLOAD_CLASS } from '../../lichsoma-chat-payload-classifier.js';
import { fetchTextAsset } from '../../lichsoma-shared-utils.js';

const SYSTEM_ID = 'pf2e';
const PF2E_SYSTEM_CSS_PATH = 'systems/pf2e/styles/pf2e.css';
const PF2E_MODULE_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/systems/pf2e/export.css';

/*
 * PF2e v14 owns several structured payload families.  Keep this DOM-based rather
 * than treating the mere presence of flags.pf2e as ownership: ChatMessagePF2e
 * initializes that flag scope on ordinary messages as well.
 */
const PF2E_CONTENT_PAYLOAD_SELECTOR = [
    ':scope > .pf2e.chat-card',
    ':scope > .dice-roll[data-tooltip-class="pf2e"]',
    ':scope > .damage-roll[data-tooltip-class="pf2e"]',
    ':scope > .damage-taken',
    ':scope > .persistent-damage-recovery',
    ':scope > .description[data-auto-collapse]',
    ':scope > p.action-content'
].join(', ');

const PF2E_EXPORT_SELECTOR_HINTS = [
    '.chat-message',
    '.pf2e.chat-card',
    '.dice-roll',
    '.damage-roll',
    '.damage-application',
    '.damage-taken',
    '.persistent-damage-recovery',
    '.card-buttons',
    '.message-buttons',
    '.degree-of-success',
    '.damage-tag',
    '.damage.instance',
    '.damage.color',
    '--color-bg-',
    '--color-border-',
    '--color-text-',
    '.action-glyph',
    '.roll-note',
    '.tags',
    '[data-pf2-',
    '.inline-check'
];

function getMessageContent(element) {
    if (!(element instanceof HTMLElement)) return null;
    return element.querySelector(':scope > .message-content')
        || element.querySelector('.message-content');
}

function markPf2eSystemPayload(element) {
    const messageContent = getMessageContent(element);
    if (!(messageContent instanceof HTMLElement)) return false;
    if (!messageContent.querySelector(PF2E_CONTENT_PAYLOAD_SELECTOR)) return false;

    messageContent.classList.add(LICHSOMA_SYSTEM_PAYLOAD_CLASS);
    return true;
}

/**
 * PF2e 8.5.x / FVTT14 decorates non-OOC actor message headers with its own
 * `.portrait`, `.user`, and `.with-image` grid. Speaker Selector is the portrait
 * authority, so remove only that PF2e decoration and leave sender/metadata/flavor
 * DOM intact for the generic Speaker Selector presentation path.
 */
function removePf2eNativeHeaderDecoration(element) {
    if (!(element instanceof HTMLElement)) return false;

    const header = element.querySelector(':scope > .message-header')
        || element.querySelector('.message-header');
    if (!(header instanceof HTMLElement)) return false;

    const nativePortraits = Array.from(header.querySelectorAll(':scope > .portrait'))
        .filter((portrait) => !portrait.classList.contains('lichsoma-chat-portrait-container'));
    const ownsNativeImageLayout = header.classList.contains('with-image') || nativePortraits.length > 0;
    if (!ownsNativeImageLayout) return false;

    nativePortraits.forEach((portrait) => portrait.remove());
    header.querySelectorAll(':scope > .user').forEach((userLabel) => userLabel.remove());
    header.classList.remove('with-image');
    return true;
}

function prepareLivePresentation({ element }) {
    removePf2eNativeHeaderDecoration(element);
    markPf2eSystemPayload(element);

    // PF2e does not take over Speaker Selector's sender/portrait presentation.
    // Returning false deliberately continues the existing generic path.
    return false;
}

function prepareExportPresentation({ element }) {
    removePf2eNativeHeaderDecoration(element);
    markPf2eSystemPayload(element);
    return false;
}

function isPf2eStylesheet(sheet) {
    const href = String(sheet?.href || '');
    return /\/systems\/pf2e\/styles\/pf2e\.css(?:[?#].*)?$/i.test(href);
}

function isPf2eChatCssText(cssText) {
    const text = String(cssText || '');
    if (!text) return false;
    if (/^\s*@font-face\b/i.test(text)) return true;
    return PF2E_EXPORT_SELECTOR_HINTS.some((hint) => text.includes(hint));
}

function filterPf2eChatCssRules(rules) {
    const parts = [];
    for (const rule of Array.from(rules || [])) {
        const cssText = rule?.cssText || '';
        if (isPf2eChatCssText(cssText)) parts.push(cssText);
    }
    return parts.join('\n');
}

function filterPf2eChatCssText(css) {
    const raw = String(css || '');
    if (!raw) return '';

    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(raw);
        return filterPf2eChatCssRules(sheet.cssRules);
    } catch (error) {
        console.warn('[lichsoma-speaker-selector] PF2e fetched CSS could not be parsed; skipping system CSS fallback.', error);
        return '';
    }
}

function collectLoadedPf2eChatCss() {
    for (const sheet of Array.from(document.styleSheets || [])) {
        if (!isPf2eStylesheet(sheet)) continue;

        try {
            const filtered = filterPf2eChatCssRules(sheet.cssRules);
            if (filtered) return filtered;
        } catch (error) {
            console.warn('[lichsoma-speaker-selector] PF2e stylesheet CSSOM read failed; using fetch fallback.', error);
        }
    }
    return '';
}

function rewritePf2eCssUrls(css) {
    if (!css) return '';
    const base = `${window.location.origin}/systems/pf2e/styles/`;

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

function buildPf2eExportVariableSnapshot(css) {
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

async function fetchPf2eLogExportAdditionalCss() {
    if (game.system?.id !== SYSTEM_ID) return '';
    if (exportCssPromise) return exportCssPromise;

    exportCssPromise = (async () => {
        let systemCss = collectLoadedPf2eChatCss();

        // Normal worlds expose the same-origin system stylesheet through CSSOM. Fetch the
        // installed release asset only when CSSOM access is unavailable.
        if (!systemCss) {
            const rawSystemCss = await fetchTextAsset(PF2E_SYSTEM_CSS_PATH, { label: 'PF2e system CSS' });
            systemCss = filterPf2eChatCssText(rawSystemCss);
        }

        systemCss = rewritePf2eCssUrls(systemCss);
        const moduleCss = await fetchTextAsset(PF2E_MODULE_EXPORT_CSS_PATH, { label: 'PF2e export CSS' });
        const variableSnapshot = buildPf2eExportVariableSnapshot(`${systemCss}\n${moduleCss}`);

        return [
            systemCss ? `/* --- PF2e chat CSS collected from systems/pf2e/styles/pf2e.css --- */\n${systemCss}` : '',
            variableSnapshot ? `/* --- PF2e/Foundry variables used by the collected chat CSS --- */\n${variableSnapshot}` : '',
            moduleCss ? `/* --- pf2e/export.css --- */\n${moduleCss}` : ''
        ].filter(Boolean).join('\n\n');
    })();

    return exportCssPromise;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== SYSTEM_ID) return;
    initialized = true;

    registerChatSystemModule('pf2e', {
        prepareLivePresentation,
        prepareExportPresentation
    });

    const registerExportHook = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchPf2eLogExportAdditionalCss());
    };

    if (game.ready) registerExportHook();
    else Hooks.once('ready', registerExportHook);
}
