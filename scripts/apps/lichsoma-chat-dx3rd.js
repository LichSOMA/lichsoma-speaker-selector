/**
 * DX3rd 등 — `lichsoma-chat-system-registry.js`에 머지/내보내기 규칙을 등록합니다.
 * 다른 게임 시스템은 동일 패턴으로 `scripts/apps/lichsoma-chat-<id>.js`를 추가하면 됩니다.
 */
import { registerChatSystemModule } from '../lichsoma-chat-system-registry.js';

/** `.chat-message` 루트에 붙는 시스템 메시지 클래스 (시스템 모듈과 맞춤) */
export const DX3RD_CHAT_MESSAGE_CLASS = 'dx3rd-system-message';

/** @param {{ message: *, element: HTMLElement }} ctx */
function isDx3rdSystemMessage(ctx) {
    return ctx.element?.classList?.contains(DX3RD_CHAT_MESSAGE_CLASS) ?? false;
}

Hooks.once('init', () => {
    registerChatSystemModule('dx3rd', {
        mergeExcludeCurrent: isDx3rdSystemMessage,
        mergeExcludePrevious: isDx3rdSystemMessage,
        exportExcludeCurrent: isDx3rdSystemMessage,
        exportExcludePrevious: isDx3rdSystemMessage
    });
});

const DX3RD_FVTT_SYSTEM_ID = 'dx3rd-fvtt';
/** @see styles/apps/lichsoma-chat-dx3rd.css (내보내기 시 descope 하여 합침) */
const DX3RD_APP_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/apps/lichsoma-chat-dx3rd.css';

/**
 * dx3rd-fvtt 월드일 때만: HTML 내보내기 `<style>`에 추가 CSS 텍스트 주입
 * (`lichsoma-chat-log-export.js` 의 `lichsoma-speaker-selector.chatLogExportAdditionalCSS` 훅)
 */
async function fetchCssText(path) {
    const url = `${window.location.origin}/${path.replace(/^\//, '')}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const text = await response.text();
        return text.trim() ? text : '';
    } catch (e) {
        console.warn('lichsoma-speaker-selector: 추가 CSS 로드 실패', path, e);
        return '';
    }
}

async function fetchDx3rdLogExportAdditionalCss() {
    const appCss = await fetchCssText(DX3RD_APP_CSS_PATH);
    if (!appCss) return '';
    // 내보낸 HTML은 <body class="system-dx3rd-fvtt"> 스코프가 없으므로, export에서는 스코프를 제거해 적용되게 한다.
    const descope = appCss
        .replaceAll(/^body\.system-dx3rd-fvtt\s+/gm, '')
        .replaceAll(/(^|[\s>+~,(])body\.system-dx3rd-fvtt\s+/g, '$1');
    return `/* --- lichsoma-chat-dx3rd.css (export, descoped) --- */\n${descope}`;
}

Hooks.once('ready', () => {
    if (game.system?.id !== DX3RD_FVTT_SYSTEM_ID) return;

    Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchDx3rdLogExportAdditionalCss());
});
