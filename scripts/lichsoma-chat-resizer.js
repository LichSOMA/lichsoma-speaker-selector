/**
 * LichSOMA Chat Resizer — 사이드바 너비·채팅 입력(--chat-input-height) 드래그 조절
 */

const MODULE_ID = 'lichsoma-speaker-selector';
const SETTING_KEY_WIDTH = 'sidebarWidthPx';
const SETTING_KEY_MIN_WIDTH = 'sidebarMinWidthPx';
const SETTING_KEY_CHAT_HEIGHT = 'chatInputHeightPx';

const DEFAULT_MIN_WIDTH = 312;
const MAX_MIN_WIDTH = 400;
const DEFAULT_WIDTH = 312;

const MIN_CHAT_INPUT_HEIGHT = 78;
const DEFAULT_CHAT_INPUT_HEIGHT = 78;

export class ChatSidebarResizer {
    static _resizeClampTimer = null;

    static init() {
        game.settings.register(MODULE_ID, SETTING_KEY_MIN_WIDTH, {
            name: game.i18n?.localize?.('SPEAKERSELECTOR.Settings.SidebarMinWidth.Name') ?? 'Sidebar minimum width (px)',
            hint: game.i18n?.localize?.('SPEAKERSELECTOR.Settings.SidebarMinWidth.Hint') ?? '',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: DEFAULT_MIN_WIDTH,
            range: { min: DEFAULT_MIN_WIDTH, max: MAX_MIN_WIDTH, step: 1 },
            onChange: () => {
                // 월드 설정이 바뀌면, 각 클라이언트의 저장된 폭을 새 최소값에 맞게 재클램프
                this._applySavedWidth();
            }
        });

        game.settings.register(MODULE_ID, SETTING_KEY_WIDTH, {
            name: 'Sidebar width (px)',
            scope: 'client',
            config: false,
            type: Number,
            default: DEFAULT_WIDTH
        });

        game.settings.register(MODULE_ID, SETTING_KEY_CHAT_HEIGHT, {
            name: 'Chat input height (px)',
            scope: 'client',
            config: false,
            type: Number,
            default: DEFAULT_CHAT_INPUT_HEIGHT
        });

        Hooks.once('ready', () => {
            this._applySavedWidth();
            this._applySavedChatInputHeight();
            this._installSidebarHandle();
            this._installEditorHeightHandle();
            this._bindWindowResizeClamp();
        });

        Hooks.on('renderApplicationV2', (app) => {
            if (app?.id === 'sidebar') {
                this._applySavedWidth();
                this._applySavedChatInputHeight();
                this._installSidebarHandle();
                this._installEditorHeightHandle();
            }
        });

        Hooks.on('renderChatLog', () => {
            setTimeout(() => this._installEditorHeightHandle(), 0);
        });

        // FVTT v13 이하: 일부 환경에서만 존재 (v14 코어에는 없음)
        Hooks.on('renderSidebarTab', (app) => {
            if (app?.tabName === 'chat') {
                setTimeout(() => this._installEditorHeightHandle(), 0);
            }
        });

        // FVTT v14+: 사이드바 탭 전환 시 호출됨 — 채팅으로 돌아올 때 높이 핸들 재설치
        Hooks.on('changeSidebarTab', (app) => {
            if (app?.constructor?.tabName !== 'chat') return;
            setTimeout(() => this._installEditorHeightHandle(), 0);
        });
    }

    static _getUiScale() {
        const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
        return Number.isFinite(v) && v > 0 ? v : 1;
    }

    static _getMinSidebarWidth() {
        const v = game.settings.get(MODULE_ID, SETTING_KEY_MIN_WIDTH);
        const n = Number(v);
        if (!Number.isFinite(n)) return DEFAULT_MIN_WIDTH;
        return Math.max(DEFAULT_MIN_WIDTH, Math.min(MAX_MIN_WIDTH, Math.round(n)));
    }

    static _clampWidth(px) {
        const min = this._getMinSidebarWidth();
        const max = Math.max(min, Math.floor(window.innerWidth / 3));
        return Math.round(Math.min(max, Math.max(min, px)));
    }

    static _clampChatInputHeight(px) {
        const max = Math.max(MIN_CHAT_INPUT_HEIGHT, Math.floor(window.innerHeight / 3));
        return Math.round(Math.min(max, Math.max(MIN_CHAT_INPUT_HEIGHT, px)));
    }

    static _applyWidth(px) {
        const sidebar = document.querySelector('#sidebar');
        if (!sidebar) return;
        const w = this._clampWidth(px);
        sidebar.style.setProperty('--sidebar-width', `${w}px`);
    }

    static _applyChatInputHeight(px) {
        const sidebar = document.querySelector('#sidebar');
        if (!sidebar) return;
        const h = this._clampChatInputHeight(px);
        sidebar.style.setProperty('--chat-input-height', `${h}px`);
    }

    static _applySavedWidth() {
        const v = game.settings.get(MODULE_ID, SETTING_KEY_WIDTH);
        if (typeof v === 'number' && v > 0) {
            this._applyWidth(v);
        }
    }

    static _applySavedChatInputHeight() {
        const v = game.settings.get(MODULE_ID, SETTING_KEY_CHAT_HEIGHT);
        if (typeof v === 'number' && v > 0) {
            this._applyChatInputHeight(v);
        }
    }

    static _persistWidth(px) {
        const w = this._clampWidth(px);
        game.settings.set(MODULE_ID, SETTING_KEY_WIDTH, w);
    }

