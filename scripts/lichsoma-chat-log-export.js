// LichSOMA Speaker Selector - Chat Log Export
// 채팅 로그를 HTML로 저장하는 기능
(function() {
  'use strict';
  
  // 문자열을 간단한 해시로 변환하는 함수
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }
    return Math.abs(hash).toString(36);
  }
  
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** @see scripts/lichsoma-chat-system-registry.js — 시스템 모듈이 등록한 내보내기 머지 제외 규칙 */
  function chatSystemExportExcludeCurrent(message, element) {
    const bridge = globalThis.LichsomaChatSystemRegistry?.ChatSystemBridge?.export;
    return bridge?.excludeCurrent?.(message, element) === true;
  }
  
  /** ChatMerge._isOnlyHrMessage 와 동일: ProseMirror의 `<p><hr></p>` 등도 구분선 전용으로 처리 */
  function isOnlyHrMessageContent(messageEl) {
    const messageContent = messageEl.querySelector('.message-content');
    if (!messageContent) return false;
    const htmlContent = messageContent.innerHTML || '';
    const withoutHr = htmlContent.replace(/<hr\s*\/?>/gi, '');
    const textOnly = withoutHr.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    return textOnly === '';
  }
  
  function normalizeImageUrl(imageUrl, localHost) {
    if (!imageUrl || typeof imageUrl !== 'string') return '';
    const src = imageUrl.trim();
    if (!src) return '';
    
    // 이미 Base64인 경우 그대로 사용
    if (src.startsWith('data:')) return src;
    
    // protocol-relative URL
    if (src.startsWith('//')) return `${window.location.protocol}${src}`;
    
    // absolute http(s)
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    
    // 상대 경로 -> Foundry origin 기준 절대 URL
    return src.startsWith('/') ? `${localHost}${src}` : `${localHost}/${src}`;
  }
  
  async function fetchWithRetry(url, { retries = 3, timeoutMs = 20000, backoffMs = 500 } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          credentials: 'same-origin',
          signal: controller.signal
        });
        clearTimeout(t);
        return res;
      } catch (err) {
        clearTimeout(t);
        lastErr = err;
        // 지수 백오프 + 약간의 지터
        const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        await sleep(delay);
      }
    }
    throw lastErr;
  }
  
  // 이미지 URL을 Base64 Data URL로 변환하는 함수
  async function imageUrlToBase64(imageUrl, localHost) {
    try {
      // 이미 Base64인 경우 그대로 반환
      if (imageUrl.startsWith('data:')) {
        return imageUrl;
      }
      
      const fullUrl = normalizeImageUrl(imageUrl, localHost);
      if (!fullUrl) return imageUrl;
      
      // 이미지 fetch
      const response = await fetchWithRetry(fullUrl, { retries: 4, timeoutMs: 25000, backoffMs: 600 });
      if (!response.ok) {
        console.warn(`이미지 로드 실패: ${fullUrl}`);
        return imageUrl; // 실패 시 원본 URL 반환
      }
      
      const blob = await response.blob();
      
      // Blob을 Base64로 변환
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn(`Base64 변환 실패: ${imageUrl}`, error);
      return imageUrl; // 오류 시 원본 URL 반환
    }
  }
  
  // chat-log에 렌더링된 메시지 수를 세는 함수
  function countRenderedMessages(chatLog) {
    if (!chatLog) return 0;
    const messages = chatLog.querySelectorAll('.chat-message[data-message-id]');
    return messages.length;
  }
  
  // 모든 메시지가 로드될 때까지 기다리는 함수
  async function waitForAllMessagesLoaded(chatLog, chatScroll) {
    const totalMessageCount = game.messages.size;
    
    // 이미 모든 메시지가 로드되어 있는지 확인
    let renderedCount = countRenderedMessages(chatLog);
    if (renderedCount >= totalMessageCount) {
      return true; // 이미 모두 로드됨
    }
    
    // 맨 위로 스크롤
    if (chatScroll) {
      chatScroll.scrollTop = 0;
      // 스크롤이 완료될 때까지 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // MutationObserver로 DOM 변화 감지
    return new Promise((resolve) => {
      let lastCount = renderedCount;
      let stableCount = 0; // 변화가 없는 연속 체크 횟수
      const maxStableChecks = 5; // 5번 연속 변화 없으면 완료로 간주
      const checkInterval = 200; // 200ms마다 체크
      const maxWaitTime = 30000; // 최대 30초 대기
      const startTime = Date.now();
      
      const observer = new MutationObserver(() => {
        // DOM 변화 감지 시 카운트 재확인
        const currentCount = countRenderedMessages(chatLog);
        if (currentCount !== lastCount) {
          lastCount = currentCount;
          stableCount = 0;
        }
      });
      
      // chatLog 감시 시작
      if (chatLog) {
        observer.observe(chatLog, {
          childList: true,
          subtree: true
        });
      }
      
      // 주기적으로 체크
      const intervalId = setInterval(() => {
        const currentCount = countRenderedMessages(chatLog);
        
        // 시간 초과 체크
        if (Date.now() - startTime > maxWaitTime) {
          clearInterval(intervalId);
          observer.disconnect();
          resolve(currentCount >= totalMessageCount);
          return;
        }
        
        // 카운트가 변경되었는지 확인
        if (currentCount !== lastCount) {
          lastCount = currentCount;
          stableCount = 0;
        } else {
          stableCount++;
        }
        
        // 목표 달성 확인
        if (currentCount >= totalMessageCount) {
          clearInterval(intervalId);
          observer.disconnect();
          resolve(true);
          return;
        }
        
        // 변화가 없을 때 스크롤 시도 (가상 스크롤링 대응)
        if (stableCount >= 2 && chatScroll) {
          // 약간씩 스크롤하여 추가 메시지 로드 시도
          const currentScroll = chatScroll.scrollTop;
          chatScroll.scrollTop = currentScroll + 100;
          
          // 다시 맨 위로 스크롤 (새로운 메시지가 위에 추가될 수 있음)
          setTimeout(() => {
            chatScroll.scrollTop = 0;
          }, 50);
        }
      }, checkInterval);
    });
  }
  
  // 채팅 로그 HTML로 저장하는 함수
  async function exportChatLogAsHTML() {
    try {
      // game.messages의 총 개수 확인
      const totalMessageCount = game.messages.size;
      if (totalMessageCount === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return;
      }
      
      // 채팅 로그의 HTML 가져오기 - 올바른 경로로 찾기
      let chatLog = null;
      let chatScroll = null;
      
      // 방법 1: section#chat .chat-scroll .chat-log (올바른 경로)
      const chatSection = document.querySelector('section#chat');
      if (chatSection) {
        chatScroll = chatSection.querySelector('.chat-scroll');
        if (chatScroll) {
          chatLog = chatScroll.querySelector('.chat-log');
        }
      }
      
      // 방법 2: .chat-sidebar.active .chat-scroll .chat-log
      if (!chatLog || chatLog.innerHTML.trim().length === 0) {
        const chatSidebar = document.querySelector('.chat-sidebar.active');
        if (chatSidebar) {
          chatScroll = chatSidebar.querySelector('.chat-scroll');
          if (chatScroll) {
            chatLog = chatScroll.querySelector('.chat-log');
          }
        }
      }
      
      // 방법 3: 모든 .chat-log 요소 찾아서 가장 큰 것 선택
      if (!chatLog || chatLog.innerHTML.trim().length === 0) {
        const allChatLogs = document.querySelectorAll('.chat-log');
        
        // 내부 HTML이 가장 긴 것을 선택
        let maxLength = 0;
        allChatLogs.forEach(log => {
          if (log.innerHTML.length > maxLength) {
            maxLength = log.innerHTML.length;
            chatLog = log;
            // chatScroll도 함께 찾기
            chatScroll = log.closest('.chat-scroll');
          }
        });
      }
      
      if (!chatLog) {
        ui.notifications.error(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Error.NotFound'));
        return;
      }
      
      // 모든 메시지가 로드될 때까지 대기
      const allLoaded = await waitForAllMessagesLoaded(chatLog, chatScroll);
      
      if (!allLoaded) {
        // 일부만 로드된 경우 경고
        const renderedCount = countRenderedMessages(chatLog);
        ui.notifications.warn(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Warning.PartialLoad', {
          rendered: renderedCount,
          total: totalMessageCount
        }));
      }
      
      // 최종 확인: 메시지 수가 일치하는지 확인
      const finalRenderedCount = countRenderedMessages(chatLog);
      if (finalRenderedCount < totalMessageCount) {
        ui.notifications.warn(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Warning.CountMismatch', {
          rendered: finalRenderedCount,
          total: totalMessageCount
        }));
      }
      
      // 전체 chat-log의 innerHTML을 사용 (ol 태그 안의 내용만)
      let chatLogHTML = chatLog.innerHTML;
      
      if (!chatLogHTML || chatLogHTML.trim().length === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return;
      }
      
      // 챗 머지 처리: 추출된 HTML에서 머지 조건 확인 및 클래스 추가
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = chatLogHTML;
      const messages = tempDiv.querySelectorAll('.chat-message');
      
      let prevUserId = null;
      let prevPortraitSrc = null;
      let prevActorId = null;
      let prevHasNarratorCard = false;
      /** 직전에 시스템 전용(export 제외) 메시지였으면 true — 다음 메시지와 머지하지 않음 */
      let prevSystemExportBreak = false;
      
      messages.forEach((messageEl) => {
        const messageId = messageEl.getAttribute('data-message-id');
        if (!messageId) return;
        
        const message = game.messages.get(messageId);
        if (!message) return;
        
        // 플래그에서 정보 가져오기
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};
        const currentUserId = flags.userId || message.author?.id;
        const currentActorId = flags.actorId || message.speaker?.actor || null;
        const portraitImg = messageEl.querySelector('.lichsoma-chat-portrait');
        const currentPortraitSrc = flags.portraitSrc || portraitImg?.getAttribute('src') || null;
        
        // 자신의 메시지인지 확인하고 클래스 추가
        const isOwnMessage = currentUserId === game.user.id;
        if (isOwnMessage) {
          messageEl.classList.add('lichsoma-own-message');
        } else {
          messageEl.classList.remove('lichsoma-own-message');
        }
        
        // <hr> 전용 메시지: 머지하지 않고 이후 체인 끊기 (ChatMerge._processAllMessages 와 동일)
        if (isOnlyHrMessageContent(messageEl)) {
          messageEl.classList.add('lichsoma-hr-only');
          messageEl.classList.remove('lichsoma-merged');
          prevUserId = null;
          prevPortraitSrc = null;
          prevActorId = null;
          prevHasNarratorCard = false;
          prevSystemExportBreak = false;
          return;
        }
        messageEl.classList.remove('lichsoma-hr-only');
        
        // 메신저 메시지 (lichsoma-fvtt-smartphone): 머지 체인 끊기
        const isMessengerMessage = message.flags?.['lichsoma-fvtt-smartphone']?.type === 'messenger-message';
        if (isMessengerMessage) {
          messageEl.classList.add('lichsoma-messenger-message');
          messageEl.classList.remove('lichsoma-merged');
          prevUserId = null;
          prevPortraitSrc = null;
          prevActorId = null;
          prevHasNarratorCard = false;
          prevSystemExportBreak = false;
          return;
        }
        messageEl.classList.remove('lichsoma-messenger-message');

        // 시스템별 내보내기 머지 제외 — ChatMerge 의 ChatSystemBridge.export 와 동일 소스
        if (chatSystemExportExcludeCurrent(message, messageEl)) {
          messageEl.classList.remove('lichsoma-merged');
          prevUserId = null;
          prevPortraitSrc = null;
          prevActorId = null;
          prevHasNarratorCard = false;
          prevSystemExportBreak = true;
          return;
        }
        
        // narrator-card 확인
        const messageContent = messageEl.querySelector('.message-content');
        const hasNarratorCard = messageContent && messageContent.innerHTML.includes('narrator-card');
        
        if (hasNarratorCard) {
          messageEl.classList.add('lichsoma-narrator-card');
          messageEl.classList.remove('lichsoma-merged');
          // narrator-card 메시지는 머지하지 않음
          prevUserId = null;
          prevPortraitSrc = null;
          prevActorId = null;
          prevHasNarratorCard = true;
          prevSystemExportBreak = false;
        } else {
          messageEl.classList.remove('lichsoma-narrator-card');
          
          // 머지 조건 확인 (이전 메시지에 narrator-card가 없어야 함, actorId 일치 — ChatMerge 와 동일)
          if (prevUserId && 
              prevUserId === currentUserId && 
              prevPortraitSrc === currentPortraitSrc &&
              prevActorId === currentActorId &&
              currentPortraitSrc !== null &&
              !prevHasNarratorCard &&
              !prevSystemExportBreak) {
            messageEl.classList.add('lichsoma-merged');
          } else {
            messageEl.classList.remove('lichsoma-merged');
            prevUserId = currentUserId;
            prevPortraitSrc = currentPortraitSrc;
            prevActorId = currentActorId;
          }
          prevHasNarratorCard = false;
          prevSystemExportBreak = false;
        }
      });
      
      // 처리된 HTML 다시 가져오기
      chatLogHTML = tempDiv.innerHTML;
      
      // 설정 확인
      const useBase64 = game.settings.get('lichsoma-speaker-selector', 'chatLogExportUseBase64') || false;
      let basePath = game.settings.get('lichsoma-speaker-selector', 'chatLogExportBasePath') || '';
      const localHost = window.location.origin;
      
      // basePath가 공란일 경우 FoundryVTT 유저 데이터 경로 + /Data 사용
      if (!basePath || basePath.trim() === '') {
        basePath = localHost;
      }
      
      // Base64 변환이 활성화된 경우 이미지를 Base64로 변환
      let imageBase64CSS = ''; // CSS 변수로 저장할 base64 이미지들 (헤더 이미지용)
      let imageClassCSS = ''; // 각 이미지 클래스에 대한 CSS 규칙 (헤더 이미지용)
      if (useBase64) {
        // 모든 이미지 태그 찾기
        const tempDiv2 = document.createElement('div');
        tempDiv2.innerHTML = chatLogHTML;
        const images = tempDiv2.querySelectorAll('img[src]');
        
        // 이미지 URL -> Base64 변환 결과 캐시 (같은 이미지 중복 변환 방지)
        const imageCache = new Map();
        // 이미지 URL -> 해시 매핑 (헤더 이미지용, CSS 변수 참조)
        const imageHashMap = new Map();
        // 이미 추가된 CSS 클래스 추적 (중복 방지)
        const addedCSSClasses = new Set();
        
        // 동시 처리 제한 (너무 많은 fetch를 한꺼번에 날리면 일부가 실패/타임아웃될 수 있음)
        const MAX_CONCURRENT_IMAGE_FETCHES = 6;
        
        async function runWithConcurrencyLimit(items, limit, worker) {
          const queue = Array.from(items);
          const workers = Array.from({ length: Math.max(1, limit) }, async () => {
            while (queue.length) {
              const item = queue.shift();
              try {
                await worker(item);
              } catch (e) {
                // worker 내부에서 로그/폴백 처리하므로 여기서는 무시
              }
            }
          });
          await Promise.all(workers);
        }
        
        // 각 이미지를 Base64로 변환 (캐시 활용)
        const processOneImage = async (img) => {
          const src = img.getAttribute('src');
          if (!src) return;
          
          // 이미 base64인 경우 처리
          const isAlreadyBase64 = src.startsWith('data:');
          
          // 부모 요소 확인: 헤더 내 이미지 또는 message-content .item/.chat-card/.messenger-chat-message 내 이미지 또는 pf2e.chat-card 내 이미지인지 체크
          const parent = img.parentElement;
          const isInMessageContentItem = img.closest('.message-content .item') !== null;
          const isInMessageContentChatCard = img.closest('.message-content .chat-card') !== null;
          const isInMessageContentMessengerChatMessage = img.closest('.message-content .messenger-chat-message') !== null;
          const isInPf2eChatCard = img.closest('.pf2e.chat-card') !== null;
          const isHeaderImage = parent && (
            isInMessageContentItem ||
            isInMessageContentChatCard ||
            isInMessageContentMessengerChatMessage ||
            isInPf2eChatCard ||
            parent.closest('.message-header') ||
            parent.closest('.lichsoma-chat-header') ||
            parent.closest('.item-header') ||
            parent.classList.contains('message-header') ||
            parent.classList.contains('lichsoma-chat-header') ||
            parent.classList.contains('item-header')
          );
          /* Chat Portrait(앵커·스케일)는 <img>의 transform/object-fit 유지 — 배경화 최적화 경로 제외 */
          const isTokenFramedPortrait = img.classList.contains('lichsoma-chat-portrait--token-framed');

          try {
            let base64Url;
            const normalizedSrcForCache = isAlreadyBase64 ? src : normalizeImageUrl(src, localHost);
            
            if (isAlreadyBase64) {
              base64Url = src;
            } else {
              // 이미 처리된 URL인지 확인
              if (imageCache.has(normalizedSrcForCache)) {
                // 이미 변환된 경우 캐시에서 가져오기
                base64Url = imageCache.get(normalizedSrcForCache);
              } else {
                // 새로 변환
                base64Url = await imageUrlToBase64(src, localHost);
                imageCache.set(normalizedSrcForCache, base64Url);
              }
            }
            
            // Base64 변환에 실패했으면(base64가 아닌 값이 돌아오면) CSS 변수로 넣지 말고,
            // 저장된 HTML에서도 동작하도록 절대 URL로 강제하고 종료
            if (!base64Url || typeof base64Url !== 'string' || !base64Url.startsWith('data:')) {
              const abs = normalizeImageUrl(src, basePath || localHost);
              if (abs) img.setAttribute('src', abs);
              return;
            }
            
            // 원본 크기 정보 유지
            const originalWidth = img.getAttribute('width') || img.style.width || (img.offsetWidth > 0 ? img.offsetWidth + 'px' : null);
            const originalHeight = img.getAttribute('height') || img.style.height || (img.offsetHeight > 0 ? img.offsetHeight + 'px' : null);
            
            // Base64 문자열 크기 확인 (실제 데이터 부분만)
            // Base64는 원본보다 약 33% 크므로, Base64 문자열 길이로 원본 크기 추정
            // data:image/...;base64, 부분을 제외한 실제 데이터 길이 확인
            const base64DataMatch = base64Url.match(/^data:image\/[^;]+;base64,(.+)$/);
            const base64DataLength = base64DataMatch ? base64DataMatch[1].length : base64Url.length;
            // Base64 문자열 길이 * 3/4 = 원본 바이너리 크기 (대략)
            // 500KB 원본 = 약 666,667 바이트 Base64 데이터
            const estimatedOriginalSize = (base64DataLength * 3) / 4;
            const isLargeImage = estimatedOriginalSize >= 500 * 1024; // 500KB 이상
            
            if (isHeaderImage && !isLargeImage && !isTokenFramedPortrait) {
              // 헤더 이미지 (500KB 미만): CSS 변수 + background-image로 처리 (중복 제거)
              let imageHash;
              
              if (imageHashMap.has(base64Url)) {
                imageHash = imageHashMap.get(base64Url);
              } else {
                // 해시 생성 (base64 URL 기반)
                imageHash = simpleHash(base64Url);
                imageHashMap.set(base64Url, imageHash);
                
                // CSS 변수 정의 추가 (한 번만)
                const cssVarName = `--img-${imageHash}`;
                imageBase64CSS += `\n            ${cssVarName}: url("${base64Url}");`;
              }
              
              // 이미지에 클래스 추가
              const className = `base64-img-${imageHash}`;
              img.classList.add(className);
              
              // CSS 규칙 추가 (한 번만)
              if (!addedCSSClasses.has(className)) {
                addedCSSClasses.add(className);
                const widthStyle = originalWidth ? `width: ${originalWidth.toString().includes('px') ? originalWidth : originalWidth + 'px'};` : '';
                const heightStyle = originalHeight ? `height: ${originalHeight.toString().includes('px') ? originalHeight : originalHeight + 'px'};` : '';
                imageClassCSS += `\n        .${className} {\n            background-image: var(--img-${imageHash});\n            background-size: contain;\n            background-repeat: no-repeat;\n            background-position: center;\n            display: inline-block;${widthStyle ? '\n            ' + widthStyle : ''}${heightStyle ? '\n            ' + heightStyle : ''}\n        }`;
              }
              
              // 크기 정보 저장
              if (originalWidth) {
                img.setAttribute('data-width', originalWidth);
                if (!img.style.width) img.style.width = originalWidth.toString().includes('px') ? originalWidth : originalWidth + 'px';
              }
              if (originalHeight) {
                img.setAttribute('data-height', originalHeight);
                if (!img.style.height) img.style.height = originalHeight.toString().includes('px') ? originalHeight : originalHeight + 'px';
              }
              
              // 1x1 투명 픽셀을 src로 설정 (background-image가 보이도록)
              img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            } else {
              // 일반 이미지 또는 헤더 이미지(500KB 이상): src에 직접 Base64 설정
              img.setAttribute('src', base64Url);
              
              // 원본 크기 정보 유지
              if (originalWidth) {
                img.setAttribute('data-width', originalWidth);
                if (!img.style.width) img.style.width = originalWidth.toString().includes('px') ? originalWidth : originalWidth + 'px';
              }
              if (originalHeight) {
                img.setAttribute('data-height', originalHeight);
                if (!img.style.height) img.style.height = originalHeight.toString().includes('px') ? originalHeight : originalHeight + 'px';
              }
            }
          } catch (error) {
            console.warn(`이미지 Base64 변환 실패: ${src}`, error);
            // 실패 시 원본 URL 유지하거나 basePath 추가
            if (!src.startsWith('http') && !src.startsWith('//') && !src.startsWith('data:')) {
              const fullPath = src.startsWith('/') ? src : '/' + src;
              img.setAttribute('src', `${basePath}${fullPath}`);
            }
          }
        };
        
        // 모든 이미지 변환 완료 대기 (동시성 제한 적용)
        await runWithConcurrencyLimit(images, MAX_CONCURRENT_IMAGE_FETCHES, processOneImage);
        chatLogHTML = tempDiv2.innerHTML;
      } else {
        // Base64 변환이 비활성화된 경우 기존 방식대로 링크 처리
        chatLogHTML = chatLogHTML.replace(
          /src="([^"]*)"/g, 
          (match, srcPath) => {
            // 이미 절대 URL이거나 로컬 호스트가 포함된 경우 그대로 유지
            if (srcPath.startsWith('http') || srcPath.startsWith('//') || srcPath.includes(localHost) || srcPath.startsWith('data:')) {
              return match;
            }
            // 상대 경로인 경우 설정된 경로 추가
            const fullPath = srcPath.startsWith('/') ? srcPath : '/' + srcPath;
            return `src="${basePath}${fullPath}"`;
          }
        );
      }
      
      // FoundryVTT의 CSS 변수에서 색상 가져오기
      const computedStyle = getComputedStyle(document.documentElement);
      const backgroundColor = computedStyle.getPropertyValue('--color-cool-5').trim() || '#1e1e1e';
      const textColor = computedStyle.getPropertyValue('--color-text-primary').trim() || '#ffffff';
      const borderColor = computedStyle.getPropertyValue('--color-primary').trim() || '#4a90e2';
      const secondaryTextColor = computedStyle.getPropertyValue('--color-text-secondary').trim() || '#c9c9c9';
      
      // CSS 파일 내용 읽기 (인라인으로 포함)
      let cssContent = '';
      try {
        const module = game.modules.get('lichsoma-speaker-selector');
        if (module) {
          // 모듈 URL 경로 구성 - CSS는 모듈 내 정적 파일이므로 basePath 무시하고 항상 Foundry VTT 서버 경로 사용
          const cssPath = `modules/lichsoma-speaker-selector/styles/lichsoma-chat-log-export.css`;
          const fullCssPath = `${localHost}${cssPath.startsWith('/') ? cssPath : '/' + cssPath}`;
          
          const response = await fetch(fullCssPath);
          if (response.ok) {
            cssContent = await response.text();
            
            // 주사위 툴팁 표시 설정 확인
            const showDiceTooltip = game.settings.get('lichsoma-speaker-selector', 'chatLogExportShowDiceTooltip') || false;
            if (!showDiceTooltip) {
              // 설정이 false이면 .dice-tooltip { display: none; } 추가
              // 이미 CSS에 있는 경우를 대비해 제거 후 추가
              cssContent = cssContent.replace(/\.dice-tooltip\s*\{[^}]*display:\s*none[^}]*\}/g, '');
              cssContent += '\n\n.dice-tooltip {\n  display: none;\n}';
            } else {
              // 설정이 true이면 .dice-tooltip { display: none; } 제거
              cssContent = cssContent.replace(/\.dice-tooltip\s*\{[^}]*display:\s*none[^}]*\}/g, '');
            }
          }
        }
      } catch (e) {
        // CSS 파일 로드 실패 (무시)
      }
      
      // 커스텀 CSS 가져오기
      let customCSS = '';
      try {
        customCSS = game.settings.get('lichsoma-speaker-selector', 'chatLogExportCustomCSS') || '';
        if (customCSS.trim()) {
          customCSS = `\n\n/* 커스텀 CSS */\n${customCSS}`;
        }
      } catch (e) {
        // 커스텀 CSS 로드 실패 (무시)
      }
      
      // 확장 모듈 CSS 수집
      let extensionCSS = '';
      try {
        // 모든 등록된 훅 함수 호출하여 결과 수집
        const hookFunctions = Hooks.events['lichsoma-speaker-selector.chatLogExportAdditionalCSS'] || [];
        
        if (hookFunctions.length > 0) {
          const cssPromises = hookFunctions.map(async (hookFn) => {
            try {
              const result = hookFn.fn();
              // Promise인 경우 await
              if (result && typeof result.then === 'function') {
                return await result;
              }
              return result || '';
            } catch (error) {
              console.warn('확장 모듈 CSS 훅 실행 오류:', error);
              return '';
            }
          });
          
          const cssResults = await Promise.all(cssPromises);
          extensionCSS = cssResults.filter(css => css && typeof css === 'string' && css.trim()).join('\n\n');
          
          if (extensionCSS.trim()) {
            extensionCSS = `\n\n/* 확장 모듈 CSS */\n${extensionCSS}`;
          }
        }
      } catch (e) {
        console.warn('확장 모듈 CSS 로드 실패:', e);
        // 확장 모듈 CSS 로드 실패 (무시)
      }
      
      // 확장 모듈 HTML 변환 적용
      try {
        // 모든 등록된 훅 함수 호출하여 HTML 변환
        const htmlHookFunctions = Hooks.events['lichsoma-speaker-selector.chatLogExportHTMLTransform'] || [];
        
        if (htmlHookFunctions.length > 0) {
          // 각 훅 함수를 순차적으로 적용 (이전 결과를 다음 훅에 전달)
          for (const hookFn of htmlHookFunctions) {
            try {
              const result = hookFn.fn(chatLogHTML);
              // Promise인 경우 await
              if (result && typeof result.then === 'function') {
                chatLogHTML = await result;
              } else if (result && typeof result === 'string') {
                chatLogHTML = result;
              }
              // 결과가 없거나 유효하지 않은 경우 기존 HTML 유지
            } catch (error) {
              console.warn('확장 모듈 HTML 변환 훅 실행 오류:', error);
              // 오류 발생 시 기존 HTML 유지
            }
          }
        }
      } catch (e) {
        console.warn('확장 모듈 HTML 변환 로드 실패:', e);
        // 확장 모듈 HTML 변환 실패 (무시)
      }
      
      // 각 <li></li> 단위로 자르고 주석으로 구분
      function splitChatMessagesByLi(html) {
        // 임시 div로 파싱
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 모든 <li> 요소 찾기
        const liElements = tempDiv.querySelectorAll('li.chat-message');
        
        if (liElements.length === 0) {
          // <li> 요소가 없으면 원본 반환
          return html;
        }
        
        // 각 <li> 요소를 문자열로 변환하고 주석 추가
        let result = '';
        liElements.forEach((li, index) => {
          // 메시지 ID 추출
          const messageId = li.getAttribute('data-message-id') || '';
          const messageIndex = index + 1;
          
          // 주석 추가 (첫 번째 메시지가 아니면 앞에 주석 추가)
          if (index > 0) {
            result += `\n            <!-- ========== 메시지 ${messageIndex} (ID: ${messageId}) ========== -->\n`;
          } else {
            result += `            <!-- ========== 메시지 ${messageIndex} (ID: ${messageId}) ========== -->\n`;
          }
          
          // <li> 요소를 문자열로 변환
          result += '            ' + li.outerHTML;
          
          // 마지막 메시지가 아니면 뒤에 주석 추가
          if (index < liElements.length - 1) {
            result += `\n            <!-- ========== 메시지 ${messageIndex} 끝 ========== -->`;
          } else {
            result += `\n            <!-- ========== 메시지 ${messageIndex} 끝 ========== -->`;
          }
        });
        
        return result;
      }
      
      // chatLogHTML을 <li> 단위로 분리하고 주석 추가
      const separatedChatLogHTML = splitChatMessagesByLi(chatLogHTML);
      
      // HTML 문서 생성
      const htmlContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Foundry VTT Chat Log</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <style>
        :root {
            --export-bg-color: ${backgroundColor};
            --export-text-color: ${textColor};
            --export-border-color: ${borderColor};
            --export-secondary-text-color: ${secondaryTextColor};${imageBase64CSS}
        }
        /* 헤더 이미지를 위한 CSS 변수 참조 스타일 */
        ${imageClassCSS}
        /* 나레이터 카드 스타일 */
        .chat-log .chat-message.lichsoma-narrator-card .lichsoma-chat-header {
          display: none !important;
        }
        .chat-log .chat-message.lichsoma-hr-only .message-header {
          display: none !important;
        }
        .chat-message .message-content .narrator-card {
          font-style: italic;
          font-weight: bold;
          text-align: center;
        }
        ${customCSS}${cssContent}${extensionCSS}
    </style>
