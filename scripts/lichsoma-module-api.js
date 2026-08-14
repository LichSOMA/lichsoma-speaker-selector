const MODULE_ID = 'lichsoma-speaker-selector';

export function installModuleApi(api) {
    const module = game?.modules?.get(MODULE_ID);
    if (!module) return null;
    module.api = Object.freeze({ ...api });
    return module.api;
}

export function getModuleApi() {
    return game?.modules?.get(MODULE_ID)?.api ?? null;
}
