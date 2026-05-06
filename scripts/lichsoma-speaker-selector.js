/**
 * LichSOMA Speaker Selector
 * 토큰에 구애 받지 않고 스피커를 선택할 수 있는 모듈
 */

import { ChatUI } from './lichsoma-chat-ui.js';
import { ActorEmotions } from './lichsoma-actor-emotions.js';
import { ChatMerge } from './lichsoma-chat-merge.js';
import { ChatRubyHandler } from './lichsoma-chat-handler.js';

export class SpeakerSelector {
    static SETTINGS = {
        SHOW_PORTRAIT: 'showPortrait',
        PORTRAIT_SIZE: 'portraitSize',
        ALWAYS_USE_CHARACTER: 'alwaysUseCharacter',
        ALWAYS_USE_ACTOR: 'alwaysUseActor',
        PREVENT_OTHER_USER_CHARACTER: 'preventOtherUserCharacter',
        APPLY_USER_COLOR: 'applyUserColor',
        ENABLE_CHAT_MERGE: 'enableChatMerge',
        ACTOR_GRID_ACTORS: 'actorGridActors',
        CHAT_HEADER_FONT: 'chatHeaderFont',
        CHAT_HEADER_CHINESE_FONT: 'chatHeaderChineseFont',
        CHAT_HEADER_FONT_SIZE: 'chatHeaderFontSize',
        CHAT_HEADER_FONT_WEIGHT: 'chatHeaderFontWeight',
        CHAT_MESSAGE_FONT: 'chatMessageFont',
        CHAT_MESSAGE_CHINESE_FONT: 'chatMessageChineseFont',
        CHAT_MESSAGE_FONT_SIZE: 'chatMessageFontSize',
        NARRATOR_FONT: 'narratorFont',
        NARRATOR_FONT_SIZE: 'narratorFontSize',
        NARRATOR_FONT_WEIGHT: 'narratorFontWeight',
        NARRATOR_TYPING_SOUND: 'narratorTypingSound',
        NARRATOR_TYPING_SPEED: 'narratorTypingSpeed',
        NARRATOR_ITALIC: 'narratorItalic',
        NARRATOR_CHAT_CARD: 'narratorChatCard',
        CHAT_LOG_EXPORT_BASE_PATH: 'chatLogExportBasePath',
        CHAT_LOG_EXPORT_USE_BASE64: 'chatLogExportUseBase64',
        CHAT_LOG_EXPORT_CUSTOM_CSS: 'chatLogExportCustomCSS',
        CHAT_LOG_EXPORT_SHOW_DICE_TOOLTIP: 'chatLogExportShowDiceTooltip',
    };
    
    static _fontChoicesUpdated = false;

