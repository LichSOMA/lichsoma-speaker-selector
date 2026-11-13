/** Use Foundry's compatibility dispatcher for systems which still override getHTML. */
export async function renderSystemChatMessage(message, options = {}) {
    const ChatLogClass = globalThis.foundry?.applications?.sidebar?.tabs?.ChatLog;
    if (typeof ChatLogClass?.renderMessage === 'function') {
        return ChatLogClass.renderMessage(message, options);
    }
    if (typeof message?.renderHTML === 'function') return message.renderHTML(options);
    if (typeof message?.getHTML === 'function') return message.getHTML(options);
    throw new TypeError('ChatMessage has no supported HTML renderer.');
}
