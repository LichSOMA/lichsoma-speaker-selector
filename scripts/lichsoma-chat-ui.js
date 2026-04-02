/**
 * LichSOMA Chat UI
 * 채팅 UI 관련 기능 (사이드바 자동 열기 등)
 */

export class ChatUI {
    // 중복 실행 방지 플래그
    static _isEnsuringSidebarOpen = false;
    static _sidebarOpenedOnce = false;

    // 사이드바 상태 체크 함수
    static isSidebarCollapsed() {
        // 방법 1: ui.sidebar.collapsed 확인
        if (ui?.sidebar && typeof ui.sidebar.collapsed === 'boolean') {
            return ui.sidebar.collapsed;
        }

        // 방법 2: DOM 요소로 확인
        const sidebarElement = document.querySelector('#sidebar');
        if (sidebarElement) {
            const computedStyle = getComputedStyle(sidebarElement);
            return sidebarElement.classList.contains('collapsed') ||
                computedStyle.width === '0px' ||
                sidebarElement.offsetWidth === 0;
        }

        // 방법 3: 기본값 (사이드바를 열린 상태로 가정)
        return false;
    }

    // 사이드바를 강제로 열기
    static async ensureSidebarOpen() {
        // 중복 실행 방지
        if (this._isEnsuringSidebarOpen) return;
        this._isEnsuringSidebarOpen = true;
        
        try {
            // DOM 요소로 사이드바 상태 확인
            const sidebarElement = document.querySelector('#sidebar');
            if (!sidebarElement) {
                this._isEnsuringSidebarOpen = false;
                return;
            }
            
            // 사이드바/채팅 로그가 렌더링되지 않았다면 먼저 렌더링
            if (ui?.sidebar && !ui.sidebar.rendered) {
                try {
                    await ui.sidebar.render(false);
                } catch (e) {
                    // ui.sidebar.render() 실패 (무시)
                }
            }
            if (ui?.chat && !ui.chat.rendered) {
                try {
                    await ui.chat.render(true);
                } catch (e) {
                    // ui.chat.render() 실패 (무시)
                }
            }
            
            // 사이드바가 접혀있는지 확인 (여러 방법)
            const isCollapsed = sidebarElement.classList.contains('collapsed') ||
                               sidebarElement.offsetWidth === 0 ||
                               (ui?.sidebar && ui.sidebar.collapsed);
            
            // 이미 열려있고 한 번 열었으면 더 이상 시도하지 않음
            if (!isCollapsed && this._sidebarOpenedOnce) {
                return;
            }
            
            if (isCollapsed) {
                // 방법 1: ui.sidebar API 사용 (우선)
                if (ui?.sidebar && typeof ui.sidebar.expand === 'function') {
                    try {
                        await ui.sidebar.expand();
                        this._sidebarOpenedOnce = true;
                    } catch (e) {
                        // ui.sidebar.expand() 실패 시 fallback 시도
                        const expandButton = sidebarElement.querySelector('button.collapse[data-action="toggleState"]');
                        if (expandButton && sidebarElement.classList.contains('collapsed')) {
                            expandButton.click();
                            this._sidebarOpenedOnce = true;
                        }
                    }
                } else {
                    // API가 없으면 버튼 클릭
                    const expandButton = sidebarElement.querySelector('button.collapse[data-action="toggleState"]');
                    if (expandButton && sidebarElement.classList.contains('collapsed')) {
                        expandButton.click();
                        this._sidebarOpenedOnce = true;
                    }
                }
            }
            
            // 채팅 탭이 활성화되지 않았으면 활성화
            if (ui?.sidebar) {
                try {
                    if (ui.sidebar.activeTab !== 'chat') {
                        ui.sidebar.changeTab('chat');
                    }
                } catch (e) {
                    // 채팅 탭 버튼 클릭 (fallback)
                    const chatTabButton = document.querySelector('#sidebar-tabs button[data-tab="chat"]');
                    if (chatTabButton && !chatTabButton.classList.contains('active')) {
                        chatTabButton.click();
                    }
                }
            }
        } finally {
            // 플래그 해제 (약간의 지연 후)
            setTimeout(() => {
                this._isEnsuringSidebarOpen = false;
            }, 100);
        }
    }

    static initialize() {
        // 초기화만 수행 (사이드바 열기는 setup 훅에서 처리)
        
        // 포트레잇 호버 프리뷰 기능 초기화
        this.setupPortraitPreview();
    }
    
