/**
 * GM 전용: 채팅 메시지 우클릭 → 메시지 센더(작성자 / 스피커 캐릭터) 수정
 */
import { SpeakerSelector } from './lichsoma-speaker-selector.js';

const MODULE_FLAG = 'lichsoma-speaker-selector';

/**
 * 활성 씬에서 해당 액터에 연결된 토큰 하나 (여러 개면 이름순 첫 번째)
 * @param {string} actorId
 * @returns {TokenDocument|null}
 */
function _findTokenForActorOnActiveScene(actorId) {
    const scene = game.scenes.active;
    if (!scene || !actorId) return null;
    const matches = [];
    for (const token of scene.tokens) {
        if (token.actorId === actorId) matches.push(token);
    }
    if (!matches.length) return null;
    matches.sort((a, b) => (a.name || '').localeCompare(b.name || '', ['ko', 'en'], { sensitivity: 'base' }));
    return matches[0];
}

/**
 * @param {string} userId
 * @param {string|null|undefined} actorId
 * @param {boolean} [speakAsToken] - 캐릭터 선택 시에만 사용. true면 활성 씬 토큰으로 말하기
 */
function _buildSpeakerFromSelection(userId, actorId, speakAsToken = false) {
    const user = game.users.get(userId);
    const sceneId = game.scenes.active?.id ?? null;
    if (!actorId) {
        return {
            alias: user?.name ?? 'Unknown',
            scene: sceneId,
            actor: null,
            token: null
        };
    }
    const actor = game.actors.get(actorId);
    if (!actor) {
        return {
            alias: user?.name ?? 'Unknown',
            scene: sceneId,
            actor: null,
            token: null
        };
    }

    if (!speakAsToken) {
        return {
            alias: actor.name,
            scene: sceneId,
            actor: actor.id,
            token: null
        };
    }

    const tokenDoc = _findTokenForActorOnActiveScene(actor.id);
    if (!tokenDoc) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.Notifications.NoTokenOnScene'));
        return {
            alias: actor.name,
            scene: sceneId,
            actor: actor.id,
            token: null
        };
    }

    const scene = game.scenes.active;
    return {
        alias: tokenDoc.name || actor.name,
        scene: scene?.id ?? sceneId,
        actor: actor.id,
        token: tokenDoc.id
    };
}

/**
 * @param {ChatMessage} message
 */
async function _openSenderEditDialog(message) {
    if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.Notifications.GMOnly'));
        return;
    }

    try {
        await _openSenderEditDialogInner(message);
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        ui.notifications.error(
            `${game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.Notifications.UpdateFailed')}: ${err}`
        );
    }
}

/**
 * @param {ChatMessage} message
 */
