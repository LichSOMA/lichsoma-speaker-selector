/**
 * DX3rd 등 — `lichsoma-chat-system-registry.js`에 머지/내보내기 규칙을 등록합니다.
 * 다른 게임 시스템은 동일 패턴으로 `scripts/apps/lichsoma-chat-<id>.js`를 추가하면 됩니다.
 */
import { registerChatSystemModule } from '../lichsoma-chat-system-registry.js';
import { fetchTextAsset } from '../lichsoma-shared-utils.js';

/** `.chat-message` 루트에 붙는 시스템 메시지 클래스 (시스템 모듈과 맞춤) */
export const DX3RD_CHAT_MESSAGE_CLASS = 'dx3rd-system-message';

/** @param {{ message: *, element: HTMLElement }} ctx */
function isDx3rdSystemMessage(ctx) {
    return ctx.element?.classList?.contains(DX3RD_CHAT_MESSAGE_CLASS) ?? false;
}

const DX3RD_FVTT_SYSTEM_ID = 'dx3rd-fvtt';
/** @see styles/export/lichsoma-chat-dx3rd-export.css */
const DX3RD_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/export/lichsoma-chat-dx3rd-export.css';

/**
 * dx3rd-fvtt 월드일 때만: HTML 내보내기 `<style>`에 export 전용 DX3rd CSS 주입
 * (`lichsoma-chat-log-export.js` 의 `lichsoma-speaker-selector.chatLogExportAdditionalCSS` 훅)
 */
async function fetchDx3rdLogExportAdditionalCss() {
    const exportCss = await fetchTextAsset(DX3RD_EXPORT_CSS_PATH, { label: 'DX3rd 추가 CSS' });
    if (!exportCss) return '';
    return `/* --- lichsoma-chat-dx3rd-export.css --- */
${exportCss}`;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== DX3RD_FVTT_SYSTEM_ID) return;
    initialized = true;

    registerChatSystemModule('dx3rd', {
        mergeExcludeCurrent: isDx3rdSystemMessage,
        mergeExcludePrevious: isDx3rdSystemMessage,
        exportExcludeCurrent: isDx3rdSystemMessage,
        exportExcludePrevious: isDx3rdSystemMessage
    });

    const registerExportHook = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchDx3rdLogExportAdditionalCss());
    };

    if (game.ready) registerExportHook();
    else Hooks.once('ready', registerExportHook);
}