    // 포트레잇 호버 프리뷰 설정
    static setupPortraitPreview() {
        // renderChatMessageHTML 훅에서 포트레잇이 추가된 후 프리뷰 연결
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            // 포트레잇이 비동기로 추가될 수 있으므로 약간의 지연 후 확인
            setTimeout(() => {
                const $html = $(html);
                const portraitContainer = $html.find('.lichsoma-chat-portrait-container');
                
                if (portraitContainer.length) {
                    const img = portraitContainer.find('.lichsoma-chat-portrait');
                    if (img.length) {
                        const imgSrc = img.attr('src');
                        if (imgSrc) {
                            // 이미 프리뷰가 연결되어 있는지 확인
                            const container = portraitContainer[0];
                            if (!container.hasAttribute('data-preview-attached')) {
                                this._attachPortraitPreview(container, imgSrc);
                                container.setAttribute('data-preview-attached', 'true');
                            }
                        }
                    }
                }
            }, 50);
        });
        
        // 기존 메시지들에도 프리뷰 연결 (채팅 로그가 렌더링될 때)
        Hooks.on('renderChatLog', (app, html, data) => {
            setTimeout(() => {
                const $html = $(html);
                const portraitContainers = $html.find('.lichsoma-chat-portrait-container');
                portraitContainers.each((index, container) => {
                    const $container = $(container);
                    if (!$container[0].hasAttribute('data-preview-attached')) {
                        const img = $container.find('.lichsoma-chat-portrait');
                        if (img.length) {
                            const imgSrc = img.attr('src');
                            if (imgSrc) {
                                this._attachPortraitPreview($container[0], imgSrc);
                                $container[0].setAttribute('data-preview-attached', 'true');
                            }
                        }
                    }
                });
            }, 100);
        });
    }
    
    // 포트레잇 프리뷰 이벤트 연결
    static _attachPortraitPreview(container, imgSrc) {
        // 중복 방지: 이미 프리뷰가 연결되어 있는지 확인
        if (container.hasAttribute('data-preview-attached')) {
            return; // 이미 프리뷰가 연결되어 있음
        }
        
        // 속성 추가 (중복 방지)
        container.setAttribute('data-preview-attached', 'true');
        
        let previewElement = null;
        let hideTimeout = null;
        
        const showPreview = (e) => {
            // 기존 타임아웃 취소
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            
            // 프리뷰 요소가 없으면 생성
            if (!previewElement) {
                previewElement = document.createElement('div');
                previewElement.className = 'lichsoma-portrait-preview';
                
                const previewImg = document.createElement('img');
                previewImg.src = imgSrc;
                previewImg.alt = 'Preview';
                previewElement.appendChild(previewImg);
                
                document.body.appendChild(previewElement);
                
                // 프리뷰 요소에 호버 이벤트 연결 (한 번만)
                previewElement.addEventListener('mouseenter', () => {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }
                });
                previewElement.addEventListener('mouseleave', () => {
                    if (previewElement) {
                        // DOM에서 완전히 제거
                        previewElement.remove();
                        previewElement = null;
                    }
                });
            }
            
            // 프리뷰 위치 설정 (항상 포트레잇의 왼쪽)
            const rect = container.getBoundingClientRect();
            const previewWidth = 240; // 프리뷰 이미지 너비
            const previewHeight = 240; // 프리뷰 이미지 높이
            const offset = 25; // 포트레잇과의 간격
            
            let left = rect.left - previewWidth - offset;
            let top = rect.top;
            
            // 화면 왼쪽 경계를 넘으면 최소 여백 유지
            if (left < 10) {
                left = 10;
            }
            
            // 화면 아래 경계를 넘으면 위로 조정
            if (top + previewHeight > window.innerHeight) {
                top = window.innerHeight - previewHeight - 10;
            }
            
            // 화면 위 경계를 넘으면 아래로 조정
            if (top < 0) {
                top = 10;
            }
            
            previewElement.style.left = `${left}px`;
            previewElement.style.top = `${top}px`;
            previewElement.style.display = 'block';
        };
        
        const hidePreview = () => {
            if (previewElement) {
                // 약간의 지연을 두어 마우스가 프리뷰로 이동할 시간을 줌
                hideTimeout = setTimeout(() => {
                    if (previewElement) {
                        // DOM에서 완전히 제거
                        previewElement.remove();
                        previewElement = null;
                    }
                }, 100);
            }
        };
        
        const removePreview = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            if (previewElement) {
                previewElement.remove();
                previewElement = null;
            }
        };
        
        // 호버 이벤트
        container.addEventListener('mouseenter', showPreview);
        container.addEventListener('mouseleave', hidePreview);
        
        // 메시지가 제거될 때 프리뷰도 제거
        const messageElement = container.closest('.chat-message');
        if (messageElement) {
            const observer = new MutationObserver((mutations) => {
                if (!document.body.contains(messageElement)) {
                    removePreview();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    // 챗폼 높이를 동적으로 계산하여 CSS 변수로 설정
    static updateChatFormHeight() {
        const chatForm = document.querySelector('#chat .chat-form');
        const chatSidebar = document.querySelector('#chat.chat-sidebar');
        
        if (chatForm && chatSidebar) {
            const formHeight = chatForm.offsetHeight;
            chatSidebar.style.setProperty('--chat-form-height', `${formHeight}px`);
        }
    }

    // 챗폼 높이 변경 감지 및 업데이트
    static setupChatFormHeightObserver() {
        const chatForm = document.querySelector('#chat .chat-form');
        if (!chatForm) return;

        // 초기 높이 설정
        this.updateChatFormHeight();

        // ResizeObserver로 높이 변경 감지
        const observer = new ResizeObserver(() => {
            this.updateChatFormHeight();
        });

        observer.observe(chatForm);

        // 채팅 로그 렌더링 시에도 업데이트
        Hooks.on('renderChatLog', () => {
            setTimeout(() => {
                this.updateChatFormHeight();
            }, 10);
        });

        // 사이드바 탭 렌더링 시에도 업데이트
        Hooks.on('renderSidebarTab', (app, html, data) => {
            if (app.tabName === 'chat') {
                setTimeout(() => {
                    this.updateChatFormHeight();
                }, 10);
            }
        });
    }
}

// 모듈 초기화
Hooks.once('setup', () => {
    // setup 훅에서도 사이드바 열기 시도 (한 번만)
    setTimeout(() => {
        if (!ChatUI._sidebarOpenedOnce) {
            ChatUI.ensureSidebarOpen();
        }
    }, 100);
});

Hooks.once('ready', async () => {
    // 사이드바 열기는 setup 훅에서만 처리
    
    // 챗폼 높이 관찰자 설정
    setTimeout(() => {
        ChatUI.setupChatFormHeightObserver();
    }, 10);
});

Hooks.once('init', () => {
    ChatUI.initialize();
});

