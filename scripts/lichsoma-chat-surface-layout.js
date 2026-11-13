import { LichsomaChatDom } from './lichsoma-chat-dom.js';

/** Adjust only the background; message and composer geometry remain untouched. */
export class ChatSurfaceLayout {
    static _initialized = false;
    static _frame = null;
    static _root = null;
    static _resize = null;
    static _mutation = null;
    static _targets = [];

    static initialize() {
        if (this._initialized) return;
        this._initialized = true;
        for (const hook of ['renderChatLog', 'renderChatLogV2', 'renderSidebarTab', 'closeChatLog', 'updateSetting']) {
            Hooks.on(hook, () => this.schedule());
        }
        Hooks.once('ready', () => this.schedule());
        window.addEventListener('resize', () => this.schedule());
        this.schedule();
    }

    static schedule() {
        if (this._frame !== null) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this.refresh();
        });
    }

    static _set(element, name, value) {
        const rounded = `${Math.round(value * 100) / 100}px`;
        if (element.style.getPropertyValue(name) !== rounded) element.style.setProperty(name, rounded);
    }

    static refresh() {
        const root = document.querySelector('#chat.chat-sidebar');
        const form = root && LichsomaChatDom.getChatForm(root);
        const input = form?.querySelector('#chat-message, prose-mirror[name="message"], .chat-input');
        const targets = [...new Set([root, form, input].filter(Boolean))];
        if (targets.length !== this._targets.length || targets.some((target, i) => target !== this._targets[i])) {
            this._resize?.disconnect();
            this._mutation?.disconnect();
            if (this._root !== root) {
                for (const name of ['--lichsoma-chat-surface-left', '--lichsoma-chat-surface-right']) {
                    this._root?.style.removeProperty(name);
                }
            }
            this._root = root;
            this._targets = targets;
            this._resize = new ResizeObserver(() => this.schedule());
            targets.forEach(target => this._resize.observe(target));
            if (root) {
                this._mutation = new MutationObserver(() => this.schedule());
                this._mutation.observe(root, { childList: true, subtree: true });
            }
        }
        if (!root || !input) return;
        const bounds = root.getBoundingClientRect();
        const composer = input.getBoundingClientRect();
        if (!bounds.width || !composer.width || !input.getClientRects().length) return;

        // Absolute positioning uses the root's padding box. Rects are in viewport
        // pixels; divide out any ancestor scale before writing CSS pixel offsets.
        const scale = bounds.width / root.offsetWidth;
        const origin = bounds.left + root.clientLeft * scale;
        // Follow the composer on both sides. Message margins are asymmetric;
        // deriving the left edge from them introduces a 4px inward offset.
        const left = (composer.left - origin) / scale;
        const right = Math.min((composer.right - origin) / scale, root.clientWidth - 4);
        this._set(root, '--lichsoma-chat-surface-left', left);
        this._set(root, '--lichsoma-chat-surface-right', root.clientWidth - right);
    }
}
