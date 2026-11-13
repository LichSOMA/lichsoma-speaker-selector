import { registerChatSystemModule } from '../../lichsoma-chat-system-registry.js';
import { createCssSettingEditorClass } from '../../lichsoma-css-setting-editor.js';
import { LichsomaChatDom } from '../../lichsoma-chat-dom.js';
import { ActorEmotions } from '../../lichsoma-actor-emotions.js';
import {
    extractWebfontPresentation,
    fetchTextAsset,
    getMessageAuthorColor,
    getMessageAuthorName,
    quoteFontFamily
} from '../../lichsoma-shared-utils.js';
import {
    applyDnd5eTitleAlias,
    getDnd5eTitleAlias,
    isDnd5eMessageElement
} from './header.js';

const MODULE_ID = 'lichsoma-speaker-selector';
const SYSTEM_ID = 'dnd5e';
const TITLE_FONT_SETTING = 'dnd5eTitleWebfontCSS';
const SUBTITLE_FONT_SETTING = 'dnd5eSubtitleWebfontCSS';
const EXPORT_CSS_PATH = `modules/${MODULE_ID}/styles/systems/dnd5e/export.css`;
const FONT_STYLE_ID = 'lichsoma-dnd5e-fonts';

const Dnd5eTitleWebfontCSSEditor = createCssSettingEditorClass({
    settingKey: TITLE_FONT_SETTING,
    titleKey: 'SPEAKERSELECTOR.Settings.Dnd5eTitleWebfontCSS.Name',
    savedKey: 'SPEAKERSELECTOR.Settings.Dnd5eTitleWebfontCSS.Saved',
    defaultId: 'lichsoma-dnd5e-title-webfont-css-editor'
});

const Dnd5eSubtitleWebfontCSSEditor = createCssSettingEditorClass({
    settingKey: SUBTITLE_FONT_SETTING,
    titleKey: 'SPEAKERSELECTOR.Settings.Dnd5eSubtitleWebfontCSS.Name',
    savedKey: 'SPEAKERSELECTOR.Settings.Dnd5eSubtitleWebfontCSS.Saved',
    defaultId: 'lichsoma-dnd5e-subtitle-webfont-css-editor'
});

const headerJobs = new Map();
let initialized = false;

function isActive() {
    return game.system?.id === SYSTEM_ID;
}

function getSettingSafe(key, fallback = '') {
    try {
        return game.settings.get(MODULE_ID, key) ?? fallback;
    } catch (_error) {
        return fallback;
    }
}

function declarationsFor(profile) {
    const declarations = [];
    if (profile?.family) declarations.push(`font-family: ${quoteFontFamily(profile.family)}, sans-serif`);
    if (profile?.weight) declarations.push(`font-weight: ${profile.weight}`);
    if (profile?.style) declarations.push(`font-style: ${profile.style}`);
    if (profile?.variationSettings) declarations.push(`font-variation-settings: ${profile.variationSettings}`);
    return declarations;
}

function buildDnd5eWebfontCss({ exportMode = false } = {}) {
    const titleRaw = String(getSettingSafe(TITLE_FONT_SETTING, '') || '').trim();
    const subtitleRaw = String(getSettingSafe(SUBTITLE_FONT_SETTING, '') || '').trim();
    const rawParts = [...new Set([titleRaw, subtitleRaw].filter(Boolean))];
    const rules = [];

    const addRule = (selector, raw) => {
        const declarations = declarationsFor(extractWebfontPresentation(raw));
        if (!declarations.length) return;
        rules.push(`${selector} { ${declarations.map(value => `${value} !important`).join('; ')}; }`);
    };

    if (exportMode) {
        addRule(
            'body.lichsoma-chat-log-export.system-dnd5e .chat-log.chat-log .chat-message .message-header .name-stacked .title',
            titleRaw
        );
        addRule(
            'body.lichsoma-chat-log-export.system-dnd5e .chat-log.chat-log .chat-message .message-header .name-stacked .subtitle',
            subtitleRaw
        );
    } else {
        addRule(
            '.system-dnd5e .chat-message.lichsoma-dnd5e-native-header .message-header .message-sender .name-stacked .title',
            titleRaw
        );
        addRule(
            '.system-dnd5e .chat-message.lichsoma-dnd5e-native-header .message-header .message-sender .name-stacked .subtitle',
            subtitleRaw
        );
    }

    return [
        ...rawParts,
        ...rules
    ].join('\n\n');
}

