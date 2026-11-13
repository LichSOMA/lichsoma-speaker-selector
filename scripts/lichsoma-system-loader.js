const MODULE_ID = 'lichsoma-speaker-selector';

const SYSTEM_ADAPTERS = {
    ordemparanormal: {
        module: './systems/ordemparanormal/adapter.js',
        style: 'styles/systems/ordemparanormal/chat.css'
    },
    dnd5e: {
        module: './systems/dnd5e/adapter.js',
        style: 'styles/systems/dnd5e/chat.css',
        suppressGenericPortraitSetting: true
    },
    'dx3rd-fvtt': {
        module: './systems/dx3rd/adapter.js',
        style: 'styles/systems/dx3rd/chat.css'
    },
    lancer: {
        module: './systems/lancer/adapter.js',
        style: 'styles/systems/lancer/chat.css'
    },
    pf1: {
        module: './systems/pf1/adapter.js',
        style: 'styles/systems/pf1/chat.css'
    },
    pf2e: {
        module: './systems/pf2e/adapter.js',
        style: 'styles/systems/pf2e/chat.css'
    },
    'cain-alter': {
        module: './systems/cain-alter/adapter.js',
        style: null
    }
};

export function activeSystemSuppressesGenericPortraitSetting() {
    const systemId = game.system?.id;
    return SYSTEM_ADAPTERS[systemId]?.suppressGenericPortraitSetting === true;
}

function loadSystemStylesheet(path, systemId) {
    if (!path || document.querySelector(`link[data-lichsoma-system-style="${systemId}"]`)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `modules/${MODULE_ID}/${path}`;
    link.dataset.lichsomaSystemStyle = systemId;

    // Keep system compatibility CSS after common chat CSS and before later UI layers.
    const followingStyle = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .find((element) => element.href?.includes(`/modules/${MODULE_ID}/styles/lichsoma-chat-sender-edit.css`));
    if (followingStyle?.parentNode) followingStyle.parentNode.insertBefore(link, followingStyle);
    else document.head.appendChild(link);
}

async function loadActiveSystemAdapter() {
    const systemId = game.system?.id;
    const config = SYSTEM_ADAPTERS[systemId];
    if (!config) return;

    loadSystemStylesheet(config.style, systemId);

    try {
        const adapter = await import(config.module);
        adapter.initializeSystemAdapter?.();
    } catch (error) {
        console.error(`[${MODULE_ID}] ${systemId} system adapter load failed`, error);
    }
}

Hooks.once('init', () => {
    void loadActiveSystemAdapter();
});
