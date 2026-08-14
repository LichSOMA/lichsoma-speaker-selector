/**
 * One ordered entry point for renderChatMessageHTML.
 * Feature modules register small processors instead of registering their own hooks.
 *
 * Export rendering is explicitly isolated from live ChatLog rendering. The export
 * context is associated with the specific ChatMessage object through a WeakMap, so
 * exporting historical messages cannot accidentally change live-DOM state for other
 * messages which render concurrently.
 */

import { SpeakerSelectorCompat } from './lichsoma-speaker-selector-compat.js';

const processors = new Map();
const renderContexts = new WeakMap();
let initialized = false;
const processedElements = new WeakSet();

/**
 * @param {string} id
 * @param {number} order
 * @param {(message: ChatMessage, element: HTMLElement, data: object) => void} processor
 * @param {{ runInExport?: boolean }} options
 */
export function registerChatRenderProcessor(id, order, processor, options = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('Chat render processor id must be a non-empty string.');
    if (typeof processor !== 'function') throw new TypeError(`Chat render processor "${id}" must be a function.`);
    processors.set(id, {
        id,
        order: Number(order) || 0,
        processor,
        runInExport: options.runInExport !== false
    });
}

export function unregisterChatRenderProcessor(id) {
    processors.delete(id);
}

/**
 * Return the LichSOMA render context currently associated with a ChatMessage.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
export function getChatRenderContext(message) {
    return (message && typeof message === 'object') ? (renderContexts.get(message) || null) : null;
}

/**
 * Run an async render operation with a context attached only to the supplied
 * ChatMessage instance. Nested contexts are restored exactly after completion.
 *
 * @template T
 * @param {ChatMessage} message
 * @param {object} context
 * @param {() => Promise<T>|T} callback
 * @returns {Promise<T>}
 */
export async function withChatRenderContext(message, context, callback) {
    if (typeof callback !== 'function') throw new TypeError('Chat render context callback must be a function.');
    if (!message || typeof message !== 'object') return await callback();

    const previous = renderContexts.get(message);
    const next = Object.assign({}, previous || {}, context || {});
    renderContexts.set(message, next);

    try {
        return await callback();
    } finally {
        if (previous) renderContexts.set(message, previous);
        else renderContexts.delete(message);
    }
}

export function initializeChatRenderPipeline() {
    if (initialized) return;
    initialized = true;

    Hooks.on('renderChatMessageHTML', (message, html, data) => {
        const element = SpeakerSelectorCompat.asElement(html);
        if (!element || processedElements.has(element)) return;
        processedElements.add(element);

        const lichsomaRenderContext = getChatRenderContext(message);
        const isExportRender = lichsomaRenderContext?.mode === 'export';
        const processorData = lichsomaRenderContext
            ? Object.assign({}, data || {}, { lichsomaRenderContext })
            : (data ?? {});

        const ordered = [...processors.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        for (const entry of ordered) {
            if (isExportRender && entry.runInExport === false) continue;
            try {
                entry.processor(message, element, processorData);
            } catch (error) {
                console.error(`[lichsoma-speaker-selector] chat render processor failed: ${entry.id}`, error);
            }
        }
    });
}

export function getRegisteredChatRenderProcessors() {
    return [...processors.values()]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map(({ id, order }) => ({ id, order }));
}
