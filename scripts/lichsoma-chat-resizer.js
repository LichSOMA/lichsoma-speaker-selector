/**
 * LichSOMA Chat Resizer — 사이드바 너비·채팅 입력(--chat-input-height) 드래그 조절
 */

import { LichsomaChatDom } from './lichsoma-chat-dom.js';

const MODULE_ID = 'lichsoma-speaker-selector';
const SETTING_KEY_WIDTH = 'sidebarWidthPx';
const SETTING_KEY_MIN_WIDTH = 'sidebarMinWidthPx';
const SETTING_KEY_CHAT_HEIGHT = 'chatInputHeightPx';

const DEFAULT_MIN_WIDTH = 312;
const MAX_MIN_WIDTH = 400;
const DEFAULT_WIDTH = 312;

const MIN_CHAT_INPUT_HEIGHT = 128;
const FVTT13_MIN_CHAT_INPUT_HEIGHT = 128;
const DEFAULT_CHAT_INPUT_HEIGHT = 128;
const NOTIFICATION_CHAT_INPUT_HEIGHT = 128;

export class ChatSidebarResizer {
    static _resizeClampTimer = null;

    static _getSidebar() {
        return LichsomaChatDom.getSidebar();
    }

    static _getSidebarContent() {
        return LichsomaChatDom.getSidebarContent();
    }

    static _getEditorContainer() {
        const sidebar = this._getSidebar();
        return LichsomaChatDom.getChatEditorContainer(sidebar ?? document);
    }

    static _getChatForm() {
        const sidebar = this._getSidebar();
        return LichsomaChatDom.getSidebarChatForm(sidebar ?? document) ?? LichsomaChatDom.getChatForm(sidebar ?? document);
    }

    static _isFoundry13() {
        return this._getFoundryGeneration() <= 13;
    }

    static _getEditorHandleParent(editorContainer = null) {
        if (this._isFoundry13()) {
            return this._getChatForm() ?? editorContainer;
        }
        return editorContainer;
    }

