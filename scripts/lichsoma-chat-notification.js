/**
 * LichSOMA Chat Notification
 * 채팅 입력 중 상태 표시 기능
 */

export class ChatNotification {
    // 입력 중인 사용자 상태 저장 (userId -> timestamp)
    static _typingUsers = new Map();
    
    // 타임아웃 관리 (userId -> timeoutId)
    static _typingTimeouts = new Map();
    
    // 자신의 입력 상태 플래그
    static _isTyping = false;
    
    // 자신의 입력 디바운스 타임아웃
    static _inputDebounceTimeout = null;
    
    // 입력 상태 갱신 인터벌 (다른 클라이언트의 타임아웃 갱신용)
    static _typingRefreshInterval = null;
    
    // UI 업데이트 디바운스 타임아웃
    static _updateUITimeout = null;
    
    // 인디케이터 요소
    static _indicatorElement = null;
    
    // 입력 필드 이벤트 핸들러 바인딩 (제거용)
    static _inputHandlers = {
        input: null,
        focus: null,
        blur: null
    };

    /**
     * 초기화
     */
    static initialize() {
        // Socket 리스너 설정
        this._setupSocketListener();
        
        // 채팅 입력 필드 리스너 설정
        this._setupChatInputListener();
        
        // 사용자 나감 감지
        this._setupUserDisconnectHandler();
    }

    /**
     * Socket 리스너 설정
     */
    static _setupSocketListener() {
        if (!game.socket) return;
        
        game.socket.on('module.lichsoma-speaker-selector', (data) => {
            if (data.type === 'typingStart') {
                this._handleTypingStart(data.userId);
            } else if (data.type === 'typingStop') {
                this._handleTypingStop(data.userId);
            }
        });
    }

    /**
     * 채팅 입력 필드 리스너 설정
     */
    static _setupChatInputListener() {
        const setupListener = () => {
            const chatInput = document.querySelector('#chat-message');
            if (!chatInput) {
                // 입력 필드가 아직 없으면 잠시 후 다시 시도
                setTimeout(setupListener, 500);
                return;
            }

            // 기존 리스너 제거 (중복 방지)
            if (this._inputHandlers.input) {
                chatInput.removeEventListener('input', this._inputHandlers.input);
            }
            if (this._inputHandlers.focus) {
                chatInput.removeEventListener('focus', this._inputHandlers.focus);
            }
            if (this._inputHandlers.blur) {
                chatInput.removeEventListener('blur', this._inputHandlers.blur);
            }

            // 새 핸들러 생성 및 바인딩
            this._inputHandlers.input = this._handleInput.bind(this);
            this._inputHandlers.focus = this._handleFocus.bind(this);
            this._inputHandlers.blur = this._handleBlur.bind(this);

            chatInput.addEventListener('input', this._inputHandlers.input);
            chatInput.addEventListener('focus', this._inputHandlers.focus);
            chatInput.addEventListener('blur', this._inputHandlers.blur);
        };

        // 초기 설정
        setupListener();
        
        // 사이드바가 다시 렌더될 때 리스너 재설정
        Hooks.on('renderSidebarTab', (app) => {
            if (app?.id === 'chat') {
                setTimeout(setupListener, 100);
            }
        });
    }

    /**
     * 입력 이벤트 핸들러
     */
    static _handleInput() {
        // 입력 중 상태 시작 또는 갱신
        if (!this._isTyping) {
            this._sendTypingStart();
            // 입력 중 상태를 주기적으로 갱신 (2초마다)
            this._startTypingRefresh();
        }
        
        // 디바운스: 마지막 입력 후 3초 뒤에 자동으로 중지 신호 전송
        if (this._inputDebounceTimeout) {
            clearTimeout(this._inputDebounceTimeout);
        }
        this._inputDebounceTimeout = setTimeout(() => {
            this._sendTypingStop();
            this._stopTypingRefresh();
        }, 3000);
    }

    /**
     * 포커스 이벤트 핸들러
     */
    static _handleFocus() {
        // 포커스 시에는 입력 중 신호를 보내지 않음 (실제 입력 시에만)
    }

    /**
     * 블러 이벤트 핸들러
     */
    static _handleBlur() {
        // 포커스를 잃으면 즉시 입력 중지 신호 전송
        if (this._inputDebounceTimeout) {
            clearTimeout(this._inputDebounceTimeout);
            this._inputDebounceTimeout = null;
        }
        this._sendTypingStop();
        this._stopTypingRefresh();
    }