    /**
     * `document.fonts` / 월드 설정에 들어간 패밀리 이름 앞뒤의 ASCII 따옴표 제거.
     * 브라우저가 `"이름"` 형태로 반환하거나 저장된 경우 CSS `font-family: "이름"`과 맞추기 위함.
     */
    static _normalizeFontFamilyName(name) {
        if (name == null || typeof name !== 'string') return '';
        let s = name.trim();
        while (s.length >= 2) {
            const open = s[0];
            const close = s[s.length - 1];
            if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
                s = s.slice(1, -1).trim();
            } else {
                break;
            }
        }
        return s;
    }

    static initialize() {
        this.registerSettings();
        
        // ActorEmotions 초기화
        ActorEmotions.initialize();
        
        // ChatMerge 초기화
        ChatMerge.initialize();
        
        // ChatRubyHandler 초기화
        ChatRubyHandler.initialize();

        // 채팅 메시지 렌더링 훅 추가
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            // html이 HTMLElement이므로 jQuery로 변환
            const $html = $(html);

            // dnd5e 호환용 커스텀 센더 준비
            this._prepareDnd5eSender($html);
            
            // 메시지 요소에 author.id를 data 속성으로 저장 (챗 머지 기능용)
            const messageElement = $html.closest('.chat-message');
            if (messageElement.length && message.author?.id) {
                messageElement.attr('data-author-id', message.author.id);
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
            if (!flags.portraitSrc || !flags.userId) {
                let speakerData = message.speaker;
                if (speakerData && speakerData.token) {
                    // speaker가 이미 있지만 token이 설정된 경우: "항상 액터로 말하기" 적용 (본인 메시지만)
                    const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                    if (alwaysUseActor && message.author?.id === game.user.id) {
                        const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                        if (tokenFromSpeaker?.actor) {
                            speakerData = {
                                alias: tokenFromSpeaker.actor.name,
                                scene: speakerData.scene || game.scenes.active?.id || null,
                                actor: tokenFromSpeaker.actor.id,
                                token: null
                            };
                        }
                    }
                }
                if (!speakerData) {
                    // speaker가 없으면 선택한 토큰에서 가져오기
                    const selectedTokens = canvas.tokens?.controlled || [];
                    if (selectedTokens.length > 0) {
                        const token = selectedTokens[0];
                        const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
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
                                    speakerData = {
                                        alias: character.name,
                                        scene: game.scenes.active?.id || null,
                                        actor: character.id,
                                        token: null
                                    };
                                }
                            }
                        } else if (alwaysUseActor && token.actor) {
                            // 설정이 활성화되어 있으면 액터로 말하기 (token: null)
                            speakerData = {
                                alias: token.actor.name,
                                scene: game.scenes.active?.id || null,
                                actor: token.actor.id,
                                token: null
                            };
                        } else {
                            // 기본 동작: 토큰으로 말하기
                            speakerData = {
                                alias: token.actor?.name || token.name,
                                scene: game.scenes.active?.id || null,
                                actor: token.actor?.id || null,
                                token: token.id || null
                            };
                        }
                    } else if (game.user.character) {
                        // 토큰도 없으면 할당된 캐릭터 사용
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            speakerData = {
                                alias: character.name,
                                scene: game.scenes.active?.id || null,
                                actor: character.id,
                                token: null
                            };
                        }
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, message.author?.id);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
                    const existingFlags = message.flags?.['lichsoma-speaker-selector'] || {};
                    const mergedFlags = foundry.utils.mergeObject(existingFlags, extraFlags, { inplace: false });
                    message.updateSource({ flags: { 'lichsoma-speaker-selector': mergedFlags } });
                }
            }
            
            // 스피커 이름 수정 (항상 할당된 캐릭터로 말하기 설정 확인)
            this._fixMessageSenderName(message, $html);
            
            // 유저 색상 적용 (다른 훅이 실행된 후에 적용하기 위해 약간의 지연)
            setTimeout(() => {
                this._applyUserColorToSender(message, $html);
            }, 10);
            
            // 포트레잇 추가
            this._addPortraitToMessage(message, $html, data);
            
            // 한자 폰트 설정이 있으면 한자 감싸기 적용 (저장값 따옴표 정규화는 _applyChatFonts와 동일)
            const headerChineseFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_CHINESE_FONT)
            );
            const messageChineseFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_CHINESE_FONT)
            );
            
            if (headerChineseFont) {
                const senderElement = this._getSenderElement($html)[0];
                if (senderElement) {
                    this._wrapChineseCharacters(senderElement, 'header');
                }
            }
            
            if (messageChineseFont) {
                const contentElement = $html.find('.message-content')[0];
                if (contentElement) {
                    this._wrapChineseCharacters(contentElement, 'message');
                }
            }
            
            // 나레이터 채팅 카드 처리
            this._processNarratorChatCard(message, $html);
        });

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
                // 폰트 설정 적용
                this._applyChatFonts();
            }, 200);
        });
    }
    
    /**
     * 폰트 로드 완료를 기다린 후 폰트 목록 업데이트
     */
    static _waitForFontsAndUpdate() {
        // document.fonts.ready를 사용하여 폰트 로드 완료 대기
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                // 폰트 로드 완료 후 약간의 딜레이를 두고 업데이트 (document.fonts 준비 대기)
                setTimeout(() => {
                    this._updateFontChoices();
                }, 500);
            }).catch(() => {
                // 폰트 API 실패 시 폴백으로 일정 시간 후 업데이트
                setTimeout(() => {
                    this._updateFontChoices();
                }, 1000);
            });
        } else {
            // 폰트 API가 없는 경우 폴백
            setTimeout(() => {
                this._updateFontChoices();
            }, 1000);
        }
        
        // 최대 대기 시간 설정 (5초 후에는 강제로 업데이트)
        setTimeout(() => {
            this._updateFontChoices(true);
        }, 5000);
        
        // 추가로 10초 후에도 한 번 더 업데이트 (늦게 로드되는 폰트 대응)
        setTimeout(() => {
            this._updateFontChoices(true);
        }, 10000);
    }
    
    /**
     * 폰트 선택 옵션 업데이트
     * @param {boolean} force - true일 경우 이미 업데이트되었어도 강제로 다시 업데이트
     */
    static _updateFontChoices(force = false) {
        // 이미 업데이트된 경우 스킵 (강제 업데이트가 아닐 때만)
        if (this._fontChoicesUpdated && !force) {
            return;
        }

        try {
            const availableFonts = this._getAvailableFonts();
            
            // 폰트 설정 키 목록
            const fontSettings = [
                this.SETTINGS.CHAT_HEADER_FONT,
                this.SETTINGS.CHAT_MESSAGE_FONT,
                this.SETTINGS.CHAT_HEADER_CHINESE_FONT,
                this.SETTINGS.CHAT_MESSAGE_CHINESE_FONT,
                this.SETTINGS.NARRATOR_FONT
            ];
            
            fontSettings.forEach(settingKey => {
                // 현재 선택된 폰트 값 가져오기 (저장값에 따옴표가 섞인 경우 정규화해 목록 키와 맞춤)
                const rawFont = game.settings.get('lichsoma-speaker-selector', settingKey);
                const currentFont = this._normalizeFontFamilyName(rawFont);
                if (currentFont && !availableFonts[currentFont]) {
                    availableFonts[currentFont] = currentFont;
                }
                
                // 설정 메뉴에서 폰트 선택 옵션 업데이트
                const setting = game.settings.settings.get(`lichsoma-speaker-selector.${settingKey}`);
                if (setting) {
                    setting.choices = availableFonts;
                }
            });
            
            this._fontChoicesUpdated = true;
        } catch (error) {
            // 폰트 선택 옵션 업데이트 실패 (무시)
        }
    }
    
    /**
     * 브라우저에서 사용 가능한 폰트 목록 가져오기
     */
    static _getAvailableFonts() {
        try {
            const loadedFonts = [];

            try {
                if (document.fonts && document.fonts.forEach) {
                    document.fonts.forEach((font) => {
                        const family = font.family;
                        if (family && typeof family === 'string') {
                            const n = this._normalizeFontFamilyName(family);
                            if (n) loadedFonts.push(n);
                        }
                    });
                }
            } catch (e) {
                // document.fonts 접근 실패 (무시)
            }
            
            // 제외할 폰트들 (패턴 매칭)
            const excludePatterns = [
                'modesto condensed',
                'modesto',
                'amiri',
                'signika',
                'bruno ace',
                'font awesome',
                'fontawesome',
                'fallback'
            ];
            
            // 필터링 및 중복 제거
            const filteredFonts = loadedFonts.filter(font => {
                if (!font || typeof font !== 'string') return false;
                const lowerFont = font.toLowerCase().trim();
                return !excludePatterns.some(pattern => lowerFont.includes(pattern));
            });
            
            const uniqueFonts = [...new Set(filteredFonts)];
            
            // 기본 폰트와 결합 (빈 문자열은 항상 포함)
            const allFonts = ['', ...uniqueFonts.filter(f => f && f.trim() !== '')];
            
            // 폰트 정렬: 빈 문자열을 제외하고 한글, 영어, 숫자 순으로 정렬
            const sortedFonts = allFonts.sort((a, b) => {
                // 빈 문자열은 항상 맨 앞
                if (a === '') return -1;
                if (b === '') return 1;
                
                // 나머지는 localeCompare로 정렬 (한글, 영어, 숫자 순)
                return a.localeCompare(b, ['ko', 'en'], { numeric: true, sensitivity: 'base' });
            });
            
            // 폰트 선택 옵션 객체 생성
            const fontChoices = {};
            sortedFonts.forEach(font => {
                if (font === '') {
                    fontChoices[font] = '기본';
                } else {
                    fontChoices[font] = font;
                }
            });

            return fontChoices;
        } catch (error) {
            // 폰트 목록 가져오기 실패 시 기본값 반환
            return {
                '': '기본',
                'Arial': 'Arial',
                'Times New Roman': 'Times New Roman',
                'Courier New': 'Courier New',
                'Verdana': 'Verdana',
                'Georgia': 'Georgia'
            };
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

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ShowPortrait.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ShowPortrait.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: true,
            requiresReload: true
        });

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.PORTRAIT_SIZE, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.PortraitSize.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.PortraitSize.Hint'),
            scope: 'world',
            config: true,
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

        // 초기 폰트 목록
        const initialFonts = {
            '': '기본',
            'Arial': 'Arial',
            'Times New Roman': 'Times New Roman',
            'Courier New': 'Courier New',
            'Verdana': 'Verdana',
            'Georgia': 'Georgia'
        };

        // 1. 채팅 헤더 폰트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFont.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFont.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: initialFonts,
            default: '',
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                }, 100);
            }
        });

        // 2. 헤더 한자 전용 폰트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_CHINESE_FONT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderChineseFont.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderChineseFont.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: initialFonts,
            default: '',
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                    // 기존 메시지들에도 한자 감싸기 재적용
                    document.querySelectorAll('.chat-message').forEach(messageEl => {
                        const senderEl = this._getSenderElement($(messageEl));
                        if (senderEl.length) {
                            senderEl[0].removeAttribute('data-lichsoma-chinese-wrapped');
                            this._wrapChineseCharacters(senderEl[0], 'header');
                        }
                    });
                }, 100);
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

        // 4. 헤더 폰트 웨이트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT_WEIGHT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFontWeight.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatHeaderFontWeight.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 700,
            range: {
                min: 100,
                max: 900,
                step: 100
            },
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                }, 100);
            }
        });

        // 5. 채팅 메시지 폰트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_FONT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageFont.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageFont.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: initialFonts,
            default: '',
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                }, 100);
            }
        });

        // 6. 메시지 한자 전용 폰트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_CHINESE_FONT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageChineseFont.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatMessageChineseFont.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: initialFonts,
            default: '',
            onChange: () => {
                setTimeout(() => {
                    this._applyChatFonts();
                    // 기존 메시지들에도 한자 감싸기 재적용
                    document.querySelectorAll('.chat-message .message-content').forEach(el => {
                        el.removeAttribute('data-lichsoma-chinese-wrapped');
                        this._wrapChineseCharacters(el, 'message');
                    });
                }, 100);
            }
        });

        // 7. 메시지 폰트 크기
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

        // 8. 나레이터 폰트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFont.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFont.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            choices: initialFonts,
            default: '',
            onChange: () => {
                setTimeout(() => {
                    this._applyNarratorFont();
                }, 100);
            }
        });

        // 9. 나레이터 폰트 크기
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

        // 10. 나레이터 폰트 웨이트
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT_WEIGHT, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFontWeight.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorFontWeight.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 700,
            range: {
                min: 100,
                max: 900,
                step: 100
            },
            onChange: () => {
                setTimeout(() => {
                    this._applyNarratorFont();
                }, 100);
            }
        });

        // 11. 나레이터 타이핑 속도
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

        // 12. 나레이터 기울기 효과
        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_ITALIC, {
            name: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorItalic.Name'),
            hint: game.i18n.localize('SPEAKERSELECTOR.Settings.NarratorItalic.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                setTimeout(() => {
                    this._applyNarratorFont();
                }, 100);
            }
        });

        // 13. 나레이터 채팅 카드
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

        // 14. 나레이터 타이핑 사운드
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
        
        // 폰트가 로드될 때까지 기다린 후 폰트 목록 업데이트
        this._waitForFontsAndUpdate();

        game.settings.register('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS, {
            name: '등록된 스피커 액터',
            hint: '스피커 셀렉터에 표시될 액터 목록 (내부 설정)',
            scope: 'world',
            config: false,
            type: Array,
            default: []
        });
    }

    // 메시지 센더 이름 수정
    static _fixMessageSenderName(message, html) {
        if (!message.speaker || !message.speaker.actor) {
            // 유저 색상 적용 (speaker가 없어도)
            this._applyUserColorToSender(message, html);
            return;
        }
        
        const senderElement = this._getSenderElement(html);
        if (!senderElement.length) {
            // 유저 색상 적용 (sender 요소가 없어도)
            this._applyUserColorToSender(message, html);
            return;
        }
        
        // 모듈 플래그에 저장된 센더 이름이 있으면 우선 사용
        const storedAlias = message.flags?.['lichsoma-speaker-selector']?.senderAlias;
        if (storedAlias) {
            senderElement.text(storedAlias);
            // 유저 색상 적용
            this._applyUserColorToSender(message, html);
            return;
        }
        
        const actorId = message.speaker.actor;
        const actor = game.actors.get(actorId);
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
        
        // message.author는 User 객체이므로 직접 사용하거나, author.id를 사용
        let user = null;
        let userColor = null;
        
        // 방법 1: message.author가 User 객체인 경우 직접 사용
        if (message.author && typeof message.author === 'object' && 'color' in message.author) {
            user = message.author;
            userColor = message.author.color;
        }
        // 방법 2: author.id를 사용해서 game.users에서 찾기
        else if (message.author?.id) {
            const userId = typeof message.author.id === 'string' ? message.author.id : message.author.id;
            user = game.users.get(userId);
            userColor = user?.color;
        }
        
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
            const messageElement = $html.closest('.chat-message');
            if (messageElement.length) {
                messageElement.addClass('lichsoma-narrator-card');
            }
            return;
        }
        
        // narrator-card로 감싸기
        const innerContent = messageContent.html();
        if (innerContent && innerContent.trim()) {
            // narrator-card로 감싸기
            messageContent.html(`<div class="narrator-card">${innerContent}</div>`);
            
            // 클래스 추가
            const messageElement = $html.closest('.chat-message');
            if (messageElement.length) {
                messageElement.addClass('lichsoma-narrator-card');
            }
        }
    }

    static _prepareDnd5eSender(html) {
        if (game.system.id !== 'dnd5e' || !html?.length) return;
        const header = html.find('.message-header');
        if (!header.length) return;

        let customSender = header.find('.message-sender[data-lichsoma-sender="true"]');
        if (!customSender.length) {
            const originalSender = header.find('h4.message-sender').first();
            const initialText = originalSender.length ? originalSender.text() : '';
            customSender = $('<h4 class="message-sender" data-lichsoma-sender="true"></h4>');
            if (initialText) {
                customSender.text(initialText);
            }
            header.append(customSender);
        }

        header.find('h4.message-sender').not(customSender).addClass('lichsoma-dnd5e-original-sender');
    }

    static _getSenderElement(html) {
        if (!html) return $();
        const $root = html.jquery ? html : $(html);
        const customSender = $root.find('.message-sender[data-lichsoma-sender="true"]');
        if (customSender.length) return customSender;
        return $root.find('.message-sender').first();
    }

    static async _addPortraitToMessage(message, html, data) {
        // 설정이 꺼져있으면 종료
        if (!game.settings.get('lichsoma-speaker-selector', this.SETTINGS.SHOW_PORTRAIT)) return;
        
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
        const $message = html.closest('.chat-message');
        if (!$message.length) return;

        // notifications 영역이 아닌 일반 채팅에만 추가
        const isInNotifications = $message.closest('#chat-notifications').length > 0;
        if (isInNotifications) return;

        // 기존 삭제 버튼 제거 (중복 방지)
        $message.find('.lichsoma-delete-btn').remove();

        // 권한 체크: 삭제 가능한지 확인
        const canDelete = this._canDeleteMessage(message);
        if (!canDelete) {
            // 권한이 없으면 버튼을 추가하지 않음
            return;
        }

        // 삭제 버튼 생성
        const deleteAriaLabel = game.i18n.localize('SPEAKERSELECTOR.DeleteButton.AriaLabel');
        const deleteTitle = game.i18n.localize('SPEAKERSELECTOR.DeleteButton.Title');
        const $deleteBtn = $(`
            <a class="lichsoma-delete-btn" aria-label="${deleteAriaLabel}" title="${deleteTitle}">
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

        // 메시지에 추가
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
    
    // 공통: 문서/데이터에 스피커 정보와 센더 이름 플래그 저장
    static _applySpeakerData(doc, data, speakerData, extraFlags = {}) {
        doc.updateSource({ speaker: speakerData });
        if (!data.speaker) {
            data.speaker = {};
        }
        Object.assign(data.speaker, speakerData);
        this._applySenderFlagsToDoc(doc, data, speakerData.alias, extraFlags);
    }
    
    static _applySenderFlagsToDoc(doc, data, alias, extraFlags = {}) {
        const moduleFlags = foundry.utils.mergeObject(extraFlags || {}, {}, { inplace: false });
        if (alias) {
            moduleFlags.senderAlias = alias;
        }
        if (!Object.keys(moduleFlags).length) return;
        
        const existingDocFlags = foundry.utils.getProperty(doc, 'flags.lichsoma-speaker-selector') || {};
        const mergedDocFlags = foundry.utils.mergeObject(existingDocFlags, moduleFlags, { inplace: false });
        doc.updateSource({ flags: { 'lichsoma-speaker-selector': mergedDocFlags } });
        
        if (!data.flags) data.flags = {};
        const existingDataFlags = data.flags['lichsoma-speaker-selector'] || {};
        data.flags['lichsoma-speaker-selector'] = Object.assign({}, existingDataFlags, moduleFlags);
    }
    
    // 동기 버전의 이미지 주소 가져오기 (플래그 저장용)
    static _getMessageImageSync(speaker, authorId) {
        const speakerObj = speaker || {};
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
            game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR) &&
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
            const useActorForPortrait = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR)
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

    // 채팅 입력 필드 이벤트 리스너 설정
    static _setupChatInputListener() {
        if (!SpeakerSelector._chatInputDescHotkeyHookRegistered) {
            SpeakerSelector._chatInputDescHotkeyHookRegistered = true;
            Hooks.on('chatInput', SpeakerSelector._onChatInputHookForDescPrefix);
        }

        // 채팅 입력 필드 찾기 및 이벤트 리스너 추가
        const setupListener = () => {
            const chatInput = document.querySelector('#chat-message');
            if (!chatInput) {
                // 입력 필드가 아직 없으면 잠시 후 다시 시도
                setTimeout(setupListener, 500);
                return;
            }

            // 기존 리스너 제거 (중복 방지)
            chatInput.removeEventListener('focus', this._handleChatInputFocus);
            chatInput.removeEventListener('input', this._handleChatInputInput);
            chatInput.removeEventListener('blur', this._handleChatInputBlur);
            chatInput.removeEventListener('keydown', this._handleChatInputKeyDown);

            // 포커스 시 플래그 설정
            chatInput.addEventListener('focus', this._handleChatInputFocus);
            
            // 입력 시에도 플래그 설정 (안전장치)
            chatInput.addEventListener('input', this._handleChatInputInput);
            
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
    static _handleChatInputFocus() {
        SpeakerSelector._fromChatInput = true;
    }
    
    // 채팅 입력 필드 입력 핸들러
    static _handleChatInputInput() {
        SpeakerSelector._fromChatInput = true;
    }
    
    // 채팅 입력 필드 키다운 핸들러
    static _handleChatInputKeyDown(event) {
        // Enter 키를 누르면 메시지 전송 직전이므로 플래그 설정
        if (event.key === 'Enter' && !event.shiftKey) {
            this._fromChatInput = true;
        }
        // ↑ 키를 누르면 이전 메시지를 불러오므로 플래그 설정 (스피커 셀렉터 적용을 위해)
        // Shift+↑ 는 chatInput 훅에서 `/desc ` 삽입으로 처리 (여기서는 히스토리용 플래그 생략)
        if (event.key === 'ArrowUp' && !event.shiftKey) {
            this._fromChatInput = true;
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
        if (!event.target?.closest?.('#chat-message')) return;
        if (!game.settings.get('lichsoma-speaker-selector', SpeakerSelector.SETTINGS.NARRATOR_CHAT_CARD)) return;
        event.preventDefault();
        SpeakerSelector._insertDescSlashPrefixIntoChatInput();
        return false;
    }

    /** 채팅 입력(ProseMirror) 커서 위치에 `/desc ` 삽입 */
    static _insertDescSlashPrefixIntoChatInput() {
        const PREFIX = '/desc ';
        const el = document.querySelector('#chat-message');
        if (!el) return;
        el.focus();
        if (document.execCommand?.('insertText', false, PREFIX)) return;

        const pmRoot = el.querySelector?.('.ProseMirror');
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
        // blur 시 플래그 초기화
        // Enter 키로 메시지를 보내면 keydown 이벤트에서 플래그가 다시 설정되므로 문제없음
        this._fromChatInput = false;
    }

    // 스피커 셀렉터 설정
    static setupSpeakerSelector() {
        // 채팅 로그 렌더링 시 스피커 셀렉터 추가
        Hooks.on('renderChatLog', (app, html, data) => {
            this._renderSpeakerSelector(html);
            
            // 모든 메시지에 유저 색상 적용 및 data-actor-id 추가
            setTimeout(() => {
                const $html = $(html);
                const messages = $html.find('.chat-message');
                messages.each((index, messageElement) => {
                    const $messageElement = $(messageElement);
                    const messageId = $messageElement.attr('data-message-id');
                    if (messageId) {
                        const message = game.messages.get(messageId);
                        if (message) {
                            this._applyUserColorToSender(message, $messageElement);
                            
                            // speaker가 actor라면 헤더에 data-actor-id 추가
                            const $headerElement = $messageElement.find('.message-header');
                            if ($headerElement.length) {
                                const flags = message.flags?.['lichsoma-speaker-selector'] || {};
                                const actorId = flags.actorId || message.speaker?.actor || null;
                                if (actorId) {
                                    $headerElement.attr('data-actor-id', actorId);
                                }
                            }
                        }
                    }
                });
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
                    const chatForm = $('#sidebar .chat-form');
                    const chatControls = chatForm.find('#chat-controls');
                    const chatInput = chatForm.find('.chat-input');
                    
                    if (chatForm.length && (chatControls.length || chatInput.length)) {
                        this._renderSpeakerSelector($(document));
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
                    $('#sidebar .chat-form').find('.lichsoma-speaker-selector').remove();
                } else {
                    this._renderSpeakerSelector($(document));
                }
            }, 100);
        });

        Hooks.on('expandSidebar', () => {
            setTimeout(() => {
                if (!this._isSidebarCollapsed()) {
                    this._renderSpeakerSelector($(document));
                } else {
                    $('#sidebar .chat-form').find('.lichsoma-speaker-selector').remove();
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

        const $root = html?.find ? html : $(html ?? document);

        // 렌더된 앱 루트(사이드바/팝아웃 등)에서 chat-form 우선 탐색
        // - renderSidebarTab에서는 document가 넘어오기도 해서, 그 경우에는 #sidebar를 우선
        let chatForm = ($root[0] === document) ? $('#sidebar .chat-form') : $root.find('.chat-form');
        if (!chatForm.length) chatForm = $('#sidebar .chat-form');
        if (!chatForm.length) chatForm = $('.chat-form');
        chatForm = chatForm.first();

        if (!chatForm.length) {
            this._isRenderingSelector = false;
            return;
        }

        // 채팅 컨트롤에 "이미지 삽입" 버튼 추가 (ProseMirror 툴바 대체)
        try {
            // ProseMirror 상단 메뉴는 기본 숨김
            chatForm.addClass('lichsoma-hide-chat-editor-menu');
            this._renderChatInsertImageButton(chatForm);
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
        
        // notifications에 있는 경우 제외
        if (chatForm.closest('#chat-notifications').length > 0) {
            this._isRenderingSelector = false;
            return;
        }

        // chat-controls와 chat-input 사이에 삽입할 위치 찾기
        const chatControls = chatForm.find('#chat-controls');
        const chatInput = chatForm.find('.chat-input');

        // 스피커 셀렉터 HTML 생성
        const selectorLabel = game.i18n.localize('SPEAKERSELECTOR.Selector.Label');
        const oocLabel = game.i18n.localize('SPEAKERSELECTOR.Selector.OOC');
        const narratorTitle = game.i18n.localize('SPEAKERSELECTOR.Narrator.Button.Title');
        const narratorAriaLabel = game.i18n.localize('SPEAKERSELECTOR.Narrator.Button.AriaLabel');
        
        // 옵션 생성 함수
        const generateOptions = () => {
            // 항상 액터로 말하기 설정 확인
            const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
            // 항상 할당된 캐릭터로 말하기 설정 확인
            const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
            
            // 할당된 캐릭터 ID 가져오기
            const assignedCharacterId = game.user.character instanceof Actor 
                ? game.user.character?.id 
                : game.user.character;
            
            // 설정에 따라 옵션 추가
            let additionalOption = '';
            if (alwaysUseActor || alwaysUseCharacter) {
                // "항상 액터로 말하기" 또는 "항상 할당된 캐릭터로 말하기" 설정이 켜져 있으면 OOC 옵션 추가
                additionalOption = `<option value="ooc">${oocLabel}</option>`;
                
                // 할당된 캐릭터도 추가 (OOC 다음에 표시)
                if (assignedCharacterId) {
                    const character = game.user.character instanceof Actor 
                        ? game.user.character 
                        : game.actors.get(assignedCharacterId);
                    if (character) {
                        // 저장된 감정이 있으면 표시
                        const savedEmotion = ActorEmotions.getSavedEmotion(character.id);
                        const displayName = savedEmotion
                            ? `${character.name}(${savedEmotion.emotionName})`
                            : character.name;
                        additionalOption += `<option value="character">${displayName}</option>`;
                    }
                }
            } else if (assignedCharacterId) {
                // 두 설정이 모두 꺼져 있고 할당된 캐릭터가 있으면 할당된 캐릭터 옵션 추가
                const character = game.user.character instanceof Actor 
                    ? game.user.character 
                    : game.actors.get(assignedCharacterId);
                if (character) {
                    // 저장된 감정이 있으면 표시
                    const savedEmotion = ActorEmotions.getSavedEmotion(character.id);
                    const displayName = savedEmotion
                        ? `${character.name}(${savedEmotion.emotionName})`
                        : character.name;
                    additionalOption = `<option value="character">${displayName}</option>`;
                }
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
                    // 저장된 감정이 있으면 표시
                    const savedEmotion = ActorEmotions.getSavedEmotion(actor.id);
                    const displayName = savedEmotion
                        ? `${actor.name}(${savedEmotion.emotionName})`
                        : actor.name;
                    ownedActorOptions += `<option value="actor:${actor.id}">${displayName}</option>`;
                });
            }
            
            // 등록된 액터 옵션 추가
            let registeredActorOptions = '';
            // 등록된 액터 옵션은 GM에게만 표시
            if (game.user.isGM) {
                this._actorGridActors.forEach(actorId => {
                    const actor = game.actors.get(actorId);
                    if (actor) {
                        // 저장된 감정이 있으면 표시
                        const savedEmotion = ActorEmotions.getSavedEmotion(actorId);
                        const displayName = savedEmotion
                            ? `${actor.name}(${savedEmotion.emotionName})`
                            : actor.name;
                        registeredActorOptions += `<option value="actor:${actorId}">${displayName}</option>`;
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
                <button type="button" class="emotion-btn ui-control icon" title="감정 선택" aria-label="감정 선택">
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
            dropdown.find('option:not(:first)').remove();
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
                ui.notifications.warn("먼저 액터를 선택해주세요.");
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
                this._toggleNarratorMode(selectorHTML);
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
                    // 기존 셀렉터가 있으면 나레이터 버튼 이벤트만 재설정
                    const $existingSelector = $(existingSelector);
                    if (game.user.isGM) {
                        $existingSelector.find('.narrator-btn').off('click').on('click', (e) => {
                            e.preventDefault();
                            this._toggleNarratorMode($existingSelector);
                        });
                        
                        // 나레이터 모드 상태에 따라 버튼 활성화
                        const $existingBtn = $existingSelector.find('.narrator-btn');
                        $existingBtn.attr('aria-pressed', this._narratorModeActive ? 'true' : 'false');
                        
                        // 스피커 드롭다운 옵션 업데이트 (설정 변경 시 OOC/할당된 캐릭터 옵션 표시/숨김)
                        const alwaysUseCharacter = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_CHARACTER);
                        const $dropdown = $existingSelector.find('.speaker-dropdown');
                        const currentValue = $dropdown.val();
                        
                        // 기존 추가 옵션 제거 (OOC 또는 할당된 캐릭터)
                        $dropdown.find('option[value="ooc"], option[value="character"]').remove();
                        
                        // 설정에 따라 옵션 추가
                        if (alwaysUseCharacter) {
                            // 활성화되어 있으면 OOC 옵션 추가
                            const oocLabel = game.i18n.localize('SPEAKERSELECTOR.Selector.OOC');
                            $dropdown.append(`<option value="ooc">${oocLabel}</option>`);
                        } else if (game.user.character) {
                            // 비활성화되어 있고 할당된 캐릭터가 있으면 할당된 캐릭터 옵션 추가
                            const character = game.user.character instanceof Actor 
                                ? game.user.character 
                                : game.actors.get(game.user.character);
                            if (character) {
                                $dropdown.append(`<option value="character">${character.name}</option>`);
                            }
                        }
                        
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
                // chat-input 바로 앞에 삽입
                try {
                    chatInput[0].insertAdjacentElement('beforebegin', selectorHTML[0]);
                    
                    // CSS order 속성 명시적 설정으로 순서 보장
                    const insertedElement = selectorHTML[0];
                    insertedElement.style.order = '2';
                    if (chatControls[0]) chatControls[0].style.order = '0';
                    if (chatInput[0]) chatInput[0].style.order = '3';
                } catch (error) {
                    // chat-input 앞 삽입 실패 시 fallback으로 chat-controls 다음에 삽입
                    chatControls[0].insertAdjacentElement('afterend', selectorHTML[0]);
                    
                    const insertedElement = selectorHTML[0];
                    insertedElement.style.order = '2';
                    if (chatControls[0]) chatControls[0].style.order = '0';
                    if (chatInput[0]) chatInput[0].style.order = '3';
                }
            } else if (chatInput.length) {
                // chat-controls가 없으면 chat-input 앞에 삽입
                chatInput[0].insertAdjacentElement('beforebegin', selectorHTML[0]);
                
                const insertedElement = selectorHTML[0];
                insertedElement.style.order = '2';
                if (chatInput[0]) chatInput[0].style.order = '3';
            } else {
                // 최후 fallback: chat-form 맨 앞에 추가
                chatForm.prepend(selectorHTML);
                
                const insertedElement = selectorHTML[0];
                insertedElement.style.order = '2';
            }
            
        } catch (error) {
            // 스피커 셀렉터 HTML 추가 실패 (무시)
        } finally {
            // 플래그 리셋
            this._isRenderingSelector = false;
        }
    }

    static _renderChatInsertImageButton(chatForm) {
        const $chatForm = chatForm?.find ? chatForm : $(chatForm ?? document);
        // GM은 보통 #chat-controls .control-buttons 를 가지지만,
        // 플레이어 화면은 해당 영역이 없을 수 있어(#chat-controls만 존재) 폴백을 둔다.
        let $controls = $chatForm.find('#chat-controls .control-buttons').first();
        let $controlsRoot = $chatForm.find('#chat-controls').first();

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
        const isControlButtons = $chatForm.find('#chat-controls .control-buttons').first()[0] === $controls[0];
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
        const $chatForm = chatForm?.find ? chatForm : $(chatForm ?? document);

        // 채팅 입력 에디터 루트 탐색 (사이드바/팝아웃 모두 대응)
        const editorRoot =
            $chatForm.find('#chat-message').first()[0] ??
            document.querySelector('#sidebar .chat-form #chat-message') ??
            document.querySelector('.chat-form #chat-message');

        if (!editorRoot) {
            ui?.notifications?.warn?.('채팅 입력창을 찾지 못했습니다.');
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
            ui?.notifications?.warn?.('이미지 삽입 메뉴를 찾지 못했습니다.');
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
        // 나레이터 소켓 리스너 설정
        this._setupNarratorSocket();
        
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
            const chatInput = document.querySelector('#chat-message');
            const chatInputFocused = chatInput && document.activeElement === chatInput;
            const messageContent = typeof data.content === 'string' ? data.content : '';
            const chatInputValue = chatInput?.value || '';
            
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
            }
            
            if (chatInputFocused && plainMessageContent === plainChatInputValue) {
                this._fromChatInput = true;
            }
            
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
                                    speakerData = {
                                        alias: character.name,
                                        scene: game.scenes.active?.id || null,
                                        actor: character.id,
                                        token: null
                                    };
                                    needsSpeakerUpdate = true;
                                }
                            }
                        } else if (token.actor) {
                            speakerData = {
                                alias: token.actor.name,
                                scene: game.scenes.active?.id || null,
                                actor: token.actor.id,
                                token: token.id || null
                            };
                            needsSpeakerUpdate = true;
                        }
                    } else if (game.user.character) {
                        // 토큰도 없으면 할당된 캐릭터 사용
                        const character = game.user.character instanceof Actor 
                            ? game.user.character 
                            : game.actors.get(game.user.character);
                        if (character) {
                            speakerData = {
                                alias: character.name,
                                scene: game.scenes.active?.id || null,
                                actor: character.id,
                                token: null
                            };
                            needsSpeakerUpdate = true;
                        }
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, userId);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId };
                    
                    // speaker를 보완한 경우 실제 메시지에도 적용
                    if (needsSpeakerUpdate) {
                        this._applySpeakerData(doc, data, speakerData, extraFlags);
                    } else {
                        this._applySenderFlagsToDoc(doc, data, null, extraFlags);
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
                        const narratorSpeakerData = {
                            alias: game.user.name,
                            scene: game.scenes.active?.id || null,
                            actor: null,
                            token: null
                        };
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
            
            // "@"로 시작하는 메시지 처리 (OOC로 전환)
            if (plainTextForDesc.startsWith('@')) {
                // "@" 부분 제거
                const oocRemovedText = plainTextForDesc.substring(1).trim();
                
                if (oocRemovedText) {
                    // HTML 태그가 있는 경우 처리
                    let processedContent = content;
                    // HTML에서도 "@" 부분 제거 시도
                    if (content.startsWith('@')) {
                        // HTML 태그를 유지하면서 "@" 부분만 제거
                        processedContent = content.replace(/^@\s*/, '');
                    } else {
                        // HTML이 없으면 순수 텍스트 사용
                        processedContent = oocRemovedText;
                    }
                    
                    data.content = processedContent;
                    if (doc) {
                        doc.updateSource({ content: processedContent });
                    }
                    
                    // OOC로 설정
                    const oocSpeakerData = {
                        alias: game.user.name,
                        scene: game.scenes.active?.id || null,
                        actor: null,
                        token: null
                    };
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(oocSpeakerData, userId);
                    const actorId = oocSpeakerData.actor || null;
                    // @ 처리된 메시지임을 표시하는 플래그 추가
                    const extraFlags = { portraitSrc: portraitData.src, userId, actorId, isAtOOC: true };
                    this._applySpeakerData(doc, data, oocSpeakerData, extraFlags);
                    return; // "@" 처리 완료
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
                    if (game.socket) {
                        game.socket.emit('module.lichsoma-speaker-selector', {
                            type: 'narratorTyping',
                            text: plainText,
                            userId: game.user.id
                        });
                    }
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
                
                const narratorSpeakerData = {
                    alias: game.user.name,
                    scene: game.scenes.active?.id || null,
                    actor: null,
                    token: null
                };
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
                const oocSpeakerData = {
                    alias: game.user.name,
                    scene: game.scenes.active?.id || null,
                    actor: null,
                    token: null
                };
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
                    const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                    
                    // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                    const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                    const token = tokens.length > 0 ? tokens[0] : null;
                    
                    const characterSpeakerData = {
                        alias: character.name,
                        scene: game.scenes.active?.id || null,
                        actor: character.id,
                        token: alwaysUseActor ? null : (token?.id || null)
                    };
                    // 감정 포트레잇이 선택된 경우 플래그에 저장
                    const updateData = { speaker: characterSpeakerData };
                    ActorEmotions.addEmotionFlagsToMessage(updateData);
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(characterSpeakerData, userId);
                    const actorId = characterSpeakerData.actor || null;
                    const extraFlags = foundry.utils.mergeObject(
                        updateData.flags?.['lichsoma-speaker-selector'] || {},
                        { portraitSrc: portraitData.src, userId, actorId },
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
                    
                    const actorSpeakerData = {
                        alias: actor.name,
                        scene: game.scenes.active?.id || null,
                        actor: actor.id,
                        token: null
                    };
                    
                    // 감정 포트레잇이 선택된 경우 플래그에 저장
                    const updateData = { speaker: actorSpeakerData };
                    ActorEmotions.addEmotionFlagsToMessage(updateData);
                    
                    // 이미지 주소 계산 및 플래그에 저장
                    const portraitData = this._getMessageImageSync(actorSpeakerData, userId);
                    const actorId = actorSpeakerData.actor || null;
                    const extraFlags = foundry.utils.mergeObject(
                        updateData.flags?.['lichsoma-speaker-selector'] || {},
                        { portraitSrc: portraitData.src, userId, actorId },
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
                const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
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
                            speakerData = {
                                alias: character.name,
                                scene: game.scenes.active?.id || null,
                                actor: character.id,
                                token: null
                            };
                        }
                    } else {
                        // 할당된 캐릭터가 없으면 OOC로 설정
                        speakerData = {
                            alias: game.user.name,
                            scene: game.scenes.active?.id || null,
                            actor: null,
                            token: null
                        };
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
                        speakerData = {
                            alias: token.actor.name,
                            scene: game.scenes.active?.id || null,
                            actor: token.actor.id,
                            token: null
                        };
                    } else {
                        // 기본 동작: 토큰으로 말하기
                        speakerData = {
                            alias: token.actor?.name || token.name,
                            scene: game.scenes.active?.id || null,
                            actor: token.actor?.id || null,
                            token: token.id || null
                        };
                    }
                } else if (speakerData && alwaysUseActor && speakerData.token) {
                    // 이미 speakerData가 있지만 토큰이 설정되어 있고, 설정이 활성화되어 있으면 액터로 변경
                    const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                    if (tokenFromSpeaker && tokenFromSpeaker.actor) {
                        speakerData = {
                            alias: tokenFromSpeaker.actor.name,
                            scene: speakerData.scene || game.scenes.active?.id || null,
                            actor: tokenFromSpeaker.actor.id,
                            token: null
                        };
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
                const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                
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
                        const speakerData = {
                            alias: character.name,
                            scene: game.scenes.active?.id || null,
                            actor: character.id,
                            token: alwaysUseActor ? null : (token?.id || null)  // "항상 액터로 말하기"가 켜져있으면 토큰을 null로 설정
                        };
                        
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
                    const oocSpeakerData = {
                        alias: game.user.name,
                        scene: game.scenes.active?.id || null,
                        actor: null,
                        token: null
                    };
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
            
            // 채팅 입력 필드가 포커스되어 있고, 입력 필드의 값이 메시지 내용과 일치하면 _fromChatInput을 true로 설정
            // (↑ 키로 이전 메시지 불러올 때 대응)
            const chatInput = document.querySelector('#chat-message');
            const chatInputFocused = chatInput && document.activeElement === chatInput;
            const messageContent = typeof message.content === 'string' ? message.content : '';
            const chatInputValue = chatInput?.value || '';
            
            // HTML 태그 제거하여 순수 텍스트만 비교
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = messageContent;
            const plainMessageContent = (tempDiv.textContent || tempDiv.innerText || '').trim();
            const plainChatInputValue = chatInputValue.trim();
            
            if (chatInputFocused && plainMessageContent === plainChatInputValue) {
                this._fromChatInput = true;
            }
            
            // 채팅 인풋으로 직접 입력한 메시지가 아니면 플래그만 저장하고 나머지는 무시
            // (액터 시트 등에서 생성한 메시지는 나레이터 모드나 할당된 캐릭터 설정을 적용하지 않음)
            if (!this._fromChatInput) {
                // 플래그에 이미지 주소 저장 (머지 기능을 위해 필요)
                let speakerData = message.speaker;
                if (speakerData && speakerData.token && message.author?.id === game.user.id) {
                    // speaker가 이미 있지만 token이 설정된 경우: "항상 액터로 말하기" 적용
                    const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                    if (alwaysUseActor) {
                        const tokenFromSpeaker = canvas.tokens?.placeables?.find(t => t.id === speakerData.token);
                        if (tokenFromSpeaker?.actor) {
                            speakerData = {
                                alias: tokenFromSpeaker.actor.name,
                                scene: speakerData.scene || game.scenes.active?.id || null,
                                actor: tokenFromSpeaker.actor.id,
                                token: null
                            };
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
                        const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
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
                                    speakerData = {
                                        alias: character.name,
                                        scene: game.scenes.active?.id || null,
                                        actor: character.id,
                                        token: null
                                    };
                                }
                            }
                        } else if (alwaysUseActor && token.actor) {
                            // 설정이 활성화되어 있으면 액터로 말하기 (token: null)
                            speakerData = {
                                alias: token.actor.name,
                                scene: game.scenes.active?.id || null,
                                actor: token.actor.id,
                                token: null
                            };
                        } else {
                            // 기본 동작: 토큰으로 말하기
                            speakerData = {
                                alias: token.actor?.name || token.name,
                                scene: game.scenes.active?.id || null,
                                actor: token.actor?.id || null,
                                token: token.id || null
                            };
                        }
                    } else {
                        // 토큰도 없으면 "항상 액터로 말하기" 또는 할당된 캐릭터 사용
                        const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                        
                        if (alwaysUseActor && game.user.character) {
                            // "항상 액터로 말하기" 설정이 켜져 있고 할당된 캐릭터가 있으면 액터로 말하기
                            const character = game.user.character instanceof Actor 
                                ? game.user.character 
                                : game.actors.get(game.user.character);
                            if (character) {
                                speakerData = {
                                    alias: character.name,
                                    scene: game.scenes.active?.id || null,
                                    actor: character.id,
                                    token: null
                                };
                            }
                        } else if (game.user.character) {
                            // 할당된 캐릭터 사용
                            const character = game.user.character instanceof Actor 
                                ? game.user.character 
                                : game.actors.get(game.user.character);
                            if (character) {
                                speakerData = {
                                    alias: character.name,
                                    scene: game.scenes.active?.id || null,
                                    actor: character.id,
                                    token: null
                                };
                            }
                        }
                    }
                }
                
                if (speakerData) {
                    const portraitData = this._getMessageImageSync(speakerData, message.author?.id);
                    const actorId = speakerData.actor || null;
                    const extraFlags = { portraitSrc: portraitData.src, userId: message.author?.id, actorId };
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
                const narratorSpeaker = {
                    alias: game.user.name,
                    scene: game.scenes.active?.id || null,
                    actor: null,
                    token: null
                };
                
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
                const oocSpeaker = {
                    alias: game.user.name,
                    scene: game.scenes.active?.id || null,
                    actor: null,
                    token: null
                };
                
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
                const oocSpeaker = {
                    alias: game.user.name,
                    scene: game.scenes.active?.id || null,
                    actor: null,
                    token: null
                };
                
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
                    const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                    
                    // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                    const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                    const token = tokens.length > 0 ? tokens[0] : null;
                    
                    const expectedSpeaker = {
                        alias: character.name,
                        scene: game.scenes.active?.id || null,
                        actor: character.id,
                        token: alwaysUseActor ? null : (token?.id || null)
                    };
                    
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
                    
                    const expectedSpeaker = {
                        alias: actor.name,
                        scene: game.scenes.active?.id || null,
                        actor: actor.id,
                        token: null
                    };
                    
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
                const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
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
                            const expectedSpeaker = {
                                alias: character.name,
                                scene: message.speaker.scene || game.scenes.active?.id || null,
                                actor: character.id,
                                token: null
                            };
                            
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
                        const expectedSpeaker = {
                            alias: token.actor.name,
                            scene: message.speaker.scene || game.scenes.active?.id || null,
                            actor: token.actor.id,
                            token: null
                        };
                        
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
                const alwaysUseActor = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.ALWAYS_USE_ACTOR);
                
                if (alwaysUseCharacter && game.user.character) {
                    const character = game.user.character instanceof Actor 
                        ? game.user.character 
                        : game.actors.get(game.user.character);
                    
                    if (character) {
                        // 할당된 캐릭터의 첫 번째 토큰 찾기 (현재 씬에 있으면)
                        const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === character.id) || [];
                        const token = tokens.length > 0 ? tokens[0] : null;
                        
                        // 메시지의 스피커가 올바르게 설정되었는지 확인
                        const expectedSpeaker = {
                            alias: character.name,
                            scene: game.scenes.active?.id || null,
                            actor: character.id,
                            token: alwaysUseActor ? null : (token?.id || null)  // "항상 액터로 말하기"가 켜져있으면 토큰을 null로 설정
                        };
                        
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
                    const oocSpeaker = {
                        alias: game.user.name,
                        scene: game.scenes.active?.id || null,
                        actor: null,
                        token: null
                    };
                    
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
    
    // 나레이터 모드 토글
    static async _toggleNarratorMode(selector) {
        this._narratorModeActive = !this._narratorModeActive;
        
        // 버튼 상태 업데이트
        const $btn = selector.find('.narrator-btn');
        if (this._narratorModeActive) {
            $btn.attr('aria-pressed', 'true');
        } else {
            $btn.attr('aria-pressed', 'false');
        }
        
        // 유저 플래그에 상태 저장 (새로고침 시 복원용)
        try {
            await game.user.setFlag('lichsoma-speaker-selector', 'narratorModeActive', this._narratorModeActive);
        } catch (e) {
        }
        
        // 소켓으로 모든 클라이언트에 상태 전송
        if (game.socket) {
            game.socket.emit('module.lichsoma-speaker-selector', {
                type: 'narratorMode',
                active: this._narratorModeActive,
                userId: game.user.id
            });
        }
        
        // 로컬에서 나레이터 라인 표시/숨김
        this._updateNarratorLine(this._narratorModeActive);
        
    }
    
    // 나레이터 라인 업데이트
    static _updateNarratorLine(active, text = '') {
        if (active) {
            // 나레이터 라인이 없으면 생성
            if (!this._narratorLineElement) {
                this._createNarratorLine();
            }
            // 텍스트 업데이트
            if (this._narratorTextElement) {
                this._narratorTextElement.textContent = text;
            }
        } else {
            // 나레이터 라인 페이드아웃 후 제거
            if (this._narratorLineElement) {
                this._narratorLineElement.style.opacity = '0';
                setTimeout(() => {
                    if (this._narratorLineElement) {
                        this._narratorLineElement.remove();
                        this._narratorLineElement = null;
                        this._narratorTextElement = null;
                    }
                }, 500);
            }
        }
    }
    
    // 나레이터 라인 생성
    static _createNarratorLine() {
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
        
        // 페이드인 효과
        setTimeout(() => {
            if (this._narratorLineElement) {
                this._narratorLineElement.style.opacity = '1';
            }
        }, 10);
        
    }
    
    // 나레이터 소켓 설정
    static _setupNarratorSocket() {
        if (!game.socket) return;
        
        game.socket.on('module.lichsoma-speaker-selector', (data) => {
            if (data.type === 'narratorMode') {
                // GM이 보낸 나레이터 모드 상태 업데이트
                if (data.userId && game.users.get(data.userId)?.isGM) {
                    this._updateNarratorLine(data.active, data.text || '');
                }
            } else if (data.type === 'narratorTyping') {
                // GM이 보낸 나레이터 타이핑 효과
                if (data.userId && game.users.get(data.userId)?.isGM) {
                    this._startNarratorTyping(data.text || '');
                }
            } else if (data.type === 'narratorTypingSound') {
                // GM이 보낸 나레이터 타이핑 사운드 재생 (자신이 보낸 이벤트는 제외)
                if (data.userId && game.users.get(data.userId)?.isGM && data.userId !== game.user.id) {
                    this._playNarratorTypingSound();
                }
            }
        });
    }
    
    // 나레이터 타이핑 효과 시작
    static _startNarratorTyping(text) {
        // 기존 타이핑 중지
        if (this._narratorTypingInterval) {
            clearInterval(this._narratorTypingInterval);
        }
        
        // 나레이터 라인이 없으면 생성
        if (!this._narratorLineElement) {
            this._createNarratorLine();
        }
        
        // 루비 문자 처리
        const rubyPattern = /\[\[([^\|\]]+?)\|([^\]]+?)\]\]/g;
        const processedText = text.replace(rubyPattern, '<ruby class="lichsoma-ruby">$1<rt>$2</rt></ruby>');
        
        // 텍스트 콘텐츠만 추출 (HTML 태그 제외) - 타이핑 길이 계산용
        // 루비 처리된 HTML에서 텍스트만 추출하면 루비 패턴의 기호([[|]])는 이미 제거됨
        // 단, 루비 주석(<rt>...</rt>)은 타이핑 소리에 포함되지 않아야 하므로 제외
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedText;
        
        // 루비 주석 제거 (rt 태그 제거)
        const rtElements = tempDiv.querySelectorAll('rt');
        rtElements.forEach(rt => rt.remove());
        
        // 루비 주석을 제거한 후 텍스트 추출
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        
        // 타이핑 속도 및 지속 시간 설정
        const typingSpeed = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_TYPING_SPEED) || 100; // ms
        const duration = 3; // seconds
        
        let currentIndex = 0;
        this._narratorTextElement.innerHTML = '';
        this._narratorTextElement.style.opacity = '1';
        
        // 타이핑 효과: 한 글자씩 표시 (루비 처리된 HTML 사용)
        this._narratorTypingInterval = setInterval(() => {
            if (currentIndex < plainText.length) {
                const currentChar = plainText[currentIndex];
                
                // 원본 텍스트에서 루비 패턴을 찾아서 현재 인덱스만큼만 처리
                // currentIndex는 plainText 기준이므로, 루비 패턴의 기호는 이미 제외됨
                const displayHTML = this._processRubyForNarrator(text, currentIndex + 1);
                this._narratorTextElement.innerHTML = displayHTML;
                
                // 공백이 아닌 문자일 때만 사운드 재생
                // plainText는 루비 패턴의 기호([[|]])가 제거된 순수 텍스트이므로
                // currentChar는 실제 표시되는 문자만 포함함
                if (currentChar && currentChar.trim() !== '') {
                    // 로컬에서 사운드 재생
                    this._playNarratorTypingSound();
                    
                    // 소켓으로 모든 클라이언트에 사운드 재생 전송
                    if (game.socket) {
                        game.socket.emit('module.lichsoma-speaker-selector', {
                            type: 'narratorTypingSound',
                            userId: game.user.id
                        });
                    }
                }
                
                currentIndex++;
            } else {
                // 타이핑 완료 - 전체 루비 처리된 HTML 표시
                const fullProcessedHTML = this._processRubyForNarrator(text, text.length);
                this._narratorTextElement.innerHTML = fullProcessedHTML;
                
                // 타이핑 완료
                clearInterval(this._narratorTypingInterval);
                this._narratorTypingInterval = null;
                
                // 설정된 시간만큼 대기 후 사라짐
                setTimeout(() => {
                    this._stopNarratorTyping();
                }, duration * 1000);
            }
        }, typingSpeed);
    }
    
    // HTML 이스케이프 헬퍼 함수
    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 나레이터 바용 루비 처리 함수 (지정된 길이만큼만 처리)
    static _processRubyForNarrator(text, maxLength) {
        if (!text) return '';
        
        let result = '';
        let pos = 0;
        let remainingLength = maxLength; // 실제 표시할 텍스트 길이 (루비 패턴 기호 제외)
        
        while (pos < text.length && remainingLength > 0) {
            const nextRuby = text.substring(pos).search(/\[\[/);
            if (nextRuby === -1) {
                // 루비 패턴이 더 이상 없음
                const plainPart = text.substring(pos, pos + remainingLength);
                result += this._escapeHtml(plainPart);
                break;
            }
            
            // 루비 패턴 이전의 일반 텍스트
            if (nextRuby > 0) {
                const plainPart = text.substring(pos, pos + Math.min(nextRuby, remainingLength));
                result += this._escapeHtml(plainPart);
                remainingLength -= plainPart.length;
                if (remainingLength <= 0) break;
                pos += nextRuby;
            }
            
            // 루비 패턴 찾기
            const rubyMatch = text.substring(pos).match(/^\[\[([^\|\]]+?)\|([^\]]+?)\]\]/);
            if (rubyMatch) {
                const rubyText = rubyMatch[1]; // 루비 본문만 (기호 제외)
                // 루비 패턴의 기호들([[|]])은 카운트하지 않고 건너뜀
                if (rubyText.length <= remainingLength) {
                    // 전체 루비 표시
                    result += `<ruby class="lichsoma-ruby">${this._escapeHtml(rubyText)}<rt>${this._escapeHtml(rubyMatch[2])}</rt></ruby>`;
                    remainingLength -= rubyText.length; // 본문 길이만 감소
                    pos += rubyMatch[0].length; // 전체 패턴([[본문|루비]]) 건너뛰기
                } else {
                    // 일부만 표시
                    const partial = rubyText.substring(0, remainingLength);
                    result += `<ruby class="lichsoma-ruby">${this._escapeHtml(partial)}<rt>${this._escapeHtml(rubyMatch[2])}</rt></ruby>`;
                    break;
                }
            } else {
                // 루비 패턴이 아님, 일반 문자
                result += this._escapeHtml(text[pos]);
                remainingLength--;
                pos++;
            }
        }
        
        return result;
    }
    
    // 나레이터 타이핑 효과 중지
    static _stopNarratorTyping() {
        if (this._narratorTypingInterval) {
            clearInterval(this._narratorTypingInterval);
            this._narratorTypingInterval = null;
        }
        // 텍스트 페이드아웃
        if (this._narratorTextElement) {
            this._narratorTextElement.style.opacity = '0';
            setTimeout(() => {
                if (this._narratorTextElement) {
                    this._narratorTextElement.textContent = '';
                    this._narratorTextElement.style.opacity = '1'; // 다음 타이핑을 위해 복원
                }
            }, 500);
        }
    }
    
    // 나레이터 폰트 적용
    static _applyNarratorFont() {
        if (!this._narratorTextElement) return;
        
        try {
            const narratorFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT)
            );
            const narratorFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT_SIZE);
            const narratorFontWeight = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_FONT_WEIGHT);
            const narratorItalic = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.NARRATOR_ITALIC);
            
            const styles = [];
            
            if (narratorFont) {
                styles.push(`font-family: "${narratorFont}", sans-serif`);
            } else {
                styles.push(`font-family: sans-serif`);
            }
            
            if (narratorFontSize) {
                styles.push(`font-size: ${narratorFontSize}px`);
            } else {
                styles.push(`font-size: 18px`);
            }
            
            if (narratorFontWeight) {
                styles.push(`font-weight: ${narratorFontWeight}`);
            } else {
                styles.push(`font-weight: bold`);
            }
            
            if (narratorItalic) {
                styles.push(`font-style: italic`);
            } else {
                styles.push(`font-style: normal`);
            }
            
            // 기존 스타일 유지하면서 폰트 관련 스타일만 업데이트
            const existingStyle = this._narratorTextElement.style.cssText;
            const fontStyles = styles.join('; ');
            
            // 기존 스타일에서 폰트 관련 부분 제거하고 새로 추가
            const updatedStyle = existingStyle
                .replace(/font-family:[^;]*;?/g, '')
                .replace(/font-size:[^;]*;?/g, '')
                .replace(/font-weight:[^;]*;?/g, '')
                .replace(/font-style:[^;]*;?/g, '')
                .replace(/;;+/g, ';')
                .replace(/^;|;$/g, '');
            
            this._narratorTextElement.style.cssText = updatedStyle + (updatedStyle ? '; ' : '') + fontStyles;
        } catch (e) {
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
                    }, false); // 로컬에서만 재생 (소켓을 통해 다른 클라이언트에 전파)
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

// 선택한 스피커 (ooc, 빈 문자열 등)
SpeakerSelector._selectedSpeaker = '';

// 나레이터 모드 상태 관리
SpeakerSelector._narratorModeActive = false;
SpeakerSelector._narratorLineElement = null;
SpeakerSelector._narratorTextElement = null;
SpeakerSelector._narratorTypingInterval = null;

// 액터 격자 관리
SpeakerSelector._actorGridActors = [];
SpeakerSelector._actorGridWindow = null;
SpeakerSelector._actorGridApp = null;
SpeakerSelector._actorGridRows = 5; // 기본 행 수 (4x5 = 20칸)
SpeakerSelector._actorGridCols = 4; // 열 수
SpeakerSelector._folderStates = new Map(); // 폴더 열림/닫힘 상태 관리

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

SpeakerSelector._getFolderPath = function(folder) {
    if (!folder) return '';
    
    const pathParts = [];
    let currentFolder = folder;
    const processedIds = new Set();
    
    while (currentFolder && !processedIds.has(currentFolder.id)) {
        processedIds.add(currentFolder.id);
        pathParts.unshift(currentFolder.name);
        
        let parentId = null;
        try {
            if (currentFolder.folder && currentFolder.folder.id && currentFolder.folder.id !== currentFolder.id) {
                parentId = currentFolder.folder.id;
            } else if (currentFolder.document && currentFolder.document.parent) {
                parentId = currentFolder.document.parent;
            } else if (currentFolder.data && currentFolder.data.parent) {
                parentId = currentFolder.data.parent;
            } else if (currentFolder.parent) {
                parentId = currentFolder.parent;
            }
        } catch (e) {
            // getFolderPath - 폴더 부모 찾기 실패 (무시)
        }
        
        if (parentId) {
            currentFolder = game.folders.get(parentId);
        } else {
            currentFolder = null;
        }
    }
    
    return pathParts.join(' / ');
};

SpeakerSelector._groupActorsByFolder = function(actors) {
    const folderMap = new Map();
    const noFolderActors = [];
    const allRelevantFolderIds = new Set();
    
    // 1단계: 액터가 직접 속한 폴더들 수집
    actors.forEach(actor => {
        const folder = actor.folder;
        if (folder) {
            allRelevantFolderIds.add(folder.id);
        } else {
            noFolderActors.push(actor);
        }
    });
    
    // 2단계: 모든 관련 폴더들 수집 (액터가 속한 폴더 + 모든 상위 폴더들)
    const processedIds = new Set();
    const toProcess = new Set(allRelevantFolderIds);
    
    while (toProcess.size > 0) {
        const currentBatch = Array.from(toProcess);
        toProcess.clear();
        
        for (const folderId of currentBatch) {
            if (processedIds.has(folderId)) continue;
            
            const folder = game.folders.get(folderId);
            if (!folder) continue;
            
            processedIds.add(folderId);
            allRelevantFolderIds.add(folderId);
            
            // 부모 폴더도 추가
            let parentId = null;
            try {
                if (folder.folder && folder.folder.id && folder.folder.id !== folderId) {
                    parentId = folder.folder.id;
                } else if (folder.document && folder.document.parent) {
                    parentId = folder.document.parent;
                } else if (folder.data && folder.data.parent) {
                    parentId = folder.data.parent;
                } else if (folder.parent) {
                    parentId = folder.parent;
                }
                
                if (parentId && !processedIds.has(parentId)) {
                    toProcess.add(parentId);
                }
            } catch (e) {
                // 폴더 부모 찾기 실패 (무시)
            }
        }
    }
    
    // 3단계: folderMap 구성
    allRelevantFolderIds.forEach(folderId => {
        const folder = game.folders.get(folderId);
        if (folder) {
            folderMap.set(folderId, {
                folder: folder,
                folderPath: this._getFolderPath(folder),
                directActors: [],
                subFolders: new Set()
            });
        }
    });
    
    // 4단계: 액터들을 해당 폴더에 배치
    actors.forEach(actor => {
        const folder = actor.folder;
        if (folder && folderMap.has(folder.id)) {
            folderMap.get(folder.id).directActors.push(actor);
        }
    });
    
    // 5단계: 부모-자식 관계 설정
    let allFolders = [];
    try {
        if (game.folders.contents && Array.isArray(game.folders.contents)) {
            allFolders = game.folders.contents;
        } else if (game.folders.filter && typeof game.folders.filter === 'function') {
            allFolders = game.folders.filter(() => true);
        } else if (game.folders.values && typeof game.folders.values === 'function') {
            allFolders = Array.from(game.folders.values());
        } else {
            allFolders = Object.values(game.folders);
        }
    } catch (e) {
        // 폴더 접근 실패 (무시)
    }
    
    for (const folder of allFolders) {
        if (!folderMap.has(folder.id)) continue;
        
        let parentId = null;
        try {
            if (folder.folder && folder.folder.id && folder.folder.id !== folder.id) {
                parentId = folder.folder.id;
            } else if (folder.document && folder.document.parent) {
                parentId = folder.document.parent;
            } else if (folder.data && folder.data.parent) {
                parentId = folder.data.parent;
            } else if (folder.parent) {
                parentId = folder.parent;
            }
        } catch (e) {
            // 폴더 부모 찾기 실패 (무시)
        }
        
        if (parentId && folderMap.has(parentId)) {
            folderMap.get(parentId).subFolders.add(folder.id);
        }
    }
    
    return { folderMap, noFolderActors };
};

SpeakerSelector._renderFolderRecursive = function(folderId, folderMap, level = 0) {
    const folderData = folderMap.get(folderId);
    if (!folderData) {
        return '';
    }
    
    // 저장된 폴더 상태 확인 (기본값: 열림)
    const isExpanded = this._folderStates.has(folderId) ? this._folderStates.get(folderId) : true;
    const folderIcon = isExpanded ? 'fa-folder-open' : 'fa-folder';
    
    let html = '';
    
    // 현재 폴더 렌더링
    html += `
        <div class="lichsoma-folder-section" style="margin-left: ${level}px;">
            <div class="lichsoma-folder-header" title="${folderData.folderPath}" data-folder-id="${folderId}">
                <i class="fas ${folderIcon}"></i>
                <span>${folderData.folder.name}</span>
                <span class="lichsoma-folder-count">(${folderData.directActors.length})</span>
            </div>
            <div class="lichsoma-folder-actors" style="display: ${isExpanded ? 'block' : 'none'}">
    `;
    
    // 직접적인 액터들 렌더링
    folderData.directActors.sort((a, b) => a.name.localeCompare(b.name));
    folderData.directActors.forEach(actor => {
        const inGrid = this._actorGridActors.includes(actor.id);
        html += `
            <div class="lichsoma-available-actor${inGrid ? ' lichsoma-available-actor-in-grid' : ''}" data-actor-id="${actor.id}" draggable="${inGrid ? 'false' : 'true'}">
                <img src="${actor.img}" alt="${actor.name}" draggable="false">
                <span>${actor.name}</span>
            </div>
        `;
    });
    
    // 하위 폴더들 렌더링 (재귀적으로)
    Array.from(folderData.subFolders).forEach(subFolderId => {
        const subFolderData = folderMap.get(subFolderId);
        if (subFolderData) {
            html += this._renderFolderRecursive(subFolderId, folderMap, level + 1);
        }
    });
    
    html += `
            </div>
        </div>
    `;
    
    return html;
};

SpeakerSelector._createAvailableActorsContent = function(searchTerm = '') {
    // 그리드에 올린 액터도 목록에 유지(반투명만 동기화) — 전체 재렌더 시 스크롤이 튀지 않도록
    let filteredActors = game.actors.filter(actor => {
        return game.user.isGM ||
               actor.isOwner ||
               actor.testUserPermission(game.user, 'OWNER') ||
               actor.testUserPermission(game.user, 'LIMITED') ||
               actor.testUserPermission(game.user, 'OBSERVER');
    });
    
    // lichsoma-taskbar 모듈 활성화 여부 확인
    const hasTaskbarModule = game.modules.get('lichsoma-taskbar')?.active || false;
    
    // 검색어로 필터링 (이름 또는 태그)
    if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        filteredActors = filteredActors.filter(actor => {
            // 이름으로 검색
            if (actor.name.toLowerCase().includes(searchLower)) return true;
            
            // lichsoma-taskbar 플래그 태그로 검색
            if (hasTaskbarModule) {
                const taskbarTags = actor.getFlag('lichsoma-taskbar', 'tags') || [];
                if (Array.isArray(taskbarTags) && taskbarTags.length > 0) {
                    const hasTaskbarTag = taskbarTags.some(tag => {
                        const tagName = typeof tag === 'string' ? tag : String(tag);
                        return tagName.toLowerCase().includes(searchLower);
                    });
                    if (hasTaskbarTag) return true;
                }
            }
            
            return false;
        });
    }
    
    // 중첩 폴더를 지원하는 그룹화
    const { folderMap, noFolderActors } = this._groupActorsByFolder(filteredActors);
    
    // 플레이스홀더 결정
    const placeholder = hasTaskbarModule 
        ? game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholderWithTags')
        : game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.SearchPlaceholder');
    
    let actorsHTML = '<div class="lichsoma-available-actors">';
    actorsHTML += `
        <h3 style="font-size: 12pt; font-weight: bold; margin: 0 0 8px 0;">${game.i18n.localize('SPEAKERSELECTOR.SpeakerSetting.Dialog.AvailableActors')}</h3>
    `;
    actorsHTML += `
        <div style="margin-bottom: 8px;">
            <input type="text" class="lichsoma-actor-search" placeholder="${placeholder}" value="${searchTerm}" />
        </div>
    `;
    
    // 루트 폴더들만 찾기 (부모가 folderMap에 없는 폴더들)
    const rootFolders = Array.from(folderMap.entries())
        .filter(([folderId, folderData]) => {
            let parentId = null;
            try {
                if (folderData.folder.folder && folderData.folder.folder.id && folderData.folder.folder.id !== folderId) {
                    parentId = folderData.folder.folder.id;
                } else if (folderData.folder.document && folderData.folder.document.parent) {
                    parentId = folderData.folder.document.parent;
                } else if (folderData.folder.data && folderData.folder.data.parent) {
                    parentId = folderData.folder.data.parent;
                } else if (folderData.folder.parent) {
                    parentId = folderData.folder.parent;
                }
            } catch (e) {
                // 루트 폴더 찾기 실패 (무시)
            }
            
            return !parentId || !folderMap.has(parentId);
        })
        .map(([folderId, folderData]) => ({ folderId, folderData }))
        .sort((a, b) => a.folderData.folder.name.localeCompare(b.folderData.folder.name));
    
    // 루트 폴더들부터 재귀적으로 렌더링
    rootFolders.forEach(({ folderId }) => {
        actorsHTML += this._renderFolderRecursive(folderId, folderMap);
    });
    
    // 폴더가 없는 액터들 렌더링
    if (noFolderActors.length > 0) {
        noFolderActors.sort((a, b) => a.name.localeCompare(b.name));
        
        actorsHTML += `
            <div class="lichsoma-folder-section">
                <div class="lichsoma-folder-header">
                    <i class="fas fa-question-circle"></i>
                    <span>폴더 없음</span>
                    <span class="lichsoma-folder-count">(${noFolderActors.length})</span>
                </div>
                <div class="lichsoma-folder-actors">
        `;
        
        noFolderActors.forEach(actor => {
            const inGrid = this._actorGridActors.includes(actor.id);
            actorsHTML += `
                <div class="lichsoma-available-actor${inGrid ? ' lichsoma-available-actor-in-grid' : ''}" data-actor-id="${actor.id}" draggable="${inGrid ? 'false' : 'true'}">
                    <img src="${actor.img}" alt="${actor.name}" draggable="false">
                    <span>${actor.name}</span>
                </div>
            `;
        });
        
        actorsHTML += `
                </div>
            </div>
        `;
    }
    
    actorsHTML += '</div>';
    
    return actorsHTML;
};

/**
 * 메시지 센더 수정 다이얼로그용 — 폴더 트리 (선택 행, 드래그 없음)
 */
SpeakerSelector._renderFolderRecursivePicker = function (folderId, folderMap, level, selectedActorId, folderStates) {
    const folderData = folderMap.get(folderId);
    if (!folderData) {
        return '';
    }

    const isExpanded = folderStates.has(folderId) ? folderStates.get(folderId) : true;
    const folderIcon = isExpanded ? 'fa-folder-open' : 'fa-folder';

    let html = '';

    html += `
        <div class="lichsoma-folder-section" style="margin-left: ${level}px;">
            <div class="lichsoma-folder-header" title="${folderData.folderPath}" data-folder-id="${folderId}">
                <i class="fas ${folderIcon}"></i>
                <span>${foundry.utils.escapeHTML(folderData.folder.name)}</span>
                <span class="lichsoma-folder-count">(${folderData.directActors.length})</span>
            </div>
            <div class="lichsoma-folder-actors" style="display: ${isExpanded ? 'block' : 'none'}">
    `;

    folderData.directActors.sort((a, b) => a.name.localeCompare(b.name));
    folderData.directActors.forEach((actor) => {
        const sel = actor.id === selectedActorId ? ' selected' : '';
        const name = foundry.utils.escapeHTML(actor.name);
        html += `
                <div class="lichsoma-available-actor lichsoma-sender-edit-actor-pick${sel}" data-actor-id="${actor.id}" draggable="false">
                    <img src="${actor.img}" alt="${name}" draggable="false">
                    <span>${name}</span>
                </div>
            `;
    });

    Array.from(folderData.subFolders).forEach((subFolderId) => {
        const subFolderData = folderMap.get(subFolderId);
        if (subFolderData) {
            html += this._renderFolderRecursivePicker(subFolderId, folderMap, level + 1, selectedActorId, folderStates);
        }
    });

    html += `
            </div>
        </div>
    `;

    return html;
};

/**
 * 메시지 센더 수정 — 스피커 설정과 동일한 필터·폴더·태그 검색으로 액터 목록 HTML 생성 (본문만)
 */
SpeakerSelector._createActorPickerListBodyHTML = function (searchTerm = '', selectedActorId = '', folderStates = new Map()) {
    let filteredActors = game.actors.filter((actor) => {
        return (
            game.user.isGM ||
            actor.isOwner ||
            actor.testUserPermission(game.user, 'OWNER') ||
            actor.testUserPermission(game.user, 'LIMITED') ||
            actor.testUserPermission(game.user, 'OBSERVER')
        );
    });

    const hasTaskbarModule = game.modules.get('lichsoma-taskbar')?.active || false;

    if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        filteredActors = filteredActors.filter((actor) => {
            if (actor.name.toLowerCase().includes(searchLower)) return true;

            if (hasTaskbarModule) {
                const taskbarTags = actor.getFlag('lichsoma-taskbar', 'tags') || [];
                if (Array.isArray(taskbarTags) && taskbarTags.length > 0) {
                    const hasTaskbarTag = taskbarTags.some((tag) => {
                        const tagName = typeof tag === 'string' ? tag : String(tag);
                        return tagName.toLowerCase().includes(searchLower);
                    });
                    if (hasTaskbarTag) return true;
                }
            }

            return false;
        });
    }

    const { folderMap, noFolderActors } = this._groupActorsByFolder(filteredActors);

    const actorNone = game.i18n.localize('SPEAKERSELECTOR.ChatSenderEdit.ActorNone');
    const oocSel = !selectedActorId ? ' selected' : '';
    let html = `
        <div class="lichsoma-available-actor lichsoma-sender-edit-ooc${oocSel}" data-actor-id="" draggable="false">
            <i class="fas fa-user-slash" draggable="false"></i>
            <span>${foundry.utils.escapeHTML(actorNone)}</span>
        </div>
    `;

    const rootFolders = Array.from(folderMap.entries())
        .filter(([folderId, folderData]) => {
            let parentId = null;
            try {
                if (folderData.folder.folder && folderData.folder.folder.id && folderData.folder.folder.id !== folderId) {
                    parentId = folderData.folder.folder.id;
                } else if (folderData.folder.document && folderData.folder.document.parent) {
                    parentId = folderData.folder.document.parent;
                } else if (folderData.folder.data && folderData.folder.data.parent) {
                    parentId = folderData.folder.data.parent;
                } else if (folderData.folder.parent) {
                    parentId = folderData.folder.parent;
                }
            } catch (e) {
                // 루트 폴더 찾기 실패 (무시)
            }

            return !parentId || !folderMap.has(parentId);
        })
        .map(([folderId, folderData]) => ({ folderId, folderData }))
        .sort((a, b) => a.folderData.folder.name.localeCompare(b.folderData.folder.name));

    rootFolders.forEach(({ folderId }) => {
        html += this._renderFolderRecursivePicker(folderId, folderMap, 0, selectedActorId, folderStates);
    });

    if (noFolderActors.length > 0) {
        noFolderActors.sort((a, b) => a.name.localeCompare(b.name));

        html += `
            <div class="lichsoma-folder-section">
                <div class="lichsoma-folder-header">
                    <i class="fas fa-question-circle"></i>
                    <span>폴더 없음</span>
                    <span class="lichsoma-folder-count">(${noFolderActors.length})</span>
                </div>
                <div class="lichsoma-folder-actors">
        `;

        noFolderActors.forEach((actor) => {
            const sel = actor.id === selectedActorId ? ' selected' : '';
            const name = foundry.utils.escapeHTML(actor.name);
            html += `
                    <div class="lichsoma-available-actor lichsoma-sender-edit-actor-pick${sel}" data-actor-id="${actor.id}" draggable="false">
                        <img src="${actor.img}" alt="${name}" draggable="false">
                        <span>${name}</span>
                    </div>
                `;
        });

        html += `
                </div>
            </div>
        `;
    }

    return html;
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
        ui.notifications.info(`${actor.name}이(가) 그리드에서 제거되었습니다.`);
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
    const selector = document.querySelector('.lichsoma-speaker-selector');
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
    const selector = document.querySelector('.lichsoma-speaker-selector');
    if (selector) {
        // 현재 선택된 값 저장
        const currentValue = selector.querySelector('.speaker-dropdown')?.value || this._selectedSpeaker;
        this._renderSpeakerSelector($(document));
        // 선택 값 복원 및 감정 버튼 상태 복원
        setTimeout(() => {
            const newSelector = document.querySelector('.lichsoma-speaker-selector');
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
        game.settings.set('lichsoma-speaker-selector', this.SETTINGS.ACTOR_GRID_ACTORS, [...this._actorGridActors]);
    } catch (e) {
        // 액터 격자 데이터 저장 실패 (무시)
    }
};

// 채팅 폰트 적용 함수
SpeakerSelector._applyChatFonts = function() {
    try {
        // 게임 설정이 아직 로드되지 않은 경우 재시도
        if (!game.settings || !game.settings.settings) {
            setTimeout(() => this._applyChatFonts(), 100);
            return;
        }
        
        // 기존 폰트 스타일 제거
        const existingStyle = document.getElementById('lichsoma-chat-fonts');
        if (existingStyle) existingStyle.remove();
        
        let headerFont, messageFont, headerChineseFont, messageChineseFont;
        let headerFontSize, messageFontSize, headerFontWeight;
        
        try {
            headerFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT)
            );
            messageFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_FONT)
            );
            headerChineseFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_CHINESE_FONT)
            );
            messageChineseFont = this._normalizeFontFamilyName(
                game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_CHINESE_FONT)
            );
            headerFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT_SIZE);
            messageFontSize = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_MESSAGE_FONT_SIZE);
            headerFontWeight = game.settings.get('lichsoma-speaker-selector', this.SETTINGS.CHAT_HEADER_FONT_WEIGHT);
        } catch (e) {
            // 설정이 아직 등록되지 않은 경우 재시도
            setTimeout(() => this._applyChatFonts(), 100);
            return;
        }
        
        // 폰트나 폰트 크기, 폰트 웨이트가 하나라도 설정되어 있으면 적용
        if (!headerFont && !messageFont && !headerChineseFont && !messageChineseFont && 
            !headerFontSize && !messageFontSize && !headerFontWeight) return;
        
        let cssRules = '';
        
        // 헤더 한자 전용 폰트 클래스 정의
        if (headerChineseFont) {
            cssRules += `.lichsoma-chinese-char-header { font-family: "${headerChineseFont}", sans-serif !important; }\n`;
        }
        
        // 메시지 한자 전용 폰트 클래스 정의
        if (messageChineseFont) {
            cssRules += `.lichsoma-chinese-char-message { font-family: "${messageChineseFont}", sans-serif !important; }\n`;
        }
        
        // 헤더 폰트, 크기, 웨이트 적용
        let headerStyles = [];
        if (headerFont) {
            headerStyles.push(`font-family: "${headerFont}", sans-serif`);
        }
        if (headerFontSize) {
            headerStyles.push(`font-size: ${headerFontSize}px`);
        }
        if (headerFontWeight) {
            headerStyles.push(`font-weight: ${headerFontWeight}`);
        }
        if (headerStyles.length > 0) {
            // message-header의 직접 자식인 message-sender만 선택 (flavor-text 안의 요소 제외)
            cssRules += `.chat-message .message-header > .message-sender, .chat-message .message-header > h4.message-sender { ${headerStyles.join('; ')} !important; }\n`;
        }
        
        // 메시지 폰트 및 크기 적용
        let messageStyles = [];
        if (messageFont) {
            messageStyles.push(`font-family: "${messageFont}", sans-serif`);
        }
        if (messageFontSize) {
            messageStyles.push(`font-size: ${messageFontSize}px`);
        }
        if (messageStyles.length > 0) {
            cssRules += `.chat-message .message-content { ${messageStyles.join('; ')} !important; }\n`;
        }
        
        if (cssRules) {
            const style = document.createElement('style');
            style.id = 'lichsoma-chat-fonts';
            style.textContent = cssRules;
            document.head.appendChild(style);
        }
    } catch (e) {
        // applyChatFonts 에러 (무시)
    }
};

// 한자 감싸기 함수
SpeakerSelector._wrapChineseCharacters = function(element, type = 'header') {
    if (!element || element.dataset.lichsomaChineseWrapped) return;
    
    // CJK 통합 한자 범위: U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF
    const chineseRegex = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g;
    
    // 텍스트 노드만 처리
    const walk = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    const nodesToReplace = [];
    let node;
    while (node = walk.nextNode()) {
        if (chineseRegex.test(node.textContent)) {
            nodesToReplace.push(node);
        }
    }
    
    // 텍스트 노드를 순회하면서 한자를 span으로 감싸기
    nodesToReplace.forEach(textNode => {
        const text = textNode.textContent;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        
        // 정규식을 다시 생성 (lastIndex 초기화)
        const regex = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+/g;
        
        while ((match = regex.exec(text)) !== null) {
            // 한자 앞의 텍스트
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }
            
            // 한자를 span으로 감싸기 (타입에 따라 다른 클래스 사용)
            const span = document.createElement('span');
            span.className = type === 'header' ? 'lichsoma-chinese-char-header' : 'lichsoma-chinese-char-message';
            span.textContent = match[0];
            fragment.appendChild(span);
            
            lastIndex = regex.lastIndex;
        }
        
        // 한자 뒤의 텍스트
        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        
        // 원본 텍스트 노드를 fragment로 교체
        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
    
    // 중복 처리 방지
    element.dataset.lichsomaChineseWrapped = 'true';
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
class LichsomaActorGridSettingApp extends foundry.applications.api.ApplicationV2 {
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

// 전역 스코프에 등록 (다른 모듈에서 접근 가능하도록)
window.SpeakerSelector = SpeakerSelector;

// ===== CSS 편집기 Dialog 클래스 (ApplicationV2 — V1 FormApplication 경고 방지) =====

class ChatLogExportCSSEditor extends foundry.applications.api.ApplicationV2 {
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

    async _prepareContext(options) {
        const css =
            game.settings.get('lichsoma-speaker-selector', SpeakerSelector.SETTINGS.CHAT_LOG_EXPORT_CUSTOM_CSS) || '';
        return { css };
    }

    async _renderHTML(context, options) {
        const html = await foundry.applications.handlebars.renderTemplate(
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
                SpeakerSelector.SETTINGS.CHAT_LOG_EXPORT_CUSTOM_CSS,
                css
            );

            ui.notifications.info(game.i18n.localize('SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Saved'));
            await this.close();
        } catch (error) {
            ui.notifications.error('CSS 저장 중 오류가 발생했습니다: ' + error.message);
        }
    }
}

