/**
 * LichSOMA Chat Reviser
 * 채팅 메시지 수정 기능
 */

export class ChatReviser {
    static _editingMessageId = null;
    static _overlayElement = null;
    static _positionObserver = null;
    static _resizeObserver = null;
    static _resizeHandler = null;

    static initialize() {
        // 더블클릭으로 수정 모드 시작
        this._setupDoubleClickHandler();
        
        // 메시지 렌더링 시 편집 상태 하이라이트 적용
        this._setupRenderHook();
    }
    
    // 메시지 렌더링 훅 설정
    static _setupRenderHook() {
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            try {
                // HTMLElement를 직접 사용
                let li = html;
                if (!li.classList.contains('chat-message')) {
                    li = html.querySelector('.chat-message');
                    if (!li) li = html.closest('.chat-message');
                }
                if (!li) return;
                
                // 편집 상태 플래그 확인
                const editingBy = message.flags?.['lichsoma-speaker-selector']?.editingBy;
                if (editingBy) {
                    li.classList.add('lichsoma-editing-message');
                } else {
                    li.classList.remove('lichsoma-editing-message');
                }
            } catch (e) {
                // 오류 발생 시 무시
            }
        });
    }

    // 더블클릭 이벤트 핸들러 설정
    static _setupDoubleClickHandler() {
        // 채팅 메시지 내용 영역 더블클릭 감지
        // chat-scroll 내부의 메시지만 처리 (overflow 제외)
        $(document).on('dblclick.lichsoma-chat-reviser', '.chat-message .message-content', (ev) => {
            try {
                const messageContent = ev.currentTarget;
                const li = messageContent.closest('.chat-message');
                if (!li) return;

                // overflow 내부의 메시지는 제외
                if (li.closest('.overflow')) {
                    return;
                }

                // chat-scroll 내부의 메시지만 처리
                if (!li.closest('.chat-scroll')) {
                    return;
                }

                const messageId = li.getAttribute('data-message-id');
                if (!messageId) return;

                const message = game.messages.get(messageId);
                if (!message) return;

                // 권한 체크: 소유자 또는 GM만 수정 가능
                const canEdit = game.user.isGM || (message.author?.id === game.user.id);
                if (!canEdit) {
                    ui.notifications.warn("자신의 메시지만 수정할 수 있습니다.");
                    return;
                }

                // 수정 모드 시작
                this._startEditingMode(message);
            } catch (e) {
                // 오류 발생 시 무시
            }
        });
    }

    // 수정 모드 시작
    static _startEditingMode(message) {
        // 이미 편집 중이면 종료
        if (this._editingMessageId) {
            this._stopEditingMode();
        }

        this._editingMessageId = message.id;

        // 편집 대상 메시지에 하이라이트 클래스 추가
        try {
            const li = document.querySelector(`.chat-message[data-message-id="${message.id}"]`);
            if (li) {
                li.classList.add('lichsoma-editing-message');
            }
            // 모든 클라이언트에 편집 상태 전달
            message.setFlag('lichsoma-speaker-selector', 'editingBy', game.user.id).catch(() => {});
        } catch (e) {
            // 오류 발생 시 무시
        }

        // chat-input 요소 찾기
        const chatInput = document.querySelector('#sidebar .chat-form .chat-input, .chat-form .chat-input, #chat-message');
        if (!chatInput) {
            // chat-input이 아직 없으면 잠시 후 재시도
            setTimeout(() => {
                if (this._editingMessageId === message.id) {
                    this._startEditingMode(message);
                }
            }, 100);
            return;
        }

        // 오버레이 생성 및 위치 설정
        this._createOverlay(chatInput, message);
    }

    // 오버레이 생성
    static _createOverlay(chatInput, message) {
        // 기존 오버레이 제거
        this._removeOverlay();

        // 오버레이 요소 생성
        const overlay = document.createElement('div');
        overlay.className = 'lichsoma-chat-reviser-overlay';

        // Foundry v14 채팅 입력은 ProseMirror로 구성되며 menu-container + editor-container를 포함함.
        // 오버레이는 편집 영역(editor-container)만 덮어야 하므로 타깃을 분리한다.
        const overlayTarget = chatInput.querySelector?.('.editor-container') || chatInput;
        
        // 편집 가능한 contenteditable div 생성
        const contentEditable = document.createElement('div');
        contentEditable.className = 'lichsoma-chat-reviser-content';
        contentEditable.contentEditable = true;
        
        // HTML 내용을 그대로 설정
        contentEditable.innerHTML = message.content || '';

        // Enter 키 이벤트 처리 (Enter: 저장, Shift+Enter: 줄바꿈)
        contentEditable.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                ev.stopPropagation();
                this._saveMessage(message, contentEditable.innerHTML);
            }
        });

        overlay.appendChild(contentEditable);

        // chat-input의 부모 요소에 추가 (같은 위치에 배치하기 위해)
        const chatForm = chatInput.closest('.chat-form');
        if (chatForm) {
            chatForm.appendChild(overlay);
        } else {
            chatInput.parentElement.appendChild(overlay);
        }

        this._overlayElement = overlay;
        this._overlayTargetElement = overlayTarget;

        // 위치 및 크기 설정
        this._updateOverlayPosition(overlayTarget);

        // 위치 변경 감지 (ResizeObserver + MutationObserver)
        this._setupPositionObservers(overlayTarget);

        // 포커스 설정
        setTimeout(() => {
            contentEditable.focus();
            // 커서를 끝으로 이동
            const range = document.createRange();
            const selection = window.getSelection();
            range.selectNodeContents(contentEditable);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }, 10);
    }

    // 오버레이 위치 및 크기 업데이트
    static _updateOverlayPosition(targetElement) {
        if (!this._overlayElement || !targetElement) return;

        const rect = targetElement.getBoundingClientRect();
        const formRect = targetElement.closest('.chat-form')?.getBoundingClientRect();

        if (formRect) {
            // chat-form 기준 상대 위치 계산
            const relativeTop = rect.top - formRect.top;
            const relativeLeft = rect.left - formRect.left;

            this._overlayElement.style.top = `${relativeTop}px`;
            this._overlayElement.style.left = `${relativeLeft}px`;
            this._overlayElement.style.width = `${rect.width}px`;
            this._overlayElement.style.height = `${rect.height}px`;
        } else {
            // 절대 위치 사용 (fallback)
            const absoluteRect = targetElement.getBoundingClientRect();
            this._overlayElement.style.position = 'fixed';
            this._overlayElement.style.top = `${absoluteRect.top}px`;
            this._overlayElement.style.left = `${absoluteRect.left}px`;
            this._overlayElement.style.width = `${absoluteRect.width}px`;
            this._overlayElement.style.height = `${absoluteRect.height}px`;
        }
    }

    // 위치 변경 감지 설정
    static _setupPositionObservers(targetElement) {
        // 기존 observer 정리
        this._cleanupObservers();

        // ResizeObserver: 타깃(editor-container) 크기 변경 감지
        this._resizeObserver = new ResizeObserver(() => {
            if (this._overlayElement && targetElement) {
                this._updateOverlayPosition(targetElement);
            }
        });
        this._resizeObserver.observe(targetElement);

        // MutationObserver: chat-form 구조 변경 감지
        const chatForm = targetElement.closest('.chat-form');
        if (chatForm) {
            this._positionObserver = new MutationObserver(() => {
                if (this._overlayElement && targetElement) {
                    this._updateOverlayPosition(targetElement);
                }
            });
            this._positionObserver.observe(chatForm, {
                childList: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        // window resize 이벤트
        const handleResize = () => {
            if (this._overlayElement && targetElement) {
                this._updateOverlayPosition(targetElement);
            }
        };
        window.addEventListener('resize', handleResize);
        
        // 정리 함수에 저장 (나중에 제거하기 위해)
        this._resizeHandler = handleResize;
    }

    // Observer 정리
    static _cleanupObservers() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._positionObserver) {
            this._positionObserver.disconnect();
            this._positionObserver = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
    }

    // 오버레이 제거
    static _removeOverlay() {
        if (this._overlayElement) {
            this._overlayElement.remove();
            this._overlayElement = null;
        }
        this._cleanupObservers();
    }

    // 메시지 저장
    static async _saveMessage(message, newContent) {
        if (!message || !this._editingMessageId || message.id !== this._editingMessageId) {
            return;
        }

        try {
            // HTML 내용을 그대로 저장 (이미 HTML 형식)
            await message.update({ content: newContent });
            
            // 수정 모드 종료
            this._stopEditingMode();
            
            ui.notifications.info("메시지가 수정되었습니다.");
        } catch (e) {
            // 오류 발생 시 알림
            ui.notifications.error("메시지 수정 중 오류가 발생했습니다.");
        }
    }

    // 수정 모드 종료
    static _stopEditingMode() {
        // 편집 하이라이트 제거
        try {
            if (this._editingMessageId) {
                const li = document.querySelector(`.chat-message[data-message-id="${this._editingMessageId}"]`);
                if (li) {
                    li.classList.remove('lichsoma-editing-message');
                }
                const msg = game.messages.get(this._editingMessageId);
                if (msg) {
                    msg.unsetFlag('lichsoma-speaker-selector', 'editingBy').catch(() => {});
                }
            }
        } catch (e) {
            // 오류 발생 시 무시
        }
        
        this._editingMessageId = null;
        this._removeOverlay();
    }

    // ESC 키로 수정 취소
    static _setupEscapeHandler() {
        $(document).on('keydown.lichsoma-chat-reviser-escape', (ev) => {
            if (ev.key === 'Escape' && this._editingMessageId) {
                ev.stopPropagation();
                this._stopEditingMode();
            }
        });
    }
}

// 모듈 초기화
Hooks.once('ready', () => {
    ChatReviser.initialize();
    ChatReviser._setupEscapeHandler();
});

