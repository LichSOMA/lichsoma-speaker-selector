/**
 * LichSOMA Chat UI
 * 채팅 UI 관련 기능 (사이드바 자동 열기 등)
 */

import { LichsomaChatDom } from './lichsoma-chat-dom.js';

export class ChatUI {
    // 중복 실행 방지 플래그
    static _isEnsuringSidebarOpen = false;
    static _sidebarOpenedOnce = false;
    static _chatFormResizeObserver = null;

    // 사이드바 상태 체크 함수
    static isSidebarCollapsed() {
        // 방법 1: ui.sidebar.collapsed 확인
        if (ui?.sidebar && typeof ui.sidebar.collapsed === 'boolean') {
            return ui.sidebar.collapsed;
        }

        // 방법 2: DOM 요소로 확인
        const sidebarElement = LichsomaChatDom.getSidebar();
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
            const sidebarElement = LichsomaChatDom.getSidebar();
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
                    const chatTabButton = LichsomaChatDom.query('#sidebar-tabs button[data-tab="chat"]');
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
        // 기존 구현은 포트레잇마다 이벤트 리스너와 document.body MutationObserver를 붙였지만,
        // 채팅이 누적되면 감시자 수가 메시지 수만큼 증가한다.
        // 전역 이벤트 위임으로 바꿔 채팅 로그 전체에 대해 단일 처리 경로만 유지한다.
        this._ensurePortraitPreviewDelegation();
    }

    static _ensurePortraitPreviewDelegation() {
        if (this._portraitPreviewDelegated) return;
        this._portraitPreviewDelegated = true;
        this._portraitPreviewElement = null;
        this._portraitPreviewHideTimeout = null;
        this._portraitPreviewAnchor = null;

        document.addEventListener('pointerover', (event) => this._handlePortraitPointerOver(event), true);
        document.addEventListener('pointerout', (event) => this._handlePortraitPointerOut(event), true);
        document.addEventListener('pointerdown', () => this.hidePortraitPreview(), true);
        window.addEventListener('blur', () => this.hidePortraitPreview());
        window.addEventListener('scroll', () => this._positionPortraitPreview(), true);

        Hooks.on('deleteChatMessage', () => this.hidePortraitPreview());
        Hooks.on('renderChatLog', () => this.hidePortraitPreview());
    }

    static _getPortraitPreviewTarget(element) {
        const target = element?.closest?.(
            '.lichsoma-chat-portrait-container, .chat-message.dnd5e2 .message-header .message-sender .avatar'
        );
        if (!target || LichsomaChatDom.isInChatNotifications(target)) return null;
        if (!LichsomaChatDom.getChatLogForMessage(target)) return null;
        return target;
    }

    static _getPortraitPreviewSrc(target) {
        if (!target) return null;
        return target.dataset?.lichsomaPortraitSrc
            || target.querySelector?.('.lichsoma-chat-portrait[src]')?.getAttribute('src')
            || target.querySelector?.('img[src]')?.getAttribute('src')
            || null;
    }

    static _handlePortraitPointerOver(event) {
        const target = this._getPortraitPreviewTarget(event.target);
        if (!target) return;
        if (target === this._portraitPreviewAnchor) return;

        const imgSrc = this._getPortraitPreviewSrc(target);
        if (!imgSrc) return;

        this.showPortraitPreview(target, imgSrc);
    }

    static _handlePortraitPointerOut(event) {
        const target = this._getPortraitPreviewTarget(event.target);
        if (!target) return;

        const related = event.relatedTarget;
        if (related && (target.contains?.(related) || this._portraitPreviewElement?.contains?.(related))) return;

        this._scheduleHidePortraitPreview();
    }

    static showPortraitPreview(anchor, imgSrc) {
        if (!anchor || !imgSrc) return;
        this._ensurePortraitPreviewDelegation();

        if (this._portraitPreviewHideTimeout) {
            clearTimeout(this._portraitPreviewHideTimeout);
            this._portraitPreviewHideTimeout = null;
        }

        const previewElement = this._getOrCreatePortraitPreviewElement();
        const img = previewElement.querySelector('img');
        if (img && img.getAttribute('src') !== imgSrc) {
            img.setAttribute('src', imgSrc);
        }

        this._portraitPreviewAnchor = anchor;
        this._portraitPreviewSrc = imgSrc;
        this._positionPortraitPreview();
        previewElement.style.display = 'block';
    }

