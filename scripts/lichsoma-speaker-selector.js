/**
 * LichSOMA Speaker Selector
 * 토큰에 구애 받지 않고 스피커를 선택할 수 있는 모듈
 */

import { ChatUI } from './lichsoma-chat-ui.js';
import { SpeakerSelectorCompat } from './lichsoma-speaker-selector-compat.js';
import { getRegisteredChatRenderProcessors, initializeChatRenderPipeline, registerChatRenderProcessor } from './lichsoma-chat-render-pipeline.js';
import { emitSocket, getRegisteredSocketTypes, registerSocketHandler } from './lichsoma-socket-router.js';
import { installModuleApi } from './lichsoma-module-api.js';
import { ChatSystemBridge, registerChatSystemModule, unregisterChatSystemModule } from './lichsoma-chat-system-registry.js';
import { ActorEmotions } from './lichsoma-actor-emotions.js';
import { ChatMerge } from './lichsoma-chat-merge.js';
import { ChatRubyHandler } from './lichsoma-chat-handler.js';
import { LichsomaChatDom } from './lichsoma-chat-dom.js';
import { ChatRenderLimiter } from './lichsoma-chat-render-limiter.js';
import {
    escapeCssString,
    extractFirstFontFamily,
    extractWebfontPresentation,
    getMessageAuthorColor,
    getMessageAuthorName,
    normalizeFontFamilyName,
    quoteFontFamily
} from './lichsoma-shared-utils.js';
import {
    applyDnd5eTitleAlias,
    getDnd5eTitleAlias,
    isDnd5eMessageElement
} from './lichsoma-dnd5e-header.js';
import {
    buildActorFolderTree,
    getAccessibleActors,
    renderActorFolderTree
} from './lichsoma-actor-tree.js';

export class SpeakerSelector {
    static SETTINGS = {
        SHOW_PORTRAIT: 'showPortrait',
        PORTRAIT_SIZE: 'portraitSize',
        ALWAYS_USE_CHARACTER: 'alwaysUseCharacter',
        ALWAYS_USE_ACTOR: 'alwaysUseActor',
        PREVENT_OTHER_USER_CHARACTER: 'preventOtherUserCharacter',
        APPLY_USER_COLOR: 'applyUserColor',
        ENABLE_CHAT_MERGE: 'enableChatMerge',
        CHAT_RENDER_LIMIT: 'chatRenderLimit',
        ACTOR_GRID_ACTORS: 'actorGridActors',
        CHAT_HEADER_WEBFONT_CSS: 'chatHeaderWebfontCSS',
        CHAT_HEADER_FONT_SIZE: 'chatHeaderFontSize',
        DND5E_TITLE_WEBFONT_CSS: 'dnd5eTitleWebfontCSS',
        DND5E_SUBTITLE_WEBFONT_CSS: 'dnd5eSubtitleWebfontCSS',
        CHAT_MESSAGE_WEBFONT_CSS: 'chatMessageWebfontCSS',
        CHAT_DICE_WEBFONT_CSS: 'chatDiceWebfontCSS',
        CHAT_MESSAGE_FONT_SIZE: 'chatMessageFontSize',
        NARRATOR_WEBFONT_CSS: 'narratorWebfontCSS',
        NARRATOR_FONT_SIZE: 'narratorFontSize',
        NARRATOR_TYPING_SOUND: 'narratorTypingSound',
        NARRATOR_TYPING_SPEED: 'narratorTypingSpeed',
        NARRATOR_CHAT_CARD: 'narratorChatCard',
        CHAT_LOG_EXPORT_BASE_PATH: 'chatLogExportBasePath',
        CHAT_LOG_EXPORT_USE_BASE64: 'chatLogExportUseBase64',
        CHAT_LOG_EXPORT_CUSTOM_CSS: 'chatLogExportCustomCSS',
        CHAT_LOG_EXPORT_SHOW_DICE_TOOLTIP: 'chatLogExportShowDiceTooltip',
        CHAT_LOG_EXPORT_HIDE_CORE_BUTTON: 'chatLogExportHideCoreButton',
        CHAT_LOG_SAVE_HTML_ON_DELETE: 'chatLogSaveHtmlOnDelete',
    };
    
    static _chatInputPendingText = '';
    static _chatInputPendingUntil = 0;
    static _chatInputPendingUserId = null;
    static _chatInputGlobalListenersRegistered = false;
    static _postProcessedChatLogs = new WeakSet();
    static _dnd5eHeaderJobs = new Map();

    static _getChatInputElement(root = document) {
        return LichsomaChatDom.getChatInput(root) || LichsomaChatDom.getChatInput(document);
    }

    static _getChatFormElement(root = document) {
        return LichsomaChatDom.getChatForm(root) || LichsomaChatDom.getSidebarChatForm(document) || LichsomaChatDom.getChatForm(document);
    }

    static _getSidebarChatFormElement(root = document) {
        return LichsomaChatDom.getSidebarChatForm(root) || LichsomaChatDom.getSidebarChatForm(document);
    }

    static _getChatInputText(chatInput) {
        if (!chatInput) return '';
        if (typeof chatInput.value === 'string') return chatInput.value;
        const pmRoot = LichsomaChatDom.getProseMirrorRoot(chatInput);
        return (pmRoot?.innerText ?? pmRoot?.textContent ?? chatInput.textContent ?? '').trim();
    }

    static _replaceTextEllipsesInHtml(content) {
        if (typeof content !== 'string' || !content.includes('...')) return content;

        const replaceEllipses = (text) => String(text ?? '').replace(/\.\.\./g, '…');

        // HTML 태그가 없는 일반 텍스트는 그대로 치환한다.
        if (!/[<>&]/.test(content)) {
            return replaceEllipses(content);
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = content;

        const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        let changed = false;
        for (const node of textNodes) {
            const nextValue = replaceEllipses(node.nodeValue);
            if (nextValue !== node.nodeValue) {
                node.nodeValue = nextValue;
                changed = true;
            }
        }

        return changed ? wrapper.innerHTML : content;
    }

    static _isChatInputFocused(chatInput) {
        const active = document.activeElement;
        return !!chatInput && (active === chatInput || chatInput.contains?.(active));
    }

    static _getSpeakerSelectorElement(root = document) {
        return LichsomaChatDom.query('.lichsoma-speaker-selector', root)
            || LichsomaChatDom.query('.lichsoma-speaker-selector', document);
    }

    static _isDnd5eSystem() {
        return game.system?.id === 'dnd5e';
    }

    static _isLancerSystem() {
        return game.system?.id === 'lancer';
    }

    static _isLancerPilotActor(actor) {
        if (!actor) return false;
        if (actor.type === 'pilot') return true;
        try {
            if (typeof actor.is_pilot === 'function' && actor.is_pilot()) return true;
        } catch (e) {
            // ignore system helper failures
        }
        return false;
    }

    static _isLancerMechActor(actor) {
        if (!actor) return false;
        if (actor.type === 'mech') return true;
        try {
            if (typeof actor.is_mech === 'function' && actor.is_mech()) return true;
        } catch (e) {
            // ignore system helper failures
        }
        return false;
    }


    static _isLancerNpcActor(actor) {
        if (!actor) return false;
        if (actor.type === 'npc') return true;
        try {
            if (typeof actor.is_npc === 'function' && actor.is_npc()) return true;
        } catch (e) {
            // ignore system helper failures
        }
        return false;
    }

    static _isLancerDeployableActor(actor) {
        if (!actor) return false;
        if (actor.type === 'deployable') return true;
        try {
            if (typeof actor.is_deployable === 'function' && actor.is_deployable()) return true;
        } catch (e) {
            // ignore system helper failures
        }
        return false;
    }

    static _getLancerSpeakerCategory(actor) {
        if (!actor || !this._isLancerSystem()) return 'other';
        // Deployable이 NPC 계열 헬퍼와 겹쳐도 별도 열로 빠지도록 먼저 판정한다.
        if (this._isLancerDeployableActor(actor)) return 'deployable';
        if (this._isLancerNpcActor(actor)) return 'npc';
        if (this._isLancerPilotActor(actor)) return 'pilot';
        if (this._isLancerMechActor(actor)) return 'mech';
        return 'other';
    }

    static _getLancerSpeakerCategoryOrder() {
        if (game.user?.isGM) return ['npc', 'pilot', 'mech', 'deployable'];
        return ['pilot', 'mech', 'npc', 'deployable'];
    }

    static _getLancerSpeakerCategoryLabel(category) {
        switch (category) {
            case 'npc': return 'NPC';
            case 'pilot': return game.i18n.localize('SPEAKERSELECTOR.LancerCategory.Pilot');
            case 'mech': return game.i18n.localize('SPEAKERSELECTOR.LancerCategory.Mech');
            case 'deployable': return game.i18n.localize('SPEAKERSELECTOR.LancerCategory.Deployable');
            default: return '';
        }
    }

    static _escapeHTML(value) {
        const text = String(value ?? '');
        if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static _getActorSpeakerDisplayName(actor) {
        if (!actor) return '';
        const savedEmotion = ActorEmotions.getSavedEmotion(actor.id);
        return savedEmotion
            ? `${actor.name}(${savedEmotion.emotionName})`
            : actor.name;
    }

    static _createSpeakerOptionHTML(value, label) {
        return `<option value="${this._escapeHTML(value)}">${this._escapeHTML(label)}</option>`;
    }

    static _createActorSpeakerOptionHTML(actor, value = null) {
        if (!actor) return '';
        return this._createSpeakerOptionHTML(value ?? `actor:${actor.id}`, this._getActorSpeakerDisplayName(actor));
    }

    static _groupLancerSpeakerOptions(entries, order = this._getLancerSpeakerCategoryOrder()) {
        const buckets = new Map();
        for (const category of order) buckets.set(category, []);
        const other = [];

        for (const entry of entries) {
            if (!entry?.actor) continue;
            const optionHTML = this._createActorSpeakerOptionHTML(entry.actor, entry.value);
            if (!optionHTML) continue;

            const category = this._getLancerSpeakerCategory(entry.actor);
            if (buckets.has(category)) buckets.get(category).push(optionHTML);
            else other.push(optionHTML);
        }

        const groups = [];
        for (const category of order) {
            const options = buckets.get(category) || [];
            // 비어 있는 열은 optgroup 자체를 만들지 않아 라벨도 표시하지 않는다.
            if (!options.length) continue;
            const label = this._getLancerSpeakerCategoryLabel(category);
            groups.push(`<optgroup label="${this._escapeHTML(label)}">${options.join('')}</optgroup>`);
        }

        // 예외적인 알 수 없는 LANCER actor type은 기존처럼 사라지지 않도록 라벨 없이 뒤에 붙인다.
        if (other.length) groups.push(other.join(''));
        return groups.join('');
    }

    static _resolveLancerPilotFromMech(actor) {
        if (!actor || !this._isLancerMechActor(actor)) return null;
        const pilotLink = actor.system?.pilot;
        const candidates = [
            pilotLink?.value,
            pilotLink?.document,
            pilotLink?.actor,
            pilotLink?.id,
            pilotLink?.uuid,
            pilotLink
        ];

        for (const candidate of candidates) {
            const resolved = this._resolveLancerPilotCandidate(candidate);
            if (resolved) return resolved;
        }
        return null;
    }

    static _resolveLancerPilotCandidate(candidate) {
        if (!candidate) return null;
        if (typeof candidate === 'object') {
            if (this._isLancerPilotActor(candidate)) return candidate;
            if (candidate.value && candidate.value !== candidate) {
                const nested = this._resolveLancerPilotCandidate(candidate.value);
                if (nested) return nested;
            }
            if (candidate.id && game.actors?.get(candidate.id)) {
                const actor = game.actors.get(candidate.id);
                if (this._isLancerPilotActor(actor)) return actor;
            }
            if (candidate.uuid && typeof fromUuidSync === 'function') {
                try {
                    const actor = fromUuidSync(candidate.uuid);
                    if (this._isLancerPilotActor(actor)) return actor;
                } catch (e) {
                    // ignore unresolved uuid
                }
            }
            return null;
        }

        if (typeof candidate === 'string') {
            const direct = game.actors?.get(candidate);
            if (this._isLancerPilotActor(direct)) return direct;

            if (candidate.startsWith('Actor.')) {
                const id = candidate.split('.').pop();
                const actor = game.actors?.get(id);
                if (this._isLancerPilotActor(actor)) return actor;
            }

            if (typeof fromUuidSync === 'function') {
                try {
                    const actor = fromUuidSync(candidate);
                    if (this._isLancerPilotActor(actor)) return actor;
                } catch (e) {
                    // ignore unresolved uuid
                }
            }
        }
        return null;
    }

    static _getLancerPilotForSpeaker(actor) {
        if (!this._isLancerSystem() || !actor) return null;
        if (this._isLancerPilotActor(actor)) return actor;
        return this._resolveLancerPilotFromMech(actor);
    }

    static _getLancerSpeakerNameParts(actor, speaker = null) {
        if (!this._isLancerSystem() || !actor) return null;

        const alias = String(speaker?.alias || '').trim();

        if (this._isLancerMechActor(actor)) {
            const pilot = this._resolveLancerPilotFromMech(actor);
            const displayName = String(actor.name || alias || '').trim();
            const callsign = String(pilot?.system?.callsign || '').trim();
            const rubyText = callsign && callsign !== displayName ? callsign : '';

            if (!displayName) return null;
            return { name: displayName, callsign: rubyText, pilot, actor };
        }

        const pilot = this._isLancerPilotActor(actor) ? actor : this._getLancerPilotForSpeaker(actor);
        if (!pilot) return null;

        const name = String(pilot.name || '').trim();
        const callsign = String(pilot.system?.callsign || '').trim();

        // LANCER의 토큰/채팅 alias는 콜사인인 경우가 많으므로,
        // 파일럿 발화는 파일럿의 실제 이름을 우선 표시하고 콜사인은 루비로 올린다.
        const displayName = name || alias || callsign;
        const rubyText = callsign && callsign !== displayName ? callsign : '';

        if (!displayName) return null;
        return { name: displayName, callsign: rubyText, pilot };
    }

    static _createRubyNameElement(name, rubyText, className = 'lichsoma-lancer-speaker-ruby') {
        const ruby = document.createElement('ruby');
        ruby.classList.add('lichsoma-ruby', className);

        const rb = document.createElement('rb');
        rb.textContent = name || '';
        ruby.appendChild(rb);

        if (rubyText) {
            const rt = document.createElement('rt');
            rt.textContent = rubyText;
            ruby.appendChild(rt);
        }

        return ruby;
    }

    static _setSenderElementDisplayName(senderElement, name, rubyText = '') {
        if (!senderElement?.length) return;
        const el = senderElement[0];
        if (!el) return;

        el.textContent = '';
        if (rubyText) {
            el.appendChild(this._createRubyNameElement(name, rubyText));
        } else {
            el.textContent = name || '';
        }
        el.dataset.lichsomaLancerNameApplied = 'true';
    }

    static _getShowPortraitSetting() {
        // dnd5e는 시스템 원본 avatar를 사용한다.
        return this._isDnd5eSystem()
            ? false
            : game.settings.get('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT);
    }

    static _getAlwaysUseActorSetting() {
        return game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
    }

    static _getDnd5eSubtitleFallback(message) {
        return getMessageAuthorName(message) || '\u00A0';
    }

    static _getRenderedChatMessageElement(message) {
        const messageId = message?.id || message?._id || null;
        if (!messageId) return null;

        return document.querySelector(`[data-message-id="${messageId}"]`)
            || document.querySelector(`li.chat-message[data-message-id="${messageId}"]`)
            || null;
    }

    static _cancelDnd5eHeaderJob(jobKey) {
        const job = this._dnd5eHeaderJobs.get(jobKey);
        if (!job) return;
        job.cancelled = true;
        if (job.rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(job.rafId);
        for (const timer of job.timers || []) clearTimeout(timer);
        this._dnd5eHeaderJobs.delete(jobKey);
    }

    static _applyDnd5eHeaderEnhancementsOnce(message, html, srcOverride = null) {
        if (!this._isDnd5eSystem() || !message) return false;
        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement || !isDnd5eMessageElement(messageElement)) return false;

        this._prepareDnd5eNativeHeader(message, messageElement);
        applyDnd5eTitleAlias(message, messageElement, {
            ensureSubtitle: true,
            subtitleFallback: this._getDnd5eSubtitleFallback(message)
        });
        this._applyDnd5eAvatarPortrait(message, messageElement, srcOverride);
        return true;
    }

    static _scheduleDnd5eHeaderEnhancements(message, html = null, srcOverride = null, { lookupRendered = false } = {}) {
        if (!this._isDnd5eSystem() || !message) return;

        const jobKey = message.id || message._id || message;
        this._cancelDnd5eHeaderJob(jobKey);

        const initialElement = LichsomaChatDom.getChatMessageElement(html);
        const job = { cancelled: false, rafId: null, timers: [] };
        this._dnd5eHeaderJobs.set(jobKey, job);

        const apply = () => {
            if (job.cancelled) return;
            // renderChatMessageHTML receives a pending (detached) element before it is
            // inserted into the live ChatLog. Keep operating on that exact element; falling
            // back to document by message id can mutate an older live DOM node with the same id.
            const element = lookupRendered
                ? this._getRenderedChatMessageElement(message)
                : initialElement;
            if (!element) return;
            this._applyDnd5eHeaderEnhancementsOnce(message, element, srcOverride);
        };

        // One immediate pass, one next-frame pass, and two bounded delayed
        // passes replace the previous nested retry fan-out.
        apply();
        if (typeof requestAnimationFrame === 'function') {
            job.rafId = requestAnimationFrame(apply);
        }
        job.timers.push(setTimeout(apply, 100));
        job.timers.push(setTimeout(() => {
            apply();
            this._dnd5eHeaderJobs.delete(jobKey);
        }, 300));
    }

    static _scheduleRenderedDnd5eHeaderEnhancements(message, srcOverride = null) {
        this._scheduleDnd5eHeaderEnhancements(message, null, srcOverride, { lookupRendered: true });
    }

    static _getDnd5eAvatarPortraitSrc(message, fallbackSrc = null) {
        if (!message) return fallbackSrc || null;

        const flags = message.flags?.['lichsoma-speaker-selector'] || {};

        // 감정 포트레잇은 dnd5e 원본 avatar가 참조해야 할 최우선 이미지다.
        // portraitSrc가 다른 경로에서 기본 액터/토큰 이미지로 덮인 경우에도 emotionPortrait가 우선한다.
        try {
            const emotionPortrait = ActorEmotions?.getEmotionPortraitForMessage?.(message);
            if (emotionPortrait) return emotionPortrait;
        } catch (e) {
            // 감정 포트레잇 확인 실패 시 저장된 portraitSrc / fallback으로 진행
        }

        if (flags.emotionPortrait) return flags.emotionPortrait;
        if (flags.portraitSrc) return flags.portraitSrc;
        if (fallbackSrc) return fallbackSrc;

        const portraitData = this._getMessageImageSync(message.speaker, message.author?.id);
        return portraitData?.src || null;
    }

    static _applyDnd5eAvatarPortrait(message, html, srcOverride = null) {
        if (!this._isDnd5eNativeHeaderMessage(message, html)) return;

        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement) return;

        const avatar = messageElement.querySelector('.message-header .message-sender .avatar');
        const img = avatar?.querySelector?.('img');
        if (!avatar || !img) return;

        const portraitSrc = this._getDnd5eAvatarPortraitSrc(message, srcOverride);
        if (!portraitSrc) return;

        if (!img.dataset.lichsomaOriginalSrc) {
            img.dataset.lichsomaOriginalSrc = img.getAttribute('src') || '';
        }

        if (img.getAttribute('src') !== portraitSrc) {
            img.setAttribute('src', portraitSrc);
        }
        img.dataset.lichsomaPortraitSrc = portraitSrc;
        avatar.dataset.lichsomaPortraitSrc = portraitSrc;

        const alias = getDnd5eTitleAlias(message) || message?.speaker?.alias || '';
        if (alias) img.setAttribute('alt', alias);

        // dnd5e 원본 avatar에도 LichSOMA 포트레잇 프리뷰를 연결한다.
        if (ChatUI && typeof ChatUI._attachPortraitPreview === 'function') {
            try {
                ChatUI._attachPortraitPreview(avatar, portraitSrc);
            } catch (e) {
                // 프리뷰 연결 실패는 표시 자체에 영향을 주지 않으므로 무시
            }
        }
    }

    /**
     * Apply only the presentation changes needed by standalone HTML export.
     *
     * This deliberately avoids live-ChatLog side effects: no updateSource(), no timers,
     * no DOM lookup fallback, no delete-button listeners, no portrait-preview listeners,
     * and no scroll manipulation. The supplied element may remain detached throughout.
     */
    static async prepareMessageElementForExport(message, html) {
        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement || !message) return messageElement || null;

        const $html = $(messageElement);
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};

        if (message.author?.id) messageElement.dataset.authorId = message.author.id;

        const headerElement = messageElement.querySelector('.message-header');
        const actorId = flags.actorId || message.speaker?.actor || null;
        if (headerElement && actorId) headerElement.dataset.actorId = actorId;

        const isDnd5eNativeHeader = this._isDnd5eNativeHeaderMessage(message, messageElement);
        if (isDnd5eNativeHeader) {
            this._prepareDnd5eNativeHeader(message, messageElement);
            applyDnd5eTitleAlias(message, messageElement, {
                ensureSubtitle: true,
                subtitleFallback: this._getDnd5eSubtitleFallback(message)
            });

            const avatar = messageElement.querySelector('.message-header .message-sender .avatar');
            const img = avatar?.querySelector?.('img');
            const portraitSrc = this._getDnd5eAvatarPortraitSrc(message, img?.getAttribute?.('src') || null);
            if (avatar && img && portraitSrc) {
                img.setAttribute('src', portraitSrc);
                img.dataset.lichsomaPortraitSrc = portraitSrc;
                avatar.dataset.lichsomaPortraitSrc = portraitSrc;
                const alias = getDnd5eTitleAlias(message) || message?.speaker?.alias || '';
                if (alias) img.setAttribute('alt', alias);
            }

            const header = messageElement.querySelector('.message-header');
            if (game.settings.get('lichsoma-speaker-selector', this.SETTINGS.APPLY_USER_COLOR)) {
                const userColor = getMessageAuthorColor(message);
                if (userColor) {
                    messageElement.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
                    header?.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
                }
            }

            this._processNarratorChatCard(message, $html);
            return messageElement;
        }

        // Historical export must not depend on the current selected speaker. Prefer a
        // senderAlias persisted with the message; otherwise retain the core-rendered alias.
        const storedAlias = flags.senderAlias;
        const senderElement = this._getSenderElement($html);
        if (storedAlias && senderElement.length) {
            this._setSenderElementDisplayName(senderElement, storedAlias);
        } else if (this._isLancerSystem() && message.speaker?.actor && senderElement.length) {
            const actor = game.actors?.get(message.speaker.actor);
            const parts = this._getLancerSpeakerNameParts(actor, message.speaker);
            if (parts) this._setSenderElementDisplayName(senderElement, parts.name, parts.callsign);
        }
        this._applyUserColorToSender(message, $html);

        if (this._getShowPortraitSetting()) {
            try {
                const portraitData = await this._getMessageImage(message);
                if (portraitData?.src && headerElement) {
                    headerElement.querySelectorAll('.lichsoma-chat-portrait-container').forEach((el) => el.remove());
                    const portraitContainer = this._createPortraitElement(message, portraitData.src, portraitData);
                    headerElement.insertBefore(portraitContainer, headerElement.firstChild || null);
                    headerElement.classList.add('lichsoma-chat-header');
                }
            } catch (_error) {
                // Export keeps the core message usable even when portrait resolution fails.
            }
        }

        this._processNarratorChatCard(message, $html);
        return messageElement;
    }

    static _normalizeFontFamilyName(name) {
        return normalizeFontFamilyName(name);
    }

    static _extractFirstFontFamily(cssText) {
        return extractFirstFontFamily(cssText);
    }

    static _getWebfontCSS(settingKey) {
        try {
            return String(game.settings.get('lichsoma-speaker-selector', settingKey) ?? '');
        } catch (_error) {
            return '';
        }
    }

    static _getWebfontFamily(settingKey) {
        return this._extractFirstFontFamily(this._getWebfontCSS(settingKey));
    }

    static _getWebfontPresentation(settingKey) {
        return extractWebfontPresentation(this._getWebfontCSS(settingKey));
    }

    static _escapeCssString(value) {
        return escapeCssString(value);
    }

    static _quoteFontFamily(font) {
        return quoteFontFamily(font);
    }

