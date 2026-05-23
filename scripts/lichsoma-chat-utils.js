/**
 * 채팅 유틸 — IC/이모트 모드에서 스피커(토큰/액터)가 없을 때 코어 예외 대신 유저(OOC)로 전송
 *
 * FVTT v14 대응:
 * - ChatLog.prototype.processMessage를 직접 덮어쓰지 않습니다.
 * - 공식 ChatLog.CHAT_COMMANDS 레지스트리와 chatMessage/preCreateChatMessage 훅만 사용합니다.
 */
const MODULE_ID = 'lichsoma-speaker-selector';
const SETTING_CHAT_UTILS_IC_OOC = 'chatUtilsForIcOoc';

function getChatLogClass() {
  return foundry?.applications?.sidebar?.tabs?.ChatLog ?? null;
}

function isFallbackEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_CHAT_UTILS_IC_OOC) === true;
  } catch (_) {
    return false;
  }
}

function speakerHasActorOrToken(speaker) {
  return !!(speaker?.actor || speaker?.token);
}

function getCurrentSpeakerData(chatData = {}) {
  if (chatData?.speaker) return chatData.speaker;
  try {
    return ChatMessage.getSpeaker();
  } catch (_) {
    return null;
  }
}

function extractCommandBody(match, fallback = '') {
  if (!match) return fallback;
  const parts = Array.from(match).slice(1).filter(part => part != null);
  if (!parts.length) return fallback;

  // Foundry 기본 채팅 명령 정규식은 보통 [전체, "/ic ", "본문"] 형태다.
  // 커스텀 정규식까지 안전하게 처리하기 위해 마지막 capture group을 본문으로 간주한다.
  return String(parts[parts.length - 1] ?? fallback);
}

function forceChatDataToOoc(chatData, content) {
  chatData.content = String(content ?? '');
  chatData.style = CONST.CHAT_MESSAGE_STYLES.OOC;

  // OOC는 캐릭터 스피커가 필요하지 않으므로 speaker를 제거한다.
  // 이렇게 해야 "스피커 없음" 상태에서도 코어의 IC/Emote 검증을 우회한다.
  delete chatData.speaker;
  delete chatData.emote;
}

function shouldFallbackForSpeakerlessCommand(chatData) {
  if (!isFallbackEnabled()) return false;
  const speaker = getCurrentSpeakerData(chatData);
  return !speakerHasActorOrToken(speaker);
}

function installSpeakerlessCommandFallbacks(ChatLog) {
  if (!ChatLog?.CHAT_COMMANDS) return;

  for (const commandKey of ['ic', 'emote']) {
    const entry = ChatLog.CHAT_COMMANDS[commandKey];
    if (!entry || typeof entry.fn !== 'function') continue;
    if (entry.fn._lichsomaSpeakerlessFallback) continue;

    const original = entry.fn;
    const wrapped = function lichsomaSpeakerlessCommandFallback(command, match, chatData = {}, createOptions = {}) {
      if (shouldFallbackForSpeakerlessCommand(chatData)) {
        const body = extractCommandBody(match);
        forceChatDataToOoc(chatData, body);
        return;
      }

      return original.call(this, command, match, chatData, createOptions);
    };

    wrapped._lichsomaSpeakerlessFallback = true;
    wrapped._lichsomaOriginalCommandFn = original;
    entry.fn = wrapped;
  }
}