async function _openSenderEditDialogInner(message) {
    const result = await new Promise((resolve) => {
        const app = new LichsomaChatSenderEditApp({ message, resolve });
        void app.render({ force: true });
    });

    if (result == null || !result.userId) return;

    const speakAsToken = !!result.actorId && !!result.speakAsToken;
    const speaker = _buildSpeakerFromSelection(result.userId, result.actorId, speakAsToken);
    const portraitData = SpeakerSelector._getMessageImageSync(speaker, result.userId);
    const existing = message.flags?.[MODULE_FLAG] || {};
    const newModuleFlags = foundry.utils.mergeObject(
        existing,
        {
            portraitSrc: portraitData.src,
            userId: result.userId,
            actorId: speaker.actor || null
        },
        { inplace: false }
    );

    await message.update({
        author: result.userId,
        speaker,
        flags: { [MODULE_FLAG]: newModuleFlags }
    });
    ui.notifications.info(game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.Notifications.Success'));
}

/**
 * 스피커 설정과 같은 액터 목록(폴더·검색·태그) + 사용자 선택
 */
class LichsomaChatSenderEditApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'lichsoma-chat-sender-edit',
        classes: ['lichsoma-chat-sender-edit-app'],
        tag: 'div',
        position: {
            width: 560,
            height: 640
        },
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.ChatSenderEdit.Title',
            resizable: true,
            minimizable: false,
            contentClasses: ['lichsoma-chat-sender-edit-window-content']
        }
    };

    constructor(options = {}) {
        const { message, resolve, ...rest } = options;
        if (!message) throw new Error('LichsomaChatSenderEditApp requires message');
        super(foundry.utils.mergeObject(LichsomaChatSenderEditApp.DEFAULT_OPTIONS, rest));
        this.message = message;
        this._resolve = resolve;
        this._resolved = false;
        this._currentActorId = message.speaker?.actor ?? '';
        /** 액터 선택 시에만 사용. true = 토큰으로 말하기 */
        this._speakAsToken = !!(this._currentActorId && message.speaker?.token);
        this._folderStates = new Map();
        this._searchTerm = '';
        this._searchTimeout = null;
    }

    async _prepareContext(options) {
        return {};
    }

    async _renderHTML(context, options) {
        const currentUserId = this.message.author?.id ?? game.user.id;
        const userLabel = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.UserLabel');
        const actorLabel = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.ActorLabel');
        const speakActorLabel = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.SpeakModeActor');
        const speakTokenLabel = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.SpeakModeToken');
        const hasTaskbarModule = game.modules.get('lichsoma-taskbar')?.active || false;
        const placeholder = hasTaskbarModule
            ? game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholderWithTags')
            : game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholder');
        const cancelLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Cancel');
        const saveLabel = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.Save');

        const userOpts = [...game.users]
            .sort((a, b) => a.name.localeCompare(b.name, ['ko', 'en'], { sensitivity: 'base' }))
            .map((u) => {
                const sel = u.id === currentUserId ? ' selected' : '';
                return `<option value="${u.id}"${sel}>${foundry.utils.escapeHTML(u.name)}</option>`;
            })
            .join('');

        const initialActorId = this._currentActorId || '';
        const initialMode = this._speakAsToken ? 'token' : 'actor';
        const toggleLabel = this._speakAsToken ? speakTokenLabel : speakActorLabel;
        const toggleHint = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.SpeakModeToggleHint');
        const ariaPressed = this._speakAsToken ? 'true' : 'false';

        const wrap = document.createElement('div');
        wrap.className = 'lichsoma-chat-sender-edit-inner';
        wrap.innerHTML = `
            <form class="lichsoma-chat-sender-edit-form">
                <div class="form-group">
                    <label>${foundry.utils.escapeHTML(userLabel)}</label>
                    <select name="userId">${userOpts}</select>
                </div>
                <input type="hidden" name="actorId" value="${foundry.utils.escapeHTML(initialActorId)}">
                <div class="lichsoma-chat-sender-edit-actor-block">
                    <div class="lichsoma-chat-sender-edit-actor-header-row">
                        <span class="lichsoma-chat-sender-edit-actor-label">${foundry.utils.escapeHTML(actorLabel)}</span>
                        <div class="lichsoma-chat-sender-edit-speak-mode" data-speak-mode-wrap>
                            <input type="hidden" name="speakMode" value="${initialMode}">
                            <button type="button" class="lichsoma-sender-speak-toggle" data-speak-toggle
                                aria-pressed="${ariaPressed}" title="${foundry.utils.escapeHTML(toggleHint)}">
                                <span data-speak-toggle-text>${foundry.utils.escapeHTML(toggleLabel)}</span>
                            </button>
                        </div>
                    </div>
                    <input type="text" class="lichsoma-actor-search lichsoma-sender-edit-actor-search" placeholder="${foundry.utils.escapeHTML(placeholder)}" value="" autocomplete="off">
                    <div class="lichsoma-sender-edit-actor-list-host lichsoma-available-actors-container"></div>
                </div>
                <div class="lichsoma-chat-sender-edit-actions">
                    <button type="button" class="lichsoma-chat-sender-edit-cancel">${foundry.utils.escapeHTML(cancelLabel)}</button>
                    <button type="submit" class="lichsoma-chat-sender-edit-save">${foundry.utils.escapeHTML(saveLabel)}</button>
                </div>
            </form>
        `;
        return wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    _refreshActorList(searchTerm) {
        const host = this.element?.querySelector('.lichsoma-sender-edit-actor-list-host');
        if (!host) return;
        host.innerHTML = SpeakerSelector._createActorPickerListBodyHTML(
            searchTerm,
            this._currentActorId,
            this._folderStates
        );
    }

    _setSelectedActor(actorId) {
        this._currentActorId = actorId;
        const form = this.element?.querySelector('.lichsoma-chat-sender-edit-form');
        const hidden = form?.elements?.actorId;
        if (hidden) hidden.value = actorId;
        this._refreshActorList(this._searchTerm);
        this._updateSpeakModeEnabled();
    }

    _syncSpeakToggleUI() {
        const wrap = this.element?.querySelector('[data-speak-mode-wrap]');
        if (!wrap) return;
        const hidden = wrap.querySelector('input[name="speakMode"]');
        const textEl = wrap.querySelector('[data-speak-toggle-text]');
        const btn = wrap.querySelector('[data-speak-toggle]');
        const actorL = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.SpeakModeActor');
        const tokenL = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.SpeakModeToken');
        if (hidden) hidden.value = this._speakAsToken ? 'token' : 'actor';
        if (textEl) textEl.textContent = this._speakAsToken ? tokenL : actorL;
        if (btn) {
            btn.setAttribute('aria-pressed', this._speakAsToken ? 'true' : 'false');
        }
    }

    /** OOC일 때 토글 비활성화 (액터 모드로 고정) */
    _updateSpeakModeEnabled() {
        const wrap = this.element?.querySelector('[data-speak-mode-wrap]');
        if (!wrap) return;
        const hasActor = !!this._currentActorId;
        const btn = wrap.querySelector('[data-speak-toggle]');
        wrap.classList.toggle('is-disabled', !hasActor);
        if (btn) btn.disabled = !hasActor;
        if (!hasActor) {
            this._speakAsToken = false;
            this._syncSpeakToggleUI();
        }
    }

    _handleFolderToggle(ev) {
        const header = ev.currentTarget;
        const folderId = header.getAttribute('data-folder-id');
        if (!folderId) return;

        const folderSection = header.closest('.lichsoma-folder-section');
        const folderActors = folderSection?.querySelector(':scope > .lichsoma-folder-actors');
        if (!folderActors) return;

        const isCollapsed = folderActors.style.display === 'none';
        folderActors.style.display = isCollapsed ? 'block' : 'none';
        const nowExpanded = folderActors.style.display !== 'none';
        this._folderStates.set(folderId, nowExpanded);

        const icon = header.querySelector('i');
        if (icon) {
            icon.className = nowExpanded ? 'fas fa-folder-open' : 'fas fa-folder';
        }
    }

    async _onFirstRender(context, options) {
        const root = this.element?.querySelector('.lichsoma-chat-sender-edit-inner');
        const form = root?.querySelector('.lichsoma-chat-sender-edit-form');
        if (!root || !form) return;

        this._refreshActorList('');
        this._updateSpeakModeEnabled();

        root.querySelector('[data-speak-toggle]')?.addEventListener('click', () => {
            if (!this._currentActorId) return;
            this._speakAsToken = !this._speakAsToken;
            this._syncSpeakToggleUI();
        });

        const searchInput = root.querySelector('.lichsoma-sender-edit-actor-search');
        let isComposing = false;

        if (searchInput) {
            searchInput.addEventListener('compositionstart', () => {
                isComposing = true;
                clearTimeout(this._searchTimeout);
            });

            searchInput.addEventListener('compositionend', (e) => {
                isComposing = false;
                const term = e.target.value.trim();
                clearTimeout(this._searchTimeout);
                this._searchTimeout = setTimeout(() => {
                    this._searchTerm = term;
                    this._refreshActorList(term);
                }, 300);
            });

            searchInput.addEventListener('input', (e) => {
                if (isComposing) return;
                const term = e.target.value.trim();
                clearTimeout(this._searchTimeout);
                this._searchTimeout = setTimeout(() => {
                    this._searchTerm = term;
                    this._refreshActorList(term);
                }, 300);
            });
        }

        root.addEventListener('click', (e) => {
            const header = e.target.closest('.lichsoma-folder-header');
            if (header && root.contains(header) && header.getAttribute('data-folder-id')) {
                e.preventDefault();
                this._handleFolderToggle({ currentTarget: header });
                return;
            }

            const ooc = e.target.closest('.lichsoma-sender-edit-ooc');
            if (ooc && root.contains(ooc)) {
                e.preventDefault();
                this._setSelectedActor('');
                return;
            }

            const pick = e.target.closest('.lichsoma-sender-edit-actor-pick');
            if (pick && root.contains(pick)) {
                e.preventDefault();
                const id = pick.getAttribute('data-actor-id') || '';
                this._setSelectedActor(id);
            }
        });

        form.querySelector('.lichsoma-chat-sender-edit-cancel')?.addEventListener('click', () => {
            void this._finish(null);
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const uid = form.elements.userId?.value;
            const aid = form.elements.actorId?.value || null;
            const sm = form.elements.speakMode;
            const speakAsToken = !!(aid && sm && sm.value === 'token');
            void this._finish({ userId: uid, actorId: aid || null, speakAsToken });
        });
    }

    async _finish(payload) {
        if (this._resolved) return;
        this._resolved = true;
        this._resolve(payload);
        await this.close();
    }

    _onClose(options) {
        clearTimeout(this._searchTimeout);
        if (!this._resolved) {
            this._resolved = true;
            this._resolve(null);
        }
    }
}

function _registerContextMenu() {
    Hooks.on('getChatMessageContextOptions', (...args) => {
        const menuItems = args.find((x) => Array.isArray(x));
        if (!menuItems) return;

        // 코어 항목(Make Private, Delete 등)보다 위에 오도록 배열 앞에 삽입
        menuItems.unshift({
            label: game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.ContextMenu'),
            icon: '<i class="fa-solid fa-user-pen fa-fw"></i>',
            visible: game.user.isGM,
            onClick: (event, target) => {
                const li = target?.closest?.('.chat-message');
                const id = li?.dataset?.messageId;
                if (!id) return;
                const msg = game.messages.get(id);
                if (!msg) return;
                void _openSenderEditDialog(msg);
            }
        });
    });
}

Hooks.once('init', () => {
    _registerContextMenu();
});
