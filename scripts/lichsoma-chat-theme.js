const MODULE_ID = 'lichsoma-speaker-selector';
export const CHAT_THEME_SETTING = 'chatTheme';
export const CHAT_THEMES = Object.freeze({
    'dark-simple': 'SPEAKERSELECTOR.Settings.Theme.DarkSimple',
    'simple-light': 'SPEAKERSELECTOR.Settings.Theme.SimpleLight',
    'retro-terminal': 'SPEAKERSELECTOR.Settings.Theme.RetroTerminal',
    'terminal-red': 'SPEAKERSELECTOR.Settings.Theme.TerminalRed'
});

export function normalizeChatTheme(value) {
    return Object.hasOwn(CHAT_THEMES, value) ? value : 'dark-simple';
}

export function getChatTheme() {
    try { return normalizeChatTheme(game.settings.get(MODULE_ID, CHAT_THEME_SETTING)); }
    catch { return 'dark-simple'; }
}

export function getChatThemeClass(theme = getChatTheme()) {
    return `lichsoma-speaker-theme-${normalizeChatTheme(theme)}`;
}

export function applyChatTheme(theme = getChatTheme(), body = document.body) {
    if (!body) return;
    body.classList.remove(...Object.keys(CHAT_THEMES).map(getChatThemeClass));
    body.classList.add(getChatThemeClass(theme));
    globalThis.Hooks?.callAll?.('lichsoma-speaker-selector.themeChanged', normalizeChatTheme(theme));
}

export function moveThemeSettingToTop(root) {
    const element = root?.jquery ? root[0] : (root?.element ?? root);
    const input = element?.querySelector?.(`[name="${MODULE_ID}.${CHAT_THEME_SETTING}"]`);
    const group = input?.closest('.form-group');
    const parent = group?.parentElement;
    const first = parent?.querySelector(':scope > .form-group');
    if (first && first !== group) parent.insertBefore(group, first);
}

export function registerChatThemeSetting() {
    game.settings.register(MODULE_ID, CHAT_THEME_SETTING, {
        name: 'SPEAKERSELECTOR.Settings.Theme.Name',
        hint: 'SPEAKERSELECTOR.Settings.Theme.Hint',
        scope: 'client', config: true, restricted: false, type: String,
        choices: CHAT_THEMES, default: 'dark-simple',
        onChange: theme => applyChatTheme(theme)
    });
    Hooks.once('ready', () => applyChatTheme());
    // Foundry displays registerMenu entries before normal settings regardless
    // of registration order. Move the existing row without rebuilding inputs.
    Hooks.on('renderSettingsConfig', (app, html) => moveThemeSettingToTop(html ?? app.element));
}