    static initialize() {
        initializeChatRenderPipeline();
        installModuleApi({
            apiVersion: 1,
            SpeakerSelector,
            ActorEmotions,
            ChatMerge,
            ChatRenderLimiter,
            ChatSystemBridge,
            registerChatSystemModule,
            unregisterChatSystemModule,
            getRegisteredChatRenderProcessors,
            getRegisteredSocketTypes
        });
        this.registerSettings();
        this.registerKeybindings();
        
        // ActorEmotions 초기화
        ActorEmotions.initialize();
        
        // ChatMerge 초기화
        ChatMerge.initialize();

        // 렌더된 채팅 수 제한 초기화
        ChatRenderLimiter.initialize();
        
        // ChatRubyHandler 초기화
        ChatRubyHandler.initialize();

        // Token HUD 스피커 토글 버튼 초기화
        this._registerTokenHUDHooks();

        // 채팅 메시지 렌더링 훅 추가
        registerChatRenderProcessor('speaker-presentation', 100, (message, html, data) => {
            // html이 HTMLElement이므로 jQuery로 변환
            const $html = $(html);
            const isDnd5eNativeHeader = this._isDnd5eNativeHeaderMessage(message, $html);
            let dnd5ePortraitOverride = null;

            // 메시지 요소에 author.id를 data 속성으로 저장 (챗 머지 기능용)
            const messageElement = LichsomaChatDom.getChatMessageElement(html);
            if (messageElement && message.author?.id) {
                messageElement.dataset.authorId = message.author.id;
            }
            
            // 플래그에 portraitSrc와 userId가 없으면 저장 (머지 기능을 위해 필요)
            const flags = message.flags?.['lichsoma-speaker-selector'] || {};
            
            // speaker가 actor라면 헤더에 data-actor-id 추가
            const headerElement = $html.find('.message-header');
            if (headerElement.length) {
                const actorId = flags.actorId || message.speaker?.actor || null;
                if (actorId) {
                    headerElement.attr('data-actor-id', actorId);
                }
            }
            if (!flags.portraitSrc || !flags.userId || !flags.mergeSpeakerId || !flags.mergeSpeakerType) {
                let speakerData = message.speaker;
                if (speakerData && speakerData.token) {
                    // speaker가 이미 있지만 token이 설정된 경우: "항상 액터로 말하기" 적용 (본인 메시지만)
                    const alwaysUseActor = this._getAlwaysUseActorSetting();
                    if (alwaysUseActor && message.author?.id === game.user.id) {
                        const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                        if (tokenFromSpeaker?.actor) {
                            speakerData = this._buildActorSpeakerData(tokenFromSpeaker.actor, { scene: speakerData.scene || game.scenes.active?.id || null });
                        }
                    }
                }
                if (!speakerData) {
                    // speaker가 없으면 선택한 토큰에서 가져오기
                    const selectedTokens = canvas.tokens?.controlled || [];
                    if (selectedTokens.length > 0) {
                        const token = selectedTokens[0];
                        const alwaysUseActor = this._getAlwaysUseActorSetting();
                        const preventOtherUserCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER);
                        
                        // preventOtherUserCharacter 체크를 가장 먼저 수행 (alwaysUseActor와 독립적으로)
                        if (preventOtherUserCharacter && token.actor && this._isActorAssignedToOtherUser(token.actor)) {
                            // 다른 사용자에게 할당된 액터이므로 해당 토큰/액터로 말하지 않음
                            // 할당된 캐릭터로 설정
                            if (game.user.character) {
                                const character = game.user.character instanceof Actor 
                                    ? game.user.character 
                                    : game.actors.get(game.user.character);
                                if (character) {
                                    speakerData = this._buildActorSpeakerData(character);
                                }
                            }
                        } else if (alwaysUseActor && token.actor) {
                            // 설정이 활성화되어 있으면 액터로 말하기 (token: null)
                            speakerData = this._buildTokenSpeakerData(token, { forceActor: true });
                        } else {
                            // 기본 동작: 토큰으로 말하기
                            speakerData = this._buildTokenSpeakerData(token);
                        }
                    } else if (game.user.character) {
                        // 토큰도 없으면 할당된 캐릭터 사용
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            speakerData = this._buildActorSpeakerData(character);
                        }
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, message.author?.id);
                    const actorId = speakerData.actor || null;
                    const extraFlags = this._addMergeSpeakerFlags(
                        { portraitSrc: portraitData.src, userId: message.author?.id, actorId, senderAlias: speakerData.alias },
                        speakerData,
                        message.author?.id
                    );
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                    if (isDnd5eNativeHeader) dnd5ePortraitOverride = portraitData.src;
                }
            }
            
            if (isDnd5eNativeHeader) {
                this._applyDnd5eNativeHeaderEnhancements(message, $html, dnd5ePortraitOverride);
            }

            // dnd5e는 시스템이 만든 원래 헤더(avatar + name-stacked)를 그대로 사용한다.
            // LichSOMA 기본 헤더 처리(센더명 덮어쓰기, 유저색, 포트레잇 삽입)는 적용하지 않는다.
            if (!isDnd5eNativeHeader) {
                // 스피커 이름 수정 (항상 할당된 캐릭터로 말하기 설정 확인)
                this._fixMessageSenderName(message, $html);

                // 유저 색상 적용 (다른 훅이 실행된 후에 적용하기 위해 약간의 지연)
                setTimeout(() => {
                    this._applyUserColorToSender(message, $html);
                }, 10);

                // 포트레잇 추가
                this._addPortraitToMessage(message, $html, data);
            }

            // 나레이터 채팅 카드 처리
            this._processNarratorChatCard(message, $html);
        }, { runInExport: false });

        // 스피커 셀렉터 초기화
        this.setupSpeakerSelector();
        
        // 나레이터 모드 초기화
        this.setupNarratorMode();
        
        // 채팅 입력 필드 이벤트 리스너 설정
        this._setupChatInputListener();
        
        // 액터 격자 데이터 불러오기
        Hooks.once('ready', () => {
            setTimeout(() => {
                this._loadActorGridData();
                if (this._isDnd5eSystem() && game.user?.isGM) {
                    this._enforceDnd5eDisabledSettings();
                }
                // 폰트 설정 적용
                this._applyChatFonts();
            }, 200);
        });
    }
    
    static async _enforceDnd5eDisabledSettings() {
        if (!this._isDnd5eSystem()) return;

        try {
            const updates = [];
            if (game.settings.get('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT) !== false) {
                updates.push(game.settings.set('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT, false));
            }
            if (updates.length) await Promise.all(updates);
        } catch (e) {
            // 설정 강제 비활성화 실패 시 런타임 helper가 안전하게 처리하므로 무시
        }
    }

    static _getDefaultDataPath() {
        try {
            // FoundryVTT 모듈 경로에서 Data 폴더 경로 추론
            // 모듈의 실제 파일 경로를 가져오기 위해 스크립트 URL 확인
            const scripts = document.querySelectorAll('script[src*="lichsoma-speaker-selector"]');
            if (scripts.length > 0) {
                const scriptUrl = scripts[0].src;
                const url = new URL(scriptUrl);
                
                // file:// 프로토콜인 경우 (로컬 파일 직접 실행)
                if (url.protocol === 'file:') {
                    // 경로에서 /modules/ 부분을 찾아서 Data 폴더까지 경로 추출
                    // 예: file:///G:/FoundryVTT/Data/modules/lichsoma-speaker-selector/scripts/...
                    let pathname = url.pathname;
                    
                    // Windows 경로 처리: hostname이 드라이브 문자인 경우
                    if (url.hostname && url.hostname.length === 1) {
                        // file:///G:/path 형식
                        pathname = `${url.hostname}:${pathname}`;
                    }
                    
                    const pathParts = pathname.split(/[/\\]/).filter(p => p);
                    const modulesIndex = pathParts.indexOf('modules');
                    
                    if (modulesIndex > 0) {
                        // modules 앞까지가 Data 폴더 경로
                        const dataPathParts = pathParts.slice(0, modulesIndex);
                        const dataPath = dataPathParts.join('/');
                        
                        // Windows 경로인 경우 드라이브 문자 확인
                        if (dataPathParts[0] && dataPathParts[0].match(/^[A-Za-z]:$/)) {
                            // 이미 드라이브 문자 포함: G:/FoundryVTT/Data
                            return `file:///${dataPath}`.replace(/\\/g, '/');
                        } else {
                            // 일반 Unix/Mac 경로 또는 Windows 경로 (드라이브가 hostname에 있는 경우)
                            return `file:///${dataPath}`.replace(/\\/g, '/');
                        }
                    }
                }
            }
            
            // HTTP 서버 환경에서는 실제 파일 경로를 직접 얻을 수 없음
            // 빈 문자열 반환하여 사용자가 설정에서 직접 입력하도록 함
            return '';
        } catch (e) {
            // 오류 시 빈 문자열 반환
            return '';
        }
    }

    static registerKeybindings() {
        game.keybindings.register('lichsoma-speaker-selector', 'toggleNarratorMode', {
            name: game.i18n.localize('SPEAKERSELECTOR.Narrator.Keybinding.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Narrator.Keybinding.Hint'),
            editable: [
                {
                    key: 'Space',
                    modifiers: ['SHIFT']
                }
            ],
            onDown: context => {
                if (!game.user?.isGM) return false;
                const event = context?.event;
                if (event?.isComposing || context?.repeat) return false;

                // 편집 요소는 Foundry의 일반 Keybinding 처리에서 제외한다.
                // 실제 채팅 입력창은 아래 capture fallback이 현재 사용자 바인딩으로 처리한다.
                if (event?.target instanceof Element) {
                    const editable = event.target.closest([
                        'input',
                        'textarea',
                        'select',
                        '[contenteditable="true"]',
                        '[contenteditable=""]',
                        'prose-mirror',
                        '.cm-editor',
                        '.CodeMirror'
                    ].join(','));
                    if (editable) return false;
                }

                void this._toggleNarratorMode();
                return true;
            },
            restricted: true,
            precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
        });
    }

    static registerSettings() {
        // 채팅 로그 Export 커스텀 CSS 설정 (메뉴 버튼)
        game.settings.registerMenu('lichsoma-speaker-selector', 'chatLogExportCustomCSSMenu', {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name'),
            label: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.EditButton'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Hint'),
            icon: 'fas fa-code',
            type: ChatLogExportCSSEditor,
            restricted: true
        });

        // 채팅 로그 Export 커스텀 CSS 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_EXPORT_CUSTOM_CSS, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Hint'),
            scope: 'world',
            config: false, // 설정 화면에서 숨기고 버튼으로 열기
            type: String,
            default: '',
            onChange: () => {
                // CSS 변경 시 특별한 처리는 필요 없음 (내보낼 때만 사용)
            }
        });

        const registerWebfontCSSSetting = ({
            menuKey,
            settingKey,
            i18nKey,
            icon,
            editorType,
            showMenu = true,
            onChange = null
        }) => {
            if (showMenu) {
                game.settings.registerMenu('lichsoma-speaker-selector', menuKey, {
                    name: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Name`),
                    label: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.EditButton`),
                    hint: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Hint`),
                    icon,
                    type: editorType,
                    restricted: true
                });
            }

            game.settings.register('lichsoma-speaker-selector', settingKey, {
                name: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Name`),
                hint: game.i18n.localize(`SPEAKERSELECTOR.Settings.${i18nKey}.Hint`),
                scope: 'world',
                config: false,
                restricted: true,
                type: String,
                default: '',
                onChange: value => {
                    this._applyChatFonts();
                    onChange?.(value);
                }
            });
        };

        registerWebfontCSSSetting({
            menuKey: 'chatHeaderWebfontCSSMenu',
            settingKey: this.SETTINGS.CHAT_HEADER_WEBFONT_CSS,
            i18nKey: 'ChatHeaderWebfontCSS',
            icon: 'fas fa-heading',
            editorType: ChatHeaderWebfontCSSEditor
        });
        registerWebfontCSSSetting({
            menuKey: 'dnd5eTitleWebfontCSSMenu',
            settingKey: this.SETTINGS.DND5E_TITLE_WEBFONT_CSS,
            i18nKey: 'Dnd5eTitleWebfontCSS',
            icon: 'fas fa-heading',
            editorType: Dnd5eTitleWebfontCSSEditor,
            showMenu: this._isDnd5eSystem()
        });
        registerWebfontCSSSetting({
            menuKey: 'dnd5eSubtitleWebfontCSSMenu',
            settingKey: this.SETTINGS.DND5E_SUBTITLE_WEBFONT_CSS,
            i18nKey: 'Dnd5eSubtitleWebfontCSS',
            icon: 'fas fa-text-height',
            editorType: Dnd5eSubtitleWebfontCSSEditor,
            showMenu: this._isDnd5eSystem()
        });
        registerWebfontCSSSetting({
            menuKey: 'chatMessageWebfontCSSMenu',
            settingKey: this.SETTINGS.CHAT_MESSAGE_WEBFONT_CSS,
            i18nKey: 'ChatMessageWebfontCSS',
            icon: 'fas fa-font',
            editorType: ChatMessageWebfontCSSEditor
        });
        registerWebfontCSSSetting({
            menuKey: 'chatDiceWebfontCSSMenu',
            settingKey: this.SETTINGS.CHAT_DICE_WEBFONT_CSS,
            i18nKey: 'ChatDiceWebfontCSS',
            icon: 'fas fa-dice-d20',
            editorType: ChatDiceWebfontCSSEditor
        });
        registerWebfontCSSSetting({
            menuKey: 'narratorWebfontCSSMenu',
            settingKey: this.SETTINGS.NARRATOR_WEBFONT_CSS,
            i18nKey: 'NarratorWebfontCSS',
            icon: 'fas fa-comment-dots',
            editorType: NarratorWebfontCSSEditor,
            onChange: () => this._applyNarratorFont()
        });

        // 채팅 로그 Export 경로 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_EXPORT_BASE_PATH, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportBasePath.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportBasePath.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            default: this._getDefaultDataPath()
        });

        // 채팅 로그 Export Base64 변환 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_EXPORT_USE_BASE64, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportUseBase64.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportUseBase64.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                // 설정 변경 시 특별한 처리는 필요 없음 (내보낼 때만 사용)
            }
        });

        // 채팅 로그 Export 주사위 툴팁 표시 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_EXPORT_SHOW_DICE_TOOLTIP, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportShowDiceTooltip.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportShowDiceTooltip.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                // 설정 변경 시 특별한 처리는 필요 없음 (내보낼 때만 사용)
            }
        });

        // 기본 FVTT 채팅 로그 출력 버튼 숨김 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_EXPORT_HIDE_CORE_BUTTON, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportHideCoreButton.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportHideCoreButton.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                // 기존 FVTT 로그 출력 버튼의 표시 상태를 즉시 갱신한다.
                document.dispatchEvent(new CustomEvent('lichsoma-speaker-selector:updateChatExportButtons'));
            }
        });

        // 채팅 로그 삭제 전 HTML 백업 저장 설정
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_LOG_SAVE_HTML_ON_DELETE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogSaveHtmlOnDelete.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogSaveHtmlOnDelete.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ShowPortrait.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ShowPortrait.Hint'),
            scope: 'world',
            config: !this._isDnd5eSystem(),
            restricted: true,
            type: Boolean,
            default: !this._isDnd5eSystem(),
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.PORTRAIT_SIZE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.PortraitSize.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.PortraitSize.Hint'),
            scope: 'world',
            config: !this._isDnd5eSystem(),
            restricted: true,
            type: Number,
            default: 36,
            range: {
                min: 20,
                max: 100,
                step: 4
            }
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.AlwaysUseCharacter.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.AlwaysUseCharacter.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.AlwaysUseActor.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.AlwaysUseActor.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.PreventOtherUserCharacter.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.PreventOtherUserCharacter.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.APPLY_USER_COLOR, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ApplyUserColor.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ApplyUserColor.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: true,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.ENABLE_CHAT_MERGE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.EnableChatMerge.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.EnableChatMerge.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: true,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_RENDER_LIMIT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatRenderLimit.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatRenderLimit.Hint'),
            scope: 'client',
            config: true,
            restricted: false,
            type: String,
            choices: {
                '0': game.i18n.localize('SPEAKERSELECTOR.Settings.ChatRenderLimit.Choices.Disabled'),
                '100': game.i18n.localize('SPEAKERSELECTOR.Settings.ChatRenderLimit.Choices.Keep100'),
                '200': game.i18n.localize('SPEAKERSELECTOR.Settings.ChatRenderLimit.Choices.Keep200')
            },
            default: '0',
            onChange: () => {
                ChatRenderLimiter.onSettingChanged?.();
            }
        });
        // 3. 헤더 폰트 크기
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT_SIZE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFontSize.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFontSize.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 20,
            range: {
                min: 20,
                max: 30,
                step: 1
            },
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                }, 100);
            }
        });

        // 9. 메시지 폰트 크기
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_FONT_SIZE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageFontSize.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageFontSize.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 15,
            range: {
                min: 12,
                max: 18,
                step: 1
            },
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                }, 100);
            }
        });

        // 11. 나레이터 폰트 크기
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT_SIZE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFontSize.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFontSize.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 18,
            range: {
                min: 12,
                max: 36,
                step: 1
            },
            onChange: () => {
                setTimeout(() => {
                    this._applyNarratorFont();
                }, 100);
            }
        });

        // 13. 나레이터 타이핑 속도
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_TYPING_SPEED, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorTypingSpeed.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorTypingSpeed.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 100,
            range: {
                min: 10,
                max: 200,
                step: 10
            },
            onChange: () => {
                // 설정 변경 시 특별한 처리 없음
            }
        });

        // 14. 나레이터 채팅 카드
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_CHAT_CARD, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorChatCard.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorChatCard.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                // 설정 변경 시 채팅 로그 새로고침
                setTimeout(() => {
                    if (ui.chat) {
                        ui.chat.render();
                    }
                }, 100);
            }
        });

        // 15. 나레이터 타이핑 사운드
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_TYPING_SOUND, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorTypingSound.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorTypingSound.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            default: '',
            filePicker: 'audio',
            onChange: () => {
                // 설정 변경 시 특별한 처리 없음
            }
        });
        
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ActorGridActors.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ActorGridActors.Hint'),
            scope: 'world',
            config: false,
            type: Array,
            default: []
        });
    }

    // 메시지 센더 이름 수정
    static _fixMessageSenderName(message, html) {
        const senderElement = this._getSenderElement(html);
        if (!senderElement.length) {
            // 유저 색상 적용 (sender 요소가 없어도)
            this._applyUserColorToSender(message, html);
            return;
        }

        // 스피커 수정 기능은 actor가 없는 OOC/유저 발화도 수정할 수 있으므로,
        // actor 존재 여부보다 저장된 senderAlias를 먼저 적용한다.
        const storedAlias = message.flags?.['lichsoma-speaker-selector']?.senderAlias;
        if (storedAlias) {
            this._setSenderElementDisplayName(senderElement, storedAlias);
            this._applyUserColorToSender(message, html);
            return;
        }

        if (!message.speaker || !message.speaker.actor) {
            // 유저 색상 적용 (speaker가 없어도)
            this._applyUserColorToSender(message, html);
            return;
        }
        
        const actorId = message.speaker.actor;
        const actor = game.actors.get(actorId);

        // LANCER 파일럿/메크 발화는 시스템이 토큰 이름/콜사인을 alias로 넣는 경우가 많다.
        // 스피커 셀렉터에서는 파일럿 실제 이름을 표시하고, 콜사인은 루비로 올린다.
        if (this._isLancerSystem() && actor) {
            const parts = this._getLancerSpeakerNameParts(actor, message.speaker);
            if (parts) {
                this._setSenderElementDisplayName(senderElement, parts.name, parts.callsign);
                this._applyUserColorToSender(message, html);
                return;
            }
        }
        
        if (!actor) {
            // 유저 색상 적용 (actor가 없어도)
            this._applyUserColorToSender(message, html);
            return;
        }
        
        // 할당된 캐릭터 확인
        if (game.user.character) {
            const character = game.user.character instanceof Actor 
                ? game.user.character 
                : game.actors.get(game.user.character);
            
            if (character && message.speaker.actor === character.id) {
                // 메시지의 스피커가 할당된 캐릭터와 일치하는 경우:
                // 1. "항상 할당된 캐릭터로 말하기" 설정이 활성화되어 있거나
                // 2. 스피커 셀렉터에서 할당된 캐릭터를 선택한 경우
                const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
                const isCharacterSelected = this._selectedSpeaker === 'character';
                
                if (alwaysUseCharacter || isCharacterSelected) {
                    // 메시지 센더 이름을 캐릭터 이름으로 수정
                    senderElement.text(character.name);
                    // 유저 색상 적용
                    this._applyUserColorToSender(message, html);
                    return;
                }
            }
        }
        
        // 등록된 액터 확인
        const isRegisteredActorSelected = this._selectedSpeaker && this._selectedSpeaker.startsWith('actor:');
        if (isRegisteredActorSelected) {
            const selectedActorId = this._selectedSpeaker.replace('actor:', '');
            if (selectedActorId === actorId) {
                // 메시지 센더 이름을 액터 이름으로 수정
                senderElement.text(actor.name);
            }
        }
        
        // 유저 색상 적용
        this._applyUserColorToSender(message, html);
    }
    
    // 유저 색상을 sender에 적용
    static _applyUserColorToSender(message, html) {
        // 설정이 꺼져있으면 종료
        if (!game.settings.get('lichsoma-speaker-selector', this.SETTINGS.APPLY_USER_COLOR)) {
            return;
        }
        
        const senderElement = this._getSenderElement(html);
        if (!senderElement.length) {
            return;
        }
        
        const userColor = getMessageAuthorColor(message);
        if (userColor) {
            // !important를 사용하여 CSS를 확실하게 덮어쓰기
            senderElement[0].style.setProperty('color', userColor, 'important');
        }
    }
    
    // 나레이터 채팅 카드 처리
    static _processNarratorChatCard(message, $html) {
        // 나레이터 채팅 카드 설정 확인
        const narratorChatCard = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_CHAT_CARD);
        if (!narratorChatCard) return;
        
        // 나레이터 모드에서 생성된 메시지인지 확인 (플래그 확인)
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};
        const isNarratorMode = flags.isNarratorMode === true;
        
        // 나레이터 모드 플래그가 명시적으로 true인 경우에만 처리
        if (!isNarratorMode) {
            return;
        }
        
        const messageContent = $html.find('.message-content');
        if (!messageContent.length) return;
        
        // 이미 narrator-card로 감싸져 있는지 확인
        const htmlContent = messageContent.html() || '';
        if (htmlContent.includes('narrator-card')) {
            const messageElement = LichsomaChatDom.getChatMessageElement($html);
            if (messageElement) {
                messageElement.classList.add('lichsoma-narrator-card');
            }
            return;
        }
        
        // narrator-card로 감싸기
        const innerContent = messageContent.html();
        if (innerContent && innerContent.trim()) {
            // narrator-card로 감싸기
            messageContent.html(`<div class="narrator-card">${innerContent}</div>`);
            
            // 클래스 추가
            const messageElement = LichsomaChatDom.getChatMessageElement($html);
            if (messageElement) {
                messageElement.classList.add('lichsoma-narrator-card');
            }
        }
    }

    static _isDnd5eNativeHeaderMessage(message, html) {
        if (!this._isDnd5eSystem()) return false;
        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        return isDnd5eMessageElement(messageElement);
    }

    static _prepareDnd5eNativeHeader(message, html) {
        if (!this._isDnd5eNativeHeaderMessage(message, html)) return;

        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (messageElement) {
            messageElement.classList.add('lichsoma-dnd5e-native-header');
        }

        const $root = html?.jquery ? html : $(html);
        const header = $root.find('.message-header');
        if (!header.length) return;

        // 이전 버전이 추가했던 LichSOMA 커스텀 헤더 흔적을 제거하고 dnd5e 원본 헤더를 그대로 사용한다.
        header.removeClass('lichsoma-chat-header');
        header.find('.lichsoma-chat-portrait-container').remove();
        header.find('.message-sender[data-lichsoma-sender="true"]').remove();
        header.find('.lichsoma-dnd5e-original-sender').removeClass('lichsoma-dnd5e-original-sender');
    }

    static _applyDnd5eNativeHeaderEnhancements(message, html, portraitSrc = null) {
        if (!this._isDnd5eNativeHeaderMessage(message, html)) return;

        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement) return;

        // Structural normalization, sender alias, subtitle, and avatar are
        // handled together by one bounded retry job.
        this._scheduleDnd5eHeaderEnhancements(message, messageElement, portraitSrc);

        // CSS가 dnd5e 원본 title/sender에 유저 색상을 적용할 수 있도록 색상 값만 변수로 전달한다.
        const header = messageElement.querySelector('.message-header');
        if (game.settings.get('lichsoma-speaker-selector', this.SETTINGS.APPLY_USER_COLOR)) {
            const userColor = getMessageAuthorColor(message);
            if (userColor) {
                messageElement.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
                header?.style.setProperty('--lichsoma-dnd5e-title-color', userColor);
            } else {
                messageElement.style.removeProperty('--lichsoma-dnd5e-title-color');
                header?.style.removeProperty('--lichsoma-dnd5e-title-color');
            }
        } else {
            messageElement.style.removeProperty('--lichsoma-dnd5e-title-color');
            header?.style.removeProperty('--lichsoma-dnd5e-title-color');
        }

        // dnd5e에서는 LichSOMA의 absolute 삭제 버튼 대신
        // dnd5e 원본 message-metadata 안에 삭제 버튼을 넣는다.
        this._addDeleteButton(message, messageElement);
    }

    static _prepareDnd5eSender(html) {
        // 외부/구버전 호환용 진입점. 현재 render pipeline에서는 호출하지 않는다.
        // dnd5e 원본 헤더에서 과거 LichSOMA 커스텀 헤더 흔적만 정리한다.
        if (!this._isDnd5eSystem() || !html?.length) return;
        this._prepareDnd5eNativeHeader(null, html);
    }

    static _getSenderElement(html) {
        if (!html) return $();
        const $root = html.jquery ? html : $(html);
        const messageElement = LichsomaChatDom.getChatMessageElement($root);
        if (this._isDnd5eNativeHeaderMessage(null, messageElement)) return $();
        const customSender = $root.find('.message-sender[data-lichsoma-sender="true"]');
        if (customSender.length) return customSender;
        return $root.find('.message-sender').first();
    }

    static async _addPortraitToMessage(message, html, data) {
        // dnd5e는 시스템 원본 avatar를 사용하고 LichSOMA 포트레잇은 추가하지 않는다.
        if (this._isDnd5eNativeHeaderMessage(message, html)) return;

        // 설정이 꺼져있으면 종료
        if (!this._getShowPortraitSetting()) return;
        
        // 처리할 메시지 타입 확인
        const messageStyle = message.style;
        // ROLL 스타일은 message.rolls 배열로 확인 (v13+)
        const isRollMessage = message.rolls && message.rolls.length > 0 && !message.flags?.["core"]?.external;
        // WHISPER는 message.whisper 배열로 확인 (v12+)
        const isWhisperMessage = message.whisper && Array.isArray(message.whisper) && message.whisper.length > 0;
        const isOurMessage = 
            (messageStyle === CONST.CHAT_MESSAGE_STYLES.IC) ||
            (messageStyle === CONST.CHAT_MESSAGE_STYLES.EMOTE) ||
            (messageStyle === CONST.CHAT_MESSAGE_STYLES.OOC) ||
            (isRollMessage) ||
            (isWhisperMessage);
        
        // speaker가 없으면 종료
        if (!message.speaker) return;
        
        // 메시지 스타일이 위 조건에 맞거나, speaker에 actor가 있거나, author가 있으면 처리
        // (액터 시트에서 아이템 출력 등, 또는 액터가 없어도 플레이어 아바타/할당된 캐릭터 이미지 사용)
        const hasActor = message.speaker?.actor || null;
        const hasAuthor = message.author?.id || null;
        if (!isOurMessage && !hasActor && !hasAuthor) return;

        // D&D 5e 시스템은 setTimeout으로 비동기 처리 (깜빡임 방지)
        if (game.system.id === 'dnd5e') {
            setTimeout(async () => {
                try {
                    await this._processPortrait(message, html);
                } catch (error) {
                    // D&D5e Portrait Error (무시)
                } finally {
                    ui.chat.scrollBottom();
                }
            }, 0);
        } else {
            // 다른 시스템은 즉시 처리
            try {
                await this._processPortrait(message, html);
            } catch (error) {
                // Portrait Error (무시)
            }
        }
    }

    static async _processPortrait(message, html) {
        const portraitData = await this._getMessageImage(message);
        if (!portraitData || !portraitData.src) return;
        const imgSrc = portraitData.src;

        const header = html.find('.message-header');
        if (!header.length) return;

        // 기존 포트레잇 제거 (중복 방지)
        const existingPortrait = header.find('.lichsoma-chat-portrait-container');
        if (existingPortrait.length) {
            existingPortrait.remove();
        }

        const portraitContainer = this._createPortraitElement(message, imgSrc, portraitData);

        const headerElement = header[0]; // jQuery 객체에서 DOM 요소 추출
        if (headerElement.firstChild) {
            headerElement.insertBefore(portraitContainer, headerElement.firstChild);
        } else {
            headerElement.appendChild(portraitContainer);
        }

        // 헤더에 클래스 추가 (CSS 스타일링용)
        header.addClass('lichsoma-chat-header');

        // 삭제 버튼 추가
        this._addDeleteButton(message, html);
        
        // 포트레잇 프리뷰 연결 (ChatUI가 사용 가능한 경우)
        if (ChatUI && typeof ChatUI._attachPortraitPreview === 'function') {
            const img = portraitContainer.querySelector('.lichsoma-chat-portrait');
            if (img && img.src) {
                ChatUI._attachPortraitPreview(portraitContainer, img.src);
            }
        }
    }

    static _addDeleteButton(message, html) {
        // chat-message 요소 찾기
        const messageElement = LichsomaChatDom.getChatMessageElement(html);
        if (!messageElement) return;

        // notifications 영역이 아닌 일반 채팅에만 추가
        if (LichsomaChatDom.isInChatNotifications(messageElement)) return;

        const $message = $(messageElement);

        // 기존 스피커 셀렉터 삭제 버튼 제거 (중복 방지)
        $message.find('.lichsoma-delete-btn').remove();

        // 권한 체크: 삭제 가능한지 확인
        const canDelete = this._canDeleteMessage(message);
        if (!canDelete) {
            // 권한이 없으면 버튼을 추가하지 않음
            return;
        }

        // dnd5e 원본 헤더에서는 별도 absolute 버튼이 아니라 message-metadata 내부에 넣는다.
        const isDnd5eNativeHeader = this._isDnd5eNativeHeaderMessage(message, messageElement);
        const deleteAriaLabel = game.i18n.localize('SPEAKERSELECTOR.DeleteButton.AriaLabel');
        const deleteTitle = game.i18n.localize('SPEAKERSELECTOR.DeleteButton.Title');
        const $deleteBtn = $(`
            <a class="lichsoma-delete-btn${isDnd5eNativeHeader ? ' lichsoma-dnd5e-metadata-delete' : ''}" aria-label="${deleteAriaLabel}" title="${deleteTitle}">
                <i class="fa-solid fa-trash"></i>
            </a>
        `);

        // 클릭 이벤트 바인딩
        $deleteBtn.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 추가 권한 체크 (이중 확인)
            if (!this._canDeleteMessage(message)) {
                ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.Notifications.DeleteOwnOnly'));
                return;
            }

            message.delete();
        });

        if (isDnd5eNativeHeader) {
            const header = messageElement.querySelector('.message-header');
            if (!header) return;

            let metadata = header.querySelector('.message-metadata');
            if (!metadata) {
                metadata = document.createElement('span');
                metadata.classList.add('message-metadata');
                header.appendChild(metadata);
            }

            // dnd5e/core가 이미 삭제 버튼을 제공하면 중복 추가하지 않는다.
            const hasCoreDelete = metadata.querySelector('.message-delete, [data-action="deleteMessage"]');
            if (!hasCoreDelete) {
                const additionalControls = metadata.querySelector('.chat-control[data-context-menu], [data-context-menu]');
                if (additionalControls) {
                    additionalControls.insertAdjacentElement('beforebegin', $deleteBtn[0]);
                } else {
                    metadata.appendChild($deleteBtn[0]);
                }
            }
            return;
        }

        // 일반 시스템에서는 기존처럼 메시지 루트에 absolute 버튼 추가
        $message.append($deleteBtn);
    }

    // 메시지 삭제 권한 확인
    static _canDeleteMessage(message) {
        // 1. 자신이 작성한 메시지는 삭제 가능
        if (message.author?.id === game.user.id) {
            return true;
        }

        // 2. GM은 모든 메시지 삭제 가능
        if (game.user.isGM) {
            return true;
        }

        // 3. 메시지의 액터에 대한 권한 확인
        const actorId = message.speaker?.actor;
        if (actorId) {
            const actor = game.actors.get(actorId);
            if (actor) {
                // 액터에 대한 권한이 있으면 삭제 가능
                if (actor.isOwner || 
                    actor.testUserPermission(game.user, 'OWNER') ||
                    actor.testUserPermission(game.user, 'OBSERVER') ||
                    actor.testUserPermission(game.user, 'LIMITED')) {
                    return true;
                }
            }
        }

        // 권한이 없으면 삭제 불가
        return false;
    }

    // 액터가 다른 사용자에게 할당되어 있는지 확인
    static _isActorAssignedToOtherUser(actor) {
        if (!actor) return false;
        
        // 모든 사용자를 확인하여 현재 사용자가 아닌 다른 사용자에게 할당되어 있는지 확인
        for (const user of game.users.values()) {
            if (user.id === game.user.id) continue; // 현재 사용자는 제외
            
            const userCharacter = user.character;
            if (!userCharacter) continue;
            
            const characterId = userCharacter instanceof Actor ? userCharacter.id : userCharacter;
            if (characterId === actor.id) {
                return true; // 다른 사용자에게 할당되어 있음
            }
        }
        
        return false; // 다른 사용자에게 할당되어 있지 않음
    }

    static _createPortraitElement(message, imgSrc, portraitData = {}) {
        const portraitSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PORTRAIT_SIZE);

        const portraitContainer = document.createElement('div');
        portraitContainer.classList.add('lichsoma-chat-portrait-container');
        portraitContainer.style.setProperty('--portrait-size', `${portraitSize}px`);
        portraitContainer.style.setProperty('--portrait-scale', 1);
        portraitContainer.style.setProperty('--portrait-scale-x', 1);
        portraitContainer.style.setProperty('--portrait-scale-y', 1);

        const img = document.createElement('img');
        img.src = imgSrc;
        img.classList.add('lichsoma-chat-portrait');
        img.alt = 'actor';
        img.draggable = false;

        const cp = portraitData.chatPortrait;
        if (cp) {
            img.classList.add('lichsoma-chat-portrait--token-framed');
            img.style.setProperty('--lichsoma-cp-anchor-x', `${cp.ax * 100}%`);
            img.style.setProperty('--lichsoma-cp-anchor-y', `${cp.ay * 100}%`);
            img.style.setProperty('--lichsoma-cp-scale', String(cp.scale));
        }

        portraitContainer.appendChild(img);

        return portraitContainer;
    }
    

    /**
     * ChatMessage speaker data를 공식 API를 우선 사용해 생성한다.
     * - token이 있으면 token speaker
     * - forceActor가 true면 actor speaker(token null)
     * - actor/token이 없으면 OOC speaker(actor/token null)
     *
     * 반환값은 기존 모듈 로직과 호환되도록 항상
     * { alias, scene, actor, token } 형태로 정규화한다.
     */
    static _buildSpeakerData({ alias = null, actor = null, token = null, scene = null, forceActor = false, user = game.user } = {}) {
        const sceneDoc = this._resolveSceneDocument(scene);
        const tokenDoc = forceActor ? null : this._resolveTokenDocument(token);
        const tokenObject = tokenDoc || token || null;
        const actorDoc = this._resolveActorDocument(actor || tokenObject?.actor || tokenObject?.document?.actor || null);
        const fallbackAlias = alias || actorDoc?.name || tokenObject?.name || user?.name || game.user?.name || '';
        const sceneId = typeof scene === 'string'
            ? scene
            : sceneDoc?.id || tokenDoc?.parent?.id || game.scenes?.active?.id || canvas?.scene?.id || null;

        let speaker = null;
        try {
            if (typeof ChatMessage?.getSpeaker === 'function') {
                const speakerOptions = {};
                if (sceneDoc) speakerOptions.scene = sceneDoc;
                if (actorDoc) speakerOptions.actor = actorDoc;
                if (tokenDoc && !forceActor) speakerOptions.token = tokenDoc;
                if (fallbackAlias) speakerOptions.alias = fallbackAlias;
                speaker = ChatMessage.getSpeaker(speakerOptions);
            }
        } catch (e) {
            speaker = null;
        }

        return {
            alias: speaker?.alias || fallbackAlias,
            scene: speaker?.scene || sceneId,
            actor: actorDoc?.id || speaker?.actor || null,
            token: (!forceActor && tokenDoc) ? (tokenDoc.id || speaker?.token || null) : null
        };
    }

    static _buildOocSpeakerData(user = game.user, { alias = null, scene = null } = {}) {
        const speaker = this._buildSpeakerData({
            alias: alias || user?.name || game.user?.name || 'Unknown',
            scene,
            user
        });
        // ChatMessage.getSpeaker()는 인자가 비어 있으면 선택 토큰을 추론할 수 있으므로 OOC는 명시적으로 비운다.
        speaker.actor = null;
        speaker.token = null;
        return speaker;
    }

    static _buildActorSpeakerData(actor, { alias = null, token = null, useToken = false, scene = null } = {}) {
        const actorDoc = this._resolveActorDocument(actor);
        if (!actorDoc) return this._buildOocSpeakerData(game.user, { alias, scene });
        return this._buildSpeakerData({
            alias: alias || actorDoc.name,
            actor: actorDoc,
            token: useToken ? token : null,
            scene,
            forceActor: !useToken
        });
    }

    static _buildTokenSpeakerData(token, { alias = null, forceActor = false, scene = null } = {}) {
        const tokenDoc = this._resolveTokenDocument(token);
        const tokenObject = tokenDoc || token;
        const actor = this._resolveActorDocument(tokenObject?.actor || tokenObject?.document?.actor || null);
        if (forceActor && actor) {
            return this._buildActorSpeakerData(actor, { alias: alias || actor.name, scene });
        }
        return this._buildSpeakerData({
            alias: alias || actor?.name || tokenObject?.name || '',
            actor,
            token: tokenDoc || tokenObject,
            scene,
            forceActor
        });
    }

    static _resolveSceneDocument(scene = null) {
        if (!scene) return game.scenes?.active || canvas?.scene || null;
        if (typeof scene !== 'string') return scene;
        return game.scenes?.get(scene) || null;
    }

    static _resolveActorDocument(actor = null) {
        if (!actor) return null;
        if (typeof actor === 'string') return game.actors?.get(actor) || null;
        return actor;
    }

    static _resolveTokenDocument(token = null) {
        if (!token) return null;
        if (typeof token === 'string') {
            return canvas?.scene?.tokens?.get(token) || game.scenes?.active?.tokens?.get(token) || null;
        }
        return token.document || token;
    }

    static _normalizeSpeakerDataForModule(speakerData, user = game.user) {
        const speaker = speakerData || {};
        const tokenDoc = this._resolveTokenDocument(speaker.token || null);
        const actorDoc = this._resolveActorDocument(
            speaker.actor ||
            tokenDoc?.actor ||
            tokenDoc?.document?.actor ||
            speaker.token?.actor ||
            speaker.token?.document?.actor ||
            null
        );
        const sceneDoc = this._resolveSceneDocument(speaker.scene || tokenDoc?.parent || null);
        const sceneId = typeof speaker.scene === 'string'
            ? speaker.scene
            : sceneDoc?.id || tokenDoc?.parent?.id || game.scenes?.active?.id || canvas?.scene?.id || null;
        const alias = speaker.alias || tokenDoc?.name || actorDoc?.name || user?.name || game.user?.name || '';

        return {
            alias,
            scene: sceneId,
            actor: actorDoc?.id || (typeof speaker.actor === 'string' ? speaker.actor : null),
            token: tokenDoc?.id || (typeof speaker.token === 'string' ? speaker.token : null)
        };
    }

    static _getLancerSenderAliasForFlags(speakerData) {
        if (!this._isLancerSystem()) return null;
        const normalized = this._normalizeSpeakerDataForModule(speakerData);
        const actor = normalized.actor ? game.actors?.get(normalized.actor) : null;
        const parts = this._getLancerSpeakerNameParts(actor, normalized);
        return parts?.name || null;
    }

    // 공통: 문서/데이터에 스피커 정보와 센더 이름 플래그 저장
    static _applySpeakerData(doc, data, speakerData, extraFlags = {}) {
        const normalizedSpeakerData = this._normalizeSpeakerDataForModule(speakerData, game.user);
        doc.updateSource({ speaker: normalizedSpeakerData });
        if (!data.speaker) {
            data.speaker = {};
        }
        Object.assign(data.speaker, normalizedSpeakerData);
        this._applySenderFlagsToDoc(doc, data, normalizedSpeakerData.alias, extraFlags, normalizedSpeakerData);
    }
    
    static _applySenderFlagsToDoc(doc, data, alias, extraFlags = {}, speakerData = null) {
        const normalizedSpeakerData = this._normalizeSpeakerDataForModule(speakerData || data?.speaker || doc?.speaker || {}, game.user);
        const moduleFlags = foundry.utils.mergeObject(extraFlags || {}, {}, { inplace: false });
        const userId = moduleFlags.userId || data?.user || doc?.user?.id || doc?.user || game.user?.id || null;

        // 머지 비교 키 저장
        // - 토큰 발화는 token 기준
        // - 액터 발화는 actor 기준
        // - FVTT v14 기본 Public as User처럼 actor/token이 없는 발화는 user 기준
        this._addMergeSpeakerFlags(moduleFlags, normalizedSpeakerData, userId);

        const lancerAlias = this._getLancerSenderAliasForFlags(normalizedSpeakerData);
        if (lancerAlias) {
            moduleFlags.senderAlias = lancerAlias;
        } else if (alias) {
            moduleFlags.senderAlias = alias;
        }
        if (normalizedSpeakerData.actor && !moduleFlags.actorId) moduleFlags.actorId = normalizedSpeakerData.actor;
        if (normalizedSpeakerData.token && !moduleFlags.tokenId) moduleFlags.tokenId = normalizedSpeakerData.token;
        if (!Object.keys(moduleFlags).length) return;

        const existingDocFlags = foundry.utils.getProperty(doc, 'flags.lichsoma-speaker-selector') || {};
        const mergedDocFlags = foundry.utils.mergeObject(existingDocFlags, moduleFlags, { inplace: false });
        doc.updateSource({ flags: { 'lichsoma-speaker-selector': mergedDocFlags } });

        if (!data.flags) data.flags = {};
        const existingDataFlags = data.flags['lichsoma-speaker-selector'] || {};
        data.flags['lichsoma-speaker-selector'] = Object.assign({}, existingDataFlags, moduleFlags);
    }

    static _addMergeSpeakerFlags(flags, speakerData, userId = null) {
        if (!flags || flags.mergeSpeakerId) return flags;

        const mergeKey = this._getMergeSpeakerKey(speakerData, userId);
        if (mergeKey.mergeSpeakerId) {
            flags.mergeSpeakerId = mergeKey.mergeSpeakerId;
            flags.mergeSpeakerType = mergeKey.mergeSpeakerType;
        }
        if (mergeKey.tokenId) {
            flags.tokenId = mergeKey.tokenId;
        }
        return flags;
    }

    /**
     * 채팅 머지용 비교 키 계산
     * - "항상 액터로 말하기"가 꺼져 있고 speaker.token 이 있으면 token 기준
     * - actor가 있으면 actor 기준
     * - actor/token이 없으면 FVTT v14 기본 Public as User 병합을 위해 user 기준
     */
    static _getMergeSpeakerKey(speakerData, userId = null) {
        const speaker = speakerData || {};
        const alwaysUseActor = this._getAlwaysUseActorSetting();
        const tokenId = speaker.token || null;
        const actorId = speaker.actor || null;

        if (!alwaysUseActor && tokenId) {
            return { mergeSpeakerId: tokenId, mergeSpeakerType: 'token', tokenId, actorId };
        }
        if (actorId) {
            return { mergeSpeakerId: actorId, mergeSpeakerType: 'actor', tokenId, actorId };
        }
        return { mergeSpeakerId: userId || null, mergeSpeakerType: 'user', tokenId: null, actorId: null };
    }

    // 동기 버전의 이미지 주소 가져오기 (플래그 저장용)
    static _getMessageImageSync(speaker, authorId) {
        const speakerObj = this._normalizeSpeakerDataForModule(speaker || {}, game.users?.get(authorId) || game.user);
        let img = null;

        // 최우선: 감정 포트레잇 (액터 기반으로 현재 선택된 감정 확인)
        if (ActorEmotions && speakerObj.actor) {
            const savedEmotion = ActorEmotions.getSavedEmotion(speakerObj.actor);
            if (savedEmotion && savedEmotion.emotionPortrait) {
                img = savedEmotion.emotionPortrait;
            }
        }
        
        // 감정 포트레잇이 없으면 기본 우선순위: 토큰 이미지 > 액터 이미지 > 유저 아바타 > 할당된 캐릭터 이미지
        if (!img) {
            if (speakerObj.token) {
                const token = canvas?.tokens?.placeables?.find(t => t.id === speakerObj.token);
                if (token) {
                    img = token?.document?.texture?.src || token?.texture?.src || null;
                }
            }
            
            if (!img && speakerObj.actor) {
                const actor = game.actors.get(speakerObj.actor);
                img = actor?.img || actor?.prototypeToken?.texture?.src || null;
            }
            
            // 액터가 없을 경우 메시지 작성자의 아바타 사용
            if (!img && authorId) {
                const messageAuthor = game.users.get(authorId);
                img = messageAuthor?.avatar || null;
            }
            
            // 아바타도 없을 경우 할당된 캐릭터 이미지 사용
            if (!img && authorId) {
                const messageAuthor = game.users.get(authorId);
                if (messageAuthor?.character) {
                    const character = messageAuthor.character instanceof Actor 
                        ? messageAuthor.character 
                        : game.actors.get(messageAuthor.character);
                    if (character) {
                        img = character?.img || character?.prototypeToken?.texture?.src || null;
                    }
                }
            }
        }

        // 폴백 이미지
        if (!img) {
            img = 'icons/svg/mystery-man.svg';
        }

        return { src: img, scale: 1, scaleX: 1, scaleY: 1 };
    }
    
    static _ensureMessageSenderAlias(message, alias) {
        if (!alias) return;
        const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
        const mergedFlags = foundry.utils.mergeObject(existingFlags, { senderAlias: alias }, { inplace: false });
        message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
    }

    /**
     * 토큰 스피커로 말할 때, 프로토타입 토큰에 저장된 Chat Portrait(스케일·앵커)를 채팅 포트레잇에 적용할지 판별.
     * @returns {{ scale: number; ax: number; ay: number } | null}
     */
    static _resolveChatPortraitTokenTransform(message, imgSrc) {
        const speaker = message.speaker || {};
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};
        const actorId = speaker.actor || flags.actorId;
        if (!speaker.token || !actorId || !imgSrc) return null;

        const actor = game.actors.get(actorId);
        if (!actor) return null;

        const useActorForPortrait =
            this._getAlwaysUseActorSetting() &&
            message.author?.id === game.user.id &&
            speaker.token &&
            actorId;
        if (useActorForPortrait) return null;

        const emotionPortrait = ActorEmotions.getEmotionPortraitForMessage(message);
        const norm = (s) => (s ? String(s).split('?')[0].trim() : '');
        if (emotionPortrait && norm(emotionPortrait) === norm(imgSrc)) return null;

        let tokenTex = null;
        if (speaker.token && canvas?.ready) {
            const t = canvas.tokens.get(speaker.token);
            if (t) tokenTex = t.document?.texture?.src || t.texture?.src;
        }
        if (!tokenTex) tokenTex = actor.prototypeToken?.texture?.src;
        if (!tokenTex || norm(tokenTex) !== norm(imgSrc)) return null;

        const f = actor.prototypeToken.flags?.['lichsoma-speaker-selector'] ?? {};
        let scale = Number(f.chatPortraitScale);
        if (!Number.isFinite(scale)) scale = 1;
        scale = Math.min(3, Math.max(1, scale));
        let ax = Number(f.chatPortraitAnchorX);
        let ay = Number(f.chatPortraitAnchorY);
        if (!Number.isFinite(ax)) ax = 0.5;
        if (!Number.isFinite(ay)) ay = 0.5;
        ax = Math.round(Math.min(1, Math.max(0, ax)) * 100) / 100;
        ay = Math.round(Math.min(1, Math.max(0, ay)) * 100) / 100;
        return { scale, ax, ay };
    }

    static async _getMessageImage(message) {
        const speaker = message.speaker || {};
        const flags = message.flags?.['lichsoma-speaker-selector'] || {};
        // 플래그에 actorId가 있으면 사용 (speaker.actor가 없을 때 대비)
        const actorId = speaker.actor || flags.actorId || null;
        let img = null;

        // 최우선: 저장된 플래그의 portraitSrc (새로 고침 시 저장된 이미지 주소 사용)
        if (flags.portraitSrc) {
            img = flags.portraitSrc;
        }

        // 최우선: 감정 포트레잇 (플래그에 저장된 경우, portraitSrc가 없을 때만)
        if (!img) {
            const emotionPortrait = ActorEmotions.getEmotionPortraitForMessage(message);
            if (emotionPortrait) {
                img = emotionPortrait;
            }
        }
        
        // 감정 포트레잇이 없으면 기본 우선순위: 토큰 이미지 > 액터 이미지 > 유저 아바타 > 할당된 캐릭터 이미지
        // "항상 액터로 말하기" 설정 시 본인 메시지는 토큰 대신 액터 이미지 사용
        if (!img) {
            const useActorForPortrait = this._getAlwaysUseActorSetting()
                && message.author?.id === game.user.id
                && speaker.token
                && actorId;
            if (speaker.token && !useActorForPortrait) {
                const token = canvas?.tokens?.placeables?.find(t => t.id === speaker.token);
                if (token) {
                    img = token?.document?.texture?.src || token?.texture?.src || null;
                }
            }
            
            if (!img && actorId) {
                const actor = game.actors.get(actorId);
                img = actor?.img || actor?.prototypeToken?.texture?.src || null;
            }
            
            // 액터가 없을 경우 메시지 작성자의 아바타 사용
            if (!img && message.author?.id) {
                const messageAuthor = game.users.get(message.author.id);
                img = messageAuthor?.avatar || null;
            }
            
            // 아바타도 없을 경우 할당된 캐릭터 이미지 사용
            if (!img && message.author?.id) {
                const messageAuthor = game.users.get(message.author.id);
                if (messageAuthor?.character) {
                    const character = messageAuthor.character instanceof Actor 
                        ? messageAuthor.character 
                        : game.actors.get(messageAuthor.character);
                    if (character) {
                        img = character?.img || character?.prototypeToken?.texture?.src || null;
                    }
                }
            }
        }

        // 폴백 이미지
        if (!img) {
            img = 'icons/svg/mystery-man.svg';
        }

        const chatPortrait = this._resolveChatPortraitTokenTransform(message, img);
        return { src: img, scale: 1, scaleX: 1, scaleY: 1, chatPortrait };
    }

    // 사이드바 상태 체크 함수 (ChatUI로 위임)
    static _isSidebarCollapsed() {
        return ChatUI.isSidebarCollapsed();
    }

    static _getChatFormFromEventTarget(target) {
        const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
        return element?.closest?.('#chat-form, .chat-form, form[data-application-part="chat-form"], form') || null;
    }

    static _isChatInputEventTarget(target) {
        const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
        if (!element) return false;

        if (element.closest?.('.app.window-app.actor, .application.actor, .actor.sheet, .item.sheet')) {
            return false;
        }

        const chatForm = this._getChatFormFromEventTarget(element);
        if (chatForm) {
            return !!chatForm.closest?.('#sidebar, #chat, .chat-sidebar, [data-tab="chat"], .chat-popout')
                || chatForm.id === 'chat-form'
                || chatForm.classList?.contains('chat-form')
                || chatForm.matches?.('form[data-application-part="chat-form"]');
        }

        return LichsomaChatDom.isInChatForm?.(element)
            || !!element.closest?.('#chat-message, prose-mirror[name="message"], .chat-form');
    }

    static _htmlToPlainText(html) {
        if (html == null) return '';
        const value = String(html);
        if (!/<[a-z][\s\S]*>/i.test(value)) return value;

        const div = document.createElement('div');
        div.innerHTML = value;
        div.querySelectorAll('rt').forEach((rt) => rt.remove());
        return div.textContent || div.innerText || '';
    }

    static _normalizeChatInputComparableText(text) {
        return this._htmlToPlainText(text)
            .replace(/\u00a0/g, ' ')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\[\[([^|\]]+?)\|[^\]]+?\]\]/g, '$1')
            .replace(/\*\*\*([^*]+?)\*\*\*/g, '$1')
            .replace(/\*\*([^*]+?)\*\*/g, '$1')
            .replace(/\*([^*]+?)\*/g, '$1')
            .replace(/~~([^~]+?)~~/g, '$1')
            .replace(/~([^~]+?)~/g, '$1')
            .replace(/[`_]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static _chatInputTextMatchesMessage(inputText, messageContent) {
        const inputComparable = this._normalizeChatInputComparableText(inputText);
        const messageComparable = this._normalizeChatInputComparableText(messageContent);

        if (!inputComparable || !messageComparable) return false;

        return inputComparable === messageComparable
            || inputComparable.includes(messageComparable)
            || messageComparable.includes(inputComparable);
    }

    static _setChatInputPending(text, { userId = game.user?.id, durationMs = 3000 } = {}) {
        if (!text || !String(text).trim()) return;

        this._fromChatInput = true;
        this._chatInputPendingText = String(text);
        this._chatInputPendingUntil = Date.now() + durationMs;
        this._chatInputPendingUserId = userId || game.user?.id || null;
    }

    static _markChatInputPending(target = null, options = {}) {
        const delayMs = Number(options.delayMs || 0);
        if (delayMs > 0) {
            setTimeout(() => this._markChatInputPending(target, { ...options, delayMs: 0 }), delayMs);
            return;
        }

        if (target && !this._isChatInputEventTarget(target)) return;

        const scopedRoot = target?.closest?.('.chat-form, #chat-form') || document;
        const chatInput = this._getChatInputElement(scopedRoot) || this._getChatInputElement();
        const text = this._getChatInputText(chatInput);

        if (!text || !text.trim()) return;

        this._setChatInputPending(text, {
            userId: options.userId || game.user?.id,
            durationMs: options.durationMs || 3000
        });
    }

    static _consumeChatInputPendingForMessage(messageContent, userId = game.user?.id) {
        const now = Date.now();
        const pendingText = this._chatInputPendingText;

        if (!pendingText || now > this._chatInputPendingUntil) return false;
        if (this._chatInputPendingUserId && userId && this._chatInputPendingUserId !== userId) return false;
        if (!this._chatInputTextMatchesMessage(pendingText, messageContent)) return false;

        this._chatInputPendingText = '';
        this._chatInputPendingUntil = 0;
        this._chatInputPendingUserId = null;
        this._fromChatInput = true;
        return true;
    }

    static _isMessageFromChatInput(messageContent, chatInput = null, userId = game.user?.id) {
        if (this._consumeChatInputPendingForMessage(messageContent, userId)) {
            return true;
        }

        const input = chatInput || this._getChatInputElement();
        if (this._isChatInputFocused(input)) {
            const inputText = this._getChatInputText(input);
            if (this._chatInputTextMatchesMessage(inputText, messageContent)) {
                this._setChatInputPending(inputText, { userId, durationMs: 1000 });
                this._consumeChatInputPendingForMessage(messageContent, userId);
                return true;
            }
        }

        return false;
    }

    // 채팅 입력 필드 이벤트 리스너 설정
    static _setupChatInputListener() {
        if (!SpeakerSelector._chatInputDescHotkeyHookRegistered) {
            SpeakerSelector._chatInputDescHotkeyHookRegistered = true;
            Hooks.on('chatInput', SpeakerSelector._onChatInputHookForDescPrefix);
        }

        if (!SpeakerSelector._chatInputGlobalListenersRegistered) {
            SpeakerSelector._chatInputGlobalListenersRegistered = true;

            document.addEventListener('submit', (event) => {
                if (SpeakerSelector._isChatInputEventTarget(event.target)) {
                    SpeakerSelector._markChatInputPending(event.target);
                }
            }, true);

            document.addEventListener('click', (event) => {
                const button = event.target?.closest?.('button, a, [role="button"]');
                if (!button || !SpeakerSelector._isChatInputEventTarget(button)) return;

                const action = button.dataset?.action || '';
                const looksLikeSend =
                    action === 'send' ||
                    action === 'sendMessage' ||
                    action === 'createMessage' ||
                    button.classList?.contains('chat-submit') ||
                    !!button.querySelector?.('.fa-paper-plane, .fa-comment, .fa-message');

                if (looksLikeSend) {
                    SpeakerSelector._markChatInputPending(button);
                }
            }, true);
        }

        // 채팅 입력 필드 찾기 및 이벤트 리스너 추가
        const setupListener = () => {
            const chatInput = this._getChatInputElement();
            if (!chatInput) {
                // 입력 필드가 아직 없으면 잠시 후 다시 시도
                setTimeout(setupListener, 500);
                return;
            }

            // 기존 리스너 제거 (중복 방지)
            chatInput.removeEventListener('focus', this._handleChatInputFocus);
            chatInput.removeEventListener('input', this._handleChatInputInput);
            chatInput.removeEventListener('beforeinput', this._handleChatInputBeforeInput);
            chatInput.removeEventListener('paste', this._handleChatInputPaste);
            chatInput.removeEventListener('blur', this._handleChatInputBlur);
            chatInput.removeEventListener('keydown', this._handleChatInputKeyDown);

            // 포커스 시 플래그 설정
            chatInput.addEventListener('focus', this._handleChatInputFocus);

            // 입력/붙여넣기/ProseMirror beforeinput에도 pending 기록
            chatInput.addEventListener('input', this._handleChatInputInput);
            chatInput.addEventListener('beforeinput', this._handleChatInputBeforeInput);
            chatInput.addEventListener('paste', this._handleChatInputPaste);

            // Enter 키 감지 (메시지 전송 직전 플래그 유지)
            chatInput.addEventListener('keydown', this._handleChatInputKeyDown);

            // 포커스 아웃 시 플래그 초기화
            chatInput.addEventListener('blur', this._handleChatInputBlur);
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

    // 채팅 입력 필드 포커스 핸들러
    static _handleChatInputFocus(event) {
        SpeakerSelector._fromChatInput = true;
        SpeakerSelector._markChatInputPending(event?.target);
    }

    // 채팅 입력 필드 입력 핸들러
    static _handleChatInputInput(event) {
        SpeakerSelector._markChatInputPending(event?.target);
    }

    // ProseMirror beforeinput 핸들러
    static _handleChatInputBeforeInput(event) {
        // 실제 DOM 반영은 이벤트 직후 이뤄질 수 있으므로 다음 틱에서도 갱신한다.
        SpeakerSelector._markChatInputPending(event?.target, { delayMs: 0 });
        SpeakerSelector._markChatInputPending(event?.target, { delayMs: 25 });
    }

    // 붙여넣기 핸들러
    static _handleChatInputPaste(event) {
        SpeakerSelector._fromChatInput = true;
        SpeakerSelector._markChatInputPending(event?.target, { delayMs: 0 });
        SpeakerSelector._markChatInputPending(event?.target, { delayMs: 25 });
    }

    // 채팅 입력 필드 키다운 핸들러
    static _handleChatInputKeyDown(event) {
        // Enter 키를 누르면 메시지 전송 직전이므로 pending 텍스트를 기록한다.
        if (event.key === 'Enter' && !event.shiftKey) {
            SpeakerSelector._markChatInputPending(event?.target);
        }

        // ↑ 키는 Foundry의 직전 메시지 불러오기 이후 입력값이 바뀌므로 지연 갱신한다.
        // Shift+↑ 는 chatInput 훅에서 `/desc ` 삽입으로 처리한다.
        if (event.key === 'ArrowUp' && !event.shiftKey) {
            SpeakerSelector._fromChatInput = true;
            SpeakerSelector._markChatInputPending(event?.target, { delayMs: 0 });
            SpeakerSelector._markChatInputPending(event?.target, { delayMs: 50 });
        }
    }

    /** @type {boolean} */
    static _chatInputDescHotkeyHookRegistered = false;

    /**
     * Shift+↑ : 채팅 입력에 `/desc ` 삽입 (Foundry chatInput 훅 — 코어 ChatInputPlugin보다 먼저 호출됨)
     * @param {KeyboardEvent} event
     * @returns {false|void}
     */
    static _onChatInputHookForDescPrefix(event) {
        if (event.key !== 'ArrowUp' || !event.shiftKey) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!LichsomaChatDom.isInChatForm(event.target) && !event.target?.closest?.('#chat-message, prose-mirror[name="message"]')) return;
        if (!game.settings.get('lichsoma-speaker-selector', SpeakerSelector.SETTINGS.NARRATOR_CHAT_CARD)) return;
        event.preventDefault();
        SpeakerSelector._insertDescSlashPrefixIntoChatInput();
        SpeakerSelector._markChatInputPending(event.target, { delayMs: 25 });
        return false;
    }

    /** 채팅 입력(ProseMirror) 커서 위치에 `/desc ` 삽입 */
    static _insertDescSlashPrefixIntoChatInput() {
        const PREFIX = '/desc ';
        const el = this._getChatInputElement();
        if (!el) return;
        el.focus();
        if (document.execCommand?.('insertText', false, PREFIX)) return;

        const pmRoot = LichsomaChatDom.getProseMirrorRoot(el);
        const View = foundry.prosemirror?.EditorView;
        if (View && typeof View.findFromDOM === 'function' && pmRoot) {
            const view = View.findFromDOM(pmRoot);
            if (view?.state && view.dispatch) {
                const { state } = view;
                const { from, to } = state.selection;
                view.dispatch(state.tr.insertText(PREFIX, from, to));
            }
        }
    }

    // 채팅 입력 필드 블러 핸들러
    static _handleChatInputBlur() {
        // 전송 버튼 클릭/Enter 직후 blur가 먼저 올 수 있으므로 pending 유효시간이 남아 있으면 즉시 지우지 않는다.
        setTimeout(() => {
            if (Date.now() > SpeakerSelector._chatInputPendingUntil) {
                SpeakerSelector._fromChatInput = false;
            }
        }, 100);
    }

    static _postProcessRenderedChatMessage(messageElement) {
        const element = LichsomaChatDom.getChatMessageElement(messageElement);
        if (!element) return;
        const messageId = LichsomaChatDom.getMessageId(element);
        if (!messageId) return;

        const message = game.messages.get(messageId);
        if (!message) return;

        this._refreshRenderedMessageSender(message, element);
    }

    static _refreshRenderedMessageSender(message, messageElement = null, { portraitSrc = null } = {}) {
        const element = LichsomaChatDom.getChatMessageElement(messageElement) || this._getRenderedChatMessageElement(message);
        if (!element || !message) return;

        if (message.author?.id) {
            element.dataset.authorId = message.author.id;
        }

        const headerElement = LichsomaChatDom.getMessageHeader(element);
        if (headerElement) {
            const flags = message.flags?.['lichsoma-speaker-selector'] || {};
            const actorId = flags.actorId || message.speaker?.actor || null;
            if (actorId) headerElement.dataset.actorId = actorId;
            else delete headerElement.dataset.actorId;
        }

        const $messageElement = $(element);
        const isDnd5eNativeHeader = this._isDnd5eNativeHeaderMessage(message, $messageElement);
        if (isDnd5eNativeHeader) {
            this._applyDnd5eNativeHeaderEnhancements(message, $messageElement, portraitSrc);
        } else {
            this._fixMessageSenderName(message, $messageElement);
        }
    }

    static async _refreshRenderedMessageSpeakerPresentation(message, { portraitSrc = null } = {}) {
        const element = this._getRenderedChatMessageElement(message);
        if (!element || !message) return;

        const $messageElement = $(element);
        const isDnd5eNativeHeader = this._isDnd5eNativeHeaderMessage(message, $messageElement);
        this._refreshRenderedMessageSender(message, element, { portraitSrc });
        if (!isDnd5eNativeHeader) {
            await this._addPortraitToMessage(message, $messageElement, {});
        }

        ChatMerge.recheckMessageAndNext?.(element);
    }

    static _postProcessChatLogMessages(root, { forceAll = false } = {}) {
        const chatLog = LichsomaChatDom.getMainChatLog(root) || LichsomaChatDom.getMainChatLog(document);
        if (!chatLog) return;

        const allMessages = Array.from(chatLog.children || [])
            .filter(el => el?.matches?.('.chat-message[data-message-id]') && !LichsomaChatDom.isInChatNotifications(el));
        if (!allMessages.length) return;

        const shouldProcessAll = forceAll || !this._postProcessedChatLogs.has(chatLog);
        if (shouldProcessAll) this._postProcessedChatLogs.add(chatLog);

        const targets = shouldProcessAll
            ? allMessages
            : [allMessages[0], allMessages[1], allMessages[allMessages.length - 2], allMessages[allMessages.length - 1]].filter(Boolean);

        const seen = new Set();
        for (const messageElement of targets) {
            const id = LichsomaChatDom.getMessageId(messageElement) || messageElement;
            if (seen.has(id)) continue;
            seen.add(id);
            this._postProcessRenderedChatMessage(messageElement);
        }
    }

    // 스피커 셀렉터 설정
    static setupSpeakerSelector() {
        // 채팅 로그 렌더링 시 스피커 셀렉터 추가
        Hooks.on('renderChatLog', (app, html, data) => {
            this._renderSpeakerSelector(html);

            // 전체 메시지 순회는 chat-log DOM 인스턴스당 1회로 제한한다.
            // 같은 로그에서 반복 렌더가 발생하면 경계 메시지만 보정한다.
            setTimeout(() => {
                const root = LichsomaChatDom.asElement(html) || document;
                this._postProcessChatLogMessages(root);
            }, 50);
        });

        // 사이드바 렌더링 시도
        Hooks.on('renderSidebarTab', (app, html, data) => {
            if (app.tabName === 'chat') {
                // DOM이 완전히 준비될 때까지 여러 번 시도
                let attempts = 0;
                const maxAttempts = 5;
                const checkAndRender = () => {
                    attempts++;
                    const chatFormElement = this._getSidebarChatFormElement();
                    const chatControls = chatFormElement ? LichsomaChatDom.getChatControls(chatFormElement) : null;
                    const chatInput = chatFormElement ? LichsomaChatDom.getChatInput(chatFormElement) : null;
                    
                    if (chatFormElement && (chatControls || chatInput)) {
                        this._renderSpeakerSelector(document);
                    } else if (attempts < maxAttempts) {
                        setTimeout(checkAndRender, 100);
                    } else {
                    }
                };
                checkAndRender();
            }
        });

        // 사이드바 상태 변경 시 처리
        Hooks.on('collapseSidebar', () => {
            setTimeout(() => {
                if (this._isSidebarCollapsed()) {
                    this._getSidebarChatFormElement()?.querySelector('.lichsoma-speaker-selector')?.remove();
                } else {
                    this._renderSpeakerSelector(document);
                }
            }, 100);
        });

        Hooks.on('expandSidebar', () => {
            setTimeout(() => {
                if (!this._isSidebarCollapsed()) {
                    this._renderSpeakerSelector(document);
                } else {
                    this._getSidebarChatFormElement()?.querySelector('.lichsoma-speaker-selector')?.remove();
                }
            }, 100);
        });

        // ready 훅에서 초기 렌더링은 모듈 초기화 부분에서 처리
    }

    // 스피커 셀렉터 렌더링
    static _renderSpeakerSelector(html) {
        // 중복 실행 방지 플래그 (간단한 버전)
        if (this._isRenderingSelector) {
            return;
        }
        this._isRenderingSelector = true;
        
        // 플래그를 자동으로 해제하는 타이머 설정
        setTimeout(() => {
            this._isRenderingSelector = false;
        }, 1000);

        const rootElement = LichsomaChatDom.asElement(html) || document;

        // 렌더된 앱 루트(사이드바/팝아웃 등)에서 chat-form 우선 탐색
        // - document가 넘어오면 사이드바 chat-form을 먼저 사용
        let chatFormElement = rootElement === document
            ? this._getSidebarChatFormElement(rootElement)
            : this._getChatFormElement(rootElement);
        if (!chatFormElement) chatFormElement = this._getSidebarChatFormElement(document) || this._getChatFormElement(document);

        if (!chatFormElement) {
            this._isRenderingSelector = false;
            return;
        }

        // FVTT v14는 chat-form 전체가 아니라 chat input/controls를 #chat-notifications로 이동시킬 수 있다.
        // 실제로 form 자체가 notification 안에 들어온 환경에서는 Speaker Selector 관련 클래스/버튼을 추가하지 않는다.
        if (LichsomaChatDom.isInChatNotifications(chatFormElement)) {
            this._isRenderingSelector = false;
            return;
        }

        const chatForm = $(chatFormElement);

        // FVTT v14 ProseMirror의 이미지 삽입 기능이 있는 환경에서만 별도 이미지 버튼을 추가한다.
        // FVTT v13에는 해당 이미지 삽입 기능이 없으므로 버튼을 만들지 않는다.
        try {
            if (this._supportsChatEditorImageInsert()) {
                // ProseMirror 상단 메뉴는 기본 숨김
                chatForm.addClass('lichsoma-hide-chat-editor-menu');
                this._renderChatInsertImageButton(chatForm);
            } else {
                chatForm.removeClass('lichsoma-hide-chat-editor-menu');
                chatForm.find('button.lichsoma-insert-image-btn').remove();
            }
        } catch (e) {
            // 무시 (채팅 입력/UI는 시스템/테마에 따라 다를 수 있음)
        }

        // 사이드바 내부일 때만 접힘 상태를 고려 (팝아웃은 사이드바와 무관하게 표시)
        if (chatForm.closest('#sidebar').length > 0) {
            const sidebarCollapsed = this._isSidebarCollapsed();
            if (sidebarCollapsed) {
                chatForm.find('.lichsoma-speaker-selector').remove();
                this._isRenderingSelector = false;
                return;
            }
        }
        
        // chat-controls와 chat-input 사이에 삽입할 위치 찾기
        const chatControls = $(LichsomaChatDom.getChatControls(chatFormElement));
        const chatInput = $(LichsomaChatDom.getChatInput(chatFormElement));

        // 스피커 셀렉터 HTML 생성
        const selectorLabel = game.i18n.localize('SPEAKERSELECTOR.Selector.Label');
        const oocLabel = game.i18n.localize('SPEAKERSELECTOR.Selector.OOC');
        const narratorTitle = game.i18n.localize('SPEAKERSELECTOR.Narrator.Button.Title');
        const narratorAriaLabel = game.i18n.localize('SPEAKERSELECTOR.Narrator.Button.AriaLabel');
        
        // 옵션 생성 함수
        const generateOptions = () => {
            // 항상 액터로 말하기 설정 확인
            const alwaysUseActor = this._getAlwaysUseActorSetting();
            // 항상 할당된 캐릭터로 말하기 설정 확인
            const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
            const isLancer = this._isLancerSystem();
            
            // 할당된 캐릭터 ID 가져오기
            const assignedCharacterId = game.user.character instanceof Actor 
                ? game.user.character?.id 
                : game.user.character;
            const assignedCharacter = assignedCharacterId
                ? (game.user.character instanceof Actor ? game.user.character : game.actors.get(assignedCharacterId))
                : null;
            
            // 설정에 따라 OOC 옵션 추가
            let oocOption = '';
            if (alwaysUseActor || alwaysUseCharacter) {
                // "항상 액터로 말하기" 또는 "항상 할당된 캐릭터로 말하기" 설정이 켜져 있으면 OOC 옵션 추가
                oocOption = this._createSpeakerOptionHTML('ooc', oocLabel);
            }
            
            if (isLancer) {
                const order = this._getLancerSpeakerCategoryOrder();
                const actorEntries = [];

                // 할당된 캐릭터는 기존 value인 character를 유지하되, LANCER actor type에 따라 그룹에 넣는다.
                if (assignedCharacter) {
                    actorEntries.push({ actor: assignedCharacter, value: 'character' });
                }

                if (!game.user.isGM) {
                    // 플레이어가 권한을 가진 다른 캐릭터들 추가 (할당된 캐릭터 제외)
                    const ownedActors = game.actors.filter(actor => {
                        if (actor.id === assignedCharacterId) return false;
                        return actor.isOwner || actor.testUserPermission(game.user, 'OWNER');
                    });

                    ownedActors.forEach(actor => actorEntries.push({ actor, value: `actor:${actor.id}` }));
                } else {
                    // 등록된 액터 옵션은 GM에게만 표시하며, 등록 순서를 보존한 채 LANCER 분류별로 묶는다.
                    this._actorGridActors.forEach(actorId => {
                        const actor = game.actors.get(actorId);
                        if (actor && actor.id !== assignedCharacterId) {
                            actorEntries.push({ actor, value: `actor:${actorId}` });
                        }
                    });
                }

                return `${oocOption}${this._groupLancerSpeakerOptions(actorEntries, order)}`;
            }

            // 설정에 따라 할당된 캐릭터 옵션 추가
            let additionalOption = oocOption;
            if (assignedCharacter) {
                additionalOption += this._createActorSpeakerOptionHTML(assignedCharacter, 'character');
            }
            
            // 플레이어가 권한을 가진 다른 캐릭터들 추가 (할당된 캐릭터 제외)
            let ownedActorOptions = '';
            if (!game.user.isGM) {
                const ownedActors = game.actors.filter(actor => {
                    // 할당된 캐릭터는 제외
                    if (actor.id === assignedCharacterId) return false;
                    // 권한 체크 (OWNER 권한만 허용)
                    return actor.isOwner || 
                           actor.testUserPermission(game.user, 'OWNER');
                });
                
                ownedActors.forEach(actor => {
                    ownedActorOptions += this._createActorSpeakerOptionHTML(actor);
                });
            }
            
            // 등록된 액터 옵션 추가
            let registeredActorOptions = '';
            // 등록된 액터 옵션은 GM에게만 표시
            if (game.user.isGM) {
                this._actorGridActors.forEach(actorId => {
                    const actor = game.actors.get(actorId);
                    if (actor && actor.id !== assignedCharacterId) {
                        registeredActorOptions += this._createActorSpeakerOptionHTML(actor, `actor:${actorId}`);
                    }
                });
            }
            
            return `${additionalOption}${ownedActorOptions}${registeredActorOptions}`;
        };
        
        const selectorHTML = $(`
            <div class="lichsoma-speaker-selector">
                <select class="speaker-dropdown" style="background: var(--color-cool-5-75) !important;">
                    <option value="">${selectorLabel}</option>
                    ${generateOptions()}
                </select>
                <button type="button" class="emotion-btn ui-control icon" title="${game.i18n.localize('SPEAKERSELECTOR.Emotion.SelectTitle')}" aria-label="${game.i18n.localize('SPEAKERSELECTOR.Emotion.SelectTitle')}">
                    <i class="fa-solid fa-face-smile"></i>
                </button>
                ${game.user.isGM ? `
                <button type="button" class="speaker-setting-btn ui-control icon" title="${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Button.Title')}" aria-label="${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Button.AriaLabel')}">
                    <i class="fa-solid fa-masks-theater"></i>
                </button>
                <button type="button" class="narrator-btn ui-control icon" title="${narratorTitle}" aria-label="${narratorAriaLabel}" aria-pressed="${this._narratorModeActive ? 'true' : 'false'}">
                    <i class="fa-solid fa-microphone"></i>
                </button>
                ` : ''}
            </div>
        `);
        
        // 드롭다운이 열릴 때마다 옵션 업데이트 (권한 재확인)
        const updateDropdownOptions = (e) => {
            const dropdown = $(e.target);
            const currentValue = dropdown.val();
            
            // 옵션 업데이트 (권한 재확인)
            const newOptions = generateOptions();
            dropdown.children(':not(:first)').remove();
            dropdown.append(newOptions);
            
            // 현재 선택 값 복원
            if (currentValue) {
                dropdown.val(currentValue);
            }
        };
        
        selectorHTML.find('.speaker-dropdown').on('mousedown', updateDropdownOptions);
        selectorHTML.find('.speaker-dropdown').on('focus', updateDropdownOptions);
        
        // 스피커 드롭다운 변경 이벤트 설정
        selectorHTML.find('.speaker-dropdown').on('change', (e) => {
            const selectedValue = $(e.target).val();
            this._selectedSpeaker = selectedValue;
            
            // 스피커 변경 시 해당 액터의 저장된 감정 복원 (있으면)
            let actorId = null;
            if (selectedValue && selectedValue !== 'ooc' && selectedValue !== 'character') {
                if (selectedValue.startsWith('actor:')) {
                    actorId = selectedValue.replace('actor:', '');
                } else if (selectedValue.startsWith('character:')) {
                    actorId = selectedValue.replace('character:', '');
                }
            } else if (selectedValue === 'character' && game.user.character) {
                actorId = game.user.character instanceof Actor ? game.user.character.id : game.user.character;
            }
            
            if (actorId) {
                const hasEmotion = ActorEmotions.restoreEmotionForActor(actorId);
                if (hasEmotion) {
                    selectorHTML.find('.emotion-btn').addClass('active');
                } else {
                    selectorHTML.find('.emotion-btn').removeClass('active');
                }
            } else {
                ActorEmotions.clearEmotion();
                selectorHTML.find('.emotion-btn').removeClass('active');
            }
            
            // 드롭다운 업데이트 (감정 표시)
            this._updateSpeakerDropdown();
        });
        
        // 감정 버튼 클릭 이벤트 설정
        selectorHTML.find('.emotion-btn').on('click', (e) => {
            e.preventDefault();
            
            // 액터가 선택되어 있어야 함
            if (!this._selectedSpeaker || this._selectedSpeaker === 'ooc') {
                ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.Notifications.SelectActorFirst'));
                return;
            }
            
            let actorId = null;
            if (this._selectedSpeaker.startsWith('actor:')) {
                actorId = this._selectedSpeaker.replace('actor:', '');
            } else if (this._selectedSpeaker.startsWith('character:')) {
                actorId = this._selectedSpeaker.replace('character:', '');
            } else if (this._selectedSpeaker === 'character' && game.user.character) {
                actorId = game.user.character instanceof Actor ? game.user.character.id : game.user.character;
            }
            
            if (actorId) {
                void ActorEmotions.showEmotionSelector(selectorHTML, actorId);
            }
        });
        
        // 저장된 스피커 선택 값 복원
        if (this._selectedSpeaker) {
            selectorHTML.find('.speaker-dropdown').val(this._selectedSpeaker);
        }
        
        // 스피커 설정 버튼 이벤트 설정
        if (game.user.isGM) {
            selectorHTML.find('.speaker-setting-btn').on('click', (e) => {
                e.preventDefault();
                this._showActorGridDialog();
            });
            
            // 나레이터 버튼 이벤트 설정
            selectorHTML.find('.narrator-btn').on('click', (e) => {
                e.preventDefault();
                this._toggleNarratorMode();
            });
            
            // 나레이터 모드 상태에 따라 버튼 활성화
            selectorHTML.find('.narrator-btn').attr('aria-pressed', this._narratorModeActive ? 'true' : 'false');
        }
        
        try {
            // 이미 스피커 셀렉터가 올바른 위치에 있는지 확인
            const existingSelector = chatForm.find('.lichsoma-speaker-selector');
            if (existingSelector.length > 0) {
                const selectorElement = existingSelector[0];
                
                // chat-controls와 chat-input 사이에 있는지 확인
                let isCorrectlyPositioned = false;
                
                if (chatControls.length && chatInput.length) {
                    const isAfterControls = selectorElement.previousElementSibling === chatControls[0];
                    const isBeforeInput = selectorElement.nextElementSibling === chatInput[0];
                    isCorrectlyPositioned = isAfterControls && isBeforeInput;
                } else if (chatInput.length) {
                    isCorrectlyPositioned = selectorElement.nextElementSibling === chatInput[0];
                }
                
                if (isCorrectlyPositioned) {
                    // 기존 셀렉터가 있으면 이벤트와 드롭다운 옵션을 최신 상태로 재설정
                    const $existingSelector = $(existingSelector);
                    if (game.user.isGM) {
                        $existingSelector.find('.narrator-btn').off('click').on('click', (e) => {
                            e.preventDefault();
                            this._toggleNarratorMode();
                        });
                        
                        // 나레이터 모드 상태에 따라 버튼 활성화
                        const $existingBtn = $existingSelector.find('.narrator-btn');
                        $existingBtn.attr('aria-pressed', this._narratorModeActive ? 'true' : 'false');
                        
                        // 스피커 드롭다운 옵션 업데이트 (스피커 설정 그리드 변경 포함)
                        const $dropdown = $existingSelector.find('.speaker-dropdown');
                        const currentValue = $dropdown.val();
                        $dropdown.children(':not(:first)').remove();
                        $dropdown.append(generateOptions());
                        $dropdown.off('mousedown focus').on('mousedown', updateDropdownOptions).on('focus', updateDropdownOptions);
                        
                        // 스피커 드롭다운 변경 이벤트 재설정
                        $dropdown.off('change').on('change', (e) => {
                            const selectedValue = $(e.target).val();
                            this._selectedSpeaker = selectedValue;
                        });
                        
                        // 저장된 스피커 선택 값 복원 (옵션이 존재하는 경우에만)
                        if (this._selectedSpeaker && $dropdown.find(`option[value="${this._selectedSpeaker}"]`).length > 0) {
                            $dropdown.val(this._selectedSpeaker);
                        } else {
                            // 선택한 옵션이 더 이상 존재하지 않으면 빈 값으로 초기화
                            $dropdown.val('');
                            this._selectedSpeaker = '';
                        }
                    }
                    this._isRenderingSelector = false;
                    return;
                } else {
                    existingSelector.remove();
                }
            }
            
            if (chatControls.length && chatInput.length) {
                // 실제 DOM은 chat-input 바로 앞에 삽입하고, 시각적 순서는 chat-form 범위의 CSS가 담당한다.
                // inline order는 FVTT가 동일한 chat input/controls를 notification으로 re-parent할 때 함께 이동하므로 사용하지 않는다.
                try {
                    chatInput[0].insertAdjacentElement('beforebegin', selectorHTML[0]);
                } catch (error) {
                    // chat-input 앞 삽입 실패 시 fallback으로 chat-controls 다음에 삽입
                    chatControls[0].insertAdjacentElement('afterend', selectorHTML[0]);
                }
            } else if (chatInput.length) {
                // chat-controls가 없으면 chat-input 앞에 삽입
                chatInput[0].insertAdjacentElement('beforebegin', selectorHTML[0]);
            } else {
                // 최후 fallback: chat-form 맨 앞에 추가
                chatForm.prepend(selectorHTML);
            }
            
        } catch (error) {
            // 스피커 셀렉터 HTML 추가 실패 (무시)
        } finally {
            // 플래그 리셋
            this._isRenderingSelector = false;
        }
    }

    static _getFoundryGeneration() {
        const generation = Number(game?.release?.generation);
        return Number.isFinite(generation) ? generation : 14;
    }

    static _supportsChatEditorImageInsert() {
        return this._getFoundryGeneration() >= 14;
    }

    static _renderChatInsertImageButton(chatForm) {
        if (!this._supportsChatEditorImageInsert()) return;
        const chatFormElement = LichsomaChatDom.asElement(chatForm) || this._getChatFormElement();
        const $chatForm = chatFormElement ? $(chatFormElement) : $(chatForm ?? document);
        // GM은 보통 #chat-controls .control-buttons 를 가지지만,
        // 플레이어 화면은 해당 영역이 없을 수 있어(#chat-controls만 존재) 폴백을 둔다.
        let $controls = $(LichsomaChatDom.getChatControlButtons(chatFormElement));
        let $controlsRoot = $(LichsomaChatDom.getChatControls(chatFormElement));

        // control-buttons도 chat-controls도 없으면 삽입 불가
        if (!$controls.length && !$controlsRoot.length) return;
        if (!$controls.length) $controls = $controlsRoot;

        // 중복 삽입 방지
        if ($controls.find('button.lichsoma-insert-image-btn').length) return;
        // (GM/플레이어 DOM 차이로 다른 컨테이너에 들어갔던 경우도 방지)
        if ($controlsRoot.length && $controlsRoot.find('button.lichsoma-insert-image-btn').length) return;

        const localizedLabel =
            (game?.i18n?.localize && game.i18n.localize('EDITOR.InsertImage')) || 'Insert Image';

        const $btn = $(`
            <button
                type="button"
                class="ui-control icon fa-solid fa-image lichsoma-insert-image-btn"
                data-tooltip="EDITOR.InsertImage"
                aria-label="${localizedLabel}"
            ></button>
        `);

        $btn.on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._triggerChatEditorInsertImage($chatForm);
        });

        // control-buttons가 있는 환경(GM)은 Export(저장) 버튼 왼쪽에 삽입.
        // 그 외(플레이어 등)는 chat-controls 맨 앞에 삽입.
        const isControlButtons = LichsomaChatDom.getChatControlButtons(chatFormElement) === $controls[0];
        if (isControlButtons) {
            const $exportBtn = $controls
                .find('button[data-action="export"], button.ui-control.icon.fa-solid.fa-floppy-disk')
                .first();

            if ($exportBtn.length) $exportBtn.before($btn);
            else $controls.prepend($btn);
        } else {
            // 플레이어 화면 등: chat-controls의 우측 끝에 위치시키기
            $controls.append($btn);
        }
    }

    static _triggerChatEditorInsertImage(chatForm) {
        const chatFormElement = LichsomaChatDom.asElement(chatForm) || this._getChatFormElement();
        const $chatForm = chatFormElement ? $(chatFormElement) : $(chatForm ?? document);

        // 채팅 입력 에디터 루트 탐색 (사이드바/팝아웃 모두 대응)
        const editorRoot = LichsomaChatDom.getChatInput(chatFormElement) || this._getChatInputElement();

        if (!editorRoot) {
            ui?.notifications?.warn?.(game.i18n.localize('SPEAKERSELECTOR.Notifications.ChatInputNotFound'));
            return;
        }

        // Foundry v14 ProseMirror 툴바의 "Insert Image" 버튼을 찾아 클릭
        // - 드롭다운 내부의 li[data-action="image"]가 아니라, 상단 툴바의 실제 버튼을 정확히 타겟팅
        const imageButton =
            editorRoot.querySelector('.menu-container button[data-action="image"][data-menu="insert"]') ??
            editorRoot.querySelector('.editor-menu button[data-action="image"][data-menu="insert"]') ??
            editorRoot.querySelector('button[data-action="image"][data-menu="insert"]') ??
            editorRoot.querySelector('button[data-action="image"]');

        if (!imageButton) {
            ui?.notifications?.warn?.(game.i18n.localize('SPEAKERSELECTOR.Notifications.InsertImageMenuNotFound'));
            return;
        }

        // 메뉴가 display:none 이면 드롭다운이 좌측 상단에 뜰 수 있어
        // 클릭 순간에만 잠깐 표시하고 바로 다시 숨김
        const wasHiddenByClass = $chatForm.hasClass('lichsoma-hide-chat-editor-menu');
        if (wasHiddenByClass) $chatForm.removeClass('lichsoma-hide-chat-editor-menu');

        // 에디터에 포커스 보장
        try {
            editorRoot.focus?.();
            const pm = editorRoot.querySelector('.ProseMirror');
            pm?.focus?.();
        } catch (e) {
            // ignore
        }

        // 레이아웃 계산 후 클릭
        window.setTimeout(() => {
            try {
                // 실제 사용자 클릭처럼 동작하도록 MouseEvent로 트리거
                imageButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } finally {
                if (wasHiddenByClass) {
                    window.setTimeout(() => $chatForm.addClass('lichsoma-hide-chat-editor-menu'), 50);
                }
            }
        }, 0);
    }
    
    // 나레이터 모드 설정
    static setupNarratorMode() {
        // 나레이터 소켓 리스너 및 키보드 단축키 설정
        this._setupNarratorSocket();
        this._setupNarratorKeyboardShortcut();
        
        // 나레이터 모드 상태 복원
        Hooks.once('ready', async () => {
            // 자신이 GM이면 나레이터 모드 플래그 삭제 (새로고침 시 항상 꺼진 상태로 시작)
            if (game.user.isGM) {
                try {
                    await game.user.unsetFlag('lichsoma-speaker-selector', 'narratorModeActive');
                } catch (e) {
                }
            }
            
            // 다른 접속 중인 GM의 나레이터 모드 확인 (플레이어만)
            if (!game.user.isGM) {
                const gmUsers = game.users.filter(u => u.isGM && u.active && u.id !== game.user.id);
                for (const gm of gmUsers) {
                    const gmNarratorActive = gm.getFlag('lichsoma-speaker-selector', 'narratorModeActive');
                    if (gmNarratorActive) {
                        this._updateNarratorLine(true, '');
                        break;
                    }
                }
            }
        });
        
        // 채팅 메시지 생성 전 나레이터 모드 처리
        // 우선순위를 매우 높게 설정하여(낮은 숫자) 다른 모듈들보다 먼저 실행되도록 함
        // 하지만 실제로는 마지막에 실행되어야 하므로 createChatMessage 훅도 사용
        Hooks.on('preCreateChatMessage', (doc, data, options, userId) => {
            // 현재 사용자가 생성하는 메시지에만 적용
            if (data.user && data.user !== game.user.id) {
                return;
            }
            
            // 채팅 입력 필드가 포커스되어 있고, 입력 필드의 값이 메시지 내용과 일치하면 _fromChatInput을 true로 설정
            // (↑ 키로 이전 메시지 불러올 때 대응)
            const chatInput = this._getChatInputElement();
            const chatInputFocused = this._isChatInputFocused(chatInput);
            const messageContent = typeof data.content === 'string' ? data.content : '';
            const chatInputValue = this._getChatInputText(chatInput);
            
            // HTML 태그 제거하여 순수 텍스트만 비교
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = messageContent;
            const plainMessageContent = (tempDiv.textContent || tempDiv.innerText || '').trim();
            const plainChatInputValue = chatInputValue.trim();
            
            // "---"를 <hr>로 변환 (나레이터 모드와 무관하게 항상 적용)
            // 입력 필드 값과 원본 메시지 내용 모두 확인
            let shouldConvertToHr = false;
            if (typeof data.content === 'string' && data.content) {
                // 원본 메시지 내용 확인
                const tempDiv2 = document.createElement('div');
                tempDiv2.innerHTML = data.content;
                const plainText = (tempDiv2.textContent || tempDiv2.innerText || '').trim();
                if (plainText.replace(/\s+/g, '') === '---') {
                    shouldConvertToHr = true;
                }
            }
            // 입력 필드 값도 확인 (변환 전 원본 확인)
            if (!shouldConvertToHr && plainChatInputValue && plainChatInputValue.replace(/\s+/g, '') === '---') {
                shouldConvertToHr = true;
            }
            
            if (shouldConvertToHr) {
                // data.content와 doc 데이터 모두 업데이트
                data.content = '<hr>';
                if (doc) {
                    doc.updateSource({ content: '<hr>' });
                }
            } else {
                // 텍스트 노드의 세 점(...)을 말줄임표(…)로 변환한다.
                // HTML 태그/속성은 건드리지 않고 실제 표시 텍스트만 처리한다.
                const ellipsisContent = this._replaceTextEllipsesInHtml(data.content);
                if (ellipsisContent !== data.content) {
                    data.content = ellipsisContent;
                    if (doc) {
                        doc.updateSource({ content: ellipsisContent });
                    }
                }
            }
            this._fromChatInput = this._isMessageFromChatInput(data.content || messageContent, chatInput, userId || game.user?.id);
            
            // 채팅 인풋으로 직접 입력한 메시지가 아니면 플래그만 저장하고 나머지는 무시
            // (액터 시트 등에서 생성한 메시지는 나레이터 모드나 할당된 캐릭터 설정을 적용하지 않음)
            if (!this._fromChatInput) {
                // 플래그에 이미지 주소 저장 (머지 기능을 위해 필요)
                let speakerData = data.speaker || doc.speaker;
                let needsSpeakerUpdate = false;
                
                // speaker가 없을 때만 보완 (actor만 비어 있는 경우는 건드리지 않음)
                if (!speakerData) {
                    // 선택한 토큰에서 가져오기
                    const selectedTokens = canvas.tokens?.controlled || [];
                    if (selectedTokens.length > 0) {
                        const token = selectedTokens[0];
                        const preventOtherUserCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER);
                        
                        // preventOtherUserCharacter 체크를 가장 먼저 수행
                        if (preventOtherUserCharacter && token.actor && this._isActorAssignedToOtherUser(token.actor)) {
                            // 다른 사용자에게 할당된 액터이므로 해당 토큰/액터로 말하지 않음
                            // 할당된 캐릭터로 설정
                            if (game.user.character) {
                                const character = game.user.character instanceof Actor 
                                    ? game.user.character 
                                    : game.actors.get(game.user.character);
                                if (character) {
                                    speakerData = this._buildActorSpeakerData(character);
                                    needsSpeakerUpdate = true;
                                }
                            }
                        } else if (token.actor) {
                            speakerData = this._buildTokenSpeakerData(token);
                            needsSpeakerUpdate = true;
                        }
                    } else if (game.user.character) {
                        // 토큰도 없으면 할당된 캐릭터 사용
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            speakerData = this._buildActorSpeakerData(character);
                            needsSpeakerUpdate = true;
                        }
                    }
                }
                
                if (speakerData) {
                    speakerData = this._normalizeSpeakerDataForModule(speakerData, game.users?.get(userId) || game.user);
                    const portraitData = this._getMessageImageSync(speakerData, userId);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId, senderAlias: speakerData.alias };
                    
                    // speaker를 보완한 경우 또는 시스템이 Actor/Token 객체를 speaker에 넣은 경우 실제 메시지에도 정규화된 speaker를 적용한다.
                    if (needsSpeakerUpdate || data.speaker !== speakerData) {
                        this._applySpeakerData(doc, data, speakerData, extraFlags);
                    } else {
                        this._applySenderFlagsToDoc(doc, data, null, extraFlags, speakerData);
                    }
                }
                return;
            }
            
            // "/desc …" 명령 처리 (나레이터 모드와 무관하게)
            const content = typeof data.content === 'string' ? data.content : '';
            const tempDivForDesc = document.createElement('div');
            tempDivForDesc.innerHTML = content;
            const plainTextForDesc = (tempDivForDesc.textContent || tempDivForDesc.innerText || '').trim();
            const descCmdMatch = plainTextForDesc.match(/^\/desc(?:\s+(.*))?$/is);
            
            if (descCmdMatch) {
                // 나레이터 채팅 카드 설정 확인
                const narratorChatCard = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_CHAT_CARD);
                if (narratorChatCard) {
                    const descRemovedText = (descCmdMatch[1] || '').trim();
                    
                    if (descRemovedText) {
                        // HTML 태그가 있는 경우 처리
                        let processedContent = content;
                        if (content.includes('/desc')) {
                            processedContent = content.replace(/\/desc\s*/i, '');
                        } else {
                            processedContent = descRemovedText;
                        }
                        
                        // narrator-card로 감싸기 (이미 감싸져 있지 않은 경우에만)
                        if (!processedContent.includes('narrator-card')) {
                            processedContent = `<div class="narrator-card">${processedContent}</div>`;
                        }
                        
                        data.content = processedContent;
                        if (doc) {
                            doc.updateSource({ content: processedContent });
                        }
                        
                        // OOC로 설정 (나레이터 카드이므로)
                        const narratorSpeakerData = this._buildOocSpeakerData(game.user);
                        // 이미지 주소 계산 및 플래그에 저장
                        const portraitData = this._getMessageImageSync(narratorSpeakerData, userId);
                        const actorId = narratorSpeakerData.actor || null;
                        // 나레이터 카드로 처리된 메시지임을 표시하는 플래그 추가
                        const extraFlags = { portraitSrc: portraitData.src, userId, actorId, isNarratorMode: true };
                        this._applySpeakerData(doc, data, narratorSpeakerData, extraFlags);
                        return; // "/desc" 처리 완료
                    }
                }
            }
            
            // "#"로 시작하는 메시지 처리 (OOC로 전환)
            if (plainTextForDesc.startsWith('#')) {
                // "#" 부분 제거
                const oocRemovedText = plainTextForDesc.substring(1).trim();
                
                if (oocRemovedText) {
                    // HTML 태그가 있는 경우 처리
                    let processedContent = content;
                    // HTML에서도 "#" 부분 제거 시도
                    if (content.startsWith('#')) {
                        // HTML 태그를 유지하면서 "#" 부분만 제거
                        processedContent = content.replace(/^#\s*/, '');
                    } else {
                        // HTML이 없으면 순수 텍스트 사용
                        processedContent = oocRemovedText;
                    }
                    
                    data.content = processedContent;
                    if (doc) {
                        doc.updateSource({ content: processedContent });
                    }
                    
                    // OOC로 설정
                    const oocSpeakerData = this._buildOocSpeakerData(game.user);
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(oocSpeakerData, userId);
                    const actorId = oocSpeakerData.actor || null;
                    // # 처리된 메시지임을 표시하는 플래그 추가
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId, isAtOOC: true };
                    this._applySpeakerData(doc, data, oocSpeakerData, extraFlags);
                    return; // "#" 처리 완료
                }
            }
            
            // 나레이터 모드 체크 (최우선)
            if (this._narratorModeActive && game.user.isGM) {
                // HTML 태그 제거하여 순수 텍스트만 추출
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = content;
                const plainText = tempDiv.textContent || tempDiv.innerText || '';
                
                if (plainText.trim()) {
                    // 로컬에서 타이핑 효과 시작
                    this._startNarratorTyping(plainText);
                    
                    // 소켓으로 모든 클라이언트에 타이핑 효과 전송
                    emitSocket('narratorTyping', { text: plainText });
                }
                
                // 나레이터 채팅 카드 설정 확인
                const narratorChatCard = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_CHAT_CARD);
                if (narratorChatCard && content) {
                    // narrator-card로 감싸기
                    // 이미 감싸져 있지 않은 경우에만 감싸기
                    if (!content.includes('narrator-card')) {
                        data.content = `<div class="narrator-card">${content}</div>`;
                    }
                }
                
                const narratorSpeakerData = this._buildOocSpeakerData(game.user);
                // 이미지 주소 계산 및 플래그에 저장
                const portraitData = this._getMessageImageSync(narratorSpeakerData, userId);
                const actorId = narratorSpeakerData.actor || null;
                // 나레이터 모드에서 생성된 메시지임을 표시하는 플래그 추가
                const extraFlags = { portraitSrc: portraitData.src, userId, actorId, isNarratorMode: true };
                this._applySpeakerData(doc, data, narratorSpeakerData, extraFlags);
                return; // 나레이터 모드가 활성화되어 있으면 여기서 종료
            }
            
            // OOC 또는 할당된 캐릭터 선택 확인 (2순위, 선택한 토큰보다 우선)
            if (this._selectedSpeaker === 'ooc') {
                // OOC 선택
                const oocSpeakerData = this._buildOocSpeakerData(game.user);
                // 이미지 주소 계산 및 플래그에 저장
                const portraitData = this._getMessageImageSync(oocSpeakerData, userId);
                const actorId = oocSpeakerData.actor || null;
                const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                this._applySpeakerData(doc, data, oocSpeakerData, extraFlags);
                return; // OOC 선택이 있으면 여기서 종료
            } else if (this._selectedSpeaker === 'character' && game.user.character) {
                // 할당된 캐릭터 선택
                const character = game.user.character instanceof Actor 
                    ? game.user.character 
                    : game.actors.get(game.user.character);
                
                if (character) {
                    // "항상 액터로 말하기" 설정 확인
                    const alwaysUseActor = this._getAlwaysUseActorSetting();
                    
                    // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                    const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                    const token = tokens.length > 0 ? tokens[0] : null;
                    
                    const characterSpeakerData = this._buildActorSpeakerData(character, { token, useToken: !alwaysUseActor });
                    // 감정 포트레잇이 선택된 경우 플래그에 저장
                    const updateData = { speaker: characterSpeakerData };
                    ActorEmotions.addEmotionFlagsToMessage(updateData);
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(characterSpeakerData, userId);
                    const actorId = characterSpeakerData.actor || null;
                    const extraFlags = foundry.utils.mergeObject(
                        updateData.flags?.['lichsoma-speaker-selector'] || {},
                        { portraitSrc: portraitData.src, userId, actorId, senderAlias: characterSpeakerData.alias },
                        { inplace: false }
                    );
                    this._applySpeakerData(doc, data, characterSpeakerData, extraFlags);
                    return; // 할당된 캐릭터 선택이 있으면 여기서 종료
                }
            } else if (this._selectedSpeaker && this._selectedSpeaker.startsWith('actor:')) {
                // 등록된 액터 선택
                const actorId = this._selectedSpeaker.replace('actor:', '');
                const actor = game.actors.get(actorId);
                
                if (actor) {
                    // 권한 체크 (플레이어인 경우)
                    if (!game.user.isGM && !actor.isOwner && 
                        !actor.testUserPermission(game.user, 'OWNER') &&
                        !actor.testUserPermission(game.user, 'LIMITED') &&
                        !actor.testUserPermission(game.user, 'OBSERVER')) {
                        // 권한이 없으면 기본 동작으로
                        return;
                    }
                    
                    const actorSpeakerData = this._buildActorSpeakerData(actor);
                    
                    // 감정 포트레잇이 선택된 경우 플래그에 저장
                    const updateData = { speaker: actorSpeakerData };
                    ActorEmotions.addEmotionFlagsToMessage(updateData);
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(actorSpeakerData, userId);
                    const actorId = actorSpeakerData.actor || null;
                    const extraFlags = foundry.utils.mergeObject(
                        updateData.flags?.['lichsoma-speaker-selector'] || {},
                        { portraitSrc: portraitData.src, userId, actorId, senderAlias: actorSpeakerData.alias },
                        { inplace: false }
                    );
                    this._applySpeakerData(doc, data, actorSpeakerData, extraFlags);
                    return; // 등록된 액터 선택이 있으면 여기서 종료
                }
            }
            
            // 선택한 토큰 확인 (3순위)
            const selectedTokens = canvas.tokens?.controlled || [];
            const hasSelectedToken = selectedTokens.length > 0;
            
            // 선택한 토큰이 있는 경우에도 플래그에 이미지 주소 저장
            if (hasSelectedToken) {
                // "항상 액터로 말하기" 설정 확인
                const alwaysUseActor = this._getAlwaysUseActorSetting();
                // "다른 사용자에게 할당된 액터의 토큰으로 말하지 않기" 설정 확인
                const preventOtherUserCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER);
                
                const token = selectedTokens[0];
                
                // preventOtherUserCharacter 체크를 가장 먼저 수행 (alwaysUseActor와 독립적으로)
                if (preventOtherUserCharacter && token.actor && this._isActorAssignedToOtherUser(token.actor)) {
                    // 다른 사용자에게 할당된 액터이므로 해당 토큰/액터로 말하지 않음
                    // 할당된 캐릭터가 있으면 할당된 캐릭터로, 없으면 OOC로 설정
                    let speakerData = null;
                    if (game.user.character) {
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            speakerData = this._buildActorSpeakerData(character);
                        }
                    } else {
                        // 할당된 캐릭터가 없으면 OOC로 설정
                        speakerData = this._buildOocSpeakerData(game.user);
                    }
                    
                    if (speakerData) {
                        const portraitData = this._getMessageImageSync(speakerData, userId);
                        const actorId = speakerData.actor || null;
                        const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                        this._applySpeakerData(doc, data, speakerData, extraFlags);
                    }
                    return; // preventOtherUserCharacter가 적용되면 여기서 종료
                }
                
                // preventOtherUserCharacter 체크를 통과한 경우에만 일반 로직 수행
                // data.speaker가 있으면 사용, 없으면 토큰에서 speaker 정보 구성
                let speakerData = data.speaker || doc.speaker;
                if (!speakerData && selectedTokens.length > 0) {
                    if (alwaysUseActor && token.actor) {
                        // 설정이 활성화되어 있으면 액터로 말하기 (token: null)
                        speakerData = this._buildTokenSpeakerData(token, { forceActor: true });
                    } else {
                        // 기본 동작: 토큰으로 말하기
                        speakerData = this._buildTokenSpeakerData(token);
                    }
                } else if (speakerData && alwaysUseActor && speakerData.token) {
                    // 이미 speakerData가 있지만 토큰이 설정되어 있고, 설정이 활성화되어 있으면 액터로 변경
                    const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                    if (tokenFromSpeaker && tokenFromSpeaker.actor) {
                        speakerData = this._buildActorSpeakerData(tokenFromSpeaker.actor, { scene: speakerData.scene || game.scenes.active?.id || null });
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, userId);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                    this._applySpeakerData(doc, data, speakerData, extraFlags);
                }
            }
            
            // 선택한 토큰이 없을 때 "항상 할당된 캐릭터로 말하기" 적용 (4순위)
            if (!hasSelectedToken) {
                // "항상 할당된 캐릭터로 말하기" 설정 확인
                const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
                // "항상 액터로 말하기" 설정 확인
                const alwaysUseActor = this._getAlwaysUseActorSetting();
                
                if (alwaysUseCharacter && game.user.character) {
                    // game.user.character는 이미 Actor 객체이거나 ID일 수 있음
                    const character = game.user.character instanceof Actor 
                        ? game.user.character 
                        : game.actors.get(game.user.character);
                    
                    if (character) {
                        // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                        const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                        const token = tokens.length > 0 ? tokens[0] : null;
                        
                        // 토큰이 없어도 액터만으로 설정 (토큰이 현재 씬에 없어도 할당된 캐릭터로 말하기)
                        const speakerData = this._buildActorSpeakerData(character, { token, useToken: !alwaysUseActor });
                        
                        // 이미지 주소 계산 및 플래그에 저장
                        const portraitData = this._getMessageImageSync(speakerData, userId);
                        const actorId = speakerData.actor || null;
                        const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                        this._applySpeakerData(doc, data, speakerData, extraFlags);
                        return; // "항상 할당된 캐릭터로 말하기"가 적용되면 여기서 종료
                    }
                }
                
                // 설정이 모두 꺼져 있으면 OOC로 설정 (FoundryVTT 기본 동작 방지)
                // 플레이어가 토큰을 선택하지 않고 셀렉터로도 아무것도 선택하지 않았을 때 OOC로 말하기
                // "항상 액터로 말하기"는 토큰 선택 시에만 적용되므로 여기서는 체크하지 않음
                if (!alwaysUseCharacter) {
                    const oocSpeakerData = this._buildOocSpeakerData(game.user);
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(oocSpeakerData, userId);
                    const actorId = oocSpeakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                    this._applySpeakerData(doc, data, oocSpeakerData, extraFlags);
                }
            }
        });
        
        // 메시지 생성 후 플래그 초기화 및 스피커 재설정
        // preCreateChatMessage에서 설정한 스피커가 다른 모듈에 의해 덮어씌워질 수 있으므로
        // createChatMessage에서도 확인하고 재설정
        Hooks.on('createChatMessage', (message, options, userId) => {
            // 현재 사용자가 생성한 메시지에만 적용
            if (userId !== game.user.id) {
                return;
            }
            
                        // create 훅 내부에서 speaker/flags를 보정한 뒤 렌더된 dnd5e 헤더에도 다시 반영한다.
            // setTimeout으로 훅의 나머지 updateSource 처리 이후 실행되게 한다.
            if (this._isDnd5eSystem()) {
                setTimeout(() => this._scheduleRenderedDnd5eHeaderEnhancements(message), 0);
            }

// 채팅 입력 필드가 포커스되어 있고, 입력 필드의 값이 메시지 내용과 일치하면 _fromChatInput을 true로 설정
            // (↑ 키로 이전 메시지 불러올 때 대응)
            const chatInput = this._getChatInputElement();
            const chatInputFocused = this._isChatInputFocused(chatInput);
            const messageContent = typeof message.content === 'string' ? message.content : '';
            const chatInputValue = this._getChatInputText(chatInput);
            
            // HTML 태그 제거하여 순수 텍스트만 비교
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = messageContent;
            const plainMessageContent = (tempDiv.textContent || tempDiv.innerText || '').trim();
            const plainChatInputValue = chatInputValue.trim();
            if (!this._fromChatInput) {
                this._fromChatInput = this._isMessageFromChatInput(messageContent, chatInput, userId || game.user?.id);
            }
            
            // 채팅 인풋으로 직접 입력한 메시지가 아니면 플래그만 저장하고 나머지는 무시
            // (액터 시트 등에서 생성한 메시지는 나레이터 모드나 할당된 캐릭터 설정을 적용하지 않음)
            if (!this._fromChatInput) {
                // 플래그에 이미지 주소 저장 (머지 기능을 위해 필요)
                let speakerData = message.speaker;
                if (speakerData && speakerData.token && message.author?.id === game.user.id) {
                    // speaker가 이미 있지만 token이 설정된 경우: "항상 액터로 말하기" 적용
                    const alwaysUseActor = this._getAlwaysUseActorSetting();
                    if (alwaysUseActor) {
                        const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                        if (tokenFromSpeaker?.actor) {
                            speakerData = this._buildActorSpeakerData(tokenFromSpeaker.actor, { scene: speakerData.scene || game.scenes.active?.id || null });
                            // 메시지 speaker도 액터로 업데이트 (다른 클라이언트/재렌더 시 일관성)
                            message.updateSource({ speaker: speakerData });
                            this._ensureMessageSenderAlias(message, speakerData.alias);
                        }
                    }
                }
                if (!speakerData) {
                    // speaker가 없으면 선택한 토큰에서 가져오기
                    const selectedTokens = canvas.tokens?.controlled || [];
                    if (selectedTokens.length > 0) {
                        const token = selectedTokens[0];
                        const alwaysUseActor = this._getAlwaysUseActorSetting();
                        const preventOtherUserCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER);
                        
                        // preventOtherUserCharacter 체크를 가장 먼저 수행 (alwaysUseActor와 독립적으로)
                        if (preventOtherUserCharacter && token.actor && this._isActorAssignedToOtherUser(token.actor)) {
                            // 다른 사용자에게 할당된 액터이므로 해당 토큰/액터로 말하지 않음
                            // 할당된 캐릭터로 설정
                            if (game.user.character) {
                                const character = game.user.character instanceof Actor 
                                    ? game.user.character 
                                    : game.actors.get(game.user.character);
                                if (character) {
                                    speakerData = this._buildActorSpeakerData(character);
                                }
                            }
                        } else if (alwaysUseActor && token.actor) {
                            // 설정이 활성화되어 있으면 액터로 말하기 (token: null)
                            speakerData = this._buildTokenSpeakerData(token, { forceActor: true });
                        } else {
                            // 기본 동작: 토큰으로 말하기
                            speakerData = this._buildTokenSpeakerData(token);
                        }
                    } else {
                        // 토큰도 없으면 "항상 액터로 말하기" 또는 할당된 캐릭터 사용
                        const alwaysUseActor = this._getAlwaysUseActorSetting();
                        
                        if (alwaysUseActor && game.user.character) {
                            // "항상 액터로 말하기" 설정이 켜져 있고 할당된 캐릭터가 있으면 액터로 말하기
                            const character = game.user.character instanceof Actor 
                                ? game.user.character 
                                : game.actors.get(game.user.character);
                            if (character) {
                                speakerData = this._buildActorSpeakerData(character);
                            }
                        } else if (game.user.character) {
                            // 할당된 캐릭터 사용
                            const character = game.user.character instanceof Actor 
                                ? game.user.character 
                                : game.actors.get(game.user.character);
                            if (character) {
                                speakerData = this._buildActorSpeakerData(character);
                            }
                        }
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, message.author?.id);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId, senderAlias: speakerData.alias };
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                }
                this._fromChatInput = false; // 플래그 초기화
                return;
            }
            
            // 나레이터 모드 체크 (최우선)
            if (this._narratorModeActive && game.user.isGM) {
                // 나레이터 모드면 이미 OOC로 설정되어 있어야 함
                const narratorSpeaker = this._buildOocSpeakerData(game.user);
                
                if (message.speaker?.actor || message.speaker?.token) {
                    message.updateSource({ speaker: narratorSpeaker });
                    this._ensureMessageSenderAlias(message, game.user.name);
                }
                
                // 이미지 주소 계산 및 플래그에 저장
                const portraitData = this._getMessageImageSync(narratorSpeaker, message.author?.id);
                const actorId = narratorSpeaker.actor || null;
                const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                
                this._fromChatInput = false;
                return;
            }
            
            // "@"로 시작한 메시지 처리 (OOC 강제)
            const isAtOOC = message.flags?.['lichsoma-speaker-selector']?.isAtOOC;
            if (isAtOOC) {
                // OOC로 설정
                const oocSpeaker = this._buildOocSpeakerData(game.user);
                
                if (message.speaker?.actor || message.speaker?.token) {
                    message.updateSource({ speaker: oocSpeaker });
                    this._ensureMessageSenderAlias(message, game.user.name);
                }
                
                // 이미지 주소 계산 및 플래그에 저장
                const portraitData = this._getMessageImageSync(oocSpeaker, message.author?.id);
                const actorId = oocSpeaker.actor || null;
                const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId, isAtOOC: true };
                const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                
                this._fromChatInput = false;
                return;
            }
            
            // OOC 또는 할당된 캐릭터 선택 확인 (2순위, 선택한 토큰보다 우선)
            if (this._selectedSpeaker === 'ooc') {
                // OOC 선택
                const oocSpeaker = this._buildOocSpeakerData(game.user);
                
                if (message.speaker?.actor || message.speaker?.token) {
                    message.updateSource({ speaker: oocSpeaker });
                    this._ensureMessageSenderAlias(message, game.user.name);
                }
                
                // 이미지 주소 계산 및 플래그에 저장
                const portraitData = this._getMessageImageSync(oocSpeaker, message.author?.id);
                const actorId = oocSpeaker.actor || null;
                const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                
                this._fromChatInput = false;
                return;
            } else if (this._selectedSpeaker === 'character' && game.user.character) {
                // 할당된 캐릭터 선택
                const character = game.user.character instanceof Actor 
                    ? game.user.character 
                    : game.actors.get(game.user.character);
                
                if (character) {
                    // "항상 액터로 말하기" 설정 확인
                    const alwaysUseActor = this._getAlwaysUseActorSetting();
                    
                    // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                    const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                    const token = tokens.length > 0 ? tokens[0] : null;
                    
                    const expectedSpeaker = this._buildActorSpeakerData(character, { token, useToken: !alwaysUseActor });
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(expectedSpeaker, message.author?.id);
                    const actorId = expectedSpeaker.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                    
                    // 스피커가 다르면 업데이트
                    if (!message.speaker || 
                        message.speaker.alias !== expectedSpeaker.alias ||
                        message.speaker.actor !== expectedSpeaker.actor) {
                        message.updateSource({ speaker: expectedSpeaker });
                        this._ensureMessageSenderAlias(message, character.name);
                    }
                    
                    // 플래그에 이미지 주소 저장
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                }
                this._fromChatInput = false;
                return;
            } else if (this._selectedSpeaker && this._selectedSpeaker.startsWith('actor:')) {
                // 등록된 액터 선택
                const actorId = this._selectedSpeaker.replace('actor:', '');
                const actor = game.actors.get(actorId);
                
                if (actor) {
                    // 권한 체크 (플레이어인 경우)
                    if (!game.user.isGM && !actor.isOwner && 
                        !actor.testUserPermission(game.user, 'OWNER') &&
                        !actor.testUserPermission(game.user, 'LIMITED') &&
                        !actor.testUserPermission(game.user, 'OBSERVER')) {
                        // 권한이 없으면 기본 동작으로
                        this._fromChatInput = false;
                        return;
                    }
                    
                    const expectedSpeaker = this._buildActorSpeakerData(actor);
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(expectedSpeaker, message.author?.id);
                    const actorId = expectedSpeaker.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                    
                    // 스피커가 다르면 업데이트
                    if (!message.speaker || 
                        message.speaker.alias !== expectedSpeaker.alias ||
                        message.speaker.actor !== expectedSpeaker.actor) {
                        message.updateSource({ speaker: expectedSpeaker });
                        this._ensureMessageSenderAlias(message, actor.name);
                    }
                    
                    // 플래그에 이미지 주소 저장
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                }
                this._fromChatInput = false;
                return;
            }
            
            // 선택한 토큰 확인 (3순위)
            const selectedTokens = canvas.tokens?.controlled || [];
            const hasSelectedToken = selectedTokens.length > 0;
            
            // 선택한 토큰이 있는 경우에도 플래그에 이미지 주소 저장
            if (hasSelectedToken && message.speaker) {
                // "항상 액터로 말하기" 설정 확인
                const alwaysUseActor = this._getAlwaysUseActorSetting();
                const preventOtherUserCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.PREVENT_OTHER_USER_CHARACTER);
                
                // preventOtherUserCharacter 체크를 가장 먼저 수행 (alwaysUseActor와 독립적으로)
                // 선택한 토큰 확인
                const selectedToken = selectedTokens[0];
                if (preventOtherUserCharacter && selectedToken && selectedToken.actor && this._isActorAssignedToOtherUser(selectedToken.actor)) {
                    // 다른 사용자에게 할당된 액터이므로 해당 토큰/액터로 말하지 않음
                    // 할당된 캐릭터로 변경
                    if (game.user.character) {
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            const expectedSpeaker = this._buildActorSpeakerData(character, { scene: message.speaker.scene || game.scenes.active?.id || null });
                            
                            // 스피커 업데이트
                            if (!message.speaker || 
                                message.speaker.alias !== expectedSpeaker.alias ||
                                message.speaker.actor !== expectedSpeaker.actor ||
                                message.speaker.token !== null) {
                                message.updateSource({ speaker: expectedSpeaker });
                                this._ensureMessageSenderAlias(message, character.name);
                            }
                            
                            // 이미지 주소 계산 및 플래그에 저장
                            const portraitData = this._getMessageImageSync(expectedSpeaker, message.author?.id);
                            const actorId = expectedSpeaker.actor || null;
                            const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                            const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                            const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                            message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                            return; // preventOtherUserCharacter가 적용되면 여기서 종료
                        }
                    }
                }
                
                // preventOtherUserCharacter 체크를 통과한 경우에만 일반 로직 수행
                // 설정이 활성화되어 있고 토큰이 설정되어 있으면 액터로 변경
                if (alwaysUseActor && message.speaker.token) {
                    const token = canvas.tokens?.placeables?.find(t => t.id === message.speaker.token);
                    if (token && token.actor) {
                        const expectedSpeaker = this._buildTokenSpeakerData(token, { forceActor: true, scene: message.speaker.scene || game.scenes.active?.id || null });
                        
                        // 스피커 업데이트
                        if (message.speaker.alias !== expectedSpeaker.alias ||
                            message.speaker.actor !== expectedSpeaker.actor ||
                            message.speaker.token !== null) {
                            message.updateSource({ speaker: expectedSpeaker });
                            this._ensureMessageSenderAlias(message, token.actor.name);
                        }
                        
                        // 이미지 주소 계산 및 플래그에 저장
                        const portraitData = this._getMessageImageSync(expectedSpeaker, message.author?.id);
                        const actorId = expectedSpeaker.actor || null;
                        const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                        const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                        const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                        message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                        return;
                    }
                }
                
                // 기본 동작: 플래그에 이미지 주소 저장
                const portraitData = this._getMessageImageSync(message.speaker, message.author?.id);
                const actorId = message.speaker?.actor || null;
                const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
            }
            
            // 선택한 토큰이 없을 때 "항상 할당된 캐릭터로 말하기" 적용 (4순위)
            if (!hasSelectedToken) {
                // "항상 할당된 캐릭터로 말하기" 설정 확인
                const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
                // "항상 액터로 말하기" 설정 확인
                const alwaysUseActor = this._getAlwaysUseActorSetting();
                
                if (alwaysUseCharacter && game.user.character) {
                    const character = game.user.character instanceof Actor 
                        ? game.user.character 
                        : game.actors.get(game.user.character);
                    
                    if (character) {
                        // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                        const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                        const token = tokens.length > 0 ? tokens[0] : null;
                        
                        // 메시지의 스피커가 올바르게 설정되었는지 확인
                        const expectedSpeaker = this._buildActorSpeakerData(character, { token, useToken: !alwaysUseActor });
                        
                        // 이미지 주소 계산 및 플래그에 저장
                        const portraitData = this._getMessageImageSync(expectedSpeaker, message.author?.id);
                        const actorId = expectedSpeaker.actor || null;
                        const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                        
                        // 스피커가 다르면 업데이트
                        if (!message.speaker || 
                            message.speaker.alias !== expectedSpeaker.alias ||
                            message.speaker.actor !== expectedSpeaker.actor) {
                            message.updateSource({ speaker: expectedSpeaker });
                            this._ensureMessageSenderAlias(message, character.name);
                        }
                        
                        // 플래그에 이미지 주소 저장
                        const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                        const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                        message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                        this._fromChatInput = false;
                        return; // "항상 할당된 캐릭터로 말하기"가 적용되면 여기서 종료
                    }
                }
                
                // 설정이 모두 꺼져 있으면 OOC로 설정 (FoundryVTT 기본 동작 방지)
                // 플레이어가 토큰을 선택하지 않고 셀렉터로도 아무것도 선택하지 않았을 때 OOC로 말하기
                // "항상 액터로 말하기"는 토큰 선택 시에만 적용되므로 여기서는 체크하지 않음
                if (!alwaysUseCharacter) {
                    const oocSpeaker = this._buildOocSpeakerData(game.user);
                    
                    // 스피커가 다르면 업데이트
                    if (!message.speaker || 
                        message.speaker.alias !== oocSpeaker.alias ||
                        message.speaker.actor !== null ||
                        message.speaker.token !== null) {
                        message.updateSource({ speaker: oocSpeaker });
                        this._ensureMessageSenderAlias(message, game.user.name);
                    }
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(oocSpeaker, message.author?.id);
                    const actorId = oocSpeaker.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                    this._fromChatInput = false;
                }
            }
            
            // 플래그 초기화
            this._fromChatInput = false;
        });
    }
    
    static _isNarratorShortcutAllowedTarget(target) {
        if (!(target instanceof Element)) return true;

        const editable = target.closest([
            'input',
            'textarea',
            'select',
            '[contenteditable="true"]',
            '[contenteditable=""]',
            'prose-mirror',
            '.cm-editor',
            '.CodeMirror'
        ].join(','));

        if (!editable) return true;

        // 일반 설정 창, 검색창, CodeMirror 등에서는 나레이터 단축키 입력을 가로채지 않는다.
        // 다만 실제 Foundry 채팅 입력창에서는 단축키를 사용할 수 있게 허용한다.
        const chatForm = target.closest('form.chat-form, .chat-form');
        if (!chatForm) return false;

        const chatInput = LichsomaChatDom.getChatInput(chatForm);
        if (!chatInput) return false;

        const proseMirrorRoot = LichsomaChatDom.getProseMirrorRoot(chatInput);
        return target === chatInput
            || chatInput.contains(target)
            || target === proseMirrorRoot
            || proseMirrorRoot?.contains(target) === true;
    }

    static _eventMatchesNarratorKeybinding(event) {
        const bindings = game.keybindings.get('lichsoma-speaker-selector', 'toggleNarratorMode') || [];
        if (!bindings.length) return false;

        const pressedModifiers = new Set();
        if (event.shiftKey) pressedModifiers.add('SHIFT');
        if (event.altKey) pressedModifiers.add('ALT');
        if (event.ctrlKey || event.metaKey) pressedModifiers.add('CONTROL');

        return bindings.some(binding => {
            if (!binding?.key || binding.key !== event.code) return false;
            const requiredModifiers = new Set(
                (binding.modifiers || []).map(modifier => String(modifier).toUpperCase())
            );
            if (requiredModifiers.size !== pressedModifiers.size) return false;
            for (const modifier of requiredModifiers) {
                if (!pressedModifiers.has(modifier)) return false;
            }
            return true;
        });
    }

    static _setupNarratorKeyboardShortcut() {
        if (this._narratorShortcutInitialized) return;
        this._narratorShortcutInitialized = true;

        this._narratorShortcutHandler = event => {
            if (!game.user?.isGM) return;
            if (event.defaultPrevented || event.repeat || event.isComposing) return;

            // Foundry의 Keybindings는 일반 화면 입력을 담당한다. 포커스된 편집 요소에서는
            // 기존 UX를 보존하되, 실제 채팅 입력창에 한해서 현재 Configure Controls 바인딩을 사용한다.
            const target = event.target;
            if (!(target instanceof Element)) return;
            const editable = target.closest([
                'input',
                'textarea',
                'select',
                '[contenteditable="true"]',
                '[contenteditable=""]',
                'prose-mirror',
                '.cm-editor',
                '.CodeMirror'
            ].join(','));
            if (!editable) return;
            if (!this._isNarratorShortcutAllowedTarget(target)) return;
            if (!this._eventMatchesNarratorKeybinding(event)) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            void this._toggleNarratorMode();
        };

        // 채팅 ProseMirror가 입력을 처리하기 전에, 현재 사용자 Keybinding과 일치하는 경우만 가로챈다.
        document.addEventListener('keydown', this._narratorShortcutHandler, true);
    }

    static _syncNarratorButtons() {
        const pressed = this._narratorModeActive ? 'true' : 'false';
        document.querySelectorAll('.lichsoma-speaker-selector .narrator-btn').forEach(button => {
            button.setAttribute('aria-pressed', pressed);
        });
    }

    // 나레이터 모드 토글
    static async _toggleNarratorMode() {
        this._narratorModeActive = !this._narratorModeActive;
        
        // 메인 채팅과 팝아웃에 존재하는 모든 나레이터 버튼 상태 업데이트
        this._syncNarratorButtons();
        
        // 유저 플래그에 상태 저장 (새로고침 시 복원용)
        try {
            await game.user.setFlag('lichsoma-speaker-selector', 'narratorModeActive', this._narratorModeActive);
        } catch (e) {
        }
        
        // 소켓으로 모든 클라이언트에 상태 전송
        emitSocket('narratorMode', { active: this._narratorModeActive });
        
        // 로컬에서 나레이터 라인 표시/숨김
        this._updateNarratorLine(this._narratorModeActive);
        
    }
    
    static _clearNarratorLineTransition() {
        if (this._narratorLineRemovalTimeout) {
            clearTimeout(this._narratorLineRemovalTimeout);
            this._narratorLineRemovalTimeout = null;
        }
        if (this._narratorLineEnterFrame) {
            cancelAnimationFrame(this._narratorLineEnterFrame);
            this._narratorLineEnterFrame = null;
        }
        if (this._narratorLineEnterSecondFrame) {
            cancelAnimationFrame(this._narratorLineEnterSecondFrame);
            this._narratorLineEnterSecondFrame = null;
        }
    }

    // 나레이터 라인 업데이트
    static _updateNarratorLine(active, text = '') {
        this._narratorLineVisible = active === true;

        if (active) {
            // 진행 중인 제거 예약을 취소해 빠르게 다시 켜도 새 라인이 사라지지 않게 한다.
            this._clearNarratorLineTransition();

            // 나레이터 라인이 없으면 초기 opacity 0 상태로 생성하고 다음 프레임부터 페이드인한다.
            if (!this._narratorLineElement) {
                this._createNarratorLine();
            } else {
                this._narratorLineElement.style.opacity = '1';
            }

            // 텍스트 업데이트
            if (this._narratorTextElement) {
                this._narratorTextElement.textContent = text;
            }
        } else {
            // 나레이터 라인이 사라질 때 진행 중인 타이핑과 지연 작업도 함께 정리한다.
            this._clearNarratorTypingTimers();
            this._clearNarratorLineTransition();

            // 나레이터 라인 페이드아웃 후 제거
            const line = this._narratorLineElement;
            if (line) {
                line.style.opacity = '0';
                this._narratorLineRemovalTimeout = setTimeout(() => {
                    this._narratorLineRemovalTimeout = null;
                    if (this._narratorLineVisible || this._narratorLineElement !== line) return;

                    line.remove();
                    this._narratorLineElement = null;
                    this._narratorTextElement = null;
                }, 500);
            }
        }
    }
    
    // 나레이터 라인 생성
    static _createNarratorLine() {
        this._clearNarratorLineTransition();

        // 기존 요소 제거
        if (this._narratorLineElement) {
            this._narratorLineElement.remove();
        }
        
        // 나레이터 라인 컨테이너 생성
        this._narratorLineElement = document.createElement('div');
        this._narratorLineElement.className = 'lichsoma-narrator-line';
        this._narratorLineElement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 80%;
            height: 50px;
            pointer-events: none;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
        `;
        
        // 배경 바 (좌우로 투명해지는 그라데이션)
        const bgBar = document.createElement('div');
        bgBar.style.cssText = `
            position: absolute;
            width: 100%;
            height: 100%;
            background: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.7) 20%, rgba(0, 0, 0, 0.7) 80%, transparent 100%);
            border-radius: 20px;
        `;
        
        // 텍스트 요소
        this._narratorTextElement = document.createElement('div');
        this._narratorTextElement.className = 'lichsoma-narrator-text';
        this._narratorTextElement.style.cssText = `
            position: relative;
            color: white;
            text-align: center;
            padding: 0 20px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
            white-space: nowrap;
            overflow: hidden;
            max-width: 100%;
            opacity: 1;
            transition: opacity 0.5s ease-in-out;
        `;
        this._narratorTextElement.textContent = '';
        
        // 폰트 설정 적용
        this._applyNarratorFont();
        
        this._narratorLineElement.appendChild(bgBar);
        this._narratorLineElement.appendChild(this._narratorTextElement);
        document.body.appendChild(this._narratorLineElement);
        
        // 첫 화면에는 opacity 0 상태가 실제로 그려지도록 두 프레임을 분리한 뒤 페이드인한다.
        // 단순 setTimeout은 첫 페인트 이전에 opacity 1이 적용되어 transition이 생략될 수 있다.
        const line = this._narratorLineElement;
        line.getBoundingClientRect();
        this._narratorLineEnterFrame = requestAnimationFrame(() => {
            this._narratorLineEnterFrame = null;
            this._narratorLineEnterSecondFrame = requestAnimationFrame(() => {
                this._narratorLineEnterSecondFrame = null;
                if (this._narratorLineVisible && this._narratorLineElement === line) {
                    line.style.opacity = '1';
                }
            });
        });
        
    }
    
    // 나레이터 소켓 설정
    static _setupNarratorSocket() {
        if (this._narratorSocketInitialized) return;
        this._narratorSocketInitialized = true;

        registerSocketHandler('narratorMode', data => {
            const sender = data.userId ? game.users.get(data.userId) : null;
            if (!sender?.isGM) return;
            this._updateNarratorLine(data.active === true, String(data.text ?? '').slice(0, 20000));
        });

        registerSocketHandler('narratorTyping', data => {
            const sender = data.userId ? game.users.get(data.userId) : null;
            if (!sender?.isGM || data.userId === game.user.id) return;
            this._startNarratorTyping(String(data.text ?? '').slice(0, 20000));
        });
    }
    
    // 사용자에게 보이는 문자 단위로 문자열을 분리한다.
    static _splitNarratorGraphemes(value) {
        const text = String(value ?? '');
        if (!text) return [];

        try {
            if (typeof Intl?.Segmenter === 'function') {
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
                return Array.from(segmenter.segment(text), (entry) => entry.segment);
            }
        } catch (_) {
            // Intl.Segmenter를 사용할 수 없는 환경에서는 코드 포인트 단위로 폴백한다.
        }

        return Array.from(text);
    }

    // 나레이터 문자열을 최초 한 번만 일반 텍스트와 루비 구간으로 파싱한다.
    static _parseNarratorTypingSegments(text) {
        const source = String(text ?? '');
        const segments = [];
        const rubyPattern = /\[\[([^|\]]+?)\|([^\]]+?)\]\]/g;
        let cursor = 0;
        let match;

        const pushPlain = (value) => {
            if (!value) return;
            const graphemes = this._splitNarratorGraphemes(value);
            if (graphemes.length) segments.push({ type: 'text', graphemes });
        };

        while ((match = rubyPattern.exec(source)) !== null) {
            pushPlain(source.slice(cursor, match.index));

            const base = this._splitNarratorGraphemes(match[1]);
            const reading = this._splitNarratorGraphemes(match[2]);
            if (base.length) {
                segments.push({ type: 'ruby', base, reading });
            } else {
                pushPlain(match[0]);
            }

            cursor = match.index + match[0].length;
        }

        pushPlain(source.slice(cursor));
        return segments;
    }

    // 파싱된 세그먼트로 DOM과 글자별 갱신 계획을 한 번만 만든다.
    static _buildNarratorTypingPlan(text) {
        const fragment = document.createDocumentFragment();
        const steps = [];
        const segments = this._parseNarratorTypingSegments(text);

        for (const segment of segments) {
            if (segment.type === 'text') {
                const node = document.createTextNode('');
                fragment.appendChild(node);

                for (const grapheme of segment.graphemes) {
                    steps.push({ type: 'text', node, grapheme });
                }
                continue;
            }

            const ruby = document.createElement('ruby');
            ruby.classList.add('lichsoma-ruby', 'lichsoma-narrator-ruby-progress');

            const rb = document.createElement('rb');
            rb.textContent = '';

            const rt = document.createElement('rt');
            rt.setAttribute('aria-label', segment.reading.join(''));

            // 완성된 루비 전체 폭을 처음부터 확보하되, 실제 문자는 한 덩어리로 점진 노출한다.
            const readingShell = document.createElement('span');
            readingShell.className = 'lichsoma-narrator-ruby-reading-shell';
            readingShell.setAttribute('aria-hidden', 'true');

            const readingGhost = document.createElement('span');
            readingGhost.className = 'lichsoma-narrator-ruby-reading-ghost';
            readingGhost.textContent = segment.reading.join('');

            const readingVisible = document.createElement('span');
            readingVisible.className = 'lichsoma-narrator-ruby-reading-visible';
            readingVisible.textContent = '';

            readingShell.append(readingGhost, readingVisible);
            rt.appendChild(readingShell);
            ruby.append(rb, rt);
            fragment.appendChild(ruby);

            const baseLength = segment.base.length;
            const readingLength = segment.reading.length;
            for (let index = 0; index < baseLength; index += 1) {
                const baseVisible = index + 1;
                const readingVisibleCount = readingLength > 0
                    ? Math.max(1, Math.min(readingLength, Math.round((baseVisible * readingLength) / baseLength)))
                    : 0;

                steps.push({
                    type: 'ruby',
                    rb,
                    readingVisible,
                    baseText: segment.base.slice(0, baseVisible).join(''),
                    readingText: segment.reading.slice(0, readingVisibleCount).join(''),
                    grapheme: segment.base[index]
                });
            }
        }

        return { fragment, steps };
    }

    static _clearNarratorTypingTimers() {
        if (this._narratorTypingInterval) {
            clearInterval(this._narratorTypingInterval);
            this._narratorTypingInterval = null;
        }
        if (this._narratorTypingCompleteTimeout) {
            clearTimeout(this._narratorTypingCompleteTimeout);
            this._narratorTypingCompleteTimeout = null;
        }
        if (this._narratorFadeTimeout) {
            clearTimeout(this._narratorFadeTimeout);
            this._narratorFadeTimeout = null;
        }
    }

    static _playNarratorTypingSoundThrottled(grapheme) {
        if (!grapheme || !String(grapheme).trim()) return;

        const now = globalThis.performance?.now?.() ?? Date.now();
        const minimumInterval = 55;
        if ((now - (this._lastNarratorSoundAt || 0)) < minimumInterval) return;

        this._lastNarratorSoundAt = now;
        this._playNarratorTypingSound();
    }

    // 나레이터 타이핑 효과 시작
    static _startNarratorTyping(text) {
        this._clearNarratorTypingTimers();
        this._lastNarratorSoundAt = 0;

        if (!this._narratorLineElement) {
            this._createNarratorLine();
        }
        if (!this._narratorTextElement) return;

        const { fragment, steps } = this._buildNarratorTypingPlan(text);
        const typingSpeed = Math.max(
            1,
            Number(game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_TYPING_SPEED)) || 100
        );
        const duration = 3;

        this._narratorTextElement.replaceChildren(fragment);
        this._narratorTextElement.style.opacity = '1';

        if (!steps.length) {
            this._narratorTypingCompleteTimeout = setTimeout(() => this._stopNarratorTyping(), duration * 1000);
            return;
        }

        let currentIndex = 0;
        const advance = () => {
            const step = steps[currentIndex];
            if (!step) return;

            if (step.type === 'text') {
                step.node.appendData(step.grapheme);
            } else {
                step.rb.textContent = step.baseText;
                step.readingVisible.textContent = step.readingText;
            }

            this._playNarratorTypingSoundThrottled(step.grapheme);
            currentIndex += 1;

            if (currentIndex >= steps.length) {
                clearInterval(this._narratorTypingInterval);
                this._narratorTypingInterval = null;
                this._narratorTypingCompleteTimeout = setTimeout(() => {
                    this._narratorTypingCompleteTimeout = null;
                    this._stopNarratorTyping();
                }, duration * 1000);
            }
        };

        this._narratorTypingInterval = setInterval(advance, typingSpeed);
        advance();
    }

    // 나레이터 타이핑 효과 중지
    static _stopNarratorTyping() {
        this._clearNarratorTypingTimers();

        if (this._narratorTextElement) {
            this._narratorTextElement.style.opacity = '0';
            this._narratorFadeTimeout = setTimeout(() => {
                this._narratorFadeTimeout = null;
                if (this._narratorTextElement) {
                    this._narratorTextElement.replaceChildren();
                    this._narratorTextElement.style.opacity = '1';
                }
            }, 500);
        }
    }
    
    // 나레이터 폰트 적용
    static _applyNarratorFont() {
        if (!this._narratorTextElement) return;

        try {
            const profile = this._getWebfontPresentation(this.SETTINGS.NARRATOR_WEBFONT_CSS);
            const narratorFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT_SIZE);
            const style = this._narratorTextElement.style;

            // 웹폰트 CSS가 비어 있으면 Foundry의 기존 폰트 패밀리를 그대로 상속한다.
            if (profile.family) {
                style.setProperty('font-family', `${this._quoteFontFamily(profile.family)}, sans-serif`);
            } else {
                style.removeProperty('font-family');
            }

            style.setProperty('font-size', `${narratorFontSize || 18}px`);
            style.setProperty('font-weight', profile.weight || '900');
            style.setProperty('font-style', profile.style || 'italic');

            if (profile.variationSettings) {
                style.setProperty('font-variation-settings', profile.variationSettings);
            } else {
                style.removeProperty('font-variation-settings');
            }
        } catch (_error) {
            // 설정이 아직 로드되지 않은 경우 무시
        }
    }

    // 나레이터 타이핑 사운드 재생
    static _playNarratorTypingSound() {
        try {
            const soundPath = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_TYPING_SOUND);
            
            // 사운드 경로가 설정되어 있으면 재생
            if (soundPath && soundPath.trim() !== '') {
                if (foundry && foundry.audio && foundry.audio.AudioHelper) {
                    foundry.audio.AudioHelper.play({
                        src: soundPath,
                        volume: 0.5,
                        loop: false,
                        autoplay: true
                    }, false); // 각 클라이언트가 동일한 타이핑 진행에 맞춰 로컬에서 재생
                }
            }
        } catch (e) {
            // 사운드 재생 실패 시 무시
            console.warn('나레이터 타이핑 사운드 재생 실패:', e);
        }
    }
}

