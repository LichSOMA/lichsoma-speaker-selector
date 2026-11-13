const SYSTEM_ID = 'cain-alter';
let initialized = false;

function buildExportFontPriorityCss() {
    const builder = game.cainAlter?.buildChatExportFontPriorityCSS;
    if (typeof builder !== 'function') return '';

    try {
        const css = builder();
        if (!css || typeof css !== 'string' || !css.trim()) return '';
        return `/* Cain Alter HTML export font priority */\n${css.trim()}`;
    } catch (error) {
        console.warn('[lichsoma-speaker-selector] Cain Alter export font priority CSS failed:', error);
        return '';
    }
}

export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== SYSTEM_ID) return;
    initialized = true;

    const register = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => buildExportFontPriorityCss());
    };

    if (game.ready) register();
    else Hooks.once('ready', register);
}
