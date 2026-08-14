import { fetchTextAsset } from '../lichsoma-shared-utils.js';

/**
 * D&D 5e — HTML 내보내기용 전용 CSS를 등록합니다.
 *
 * dnd5e 인게임 보정은 styles/systems/lichsoma-chat-dnd5e.css가 담당하고,
 * HTML 내보내기 보정은 styles/export/lichsoma-chat-dnd5e-export.css를
 * 추가 CSS 훅으로 주입합니다.
 */

const DND5E_SYSTEM_ID = 'dnd5e';
const DND5E_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/export/lichsoma-chat-dnd5e-export.css';

async function fetchDnd5eLogExportAdditionalCss() {
    const exportCss = await fetchTextAsset(DND5E_EXPORT_CSS_PATH, { label: 'dnd5e 추가 CSS' });
    if (!exportCss) return '';
    return `/* --- lichsoma-chat-dnd5e-export.css --- */
${exportCss}`;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== DND5E_SYSTEM_ID) return;
    initialized = true;

    const register = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchDnd5eLogExportAdditionalCss());
    };

    if (game.ready) register();
    else Hooks.once('ready', register);
}
