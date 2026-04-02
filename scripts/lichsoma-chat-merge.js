/**
 * LichSOMA Chat Merge
 * 채팅 메시지 머지 기능 (같은 유저, 같은 포트레잇일 때 헤더 숨김)
 */

export class ChatMerge {
    static SETTING_KEY = 'enableChatMerge';
    
    static initialize() {
        // 새 메시지가 렌더링될 때 머지 처리 (딜레이 없이)
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            // html이 HTMLElement이므로 jQuery로 변환
            const $html = $(html);
            
            // 딜레이 없이 즉시 처리 (플래그에서 정보 가져오기)
            setTimeout(() => {
                this._checkAndMergeMessage(message, $html);
            }, 0);
        });
        
        // 채팅 로그가 렌더링될 때 모든 메시지 처리
        Hooks.on('renderChatLog', (app, html, data) => {
            setTimeout(() => {
                this._processAllMessages(html);
            }, 0);
        });
        
        // 메시지 삭제 후 다음 메시지의 머지 조건 재확인 (모든 클라이언트에서 동작)
        Hooks.on('deleteChatMessage', (message, options, userId) => {
            // 삭제된 메시지보다 나중 타임스탬프를 가진 메시지 중 가장 빠른 것 = 바로 다음 메시지
            const deletedTimestamp = message.timestamp ?? 0;
            const nextMessage = game.messages.contents
                .filter(m => (m.timestamp ?? 0) > deletedTimestamp)
                .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
            
            if (!nextMessage) return;
            
            const nextMessageId = nextMessage.id;
            const deletedMessageId = message.id;
            
            // 삭제된 메시지가 DOM에서 완전히 제거될 때까지 기다림
            const checkAndUpdate = (attempt = 0) => {
                const maxAttempts = 10; // 최대 10번 시도 (약 1000ms)
                
                // 삭제된 메시지가 DOM에 아직 남아있는지 확인
                const deletedElement = document.querySelector(`.chat-message[data-message-id="${deletedMessageId}"]`);
                if (deletedElement && attempt < maxAttempts) {
                    setTimeout(() => checkAndUpdate(attempt + 1), 100);
                    return;
                }
                
                // 삭제된 메시지가 제거되었거나 최대 시도 횟수에 도달했으면 진행
                const nextMsg = game.messages.get(nextMessageId);
                if (!nextMsg) return;
                
                // 다음 메시지의 DOM 요소 찾기
                const nextMessageElement = document.querySelector(`.chat-message[data-message-id="${nextMessageId}"]`);
                if (!nextMessageElement) return;
                
                // 다음 메시지에 대해 머지 체크 재실행
                this._checkAndMergeMessage(nextMsg, $(nextMessageElement));
            };
            
            // 첫 번째 시도 (10ms 후)
            setTimeout(() => checkAndUpdate(0), 100);
        });
    }
    
    /**
     * 메시지 컨텐츠가 <hr> 뿐인지 확인
     */
    static _isOnlyHrMessage($messageElement) {
        const messageContent = $messageElement.find('.message-content');
        if (!messageContent.length) return false;
        
        // HTML 내용 가져오기
        const htmlContent = messageContent.html() || '';
        // 공백, 줄바꿈, 탭 제거
        const cleanContent = htmlContent.replace(/\s+/g, '').toLowerCase();
        
        // <hr> 태그만 있는지 확인 (<hr>, <hr/>, <hr /> 등 모든 변형)
        // 정규식으로 <hr 태그를 찾아서 제거하고, 남은 내용이 없으면 <hr>만 있는 것
        const hrPattern = /<hr\s*\/?>/gi;
        const withoutHr = cleanContent.replace(hrPattern, '');
        
        return withoutHr === '';
    }
    
    /**
     * 메신저 메시지인지 확인 (lichsoma-fvtt-smartphone 모듈)
     */
    static _isMessengerMessage(message) {
        const flags = message.flags?.['lichsoma-fvtt-smartphone'];
        return flags && flags.type === 'messenger-message';
    }
    
    /**
     * 단일 메시지에 대해 머지 체크 및 적용 (플래그 기반)
     */
    static _checkAndMergeMessage(message, $html) {
        // .chat-message 요소 찾기
        const messageElement = $html.closest('.chat-message');
        if (!messageElement.length) return;
        
        // <hr> 뿐인 메시지 처리
        const isOnlyHr = this._isOnlyHrMessage(messageElement);
        if (isOnlyHr) {
            messageElement.addClass('lichsoma-hr-only');
            messageElement.removeClass('lichsoma-merged');
            return;
        } else {
            messageElement.removeClass('lichsoma-hr-only');
        }
        
        // narrator-card가 포함된 메시지 처리
        const messageContent = messageElement.find('.message-content');
        if (messageContent.length) {
            const htmlContent = messageContent.html() || '';
            if (htmlContent.includes('narrator-card')) {
                messageElement.addClass('lichsoma-narrator-card');
                messageElement.removeClass('lichsoma-merged');
                return;
            } else {
                messageElement.removeClass('lichsoma-narrator-card');
            }
        }
        
        // 메신저 메시지 처리 (lichsoma-fvtt-smartphone 모듈)
        if (this._isMessengerMessage(message)) {
            messageElement.addClass('lichsoma-messenger-message');
            messageElement.removeClass('lichsoma-merged');
            return;
        } else {
            messageElement.removeClass('lichsoma-messenger-message');
        }
        
        // 머지 기능이 비활성화되어 있으면 모든 머지 클래스 제거
        const enableChatMerge = game.settings.get('lichsoma-speaker-selector', ChatMerge.SETTING_KEY);
        if (!enableChatMerge) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // #chat-notifications 내부가 아닌 일반 채팅 영역에서만 처리
        if (messageElement.closest('#chat-notifications').length > 0) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 지정된 스코프 내부에서만 머지 처리
        const $scope = messageElement.closest('.chat-scroll .chat-log.plain.theme-light');
        if (!$scope.length) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 플래그에서 정보 가져오기
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};
        const currentUserId = flags.userId || message.author?.id;
        const currentPortraitSrc = flags.portraitSrc || null;
        const currentActorId = flags.actorId || message.speaker?.actor || null;
        
        // userId나 portraitSrc가 없으면 머지 불가
        if (!currentUserId || !currentPortraitSrc) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 이전 메시지 찾기 (DX3rd 방식: prev() 사용)
        const prevMessageElement = messageElement.prev('.chat-message');
        if (!prevMessageElement.length) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 이전 메시지의 message 객체 찾기
        const prevMessageId = prevMessageElement.attr('data-message-id');
        if (!prevMessageId) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        const prevMessage = game.messages.get(prevMessageId);
        if (!prevMessage) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 이전 메시지의 플래그에서 정보 가져오기
        const prevFlags = prevMessage.flags?.['lichsoma-speaker-selector'] || {};
        const prevUserId = prevFlags.userId || prevMessage.author?.id;
        const prevPortraitSrc = prevFlags.portraitSrc || null;
        const prevActorId = prevFlags.actorId || prevMessage.speaker?.actor || null;
        
        // <hr> 뿐인 메시지와는 머지하지 않음
        const prevIsOnlyHr = this._isOnlyHrMessage(prevMessageElement);
        if (prevIsOnlyHr) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 이전 메시지에 narrator-card가 포함되어 있으면 머지하지 않음
        const prevMessageContent = prevMessageElement.find('.message-content');
        if (prevMessageContent.length) {
            const prevHtmlContent = prevMessageContent.html() || '';
            if (prevHtmlContent.includes('narrator-card')) {
                messageElement.removeClass('lichsoma-merged');
                return;
            }
        }
        
        // 이전 메시지가 메신저 메시지이면 머지하지 않음
        if (this._isMessengerMessage(prevMessage)) {
            messageElement.removeClass('lichsoma-merged');
            return;
        }
        
        // 머지 조건 확인: userId, portraitSrc, actorId가 모두 일치하고, <hr> 뿐인 메시지가 아니어야 함
        const shouldMerge = (currentUserId === prevUserId) && 
                           (currentPortraitSrc === prevPortraitSrc) && 
                           (currentActorId === prevActorId) &&
                           (currentPortraitSrc !== null) &&
                           !isOnlyHr;
        
        if (shouldMerge) {
            messageElement.addClass('lichsoma-merged');
        } else {
            messageElement.removeClass('lichsoma-merged');
        }
    }
    
    /**
     * 채팅 로그의 모든 메시지에 대해 머지 처리 (플래그 기반)
     */
    static _processAllMessages(html) {
        const $html = $(html);
        const chatLog = $html.find('.chat-scroll .chat-log.plain.theme-light');
        
        if (!chatLog.length) return;
        
        // 머지 기능이 비활성화되어 있으면 모든 머지 클래스 제거
        const enableChatMerge = game.settings.get('lichsoma-speaker-selector', ChatMerge.SETTING_KEY);
        if (!enableChatMerge) {
            chatLog.find('.chat-message').removeClass('lichsoma-merged');
            return;
        }
        
        const allMessages = chatLog.find('.chat-message').toArray();
        let prevMeta = null;
        
        // 각 메시지에 대해 이전 메시지와 비교
        allMessages.forEach((messageEl) => {
            const $currentMessage = $(messageEl);
            
            // #chat-notifications 내부 메시지는 제외
            if ($currentMessage.closest('#chat-notifications').length > 0) {
                $currentMessage.removeClass('lichsoma-merged');
                return;
            }
            
            const messageId = $currentMessage.attr('data-message-id');
            if (!messageId) {
                $currentMessage.removeClass('lichsoma-merged');
                return;
            }
            
            const message = game.messages.get(messageId);
            if (!message) {
                $currentMessage.removeClass('lichsoma-merged');
                return;
            }
            
            // 플래그에서 정보 가져오기
            const flags = message.flags?.['lichsoma-speaker-selector'] || {};
            const currentUserId = flags.userId || message.author?.id;
            const currentPortraitSrc = flags.portraitSrc || null;
            const currentActorId = flags.actorId || message.speaker?.actor || null;
            
            // <hr> 뿐인 메시지 처리
            const isOnlyHr = this._isOnlyHrMessage($currentMessage);
            if (isOnlyHr) {
                $currentMessage.addClass('lichsoma-hr-only');
                $currentMessage.removeClass('lichsoma-merged');
                // <hr> 뿐인 메시지는 prevMeta를 업데이트하지 않음 (다음 메시지와 머지되지 않도록)
                return;
            } else {
                $currentMessage.removeClass('lichsoma-hr-only');
            }
            
            // narrator-card가 포함된 메시지 처리
            const messageContent = $currentMessage.find('.message-content');
            if (messageContent.length) {
                const htmlContent = messageContent.html() || '';
                if (htmlContent.includes('narrator-card')) {
                    $currentMessage.addClass('lichsoma-narrator-card');
                    $currentMessage.removeClass('lichsoma-merged');
                    // narrator-card 메시지는 prevMeta를 null로 설정하여 다음 메시지와 머지되지 않도록 함
                    prevMeta = null;
                    return;
                } else {
                    $currentMessage.removeClass('lichsoma-narrator-card');
                }
            }
            
            // 메신저 메시지 처리 (lichsoma-fvtt-smartphone 모듈)
            if (this._isMessengerMessage(message)) {
                $currentMessage.addClass('lichsoma-messenger-message');
                $currentMessage.removeClass('lichsoma-merged');
                // 메신저 메시지는 prevMeta를 null로 설정하여 다음 메시지와 머지되지 않도록 함
                prevMeta = null;
                return;
            } else {
                $currentMessage.removeClass('lichsoma-messenger-message');
            }
            
            // 이전 메시지가 <hr> 뿐인지 확인
            let prevIsOnlyHr = false;
            if (prevMeta && prevMeta.messageElement) {
                prevIsOnlyHr = this._isOnlyHrMessage(prevMeta.messageElement);
            }
            
            // 이전 메시지에 narrator-card가 있는지 확인
            let prevHasNarratorCard = false;
            if (prevMeta && prevMeta.messageElement) {
                const prevMessageContent = prevMeta.messageElement.find('.message-content');
                if (prevMessageContent.length) {
                    const prevHtmlContent = prevMessageContent.html() || '';
                    prevHasNarratorCard = prevHtmlContent.includes('narrator-card');
                }
            }
            
            // 이전 메시지가 메신저 메시지인지 확인
            let prevIsMessengerMessage = false;
            if (prevMeta && prevMeta.message) {
                prevIsMessengerMessage = this._isMessengerMessage(prevMeta.message);
            }
            
            // 머지 조건 확인: userId, portraitSrc, actorId가 모두 일치하고, <hr> 뿐인 메시지가 아니어야 함, narrator-card가 없어야 함, 메신저 메시지가 아니어야 함
            if (prevMeta && 
                prevMeta.userId === currentUserId && 
                prevMeta.portraitSrc === currentPortraitSrc &&
                prevMeta.actorId === currentActorId &&
                currentPortraitSrc !== null &&
                !isOnlyHr &&
                !prevIsOnlyHr &&
                !prevHasNarratorCard &&
                !prevIsMessengerMessage) {
                $currentMessage.addClass('lichsoma-merged');
            } else {
                $currentMessage.removeClass('lichsoma-merged');
                prevMeta = { 
                    userId: currentUserId, 
                    portraitSrc: currentPortraitSrc, 
                    actorId: currentActorId,
                    messageElement: $currentMessage,
                    message: message
                };
            }
        });
    }
}
