/**
 * LichSOMA Chat Merge
 * 채팅 메시지 머지 기능 (같은 유저, 같은 포트레잇, 같은 화자 키일 때 헤더 숨김)
 */

import { ChatSystemBridge } from './lichsoma-chat-system-registry.js';
import { LichsomaChatDom } from './lichsoma-chat-dom.js';

export class ChatMerge {
    static SETTING_KEY = 'enableChatMerge';

    static initialize() {
        // 새 메시지가 렌더링될 때 머지 처리
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            const messageElement = LichsomaChatDom.getChatMessageElement(html);

            setTimeout(() => {
                this._checkAndMergeMessage(message, messageElement);
            }, 0);
        });

        // 채팅 로그가 렌더링될 때 모든 메시지 처리
        Hooks.on('renderChatLog', (app, html, data) => {
            setTimeout(() => {
                this._processAllMessages(html);
            }, 0);
        });

        // 메시지 삭제 후 다음 메시지의 머지 조건 재확인
        Hooks.on('deleteChatMessage', (message, options, userId) => {
            this._scheduleRecheckAfterDelete(message);
        });
    }

    static _isMergeEnabled() {
        try {
            return game.settings.get('lichsoma-speaker-selector', ChatMerge.SETTING_KEY) === true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 삭제된 메시지의 바로 다음 메시지를 재검사.
     * DOM 직접 querySelector 대신 LichsomaChatDom helper를 사용한다.
     */
    static _scheduleRecheckAfterDelete(message) {
        const deletedTimestamp = message.timestamp ?? 0;
        const nextMessage = game.messages.contents
            .filter(m => (m.timestamp ?? 0) > deletedTimestamp)
            .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];

        if (!nextMessage) return;

        const nextMessageId = nextMessage.id;
        const deletedMessageId = message.id;

        const checkAndUpdate = (attempt = 0) => {
            const maxAttempts = 10;

            const deletedElement = LichsomaChatDom.findRenderedMessageById(deletedMessageId);
            if (deletedElement && attempt < maxAttempts) {
                setTimeout(() => checkAndUpdate(attempt + 1), 100);
                return;
            }

            const nextMsg = game.messages.get(nextMessageId);
            if (!nextMsg) return;

            const nextMessageElement = LichsomaChatDom.findRenderedMessageById(nextMessageId);
            if (!nextMessageElement) return;

            this._checkAndMergeMessage(nextMsg, nextMessageElement);
        };

        setTimeout(() => checkAndUpdate(0), 100);
    }

    /**
     * 메시지 컨텐츠가 <hr> 뿐인지 확인
     */
    static _isOnlyHrMessage(messageElement) {
        return LichsomaChatDom.isOnlyHrMessage(messageElement);
    }

    /**
     * 메신저 메시지인지 확인 (lichsoma-fvtt-smartphone 모듈)
     */
    static _isMessengerMessage(message) {
        const flags = message?.flags?.['lichsoma-fvtt-smartphone'];
        return flags && flags.type === 'messenger-message';
    }

    /**
     * narrator-card 포함 여부.
     * 기존 문자열 검색 대신 DOM query를 사용한다.
     */
    static _hasNarratorCard(messageElement) {
        return LichsomaChatDom.hasNarratorCard(messageElement);
    }

    /**
     * DOM 요소에서 ChatMessage 문서 찾기.
     */
    static _getMessageFromElement(messageElement) {
        const messageId = LichsomaChatDom.getMessageId(messageElement);
        if (!messageId) return null;
        return game.messages.get(messageId) || null;
    }

    /**
     * root 자신이 chat-log인 경우까지 포함해서 채팅 로그를 찾는다.
     */
    static _getChatLogFromRoot(root) {
        const el = LichsomaChatDom.asElement(root);

        if (el && el !== document && el.matches?.('ol.chat-log, .chat-log')) {
            return LichsomaChatDom.isInChatNotifications(el) ? null : el;
        }

        return LichsomaChatDom.getMainChatLog(el || document);
    }

    /**
     * 머지 비교용 메타데이터.
     */
    static _getMergeMeta(message) {
        const flags = message?.flags?.['lichsoma-speaker-selector'] || {};
        const speaker = message?.speaker || {};

        const userId = flags.userId || message?.author?.id || null;
        const portraitSrc = flags.portraitSrc || null;

        let mergeSpeakerId =
            flags.mergeSpeakerId ||
            flags.actorId ||
            speaker.actor ||
            null;

        let mergeSpeakerType = flags.mergeSpeakerType || null;

        // FVTT v14 기본 "Public as User" 메시지는 actor/token speaker가 없을 수 있다.
        // 이 경우 같은 사용자 + 같은 포트레잇이면 머지될 수 있도록 user 기준 화자 키로 fallback한다.
        if (!mergeSpeakerId && userId) {
            mergeSpeakerId = userId;
            mergeSpeakerType = 'user';
        }

        if (!mergeSpeakerType) {
            // 구버전 플래그 fallback.
            // tokenId와 mergeSpeakerId가 일치하거나 speaker.token과 일치하면 token으로 간주.
            if (
                (flags.tokenId && mergeSpeakerId === flags.tokenId) ||
                (speaker.token && mergeSpeakerId === speaker.token)
            ) {
                mergeSpeakerType = 'token';
            } else {
                mergeSpeakerType = 'actor';
            }
        }

        return {
            userId,
            portraitSrc,
            mergeSpeakerId,
            mergeSpeakerType,
            message
        };
    }

    static _isValidMergeMeta(meta) {
        return !!(
            meta &&
            meta.userId &&
            meta.portraitSrc &&
            meta.mergeSpeakerId &&
            meta.mergeSpeakerType
        );
    }

    /**
     * 두 메타데이터가 머지 가능한지 확인.
     */
    static _canMerge(currentMeta, prevMeta) {
        if (!this._isValidMergeMeta(currentMeta) || !this._isValidMergeMeta(prevMeta)) return false;

        return currentMeta.userId === prevMeta.userId &&
            currentMeta.portraitSrc === prevMeta.portraitSrc &&
            currentMeta.mergeSpeakerType === prevMeta.mergeSpeakerType &&
            currentMeta.mergeSpeakerId === prevMeta.mergeSpeakerId;
    }

    /**
     * 머지 체인을 끊는 메시지인지 확인하고 관련 클래스를 정리한다.
     *
     * @param {ChatMessage} message
     * @param {HTMLElement} messageElement
     * @param {'current'|'previous'} role
     * @returns {boolean}
     */
    static _isMergeBreaker(message, messageElement, role = 'current') {
        if (!message || !messageElement) return true;

        if (LichsomaChatDom.isInChatNotifications(messageElement)) {
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }

        if (!LichsomaChatDom.getChatLogForMessage(messageElement)) {
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }

        const isOnlyHr = this._isOnlyHrMessage(messageElement);
        if (isOnlyHr) {
            messageElement.classList.add('lichsoma-hr-only');
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }
        messageElement.classList.remove('lichsoma-hr-only');

        const hasNarratorCard = this._hasNarratorCard(messageElement);
        if (hasNarratorCard) {
            messageElement.classList.add('lichsoma-narrator-card');
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }
        messageElement.classList.remove('lichsoma-narrator-card');

        if (this._isMessengerMessage(message)) {
            messageElement.classList.add('lichsoma-messenger-message');
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }
        messageElement.classList.remove('lichsoma-messenger-message');

        const excludedBySystem = role === 'previous'
            ? ChatSystemBridge.merge.excludePrevious(message, messageElement)
            : ChatSystemBridge.merge.excludeCurrent(message, messageElement);

        if (excludedBySystem) {
            messageElement.classList.remove('lichsoma-merged');
            return true;
        }

        return false;
    }

    /**
     * 단일 메시지에 대해 머지 체크 및 적용.
     */
    static _checkAndMergeMessage(message, html) {
        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement || !message) return;

        if (!this._isMergeEnabled()) {
            messageElement.classList.remove('lichsoma-merged');
            return;
        }

        if (this._isMergeBreaker(message, messageElement, 'current')) return;

        const prevMessageElement = LichsomaChatDom.getPreviousChatMessageElement(messageElement);
        if (!prevMessageElement) {
            messageElement.classList.remove('lichsoma-merged');
            return;
        }

        const prevMessage = this._getMessageFromElement(prevMessageElement);
        if (!prevMessage) {
            messageElement.classList.remove('lichsoma-merged');
            return;
        }

        if (this._isMergeBreaker(prevMessage, prevMessageElement, 'previous')) {
            messageElement.classList.remove('lichsoma-merged');
            return;
        }

        const currentMeta = this._getMergeMeta(message);
        const prevMeta = this._getMergeMeta(prevMessage);
        const shouldMerge = this._canMerge(currentMeta, prevMeta);

        messageElement.classList.toggle('lichsoma-merged', shouldMerge);
    }

    /**
     * 채팅 로그의 모든 메시지에 대해 머지 처리.
     *
     * 기존의 테마/표시 클래스까지 포함한 과도한 채팅 로그 selector 의존을 제거하고,
     * `ol.chat-log, .chat-log` 기반으로 완화한다.
     */
    static _processAllMessages(html) {
        const chatLog = this._getChatLogFromRoot(html) || LichsomaChatDom.getMainChatLog(document);
        if (!chatLog) return;

        const allMessages = Array.from(chatLog.querySelectorAll('.chat-message[data-message-id]'))
            .filter(messageEl => !LichsomaChatDom.isInChatNotifications(messageEl));

        if (!this._isMergeEnabled()) {
            allMessages.forEach(messageEl => messageEl.classList.remove('lichsoma-merged'));
            return;
        }

        let prevMeta = null;

        allMessages.forEach((messageElement) => {
            const message = this._getMessageFromElement(messageElement);
            if (!message) {
                messageElement.classList.remove('lichsoma-merged');
                prevMeta = null;
                return;
            }

            if (this._isMergeBreaker(message, messageElement, 'current')) {
                prevMeta = null;
                return;
            }

            const currentMeta = this._getMergeMeta(message);
            const shouldMerge = this._canMerge(currentMeta, prevMeta);

            messageElement.classList.toggle('lichsoma-merged', shouldMerge);

            // 현재 메시지가 유효한 머지 기준을 가지는 경우에만 다음 메시지의 기준이 된다.
            prevMeta = this._isValidMergeMeta(currentMeta) ? currentMeta : null;
        });
    }
}
