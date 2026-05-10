/**
 * LichSOMA Actor Emotions
 * 액터 감정 포트레잇 선택 기능
 */

export class ActorEmotions {
    static MODULE_ID = 'lichsoma-speaker-selector';
    /** 모듈 플래그로 감정을 한 번이라도 저장했으면 `system.emotions`와 병합하지 않음(전부 삭제 시 `{}` 유지) */
    static EMOTIONS_USE_MODULE_FLAG = 'emotionsUseModule';

    static _currentEmotion = null;
    static _currentEmotionName = null;
    static _currentEmotionPortrait = null;
    static _actorEmotionMap = new Map();
    /** @type {LichsomaEmotionManagerApp | null} */
    static _emotionManagerApp = null;
    /** @type {LichsomaEmotionSelectorApp | null} */
    static _emotionSelectorApp = null;
    static _emotionEscapeHandler = null;

    /** Foundry v13+ — 전역 `FilePicker` 대신 namespaced 구현 사용 */
    static _openImageFilePicker({ current, callback }) {
        const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
        new FilePickerImpl({
            type: 'image',
            current: current || '',
            callback
        }).render(true);
    }

    static initialize() {
        Hooks.on('renderActorSheet', (app, html) => this._injectEmotionButton(app, html, false));
        // V2 시트는 DOM에 따라 `.application-v2` 조상이 헤더에서 안 잡히는 경우가 있어,
        // `--legacy-sheet`(평탄 헤더·호버 무시)가 오부착되어 코어 헤더 호버가 깨짐 → 훅으로만 구분
        Hooks.on('renderActorSheetV2', (app, html) => this._injectEmotionButton(app, html, true));
    }

    /**
     * @param {boolean} fromActorSheetV2Hook - `renderActorSheetV2` 에서 호출되면 true (레거시 스타일 클래스 금지)
     */
    static _injectEmotionButton(app, html, fromActorSheetV2Hook = false) {
        const actor = app.actor || app.object || app.document;
        if (!actor) return;

        const canEdit = actor.isOwner || game.user.isGM;
        if (!canEdit) return;

        const $root = html?.jquery ? html : $(html);
        const windowHeader = $root.find('.window-header');
        if (!windowHeader.length) return;

        if (windowHeader.find('.lichsoma-emotion-manage-btn').length) return;

        const manageTitle = game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리';
        const emotionLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Label') || '감정';
        // <a>는 헤더 창 드래그와 동일 레이어로 처리되어 클릭이 먹히지 않는 경우가 많음 — 코어와 동일한 header-control 버튼 사용
        const button = $(`
            <button type="button" class="header-control lichsoma-emotion-manage-btn" title="${manageTitle}" aria-label="${manageTitle}">
                <i class="fa-solid fa-face-smile"></i>
                <span class="lichsoma-emotion-manage-label">${emotionLabel}</span>
            </button>
        `);

        // Application v1 / window-app 시트만 레거시(플랫 헤더) 스타일 — V2 훅이면 절대 부착하지 않음
        if (!fromActorSheetV2Hook) {
            const sheetRoot = windowHeader.closest('.application, .window-app');
            const isAppV2 = windowHeader.closest('.application-v2').length > 0;
            if (sheetRoot.length && !isAppV2) {
                button.addClass('lichsoma-emotion-manage-btn--legacy-sheet');
            }
        }

        const stopDragHandshake = (ev) => {
            ev.stopPropagation();
        };
        button.on('pointerdown', stopDragHandshake);
        button.on('mousedown', stopDragHandshake);

        button.on('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void this._openEmotionManager(actor);
        });

