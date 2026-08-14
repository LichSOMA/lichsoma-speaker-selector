/**
 * LichSOMA Chat DOM Helper
 *
 * Foundry VTT v14 채팅 UI DOM 탐색을 한 곳에 모으기 위한 독립 헬퍼.
 *
 * - 이 파일은 다른 모듈을 import하지 않는다.
 * - 반환값은 기본적으로 HTMLElement 또는 null이다.
 * - jQuery 객체가 들어와도 첫 번째 HTMLElement로 정규화한다.
 * - Foundry의 세부 클래스(.plain, .theme-light 등)에 강하게 의존하지 않는다.
 */

export class LichsomaChatDom {
    /**
     * HTMLElement / jQuery-like / Document / Application element 등을 HTMLElement 또는 Document로 정규화.
     * @param {any} value
     * @returns {Document|HTMLElement|null}
     */
    static asElement(value) {
        if (!value) return null;
        if (value === document) return document;
        if (value instanceof HTMLElement) return value;
        if (value instanceof Document) return value;
        if (value.jquery && value[0]) return value[0];
        if (Array.isArray(value) && value[0] instanceof HTMLElement) return value[0];
        if (value.element instanceof HTMLElement) return value.element;
        if (value.element?.jquery && value.element[0]) return value.element[0];
        return null;
    }

    /**
     * querySelector 안전 래퍼.
     * @param {string} selector
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static query(selector, root = document) {
        const el = this.asElement(root) || document;
        return el.querySelector?.(selector) ?? null;
    }

    /**
     * querySelectorAll 안전 래퍼.
     * @param {string} selector
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement[]}
     */
    static queryAll(selector, root = document) {
        const el = this.asElement(root) || document;
        return Array.from(el.querySelectorAll?.(selector) ?? []);
    }

    /**
     * 여러 selector를 순서대로 시도.
     * @param {string[]} selectors
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static first(selectors, root = document) {
        for (const selector of selectors) {
            const found = this.query(selector, root);
            if (found) return found;
        }
        return null;
    }

    /**
     * Foundry 사이드바.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getSidebar(root = document) {
        return this.first([
            '#sidebar',
            'aside#sidebar',
            '[data-application-id="sidebar"]'
        ], root);
    }

    /**
     * Foundry 사이드바 콘텐츠 영역.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getSidebarContent(root = document) {
        return this.first([
            '#sidebar-content',
            '#sidebar #sidebar-content',
            '[data-application-id="sidebar"] #sidebar-content'
        ], root);
    }

    /**
     * 채팅 탭/섹션.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatSection(root = document) {
        return this.first([
            'section#chat',
            '#chat.chat-sidebar',
            '#chat',
            '[data-tab="chat"]',
            '.chat-sidebar'
        ], root);
    }

    /**
     * 채팅 스크롤 컨테이너.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatScroll(root = document) {
        return this.first([
            '#chat .chat-scroll',
            'section#chat .chat-scroll',
            '.chat-sidebar .chat-scroll',
            '.chat-scroll'
        ], root);
    }

    /**
     * 채팅 로그 ol.
     * .plain / .theme-light 같은 테마성 클래스에는 의존하지 않는다.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatLog(root = document) {
        return this.first([
            'ol.chat-log',
            '.chat-log'
        ], root);
    }

    /**
     * 일반 채팅 로그 우선 탐색.
     * 알림 영역(#chat-notifications)의 로그는 제외한다.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getMainChatLog(root = document) {
        const logs = this.queryAll('ol.chat-log, .chat-log', root);
        return logs.find(log => !this.isInChatNotifications(log)) ?? null;
    }

    /**
     * 채팅 입력 form.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLFormElement|null}
     */
    static getChatForm(root = document) {
        return this.first([
            '#sidebar .chat-form',
            'section#chat .chat-form',
            '#chat.chat-sidebar .chat-form',
            '#chat .chat-form',
            'form.chat-form',
            '.chat-form'
        ], root);
    }