// 정적 변수 초기화
SpeakerSelector._isRenderingSelector = false;

// 채팅 입력 필드 플래그
SpeakerSelector._fromChatInput = false;
SpeakerSelector._chatInputPendingText = '';
SpeakerSelector._chatInputPendingUntil = 0;
SpeakerSelector._chatInputPendingUserId = null;
SpeakerSelector._chatInputGlobalListenersRegistered = false;

// 선택한 스피커 (ooc, 빈 문자열 등)
SpeakerSelector._selectedSpeaker = '';

// 나레이터 모드 상태 관리
SpeakerSelector._narratorModeActive = false;
SpeakerSelector._narratorLineElement = null;
SpeakerSelector._narratorTextElement = null;
SpeakerSelector._narratorLineVisible = false;
SpeakerSelector._narratorTypingInterval = null;
SpeakerSelector._narratorTypingCompleteTimeout = null;
SpeakerSelector._narratorFadeTimeout = null;
SpeakerSelector._narratorLineRemovalTimeout = null;
SpeakerSelector._narratorLineEnterFrame = null;
SpeakerSelector._narratorLineEnterSecondFrame = null;
SpeakerSelector._lastNarratorSoundAt = 0;
SpeakerSelector._narratorSocketInitialized = false;
SpeakerSelector._narratorShortcutInitialized = false;
SpeakerSelector._narratorShortcutHandler = null;

