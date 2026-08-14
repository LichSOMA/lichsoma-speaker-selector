/** Single validated receiver for module.lichsoma-speaker-selector. */

const CHANNEL = 'module.lichsoma-speaker-selector';
const handlers = new Map();
let initialized = false;
let readyHookScheduled = false;

function initializeSocketRouter() {
    if (initialized || !game?.socket) return;
    initialized = true;

    game.socket.on(CHANNEL, (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        const type = typeof data.type === 'string' ? data.type : '';
        if (!type || type.length > 64) return;

        if (data.userId != null) {
            if (typeof data.userId !== 'string' || !game.users?.get(data.userId)) return;
        }

        const set = handlers.get(type);
        if (!set?.size) return;
        for (const handler of [...set]) {
            try {
                handler(data);
            } catch (error) {
                console.error(`[lichsoma-speaker-selector] socket handler failed: ${type}`, error);
            }
        }
    });
}

function ensureSocketRouter() {
    if (game?.ready) {
        initializeSocketRouter();
        return;
    }
    if (readyHookScheduled) return;
    readyHookScheduled = true;
    Hooks.once('ready', () => initializeSocketRouter());
}

export function registerSocketHandler(type, handler) {
    if (!type || typeof type !== 'string') throw new TypeError('Socket message type must be a non-empty string.');
    if (typeof handler !== 'function') throw new TypeError(`Socket handler for "${type}" must be a function.`);
    const set = handlers.get(type) ?? new Set();
    set.add(handler);
    handlers.set(type, set);
    ensureSocketRouter();
    return () => unregisterSocketHandler(type, handler);
}

export function unregisterSocketHandler(type, handler) {
    const set = handlers.get(type);
    if (!set) return;
    set.delete(handler);
    if (!set.size) handlers.delete(type);
}

export function emitSocket(type, payload = {}) {
    if (!game?.socket || !type) return false;
    const data = {
        ...payload,
        type,
        userId: payload.userId ?? game.user?.id ?? null
    };
    game.socket.emit(CHANNEL, data);
    return true;
}

export function getRegisteredSocketTypes() {
    return [...handlers.keys()].sort();
}
