/**
 * 채팅 유틸 — IC/이모트 모드에서 스피커(토큰/액터)가 없을 때 코어 예외 대신 유저(OOC)로 전송
 */
const SETTING_CHAT_UTILS_IC_OOC = 'chatUtilsForIcOoc';

Hooks.once('init', () => {
  /** 전역 `ChatLog` 접근은 v13+ 에서 폐기 예정 — 네임스페이스 클래스만 사용 */
  const ChatLog = foundry.applications.sidebar.tabs.ChatLog;

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

  game.settings.register('lichsoma-speaker-selector', SETTING_CHAT_UTILS_IC_OOC, {
    name: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatUtilsForIC.Name'),
    hint: game.i18n.localize('SPEAKERSELECTOR.Settings.ChatUtilsForIC.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  const ERR_NO_SPEAKER = 'You cannot chat in-character without an identified speaker';
  const orig = ChatLog.prototype.processMessage;
  if (orig._lichsomaChatFallback) return;

  ChatLog.prototype.processMessage = async function lichsomaProcessMessage(message, options) {
    try {
      return await orig.call(this, message, options);
    } catch (err) {
      if (!err || err.message !== ERR_NO_SPEAKER) throw err;
      if (!game.settings.get('lichsoma-speaker-selector', SETTING_CHAT_UTILS_IC_OOC)) throw err;

      const trimmed = String(message ?? '').trim();
      if (!trimmed) throw err;

      const [command, match] = ChatLog.parse(trimmed);
      let body;
      if (command === 'none') {
        body = trimmed;
      } else if (command === 'ic' || command === 'emote') {
        body = match[2] ?? '';
      } else {
        throw err;
      }

      return await orig.call(this, `/ooc ${body}`, options);
    }
  };

  ChatLog.prototype.processMessage._lichsomaChatFallback = true;
});