    /**
     * 입력 시작 신호 전송
     */
    static _sendTypingStart() {
        if (!game.socket) return;
        if (this._isTyping) return; // 이미 전송 중이면 중복 방지
        
        this._isTyping = true;
        this._emitTypingStart();
    }

    /**
     * 입력 시작 신호 실제 전송 (타임아웃 갱신용으로도 사용)
     */
    static _emitTypingStart() {
        if (!game.socket) return;
        game.socket.emit('module.lichsoma-speaker-selector', {
            type: 'typingStart',
            userId: game.user.id
        });
    }

    /**
     * 입력 상태 갱신 인터벌 시작 (다른 클라이언트의 타임아웃 갱신)
     */
    static _startTypingRefresh() {
        // 기존 인터벌 제거
        this._stopTypingRefresh();
        
        // 2초마다 typingStart 신호 재전송하여 다른 클라이언트의 타임아웃 갱신
        this._typingRefreshInterval = setInterval(() => {
            if (this._isTyping) {
                this._emitTypingStart();
            }
        }, 2000);
    }

    /**
     * 입력 상태 갱신 인터벌 중지
     */
    static _stopTypingRefresh() {
        if (this._typingRefreshInterval) {
            clearInterval(this._typingRefreshInterval);
            this._typingRefreshInterval = null;
        }
    }

    /**
     * 입력 중지 신호 전송
     */
    static _sendTypingStop() {
        if (!game.socket) return;
        if (!this._isTyping) return; // 이미 중지 상태면 중복 방지
        
        this._isTyping = false;
        game.socket.emit('module.lichsoma-speaker-selector', {
            type: 'typingStop',
            userId: game.user.id
        });
    }

    /**
     * 다른 사용자의 입력 시작 처리
     */
    static _handleTypingStart(userId) {
        // 자기 자신은 무시
        if (userId === game.user.id) return;
        
        // 사용자 존재 확인
        const user = game.users.get(userId);
        if (!user) return;
        
        // 타임아웃 해제 (이미 입력 중이었다면)
        if (this._typingTimeouts.has(userId)) {
            clearTimeout(this._typingTimeouts.get(userId));
        }
        
        // 상태 업데이트
        this._typingUsers.set(userId, Date.now());
        
        // 기존 타임아웃이 있으면 취소
        if (this._typingTimeouts.has(userId)) {
            clearTimeout(this._typingTimeouts.get(userId));
        }
        
        // 4초 후 자동 제거 (타임아웃) - 갱신 신호가 2초마다 오므로 4초면 충분
        const timeoutId = setTimeout(() => {
            this._typingUsers.delete(userId);
            this._typingTimeouts.delete(userId);
            this._updateIndicator();
        }, 4000);
        this._typingTimeouts.set(userId, timeoutId);
        
        // UI 업데이트
        this._updateIndicator();
    }

    /**
     * 다른 사용자의 입력 중지 처리
     */
    static _handleTypingStop(userId) {
        // 자기 자신은 무시
        if (userId === game.user.id) return;
        
        // 타임아웃 해제
        if (this._typingTimeouts.has(userId)) {
            clearTimeout(this._typingTimeouts.get(userId));
            this._typingTimeouts.delete(userId);
        }
        
        // 상태 제거
        this._typingUsers.delete(userId);
        
        // UI 업데이트
        this._updateIndicator();
    }

    /**
     * 사용자 나감 처리 설정
     */
    static _setupUserDisconnectHandler() {
        // 사용자 목록 변경 감지 (사용자가 나갔을 때)
        Hooks.on('updateUser', (user, updateData) => {
            // active 상태가 false로 변경되면 입력 상태 제거
            if (updateData.active === false && this._typingUsers.has(user.id)) {
                this._handleTypingStop(user.id);
            }
        });
    }

    /**
     * 사용자 표시 이름 가져오기
     */
    static _getUserDisplayName(userId) {
        const user = game.users.get(userId);
        if (!user) return null;
        
        // 사용자 이름 반환 (character 이름이 있으면 그것을 우선)
        return user.name || user.data?.name || userId;
    }

    /**
     * 인디케이터 업데이트
     */
    static _updateIndicator() {
        // 디바운스 적용 (UI 업데이트 최적화)
        if (this._updateUITimeout) {
            clearTimeout(this._updateUITimeout);
        }
        
        this._updateUITimeout = setTimeout(() => {
            this._doUpdateIndicator();
        }, 50);
    }

