import { LichsomaChatDom } from './lichsoma-chat-dom.js';

/** Viewport-only fades: no message movement, scroll anchoring or history loading. */
export class ChatScrollFade {
    static _initialized = false;
    static _records = new Map();
    static _frame = null;

    static initialize() {
        if (this._initialized) return;
        this._initialized = true;
        for (const hook of ['renderChatLog', 'renderChatLogV2', 'closeChatLog', 'closeChatLogV2']) {
            Hooks.on(hook, () => this.schedule());
        }
        Hooks.once('ready', () => this.schedule());
        Hooks.on('updateSetting', () => this.schedule());
        document.fonts?.addEventListener('loadingdone', () => this.schedule());
        this.schedule();
    }

    static schedule() {
        if (this._frame !== null) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.refresh();
        });
    }

    static refresh() {
        const active = new Map();
        for (const root of document.querySelectorAll('#chat.chat-sidebar, .chat-popout')) {
            if (root.closest('#chat-notifications')) continue;
            const log = LichsomaChatDom.getMainChatLog(root);
            const scroller = LichsomaChatDom.getChatScroll(root) || log;
            if (log && scroller) active.set(scroller, log);
        }
        for (const [scroller, record] of this._records) {
            if (active.get(scroller) === record.log && scroller.isConnected) continue;
            record.resize.disconnect();
            record.mutation.disconnect();
            scroller.removeEventListener('scroll', record.schedule);
            scroller.removeEventListener('load', record.schedule, true);
            scroller.classList.remove('lichsoma-chat-scroll-fade', 'lichsoma-chat-fade-top', 'lichsoma-chat-fade-bottom');
            this._records.delete(scroller);
        }
        for (const [scroller, log] of active) {
            if (!this._records.has(scroller)) {
                const schedule = () => this.schedule();
                const resize = new ResizeObserver(schedule);
                resize.observe(scroller);
                if (log !== scroller) resize.observe(log);
                const mutation = new MutationObserver(records => {
                    // Our three state classes must not schedule another frame.
                    if (records.some(record => record.type !== 'attributes' || record.target !== scroller)) schedule();
                });
                mutation.observe(log, {
                    childList: true, subtree: true, characterData: true,
                    attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden']
                });
                scroller.addEventListener('scroll', schedule, { passive: true });
                scroller.addEventListener('load', schedule, true);
                scroller.classList.add('lichsoma-chat-scroll-fade');
                this._records.set(scroller, { log, resize, mutation, schedule });
            }
            const top = Math.max(0, scroller.scrollTop);
            const remaining = Math.max(0, scroller.scrollHeight - scroller.clientHeight - top);
            const scrollable = scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight + 1;
            scroller.classList.toggle('lichsoma-chat-fade-top', scrollable && top > 1);
            scroller.classList.toggle('lichsoma-chat-fade-bottom', scrollable && remaining > 1);
        }
    }
}
