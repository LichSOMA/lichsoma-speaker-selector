import {
  escapeCssString,
  extractWebfontPresentation
} from './lichsoma-shared-utils.js';
import { ChatSystemBridge } from './lichsoma-chat-system-registry.js';
import { renderSystemChatMessage } from './lichsoma-chat-message-render.js';
import { withChatRenderContext } from './lichsoma-chat-render-pipeline.js';
import { SpeakerSelector } from './lichsoma-speaker-selector.js';
import { getChatTheme, getChatThemeClass } from './lichsoma-chat-theme.js';
import { createExportImagePipeline, normalizeExportImageUrl, buildExportImageRestoreScript } from './lichsoma-chat-export-images.js';
// LichSOMA Speaker Selector - Chat Log Export
// 채팅 로그를 HTML로 저장하는 기능
(function() {
  'use strict';

  let chatExportObserver = null;
  let observedChatExportContainer = null;
  let chatLogExportInProgress = false;
  
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** @see scripts/lichsoma-chat-system-registry.js — 시스템 모듈이 등록한 내보내기 머지 제외 규칙 */
  function chatSystemExportExcludeCurrent(message, element) {
    return ChatSystemBridge.export.excludeCurrent(message, element) === true;
  }

  function chatSystemExportExcludePrevious(message, element) {
    return ChatSystemBridge.export.excludePrevious(message, element) === true;
  }


  function getExportMergeMeta(message, messageEl) {
    const flags = message?.flags?.['lichsoma-speaker-selector'] || {};
    const speaker = message?.speaker || {};

    const userId = flags.userId || message?.author?.id || null;

    const portraitImg = messageEl?.querySelector?.('.lichsoma-chat-portrait');
    const systemPortraitSrc = ChatSystemBridge.export.mergePortraitSrc(message, messageEl);
    const portraitSrc = flags.emotionPortrait
      || flags.portraitSrc
      || portraitImg?.getAttribute?.('src')
      || systemPortraitSrc
      || null;

    const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', 'alwaysUseActor') === true;
    const tokenId = flags.tokenId || speaker.token || null;
    const actorId = flags.actorId || speaker.actor || null;

    let mergeSpeakerId = flags.mergeSpeakerId || null;
    let mergeSpeakerType = flags.mergeSpeakerType || null;

    if (!mergeSpeakerId) {
      if (!alwaysUseActor && tokenId) {
        mergeSpeakerId = tokenId;
        mergeSpeakerType = mergeSpeakerType || 'token';
      } else if (actorId) {
        mergeSpeakerId = actorId;
        mergeSpeakerType = mergeSpeakerType || 'actor';
      }
    }

    if (!mergeSpeakerId && userId) {
      mergeSpeakerId = userId;
      mergeSpeakerType = 'user';
    }

    if (!mergeSpeakerType) {
      if ((tokenId && mergeSpeakerId === tokenId) || (speaker.token && mergeSpeakerId === speaker.token)) {
        mergeSpeakerType = 'token';
      } else if (actorId && mergeSpeakerId === actorId) {
        mergeSpeakerType = 'actor';
      } else if (userId && mergeSpeakerId === userId) {
        mergeSpeakerType = 'user';
      } else {
        mergeSpeakerType = 'actor';
      }
    }

    return {
      userId,
      portraitSrc,
      mergeSpeakerId,
      mergeSpeakerType
    };
  }

  function isValidExportMergeMeta(meta) {
    return !!(
      meta &&
      meta.userId &&
      meta.portraitSrc &&
      meta.mergeSpeakerId &&
      meta.mergeSpeakerType
    );
  }

  function canExportMerge(currentMeta, previousMeta) {
    if (!isValidExportMergeMeta(currentMeta) || !isValidExportMergeMeta(previousMeta)) return false;

    return currentMeta.userId === previousMeta.userId &&
      currentMeta.portraitSrc === previousMeta.portraitSrc &&
      currentMeta.mergeSpeakerId === previousMeta.mergeSpeakerId &&
      currentMeta.mergeSpeakerType === previousMeta.mergeSpeakerType;
  }
  
  function getSettingSafe(key, fallback = '') {
    try {
      return game.settings.get('lichsoma-speaker-selector', key) ?? fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getHookCallback(hookEntry) {
    if (typeof hookEntry === 'function') return hookEntry;
    if (typeof hookEntry?.fn === 'function') return hookEntry.fn;
    if (typeof hookEntry?.callback === 'function') return hookEntry.callback;
    return null;
  }

  async function runHookEntry(hookEntry, ...args) {
    const fn = getHookCallback(hookEntry);
    if (!fn) return undefined;
    const result = fn(...args);
    if (result && typeof result.then === 'function') return await result;
    return result;
  }

  function buildChatLogExportWebfontCSS() {
    const settings = {
      header: getSettingSafe('chatHeaderWebfontCSS', ''),
      message: getSettingSafe('chatMessageWebfontCSS', ''),
      dice: getSettingSafe('chatDiceWebfontCSS', ''),
      narrator: getSettingSafe('narratorWebfontCSS', '')
    };

    const parts = [];
    const uniqueCSS = [...new Set(Object.values(settings).map(css => String(css ?? '').trim()).filter(Boolean))];
    if (uniqueCSS.length) {
      parts.push(`/* Shared in-game/export webfonts */\n${uniqueCSS.join('\n\n')}`);
    }

    const profiles = Object.fromEntries(
      Object.entries(settings).map(([key, css]) => [key, extractWebfontPresentation(css)])
    );
    const rules = [];
    const declarationsFor = (profile, defaults = {}, { family = true } = {}) => {
      const declarations = [];
      if (family && profile?.family) declarations.push(`font-family: "${escapeCssString(profile.family)}", sans-serif`);
      const weight = profile?.weight || defaults.weight || '';
      const style = profile?.style || defaults.style || '';
      if (weight) declarations.push(`font-weight: ${weight}`);
      if (style) declarations.push(`font-style: ${style}`);
      if (profile?.variationSettings) declarations.push(`font-variation-settings: ${profile.variationSettings}`);
      return declarations;
    };
    const addRule = (selectors, declarations, { important = true } = {}) => {
      if (!declarations.length) return;
      const suffix = important ? ' !important' : '';
      rules.push(`${selectors} {\n  ${declarations.map(value => `${value}${suffix}`).join(';\n  ')};\n}`);
    };

    const headerSelectors = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .lichsoma-chat-header .message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message.lichsoma-export-fallback > .message-header .message-sender`;
    addRule(headerSelectors, declarationsFor(profiles.header, {}, { family: true }).filter(value => value.startsWith('font-family:')));
    addRule(headerSelectors, declarationsFor(profiles.header, { weight: '900', style: 'normal' }, { family: false }));

    addRule(
      `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log :is(.lichsoma-simple-text-payload, .lichsoma-export-fallback) > .message-content`,
      declarationsFor(profiles.message, { weight: '500', style: 'normal' })
    );

    addRule(
      `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .dice-roll.lichsoma-core-dice :where(.dice-formula, .dice-total, .dice-tooltip, .dice-flavor)`,
      declarationsFor(profiles.dice),
      { important: false }
    );

    addRule(
      `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .lichsoma-narrator-card .narrator-card`,
      declarationsFor(profiles.narrator, { weight: '500', style: 'italic' })
    );

    if (rules.length) parts.push(`/* Shared webfont application */\n${rules.join('\n\n')}`);
    return parts.length ? `\n\n/* HTML 내보내기 웹폰트 */\n${parts.join('\n\n')}` : '';
  }

  /** ChatMerge._isOnlyHrMessage 와 동일: ProseMirror의 `<p><hr></p>` 등도 구분선 전용으로 처리 */
  function isOnlyHrMessageContent(messageEl) {
    const messageContent = messageEl.querySelector('.message-content');
    if (!messageContent) return false;
    const htmlContent = messageContent.innerHTML || '';
    const withoutHr = htmlContent.replace(/<hr\s*\/?>/gi, '');

    // 텍스트가 없어도 "콘텐츠"가 있으면 hr-only가 아님 (이미지/임베드/비디오 등)
    // - 기존 구현은 태그를 전부 제거해서 <img>만 있는 메시지를 hr-only로 오판했다.
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = withoutHr;
      const hasNonTextContent = !!tmp.querySelector(
        'img, video, audio, iframe, embed, object, canvas, picture, svg, source'
      );
      if (hasNonTextContent) return false;
    } catch (e) {
      // DOM 파싱 실패 시 기존 텍스트 판정으로 fallback
    }

    const textOnly = withoutHr.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    return textOnly === '';
  }


  function hasNarratorCard(messageEl) {
    return !!messageEl?.querySelector?.('.message-content .narrator-card');
  }

  function isMessengerMessage(message) {
    const type = message?.flags?.['lichsoma-fvtt-smartphone']?.type;
    return type === 'messenger-message' || type === 'sns-dm-message';
  }

  function getExportBodyClasses(theme = getChatTheme()) {
    const classes = ['lichsoma-chat-log-export', getChatThemeClass(theme)];

    const systemId = game.system?.id || '';
    if (systemId) classes.push(`system-${systemId}`);

    const generation = Number(game.release?.generation ?? game.version?.split?.('.')?.[0] ?? 0);
    if (generation && generation <= 13) {
      classes.push('lichsoma-fvtt13-chat');
    } else if (generation >= 14) {
      classes.push('lichsoma-fvtt14-chat');
    }

    try {
      for (const cls of document.body?.classList || []) {
        if (/^theme-/.test(cls)) classes.push(cls);
      }
    } catch (e) {
      // body class 수집 실패 시 기본 class만 사용한다.
    }

    classes.push(...ChatSystemBridge.export.bodyClasses());
    return Array.from(new Set(classes.filter(Boolean))).join(' ');
  }

  // game.messages의 ChatMessage 문서를 기준으로 내보내기용 HTML을 새로 렌더링한다.
  // 기존 방식처럼 현재 사이드바의 .chat-log DOM, 스크롤 위치, 가상 렌더링 상태에 의존하지 않는다.
  function escapeHTML(value) {
    const text = String(value ?? '');
    try {
      if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
    } catch (e) {
      // fallback below
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function isExportableMessage(message) {
    if (!message) return false;
    try {
      if (message.visible === false) return false;
    } catch (e) {
      // visible getter가 실패하면 렌더링 시도에 맡긴다.
    }
    return true;
  }

  function getSortedChatMessages() {
    const collection = game.messages?.contents ?? [];
    return collection
      .filter(isExportableMessage)
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        const ta = Number(a.message.timestamp ?? 0);
        const tb = Number(b.message.timestamp ?? 0);
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return a.index - b.index;
      })
      .map(entry => entry.message);
  }

  function normalizeRenderedChatMessageElement(rendered, message) {
    let root = rendered;

    // 일부 API/모듈 호환: jQuery 형태가 들어와도 HTMLElement로 정규화
    if (root?.jquery) root = root[0];

    if (root instanceof DocumentFragment) {
      root = root.querySelector?.('.chat-message') || root.firstElementChild;
    }

    if (!(root instanceof HTMLElement)) return null;

    const messageEl = root.matches?.('.chat-message')
      ? root
      : root.querySelector?.('.chat-message');

    if (!(messageEl instanceof HTMLElement)) return null;

    if (message?.id) {
      messageEl.setAttribute('data-message-id', message.id);
    }

    return messageEl;
  }

  function formatExportMessageTimestamp(timestamp) {
    if (timestamp === null || timestamp === undefined || timestamp === '') return '';
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';

    const pad2 = value => String(value).padStart(2, '0');
    const year = pad2(date.getFullYear() % 100);
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hour = pad2(date.getHours());
    const minute = pad2(date.getMinutes());
    return `${year}.${month}.${day}.${hour}.${minute}`;
  }

  function applyExportMessageTimestamp(message, messageElement) {
    if (!(messageElement instanceof HTMLElement)) return;

    const timestamp = message?.timestamp;
    const formatted = formatExportMessageTimestamp(timestamp);
    if (!formatted) return;

    const timestampElements = messageElement.querySelectorAll('.message-timestamp');
    for (const timestampElement of timestampElements) {
      timestampElement.textContent = formatted;
      try {
        timestampElement.setAttribute('datetime', new Date(Number(timestamp)).toISOString());
      } catch (_error) {
        // Invalid values are already filtered by formatExportMessageTimestamp().
      }
    }
  }

  function renderFallbackChatMessageElement(message) {
    const li = document.createElement('li');
    li.className = 'chat-message message flexcol lichsoma-export-fallback';
    if (message?.id) li.setAttribute('data-message-id', message.id);

    const alias = message?.speaker?.alias || message?.alias || message?.author?.name || 'Unknown';
    const content = message?.content ?? '';
    const timestamp = formatExportMessageTimestamp(message?.timestamp);

    li.innerHTML = `
      <header class="message-header flexrow">
        <h4 class="message-sender">${escapeHTML(alias)}</h4>
        <span class="message-metadata">
          <time class="message-timestamp">${escapeHTML(timestamp)}</time>
        </span>
      </header>
      <div class="message-content">${content}</div>
    `;

    applyExportMessageTimestamp(message, li);
    return li;
  }

  async function renderChatMessageForExport(message) {
    try {
      if (typeof message?.renderHTML !== 'function' && typeof message?.getHTML !== 'function') {
        return renderFallbackChatMessageElement(message);
      }

      // Isolate this render from all live-ChatLog-only processors. The context is
      // associated with this specific ChatMessage object, so live messages which render
      // concurrently are not affected.
      const rendered = await withChatRenderContext(message, { mode: 'export' }, () => renderSystemChatMessage(message, {
        canDelete: false,
        canClose: false
      }));

      const element = normalizeRenderedChatMessageElement(rendered, message)
        || renderFallbackChatMessageElement(message);

      // Apply the presentation required by the standalone export explicitly and await it.
      // This removes the old race where portrait work continued in timers/promises after
      // message.renderHTML() had already returned.
      try {
        await SpeakerSelector.prepareMessageElementForExport(message, element);
      } catch (error) {
        console.warn('[lichsoma-speaker-selector] Export presentation preparation failed:', message?.id, error);
      }

      // Foundry renders relative labels such as "2 hours ago" in message headers.
      // Standalone logs use a stable local absolute timestamp instead.
      applyExportMessageTimestamp(message, element);
      return element;
    } catch (error) {
      console.warn('[lichsoma-speaker-selector] ChatMessage.renderHTML() 실패, fallback HTML 사용:', message?.id, error);
      return renderFallbackChatMessageElement(message);
    }
  }

  const CHAT_EXPORT_BATCH_SIZE = 200;

  async function buildChatLogBatch(messages, globalStartIndex = 0) {
    const container = document.createElement('div');
    let count = 0;

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const element = await renderChatMessageForExport(message);
      if (element) {
        container.appendChild(element);
        count += 1;
      }

      // 대용량 로그에서도 UI가 완전히 멈춰 보이지 않도록 주기적으로 이벤트 루프에 양보한다.
      if ((globalStartIndex + index + 1) % 50 === 0) await sleep(0);
    }

    return { container, count };
  }

  function applyExportMergeState(logContainer, previousState = null) {
    let prevMeta = previousState?.meta ?? null;
    let prevMessage = previousState?.message ?? null;
    let prevElement = previousState?.element ?? null;
    const messageElements = logContainer.querySelectorAll('.chat-message');

    const clearPrevious = () => {
      prevMeta = null;
      prevMessage = null;
      prevElement = null;
    };

    const setPrevious = (message, element, meta) => {
      if (!isValidExportMergeMeta(meta)) {
        clearPrevious();
        return;
      }
      prevMeta = meta;
      prevMessage = message;
      prevElement = element;
    };

    for (const messageEl of messageElements) {
      const messageId = messageEl.getAttribute('data-message-id');
      if (!messageId) {
        messageEl.classList.remove('lichsoma-merged');
        clearPrevious();
        continue;
      }

      const message = game.messages.get(messageId);
      if (!message) {
        messageEl.classList.remove('lichsoma-merged');
        clearPrevious();
        continue;
      }

      const currentMeta = getExportMergeMeta(message, messageEl);

      // 자신의 메시지인지 확인하고 클래스 추가
      const isOwnMessage = currentMeta.userId === game.user.id;
      messageEl.classList.toggle('lichsoma-own-message', isOwnMessage);

      // <hr> 전용 메시지: 머지하지 않고 이후 체인 끊기
      // 이미지/비디오 등 비텍스트 콘텐츠만 있는 메시지는 hr-only가 아니므로 머지 대상이 될 수 있다.
      if (isOnlyHrMessageContent(messageEl)) {
        messageEl.classList.add('lichsoma-hr-only');
        messageEl.classList.remove('lichsoma-merged');
        clearPrevious();
        continue;
      }
      messageEl.classList.remove('lichsoma-hr-only');

      // 메신저 메시지 (lichsoma-fvtt-smartphone): 머지 체인 끊기
      if (isMessengerMessage(message)) {
        messageEl.classList.add('lichsoma-messenger-message');
        messageEl.classList.remove('lichsoma-merged');
        clearPrevious();
        continue;
      }
      messageEl.classList.remove('lichsoma-messenger-message');

      // narrator-card 확인: 문자열 검색 대신 DOM query 사용
      if (hasNarratorCard(messageEl)) {
        messageEl.classList.add('lichsoma-narrator-card');
        messageEl.classList.remove('lichsoma-merged');
        clearPrevious();
        continue;
      }
      messageEl.classList.remove('lichsoma-narrator-card');

      // 시스템별 내보내기 머지 제외 규칙은 live merge와 동일하게 역할을 구분한다.
      // current 규칙은 현재 메시지에, previous 규칙은 실제 직전 메시지에 적용한다.
      const excludedCurrent = chatSystemExportExcludeCurrent(message, messageEl);
      const excludedPrevious = !!(
        prevMessage &&
        prevElement &&
        chatSystemExportExcludePrevious(prevMessage, prevElement)
      );

      const shouldMerge = !excludedCurrent &&
        !excludedPrevious &&
        canExportMerge(currentMeta, prevMeta);
      messageEl.classList.toggle('lichsoma-merged', shouldMerge);

      // 역할별 제외 규칙은 현재 메시지가 다음 메시지의 `previous` 후보가 되는 것까지
      // 막지 않는다. 다음 반복에서 exportExcludePrevious가 이 메시지를 다시 판정한다.
      setPrevious(message, messageEl, currentMeta);
    }

    return prevMessage && prevElement && prevMeta
      ? { message: prevMessage, element: prevElement, meta: prevMeta }
      : null;
  }

  async function runWithConcurrencyLimit(items, limit, worker) {
    const queue = Array.from(items);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), Math.max(1, queue.length));
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < queue.length) {
        const item = queue[nextIndex++];
        try {
          await worker(item);
        } catch (e) {
          // worker 내부에서 로그/폴백 처리한다.
        }
      }
    });
    await Promise.all(workers);
  }

  function normalizeImageCssLength(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return /^-?\d+(?:\.\d+)?$/.test(text) ? `${text}px` : text;
  }

  function preserveImageDimensions(img) {
    const originalWidth = img.getAttribute('width') || img.style.width || (img.offsetWidth > 0 ? `${img.offsetWidth}px` : null);
    const originalHeight = img.getAttribute('height') || img.style.height || (img.offsetHeight > 0 ? `${img.offsetHeight}px` : null);
    const widthStyle = normalizeImageCssLength(originalWidth);
    const heightStyle = normalizeImageCssLength(originalHeight);

    if (originalWidth) {
      img.setAttribute('data-width', originalWidth);
      if (!img.style.width && widthStyle) img.style.width = widthStyle;
    }
    if (originalHeight) {
      img.setAttribute('data-height', originalHeight);
      if (!img.style.height && heightStyle) img.style.height = heightStyle;
    }
  }

  async function applyHtmlTransformHooks(html, hookFunctions, context = {}, label = 'HTML 변환') {
    let transformed = html;
    for (const hookFn of hookFunctions) {
      try {
        const result = await runHookEntry(hookFn, transformed, context);
        if (result && typeof result === 'string') transformed = result;
      } catch (error) {
        console.warn(`확장 모듈 ${label} 훅 실행 오류:`, error);
      }
    }
    return transformed;
  }

  function splitChatMessagesByLi(html, startIndex = 0) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const liElements = Array.from(tempDiv.querySelectorAll('li.chat-message'));

    if (liElements.length === 0) return { html, count: 0 };

    const parts = [];
    liElements.forEach((li, index) => {
      const messageId = li.getAttribute('data-message-id') || '';
      const messageIndex = startIndex + index + 1;
      parts.push(`            <!-- ========== 메시지 ${messageIndex} (ID: ${messageId}) ========== -->`);
      parts.push(`            ${li.outerHTML}`);
      parts.push(`            <!-- ========== 메시지 ${messageIndex} 끝 ========== -->`);
    });

    return { html: parts.join('\n'), count: liElements.length };
  }

  // 채팅 로그 HTML로 저장하는 함수
  async function exportChatLogAsHTML({ notifyFailure = true, requireEmbeddedImages = false } = {}) {
    const exportTheme = getChatTheme();
    // 수천~수만 건의 내보내기는 오래 걸릴 수 있으므로 동시에 두 번째 작업이 시작되지 않게 막는다.
    if (chatLogExportInProgress) return false;
    chatLogExportInProgress = true;

    try {
      const totalMessageCount = game.messages.size;
      if (totalMessageCount === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return false;
      }

      // 현재 사이드바 DOM이나 스크롤 상태를 보지 않고 game.messages 문서를 직접 사용한다.
      const messagesToExport = getSortedChatMessages();
      if (messagesToExport.length === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return false;
      }

      // 설정 확인
      const useBase64 = game.settings.get('lichsoma-speaker-selector', 'chatLogExportUseBase64') || false;
      let basePath = game.settings.get('lichsoma-speaker-selector', 'chatLogExportBasePath') || '';
      const localHost = window.location.origin;

      // basePath가 공란일 경우 현재 Foundry VTT origin을 사용한다.
      if (!basePath || basePath.trim() === '') {
        basePath = localHost;
      }

      const imagePipeline = createExportImagePipeline({ baseUrl: localHost, preserveDimensions: preserveImageDimensions });
      async function processImagesInBatch(container) {
        if (useBase64) return imagePipeline.process(container);
        for (const img of container.querySelectorAll('img[src]')) {
          const url = normalizeExportImageUrl(img.getAttribute('src'), basePath);
          if (url) img.setAttribute('src', url);
        }
      }

      // FoundryVTT의 CSS 변수에서 색상 가져오기
      const computedStyle = getComputedStyle(document.documentElement);
      const backgroundColor = computedStyle.getPropertyValue('--color-cool-5').trim() || '#1e1e1e';
      const textColor = computedStyle.getPropertyValue('--color-text-primary').trim() || '#ffffff';
      const borderColor = computedStyle.getPropertyValue('--color-primary').trim() || '#4a90e2';
      const secondaryTextColor = computedStyle.getPropertyValue('--color-text-secondary').trim() || '#c9c9c9';
      const hideMessageTimestamps = getSettingSafe('chatLogExportHideTimestamps', true) !== false;

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

            // 명시적으로 숨기기를 선택한 경우에만 전체 tooltip을 감춘다.
            // 기본 CSS는 tooltip 가시성을 소유하지 않아 시스템 export 스타일을 보존한다.
            const showDiceTooltip = game.settings.get('lichsoma-speaker-selector', 'chatLogExportShowDiceTooltip') || false;
            if (!showDiceTooltip) {
              cssContent += '\n\n.dice-tooltip { display: none !important; }';
            }
          }
        }
      } catch (e) {
        // CSS 파일 로드 실패 (무시)
      }

      // 커스텀 CSS 가져오기
      let customCSS = '';
      try {
        customCSS = getSettingSafe('chatLogExportCustomCSS', '') || '';
        if (customCSS.trim()) {
          customCSS = `\n\n/* 커스텀 CSS */\n${customCSS}`;
        }
      } catch (e) {
        // 커스텀 CSS 로드 실패 (무시)
      }

      const exportWebfontCSS = buildChatLogExportWebfontCSS();
      let themeCSS = '';
      if (exportTheme !== 'dark-simple') {
        const response = await fetch('modules/lichsoma-speaker-selector/styles/lichsoma-chat-theme.css');
        if (!response.ok) throw new Error('Chat theme stylesheet could not be loaded.');
        themeCSS = await response.text();
      }

      // 확장 모듈 CSS 수집
      let extensionStyles = '';
      try {
        const hookFunctions = Hooks.events['lichsoma-speaker-selector.chatLogExportAdditionalCSS'] || [];

        if (hookFunctions.length > 0) {
          const cssPromises = hookFunctions.map(async (hookFn) => {
            try {
              const result = await runHookEntry(hookFn);
              return result || '';
            } catch (error) {
              console.warn('확장 모듈 CSS 훅 실행 오류:', error);
              return '';
            }
          });

          const cssResults = await Promise.all(cssPromises);
          // Each extension gets a style block so its leading @import remains valid.
          extensionStyles = cssResults.filter(css => css && typeof css === 'string' && css.trim())
            .map(css => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`).join('\n');
        }
      } catch (e) {
        console.warn('확장 모듈 CSS 로드 실패:', e);
      }

      // Speaker Selector가 소유하는 최종 export 헤더 정책.
      // 시스템별 추가 CSS 뒤에 배치해 메타데이터의 크기/정렬과 타임스탬프 가시성을 일관되게 유지한다.
      const exportHeaderPolicyCSS = `

/* Speaker Selector export header metadata policy */
.chat-log .chat-message .message-header .message-metadata {
  margin-left: auto;
  align-self: flex-end;
  align-items: flex-end;
  justify-content: flex-end;
  font-size: 12px;
  line-height: 1.2;
  text-align: right;
}
${hideMessageTimestamps ? `.chat-log .chat-message .message-timestamp { display: none !important; }` : ''}
`;

      // 기존 HTML 변환 훅 API는 그대로 유지한다. 등록된 변환이 모두 배치 안전하다고 명시된 경우에만
      // 200개 단위로 실행하고, 알 수 없는 외부 변환이 하나라도 있으면 기존처럼 전체 HTML에 순차 적용한다.
      const htmlTransformHooks = Hooks.events['lichsoma-speaker-selector.chatLogExportHTMLTransform'] || [];
      const allHtmlTransformsBatchSafe = htmlTransformHooks.length > 0 && htmlTransformHooks.every((hookEntry) => {
        const callback = getHookCallback(hookEntry);
        return callback?.lichsomaChatLogExportBatchSafe === true;
      });
      const chunkHtmlHookFunctions = allHtmlTransformsBatchSafe ? htmlTransformHooks : [];
      const legacyHtmlHookFunctions = allHtmlTransformsBatchSafe ? [] : htmlTransformHooks;

      let prevMergeState = null;
      let renderedCount = 0;
      let finalMessageCount = 0;
      const chatBodyParts = [];
      const legacyRawParts = legacyHtmlHookFunctions.length > 0 ? [] : null;
      const totalBatches = Math.ceil(messagesToExport.length / CHAT_EXPORT_BATCH_SIZE);

      for (let batchStart = 0, batchIndex = 0; batchStart < messagesToExport.length; batchStart += CHAT_EXPORT_BATCH_SIZE, batchIndex++) {
        const batchMessages = messagesToExport.slice(batchStart, batchStart + CHAT_EXPORT_BATCH_SIZE);
        const renderedBatch = await buildChatLogBatch(batchMessages, batchStart);
        const logContainer = renderedBatch.container;
        renderedCount += renderedBatch.count;

        // 직전 메시지의 머지 상태는 배치 밖에서 DOM 1개와 함께 유지한다.
        // 따라서 200번째와 201번째 메시지 사이에서도 current/previous 시스템 규칙을 구분할 수 있다.
        prevMergeState = applyExportMergeState(logContainer, prevMergeState);
        await processImagesInBatch(logContainer);

        let batchHTML = logContainer.innerHTML;
        // 직렬화가 끝난 즉시 원본 배치 DOM을 비워, 후속 HTML 변환/주석 파싱과 DOM이 겹치지 않게 한다.
        logContainer.replaceChildren();

        if (chunkHtmlHookFunctions.length > 0) {
          batchHTML = await applyHtmlTransformHooks(
            batchHTML,
            chunkHtmlHookFunctions,
            {
              batchIndex,
              batchNumber: batchIndex + 1,
              totalBatches,
              batchStart,
              batchEnd: batchStart + batchMessages.length,
              totalMessages: messagesToExport.length
            },
            '배치 HTML 변환'
          );
        }

        if (legacyRawParts) {
          // 배치 안전성이 확인되지 않은 기존 HTML 변환 훅이 있는 경우에만 raw HTML을 보관한다.
          legacyRawParts.push(batchHTML);
        } else {
          // 주석은 배치 직렬화 시점에 붙인다. 전체 로그를 다시 DOM으로 만들 필요가 없다.
          const separatedBatch = splitChatMessagesByLi(batchHTML, finalMessageCount);
          chatBodyParts.push(`${separatedBatch.html}\n`);
          finalMessageCount += separatedBatch.count;
        }

        await sleep(0);
      }

      if (renderedCount === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return false;
      }

      if (renderedCount < messagesToExport.length) {
        ui.notifications.warn(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Warning.CountMismatch', {
          rendered: renderedCount,
          total: messagesToExport.length
        }));
      }

      if (legacyRawParts) {
        // 기존 전체-HTML 변환 훅과의 호환 경로.
        // 배치 안전 표시가 있는 변환 훅만 존재하면 이 큰 문자열 경로를 사용하지 않는다.
        let legacyHTML = legacyRawParts.join('\n');
        legacyHTML = await applyHtmlTransformHooks(
          legacyHTML,
          legacyHtmlHookFunctions,
          { totalMessages: messagesToExport.length, legacyFullDocumentPass: true },
          'HTML 변환'
        );
        const separatedLog = splitChatMessagesByLi(legacyHTML, 0);
        chatBodyParts.push(`${separatedLog.html}\n`);
        finalMessageCount = separatedLog.count;
      }

      const imagePayloadParts = imagePipeline.payloadParts();
      const imageFailures = imagePipeline.failures;
      imagePipeline.release();
      const exportBodyClasses = getExportBodyClasses(exportTheme);
      const exportTimestamp = new Date().toLocaleString();
      // The log generation time is document metadata and is always shown.
      // The setting controls only per-message timestamps.
      const exportTimestampHTML = `<p class="timestamp">${escapeHTML(exportTimestamp)}</p>`;

      // 본문은 배치별 문자열 조각으로 유지한다.
      // Blob 조각을 전달해 대용량 이미지와 본문을 하나의 큰 JS 문자열로 복제하지 않는다.
      const htmlHeader = `
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
            --export-secondary-text-color: ${secondaryTextColor};
        }
        /* 나레이터 카드 스타일 */
        .chat-log .chat-message.lichsoma-narrator-card .lichsoma-chat-header {
          display: none !important;
        }
        .chat-log .chat-message.lichsoma-hr-only .message-header {
          display: none !important;
        }
        .lichsoma-narrator-card .narrator-card {
          font-style: italic;
          font-weight: 500;
          text-align: center;
        }
        ${customCSS}${cssContent}
    </style>
    ${extensionStyles}
    <style>
        ${exportHeaderPolicyCSS}${themeCSS}${exportWebfontCSS}
    </style>
</head>
<body class="${exportBodyClasses}">
    <div class="chat-outer">
        <h1 class="log-title">Foundry VTT Chat Log</h1>
        ${exportTimestampHTML}
        <ol id="chat-log" class="chat-log chat-scroll plain themed theme-light">
`;

      const htmlFooter = `

</body>
</html>`;

      // 전체 로그 DOM이나 거대한 문자열을 다시 만들지 않고 HTML 파일을 구성한다.
      const restoreScript = buildExportImageRestoreScript(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Error.ImageRestoreFailed'));
      const htmlContent = new Blob([htmlHeader, ...chatBodyParts, '</ol></div>',
        ...imagePayloadParts, '<script>', restoreScript, '</script>', htmlFooter],
        { type: 'text/html;charset=utf-8' });

      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `chat-log-${timestamp}.html`;

      // 기존 Foundry VTT 다운로드 방식을 그대로 사용한다. Promise를 반환하는 환경에서는 완료까지 대기한다.
      let saveResult;
      if (typeof foundry !== 'undefined' && foundry.utils && foundry.utils.saveDataToFile) {
        saveResult = foundry.utils.saveDataToFile(htmlContent, 'text/html', fileName);
      } else if (typeof saveDataToFile !== 'undefined') {
        saveResult = saveDataToFile(htmlContent, 'text/html', fileName);
      } else {
        // 기존 fallback 유지
        const url = URL.createObjectURL(htmlContent);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (saveResult && typeof saveResult.then === 'function') await saveResult;

      const messageCount = finalMessageCount || renderedCount;
      if (useBase64 && imageFailures.size) {
        const oversized = [...imageFailures.values()].filter(reason => reason === 'too-large').length;
        ui.notifications.warn(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Warning.ImagesNotEmbedded', {
          count: imageFailures.size, oversized
        }));
        console.warn('[lichsoma-speaker-selector] Images kept as external URLs:', Object.fromEntries(imageFailures));
        if (requireEmbeddedImages) return false;
      } else {
        ui.notifications.info(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Success', { count: messageCount }));
      }
      return true;

    } catch (error) {
      console.error('[lichsoma-speaker-selector] Chat log HTML export failed:', error);
      if (notifyFailure) ui.notifications.error(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Error.ExportFailed'));
      return false;
    } finally {
      chatLogExportInProgress = false;
    }
  }
  
  // ========== HTML 로그 출력 버튼 추가 및 기본 로그 출력 버튼 표시 제어 ========== //

  const MODULE_ID = 'lichsoma-speaker-selector';
  const HIDE_CORE_EXPORT_BUTTON_SETTING = 'chatLogExportHideCoreButton';

  function localizeOrFallback(key, fallback) {
    try {
      const value = game.i18n.localize(key);
      return value && value !== key ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getChatForms(root = document) {
    const base = root?.jquery ? root[0] : root;
    const forms = new Set();

    if (base?.matches?.('#chat-form, .chat-form, form[data-application-part="chat-form"]')) {
      forms.add(base);
    }

    base?.querySelectorAll?.('#chat-form, .chat-form, form[data-application-part="chat-form"]')
      ?.forEach((form) => forms.add(form));

    const sidebarForm = document.querySelector('#chat-form, .chat-form, form[data-application-part="chat-form"]');
    if (sidebarForm) forms.add(sidebarForm);

    return Array.from(forms).filter(Boolean);
  }

  function getChatControls(chatForm) {
    if (!chatForm) return null;

    return chatForm.querySelector('.control-buttons')
      || chatForm.querySelector('#chat-controls .control-buttons')
      || chatForm.querySelector('#chat-controls')
      || chatForm.querySelector('.chat-controls')
      || document.querySelector('#chat-controls .control-buttons')
      || document.querySelector('#chat-controls')
      || null;
  }

  function isChatExportControl(button) {
    if (!button) return false;

    const isExportButton = button.matches?.('button[data-action="export"], a[data-action="export"]')
      || button.querySelector?.('.fa-floppy-disk')
      || button.classList?.contains('fa-floppy-disk');

    if (!isExportButton) return false;

    return !!button.closest?.('section#chat, #chat-form, .chat-form, #chat-controls, .chat-sidebar, [data-tab="chat"]');
  }

  function getChatExportContainers(root = document) {
    const base = root?.jquery ? root[0] : root;
    const containers = new Set();
    const selector = 'section#chat, #chat, .chat-sidebar, [data-tab="chat"]';

    if (base?.matches?.(selector)) containers.add(base);
    const closest = base?.closest?.(selector);
    if (closest) containers.add(closest);
    base?.querySelectorAll?.(selector)?.forEach((container) => containers.add(container));

    if (base === document || base === document.body || !containers.size) {
      document.querySelectorAll?.(selector)?.forEach((container) => containers.add(container));
    }

    return Array.from(containers).filter(Boolean);
  }

  function getCoreChatLogExportButtons(root = document) {
    const buttons = new Set();

    for (const container of getChatExportContainers(root)) {
      container.querySelectorAll?.('button[data-action="export"], a[data-action="export"]')
        ?.forEach((button) => {
          if (isChatExportControl(button) && !button.classList.contains('lichsoma-html-export-btn')) {
            buttons.add(button);
          }
        });

      container.querySelectorAll?.('.fa-floppy-disk')?.forEach((icon) => {
        const button = icon.closest?.('button, a');
        if (button && isChatExportControl(button) && !button.classList.contains('lichsoma-html-export-btn')) {
          buttons.add(button);
        }
      });
    }

    return Array.from(buttons);
  }

  function observeChatExportContainers(root = document) {
    const containers = getChatExportContainers(root);
    const container = containers.find((candidate) => candidate.matches?.('section#chat, #chat, .chat-sidebar'))
      || containers[0]
      || null;
    if (!container) return;
    if (observedChatExportContainer === container && chatExportObserver) return;

    chatExportObserver?.disconnect?.();
    observedChatExportContainer = container;
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => Array.from(mutation.addedNodes || []).some((node) => {
        if (!(node instanceof Element)) return false;
        return node.matches?.('#chat-form, .chat-form, #chat-controls, .chat-controls, button, a')
          || node.querySelector?.('#chat-form, .chat-form, #chat-controls, .chat-controls, button, a');
      }));
      if (!relevant || observer._lichsomaPending) return;

      observer._lichsomaPending = true;
      setTimeout(() => {
        if (chatExportObserver !== observer) return;
        observer._lichsomaPending = false;
        updateChatExportButtons(container);
      }, 100);
    });

    chatExportObserver = observer;
    observer.observe(container, { childList: true, subtree: true });
  }

  function shouldHideCoreChatLogExportButton() {
    try {
      return game.settings.get(MODULE_ID, HIDE_CORE_EXPORT_BUTTON_SETTING) === true;
    } catch (e) {
      return false;
    }
  }

  function syncCoreChatLogExportButtonVisibility(root = document) {
    const shouldHide = shouldHideCoreChatLogExportButton();
    getCoreChatLogExportButtons(root).forEach((button) => {
      if (shouldHide) {
        if (!button.dataset.lichsomaOriginalDisplay) {
          button.dataset.lichsomaOriginalDisplay = button.style.display || '';
        }
        button.style.display = 'none';
        button.setAttribute('aria-hidden', 'true');
      } else {
        if (button.dataset.lichsomaOriginalDisplay !== undefined) {
          button.style.display = button.dataset.lichsomaOriginalDisplay;
          delete button.dataset.lichsomaOriginalDisplay;
        } else {
          button.style.removeProperty('display');
        }
        button.removeAttribute('aria-hidden');
      }
    });
  }

  function renderHtmlExportButton(root = document) {
    if (!game.user?.isGM) return;

    const title = localizeOrFallback('SPEAKERSELECTOR.ChatLogExport.Button.Title', 'Export Chat Log as HTML');
    const ariaLabel = localizeOrFallback('SPEAKERSELECTOR.ChatLogExport.Button.AriaLabel', title);

    for (const chatForm of getChatForms(root)) {
      const controls = getChatControls(chatForm);
      if (!controls) continue;

      if (controls.querySelector?.('.lichsoma-html-export-btn')) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-control icon lichsoma-html-export-btn';
      button.dataset.tooltip = 'SPEAKERSELECTOR.ChatLogExport.Button.Title';
      button.title = title;
      button.setAttribute('aria-label', ariaLabel);
      button.innerHTML = '<i class="fa-solid fa-file-code"></i>';

      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await exportChatLogAsHTML();
      });

      const coreExportButton = Array.from(controls.querySelectorAll?.('button, a') || [])
        .find((candidate) => isChatExportControl(candidate));

      if (coreExportButton) coreExportButton.insertAdjacentElement('beforebegin', button);
      else controls.appendChild(button);
    }
  }

  function updateChatExportButtons(root = document) {
    renderHtmlExportButton(root);
    syncCoreChatLogExportButtonVisibility(root);
    observeChatExportContainers(root);
  }

  // Foundry의 전체 채팅 로그 삭제 버튼을 누르면, 기본 확인 다이얼로그보다 먼저 HTML 백업을 만든다.
  const flushBackupBypass = new WeakSet();
  let flushBackupInProgress = false;

  function getCoreChatFlushButton(target) {
    const button = target?.closest?.('button[data-action], a[data-action]');
    if (!button || button.classList.contains('lichsoma-delete-btn')) return null;

    const action = String(button.dataset.action || '').trim();
    if (!['flush', 'flushChat', 'clearChat'].includes(action)) return null;

    const chatRoot = button.closest?.('section#chat, #chat, .chat-sidebar, [data-tab="chat"]');
    return chatRoot ? button : null;
  }

  async function onCoreChatFlushCapture(event) {
    if (!game.user?.isGM) return;

    const button = getCoreChatFlushButton(event.target);
    if (!button) return;

    const saveHtmlOnDelete = getSettingSafe('chatLogSaveHtmlOnDelete', true) !== false;
    if (!saveHtmlOnDelete) return;

    if (flushBackupBypass.has(button)) {
      flushBackupBypass.delete(button);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (flushBackupInProgress) return;
    flushBackupInProgress = true;

    const wasDisabled = 'disabled' in button ? button.disabled : false;
    const previousAriaBusy = button.getAttribute('aria-busy');
    if ('disabled' in button) button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const exported = await exportChatLogAsHTML({ notifyFailure: false, requireEmbeddedImages: true });
      if (!exported) {
        ui.notifications.error(localizeOrFallback(
          'SPEAKERSELECTOR.ChatLogExport.Error.FlushBackupFailed',
          'Chat log deletion was stopped because the HTML backup could not be saved.'
        ));
        return;
      }

      if ('disabled' in button) button.disabled = wasDisabled;
      flushBackupBypass.add(button);
      button.click();
    } finally {
      if ('disabled' in button) button.disabled = wasDisabled;
      if (previousAriaBusy === null) button.removeAttribute('aria-busy');
      else button.setAttribute('aria-busy', previousAriaBusy);
      flushBackupInProgress = false;
    }
  }

  // 캡처 단계에서 막아야 Foundry의 기본 flush 핸들러가 먼저 확인 창을 열지 않는다.
  document.addEventListener('click', onCoreChatFlushCapture, true);

  document.addEventListener('lichsoma-speaker-selector:updateChatExportButtons', () => {
    setTimeout(() => updateChatExportButtons(document), 0);
  });

  Hooks.on('renderSidebarTab', (app, html) => {
    if (app?.tabName === 'chat' || app?.id === 'chat') {
      setTimeout(() => updateChatExportButtons(html), 50);
    }
  });

  Hooks.on('renderChatLog', (app, html) => {
    setTimeout(() => updateChatExportButtons(html), 50);
  });

  Hooks.once('ready', () => {
    setTimeout(() => updateChatExportButtons(document), 250);
  });
})();

