import {
  escapeCssString,
  extractWebfontPresentation,
  uint8ArrayToBase64
} from './lichsoma-shared-utils.js';
import {
  applyDnd5eTitleAlias,
  isDnd5eMessageElement
} from './lichsoma-dnd5e-header.js';

import { ChatSystemBridge } from './lichsoma-chat-system-registry.js';
import { withChatRenderContext } from './lichsoma-chat-render-pipeline.js';
import { SpeakerSelector } from './lichsoma-speaker-selector.js';
// LichSOMA Speaker Selector - Chat Log Export
// 채팅 로그를 HTML로 저장하는 기능
(function() {
  'use strict';

  const MAX_EMBEDDED_IMAGE_BYTES = 500 * 1024;
  const IMAGE_REGISTRY_ID = 'lichsoma-image-registry';
  let chatExportObserver = null;
  let observedChatExportContainer = null;
  let chatLogExportInProgress = false;
  
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
    return ChatSystemBridge.export.excludeCurrent(message, element) === true;
  }

  function chatSystemExportExcludePrevious(message, element) {
    return ChatSystemBridge.export.excludePrevious(message, element) === true;
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
      dnd5eTitle: getSettingSafe('dnd5eTitleWebfontCSS', ''),
      dnd5eSubtitle: getSettingSafe('dnd5eSubtitleWebfontCSS', ''),
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
    const addRule = (selectors, declarations) => {
      if (!declarations.length) return;
      rules.push(`${selectors} {\n  ${declarations.map(value => `${value} !important`).join(';\n  ')};\n}`);
    };

    const headerFamilySelectors = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header > .message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header > h4.message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header .message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .lichsoma-chat-header,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .lichsoma-chat-header :where(span, strong, em, ruby, rb, rt)`;
    const headerStyleSelectors = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header > .message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-header > h4.message-sender,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .lichsoma-chat-header .message-sender`;
    addRule(headerFamilySelectors, declarationsFor(profiles.header, {}, { family: true }).filter(value => value.startsWith('font-family:')));
    addRule(headerStyleSelectors, declarationsFor(profiles.header, { weight: '900', style: 'normal' }, { family: false }));

    addRule(
      `body.lichsoma-chat-log-export.system-dnd5e .chat-log.chat-log .chat-message .message-header .name-stacked .title`,
      declarationsFor(profiles.dnd5eTitle)
    );
    addRule(
      `body.lichsoma-chat-log-export.system-dnd5e .chat-log.chat-log .chat-message .message-header .name-stacked .subtitle`,
      declarationsFor(profiles.dnd5eSubtitle)
    );

    const messageFamilySelectors = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content :where(p, h1, h2, h3, h4, h5, h6, div, span, strong, em, b, i:not([class^="fa-"]):not([class*=" fa-"]):not([class^="cci-"]):not([class*=" cci-"]), li, ul, ol, table, thead, tbody, tr, th, td, blockquote, ruby, rb, rt, section, article)`;
    const messageStyleSelector = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content`;
    addRule(messageFamilySelectors, declarationsFor(profiles.message, {}, { family: true }).filter(value => value.startsWith('font-family:')));
    addRule(messageStyleSelector, declarationsFor(profiles.message, { weight: '500', style: 'normal' }, { family: false }));

    addRule(
      `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .dice-roll,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .dice-roll :where(.dice-formula, .dice-total, .dice-tooltip, .dice-tooltip *, .dice-result)`,
      declarationsFor(profiles.dice)
    );

    const narratorFamilySelectors = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content .narrator-card,
body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content .narrator-card :where(p, h1, h2, h3, h4, h5, h6, div, span, strong, em, b, i, li, ul, ol, blockquote, ruby, rb, rt)`;
    const narratorStyleSelector = `body.lichsoma-chat-log-export.lichsoma-chat-log-export .chat-log.chat-log .chat-message .message-content .narrator-card`;
    addRule(narratorFamilySelectors, declarationsFor(profiles.narrator, {}, { family: true }).filter(value => value.startsWith('font-family:')));
    addRule(narratorStyleSelector, declarationsFor(profiles.narrator, { weight: '500', style: 'italic' }, { family: false }));

    if (rules.length) parts.push(`/* Shared webfont application */\n${rules.join('\n\n')}`);
    return parts.length ? `\n\n/* HTML 내보내기 웹폰트 */\n${parts.join('\n\n')}` : '';
  }

  function buildCainAlterExportFontPriorityCSS() {
    if (game.system?.id !== 'cain-alter') return '';

    const builder = game.cainAlter?.buildChatExportFontPriorityCSS;
    if (typeof builder !== 'function') return '';

    try {
      const css = builder();
      if (!css || typeof css !== 'string' || !css.trim()) return '';
      return `\n\n/* Cain Alter HTML export font priority */\n${css.trim()}`;
    } catch (error) {
      console.warn('[lichsoma-speaker-selector] Cain Alter export font priority CSS failed:', error);
      return '';
    }
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

  function isDnd5eExportMessage(messageEl) {
    return isDnd5eMessageElement(messageEl);
  }

  function collapseDnd5eExportChatCards(messageEl) {
    if (!isDnd5eExportMessage(messageEl)) return;

    messageEl.querySelectorAll?.('.chat-card .description.collapsible').forEach((description) => {
      description.classList.add('collapsed');
      description.setAttribute('aria-expanded', 'false');

      const summary = description.querySelector('.summary');
      summary?.setAttribute('aria-expanded', 'false');

      const details = description.querySelector('.details');
      details?.setAttribute('aria-hidden', 'true');
    });
  }



  function getExportBodyClasses() {
    const classes = ['lichsoma-chat-log-export'];

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
        if (/^theme-/.test(cls) || cls === 'lancer-simple-fonts') {
          classes.push(cls);
        }
      }
    } catch (e) {
      // body class 수집 실패 시 기본 class만 사용한다.
    }

    return Array.from(new Set(classes.filter(Boolean))).join(' ');
  }

  function applyDnd5eExportNameStackedTitleAlias(message, messageEl) {
    if (!isDnd5eExportMessage(messageEl)) return;
    applyDnd5eTitleAlias(message, messageEl);
  }

  function getDnd5eExportAvatarPortraitSrc(message, messageEl) {
    if (!message) return null;

    const flags = message.flags?.['lichsoma-speaker-selector'] || {};

    // 감정 포트레잇이 있으면 export HTML의 dnd5e 원본 avatar도 반드시 감정 포트레잇을 사용한다.
    if (flags.emotionPortrait) return flags.emotionPortrait;
    if (flags.portraitSrc) return flags.portraitSrc;

    const renderedAvatar = messageEl?.querySelector?.('.message-header .message-sender .avatar img');
    const renderedSrc = renderedAvatar?.getAttribute?.('src');
    if (renderedSrc) return renderedSrc;

    return null;
  }

  function applyDnd5eExportAvatarPortrait(message, messageEl) {
    if (!isDnd5eExportMessage(messageEl)) return;

    const avatar = messageEl.querySelector?.('.message-header .message-sender .avatar');
    const img = avatar?.querySelector?.('img');
    if (!avatar || !img) return;

    const portraitSrc = getDnd5eExportAvatarPortraitSrc(message, messageEl);
    if (!portraitSrc) return;

    if (!img.dataset.lichsomaOriginalSrc) {
      img.dataset.lichsomaOriginalSrc = img.getAttribute('src') || '';
    }

    img.setAttribute('src', portraitSrc);
    img.dataset.lichsomaPortraitSrc = portraitSrc;
    avatar.dataset.lichsomaPortraitSrc = portraitSrc;

    const alias = getDnd5eExportTitleAlias(message);
    if (alias) img.setAttribute('alt', alias);
  }

  /**
   * ChatMerge._getMergeMeta와 같은 목적의 내보내기용 머지 메타.
   * - token/actor 플래그가 있으면 해당 기준
   * - actor/token이 없는 FVTT v14 Public as User 계열 메시지는 user 기준
   * - portraitSrc는 저장 플래그를 우선하고, 없으면 렌더된 포트레잇 img에서 fallback
   */
  function getExportMergeMeta(message, messageEl) {
    const flags = message?.flags?.['lichsoma-speaker-selector'] || {};
    const speaker = message?.speaker || {};

    const userId = flags.userId || message?.author?.id || null;

    const portraitImg = messageEl?.querySelector?.('.lichsoma-chat-portrait');
    const dnd5eAvatarImg = messageEl?.querySelector?.('.message-header .message-sender .avatar img');
    const portraitSrc = flags.emotionPortrait
      || flags.portraitSrc
      || portraitImg?.getAttribute?.('src')
      || dnd5eAvatarImg?.getAttribute?.('src')
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
  
  function isSvgResponse(imageUrl, response) {
    const contentType = response?.headers?.get?.('content-type') || '';
    if (/image\/svg\+xml/i.test(contentType)) return true;

    try {
      const path = new URL(normalizeImageUrl(imageUrl, window.location.origin)).pathname;
      return /\.svg$/i.test(path);
    } catch (e) {
      return /\.svg(?:[?#]|$)/i.test(String(imageUrl || ''));
    }
  }

  function svgTextToBase64DataUrl(svgText) {
    const bytes = new TextEncoder().encode(svgText || '');
    return `data:image/svg+xml;base64,${uint8ArrayToBase64(bytes)}`;
  }

  function estimateDataUrlByteSize(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return 0;

    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) return 0;

    const metadata = dataUrl.slice(0, commaIndex);
    const payload = dataUrl.slice(commaIndex + 1);

    if (/;base64(?:;|$)/i.test(metadata)) {
      const compact = payload.replace(/\s+/g, '');
      const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
      return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
    }

    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
    } catch (e) {
      return new TextEncoder().encode(payload).byteLength;
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 500KB 이하 이미지만 내보내기용 Data URL로 변환한다.
  // 초과 이미지는 HTML에 중복 Base64를 넣지 않고 절대 URL을 유지한다.
  async function imageUrlToEmbeddedRecord(imageUrl, localHost, maxBytes = MAX_EMBEDDED_IMAGE_BYTES) {
    try {
      if (imageUrl.startsWith('data:')) {
        return {
          dataUrl: imageUrl,
          byteSize: estimateDataUrlByteSize(imageUrl),
          absoluteUrl: imageUrl
        };
      }

      const fullUrl = normalizeImageUrl(imageUrl, localHost);
      if (!fullUrl) {
        return { dataUrl: '', byteSize: 0, absoluteUrl: imageUrl };
      }

      const response = await fetchWithRetry(fullUrl, { retries: 4, timeoutMs: 25000, backoffMs: 600 });
      if (!response.ok) {
        console.warn(`이미지 로드 실패: ${fullUrl}`);
        return { dataUrl: '', byteSize: 0, absoluteUrl: fullUrl };
      }

      const contentLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        try {
          await response.body?.cancel?.();
        } catch (e) {
          // 이미 완료되었거나 취소를 지원하지 않는 응답은 그대로 둔다.
        }
        return {
          dataUrl: '',
          byteSize: contentLength,
          absoluteUrl: fullUrl
        };
      }

      if (isSvgResponse(fullUrl, response)) {
        const svgText = await response.text();
        const byteSize = new TextEncoder().encode(svgText).byteLength;
        if (byteSize > maxBytes) {
          return {
            dataUrl: '',
            byteSize,
            absoluteUrl: fullUrl
          };
        }

        return {
          dataUrl: svgTextToBase64DataUrl(svgText),
          byteSize,
          absoluteUrl: fullUrl
        };
      }

      const blob = await response.blob();
      if (blob.size > maxBytes) {
        return {
          dataUrl: '',
          byteSize: blob.size,
          absoluteUrl: fullUrl
        };
      }

      return {
        dataUrl: await readBlobAsDataUrl(blob),
        byteSize: blob.size,
        absoluteUrl: fullUrl
      };
    } catch (error) {
      console.warn(`Base64 변환 실패: ${imageUrl}`, error);
      return {
        dataUrl: '',
        byteSize: 0,
        absoluteUrl: normalizeImageUrl(imageUrl, localHost) || imageUrl
      };
    }
  }

  function getOrCreateImageRegistryKey(dataUrl, registry, reverseRegistry) {
    const existingKey = reverseRegistry.get(dataUrl);
    if (existingKey) return existingKey;

    const baseKey = simpleHash(dataUrl) || 'image';
    let key = baseKey;
    let suffix = 2;
    while (registry.has(key) && registry.get(key) !== dataUrl) {
      key = `${baseKey}-${suffix++}`;
    }

    registry.set(key, dataUrl);
    reverseRegistry.set(dataUrl, key);
    return key;
  }

  function serializeImageRegistry(registry) {
    return JSON.stringify(Object.fromEntries(registry))
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
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

  function renderFallbackChatMessageElement(message) {
    const li = document.createElement('li');
    li.className = 'chat-message message flexcol lichsoma-export-fallback';
    if (message?.id) li.setAttribute('data-message-id', message.id);

    const alias = message?.speaker?.alias || message?.alias || message?.author?.name || 'Unknown';
    const content = message?.content ?? '';
    const timestamp = message?.timestamp
      ? new Date(message.timestamp).toLocaleString()
      : '';

    li.innerHTML = `
      <header class="message-header flexrow">
        <h4 class="message-sender">${escapeHTML(alias)}</h4>
        <span class="message-metadata">
          <time class="message-timestamp">${escapeHTML(timestamp)}</time>
        </span>
      </header>
      <div class="message-content">${content}</div>
    `;

    return li;
  }

  async function renderChatMessageForExport(message) {
    try {
      if (typeof message?.renderHTML !== 'function') {
        return renderFallbackChatMessageElement(message);
      }

      // Isolate this render from all live-ChatLog-only processors. The context is
      // associated with this specific ChatMessage object, so live messages which render
      // concurrently are not affected.
      const rendered = await withChatRenderContext(message, { mode: 'export' }, () => message.renderHTML({
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

      return element;
    } catch (error) {
      console.warn('[lichsoma-speaker-selector] ChatMessage.renderHTML() 실패, fallback HTML 사용:', message?.id, error);
      return renderFallbackChatMessageElement(message);
    }
  }

  async function buildChatLogDOMFromMessages() {
    const messages = getSortedChatMessages();
    const container = document.createElement('div');
    let count = 0;

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const element = await renderChatMessageForExport(message);
      if (element) {
        container.appendChild(element);
        count += 1;
      }

      // Large logs can contain several thousand messages. Yield periodically so the
      // browser can service rendering/input and does not look permanently frozen.
      if ((index + 1) % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    return {
      container,
      count,
      total: messages.length
    };
  }

  // 채팅 로그 HTML로 저장하는 함수
  async function exportChatLogAsHTML({ notifyFailure = true } = {}) {
    // A several-thousand-message export is intentionally long-running. Prevent a second
    // click (or a flush-backup request) from starting another full render in parallel.
    if (chatLogExportInProgress) return false;
    chatLogExportInProgress = true;

    try {
      // game.messages의 ChatMessage 문서를 기준으로 내보내기용 HTML을 새로 렌더링한다.
      const totalMessageCount = game.messages.size;
      if (totalMessageCount === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return false;
      }

      const renderedLog = await buildChatLogDOMFromMessages();
      const logContainer = renderedLog.container;

      if (!logContainer || renderedLog.count === 0) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatLogExport.Warning.Empty'));
        return false;
      }

      if (renderedLog.count < renderedLog.total) {
        ui.notifications.warn(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Warning.CountMismatch', {
          rendered: renderedLog.count,
          total: renderedLog.total
        }));
      }

      // 챗 머지 처리: 이미 detached DOM으로 렌더된 메시지를 그대로 사용한다.
      // 전체 HTML 문자열을 만들었다가 다시 parse하던 구형 경로를 제거한다.
      const messages = logContainer.querySelectorAll('.chat-message');

      let prevMeta = null;

      messages.forEach((messageEl) => {
        const messageId = messageEl.getAttribute('data-message-id');
        if (!messageId) {
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }

        const message = game.messages.get(messageId);
        if (!message) {
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }

        // dnd5e HTML 내보내기에서도 셀렉터가 저장한 senderAlias / speaker.alias를 name-stacked title에 반영한다.
        applyDnd5eExportNameStackedTitleAlias(message, messageEl);

        // dnd5e HTML 내보내기에서도 감정 포트레잇/portraitSrc를 원본 avatar img에 반영한다.
        applyDnd5eExportAvatarPortrait(message, messageEl);

        // dnd5e HTML 내보내기에서는 접을 수 있는 chat-card를 기본적으로 닫힌 상태로 만든다.
        collapseDnd5eExportChatCards(messageEl);

        const currentMeta = getExportMergeMeta(message, messageEl);

        // 자신의 메시지인지 확인하고 클래스 추가
        const isOwnMessage = currentMeta.userId === game.user.id;
        messageEl.classList.toggle('lichsoma-own-message', isOwnMessage);

        // <hr> 전용 메시지: 머지하지 않고 이후 체인 끊기
        // 이미지/비디오 등 비텍스트 콘텐츠만 있는 메시지는 hr-only가 아니므로 머지 대상이 될 수 있다.
        if (isOnlyHrMessageContent(messageEl)) {
          messageEl.classList.add('lichsoma-hr-only');
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }
        messageEl.classList.remove('lichsoma-hr-only');

        // 메신저 메시지 (lichsoma-fvtt-smartphone): 머지 체인 끊기
        if (isMessengerMessage(message)) {
          messageEl.classList.add('lichsoma-messenger-message');
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }
        messageEl.classList.remove('lichsoma-messenger-message');

        // 시스템별 내보내기 머지 제외
        if (
          chatSystemExportExcludeCurrent(message, messageEl) ||
          chatSystemExportExcludePrevious(message, messageEl)
        ) {
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }

        // narrator-card 확인: 문자열 검색 대신 DOM query 사용
        if (hasNarratorCard(messageEl)) {
          messageEl.classList.add('lichsoma-narrator-card');
          messageEl.classList.remove('lichsoma-merged');
          prevMeta = null;
          return;
        }
        messageEl.classList.remove('lichsoma-narrator-card');

        const shouldMerge = canExportMerge(currentMeta, prevMeta);
        messageEl.classList.toggle('lichsoma-merged', shouldMerge);
        prevMeta = isValidExportMergeMeta(currentMeta) ? currentMeta : null;
      });

      // 설정 확인
      const useBase64 = game.settings.get('lichsoma-speaker-selector', 'chatLogExportUseBase64') || false;
      let basePath = game.settings.get('lichsoma-speaker-selector', 'chatLogExportBasePath') || '';
      const localHost = window.location.origin;
      
      // basePath가 공란일 경우 FoundryVTT 유저 데이터 경로 + /Data 사용
      if (!basePath || basePath.trim() === '') {
        basePath = localHost;
      }
      
      // Base64 변환이 활성화된 경우 500KB 이하 이미지를 단일 레지스트리로 통합한다.
      const imageRegistry = new Map();
      let imageRegistryJSON = '{}';
      if (useBase64) {
        const images = Array.from(logContainer.querySelectorAll('img[src]'));

        // URL별 Promise를 캐시해 같은 파일을 중복 fetch/변환하지 않는다.
        const imageResultCache = new Map();
        // 최종 Data URL 기준으로 하나의 레지스트리 키만 생성한다.
        const reverseImageRegistry = new Map();
        const MAX_CONCURRENT_IMAGE_FETCHES = 6;

        async function runWithConcurrencyLimit(items, limit, worker) {
          const queue = Array.from(items);
          let nextIndex = 0;
          const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, queue.length)) }, async () => {
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

        async function getImageRecord(src) {
          const cacheKey = src.startsWith('data:') ? src : normalizeImageUrl(src, localHost);
          if (!imageResultCache.has(cacheKey)) {
            imageResultCache.set(
              cacheKey,
              imageUrlToEmbeddedRecord(src, localHost, MAX_EMBEDDED_IMAGE_BYTES)
            );
          }
          return await imageResultCache.get(cacheKey);
        }

        // Group repeated portrait/card URLs first. Thousands of chat messages often reuse
        // the same few images, so convert each unique source only once and then apply the
        // resulting registry key to every matching <img>.
        const imagesBySource = new Map();
        for (const img of images) {
          const src = img.getAttribute('src');
          if (!src) continue;
          if (!imagesBySource.has(src)) imagesBySource.set(src, []);
          imagesBySource.get(src).push(img);
        }

        const processImageGroup = async ([src, groupedImages]) => {
          try {
            const record = await getImageRecord(src);
            let imageKey = null;
            if (record?.dataUrl && typeof record.dataUrl === 'string' && record.dataUrl.startsWith('data:')) {
              imageKey = getOrCreateImageRegistryKey(record.dataUrl, imageRegistry, reverseImageRegistry);
            }

            for (const img of groupedImages) {
              preserveImageDimensions(img);

              if (!imageKey) {
                const absoluteUrl = normalizeImageUrl(src, basePath || localHost) || record?.absoluteUrl;
                if (absoluteUrl) img.setAttribute('src', absoluteUrl);
                continue;
              }

              // All embedded images use the same registry-key -> <img src> restoration path.
              img.setAttribute('data-lichsoma-image-src-key', imageKey);
              img.removeAttribute('src');

              const exportHeader = img.closest('.message-header, .lichsoma-chat-header, .item-header');
              if (exportHeader) {
                // Standalone logs do not need preview/source metadata or fallback alt text
                // once the image is successfully embedded.
                img.removeAttribute('alt');
                exportHeader.querySelectorAll('[data-lichsoma-portrait-src]').forEach((el) => {
                  el.removeAttribute('data-lichsoma-portrait-src');
                });
                exportHeader.querySelectorAll('[data-lichsoma-original-src]').forEach((el) => {
                  el.removeAttribute('data-lichsoma-original-src');
                });
                const portraitContainer = img.closest('.lichsoma-chat-portrait-container');
                portraitContainer?.removeAttribute('data-preview-attached');
              }
            }
          } catch (error) {
            console.warn(`이미지 Base64 변환 실패: ${src}`, error);
            const absoluteUrl = normalizeImageUrl(src, basePath || localHost);
            for (const img of groupedImages) {
              if (absoluteUrl) img.setAttribute('src', absoluteUrl);
            }
          }
        };

        await runWithConcurrencyLimit(imagesBySource.entries(), MAX_CONCURRENT_IMAGE_FETCHES, processImageGroup);
        imageRegistryJSON = serializeImageRegistry(imageRegistry);
      } else {
        // Base64가 꺼져 있어도 detached DOM에서 이미지 URL만 정규화한다.
        for (const img of logContainer.querySelectorAll('img[src]')) {
          const srcPath = img.getAttribute('src') || '';
          if (!srcPath || srcPath.startsWith('http') || srcPath.startsWith('//') || srcPath.includes(localHost) || srcPath.startsWith('data:')) continue;
          const fullPath = srcPath.startsWith('/') ? srcPath : '/' + srcPath;
          img.setAttribute('src', `${basePath}${fullPath}`);
        }
      }

      // Serialize once after all per-message DOM work and image processing are complete.
      let chatLogHTML = logContainer.innerHTML;
      
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
        customCSS = getSettingSafe('chatLogExportCustomCSS', '') || '';
        if (customCSS.trim()) {
          customCSS = `\n\n/* 커스텀 CSS */\n${customCSS}`;
        }
      } catch (e) {
        // 커스텀 CSS 로드 실패 (무시)
      }

      const exportWebfontCSS = buildChatLogExportWebfontCSS();
      const cainAlterExportFontPriorityCSS = buildCainAlterExportFontPriorityCSS();
      
      // 확장 모듈 CSS 수집
      let extensionCSS = '';
      try {
        // 모든 등록된 훅 함수 호출하여 결과 수집
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
              const result = await runHookEntry(hookFn, chatLogHTML);
              if (result && typeof result === 'string') {
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
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const liElements = Array.from(tempDiv.querySelectorAll('li.chat-message'));

        if (liElements.length === 0) return { html, count: 0 };

        const parts = [];
        liElements.forEach((li, index) => {
          const messageId = li.getAttribute('data-message-id') || '';
          const messageIndex = index + 1;
          parts.push(`            <!-- ========== 메시지 ${messageIndex} (ID: ${messageId}) ========== -->`);
          parts.push(`            ${li.outerHTML}`);
          parts.push(`            <!-- ========== 메시지 ${messageIndex} 끝 ========== -->`);
        });

        return { html: parts.join('\n'), count: liElements.length };
      }
      
      // chatLogHTML을 <li> 단위로 분리하고 주석 추가
      const separatedChatLog = splitChatMessagesByLi(chatLogHTML);
      const separatedChatLogHTML = separatedChatLog.html;
      
      const exportBodyClasses = getExportBodyClasses();

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
            --export-secondary-text-color: ${secondaryTextColor};
        }
        /* 나레이터 카드 스타일 */
        .chat-log .chat-message.lichsoma-narrator-card .lichsoma-chat-header {
          display: none !important;
        }
        .chat-log .chat-message.lichsoma-hr-only .message-header {
          display: none !important;
        }
        .chat-message .message-content .narrator-card {
          font-style: italic;
          font-weight: 500;
          text-align: center;
        }
        ${customCSS}${cssContent}${extensionCSS}${exportWebfontCSS}${cainAlterExportFontPriorityCSS}
    </style>
</head>
<body class="${exportBodyClasses}">
    <div class="chat-outer">
        <h1 class="log-title">Foundry VTT Chat Log</h1>
        <p class="timestamp">${new Date().toLocaleString()}</p>
        <ol id="chat-log" class="chat-log chat-scroll plain themed theme-light">
${separatedChatLogHTML}
        </ol>
    </div>
    <script id="${IMAGE_REGISTRY_ID}" type="application/json">${imageRegistryJSON}</script>
    <script>
    (() => {
      const registryElement = document.getElementById('${IMAGE_REGISTRY_ID}');
      if (!registryElement) return;

      let registry = {};
      try {
        registry = JSON.parse(registryElement.textContent || '{}');
      } catch (error) {
        console.error('LichSOMA image registry parse failed.', error);
        return;
      }

      document.querySelectorAll('img[data-lichsoma-image-src-key]').forEach((img) => {
        const key = img.getAttribute('data-lichsoma-image-src-key');
        const dataUrl = registry[key];
        if (!dataUrl) return;
        img.setAttribute('src', dataUrl);
        img.removeAttribute('data-lichsoma-image-src-key');
      });
    })();
    </script>
</body>
</html>`;
      
      // 파일명 생성
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `chat-log-${timestamp}.html`;
      
      // Foundry VTT의 saveDataToFile API 사용. Promise를 반환하는 환경에서는 완료까지 대기한다.
      let saveResult;
      if (typeof foundry !== 'undefined' && foundry.utils && foundry.utils.saveDataToFile) {
        saveResult = foundry.utils.saveDataToFile(htmlContent, 'text/html', fileName);
      } else if (typeof saveDataToFile !== 'undefined') {
        saveResult = saveDataToFile(htmlContent, 'text/html', fileName);
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
      if (saveResult && typeof saveResult.then === 'function') await saveResult;
      
      // HTML transform 훅까지 적용된 최종 메시지 개수
      const messageCount = separatedChatLog.count || renderedLog.count;
      
      ui.notifications.info(game.i18n.format('SPEAKERSELECTOR.ChatLogExport.Success', { count: messageCount }));
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
      const exported = await exportChatLogAsHTML({ notifyFailure: false });
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