// 액터 격자 관리
SpeakerSelector._actorGridActors = [];
SpeakerSelector._actorGridWindow = null;
SpeakerSelector._actorGridApp = null;
SpeakerSelector._actorGridRows = 5; // 기본 행 수 (4x5 = 20칸)
SpeakerSelector._actorGridCols = 4; // 열 수
SpeakerSelector._folderStates = new Map(); // 폴더 열림/닫힘 상태 관리
SpeakerSelector._tokenHUDHooksRegistered = false;

// ===== Token HUD 스피커 토글 함수들 =====

SpeakerSelector._registerTokenHUDHooks = function() {
    if (this._tokenHUDHooksRegistered) return;
    this._tokenHUDHooksRegistered = true;

    const renderTokenHUDButton = (app, html, data) => {
        this._renderTokenHUDSpeakerButton(app, html, data);
    };

    Hooks.on('renderTokenHUD', renderTokenHUDButton);
    Hooks.on('renderTokenHUDHTML', renderTokenHUDButton);
};

SpeakerSelector._resolveTokenFromHUD = function(app, data = {}) {
    const object = app?.object ?? app?.document ?? null;
    if (object?.actor) return object;
    if (object?.object?.actor) return object.object;
    if (object?.document?.actor) return object;

    const tokenId = data?._id || data?.id || data?.tokenId || object?.id || object?._id || object?.document?.id || null;
    if (!tokenId) return null;

    return canvas?.tokens?.get?.(tokenId)
        || canvas?.tokens?.placeables?.find?.((token) => token.id === tokenId || token.document?.id === tokenId)
        || null;
};