    static _getOrCreatePortraitPreviewElement() {
        if (this._portraitPreviewElement?.isConnected) return this._portraitPreviewElement;

        const previewElement = document.createElement('div');
        previewElement.className = 'lichsoma-portrait-preview';

        const previewImg = document.createElement('img');
        previewImg.alt = 'Preview';
        previewElement.appendChild(previewImg);

        previewElement.addEventListener('pointerenter', () => {
            if (this._portraitPreviewHideTimeout) {
                clearTimeout(this._portraitPreviewHideTimeout);
                this._portraitPreviewHideTimeout = null;
            }
        });

        previewElement.addEventListener('pointerleave', () => {
            this.hidePortraitPreview();
        });

        document.body.appendChild(previewElement);
        this._portraitPreviewElement = previewElement;
        return previewElement;
    }

    static _positionPortraitPreview() {
        const previewElement = this._portraitPreviewElement;
        const anchor = this._portraitPreviewAnchor;
        if (!previewElement || !anchor?.isConnected) {
            this.hidePortraitPreview();
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const previewWidth = 240;
        const previewHeight = 240;
        const offset = 25;

        let left = rect.left - previewWidth - offset;
        let top = rect.top;

        if (left < 10) left = 10;
        if (top + previewHeight > window.innerHeight) top = window.innerHeight - previewHeight - 10;
        if (top < 0) top = 10;

        previewElement.style.left = `${left}px`;
        previewElement.style.top = `${top}px`;
    }

    static _scheduleHidePortraitPreview() {
        if (!this._portraitPreviewElement) return;
        if (this._portraitPreviewHideTimeout) clearTimeout(this._portraitPreviewHideTimeout);
        this._portraitPreviewHideTimeout = setTimeout(() => {
            this.hidePortraitPreview();
        }, 100);
    }

    static hidePortraitPreview() {
        if (this._portraitPreviewHideTimeout) {
            clearTimeout(this._portraitPreviewHideTimeout);
            this._portraitPreviewHideTimeout = null;
        }
        if (this._portraitPreviewElement) {
            this._portraitPreviewElement.remove();
            this._portraitPreviewElement = null;
        }
        this._portraitPreviewAnchor = null;
        this._portraitPreviewSrc = null;
    }

    // 포트레잇 프리뷰 이벤트 연결
    static _attachPortraitPreview(container, imgSrc) {
        // Backward-compatible entry point used by SpeakerSelector. Do not attach
        // per-message listeners or MutationObservers here.
        if (!container) return;
        container.dataset.previewAttached = 'delegated';
        if (imgSrc) container.dataset.lichsomaPortraitSrc = imgSrc;
        this._ensurePortraitPreviewDelegation();
    }

    // 챗폼 높이를 동적으로 계산하여 CSS 변수로 설정
    static updateChatFormHeight() {
        const chatForm = LichsomaChatDom.getChatForm();
        const chatSidebar = LichsomaChatDom.getChatSection();
        
        if (chatForm && chatSidebar) {
            const formHeight = chatForm.offsetHeight;
            chatSidebar.style.setProperty('--chat-form-height', `${formHeight}px`);
        }
    }

    // 챗폼 높이 변경 감지 및 업데이트
    static setupChatFormHeightObserver() {
        const chatForm = LichsomaChatDom.getChatForm();
        if (!chatForm) return;

        // 초기 높이 설정
        this.updateChatFormHeight();

        // ResizeObserver로 높이 변경 감지
        this._chatFormResizeObserver?.disconnect?.();
        this._chatFormResizeObserver = new ResizeObserver(() => {
            this.updateChatFormHeight();
        });

        this._chatFormResizeObserver.observe(chatForm);

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