        const toggleBtn = windowHeader.find('button[data-action="toggleControls"]');
        if (toggleBtn.length) {
            toggleBtn.first().before(button);
        } else {
            const title = windowHeader.find('.window-title').first();
            if (title.length) {
                title.after(button);
            } else {
                windowHeader.prepend(button);
            }
        }
    }

    static _getEmotionManagerRoot() {
        return this._emotionManagerApp?.element?.querySelector('.lichsoma-emotion-manager-app-inner') ?? null;
    }

    static _teardownEmotionEscapeListener() {
        if (this._emotionEscapeHandler) {
            document.removeEventListener('keydown', this._emotionEscapeHandler);
            this._emotionEscapeHandler = null;
        }
    }

    static async _openEmotionManager(actor) {
        if (!actor) {
            return;
        }

        if (this._emotionManagerApp?.rendered) {
            await this._closeEmotionManagerWindow();
            return;
        }

        this._emotionManagerApp = new LichsomaEmotionManagerApp({ actor });
        await this._emotionManagerApp.render({ force: true });
    }

    /**
     * 감정 데이터는 모듈 플래그에 저장한다(시스템이 `system.emotions`를 무시하는 경우 대비).
     * 모듈에 저장한 적이 있으면 플래그만 사용한다. `Object.assign(system, flag)` 병합은 플래그가 `{}`일 때
     * 삭제가 반영되지 않아 사용하지 않는다.
     * @param {Actor} actor
     */
    static _getActorEmotions(actor) {
        const useModule = actor.getFlag(this.MODULE_ID, this.EMOTIONS_USE_MODULE_FLAG);
        const fromFlag = actor.getFlag(this.MODULE_ID, 'emotions');

        if (useModule || fromFlag !== undefined) {
            if (fromFlag !== undefined && fromFlag !== null && typeof fromFlag === 'object' && !Array.isArray(fromFlag)) {
                return fromFlag;
            }
            return {};
        }

        const fromSystem = actor.system?.emotions;
        return typeof fromSystem === 'object' && fromSystem !== null && !Array.isArray(fromSystem) ? fromSystem : {};
    }

    static _renderEmotionList(actor) {
        const listContainer = this._getEmotionManagerRoot()?.querySelector('.lichsoma-emotion-manager-list');
        if (!listContainer) return;

        const emotions = this._getActorEmotions(actor);
        const items = Object.entries(emotions).map(([id, data]) => ({
            id,
            name: data.name || '',
            portrait: data.portrait || ''
        }));

        const addLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Add') || '감정 추가';
        const itemsHTML = items.map(emotion => `
            <div class="lichsoma-emotion-manager-item" data-emotion-id="${emotion.id}">
                <img src="${emotion.portrait || actor.img}" alt="${emotion.name}" />
                <div class="lichsoma-emotion-manager-item-info">
                    <input type="text" class="lichsoma-emotion-name" value="${emotion.name}" placeholder="감정 이름" />
                    <input type="text" class="lichsoma-emotion-portrait" value="${emotion.portrait}" placeholder="포트레잇 경로" />
                </div>
                <div class="lichsoma-emotion-manager-item-actions">
                    <button type="button" class="lichsoma-emotion-edit-portrait" title="포트레잇 선택">
                        <i class="fa-solid fa-image"></i>
                    </button>
                    <button type="button" class="lichsoma-emotion-delete" title="삭제">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        const addCardHTML = `
            <button type="button" class="lichsoma-emotion-add-card">
                <i class="fa-solid fa-plus"></i>
                <span>${addLabel}</span>
            </button>
        `;

        listContainer.innerHTML = (itemsHTML || '') + addCardHTML;

        // 이벤트 리스너 설정
        this._setupEmotionItemEvents(actor);
    }

    static _setupEmotionItemEvents(actor) {
        const listContainer = this._getEmotionManagerRoot()?.querySelector('.lichsoma-emotion-manager-list');
        if (!listContainer) return;

        // 포트레잇 선택 버튼
        listContainer.querySelectorAll('.lichsoma-emotion-edit-portrait').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const item = ev.currentTarget.closest('.lichsoma-emotion-manager-item');
                const portraitInput = item.querySelector('.lichsoma-emotion-portrait');
                const currentPath = portraitInput.value;

                this._openImageFilePicker({
                    current: currentPath || actor.img,
                    callback: (path) => {
                        portraitInput.value = path;
                        item.querySelector('img').src = path;
                    }
                });
            });
        });

        // 삭제 버튼
        listContainer.querySelectorAll('.lichsoma-emotion-delete').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.currentTarget.closest('.lichsoma-emotion-manager-item').remove();
            });
        });

        // 감정 추가 카드
        const addCard = listContainer.querySelector('.lichsoma-emotion-add-card');
        if (addCard) {
            addCard.addEventListener('click', () => {
                this._addEmotionItemToWindow(actor);
            });
        }
    }

    static async _closeEmotionManagerWindow() {
        this._teardownEmotionEscapeListener();
        const app = this._emotionManagerApp;
        if (!app) return;
        await app.close({ animate: true });
    }

    static _setupEmotionManagerWindowEvents(actor) {
        const root = this._getEmotionManagerRoot();
        if (!root) return;

        this._teardownEmotionEscapeListener();
        this._emotionEscapeHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                void this._closeEmotionManagerWindow();
            }
        };
        document.addEventListener('keydown', this._emotionEscapeHandler);

        const saveBtn = root.querySelector('.lichsoma-emotion-save-action');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this._saveEmotionsFromWindow(actor);
                await this._closeEmotionManagerWindow();
            });
        }
        const cancelBtn = root.querySelector('.lichsoma-emotion-cancel-action');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                void this._closeEmotionManagerWindow();
            });
        }
    }

    static _addEmotionItemToWindow(actor) {
        const listContainer = this._getEmotionManagerRoot()?.querySelector('.lichsoma-emotion-manager-list');
        if (!listContainer) return;

        const newId = foundry.utils.randomID();
        const item = document.createElement('div');
        item.className = 'lichsoma-emotion-manager-item';
        item.dataset.emotionId = newId;
        item.innerHTML = `
            <img src="${actor?.img || 'icons/svg/mystery-man.svg'}" alt="새 감정" />
            <div class="lichsoma-emotion-manager-item-info">
                <input type="text" class="lichsoma-emotion-name" value="" placeholder="감정 이름" />
                <input type="text" class="lichsoma-emotion-portrait" value="" placeholder="포트레잇 경로" />
            </div>
            <div class="lichsoma-emotion-manager-item-actions">
                <button type="button" class="lichsoma-emotion-edit-portrait" title="포트레잇 선택">
                    <i class="fa-solid fa-image"></i>
                </button>
                <button type="button" class="lichsoma-emotion-delete" title="삭제">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;

        // 포트레잇 선택 버튼
        const editBtn = item.querySelector('.lichsoma-emotion-edit-portrait');
        editBtn.addEventListener('click', () => {
            const portraitInput = item.querySelector('.lichsoma-emotion-portrait');
            const currentPath = portraitInput.value;

            this._openImageFilePicker({
                current: currentPath || actor?.img || '',
                callback: (path) => {
                    portraitInput.value = path;
                    item.querySelector('img').src = path;
                }
            });
        });

        // 삭제 버튼
        const deleteBtn = item.querySelector('.lichsoma-emotion-delete');
        deleteBtn.addEventListener('click', () => {
            item.remove();
            // 모든 항목이 삭제되면 빈 메시지 표시
            if (listContainer.querySelectorAll('.lichsoma-emotion-manager-item').length === 0) {
                listContainer.innerHTML = '<p class="lichsoma-emotion-manager-empty">등록된 감정이 없습니다.</p>';
            }
        });

        const addCard = listContainer.querySelector('.lichsoma-emotion-add-card');
        if (addCard) {
            listContainer.insertBefore(item, addCard);
        } else {
            listContainer.appendChild(item);
        }
    }

    static async _saveEmotionsFromWindow(actor) {
        const root = this._getEmotionManagerRoot();
        if (!root) return;

        const items = root.querySelectorAll('.lichsoma-emotion-manager-item');
        const emotions = {};

        items.forEach(item => {
            const emotionId = item.dataset.emotionId;
            const nameInput = item.querySelector('.lichsoma-emotion-name');
            const portraitInput = item.querySelector('.lichsoma-emotion-portrait');
            const name = nameInput.value.trim();
            const portrait = portraitInput.value.trim();

            if (name && portrait) {
                emotions[emotionId] = { name, portrait };
            }
        });

        try {
            // Foundry 플래그 갱신이 객체를 깊게 병합하는 경우, setFlag만으로는 삭제된 키가 남을 수 있음 → unset 후 재설정
            await actor.unsetFlag(this.MODULE_ID, 'emotions');
            if (Object.keys(emotions).length > 0) {
                await actor.setFlag(this.MODULE_ID, 'emotions', emotions);
            }
            await actor.setFlag(this.MODULE_ID, this.EMOTIONS_USE_MODULE_FLAG, true);
        } catch (err) {
            // 감정 저장 실패
            ui.notifications.error(game.i18n.localize('SPEAKERSELECTOR.Emotion.SaveError') || '감정 저장 중 오류가 발생했습니다.');
        }
    }


    static getCurrentEmotion() {
        return {
            emotionId: this._currentEmotion,
            emotionName: this._currentEmotionName,
            emotionPortrait: this._currentEmotionPortrait
        };
    }

    static getSavedEmotion(actorId) {
        return this._actorEmotionMap.get(actorId) || null;
    }

    static _handleEmotionPick(selector, actorId, emotions, emotionId) {
        if (emotionId) {
            const emotion = emotions[emotionId];
            if (!emotion) return;
            this._currentEmotion = emotionId;
            this._currentEmotionName = emotion.name || null;
            this._currentEmotionPortrait = emotion.portrait;
            selector.find('.emotion-btn').addClass('active');
            this._actorEmotionMap.set(actorId, {
                emotionId,
                emotionName: emotion.name || null,
                emotionPortrait: emotion.portrait
            });
        } else {
            this.clearEmotion();
            selector.find('.emotion-btn').removeClass('active');
            this._actorEmotionMap.delete(actorId);
        }

        const SpeakerSelector = window.SpeakerSelector;
        if (SpeakerSelector) {
            if (SpeakerSelector._updateActorOptionInDropdown) {
                SpeakerSelector._updateActorOptionInDropdown(actorId);
            } else if (SpeakerSelector._updateSpeakerDropdown) {
                SpeakerSelector._updateSpeakerDropdown();
            }
        }
    }

    static async showEmotionSelector(selector, actorId) {
        if (!actorId) {
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        const emotions = this._getActorEmotions(actor);
        const emotionList = Object.entries(emotions).map(([id, data]) => ({
            id,
            name: data.name,
            portrait: data.portrait
        }));

        if (!emotionList.length) {
            void this._openEmotionManager(actor);
            return;
        }

        if (this._emotionSelectorApp?.rendered) {
            await this._emotionSelectorApp.close({ animate: false });
        }

        this._emotionSelectorApp = new LichsomaEmotionSelectorApp({
            actor,
            selector,
            actorId,
            emotions
        });
        await this._emotionSelectorApp.render({ force: true });
    }

    static restoreEmotionForActor(actorId) {
        const saved = this._actorEmotionMap.get(actorId);
        if (saved) {
            this._currentEmotion = saved.emotionId;
            this._currentEmotionName = saved.emotionName;
            this._currentEmotionPortrait = saved.emotionPortrait;
            return true;
        }

        this.clearEmotion();
        return false;
    }

    static clearEmotion() {
        this._currentEmotion = null;
        this._currentEmotionName = null;
        this._currentEmotionPortrait = null;
    }

    static addEmotionFlagsToMessage(data) {
        if (this._currentEmotionPortrait) {
            data.flags = data.flags || {};
            data.flags['lichsoma-speaker-selector'] = data.flags['lichsoma-speaker-selector'] || {};
            data.flags['lichsoma-speaker-selector'].emotionPortrait = this._currentEmotionPortrait;
            data.flags['lichsoma-speaker-selector'].emotionId = this._currentEmotion;
        }
    }

    static getEmotionPortraitForMessage(message) {
        const flags = message.flags?.['lichsoma-speaker-selector'];
        return flags?.emotionPortrait || null;
    }
}

/**
 * 감정 선택 — ApplicationV2
 */
class LichsomaEmotionSelectorApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'lichsoma-emotion-selector',
        classes: ['lichsoma-emotion-selector-app'],
        tag: 'div',
        position: {
            width: 480,
            height: 420
        },
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.Emotion.SelectTitle',
            resizable: true,
            minimizable: false,
            contentClasses: ['lichsoma-emotion-selector-window-content']
        }
    };

    constructor(options = {}) {
        const actor = options.actor;
        const selector = options.selector;
        const actorId = options.actorId;
        const emotions = options.emotions;
        if (!actor || !selector || !actorId || emotions === undefined) {
            throw new Error('LichsomaEmotionSelectorApp requires actor, selector, actorId, emotions');
        }
        const { actor: _a, selector: _s, actorId: _i, emotions: _e, ...rest } = options;
        const base = foundry.utils.mergeObject(LichsomaEmotionSelectorApp.DEFAULT_OPTIONS, rest);
        base.window = foundry.utils.mergeObject(base.window, {
            title: `${actor.name} — ${game.i18n.localize('SPEAKERSELECTOR.Emotion.SelectTitle') || '감정 선택'}`
        });
        super(base);
        this.actor = actor;
        this.selector = selector;
        this.actorId = actorId;
        this.emotions = emotions;
    }

    async _prepareContext(options) {
        return {};
    }

    async _renderHTML(context, options) {
        const esc = foundry.utils.escapeHTML;
        const actor = this.actor;
        const emotionList = Object.entries(this.emotions).map(([id, data]) => ({
            id,
            name: data?.name || '',
            portrait: data?.portrait || ''
        }));
        const defaultLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Default') || '기본';
        const manageLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리';

        const wrap = document.createElement('div');
        wrap.className = 'lichsoma-emotion-selector-app-inner';
        wrap.innerHTML = `
            <div class="lichsoma-emotion-selector-dialog">
                <div class="lichsoma-emotion-options">
                    <div class="lichsoma-emotion-option default-option" data-emotion-id="">
                        <img src="${actor.img}" alt="${esc(defaultLabel)}" />
                        <span>${esc(defaultLabel)}</span>
                    </div>
                    ${emotionList.map(emotion => `
                        <div class="lichsoma-emotion-option" data-emotion-id="${esc(emotion.id)}">
                            <img src="${emotion.portrait}" alt="${esc(emotion.name)}" />
                            <span>${esc(emotion.name)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="lichsoma-emotion-selector-footer">
                <button type="button" class="lichsoma-emotion-selector-manage">
                    <i class="fas fa-cog"></i> ${esc(manageLabel)}
                </button>
            </div>
        `;
        return wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
        ActorEmotions._emotionSelectorApp = this;
        const root = this.element?.querySelector('.lichsoma-emotion-selector-app-inner');
        if (!root) return;

        root.querySelectorAll('.lichsoma-emotion-option').forEach((el) => {
            el.addEventListener('click', () => {
                const raw = el.getAttribute('data-emotion-id');
                const emotionId = raw === null || raw === '' ? '' : raw;
                ActorEmotions._handleEmotionPick(this.selector, this.actorId, this.emotions, emotionId);
                void this.close();
            });
        });

        const manageBtn = root.querySelector('.lichsoma-emotion-selector-manage');
        if (manageBtn) {
            manageBtn.addEventListener('click', async () => {
                await this.close({ animate: false });
                void ActorEmotions._openEmotionManager(this.actor);
            });
        }

        const current = ActorEmotions._currentEmotion;
        if (current) {
            root.querySelectorAll('.lichsoma-emotion-option').forEach((el) => {
                if (el.getAttribute('data-emotion-id') === current) {
                    el.classList.add('selected');
                }
            });
        } else {
            root.querySelector('.default-option')?.classList.add('selected');
        }
    }

    _onClose(options) {
        if (ActorEmotions._emotionSelectorApp === this) {
            ActorEmotions._emotionSelectorApp = null;
        }
    }
}

/**
 * 감정 관리 — ApplicationV2 (스피커 액터 격자 설정과 동일 패턴)
 */
class LichsomaEmotionManagerApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'lichsoma-emotion-manager',
        classes: ['lichsoma-emotion-manager-app'],
        tag: 'div',
        position: {
            width: 600,
            height: 500
        },
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.Emotion.Manage',
            resizable: true,
            minimizable: false,
            contentClasses: ['lichsoma-emotion-manager-window-content']
        }
    };

    constructor(options = {}) {
        const actor = options.actor;
        if (!actor) throw new Error('LichsomaEmotionManagerApp requires an actor');
        const { actor: _a, ...rest } = options;
        const manageLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리';
        const title = game.i18n.format('SPEAKERSELECTOR.Emotion.ManageWindowTitle', {
            manage: manageLabel,
            actorName: actor.name
        });
        const base = foundry.utils.mergeObject(LichsomaEmotionManagerApp.DEFAULT_OPTIONS, rest);
        base.window = foundry.utils.mergeObject(base.window, { title });
        // super() 이전에는 this를 쓸 수 없음 — this.constructor.DEFAULT_OPTIONS 금지
        super(base);
        this.actor = actor;
    }

    async _prepareContext(options) {
        return {};
    }

    async _renderHTML(context, options) {
        const wrap = document.createElement('div');
        wrap.className = 'lichsoma-emotion-manager-app-inner';
        const saveLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Save');
        const cancelLabel = game.i18n.localize('SPEAKERSELECTOR.Emotion.Cancel');
        wrap.innerHTML = `
            <div class="lichsoma-emotion-manager-container">
                <div class="lichsoma-emotion-manager-list"></div>
                <div class="lichsoma-emotion-manager-actions">
                    <button type="button" class="lichsoma-emotion-save-action">${saveLabel}</button>
                    <button type="button" class="lichsoma-emotion-cancel-action">${cancelLabel}</button>
                </div>
            </div>
        `;
        return wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
        ActorEmotions._emotionManagerApp = this;
        ActorEmotions._renderEmotionList(this.actor);
        ActorEmotions._setupEmotionManagerWindowEvents(this.actor);
    }

    _onClose(options) {
        ActorEmotions._teardownEmotionEscapeListener();
        if (ActorEmotions._emotionManagerApp === this) {
            ActorEmotions._emotionManagerApp = null;
        }
    }
}