SpeakerSelector._resolveWorldActorFromToken = function(token) {
    if (!token) return null;
    const actorId = token.document?.actorId || token.actorId || token.actor?.id || null;
    if (!actorId) return null;
    return game.actors?.get?.(actorId) || null;
};

SpeakerSelector._getTokenHUDRootElement = function(app, html) {
    return SpeakerSelectorCompat.asElement(html)
        || SpeakerSelectorCompat.asElement(app)
        || document.querySelector('#token-hud')
        || null;
};

SpeakerSelector._getTokenHUDLeftColumn = function(hudElement) {
    if (!hudElement) return null;
    return hudElement.querySelector('.col.left')
        || hudElement.querySelector('.left.col')
        || hudElement.querySelector('[class~="col"][class~="left"]')
        || null;
};

SpeakerSelector._isActorInSpeakerGrid = function(actorId) {
    if (!actorId) return false;
    return Array.isArray(this._actorGridActors) && this._actorGridActors.includes(actorId);
};

SpeakerSelector._trimActorGridActors = function() {
    while (this._actorGridActors.length > 0 && this._actorGridActors[this._actorGridActors.length - 1] === null) {
        this._actorGridActors.pop();
    }
};

SpeakerSelector._updateTokenHUDSpeakerButtonState = function(button, actorId) {
    if (!button || !actorId) return;
    const isRegistered = this._isActorInSpeakerGrid(actorId);
    button.classList.toggle('active', isRegistered);
    button.dataset.lichsomaSpeakerRegistered = isRegistered ? 'true' : 'false';
    button.setAttribute('aria-pressed', isRegistered ? 'true' : 'false');
};