function normalizeMessageMode(value) {
  if (value == null) return null;

  if (typeof value === 'number') {
    if (value === CONST.CHAT_MESSAGE_STYLES.IC) return 'ic';
    if (value === CONST.CHAT_MESSAGE_STYLES.EMOTE) return 'emote';
    if (value === CONST.CHAT_MESSAGE_STYLES.OOC) return 'ooc';
    return null;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  if (raw === 'ic' || raw === 'in-character' || raw === 'in_character') return 'ic';
  if (raw === 'emote' || raw === 'em') return 'emote';
  if (raw === 'ooc' || raw === 'out-of-character' || raw === 'out_of_character') return 'ooc';

  const n = Number(raw);
  if (Number.isFinite(n)) return normalizeMessageMode(n);

  return null;
}

function readCurrentMessageMode(chatLog) {
  // v14의 message mode는 ChatLog 내부 UI 상태에 가깝기 때문에 공개 속성이 없는 환경도 있다.
  // 그래서 가능한 공개/DOM 단서만 느슨하게 확인하고, 모르면 null을 반환한다.
  const direct = normalizeMessageMode(chatLog?.messageMode ?? chatLog?.messageStyle ?? chatLog?.style);
  if (direct) return direct;

  const root = chatLog?.element ?? document.querySelector('#chat');
  if (!root?.querySelector) return null;

  const valueSelectors = [
    'input[name="messageMode"]:checked',
    'input[name="style"]:checked',
    'select[name="messageMode"]',
    'select[name="style"]',
    '[data-message-mode].active',
    '[data-message-mode][aria-pressed="true"]',
    '[data-action="messageMode"][data-mode]',
    '[data-action="messageMode"][data-style]'
  ];

  for (const selector of valueSelectors) {
    const el = root.querySelector(selector);
    if (!el) continue;

    const mode = normalizeMessageMode(
      el.value ??
      el.dataset?.messageMode ??
      el.dataset?.mode ??
      el.dataset?.style ??
      el.getAttribute?.('aria-label') ??
      el.getAttribute?.('title')
    );

    if (mode) return mode;
  }

  return null;
}

function currentModeRequiresSpeaker(chatLog) {
  const mode = readCurrentMessageMode(chatLog);
  return mode === 'ic' || mode === 'emote';
}

function handleSpeakerlessBareMessage(chatLog, message, chatData) {
  if (!isFallbackEnabled()) return;

  const trimmed = String(message ?? '').trim();
  if (!trimmed) return;

  const ChatLog = getChatLogClass();
  if (!ChatLog?.parse) return;

  const [command] = ChatLog.parse(trimmed);

  // 명시적 /ic, /emote는 CHAT_COMMANDS 래퍼가 처리한다.
  if (command !== 'none') return;

  // 명령어 없는 메시지는 현재 채팅 모드가 IC/Emote임을 확인할 수 있을 때만 OOC로 전환한다.
  // 모드를 알 수 없는 경우에는 코어 기본 동작을 건드리지 않는다.
  if (!currentModeRequiresSpeaker(chatLog)) return;

  const speaker = getCurrentSpeakerData(chatData);
  if (speakerHasActorOrToken(speaker)) return;

  forceChatDataToOoc(chatData, trimmed);
}

Hooks.once('init', () => {
  /** 전역 `ChatLog` 접근은 v13+ 에서 폐기 예정 — 네임스페이스 클래스만 사용 */
  const ChatLog = getChatLogClass();
  if (!ChatLog?.CHAT_COMMANDS) return;

  /** `/desc` — 코어 미등록 시 invalid 명령 오류가 나므로 CHAT_COMMANDS에 등록 (본문은 preCreate에서 나레이터 카드 처리) */
  const any = '([^]*)';
  ChatLog.CHAT_COMMANDS.desc = {
    rgx: new RegExp(`^(/desc )${any}`, 'i'),
    fn(command, match, chatData, createOptions) {
      chatData.content = `/desc ${match[2].replace(/\n/g, '<br>')}`;
      chatData.style = CONST.CHAT_MESSAGE_STYLES.OOC;
      delete chatData.speaker;
    }
  };

  game.settings.register(MODULE_ID, SETTING_CHAT_UTILS_IC_OOC, {
    name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatUtilsForIC.Name'),
    hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatUtilsForIC.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  installSpeakerlessCommandFallbacks(ChatLog);
});

Hooks.on('chatMessage', (chatLog, message, chatData) => {
  handleSpeakerlessBareMessage(chatLog, message, chatData);
});

Hooks.on('preCreateChatMessage', (message, data, options, userId) => {
  // 다른 사용자의 메시지에는 간섭하지 않는다.
  if (userId !== game.user?.id) return;

  const flags = message.flags?.[MODULE_ID] ?? {};
  if (flags.userId) return;

  message.updateSource({
    flags: {
      [MODULE_ID]: {
        ...flags,
        userId
      }
    }
  });
});
