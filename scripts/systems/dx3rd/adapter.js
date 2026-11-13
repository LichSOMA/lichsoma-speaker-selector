/**
 * DX3rd 등 — `lichsoma-chat-system-registry.js`에 머지/내보내기 규칙을 등록합니다.
 * 다른 게임 시스템도 `scripts/systems/<id>/adapter.js` 패턴으로 분리합니다.
 */
import { registerChatSystemModule } from '../../lichsoma-chat-system-registry.js';
import { fetchTextAsset } from '../../lichsoma-shared-utils.js';

/** `.chat-message` 루트에 붙는 시스템 메시지 클래스 (시스템 모듈과 맞춤) */
export const DX3RD_CHAT_MESSAGE_CLASS = 'dx3rd-system-message';

/** @param {{ message: *, element: HTMLElement }} ctx */
function isDx3rdSystemMessage(ctx) {
    return ctx.element?.classList?.contains(DX3RD_CHAT_MESSAGE_CLASS) ?? false;
}

const DX3RD_FVTT_SYSTEM_ID = 'dx3rd-fvtt';
/** @see styles/systems/dx3rd/export.css */
const DX3RD_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/systems/dx3rd/export.css';
// Shared card theme rules retain the existing asset path.
const DX3RD_CARD_THEME_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/systems/dx3rd/light-cards.css';
export const DX3RD_LIGHT_PATCH_SETTING = 'dx3rdLightCardPatch';
export const DX3RD_LIGHT_PATCH_CLASS = 'lichsoma-dx3rd-light-card-patch';
export const DX3RD_TERMINAL_PATCH_SETTING = 'dx3rdTerminalCardPatch';
export const DX3RD_TERMINAL_PATCH_CLASS = 'lichsoma-dx3rd-terminal-card-patch';
const CARD_PATCHES = [
    {setting: DX3RD_LIGHT_PATCH_SETTING, className: DX3RD_LIGHT_PATCH_CLASS, label: 'Dx3rdLightCardPatch'},
    {setting: DX3RD_TERMINAL_PATCH_SETTING, className: DX3RD_TERMINAL_PATCH_CLASS, label: 'Dx3rdTerminalCardPatch'}
];

function isCardPatchEnabled(patch) {
    return game.settings.get('lichsoma-speaker-selector', patch.setting) === true;
}

function applyCardPatches() {
    for (const patch of CARD_PATCHES) document.body?.classList.toggle(patch.className, isCardPatchEnabled(patch));
}

/**
 * dx3rd-fvtt 월드일 때만: HTML 내보내기 `<style>`에 export 전용 DX3rd CSS 주입
 * (`lichsoma-chat-log-export.js` 의 `lichsoma-speaker-selector.chatLogExportAdditionalCSS` 훅)
 */
async function fetchDx3rdLogExportAdditionalCss() {
    const exportCss = await fetchTextAsset(DX3RD_EXPORT_CSS_PATH, { label: 'DX3rd 추가 CSS' });
    // The exported body class gates the patch. Include the shared stylesheet
    // regardless of the live theme so saved logs do not depend on live DOM.
    const cardThemeCss = await fetchTextAsset(DX3RD_CARD_THEME_CSS_PATH, { label: 'DX3rd 카드 테마 CSS' });
    return `/* --- dx3rd/export.css --- */
${exportCss || ''}
/* --- dx3rd/light-cards.css --- */
${cardThemeCss || ''}`;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== DX3RD_FVTT_SYSTEM_ID) return;
    initialized = true;

    for (const patch of CARD_PATCHES) {
        game.settings.register('lichsoma-speaker-selector', patch.setting, {
            name: `SPEAKERSELECTOR.Settings.${patch.label}.Name`,
            hint: `SPEAKERSELECTOR.Settings.${patch.label}.Hint`,
            scope: 'world', config: true, restricted: true, type: Boolean, default: true,
            onChange: value => document.body?.classList.toggle(patch.className, value === true)
        });
    }
    applyCardPatches();
    if (!game.ready) Hooks.once('ready', applyCardPatches);

    registerChatSystemModule('dx3rd', {
        mergeExcludeCurrent: isDx3rdSystemMessage,
        mergeExcludePrevious: isDx3rdSystemMessage,
        exportExcludeCurrent: isDx3rdSystemMessage,
        exportExcludePrevious: isDx3rdSystemMessage,
        exportBodyClasses: () => CARD_PATCHES.filter(isCardPatchEnabled).map(patch => patch.className)
    });

    const registerExportHook = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchDx3rdLogExportAdditionalCss());
    };

    if (game.ready) registerExportHook();
    else Hooks.once('ready', registerExportHook);
}