    /**
     * 인디케이터 실제 업데이트
     */
    static _doUpdateIndicator() {
        const typingUserIds = Array.from(this._typingUsers.keys());
        
        // 입력 중인 사용자가 없으면 인디케이터 제거
        if (typingUserIds.length === 0) {
            this._removeIndicator();
            return;
        }
        
        // 인디케이터 생성 또는 업데이트
        const chatForm = document.querySelector('.chat-form');
        if (!chatForm) return;
        
        // 인디케이터 요소가 없으면 생성
        if (!this._indicatorElement) {
            this._createIndicatorElement(chatForm);
        }
        
        // 텍스트 업데이트
        const textElement = this._indicatorElement.querySelector('.typing-text');
        if (textElement) {
            if (typingUserIds.length === 1) {
                // 단일 사용자
                const userName = this._getUserDisplayName(typingUserIds[0]);
                const message = game.i18n.format('SPEAKERSELECTOR.Typing.Single', { name: userName });
                textElement.textContent = message;
            } else {
                // 복수 사용자
                const message = game.i18n.localize('SPEAKERSELECTOR.Typing.Multiple');
                textElement.textContent = message;
            }
        }
        
        // 위치 업데이트
        this._updateIndicatorPosition();
        
        // 표시
        this._indicatorElement.style.display = 'flex';
    }

    /**
     * 인디케이터 요소 생성
     */
    static _createIndicatorElement(chatForm) {
        const indicator = document.createElement('div');
        indicator.className = 'lichsoma-typing-indicator';
        
        const text = document.createElement('span');
        text.className = 'typing-text';
        
        const dots = document.createElement('span');
        dots.className = 'typing-dots';
        dots.innerHTML = '<span class="dot dot1">.</span><span class="dot dot2">.</span><span class="dot dot3">.</span>';
        
        indicator.appendChild(text);
        indicator.appendChild(dots);
        
        // chat-form에 직접 추가 (absolute positioning 사용)
        chatForm.appendChild(indicator);
        
        // 입력칸 위치 기준으로 인디케이터 위치 설정
        this._updateIndicatorPosition();
        
        // 입력칸 크기 변경 시 인디케이터 위치 재조정
        const chatInput = chatForm.querySelector('#chat-message');
        if (chatInput) {
            const resizeObserver = new ResizeObserver(() => {
                this._updateIndicatorPosition();
            });
            resizeObserver.observe(chatInput);
            resizeObserver.observe(chatForm);
        }
        
        this._indicatorElement = indicator;
    }

    /**
     * 인디케이터 위치 업데이트 (입력칸 하단 근처에 배치)
     */
    static _updateIndicatorPosition() {
        if (!this._indicatorElement) return;
        
        const chatForm = this._indicatorElement.closest('.chat-form');
        if (!chatForm) return;
        
        const chatInput = chatForm.querySelector('#chat-message');
        if (!chatInput) return;
        
        // 입력칸이 display: none이거나 아직 렌더링되지 않았으면 건너뜀
        if (chatInput.offsetHeight === 0) return;
        
        // 일시적으로 표시하여 높이 계산
        const wasVisible = this._indicatorElement.style.display !== 'none';
        if (!wasVisible) {
            this._indicatorElement.style.display = 'flex';
            this._indicatorElement.style.visibility = 'hidden';
        }
        
        // 입력칸의 위치 계산 (form 기준)
        const formRect = chatForm.getBoundingClientRect();
        const inputRect = chatInput.getBoundingClientRect();
        
        // 입력칸의 하단에서 인디케이터를 배치 (form의 top 기준)
        // 입력칸 하단부 근처에 배치 (입력칸 내부 하단에서 약간 위쪽)
        const inputBottom = inputRect.top - formRect.top + inputRect.height;
        const top = inputBottom - 20; // 인디케이터를 입력칸 하단에서 약간 위에 겹치게 배치
        
        this._indicatorElement.style.top = `${top}px`;
        this._indicatorElement.style.bottom = 'auto';
        
        // visibility 복원
        if (!wasVisible) {
            this._indicatorElement.style.visibility = '';
            this._indicatorElement.style.display = 'none';
        }
    }

    /**
     * 인디케이터 제거
     */
    static _removeIndicator() {
        if (this._indicatorElement) {
            this._indicatorElement.style.display = 'none';
        }
    }
}

// 모듈 초기화
Hooks.once('ready', () => {
    ChatNotification.initialize();
});

