/**
 * LichSOMA Chat Render Limiter
 *
 * Keeps the chat DOM lightweight without modifying stored ChatMessage data.
 *
 * - At the bottom, only the configured number of newest rendered DOM nodes are kept.
 * - Removed DOM node IDs are cached in chronological order.
 * - Scrolling back to the top restores the newest cached block first, preserving continuity.
 * - ChatMessage.logged is intentionally left untouched. Foundry remains responsible for
 *   messages which have never been rendered, while this limiter restores only DOM nodes
 *   which it removed itself.
 */

import { LichsomaChatDom } from './lichsoma-chat-dom.js';
import { ChatMerge } from './lichsoma-chat-merge.js';
import { ChatUI } from './lichsoma-chat-ui.js';
import { registerChatRenderProcessor } from './lichsoma-chat-render-pipeline.js';

export class ChatRenderLimiter {
    static SETTING_KEY = 'chatRenderLimit';
    static LIMITS = new Set([0, 100, 200]);
    static BOTTOM_THRESHOLD = 140;
    static TOP_THRESHOLD = 120;

    static _prunedIdsByLog = new WeakMap();
    static _boundScrollers = new WeakSet();
    static _scheduledPrune = new WeakMap();
    static _isMutating = new WeakSet();
    static _restoreInFlight = new WeakSet();
    static _initialized = false;

    static initialize() {
        if (this._initialized) return;
        this._initialized = true;

        Hooks.once('ready', () => {
            setTimeout(() => this.setup(document), 100);
        });

        Hooks.on('renderChatLog', (app, html) => {
            setTimeout(() => this.setup(html), 0);
            setTimeout(() => this.schedulePrune(html, { requireNearBottom: true }), 50);
        });

        registerChatRenderProcessor('render-limiter', 500, (message, html) => {
            const messageElement = LichsomaChatDom.getChatMessageElement(html);
            if (!messageElement || LichsomaChatDom.isInChatNotifications(messageElement)) return;

            // renderChatMessageHTML fires while the message is still detached. Never fall
            // back to document here: doing so makes an export/preview/restore render mutate
            // the state of the unrelated live ChatLog. Resolve the containing log only after
            // Foundry has had a chance to insert this exact element.
            setTimeout(() => {
                const chatLog = this._getChatLog(messageElement);
                if (!chatLog || !messageElement.isConnected) return;
                if (message?.id) this._removePrunedMessage(message.id, chatLog);
                this.setup(chatLog);
                this.schedulePrune(chatLog, { requireNearBottom: true });
            }, 50);
        }, { runInExport: false });

        Hooks.on('deleteChatMessage', (message) => {
            this._removePrunedMessage(message?.id);
            setTimeout(() => this.schedulePrune(document, { requireNearBottom: true }), 50);
        });
    }

    static getLimit() {
        try {
            const raw = game.settings.get('lichsoma-speaker-selector', this.SETTING_KEY);
            const value = Number(raw);
            return this.LIMITS.has(value) ? value : 0;
        } catch (_error) {
            return 0;
        }
    }

    static isEnabled() {
        return this.getLimit() > 0;
    }

    static setup(root = document) {
        const chatLog = this._getChatLog(root);
        if (!chatLog) return;

        // content-visibility reduces layout/paint work for off-screen messages
        // even when the explicit render limit is disabled.
        chatLog.classList.add('lichsoma-chat-content-visibility');

        const scroller = this._getScroller(chatLog);
        if (!scroller || this._boundScrollers.has(scroller)) return;

        this._boundScrollers.add(scroller);
        scroller.addEventListener('scroll', () => this._onScroll(chatLog), { passive: true });
    }

    static onSettingChanged() {
        const chatLog = this._getChatLog(document);
        if (!chatLog) return;
        this.setup(chatLog);

        if (!this.isEnabled()) {
            void this.restoreAll(chatLog);
            return;
        }

        this.schedulePrune(chatLog, { requireNearBottom: false });
    }

    static schedulePrune(root = document, { requireNearBottom = true } = {}) {
        const chatLog = this._getChatLog(root);
        if (!chatLog || !this.isEnabled()) return;

        if (this._scheduledPrune.get(chatLog)) return;
        const id = setTimeout(() => {
            this._scheduledPrune.delete(chatLog);
            this.prune(chatLog, { requireNearBottom });
        }, 60);
        this._scheduledPrune.set(chatLog, id);
    }

