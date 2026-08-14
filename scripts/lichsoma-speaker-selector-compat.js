// LichSOMA's Speaker Selector - FVTT v13/v14 compatibility helpers

const LegacyApplicationBase = globalThis.Application ?? class {
    constructor(options = {}) { this.options = options; }
    render() { return this; }
    close() { return this; }
};

class CompatApplicationV2Fallback extends LegacyApplicationBase {
    constructor(options = {}) {
        const defaults = foundry?.utils?.deepClone?.(new.target.DEFAULT_OPTIONS ?? {}) ?? { ...(new.target.DEFAULT_OPTIONS ?? {}) };
        const merged = foundry?.utils?.mergeObject
            ? foundry.utils.mergeObject(defaults, options, { inplace: false })
            : { ...defaults, ...options };
        const v1Options = {
            id: merged.id,
            classes: merged.classes,
            width: merged.position?.width,
            height: merged.position?.height,
            resizable: merged.window?.resizable ?? true,
            minimizable: merged.window?.minimizable ?? true,
            title: merged.window?.title ?? merged.title ?? ''
        };
        super(v1Options);
        this.optionsV2 = merged;
    }

    get title() {
        const title = this.options?.title ?? this.optionsV2?.window?.title ?? '';
        return game?.i18n?.localize?.(title) ?? title;
    }

    async getData(options = {}) {
        if (typeof this._prepareContext === 'function') return this._prepareContext(options);
        return {};
    }

    async _renderInner(data, options = {}) {
        const result = typeof this._renderHTML === 'function'
            ? await this._renderHTML(data, options)
            : document.createElement('div');
        const wrapper = document.createElement('div');
        if (typeof result === 'string') wrapper.innerHTML = result;
        else if (result instanceof Node) wrapper.append(result);
        return globalThis.jQuery ? $(wrapper.children) : wrapper;
    }

    activateListeners(html) {
        if (super.activateListeners) super.activateListeners(html);
        queueMicrotask(() => {
            if (typeof this._onFirstRender === 'function') this._onFirstRender({}, {});
        });
    }

    async close(options = {}) {
        const result = super.close ? await super.close(options) : this;
        if (typeof this._onClose === 'function') this._onClose(options);
        return result;
    }
}

function getApplicationV2() {
    return foundry?.applications?.api?.ApplicationV2
        ?? globalThis.ApplicationV2
        ?? CompatApplicationV2Fallback;
}

function getFilePicker() {
    return foundry?.applications?.apps?.FilePicker?.implementation
        ?? globalThis.FilePicker
        ?? null;
}

async function renderTemplateCompat(path, data = {}) {
    const renderer = foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    if (typeof renderer !== 'function') {
        throw new Error('No compatible Foundry template renderer was found.');
    }
    return renderer(path, data);
}

/**
 * Return a DOM element from a V1 jQuery Application element, V2 HTMLElement, or app-like object.
 * @param {HTMLElement|jQuery|Application|object} value
 * @returns {HTMLElement|null}
 */
function asElement(value) {
    if (!value) return null;
    if (value instanceof HTMLElement) return value;
    if (globalThis.jQuery && value instanceof jQuery) return value[0] ?? null;
    if (value.jquery && value[0] instanceof HTMLElement) return value[0];
    const el = value.element;
    if (el instanceof HTMLElement) return el;
    if (globalThis.jQuery && el instanceof jQuery) return el[0] ?? null;
    if (el?.jquery && el[0] instanceof HTMLElement) return el[0];
    return null;
}

export const SpeakerSelectorCompat = Object.freeze({
    get ApplicationV2() { return getApplicationV2(); },
    get FilePicker() { return getFilePicker(); },
    renderTemplate: renderTemplateCompat,
    asElement
});