SpeakerSelector._renderTokenHUDSpeakerButton = function(app, html, data = {}) {
    if (!game.user?.isGM) return;

    const hudElement = this._getTokenHUDRootElement(app, html);
    const leftColumn = this._getTokenHUDLeftColumn(hudElement);
    if (!leftColumn) return;

    const token = this._resolveTokenFromHUD(app, data);
    const actor = this._resolveWorldActorFromToken(token);
    if (!actor) return;

    const actorId = actor.id;
    const title = game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.TokenHUD.Title');
    const ariaLabel = game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.TokenHUD.AriaLabel');

    let button = leftColumn.querySelector('.lichsoma-token-hud-speaker-toggle');
    if (!button) {
        button = document.createElement('div');
        button.classList.add('control-icon', 'lichsoma-token-hud-speaker-toggle');
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.innerHTML = '<i class="fa-solid fa-masks-theater"></i>';
        leftColumn.appendChild(button);
    }

    button.dataset.actorId = actorId;
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);
    this._updateTokenHUDSpeakerButtonState(button, actorId);

    button.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this._toggleTokenHUDSpeakerRegistration(token, button);
    };
    button.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        void this._toggleTokenHUDSpeakerRegistration(token, button);
    };
};

SpeakerSelector._toggleTokenHUDSpeakerRegistration = async function(token, button = null) {
    if (!game.user?.isGM) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Notifications.GMOnly'));
        return;
    }

    const actor = this._resolveWorldActorFromToken(token);
    if (!actor) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Notifications.NoActor'));
        return;
    }

    const actorId = actor.id;
    const maxSlots = this._actorGridRows * this._actorGridCols;
    const savedData = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS) || [];
    this._actorGridActors = Array.isArray(savedData) ? [...savedData] : [];

    const existingIndex = this._actorGridActors.indexOf(actorId);
    if (existingIndex !== -1) {
        this._actorGridActors = this._actorGridActors.filter((id) => id !== actorId);
        this._trimActorGridActors();
    } else {
        while (this._actorGridActors.length < maxSlots) {
            this._actorGridActors.push(null);
        }

        const emptyIndex = this._actorGridActors.findIndex((id) => id === null || id === undefined || id === '');
        if (emptyIndex === -1) {
            ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Notifications.NoEmptySlot'));
            return;
        }

        this._actorGridActors[emptyIndex] = actorId;
        this._trimActorGridActors();
    }

    const saved = this._saveActorGridData();
    if (saved && typeof saved.then === 'function') {
        await saved;
    }

    this._updateActorGridWindow();
    this._updateSpeakerDropdown();
    this._updateTokenHUDSpeakerButtonState(button, actorId);
};