    static _persistChatInputHeight(px) {
        const h = this._clampChatInputHeight(px);
        game.settings.set(MODULE_ID, SETTING_KEY_CHAT_HEIGHT, h);
    }

    static _bindWindowResizeClamp() {
        window.addEventListener(
            'resize',
            () => {
                if (this._resizeClampTimer) clearTimeout(this._resizeClampTimer);
                this._resizeClampTimer = setTimeout(() => {
                    this._resizeClampTimer = null;
                    this._applySavedWidth();
                    this._applySavedChatInputHeight();
                }, 100);
            },
            { passive: true }
        );
    }

    static _installSidebarHandle() {
        const content = document.querySelector('#sidebar-content');
        if (!content || content.querySelector(':scope > .lichsoma-sidebar-resize-handle')) return;

        const handle = document.createElement('div');
        handle.className = 'lichsoma-sidebar-resize-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', '사이드바 너비 조절');
        handle.title = '사이드바 너비 조절 (드래그). 더블클릭 시 기본 너비로 초기화.';
        content.prepend(handle);

        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            const sidebar = document.querySelector('#sidebar');
            if (!sidebar) return;

            const startX = ev.clientX;
            const computed = getComputedStyle(sidebar).getPropertyValue('--sidebar-width').trim();
            const parsed = parseFloat(computed);
            const startWidth = Number.isFinite(parsed) ? parsed : this._getMinSidebarWidth();
            const scale = this._getUiScale();

            sidebar.classList.add('lichsoma-sidebar-resizing');
            document.body.classList.add('lichsoma-sidebar-resize-active');
            try {
                handle.setPointerCapture(ev.pointerId);
            } catch (_) { /* noop */ }

            ev.preventDefault();

            const onMove = (e) => {
                const delta = (startX - e.clientX) / scale;
                this._applyWidth(startWidth + delta);
            };

            const onUp = (e) => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                document.body.classList.remove('lichsoma-sidebar-resize-active');
                sidebar.classList.remove('lichsoma-sidebar-resizing');
                try {
                    handle.releasePointerCapture(e.pointerId);
                } catch (_) { /* noop */ }

                const computedNow = getComputedStyle(sidebar).getPropertyValue('--sidebar-width').trim();
                const w = parseFloat(computedNow);
                if (Number.isFinite(w)) this._persistWidth(w);
            };

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });

        handle.addEventListener('dblclick', () => {
            const w = this._getMinSidebarWidth();
            this._applyWidth(w);
            this._persistWidth(w);
        });
    }

    /**
     * 채팅 입력 높이 드래그 핸들 설치.
     * 탭 전환 직후에는 #chat-message DOM이 아직 없을 수 있어 짧게 재시도한다.
     */
    static _installEditorHeightHandle() {
        this._installEditorHeightHandleAttempt(0);
    }

    static _installEditorHeightHandleAttempt(attempt) {
        const maxAttempts = 20;
        const delayMs = 50;

        const editorContainer = document.querySelector('#sidebar #chat-message > .editor-container');
        if (!editorContainer) {
            if (attempt < maxAttempts) {
                setTimeout(() => this._installEditorHeightHandleAttempt(attempt + 1), delayMs);
            }
            return;
        }

        const sidebar = document.querySelector('#sidebar');
        if (!sidebar) return;

        // 탭 전환 등으로 DOM이 바뀌면 핸들이 옛 부모에 남을 수 있음 — 현재 컨테이너가 아니면 제거
        for (const h of sidebar.querySelectorAll('.lichsoma-editor-height-handle')) {
            if (h.parentElement !== editorContainer) {
                h.remove();
            }
        }

        if (editorContainer.querySelector(':scope > .lichsoma-editor-height-handle')) return;

        const handle = document.createElement('div');
        handle.className = 'lichsoma-editor-height-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'horizontal');
        handle.setAttribute('aria-label', '채팅 입력 높이 조절');
        handle.title = '채팅 입력 높이 조절 (드래그). 더블클릭 시 기본 높이로 초기화.';
        editorContainer.prepend(handle);

        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;

            const startY = ev.clientY;
            const computed = getComputedStyle(sidebar).getPropertyValue('--chat-input-height').trim();
            const parsed = parseFloat(computed);
            const startHeight = Number.isFinite(parsed) ? parsed : DEFAULT_CHAT_INPUT_HEIGHT;
            const scale = this._getUiScale();

            sidebar.classList.add('lichsoma-chat-input-resizing');
            document.body.classList.add('lichsoma-sidebar-resize-active');
            try {
                handle.setPointerCapture(ev.pointerId);
            } catch (_) { /* noop */ }

            ev.preventDefault();
            ev.stopPropagation();

            const onMove = (e) => {
                const delta = (startY - e.clientY) / scale;
                this._applyChatInputHeight(startHeight + delta);
            };

            const onUp = (e) => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                document.body.classList.remove('lichsoma-sidebar-resize-active');
                sidebar.classList.remove('lichsoma-chat-input-resizing');
                try {
                    handle.releasePointerCapture(e.pointerId);
                } catch (_) { /* noop */ }

                const computedNow = getComputedStyle(sidebar).getPropertyValue('--chat-input-height').trim();
                const h = parseFloat(computedNow);
                if (Number.isFinite(h)) this._persistChatInputHeight(h);
            };

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });

        handle.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this._applyChatInputHeight(DEFAULT_CHAT_INPUT_HEIGHT);
            this._persistChatInputHeight(DEFAULT_CHAT_INPUT_HEIGHT);
        });
    }
}

Hooks.once('init', () => {
    ChatSidebarResizer.init();
});