    /**
     * 사이드바 안의 채팅 입력 form.
     * 팝아웃이나 알림 영역의 form을 피하고 싶을 때 사용.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLFormElement|null}
     */
    static getSidebarChatForm(root = document) {
        return this.first([
            '#sidebar .chat-form',
            '#sidebar form.chat-form',
            '[data-application-id="sidebar"] .chat-form'
        ], root);
    }

    /**
     * 채팅 컨트롤 영역.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatControls(root = document) {
        return this.first([
            '#chat-controls',
            '.chat-form #chat-controls'
        ], root);
    }

    /**
     * 채팅 컨트롤 버튼 그룹.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatControlButtons(root = document) {
        return this.first([
            '#chat-controls .control-buttons',
            '.chat-form #chat-controls .control-buttons',
            '#chat-controls'
        ], root);
    }

    /**
     * FVTT v14 채팅 입력 ProseMirror custom element.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatInput(root = document) {
        return this.first([
            '#chat-message',
            'prose-mirror#chat-message',
            'prose-mirror[name="message"]',
            '.chat-form prose-mirror[name="message"]',
            '.chat-form .chat-input'
        ], root);
    }

    /**
     * ProseMirror 편집 가능한 실제 루트.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getProseMirrorRoot(root = document) {
        return this.first([
            '#chat-message .ProseMirror',
            'prose-mirror[name="message"] .ProseMirror',
            '.chat-form .ProseMirror'
        ], root);
    }

    /**
     * 채팅 입력 editor-container.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatEditorContainer(root = document) {
        return this.first([
            '#chat-message .editor-container',
            'prose-mirror#chat-message .editor-container',
            'prose-mirror[name="message"] .editor-container',
            '.chat-form .editor-container',
            // FVTT v13 also uses a ProseMirror-like chat input, but may not expose an inner editor-container.
            // In that case, use the chat input custom element itself as the resize target.
            '#chat-message',
            'prose-mirror#chat-message',
            'prose-mirror[name="message"]',
            '.chat-form prose-mirror[name="message"]',
            '.chat-form .chat-input'
        ], root);
    }

    /**
     * 채팅 입력 menu-container.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static getChatEditorMenuContainer(root = document) {
        return this.first([
            '#chat-message .menu-container',
            'prose-mirror#chat-message .menu-container',
            'prose-mirror[name="message"] .menu-container',
            '.chat-form .menu-container'
        ], root);
    }

    /**
     * 요소가 채팅 알림 영역 안에 있는지 확인.
     * @param {HTMLElement|any} element
     * @returns {boolean}
     */
    static isInChatNotifications(element) {
        const el = this.asElement(element);
        return !!el?.closest?.('#chat-notifications');
    }

    /**
     * 요소가 일반 채팅 로그 안에 있는지 확인.
     * @param {HTMLElement|any} element
     * @returns {boolean}
     */
    static isInMainChatLog(element) {
        const el = this.asElement(element);
        if (!el || this.isInChatNotifications(el)) return false;
        return !!el.closest?.('ol.chat-log, .chat-log');
    }

    /**
     * 메시지 li 요소 찾기.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getChatMessageElement(element) {
        const el = this.asElement(element);
        if (!el) return null;
        if (el.matches?.('.chat-message')) return el;
        return el.closest?.('.chat-message') ?? null;
    }

    /**
     * 메시지 ID 가져오기.
     * @param {HTMLElement|any} element
     * @returns {string|null}
     */
    static getMessageId(element) {
        const msg = this.getChatMessageElement(element);
        return msg?.dataset?.messageId || msg?.getAttribute?.('data-message-id') || null;
    }