    static _updateEditorHandlePosition(handle = null, editorContainer = null) {
        if (!this._isFoundry13()) return;
        const sidebar = this._getSidebar();
        const chatForm = this._getChatForm();
        const editor = editorContainer ?? this._getEditorContainer();
        const targetHandle = handle ?? sidebar?.querySelector?.('.lichsoma-editor-height-handle--form');
        if (!chatForm || !editor || !targetHandle) return;

        const formRect = chatForm.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const top = Math.max(0, editorRect.top - formRect.top);
        targetHandle.style.top = `${Math.round(top)}px`;
    }

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
            this._applyFoundryGenerationClass();
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
                return;
            }

            // FVTT v14: ChatLog input may be embedded in #chat-notifications.
            if (app?.constructor?.tabName === 'chat' || app?.tabName === 'chat') {
                setTimeout(() => this._applySavedChatInputHeight(), 0);
            }
        });

        Hooks.on('renderChatLog', () => {
            setTimeout(() => {
                this._applySavedChatInputHeight();
                this._installEditorHeightHandle();
            }, 0);
        });

        // FVTT v13.346+ / v14: chat input이 다른 DOM 부모로 re-parent된 직후 호출되는 공식 훅.
        // 이동된 실제 요소를 즉시 정규화해 sidebar 전용 inline layout이 notification tray로 새지 않게 한다.
        Hooks.on('renderChatInput', (app, elements, context) => {
            this._handleChatInputAdoption(elements, context);
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
            setTimeout(() => {
                this._applySavedChatInputHeight();
                this._installEditorHeightHandle();
            }, 0);
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

    static _getFoundryGeneration() {
        const generation = Number(game?.release?.generation);
        return Number.isFinite(generation) ? generation : 14;
    }

    static _applyFoundryGenerationClass() {
        const generation = this._getFoundryGeneration();
        document.body?.classList?.toggle?.('lichsoma-fvtt13-chat', generation <= 13);
        document.body?.classList?.toggle?.('lichsoma-fvtt14-chat', generation >= 14);
    }

    static _getMinChatInputHeight() {
        return this._getFoundryGeneration() <= 13 ? FVTT13_MIN_CHAT_INPUT_HEIGHT : MIN_CHAT_INPUT_HEIGHT;
    }

    static _getDefaultChatInputHeight() {
        return this._getFoundryGeneration() <= 13 ? FVTT13_MIN_CHAT_INPUT_HEIGHT : DEFAULT_CHAT_INPUT_HEIGHT;
    }

    static _clampChatInputHeight(px) {
        const min = this._getMinChatInputHeight();
        const max = Math.max(min, Math.floor(window.innerHeight / 3));
        return Math.round(Math.min(max, Math.max(min, px)));
    }

    static _applyWidth(px) {
        const sidebar = this._getSidebar();
        if (!sidebar) return;
        const w = this._clampWidth(px);
        sidebar.style.setProperty('--sidebar-width', `${w}px`);
    }

    static _applyChatInputHeight(px) {
        const sidebar = this._getSidebar();
        if (!sidebar) return;
        const h = this._clampChatInputHeight(px);
        const value = `${h}px`;
        sidebar.style.setProperty('--chat-input-height', value);

        // Notification tray의 128px 고정 높이는 tray 전용 CSS와 adoption 정규화에서 관리한다.
        // 일반 sidebar의 사용자 높이 값이 notification 레이아웃 변수로 전파되지 않도록 여기서는 건드리지 않는다.
        this._syncChatInputHeightToDom(h);
        this._updateEditorHandlePosition();
    }

    static _getChatInputSelector() {
        return ':is(#chat-message, prose-mirror#chat-message, prose-mirror[name="message"], .chat-input)';
    }

    static _getMovedElements(elements) {
        if (!elements || typeof elements !== 'object') return [];
        const moved = [];
        for (const value of Object.values(elements)) {
            if (value instanceof HTMLElement) moved.push(value);
            else if (Array.isArray(value)) moved.push(...value.filter(item => item instanceof HTMLElement));
        }
        return [...new Set(moved)];
    }

    static _findMovedElement(elements, selector) {
        for (const root of this._getMovedElements(elements)) {
            if (root.matches?.(selector)) return root;
            const nested = root.querySelector?.(selector);
            if (nested) return nested;
        }
        return null;
    }

    static _clearLegacyInlineOrder(input, controls = null) {
        // 과거 Speaker Selector가 chat-form 정렬을 위해 남기던 정확한 inline 값만 제거한다.
        // 다른 모듈이 별도 order 값을 사용한다면 건드리지 않는다.
        if (input?.style?.getPropertyValue('order')?.trim() === '3') {
            input.style.removeProperty('order');
        }
        if (controls?.style?.getPropertyValue('order')?.trim() === '0') {
            controls.style.removeProperty('order');
        }
    }

    static _applyManagedInnerEditorSizing(editor) {
        if (!editor) return;
        editor.dataset.lichsomaChatHeightManaged = 'true';
        editor.style.setProperty('height', '100%', 'important');
        editor.style.setProperty('min-height', '100%', 'important');
        editor.style.setProperty('max-height', '100%', 'important');
        editor.style.setProperty('overflow-y', 'auto', 'important');
        editor.style.setProperty('box-sizing', 'border-box', 'important');
    }

    static _clearManagedInnerEditorSizing(editor) {
        if (!editor || editor.dataset.lichsomaChatHeightManaged !== 'true') return;
        for (const property of ['height', 'min-height', 'max-height', 'overflow-y', 'box-sizing']) {
            editor.style.removeProperty(property);
        }
        delete editor.dataset.lichsomaChatHeightManaged;
    }

    static _applyNotificationInputSizing(input) {
        if (!input) return;
        const inputValue = `${NOTIFICATION_CHAT_INPUT_HEIGHT}px`;

        input.style.setProperty('height', inputValue, 'important');
        input.style.setProperty('min-height', inputValue, 'important');
        input.style.setProperty('max-height', inputValue, 'important');

        if (this._isFoundry13()) {
            // v13 notification의 chat-form은 flex 흐름을 유지하므로 입력 자체도 128px flex item으로 고정한다.
            input.style.setProperty('flex-basis', inputValue, 'important');
            input.style.setProperty('flex', `0 0 ${inputValue}`, 'important');
        } else {
            // v14 notification은 코어 CSS Grid가 배치를 소유한다. sidebar에서 따라온 flex 값은 제거한다.
            input.style.removeProperty('flex-basis');
            input.style.removeProperty('flex');
        }

        // 반복 수정 과정에서 추가됐던 notification 전용 transition override만 제거한다.
        if (input.style.getPropertyValue('transition-property')?.trim() === 'opacity') {
            input.style.removeProperty('transition-property');
        }
    }

    static _syncChatInputHeightToDom(px) {
        const sidebar = this._getSidebar();
        if (!sidebar) return;
        const h = this._clampChatInputHeight(px);
        const roots = [sidebar];
        const notifications = document.querySelector('#chat-notifications');
        if (notifications) roots.push(notifications);

        const inputSelector = this._getChatInputSelector();
        const inputs = [...new Set(roots.flatMap(root => LichsomaChatDom.queryAll(inputSelector, root)))];

        for (const input of inputs) {
            if (LichsomaChatDom.isInChatNotifications(input)) {
                this._applyNotificationInputSizing(input);
                const controls = LichsomaChatDom.getChatControls(input.closest('#chat-notifications'));
                this._clearLegacyInlineOrder(input, controls);
                continue;
            }

            const inputValue = `${h}px`;
            input.style.setProperty('height', inputValue, 'important');
            input.style.setProperty('min-height', inputValue, 'important');
            input.style.setProperty('flex-basis', inputValue, 'important');
            input.style.setProperty('flex', `0 0 ${inputValue}`, 'important');

            if (this._isFoundry13()) {
                input.style.setProperty('max-height', inputValue, 'important');
                input.style.setProperty('overflow', 'hidden', 'important');
                input.style.setProperty('box-sizing', 'border-box', 'important');
            } else {
                input.style.removeProperty('max-height');
                input.style.removeProperty('overflow');
                input.style.removeProperty('box-sizing');
                if (input.style.getPropertyValue('transition-property')?.trim() === 'opacity') {
                    input.style.removeProperty('transition-property');
                }
            }
        }

        const editorSelector = `${inputSelector} :is(.editor-container, .ProseMirror, [contenteditable="true"])`;
        const innerEditors = [...new Set(roots.flatMap(root => LichsomaChatDom.queryAll(editorSelector, root)))];
        for (const editor of innerEditors) {
            const inNotifications = LichsomaChatDom.isInChatNotifications(editor);
            if (inNotifications && !this._isFoundry13()) {
                // v14 notification에서는 ProseMirror 내부 geometry는 코어가 소유한다.
                // sidebar에서 이동해 온 우리 inline 100% sizing만 제거한다.
                this._clearManagedInnerEditorSizing(editor);
                continue;
            }
            this._applyManagedInnerEditorSizing(editor);
        }
    }

    static _handleChatInputAdoption(elements, context = null) {
        const inputSelector = this._getChatInputSelector();
        const movedInput = this._findMovedElement(elements, inputSelector);
        const movedControls = this._findMovedElement(elements, '#chat-controls');
        const notificationRoot = document.querySelector('#chat-notifications');
        const input = movedInput
            ?? LichsomaChatDom.getChatInput(notificationRoot)
            ?? LichsomaChatDom.getChatInput(this._getSidebar() ?? document);

        if (!input) return;

        const inNotifications = LichsomaChatDom.isInChatNotifications(input);
        const previousParent = LichsomaChatDom.asElement(context?.previousParent);
        const cameFromNotifications = previousParent?.id === 'chat-notifications'
            || LichsomaChatDom.isInChatNotifications(previousParent);
        const controls = movedControls
            ?? (inNotifications ? LichsomaChatDom.getChatControls(notificationRoot) : null);

        // Notification으로 들어가거나 빠져나오는 adoption에 한해서만 과거 inline order를 청소한다.
        // popout 등 다른 re-parent 경로의 layout은 건드리지 않는다.
        if (inNotifications || cameFromNotifications) {
            this._clearLegacyInlineOrder(input, controls);
        }

        if (inNotifications) {
            // 이 훅은 re-parent 직후 동기적으로 호출되므로, 다음 paint 전에 notification geometry를 확정한다.
            this._applyNotificationInputSizing(input);
            if (!this._isFoundry13()) {
                for (const editor of LichsomaChatDom.queryAll(
                    ':is(.editor-container, .ProseMirror, [contenteditable="true"])',
                    input
                )) {
                    this._clearManagedInnerEditorSizing(editor);
                }
            }
            notificationRoot?.querySelectorAll?.('.lichsoma-editor-height-handle')?.forEach?.(handle => handle.remove());
            return;
        }

        // notification에서 sidebar로 돌아온 경우에만 사용자 저장 높이와 리사이즈 핸들을 복원한다.
        if (input.closest?.('#sidebar')) {
            this._applySavedChatInputHeight();
            this._installEditorHeightHandle();
        }
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
            return;
        }
        this._applyChatInputHeight(this._getDefaultChatInputHeight());
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
        const content = this._getSidebarContent();
        if (!content || content.querySelector(':scope > .lichsoma-sidebar-resize-handle')) return;

        const handle = document.createElement('div');
        handle.className = 'lichsoma-sidebar-resize-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', game.i18n.localize('SPEAKERSELECTOR.Resizer.Sidebar.AriaLabel'));
        handle.title = game.i18n.localize('SPEAKERSELECTOR.Resizer.Sidebar.Title');
        content.prepend(handle);

        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            const sidebar = this._getSidebar();
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

        const editorContainer = this._getEditorContainer();
        if (!editorContainer) {
            if (attempt < maxAttempts) {
                setTimeout(() => this._installEditorHeightHandleAttempt(attempt + 1), delayMs);
            }
            return;
        }

        // Notification tray에서는 높이를 128px로 고정하므로 리사이즈 핸들을 두지 않는다.
        if (LichsomaChatDom.isInChatNotifications(editorContainer)) {
            const notifications = document.querySelector('#chat-notifications');
            notifications?.querySelectorAll?.('.lichsoma-editor-height-handle')?.forEach?.(h => h.remove());
            return;
        }

        const sidebar = this._getSidebar();
        if (!sidebar) return;

        const handleParent = this._getEditorHandleParent(editorContainer);
        if (!handleParent) return;
        if (this._isFoundry13()) {
            handleParent.classList.add('lichsoma-editor-height-handle-parent');
        }

        // 탭 전환 등으로 DOM이 바뀌면 핸들이 옛 부모에 남을 수 있음 — 현재 컨테이너가 아니면 제거
        for (const h of sidebar.querySelectorAll('.lichsoma-editor-height-handle')) {
            if (h.parentElement !== handleParent) {
                h.remove();
            }
        }

        if (handleParent.querySelector(':scope > .lichsoma-editor-height-handle')) {
            this._updateEditorHandlePosition(handleParent.querySelector(':scope > .lichsoma-editor-height-handle'), editorContainer);
            this._applySavedChatInputHeight();
            return;
        }

        const handle = document.createElement('div');
        handle.className = `lichsoma-editor-height-handle${this._isFoundry13() ? ' lichsoma-editor-height-handle--form' : ''}`;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'horizontal');
        handle.setAttribute('aria-label', game.i18n.localize('SPEAKERSELECTOR.Resizer.ChatInput.AriaLabel'));
        handle.title = game.i18n.localize('SPEAKERSELECTOR.Resizer.ChatInput.Title');
        handleParent.prepend(handle);
        this._updateEditorHandlePosition(handle, editorContainer);
        this._applySavedChatInputHeight();

        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;

            const startY = ev.clientY;
            const computed = getComputedStyle(sidebar).getPropertyValue('--chat-input-height').trim();
            const parsed = parseFloat(computed);
            const startHeight = Number.isFinite(parsed) ? parsed : this._getDefaultChatInputHeight();
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
            const defaultHeight = this._getDefaultChatInputHeight();
            this._applyChatInputHeight(defaultHeight);
            this._persistChatInputHeight(defaultHeight);
        });
    }
}

Hooks.once('init', () => {
    ChatSidebarResizer.init();
});
