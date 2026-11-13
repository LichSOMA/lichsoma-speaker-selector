/**
 * Game-system-specific chat compatibility registry.
 *
 * System adapters register only the behavior that cannot be expressed through
 * Speaker Selector's generic shell/payload rules. Core chat code talks to the
 * active adapter through ChatSystemBridge and does not need to know system IDs.
 */

/**
 * @typedef {Object} ChatSystemRuleContext
 * @property {*} message ChatMessage document
 * @property {HTMLElement} element `.chat-message` root
 */

/**
 * @typedef {Object} ChatSystemModuleHandlers
 * @property {(ctx: ChatSystemRuleContext) => boolean} [mergeExcludeCurrent]
 * @property {(ctx: ChatSystemRuleContext) => boolean} [mergeExcludePrevious]
 * @property {(ctx: ChatSystemRuleContext) => boolean} [exportExcludeCurrent]
 * @property {(ctx: ChatSystemRuleContext) => boolean} [exportExcludePrevious]
 * @property {(ctx: Object) => boolean} [isNativeHeader]
 * @property {(ctx: Object) => boolean|void} [prepareLivePresentation]
 * @property {(ctx: Object) => boolean|Promise<boolean>|void|Promise<void>} [prepareExportPresentation]
 * @property {(ctx: Object) => boolean|void} [afterMessageCreated]
 * @property {(ctx: Object) => boolean} [placeDeleteButton]
 * @property {() => boolean} [suppressGenericPortraitSetting]
 * @property {() => boolean} [deferGenericPortrait]
 * @property {(ctx: Object) => string|null} [renderSpeakerOptions]
 * @property {(ctx: Object) => boolean} [applySenderPresentation]
 * @property {(ctx: Object) => string|null} [getSenderAlias]
 * @property {() => string[]} [exportBodyClasses]
 * @property {(ctx: Object) => string|null} [getExportMergePortraitSrc]
 */

/** @type {Map<string, ChatSystemModuleHandlers>} */
const _modules = new Map();

/**
 * @param {string} id Unique adapter id (for example `dnd5e`, `dx3rd`, `lancer`).
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

function _handlersFor(key) {
    const handlers = [];
    for (const moduleHandlers of _modules.values()) {
        const fn = moduleHandlers?.[key];
        if (typeof fn === 'function') handlers.push(fn);
    }
    return handlers;
}

function _anyHandlerReturnsTrue(key, ctx) {
    if (!ctx?.element && /Exclude|NativeHeader|DeleteButton/.test(key)) return false;
    for (const fn of _handlersFor(key)) {
        if (fn(ctx) === true) return true;
    }
    return false;
}

function _firstDefined(key, ctx, fallback = null) {
    for (const fn of _handlersFor(key)) {
        const value = fn(ctx);
        if (value !== undefined && value !== null && value !== false) return value;
    }
    return fallback;
}

async function _firstDefinedAsync(key, ctx, fallback = null) {
    for (const fn of _handlersFor(key)) {
        const value = await fn(ctx);
        if (value !== undefined && value !== null && value !== false) return value;
    }
    return fallback;
}

function _collectArrays(key) {
    const values = [];
    for (const fn of _handlersFor(key)) {
        const result = fn();
        if (Array.isArray(result)) values.push(...result);
    }
    return values;
}

export const ChatSystemBridge = {
    merge: {
        excludeCurrent(message, element) {
            return _anyHandlerReturnsTrue('mergeExcludeCurrent', { message, element });
        },
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
        },
        bodyClasses() {
            return Array.from(new Set(_collectArrays('exportBodyClasses').filter(Boolean)));
        },
        mergePortraitSrc(message, element) {
            return _firstDefined('getExportMergePortraitSrc', { message, element }, null);
        }
    },

    presentation: {
        isNativeHeader(message, element) {
            return _anyHandlerReturnsTrue('isNativeHeader', { message, element });
        },
        prepareLive(message, element, context = {}) {
            return _firstDefined('prepareLivePresentation', { message, element, ...context }, false) === true;
        },
        async prepareExport(message, element, context = {}) {
            return (await _firstDefinedAsync('prepareExportPresentation', { message, element, ...context }, false)) === true;
        },
        afterMessageCreated(message, context = {}) {
            return _firstDefined('afterMessageCreated', { message, ...context }, false) === true;
        },
        placeDeleteButton(message, element, button, context = {}) {
            return _anyHandlerReturnsTrue('placeDeleteButton', { message, element, button, ...context });
        },
        suppressGenericPortraitSetting() {
            return _firstDefined('suppressGenericPortraitSetting', {}, false) === true;
        },
        deferGenericPortrait() {
            return _firstDefined('deferGenericPortrait', {}, false) === true;
        }
    },

    speaker: {
        renderOptions(entries, context = {}) {
            return _firstDefined('renderSpeakerOptions', { entries, ...context }, null);
        },
        applySenderPresentation(senderElement, actor, speaker, context = {}) {
            return _firstDefined('applySenderPresentation', {
                senderElement,
                actor,
                speaker,
                ...context
            }, false) === true;
        },
        getSenderAlias(speakerData, context = {}) {
            return _firstDefined('getSenderAlias', { speakerData, ...context }, null);
        }
    }
};