</head>
<body>
    <div class="chat-outer">
        <h1 class="log-title">Foundry VTT Chat Log</h1>
        <p class="timestamp">${new Date().toLocaleString()}</p>
        <ol class="chat-log plain themed theme-light">
${separatedChatLogHTML}
        </ol>
    </div>
</body>
</html>`;
      
      // 파일명 생성
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `chat-log-${timestamp}.html`;
      
      // Foundry VTT의 saveDataToFile API 사용
      if (typeof foundry !== 'undefined' && foundry.utils && foundry.utils.saveDataToFile) {
        foundry.utils.saveDataToFile(htmlContent, 'text/html', fileName);
      } else if (typeof saveDataToFile !== 'undefined') {
        saveDataToFile(htmlContent, 'text/html', fileName);
      } else {
        // Fallback: Blob 사용
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      
      // 메시지 개수 계산 (li 태그 개수)
      const messageCount = (chatLogHTML.match(/<li class="chat-message/g) || []).length;
      
      ui.notifications.info(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Success', { count: messageCount }));
      
    } catch (error) {
      ui.notifications.error(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Error.ExportFailed'));
    }
  }
  
  // ========== 채팅 로그 저장 기능 차단 및 HTML 출력 ========== //
  
  // capture phase에서 이벤트 차단 (가장 먼저 실행)
  document.addEventListener('click', async function(event) {
    // 모든 클릭 대상 확인
    const target = event.target;
    const button = target.closest('button, a');
    
    if (!button) return;
    
    // fa-floppy-disk 아이콘 확인
    const hasFloppyDisk = button.querySelector('.fa-floppy-disk') || 
                          button.classList.contains('fa-floppy-disk');
    
    if (hasFloppyDisk) {
      // 채팅 관련 영역인지 확인
      const chatArea = button.closest('section#chat, .chat-sidebar, .chat-scroll, [data-tab="chat"]');
      
      if (chatArea) {
        // 이벤트 완전히 차단
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // HTML 저장 함수 호출
        await exportChatLogAsHTML();
        
        return false;
      }
    }
  }, true); // capture phase - 가장 먼저 실행
  
  Hooks.once('ready', () => {
    // 채팅 로그 내보내기 기능 초기화 완료
  });
})();

