const MODULE_ID = 'lichsoma-speaker-selector';
const CAPABILITIES = Object.freeze({
    chatMergeRules: true,
    chatExportRules: true,
    chatPresentation: true,
    speakerPresentation: true,
    chatTheme: true,
    textFormatting: true
});

export function installModuleApi(api) {
    const module = game?.modules?.get(MODULE_ID);
    if (!module) return null;
    module.api = Object.freeze({
        ...api,
        apiVersion: 1,
        capabilities: CAPABILITIES,
        supports: feature => typeof feature === 'string' && Object.hasOwn(CAPABILITIES, feature) && CAPABILITIES[feature] === true
    });
    return module.api;
}

export function getModuleApi() {
    return game?.modules?.get(MODULE_ID)?.api ?? null;
}
