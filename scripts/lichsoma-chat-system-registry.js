/**
 * 시스템(게임 시스템)별 채팅 규칙 등록소.
 * `scripts/apps/lichsoma-chat-dx3rd.js` 등에서 `registerChatSystemModule`로 핸들러만 등록하고,
 * 머지/내보내기 본문은 `lichsoma-chat-merge.js`, `lichsoma-chat-log-export.js`가 `ChatSystemBridge`만 호출합니다.
 */

/**
 * @typedef {Object} ChatSystemRuleContext
 * @property {*} message ChatMessage 문서
 * @property {HTMLElement} element `.chat-message` 루트
 */

/**
 * @typedef {Object} ChatSystemModuleHandlers
 * @property {(ctx: ChatSystemRuleContext) => boolean} [mergeExcludeCurrent] - true면 현재 메시지는 머지하지 않음(헤더 유지)
 * @property {(ctx: ChatSystemRuleContext) => boolean} [mergeExcludePrevious] - true면 직전 메시지와 이어서 머지하지 않음
 * @property {(ctx: ChatSystemRuleContext) => boolean} [exportExcludeCurrent] - HTML 내보내기 시 머지 재계산용(보통 merge와 동일)
 * @property {(ctx: ChatSystemRuleContext) => boolean} [exportExcludePrevious]
 */

/** @type {Map<string, ChatSystemModuleHandlers>} */
const _modules = new Map();

/**
 * @param {string} id 고유 id (예: 'dx3rd', 'pf2e')
 * @param {ChatSystemModuleHandlers} handlers
 */
export function registerChatSystemModule(id, handlers) {
    if (!id || typeof id !== 'string') {
        throw new Error('registerChatSystemModule: id must be a non-empty string');
    }
    _modules.set(id, { ...handlers });
}

/** @param {string} id */
export function unregisterChatSystemModule(id) {
    _modules.delete(id);
}

/**
 * @param {'mergeExcludeCurrent'|'mergeExcludePrevious'|'exportExcludeCurrent'|'exportExcludePrevious'} key
 * @param {ChatSystemRuleContext} ctx
 */
function _anyHandlerReturnsTrue(key, ctx) {
    if (!ctx?.element) return false;
    for (const h of _modules.values()) {
        const fn = h[key];
        if (typeof fn === 'function' && fn(ctx) === true) return true;
    }
    return false;
}

/** 머지 / 로그 내보내기에서 공통으로 사용하는 브리지 */
export const ChatSystemBridge = {
    merge: {
        /**
         * @param {ChatMessage} message
         * @param {HTMLElement} element `.chat-message` DOM
         */
        excludeCurrent(message, element) {
            return _anyHandlerReturnsTrue('mergeExcludeCurrent', { message, element });
        },
        /**
         * @param {ChatMessage} message 직전 메시지 문서
         * @param {HTMLElement} element 직전 `.chat-message` DOM
         */
        excludePrevious(message, element) {
            return _anyHandlerReturnsTrue('mergeExcludePrevious', { message, element });
        }
    },
    export: {
        excludeCurrent(message, element) {
            return _anyHandlerReturnsTrue('exportExcludeCurrent', { message, element });
        },
        excludePrevious(message, element) {
            return _anyHandlerReturnsTrue('exportExcludePrevious', { message, element });
        }
    }
};

// `lichsoma-chat-log-export.js` 등 비 ESModule 스크립트에서 접근
globalThis.LichsomaChatSystemRegistry = {
    registerChatSystemModule,
    unregisterChatSystemModule,
    ChatSystemBridge
};
