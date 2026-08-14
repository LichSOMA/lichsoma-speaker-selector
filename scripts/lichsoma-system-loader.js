const MODULE_ID = 'lichsoma-speaker-selector';

const SYSTEM_ADAPTERS = {
    dnd5e: {
        module: './apps/lichsoma-chat-dnd5e.js',
        style: 'styles/systems/lichsoma-chat-dnd5e.css'
    },
    'dx3rd-fvtt': {
        module: './apps/lichsoma-chat-dx3rd.js',
        style: 'styles/systems/lichsoma-chat-dx3rd.css'
    },
    lancer: {
        module: './apps/lichsoma-chat-lancer.js',
        style: 'styles/systems/lichsoma-chat-lancer.css'
    }
};

function loadSystemStylesheet(path, systemId) {
    if (!path || document.querySelector(`link[data-lichsoma-system-style="${systemId}"]`)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `modules/${MODULE_ID}/${path}`;
    link.dataset.lichsomaSystemStyle = systemId;

    // 기존 매니페스트 순서와 동일하게 공통 채팅 CSS 뒤, 후속 UI CSS 앞에 삽입한다.
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
        console.error(`[${MODULE_ID}] ${systemId} 시스템 어댑터 로드 실패`, error);
    }
}

Hooks.once('init', () => {
    void loadActiveSystemAdapter();
});