    static prune(root = document, { requireNearBottom = true } = {}) {
        const limit = this.getLimit();
        if (!limit) return;

        const chatLog = this._getChatLog(root);
        if (!chatLog || this._isMutating.has(chatLog) || this._restoreInFlight.has(chatLog)) return;
        const scroller = this._getScroller(chatLog);
        if (requireNearBottom && !this._isNearBottom(scroller)) return;

        const messages = this._getRenderedMessages(chatLog);
        const excess = messages.length - limit;
        if (excess <= 0) return;

        const toRemove = messages.slice(0, excess);
        const wasNearBottom = this._isNearBottom(scroller);

        this._isMutating.add(chatLog);
        try {
            ChatUI.hidePortraitPreview?.();
            for (const element of toRemove) {
                const id = LichsomaChatDom.getMessageId(element);
                if (!id) continue;

                this._rememberPrunedMessage(id, chatLog);

                // DOM-only optimization. Do not update/delete the ChatMessage document and
                // do not alter ChatMessage.logged; the stored world chat log is untouched.
                element.remove();
            }
        } finally {
            this._isMutating.delete(chatLog);
        }

        const firstVisible = this._getRenderedMessages(chatLog)[0] || null;
        if (firstVisible) ChatMerge.recheckMessageAndNext?.(firstVisible);

        if (wasNearBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
    }

    /**
     * Restore the newest block which this limiter previously removed from the DOM.
     * IDs are consumed from the end of the cache, so restoration always proceeds
     * contiguously from the current oldest rendered message toward older history.
     */
    static async restorePreviousBatch(root = document) {
        const limit = this.getLimit();
        if (!limit) return false;

        const chatLog = this._getChatLog(root);
        if (!chatLog || this._restoreInFlight.has(chatLog) || this._isMutating.has(chatLog)) return false;

        const ids = this._getPrunedIds(chatLog);
        if (!ids.length) return false;

        const count = Math.min(limit, ids.length);
        const batchIds = ids.splice(ids.length - count, count);
        const scroller = this._getScroller(chatLog);
        const firstVisible = this._getRenderedMessages(chatLog)[0] || null;
        const anchorTop = firstVisible?.getBoundingClientRect?.().top ?? null;
        const fragment = document.createDocumentFragment();
        const restored = [];
        let failed = false;

        this._restoreInFlight.add(chatLog);
        this._isMutating.add(chatLog);
        try {
            for (const id of batchIds) {
                if (!id || LichsomaChatDom.findRenderedMessageById(id, chatLog)) continue;
                const message = game.messages?.get?.(id);
                if (!message || message.visible === false) continue;

                try {
                    const rendered = await message.renderHTML();
                    const element = LichsomaChatDom.getChatMessageElement(rendered)
                        || (rendered instanceof HTMLElement ? rendered : null);
                    if (!element) {
                        failed = true;
                        break;
                    }
                    fragment.appendChild(element);
                    restored.push(element);
                } catch (error) {
                    failed = true;
                    console.warn(`[lichsoma-speaker-selector] Failed to restore chat message ${id}.`, error);
                    break;
                }
            }

            if (!failed && restored.length) {
                // A native Foundry history render may have completed while renderHTML was
                // awaited. Drop any duplicate pending elements before inserting our batch.
                for (const element of [...restored]) {
                    const id = LichsomaChatDom.getMessageId(element);
                    if (id && LichsomaChatDom.findRenderedMessageById(id, chatLog)) {
                        element.remove();
                        restored.splice(restored.indexOf(element), 1);
                    }
                }

                if (restored.length) chatLog.insertBefore(fragment, firstVisible || chatLog.firstChild);
            }
        } finally {
            this._isMutating.delete(chatLog);
            this._restoreInFlight.delete(chatLog);
        }

        if (failed) {
            // Preserve exact chronological cache order if a batch could not be restored.
            ids.push(...batchIds);
            return false;
        }

        if (restored.length) {
            const recheck = [...restored];
            if (firstVisible) recheck.push(firstVisible);
            ChatMerge.recheckMessageElements?.(recheck);
        }

        if (scroller && firstVisible && anchorTop !== null && firstVisible.isConnected) {
            const newTop = firstVisible.getBoundingClientRect().top;
            scroller.scrollTop += newTop - anchorTop;
        }

        return true;
    }

    /**
     * Restore all DOM nodes removed by this limiter when the setting is disabled.
     * This does not change, create, update, or delete any ChatMessage documents.
     */
    static async restoreAll(root = document) {
        const chatLog = this._getChatLog(root);
        if (!chatLog || this._restoreInFlight.has(chatLog)) return;

        const ids = this._getPrunedIds(chatLog);
        if (!ids.length) return;

        const pendingIds = ids.splice(0, ids.length);
        const scroller = this._getScroller(chatLog);
        const oldScrollHeight = scroller?.scrollHeight ?? 0;
        const oldScrollTop = scroller?.scrollTop ?? 0;
        const wasNearBottom = this._isNearBottom(scroller);
        const firstVisible = this._getRenderedMessages(chatLog)[0] || null;
        const fragment = document.createDocumentFragment();
        const restored = [];
        let failedAt = -1;

        this._restoreInFlight.add(chatLog);
        this._isMutating.add(chatLog);
        try {
            for (let i = 0; i < pendingIds.length; i++) {
                const id = pendingIds[i];
                if (!id || LichsomaChatDom.findRenderedMessageById(id, chatLog)) continue;
                const message = game.messages?.get?.(id);
                if (!message || message.visible === false) continue;

                try {
                    const rendered = await message.renderHTML();
                    const element = LichsomaChatDom.getChatMessageElement(rendered)
                        || (rendered instanceof HTMLElement ? rendered : null);
                    if (!element) {
                        failedAt = i;
                        break;
                    }
                    fragment.appendChild(element);
                    restored.push(element);
                } catch (error) {
                    failedAt = i;
                    console.warn(`[lichsoma-speaker-selector] Failed to restore chat message ${id}.`, error);
                    break;
                }
            }

            if (restored.length) chatLog.insertBefore(fragment, firstVisible || chatLog.firstChild);
        } finally {
            this._isMutating.delete(chatLog);
            this._restoreInFlight.delete(chatLog);
        }

        if (failedAt >= 0) ids.unshift(...pendingIds.slice(failedAt));

        if (restored.length) {
            const recheck = [...restored];
            if (firstVisible) recheck.push(firstVisible);
            ChatMerge.recheckMessageElements?.(recheck);
        }

        if (scroller) {
            if (wasNearBottom) scroller.scrollTop = scroller.scrollHeight;
            else scroller.scrollTop = oldScrollTop + (scroller.scrollHeight - oldScrollHeight);
        }
    }

    static getCachedCount(root = document) {
        const chatLog = this._getChatLog(root);
        return chatLog ? this._getPrunedIds(chatLog).length : 0;
    }

    static _onScroll(chatLog) {
        if (!this.isEnabled()) return;
        const scroller = this._getScroller(chatLog);
        if (!scroller) return;

        // First restore DOM nodes which this limiter removed itself. If none are
        // cached, Foundry's native history loader remains free to load messages
        // which have never been rendered in this client session.
        if (this._isNearTop(scroller) && this._getPrunedIds(chatLog).length) {
            void this.restorePreviousBatch(chatLog);
            return;
        }

        // Once the user comes back to the bottom, collapse the DOM back to the
        // configured recent-message window and cache those removed IDs again.
        if (this._isNearBottom(scroller)) {
            this.schedulePrune(chatLog, { requireNearBottom: true });
        }
    }

    static _getChatLog(root = document) {
        const el = LichsomaChatDom.asElement(root) || document;
        if (el?.matches?.('ol.chat-log, .chat-log') && !LichsomaChatDom.isInChatNotifications(el)) return el;
        return LichsomaChatDom.getMainChatLog(el);
    }

    static _getScroller(chatLog) {
        return LichsomaChatDom.getChatScroll(chatLog?.closest?.('#chat, section#chat, .chat-sidebar') || document)
            || chatLog?.closest?.('.chat-scroll')
            || chatLog;
    }

    static _getRenderedMessages(chatLog) {
        if (!chatLog) return [];
        return Array.from(chatLog.children || [])
            .filter((el) => el?.matches?.('.chat-message[data-message-id]') && !LichsomaChatDom.isInChatNotifications(el));
    }

    static _getPrunedIds(chatLog) {
        let ids = this._prunedIdsByLog.get(chatLog);
        if (!ids) {
            ids = [];
            this._prunedIdsByLog.set(chatLog, ids);
        }
        return ids;
    }

    static _rememberPrunedMessage(messageId, chatLog) {
        if (!messageId || !chatLog) return;
        const ids = this._getPrunedIds(chatLog);
        const existing = ids.indexOf(messageId);
        if (existing >= 0) ids.splice(existing, 1);
        ids.push(messageId);
    }

    static _isNearBottom(scroller) {
        if (!scroller) return true;
        return (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) <= this.BOTTOM_THRESHOLD;
    }

    static _isNearTop(scroller) {
        if (!scroller) return false;
        return scroller.scrollTop <= this.TOP_THRESHOLD;
    }

    static _removePrunedMessage(messageId, specificChatLog = null) {
        if (!messageId) return;
        const chatLog = specificChatLog || this._getChatLog(document);
        const ids = chatLog ? this._prunedIdsByLog.get(chatLog) : null;
        if (!ids?.length) return;
        for (let i = ids.length - 1; i >= 0; i--) {
            if (ids[i] === messageId) ids.splice(i, 1);
        }
    }
}