    /**
     * message id로 렌더링된 메시지 요소 찾기.
     * @param {string} messageId
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement|null}
     */
    static findRenderedMessageById(messageId, root = document) {
        if (!messageId) return null;
        const safeId = CSS?.escape ? CSS.escape(messageId) : String(messageId).replace(/"/g, '\\"');
        return this.query(`.chat-message[data-message-id="${safeId}"]`, root);
    }

    /**
     * 렌더링된 모든 채팅 메시지.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLElement[]}
     */
    static findRenderedMessages(root = document) {
        return this.queryAll('.chat-message[data-message-id]', root)
            .filter(el => !this.isInChatNotifications(el));
    }

    /**
     * 메시지의 content 영역.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getMessageContent(element) {
        const msg = this.getChatMessageElement(element);
        return msg?.querySelector?.('.message-content') ?? null;
    }

    /**
     * 메시지 header 영역.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getMessageHeader(element) {
        const msg = this.getChatMessageElement(element);
        return msg?.querySelector?.('.message-header') ?? null;
    }

    /**
     * 메시지 sender 요소.
     * 모듈 커스텀 sender를 우선한다.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getMessageSender(element) {
        const msg = this.getChatMessageElement(element);
        if (!msg) return null;
        return msg.querySelector('.message-sender[data-lichsoma-sender="true"]')
            ?? msg.querySelector('.message-sender');
    }

    /**
     * 메시지가 속한 chat-log.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getChatLogForMessage(element) {
        const msg = this.getChatMessageElement(element);
        return msg?.closest?.('ol.chat-log, .chat-log') ?? null;
    }

    /**
     * 바로 이전 채팅 메시지 요소.
     * 알림 영역은 제외하고, 일반 메시지만 찾는다.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getPreviousChatMessageElement(element) {
        const msg = this.getChatMessageElement(element);
        if (!msg) return null;

        let prev = msg.previousElementSibling;
        while (prev) {
            if (prev.matches?.('.chat-message') && !this.isInChatNotifications(prev)) return prev;
            prev = prev.previousElementSibling;
        }

        return null;
    }

    /**
     * 바로 다음 채팅 메시지 요소.
     * 알림 영역은 제외하고, 일반 메시지만 찾는다.
     * @param {HTMLElement|any} element
     * @returns {HTMLElement|null}
     */
    static getNextChatMessageElement(element) {
        const msg = this.getChatMessageElement(element);
        if (!msg) return null;

        let next = msg.nextElementSibling;
        while (next) {
            if (next.matches?.('.chat-message') && !this.isInChatNotifications(next)) return next;
            next = next.nextElementSibling;
        }

        return null;
    }

    /**
     * 메시지 content 안에 narrator-card가 있는지 확인.
     * 문자열 검색 대신 DOM query를 사용한다.
     * @param {HTMLElement|any} element
     * @returns {boolean}
     */
    static hasNarratorCard(element) {
        const content = this.getMessageContent(element);
        return !!content?.querySelector?.('.narrator-card');
    }

    /**
     * 메시지 content가 <hr> 전용인지 확인.
     * ChatMerge와 Export에서 함께 쓸 수 있는 DOM 기반 판정.
     * @param {HTMLElement|any} element
     * @returns {boolean}
     */
    static isOnlyHrMessage(element) {
        const content = this.getMessageContent(element);
        if (!content) return false;

        const clone = content.cloneNode(true);
        clone.querySelectorAll('hr').forEach(hr => hr.remove());

        const hasNonTextContent = !!clone.querySelector(
            'img, video, audio, iframe, embed, object, canvas, picture, svg, source'
        );
        if (hasNonTextContent) return false;

        const textOnly = (clone.textContent || '').replace(/\s+/g, '');
        return textOnly === '';
    }

    /**
     * chat-form 안의 Jump to Bottom 버튼.
     * @param {Document|HTMLElement|any} [root=document]
     * @returns {HTMLButtonElement|null}
     */
    static getJumpToBottomButton(root = document) {
        return this.first([
            '.chat-form > button.jump-to-bottom[data-action="jumpToBottom"]',
            'button.jump-to-bottom[data-action="jumpToBottom"]',
            'button[data-action="jumpToBottom"]'
        ], root);
    }

    /**
     * 요소가 채팅 입력 form 내부에 있는지 확인.
     * @param {HTMLElement|any} element
     * @returns {boolean}
     */
    static isInChatForm(element) {
        const el = this.asElement(element);
        return !!el?.closest?.('.chat-form');
    }
}