// 모듈 초기화
Hooks.once('init', () => {
    SpeakerSelector.initialize();
});

Hooks.once('ready', async () => {
    
    // 스피커 셀렉터 초기 렌더링
    setTimeout(() => {
        SpeakerSelector._renderSpeakerSelector($(document));
    }, 500);
});

// ===== 액터 격자 다이얼로그 함수들 =====

SpeakerSelector._showActorGridDialog = async function() {
    if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Notifications.GMOnly'));
        return;
    }
    if (this._actorGridApp?.rendered) {
        await this._closeActorGridWindow();
        return;
    }
    this._actorGridApp = new LichsomaActorGridSettingApp();
    await this._actorGridApp.render({ force: true });
};

SpeakerSelector._closeActorGridWindow = async function() {
    if (!this._actorGridApp) return;
    await this._actorGridApp.close();
};

SpeakerSelector._createActorGridContent = function() {
    const totalSlots = this._actorGridRows * this._actorGridCols;
    let gridHTML = `<div class="lichsoma-actor-grid" style="grid-template-columns: repeat(${this._actorGridCols}, 1fr); grid-template-rows: repeat(${this._actorGridRows}, 1fr);">`;
    
    for (let i = 0; i < totalSlots; i++) {
        const actorId = this._actorGridActors[i] || null;
        const actor = actorId ? game.actors.get(actorId) : null;
        const safeName = actor ? foundry.utils.escapeHTML(String(actor.name ?? '')) : '';
        
        gridHTML += `
            <div class="lichsoma-grid-slot" data-slot="${i}" draggable="${actor ? 'true' : 'false'}">
                ${actor ? `
                    <div class="lichsoma-slot-actor">
                        <img src="${actor.img}" alt="${safeName}" title="${safeName}" draggable="false">
                        <span class="actor-name" title="${safeName}">${safeName}</span>
                    </div>
                ` : `
                    <div class="lichsoma-slot-empty">
                        <span class="drop-hint">${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.DropHint')}</span>
                    </div>
                `}
            </div>
        `;
    }
    
    gridHTML += '</div>';
    
    return gridHTML;
};

SpeakerSelector._createAvailableActorsContent = function(searchTerm = '') {
    const { actors, hasTaskbarModule } = getAccessibleActors(searchTerm);
    const tree = buildActorFolderTree(actors);
    const placeholder = hasTaskbarModule
        ? game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholderWithTags')
        : game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholder');

    const renderActor = (actor) => {
        const inGrid = this._actorGridActors.includes(actor.id);
        const name = foundry.utils.escapeHTML(String(actor.name ?? ''));
        const image = foundry.utils.escapeHTML(String(actor.img ?? ''));
        return `
            <div class="lichsoma-available-actor${inGrid ? ' lichsoma-available-actor-in-grid' : ''}" data-actor-id="${actor.id}" draggable="${inGrid ? 'false' : 'true'}">
                <img src="${image}" alt="${name}" draggable="false">
                <span>${name}</span>
            </div>
        `;
    };

    const treeHTML = renderActorFolderTree({
        ...tree,
        folderStates: this._folderStates,
        renderActor,
        noFolderLabel: game.i18n.localize('SPEAKERSELECTOR.ActorTree.NoFolder')
    });

    return `<div class="lichsoma-available-actors">
        <h3 style="font-size: 12pt; font-weight: bold; margin: 0 0 8px 0;">${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.AvailableActors')}</h3>
        <div style="margin-bottom: 8px;">
            <input type="text" class="lichsoma-actor-search" placeholder="${foundry.utils.escapeHTML(placeholder)}" value="${foundry.utils.escapeHTML(searchTerm)}" />
        </div>
        ${treeHTML}
    </div>`;
};

/**
 * 메시지 센더 수정 — 스피커 설정과 동일한 필터·폴더·태그 검색으로 액터 목록 HTML 생성 (본문만)
 */
SpeakerSelector._createActorPickerListBodyHTML = function(searchTerm = '', selectedActorId = '', folderStates = new Map()) {
    const { actors } = getAccessibleActors(searchTerm);
    const tree = buildActorFolderTree(actors);
    const actorNone = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.ActorNone');
    const oocSelected = !selectedActorId ? ' selected' : '';

    const renderActor = (actor) => {
        const selected = actor.id === selectedActorId ? ' selected' : '';
        const name = foundry.utils.escapeHTML(String(actor.name ?? ''));
        const image = foundry.utils.escapeHTML(String(actor.img ?? ''));
        return `
            <div class="lichsoma-available-actor lichsoma-sender-edit-actor-pick${selected}" data-actor-id="${actor.id}" draggable="false">
                <img src="${image}" alt="${name}" draggable="false">
                <span>${name}</span>
            </div>
        `;
    };

    const treeHTML = renderActorFolderTree({
        ...tree,
        folderStates,
        renderActor,
        noFolderLabel: game.i18n.localize('SPEAKERSELECTOR.ActorTree.NoFolder')
    });

    return `
        <div class="lichsoma-available-actor lichsoma-sender-edit-ooc${oocSelected}" data-actor-id="" draggable="false">
            <i class="fas fa-user-slash" draggable="false"></i>
            <span>${foundry.utils.escapeHTML(actorNone)}</span>
        </div>
        ${treeHTML}
    `;
};

SpeakerSelector._syncAvailableActorsInGridVisuals = function() {
    if (!this._actorGridWindow) return;
    this._actorGridWindow.querySelectorAll('.lichsoma-available-actor[data-actor-id]').forEach(el => {
        const id = el.getAttribute('data-actor-id');
        const inGrid = id && this._actorGridActors.includes(id);
        el.classList.toggle('lichsoma-available-actor-in-grid', !!inGrid);
        el.draggable = !inGrid;
    });
};

SpeakerSelector._setupActorGridSlotEvents = function() {
    if (!this._actorGridWindow) return;
    const gridSlots = this._actorGridWindow.querySelectorAll('.lichsoma-grid-slot');
    gridSlots.forEach(slot => {
        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        });
        slot.addEventListener('dragleave', (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
                e.currentTarget.classList.remove('drag-over');
            }
        });
        slot.addEventListener('drop', (e) => this._handleGridDrop(e));
        slot.addEventListener('dragstart', (e) => this._handleGridDragStart(e));
        slot.addEventListener('dragend', (e) => this._handleGridDragEnd(e));
        slot.addEventListener('contextmenu', (e) => this._handleGridSlotRightClick(e));
    });
};

SpeakerSelector._setupActorGridListPanelEvents = function() {
    if (!this._actorGridWindow) return;

    const availableActors = this._actorGridWindow.querySelectorAll('.lichsoma-available-actor');
    availableActors.forEach(actor => {
        actor.addEventListener('dragstart', (e) => this._handleActorDragStart(e));
        actor.addEventListener('dragend', (e) => this._handleGridDragEnd(e));
    });

    const folderHeaders = this._actorGridWindow.querySelectorAll('.lichsoma-folder-header');
    folderHeaders.forEach(header => {
        header.addEventListener('click', (e) => this._handleFolderToggle(e));
    });

    const searchInput = this._actorGridWindow.querySelector('.lichsoma-actor-search');
    if (searchInput) {
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);

        let searchTimeout = null;
        let isComposing = false;

        newSearchInput.addEventListener('compositionstart', () => {
            isComposing = true;
            clearTimeout(searchTimeout);
        });

        newSearchInput.addEventListener('compositionend', (e) => {
            isComposing = false;
            const searchTerm = e.target.value.trim();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this._handleActorSearch(searchTerm);
            }, 300);
        });

        newSearchInput.addEventListener('input', (e) => {
            if (isComposing) return;
            const searchTerm = e.target.value.trim();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this._handleActorSearch(searchTerm);
            }, 300);
        });
    }
};

