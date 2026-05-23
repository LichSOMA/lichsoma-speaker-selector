/**
 * D&D 5e — HTML 내보내기용 전용 CSS를 등록합니다.
 *
 * dnd5e 인게임 보정은 styles/lichsoma-chat-styles.css가 담당하고,
 * HTML 내보내기에서는 이 파일이 styles/apps/lichsoma-chat-dnd5e.css를 읽어
 * lichsoma-chat-log-export.js의 추가 CSS 훅으로 주입합니다.
 */

const DND5E_SYSTEM_ID = 'dnd5e';
const DND5E_APP_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/apps/lichsoma-chat-dnd5e.css';

async function fetchCssText(path) {
    const url = `${window.location.origin}/${path.replace(/^\//, '')}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const text = await response.text();
        return text.trim() ? text : '';
    } catch (e) {
        console.warn('lichsoma-speaker-selector: dnd5e 추가 CSS 로드 실패', path, e);
        return '';
    }
}

async function fetchDnd5eLogExportAdditionalCss() {
    const appCss = await fetchCssText(DND5E_APP_CSS_PATH);
    if (!appCss) return '';

    // 내보낸 HTML은 <body class="system-dnd5e"> 스코프가 없을 수 있으므로,
    // export에서는 body.system-dnd5e 스코프를 제거해 적용되게 한다.
    const descope = appCss
        .replaceAll(/^body\.system-dnd5e\s+/gm, '')
        .replaceAll(/(^|[\s>+~,(])body\.system-dnd5e\s+/g, '$1');

    return `/* --- lichsoma-chat-dnd5e.css (export, descoped) --- */\n${descope}`;
}

Hooks.once('ready', () => {
    if (game.system?.id !== DND5E_SYSTEM_ID) return;

    Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchDnd5eLogExportAdditionalCss());
});
