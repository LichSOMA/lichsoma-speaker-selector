/**
 * LichSOMA Actor Emotions
 * 액터 감정 포트레잇 선택 기능
 */

export class ActorEmotions {
    static _currentEmotion = null;
    static _currentEmotionName = null;
    static _currentEmotionPortrait = null;
    static _actorEmotionMap = new Map();
    static _emotionManagerWindow = null; // 감정 관리 창 참조

    static initialize() {
        Hooks.on('renderActorSheet', (app, html, data) => {
            this._injectEmotionButton(app, html);
        });
    }

    static _injectEmotionButton(app, html) {
        const actor = app.actor || app.object || app.document;
        if (!actor) return;

        const canEdit = actor.isOwner || game.user.isGM;
        if (!canEdit) return;

        const windowHeader = html.find('.window-header');
        if (!windowHeader.length) return;

        if (windowHeader.find('.lichsoma-emotion-manage-btn').length) return;

        const button = $(`
            <a class="lichsoma-emotion-manage-btn" title="${game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리'}">
                <i class="fa-solid fa-face-smile"></i> ${game.i18n.localize('SPEAKERSELECTOR.Emotion.Label') || '감정'}
            </a>
        `);

        button.on('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this._openEmotionManager(actor);
        });

        const closeBtn = windowHeader.find('.close');
        if (closeBtn.length) {
            closeBtn.before(button);
        } else {
            windowHeader.append(button);
        }
    }

    // HTML 템플릿 로드
    static async _loadEmotionManagerTemplate() {
        try {
            const template = await fetch('modules/lichsoma-speaker-selector/templates/emotion-manager.html');
            return await template.text();
        } catch (err) {
            // 템플릿 로드 실패 (무시)
            return null;
        }
    }

    static async _openEmotionManager(actor) {
        if (!actor) {
            return;
        }

        // 기존 창이 있으면 닫기
        if (this._emotionManagerWindow) {
            this._closeEmotionManagerWindow();
            return;
        }

        await this._createEmotionManagerWindow(actor);
    }

    static async _createEmotionManagerWindow(actor) {
        // 템플릿 로드
        let templateHTML = await this._loadEmotionManagerTemplate();
        if (!templateHTML) {
            // 템플릿 로드 실패 시 기본 HTML 사용
            templateHTML = `
                <div class="lichsoma-emotion-manager-window">
                    <div class="lichsoma-grid-window-header" style="cursor: move;">
                        <h3>${game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리'}</h3>
                        <div class="lichsoma-grid-controls">
                            <button class="lichsoma-emotion-close-btn" title="${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.Close') || '닫기'}">×</button>
                        </div>
                    </div>
                    <div class="lichsoma-grid-window-content">
                        <div class="lichsoma-emotion-manager-container">
                            <div class="lichsoma-emotion-manager-list"></div>
                            <div class="lichsoma-emotion-manager-actions">
                                <button type="button" class="lichsoma-emotion-add-btn">
                                    <i class="fa-solid fa-plus"></i> ${game.i18n.localize('SPEAKERSELECTOR.Emotion.Add') || '감정 추가'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 템플릿 DOM 생성
        const wrapper = document.createElement('div');
        wrapper.innerHTML = templateHTML.trim();
        this._emotionManagerWindow = wrapper.firstElementChild;
        if (!this._emotionManagerWindow) {
            // 감정 관리 템플릿 구조가 올바르지 않음 (무시)
            return;
        }
        // 중복 루트 방지 위해 클래스 부여 여부 확인
        if (!this._emotionManagerWindow.classList.contains('lichsoma-emotion-manager-window')) {
            this._emotionManagerWindow.classList.add('lichsoma-emotion-manager-window');
        }

        // 액터 정보 저장
        this._emotionManagerWindow.dataset.actorId = actor.id;

        // 텍스트 로컬라이징
        const titleEl = this._emotionManagerWindow.querySelector('.lichsoma-emotion-manager-title');
        if (titleEl) {
            titleEl.textContent = game.i18n.localize('SPEAKERSELECTOR.Emotion.Manage') || '감정 관리';
        }
        const closeBtn = this._emotionManagerWindow.querySelector('.lichsoma-emotion-close-btn');
        if (closeBtn) {
            closeBtn.title = game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.Close') || '닫기';
        }
        const saveAction = this._emotionManagerWindow.querySelector('.lichsoma-emotion-save-action');
        if (saveAction) {
            saveAction.textContent = game.i18n.localize('SPEAKERSELECTOR.Emotion.Save') || '저장';
        }
        const cancelAction = this._emotionManagerWindow.querySelector('.lichsoma-emotion-cancel-action');
        if (cancelAction) {
            cancelAction.textContent = game.i18n.localize('SPEAKERSELECTOR.Emotion.Cancel') || '취소';
        }

        // 감정 목록 렌더링
        this._renderEmotionList(actor);

        // body에 추가
        document.body.appendChild(this._emotionManagerWindow);

        // 이벤트 리스너 추가
        this._setupEmotionManagerWindowEvents(actor);

        // 애니메이션을 위한 클래스 추가
        setTimeout(() => {
            this._emotionManagerWindow.classList.add('lichsoma-grid-window-open');
        }, 10);
    }

    static _renderEmotionList(actor) {
        const listContainer = this._emotionManagerWindow.querySelector('.lichsoma-emotion-manager-list');
        if (!listContainer) return;

        const emotions = actor.system?.emotions || {};
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
        const listContainer = this._emotionManagerWindow.querySelector('.lichsoma-emotion-manager-list');
        if (!listContainer) return;

        // 포트레잇 선택 버튼
        listContainer.querySelectorAll('.lichsoma-emotion-edit-portrait').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const item = ev.currentTarget.closest('.lichsoma-emotion-manager-item');
                const portraitInput = item.querySelector('.lichsoma-emotion-portrait');
                const currentPath = portraitInput.value;

                new FilePicker({
                    type: 'image',
                    current: currentPath || actor.img,
                    callback: (path) => {
                        portraitInput.value = path;
                        item.querySelector('img').src = path;
                    }
                }).render(true);
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

    static _closeEmotionManagerWindow() {
        if (this._emotionManagerWindow) {
            this._emotionManagerWindow.classList.remove('lichsoma-grid-window-open');
            setTimeout(() => {
                if (this._emotionManagerWindow) {
                    this._emotionManagerWindow.remove();
                    this._emotionManagerWindow = null;
                }
            }, 200);
        }
    }

    static _setupEmotionManagerWindowEvents(actor) {
        if (!this._emotionManagerWindow) return;

        // 창 드래그 기능
        const header = this._emotionManagerWindow.querySelector('.lichsoma-grid-window-header');
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        let animationFrameId = null;

        const handleMouseDown = (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }

            isDragging = true;
            const rect = this._emotionManagerWindow.getBoundingClientRect();
            this._emotionManagerWindow.style.left = rect.left + 'px';
            this._emotionManagerWindow.style.top = rect.top + 'px';
            this._emotionManagerWindow.style.transform = 'none';
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            e.preventDefault();
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            animationFrameId = requestAnimationFrame(() => {
                const x = e.clientX - dragOffset.x;
                const y = e.clientY - dragOffset.y;

                const maxX = window.innerWidth - this._emotionManagerWindow.offsetWidth;
                const maxY = window.innerHeight;

                const clampedX = Math.max(0, Math.min(x, maxX));
                const clampedY = Math.max(0, Math.min(y, maxY));

                this._emotionManagerWindow.style.left = clampedX + 'px';
                this._emotionManagerWindow.style.top = clampedY + 'px';
            });
        };

        const handleMouseUp = () => {
            isDragging = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        if (header) {
            header.addEventListener('mousedown', handleMouseDown);
        }

        // 닫기 버튼
        const closeBtn = this._emotionManagerWindow.querySelector('.lichsoma-emotion-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this._closeEmotionManagerWindow();
            });
        }

        // 하단 저장/취소 버튼
        const saveBtn = this._emotionManagerWindow.querySelector('.lichsoma-emotion-save-action');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
            await this._saveEmotionsFromWindow(actor);
            this._closeEmotionManagerWindow();
        });
        }
        const cancelBtn = this._emotionManagerWindow.querySelector('.lichsoma-emotion-cancel-action');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this._closeEmotionManagerWindow();
            });
        }

        // ESC 키로 닫기
        const handleKeydown = (e) => {
            if (e.key === 'Escape' && this._emotionManagerWindow) {
                this._closeEmotionManagerWindow();
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);
    }

    static _addEmotionItemToWindow(actor) {
        const listContainer = this._emotionManagerWindow.querySelector('.lichsoma-emotion-manager-list');
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

            new FilePicker({
                type: 'image',
                current: currentPath || actor?.img || '',
                callback: (path) => {
                    portraitInput.value = path;
                    item.querySelector('img').src = path;
                }
            }).render(true);
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
        if (!this._emotionManagerWindow) return;

        const items = this._emotionManagerWindow.querySelectorAll('.lichsoma-emotion-manager-item');
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
            await actor.update({ 'system.emotions': emotions });
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

    static showEmotionSelector(selector, actorId) {
        if (!actorId) {
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor) {
            return;
        }

        const emotions = actor.system?.emotions || {};
        const emotionList = Object.entries(emotions).map(([id, data]) => ({
            id,
            name: data.name,
            portrait: data.portrait
        }));

        if (!emotionList.length) {
            ui.notifications.warn('No emotions are registered on this actor.');
            return;
        }

        const content = `
            <div class="lichsoma-emotion-selector-dialog">
                <div class="lichsoma-emotion-options">
                    <div class="lichsoma-emotion-option default-option" data-emotion-id="">
                        <img src="${actor.img}" alt="기본" />
                        <span>기본</span>
                    </div>
                    ${emotionList.map(emotion => `
                        <div class="lichsoma-emotion-option" data-emotion-id="${emotion.id}">
                            <img src="${emotion.portrait}" alt="${emotion.name}" />
                            <span>${emotion.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        const dlg = new Dialog({
            title: `${actor.name} - 감정 선택`,
            content,
            buttons: {
                manage: {
                    icon: '<i class="fas fa-cog"></i>',
                    label: '감정 관리',
                    callback: () => {
                        dlg.close();
                        this._openEmotionManager(actor);
                    }
                }
            },
            default: null,
            render: (html) => {
                html.find('.lichsoma-emotion-option').on('click', (ev) => {
                    const emotionId = $(ev.currentTarget).data('emotion-id');
                    let emotion = null;
                    let emotionName = null;

                    if (emotionId) {
                        emotion = emotions[emotionId];
                        this._currentEmotion = emotionId;
                        this._currentEmotionName = emotion.name || null;
                        this._currentEmotionPortrait = emotion.portrait;
                        emotionName = emotion.name || null;
                        selector.find('.emotion-btn').addClass('active');
                        this._actorEmotionMap.set(actorId, {
                            emotionId,
                            emotionName: emotion.name || null,
                            emotionPortrait: emotion.portrait
                        });
                    } else {
                        // 기본 포트레잇으로 복귀
                        this.clearEmotion();
                        selector.find('.emotion-btn').removeClass('active');
                        this._actorEmotionMap.delete(actorId);
                    }

                    // 드롭다운의 해당 액터 옵션만 즉시 업데이트
                    const SpeakerSelector = window.SpeakerSelector;
                    if (SpeakerSelector) {
                        if (SpeakerSelector._updateActorOptionInDropdown) {
                            SpeakerSelector._updateActorOptionInDropdown(actorId);
                        } else {
                            // _updateActorOptionInDropdown 함수를 찾을 수 없으면 전체 드롭다운 업데이트
                            if (SpeakerSelector._updateSpeakerDropdown) {
                                SpeakerSelector._updateSpeakerDropdown();
                            }
                        }
                    }

                    dlg.close();
                });

                if (this._currentEmotion) {
                    html.find(`.lichsoma-emotion-option[data-emotion-id="${this._currentEmotion}"]`).addClass('selected');
                } else {
                    html.find('.default-option').addClass('selected');
                }
            }
        });

        dlg.render(true);
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