SpeakerSelector._setupActorGridEvents = function() {
    if (!this._actorGridWindow) return;
    this._setupActorGridSlotEvents();
    this._setupActorGridListPanelEvents();
};

SpeakerSelector._handleGridDrop = function(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const targetSlotIndex = parseInt(e.currentTarget.dataset.slot);
    const draggedActorId = e.dataTransfer.getData('text/plain');
    const sourceSlotIndexStr = e.dataTransfer.getData('text/slot-index');
    
    if (!draggedActorId) return;
    
    // 기존 위치 찾기
    const sourceIndex = sourceSlotIndexStr !== '' ? parseInt(sourceSlotIndexStr) : this._actorGridActors.indexOf(draggedActorId);
    
    // 같은 슬롯에 드롭하면 무시
    if (sourceIndex === targetSlotIndex) return;
    
    if (sourceIndex !== -1) {
        // 격자 내에서 이동/교환하는 경우
        const targetActorId = this._actorGridActors[targetSlotIndex];
        
        // 배열 길이를 슬롯 수만큼 확장 (필요한 경우)
        const maxSlots = this._actorGridRows * this._actorGridCols;
        while (this._actorGridActors.length < maxSlots) {
            this._actorGridActors.push(null);
        }
        
        // 위치 교환 또는 이동
        if (targetActorId) {
            // 대상 슬롯에 액터가 있으면 교환
            this._actorGridActors[sourceIndex] = targetActorId;
            this._actorGridActors[targetSlotIndex] = draggedActorId;
        } else {
            // 대상 슬롯이 비어있으면 이동
            this._actorGridActors[sourceIndex] = null;
            this._actorGridActors[targetSlotIndex] = draggedActorId;
        }
        
        // null 값 제거 (배열 끝부분의 null만)
        while (this._actorGridActors.length > 0 && this._actorGridActors[this._actorGridActors.length - 1] === null) {
            this._actorGridActors.pop();
        }
    } else {
        // 새로운 액터를 격자에 추가하는 경우
        const maxSlots = this._actorGridRows * this._actorGridCols;
        if (this._actorGridActors.length < maxSlots) {
            // 배열 길이를 슬롯 수만큼 확장 (필요한 경우)
            while (this._actorGridActors.length <= targetSlotIndex) {
                this._actorGridActors.push(null);
            }
            
            if (this._actorGridActors[targetSlotIndex] === null || this._actorGridActors[targetSlotIndex] === undefined) {
                this._actorGridActors[targetSlotIndex] = draggedActorId;
            } else {
                // 슬롯이 차있으면 빈 슬롯 찾아서 추가
                const emptyIndex = this._actorGridActors.findIndex(id => id === null || id === undefined);
                if (emptyIndex !== -1) {
                    this._actorGridActors[emptyIndex] = draggedActorId;
                } else if (this._actorGridActors.length < maxSlots) {
                    this._actorGridActors.push(draggedActorId);
                }
            }
            
            // null 값 제거 (배열 끝부분의 null만)
            while (this._actorGridActors.length > 0 && this._actorGridActors[this._actorGridActors.length - 1] === null) {
                this._actorGridActors.pop();
            }
        }
    }
    
    // UI 업데이트 및 데이터 저장
    this._saveActorGridData();
    this._updateActorGridWindow();
    this._updateSpeakerDropdown();
};

SpeakerSelector._handleGridDragStart = function(e) {
    const slotIndex = parseInt(e.currentTarget.dataset.slot);
    const actorId = this._actorGridActors[slotIndex];
    
    if (!actorId) {
        e.preventDefault();
        return false;
    }
    
    // 액터 ID와 원본 슬롯 인덱스를 모두 저장
    e.dataTransfer.setData('text/plain', actorId);
    e.dataTransfer.setData('text/slot-index', slotIndex.toString());
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
};

SpeakerSelector._handleGridDragEnd = function(e) {
    const root = this._actorGridApp?.element ?? document;
    root.querySelectorAll('.lichsoma-grid-slot').forEach(slot => {
        slot.classList.remove('drag-over');
        slot.style.opacity = '';
    });
    root.querySelectorAll('.lichsoma-available-actor').forEach(actor => {
        actor.style.opacity = '';
    });
};

SpeakerSelector._handleActorDragStart = function(e) {
    if (e.currentTarget.classList.contains('lichsoma-available-actor-in-grid')) {
        e.preventDefault();
        return false;
    }
    const actorId = e.currentTarget.dataset.actorId;
    e.dataTransfer.setData('text/plain', actorId);
    e.dataTransfer.effectAllowed = 'copy';
    e.currentTarget.style.opacity = '0.5';
};

SpeakerSelector._handleGridSlotRightClick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const slotIndex = parseInt(e.currentTarget.dataset.slot);
    const actorId = this._actorGridActors[slotIndex];
    
    if (!actorId) return;
    
    const actor = game.actors.get(actorId);
    if (!actor) return;
    
    // 그리드에서 제거
    const index = this._actorGridActors.indexOf(actorId);
    if (index !== -1) {
        this._actorGridActors.splice(index, 1);
        this._saveActorGridData();
        this._updateActorGridWindow();
        this._updateSpeakerDropdown();
        ui.notifications.info(game.i18n.format('SPEAKERSELECTOR.Notifications.ActorRemovedFromGrid', { actorName: actor.name }));
    }
};

SpeakerSelector._updateActorGridWindow = function() {
    if (!this._actorGridWindow) return;
    const contentContainer = this._actorGridWindow.querySelector('.lichsoma-actor-grid-container');
    if (!contentContainer) return;
    const oldGrid = contentContainer.querySelector('.lichsoma-actor-grid');
    if (!oldGrid) return;
    const temp = document.createElement('div');
    temp.innerHTML = this._createActorGridContent().trim();
    const newGrid = temp.firstElementChild;
    if (!newGrid) return;
    oldGrid.replaceWith(newGrid);
    this._setupActorGridSlotEvents();
    this._syncAvailableActorsInGridVisuals();
};

SpeakerSelector._handleFolderToggle = function(e) {
    const header = e.currentTarget;
    const folderSection = header.closest('.lichsoma-folder-section');
    const folderActors = folderSection?.querySelector('.lichsoma-folder-actors');
    const folderId = header.getAttribute('data-folder-id');
    
    if (folderActors && folderId) {
        const isCollapsed = folderActors.style.display === 'none';
        const newState = isCollapsed ? true : false; // true = 열림, false = 닫힘
        
        // 표시 상태 변경
        folderActors.style.display = newState ? 'block' : 'none';
        
        // 아이콘 변경
        const icon = header.querySelector('i');
        if (icon) {
            icon.className = newState ? 'fas fa-folder-open' : 'fas fa-folder';
        }
        
        // 상태 저장
        this._folderStates.set(folderId, newState);
    }
};

SpeakerSelector._handleActorSearch = function(searchTerm) {
    if (!this._actorGridWindow || !this._actorGridApp?.rendered) return;
    
    const contentContainer = this._actorGridWindow.querySelector('.lichsoma-actor-grid-container');
    if (!contentContainer) return;
    
    const availableActorsContainer = contentContainer.querySelector('.lichsoma-available-actors-container');
    if (!availableActorsContainer) return;
    
    // 검색 입력 필드의 선택 범위와 포커스 상태 저장
    const searchInput = this._actorGridWindow.querySelector('.lichsoma-actor-search');
    let selectionStart = 0;
    let selectionEnd = 0;
    let hadFocus = false;
    
    if (searchInput) {
        hadFocus = document.activeElement === searchInput;
        selectionStart = searchInput.selectionStart || 0;
        selectionEnd = searchInput.selectionEnd || 0;
    }

    const savedListScrollTop = availableActorsContainer.scrollTop;

    // 사용 가능한 액터 영역만 재렌더링
    availableActorsContainer.innerHTML = this._createAvailableActorsContent(searchTerm);
    availableActorsContainer.scrollTop = savedListScrollTop;

    this._setupActorGridListPanelEvents();
    
    // 검색 입력 필드의 포커스와 선택 범위 복원
    if (searchInput && hadFocus) {
        const newSearchInput = this._actorGridWindow.querySelector('.lichsoma-actor-search');
        if (newSearchInput) {
            newSearchInput.focus();
            // 선택 범위 복원 (비동기로 처리하여 렌더링 완료 후 실행)
            setTimeout(() => {
                if (newSearchInput.setSelectionRange) {
                    newSearchInput.setSelectionRange(selectionStart, selectionEnd);
                }
            }, 0);
        }
    }
};

// 특정 액터의 드롭다운 옵션만 업데이트 (감정 이름 표시용)
SpeakerSelector._updateActorOptionInDropdown = function(actorId) {
    const selector = this._getSpeakerSelectorElement();
    if (!selector) {
        return;
    }
    
    const dropdown = selector.querySelector('.speaker-dropdown');
    if (!dropdown) {
        return;
    }
    
    // 액터 정보 가져오기
    const actor = game.actors.get(actorId);
    if (!actor) {
        return;
    }
    
    // 저장된 감정 정보 가져오기
    const savedEmotion = ActorEmotions.getSavedEmotion(actorId);
    const displayName = savedEmotion
        ? `${actor.name}(${savedEmotion.emotionName})`
        : actor.name;
    
    // 등록된 액터 옵션 업데이트 (actor:actorId)
    const registeredActorOption = dropdown.querySelector(`option[value="actor:${actorId}"]`);
    if (registeredActorOption) {
        registeredActorOption.textContent = displayName;
    }
    
    // 할당된 캐릭터 옵션 업데이트 (character)
    if (game.user.character) {
        const character = game.user.character instanceof Actor 
            ? game.user.character 
            : game.actors.get(game.user.character);
        
        if (character && character.id === actorId) {
            const characterOption = dropdown.querySelector('option[value="character"]');
            if (characterOption) {
                characterOption.textContent = displayName;
            }
        }
    }
    
    // 현재 선택된 스피커가 이 액터인 경우 감정 버튼 상태 업데이트
    const currentValue = dropdown.value;
    let shouldUpdateButton = false;
    
    if (currentValue === `actor:${actorId}`) {
        shouldUpdateButton = true;
    } else if (currentValue === 'character' && game.user.character) {
        const character = game.user.character instanceof Actor 
            ? game.user.character 
            : game.actors.get(game.user.character);
        if (character && character.id === actorId) {
            shouldUpdateButton = true;
        }
    }
    
    if (shouldUpdateButton) {
        const emotionBtn = selector.querySelector('.emotion-btn');
        if (emotionBtn) {
            if (savedEmotion) {
                emotionBtn.classList.add('active');
            } else {
                emotionBtn.classList.remove('active');
            }
        }
    }
};

SpeakerSelector._updateSpeakerDropdown = function() {
    const selector = this._getSpeakerSelectorElement();
    if (selector) {
        // 현재 선택된 값 저장
        const currentValue = selector.querySelector('.speaker-dropdown')?.value || this._selectedSpeaker;
        this._renderSpeakerSelector(document);
        // 선택 값 복원 및 감정 버튼 상태 복원
        setTimeout(() => {
            const newSelector = this._getSpeakerSelectorElement();
            if (newSelector && currentValue) {
                const dropdown = newSelector.querySelector('.speaker-dropdown');
                if (dropdown) {
                    dropdown.value = currentValue;
                    
                    // 감정 버튼 상태 복원
                    let actorId = null;
                    if (currentValue && currentValue !== 'ooc' && currentValue !== 'character') {
                        if (currentValue.startsWith('actor:')) {
                            actorId = currentValue.replace('actor:', '');
                        } else if (currentValue.startsWith('character:')) {
                            actorId = currentValue.replace('character:', '');
                        }
                    } else if (currentValue === 'character' && game.user.character) {
                        actorId = game.user.character instanceof Actor ? game.user.character.id : game.user.character;
                    }
                    
                    if (actorId) {
                        const hasEmotion = ActorEmotions.restoreEmotionForActor(actorId);
                        const emotionBtn = newSelector.querySelector('.emotion-btn');
                        if (emotionBtn) {
                            if (hasEmotion) {
                                emotionBtn.classList.add('active');
                            } else {
                                emotionBtn.classList.remove('active');
                            }
                        }
                    } else {
                        const emotionBtn = newSelector.querySelector('.emotion-btn');
                        if (emotionBtn) {
                            emotionBtn.classList.remove('active');
                        }
                    }
                }
            }
        }, 10);
    }
};

SpeakerSelector._saveActorGridData = function() {
    try {
        return game.settings.set('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS, [...this._actorGridActors]);
    } catch (e) {
        // 액터 격자 데이터 저장 실패 (무시)
        return null;
    }
};

// 채팅 폰트 적용 함수
SpeakerSelector._applyChatFonts = function() {
    try {
        if (!game.settings || !game.settings.settings) {
            setTimeout(() => this._applyChatFonts(), 100);
            return;
        }

        document.getElementById('lichsoma-chat-fonts')?.remove();

        const settingKeys = [
            this.SETTINGS.CHAT_HEADER_WEBFONT_CSS,
            this.SETTINGS.DND5E_TITLE_WEBFONT_CSS,
            this.SETTINGS.DND5E_SUBTITLE_WEBFONT_CSS,
            this.SETTINGS.CHAT_MESSAGE_WEBFONT_CSS,
            this.SETTINGS.CHAT_DICE_WEBFONT_CSS,
            this.SETTINGS.NARRATOR_WEBFONT_CSS
        ];
        const cssByKey = Object.fromEntries(settingKeys.map(key => [key, this._getWebfontCSS(key)]));
        const profileByKey = Object.fromEntries(settingKeys.map(key => [key, extractWebfontPresentation(cssByKey[key])]));

        let headerFontSize = 20;
        let messageFontSize = 15;
        try {
            headerFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT_SIZE);
            messageFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_FONT_SIZE);
        } catch (_error) {
            setTimeout(() => this._applyChatFonts(), 100);
            return;
        }

        const rawWebfontCSS = [...new Set(Object.values(cssByKey).map(css => css.trim()).filter(Boolean))];
        const rules = [];
        const buildDeclarations = (profile, defaults = {}, { includeFamily = true } = {}) => {
            const declarations = [];
            if (includeFamily && profile?.family) {
                declarations.push(`font-family: ${this._quoteFontFamily(profile.family)}, sans-serif`);
            }
            const weight = profile?.weight || defaults.weight || '';
            const style = profile?.style || defaults.style || '';
            const variationSettings = profile?.variationSettings || '';
            if (weight) declarations.push(`font-weight: ${weight}`);
            if (style) declarations.push(`font-style: ${style}`);
            if (variationSettings) declarations.push(`font-variation-settings: ${variationSettings}`);
            return declarations;
        };
        const addRule = (selector, declarations) => {
            if (!declarations.length) return;
            rules.push(`${selector} { ${declarations.map(value => `${value} !important`).join('; ')}; }`);
        };

        const headerProfile = profileByKey[this.SETTINGS.CHAT_HEADER_WEBFONT_CSS];
        const headerDeclarations = buildDeclarations(headerProfile, { weight: '900', style: 'normal' });
        if (headerFontSize) headerDeclarations.push(`font-size: ${headerFontSize}px`);
        addRule(
            '.chat-message:not(.lichsoma-dnd5e-native-header) .message-header > .message-sender, .chat-message:not(.lichsoma-dnd5e-native-header) .message-header > h4.message-sender',
            headerDeclarations
        );

        addRule(
            '.system-dnd5e .chat-message.lichsoma-dnd5e-native-header .message-header .message-sender .name-stacked .title',
            buildDeclarations(profileByKey[this.SETTINGS.DND5E_TITLE_WEBFONT_CSS])
        );
        addRule(
            '.system-dnd5e .chat-message.lichsoma-dnd5e-native-header .message-header .message-sender .name-stacked .subtitle',
            buildDeclarations(profileByKey[this.SETTINGS.DND5E_SUBTITLE_WEBFONT_CSS])
        );

        const messageProfile = profileByKey[this.SETTINGS.CHAT_MESSAGE_WEBFONT_CSS];
        const messageDeclarations = buildDeclarations(messageProfile, { weight: '500', style: 'normal' });
        if (messageFontSize) messageDeclarations.push(`font-size: ${messageFontSize}px`);
        addRule('.chat-message .message-content', messageDeclarations);

        addRule(
            '.chat-message .message-content .dice-roll .dice-formula, .chat-message .message-content .dice-roll .dice-total, .chat-message .message-content .dice-roll .dice-tooltip, .chat-message .message-content .dice-roll .dice-tooltip :where(.part-formula, .part-total, .roll, .roll *), .chat-message .message-content .dice-roll .dice-result',
            buildDeclarations(profileByKey[this.SETTINGS.CHAT_DICE_WEBFONT_CSS])
        );

        const narratorProfile = profileByKey[this.SETTINGS.NARRATOR_WEBFONT_CSS];
        if (narratorProfile.family) {
            addRule(
                '.chat-message .message-content .narrator-card, .chat-message .message-content .narrator-card :where(p, h1, h2, h3, h4, h5, h6, div, span, strong, em, b, i, li, ul, ol, blockquote, ruby, rb, rt)',
                [`font-family: ${this._quoteFontFamily(narratorProfile.family)}, sans-serif`]
            );
        }
        addRule(
            '.chat-message .message-content .narrator-card',
            buildDeclarations(narratorProfile, { weight: '500', style: 'italic' }, { includeFamily: false })
        );

        const style = document.createElement('style');
        style.id = 'lichsoma-chat-fonts';
        style.textContent = [
            ...rawWebfontCSS.map((css, index) => `/* LichSOMA webfont ${index + 1} */\n${css}`),
            ...rules
        ].join('\n\n');
        document.head.appendChild(style);
    } catch (_error) {
        // 폰트 CSS 적용 실패는 채팅 렌더링을 중단하지 않는다.
    }
};

SpeakerSelector._loadActorGridData = function() {
    try {
        const savedData = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS) || [];
        // null 값은 유지하고, 유효하지 않은 액터 ID만 null로 변환
        this._actorGridActors = savedData.map(actorId => {
            if (actorId === null || actorId === undefined) {
                return null;
            }
            const actor = game.actors.get(actorId);
            return actor !== undefined ? actorId : null;
        });
        
        // 배열 끝부분의 null 값 제거
        while (this._actorGridActors.length > 0 && this._actorGridActors[this._actorGridActors.length - 1] === null) {
            this._actorGridActors.pop();
        }
        
        // 유효하지 않은 액터가 있었으면 저장
        const hasInvalidActors = savedData.some((actorId, index) => {
            if (actorId === null || actorId === undefined) return false;
            const actor = game.actors.get(actorId);
            return actor === undefined;
        });
        
        if (hasInvalidActors) {
            this._saveActorGridData();
        }
        
        // 스피커 드롭다운 업데이트
        setTimeout(() => {
            this._updateSpeakerDropdown();
        }, 100);
    } catch (e) {
        // 액터 격자 데이터 불러오기 실패
        this._actorGridActors = [];
    }
};

/**
 * 스피커 액터 격자 설정 — Foundry ApplicationV2 기반 창
 */
class LichsomaActorGridSettingApp extends SpeakerSelectorCompat.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'lichsoma-actor-grid-setting',
        classes: ['lichsoma-actor-grid-setting-app'],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.SpeakerSetting.Dialog.Title',
            resizable: true,
            minimizable: false,
            contentClasses: ['lichsoma-actor-grid-window-content']
        },
        position: {
            width: 720,
            height: 560
        }
    };

    async _prepareContext(options) {
        return {};
    }

    async _renderHTML(context, options) {
        const wrap = document.createElement('div');
        wrap.className = 'lichsoma-actor-grid-app-inner';
        wrap.innerHTML = `
            <div class="lichsoma-actor-grid-container">
                ${SpeakerSelector._createActorGridContent()}
                <div class="lichsoma-available-actors-container">
                    ${SpeakerSelector._createAvailableActorsContent()}
                </div>
            </div>
        `;
        return wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
        SpeakerSelector._actorGridWindow = this.element.querySelector('.window-content');
        SpeakerSelector._actorGridApp = this;
        SpeakerSelector._setupActorGridEvents();
    }

    _onClose(options) {
        SpeakerSelector._saveActorGridData();
        SpeakerSelector._actorGridApp = null;
        SpeakerSelector._actorGridWindow = null;
        setTimeout(() => SpeakerSelector._updateSpeakerDropdown(), 100);
    }
}


// ===== CSS 편집기 Dialog 클래스 (ApplicationV2 — V1 FormApplication 경고 방지) =====

class SpeakerSelectorSettingCSSEditor extends SpeakerSelectorCompat.ApplicationV2 {
    static settingKey = SpeakerSelector.SETTINGS.CHAT_LOG_EXPORT_CUSTOM_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Saved';
    static defaultId = 'lichsoma-chat-log-export-css-editor';

    static DEFAULT_OPTIONS = {
        id: 'lichsoma-chat-log-export-css-editor',
        classes: ['lichsoma-css-editor'],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name',
            resizable: true,
            minimizable: false,
            contentClasses: []
        },
        position: {
            width: 800,
            height: 600
        }
    };

    /** @type {unknown} */
    editor = null;

    /** @type {ResizeObserver | null} */
    _resizeObserver = null;

    constructor(options = {}) {
        const cls = new.target;
        const baseOptions = foundry.utils.mergeObject(cls.DEFAULT_OPTIONS, {
            id: cls.defaultId,
            window: { title: cls.titleKey }
        }, { inplace: false });
        super(foundry.utils.mergeObject(baseOptions, options, { inplace: false }));
    }

    async _prepareContext(options) {
        const css = game.settings.get('lichsoma-speaker-selector', this.constructor.settingKey) || '';
        return { css };
    }

    async _renderHTML(context, options) {
        const html = await SpeakerSelectorCompat.renderTemplate(
            'modules/lichsoma-speaker-selector/templates/css-editor.html',
            context
        );
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        return wrap.firstElementChild ?? wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
        const form = this.element.querySelector('form.lichsoma-css-editor-form');
        if (!form) return;

        const textarea = form.querySelector('textarea[name="css"]');
        if (!textarea) return;

        const CodeMirrorClass = window.CodeMirror || CONFIG.CM?.CodeMirror;
        if (!CodeMirrorClass) {
            this.editor = null;
        } else {
            const editor = CodeMirrorClass.fromTextArea(textarea, {
                mode: 'css',
                theme: 'foundry',
                lineNumbers: true,
                indentUnit: 2,
                tabSize: 2,
                lineWrapping: true,
                autofocus: true,
                extraKeys: {
                    'Ctrl-S': () => {
                        void this._onSave();
                    },
                    'Cmd-S': () => {
                        void this._onSave();
                    }
                }
            });
            this.editor = editor;

            this._resizeObserver = new ResizeObserver(() => {
                if (this.editor) {
                    setTimeout(() => this.editor.refresh(), 100);
                }
            });
            this._resizeObserver.observe(this.element);
        }

        form.querySelector('.save-css')?.addEventListener('click', (event) => {
            event.preventDefault();
            void this._onSave();
        });
        form.querySelector('.cancel-css')?.addEventListener('click', (event) => {
            event.preventDefault();
            void this.close();
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void this._onSave();
        });
    }

    async _onClose(options) {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this.editor) {
            try {
                this.editor.toTextArea();
            } catch (_) {
                /* noop */
            }
            this.editor = null;
        }
    }

    async _onSave() {
        try {
            let css = '';
            if (this.editor) {
                css = this.editor.getValue();
            } else {
                const ta = this.element.querySelector('textarea[name="css"]');
                css = ta?.value ?? '';
            }

            await game.settings.set(
                'lichsoma-speaker-selector',
                this.constructor.settingKey,
                css
            );

            ui.notifications.info(game.i18n.localize(this.constructor.savedKey));
            await this.close();
        } catch (error) {
            ui.notifications.error(game.i18n.format('SPEAKERSELECTOR.Notifications.CssSaveFailed', { error: error.message }));
        }
    }
}

class ChatLogExportCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.CHAT_LOG_EXPORT_CUSTOM_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Saved';
    static defaultId = 'lichsoma-chat-log-export-css-editor';
}

class ChatHeaderWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.CHAT_HEADER_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatHeaderWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatHeaderWebfontCSS.Saved';
    static defaultId = 'lichsoma-chat-header-webfont-css-editor';
}

class Dnd5eTitleWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.DND5E_TITLE_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.Dnd5eTitleWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.Dnd5eTitleWebfontCSS.Saved';
    static defaultId = 'lichsoma-dnd5e-title-webfont-css-editor';
}

class Dnd5eSubtitleWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.DND5E_SUBTITLE_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.Dnd5eSubtitleWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.Dnd5eSubtitleWebfontCSS.Saved';
    static defaultId = 'lichsoma-dnd5e-subtitle-webfont-css-editor';
}

class ChatMessageWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.CHAT_MESSAGE_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatMessageWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatMessageWebfontCSS.Saved';
    static defaultId = 'lichsoma-chat-message-webfont-css-editor';
}

class ChatDiceWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.CHAT_DICE_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatDiceWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatDiceWebfontCSS.Saved';
    static defaultId = 'lichsoma-chat-dice-webfont-css-editor';
}

class NarratorWebfontCSSEditor extends SpeakerSelectorSettingCSSEditor {
    static settingKey = SpeakerSelector.SETTINGS.NARRATOR_WEBFONT_CSS;
    static titleKey = 'SPEAKERSELECTOR.Settings.NarratorWebfontCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.NarratorWebfontCSS.Saved';
    static defaultId = 'lichsoma-narrator-webfont-css-editor';
}