function applyDnd5eFonts() {
    document.getElementById(FONT_STYLE_ID)?.remove();
    const css = buildDnd5eWebfontCss();
    if (!css.trim()) return;

    const style = document.createElement('style');
    style.id = FONT_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
}

function registerFontSetting({ menuKey, settingKey, i18nKey, icon, editorType }) {
    game.settings.registerMenu(MODULE_ID, menuKey, {
        name: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Name`),
        label: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.EditButton`),
        hint: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Hint`),
        icon,
        type: editorType,
        restricted: true
    });

    game.settings.register(MODULE_ID, settingKey, {
        name: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Name`),
        hint: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Hint`),
        scope: 'world',
        config: false,
        restricted: true,
        type: String,
        default: '',
        onChange: () => applyDnd5eFonts()
    });
}

function registerSettings() {
    registerFontSetting({
        menuKey: 'dnd5eTitleWebfontCSSMenu',
        settingKey: TITLE_FONT_SETTING,
        i18nKey: 'Dnd5eTitleWebfontCSS',
        icon: 'fas fa-heading',
        editorType: Dnd5eTitleWebfontCSSEditor
    });
    registerFontSetting({
        menuKey: 'dnd5eSubtitleWebfontCSSMenu',
        settingKey: SUBTITLE_FONT_SETTING,
        i18nKey: 'Dnd5eSubtitleWebfontCSS',
        icon: 'fas fa-text-height',
        editorType: Dnd5eSubtitleWebfontCSSEditor
    });
}

function getRenderedMessageElement(message) {
    const messageId = message?.id || message?._id || null;
    if (!messageId) return null;
    return document.querySelector(`[data-message-id="${messageId}"]`)
        || document.querySelector(`li.chat-message[data-message-id="${messageId}"]`)
        || null;
}

function prepareNativeHeader(message, html) {
    const messageElement = LichsomaChatDom.getChatMessageElement(html);
    if (!isDnd5eMessageElement(messageElement)) return false;

    messageElement.classList.add('lichsoma-dnd5e-native-header');
    const header = messageElement.querySelector('.message-header');
    if (!header) return true;

    header.classList.remove('lichsoma-chat-header');
    header.querySelectorAll('.lichsoma-chat-portrait-container').forEach((element) => element.remove());
    header.querySelectorAll('.message-sender[data-lichsoma-sender="true"]').forEach((element) => element.remove());
    header.querySelectorAll('.lichsoma-dnd5e-original-sender').forEach((element) => {
        element.classList.remove('lichsoma-dnd5e-original-sender');
    });
    return true;
}

function getSubtitleFallback(message) {
    return getMessageAuthorName(message) || '\u00A0';
}

function getAvatarPortraitSrc(message, fallbackSrc = null, host = null) {
    if (!message) return fallbackSrc || null;
    const flags = message.flags?.[MODULE_ID] || {};

    try {
        const emotionPortrait = ActorEmotions?.getEmotionPortraitForMessage?.(message);
        if (emotionPortrait) return emotionPortrait;
    } catch (_error) {
        // Continue through persisted portrait flags.
    }

    if (flags.emotionPortrait) return flags.emotionPortrait;
    if (flags.portraitSrc) return flags.portraitSrc;
    if (fallbackSrc) return fallbackSrc;

    const portraitData = host?._getMessageImageSync?.(message.speaker, message.author?.id);
    return portraitData?.src || null;
}

function applyAvatarPortrait(message, html, srcOverride = null, host = null) {
    const messageElement = LichsomaChatDom.getChatMessageElement(html);
    if (!isDnd5eMessageElement(messageElement)) return;

    const avatar = messageElement.querySelector('.message-header .message-sender .avatar');
    const img = avatar?.querySelector?.('img');
    if (!avatar || !img) return;

    const portraitSrc = getAvatarPortraitSrc(message, srcOverride, host);
    if (!portraitSrc) return;

    if (!img.dataset.lichsomaOriginalSrc) img.dataset.lichsomaOriginalSrc = img.getAttribute('src') || '';
    if (img.getAttribute('src') !== portraitSrc) img.setAttribute('src', portraitSrc);

    img.dataset.lichsomaPortraitSrc = portraitSrc;
    avatar.dataset.lichsomaPortraitSrc = portraitSrc;
    avatar.dataset.lichsomaPortraitPreview = 'true';

    const alias = getDnd5eTitleAlias(message) || message?.speaker?.alias || '';
    if (alias) img.setAttribute('alt', alias);
}

function applyHeaderEnhancementsOnce(message, html, srcOverride = null, host = null) {
    const messageElement = LichsomaChatDom.getChatMessageElement(html);
    if (!message || !isDnd5eMessageElement(messageElement)) return false;

    prepareNativeHeader(message, messageElement);
    applyDnd5eTitleAlias(message, messageElement, {
        ensureSubtitle: true,
        subtitleFallback: getSubtitleFallback(message)
    });
    applyAvatarPortrait(message, messageElement, srcOverride, host);
    return true;
}

function cancelHeaderJob(jobKey) {
    const job = headerJobs.get(jobKey);
    if (!job) return;
    job.cancelled = true;
    if (job.rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(job.rafId);
    for (const timer of job.timers || []) clearTimeout(timer);
    headerJobs.delete(jobKey);
}

function scheduleHeaderEnhancements(message, html = null, srcOverride = null, host = null, { lookupRendered = false } = {}) {
    if (!message) return;
    const jobKey = message.id || message._id || message;
    cancelHeaderJob(jobKey);

    const initialElement = LichsomaChatDom.getChatMessageElement(html);
    const job = { cancelled: false, rafId: null, timers: [] };
    headerJobs.set(jobKey, job);

    const apply = () => {
        if (job.cancelled) return;
        const element = lookupRendered ? getRenderedMessageElement(message) : initialElement;
        if (!element) return;
        applyHeaderEnhancementsOnce(message, element, srcOverride, host);
    };

    apply();
    if (typeof requestAnimationFrame === 'function') job.rafId = requestAnimationFrame(apply);
    job.timers.push(setTimeout(apply, 100));
    job.timers.push(setTimeout(() => {
        apply();
        headerJobs.delete(jobKey);
    }, 300));
}

function applyUserColor(message, messageElement) {
    const header = messageElement.querySelector('.message-header');
    if (getSettingSafe('applyUserColor', false)) {
        const userColor = getMessageAuthorColor(message);
        if (userColor) {
            messageElement.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
            header?.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
            return;
        }
    }
    messageElement.style.removeProperty('--lichsoma-dnd5e-title-color');
    header?.style.removeProperty('--lichsoma-dnd5e-title-color');
}

function collapseExportCards(messageElement) {
    messageElement.querySelectorAll?.('.chat-card .description.collapsible').forEach((description) => {
        description.classList.add('collapsed');
        description.setAttribute('aria-expanded', 'false');
        description.querySelector('.summary')?.setAttribute('aria-expanded', 'false');
        description.querySelector('.details')?.setAttribute('aria-hidden', 'true');
    });
}

function prepareLivePresentation({ message, element, host, portraitSrc = null }) {
    const messageElement = LichsomaChatDom.getChatMessageElement(element);
    if (!isDnd5eMessageElement(messageElement)) return false;

    scheduleHeaderEnhancements(message, messageElement, portraitSrc, host);
    applyUserColor(message, messageElement);
    host?._addDeleteButton?.(message, messageElement);
    return true;
}

async function prepareExportPresentation({ message, element, host }) {
    const messageElement = LichsomaChatDom.getChatMessageElement(element);
    if (!isDnd5eMessageElement(messageElement)) return false;

    prepareNativeHeader(message, messageElement);
    applyDnd5eTitleAlias(message, messageElement, {
        ensureSubtitle: true,
        subtitleFallback: getSubtitleFallback(message)
    });
    const avatar = messageElement.querySelector('.message-header .message-sender .avatar img');
    applyAvatarPortrait(message, messageElement, avatar?.getAttribute?.('src') || null, host);
    applyUserColor(message, messageElement);
    collapseExportCards(messageElement);
    return true;
}

function getExportMergePortraitSrc({ element }) {
    const messageElement = LichsomaChatDom.getChatMessageElement(element);
    if (!isDnd5eMessageElement(messageElement)) return null;
    return messageElement
        .querySelector('.message-header .message-sender .avatar img')
        ?.getAttribute?.('src') || null;
}

function placeDeleteButton({ element, button }) {
    const messageElement = LichsomaChatDom.getChatMessageElement(element);
    if (!isDnd5eMessageElement(messageElement) || !button) return false;

    button.classList.add('lichsoma-dnd5e-metadata-delete');
    const header = messageElement.querySelector('.message-header');
    if (!header) return true;

    let metadata = header.querySelector('.message-metadata');
    if (!metadata) {
        metadata = document.createElement('span');
        metadata.classList.add('message-metadata');
        header.appendChild(metadata);
    }

    // Foundry의 native delete control은 공통 CSS에서 숨긴다. 존재 여부와 무관하게
    // Speaker Selector의 hover delete control을 하나만 배치한다.
    const additionalControls = metadata.querySelector('.chat-control[data-context-menu], [data-context-menu]');
    if (additionalControls) additionalControls.insertAdjacentElement('beforebegin', button);
    else metadata.appendChild(button);
    return true;
}

async function fetchExportAdditionalCss() {
    const exportCss = await fetchTextAsset(EXPORT_CSS_PATH, { label: 'dnd5e additional CSS' });
    const webfontCss = buildDnd5eWebfontCss({ exportMode: true });
    return [
        exportCss ? `/* --- dnd5e/export.css --- */\n${exportCss}` : '',
        webfontCss ? `/* --- dnd5e custom webfonts --- */\n${webfontCss}` : ''
    ].filter(Boolean).join('\n\n');
}

function registerExportHooks() {
    Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchExportAdditionalCss());
}

function onReady() {
    applyDnd5eFonts();
    if (!game.user?.isGM) return;
    try {
        if (game.settings.get(MODULE_ID, 'showPortrait') !== false) {
            void game.settings.set(MODULE_ID, 'showPortrait', false);
        }
    } catch (_error) {
        // Generic runtime suppression remains active even if persistence fails.
    }
}

export function initializeSystemAdapter() {
    if (initialized || !isActive()) return;
    initialized = true;

    registerSettings();
    registerChatSystemModule('dnd5e', {
        isNativeHeader: ({ element }) => isDnd5eMessageElement(LichsomaChatDom.getChatMessageElement(element)),
        prepareLivePresentation,
        prepareExportPresentation,
        afterMessageCreated: ({ message, host }) => {
            scheduleHeaderEnhancements(message, null, null, host, { lookupRendered: true });
            return true;
        },
        placeDeleteButton,
        getExportMergePortraitSrc,
        suppressGenericPortraitSetting: () => true,
        deferGenericPortrait: () => true
    });

    if (game.ready) {
        registerExportHooks();
        onReady();
    } else {
        Hooks.once('ready', () => {
            registerExportHooks();
            onReady();
        });
    }
}
