/**
 * Conservative chat-payload classification for Speaker Selector presentation.
 *
 * Speaker Selector owns the outer chat shell. Game systems own structured payloads.
 * This helper only adds presentation classes when the rendered DOM gives positive
 * evidence that a narrow Speaker Selector fallback is safe.
 */

export const LICHSOMA_PLAIN_MESSAGE_CLASS = 'lichsoma-plain-message';
export const LICHSOMA_SIMPLE_TEXT_CLASS = 'lichsoma-simple-text-payload';
export const LICHSOMA_GENERIC_DICE_CLASS = 'lichsoma-generic-dice-message';
export const LICHSOMA_CORE_DICE_CLASS = 'lichsoma-core-dice';
export const LICHSOMA_SYSTEM_PAYLOAD_CLASS = 'lichsoma-system-payload';

const SAFE_TEXT_TAGS = new Set([
    'A', 'B', 'BR', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
    'I', 'IMG', 'LI', 'BLOCKQUOTE', 'CODE', 'OL', 'P', 'RB', 'RT', 'RUBY', 'S', 'SMALL', 'SPAN',
    'STRONG', 'SUB', 'SUP', 'U', 'UL', 'PRE', 'MARK', 'KBD'
]);

const STRUCTURED_PAYLOAD_SELECTOR = [
    `.${LICHSOMA_SYSTEM_PAYLOAD_CLASS}`,
    '.chat-card',
    '.narrator-card',
    'article',
    'form',
    'section',
    'table',
    '[data-action]'
].join(', ');

function isPlainFoundryStyle(message) {
    const styles = globalThis.CONST?.CHAT_MESSAGE_STYLES;
    if (!styles) return false;
    return message?.style === styles.IC
        || message?.style === styles.OOC
        || message?.style === styles.EMOTE;
}

function hasAttachedRoll(message) {
    return Array.isArray(message?.rolls) && message.rolls.length > 0;
}

function hasSystemPayloadData(message) {
    const systemData = message?.system;
    return !!systemData && typeof systemData === 'object' && Object.keys(systemData).length > 0;
}

function getMessageContent(messageElement) {
    return messageElement.querySelector(':scope > .message-content')
        || messageElement.querySelector('.message-content');
}

function hasOnlySimpleTextElements(messageContent) {
    if (!(messageContent instanceof HTMLElement)) return false;
    if (messageContent.matches?.(STRUCTURED_PAYLOAD_SELECTOR)) return false;
    if (messageContent.querySelector?.(STRUCTURED_PAYLOAD_SELECTOR)) return false;
    if (messageContent.querySelector?.('.dice-roll, .dice-tooltip')) return false;

    for (const element of messageContent.querySelectorAll('*')) {
        if (!SAFE_TEXT_TAGS.has(element.tagName)) return false;
    }
    return true;
}

const CORE_DICE_ALLOWED_CLASSES = new Set(['dice-roll', 'expanded', LICHSOMA_CORE_DICE_CLASS]);

function isCoreDiceRoll(diceRoll) {
    if (!(diceRoll instanceof HTMLElement) || !diceRoll.classList?.contains('dice-roll')) return false;

    // Foundry's classic/core dice renderer uses a DIV root. System components often
    // reuse the dice-roll class on buttons/sections or add their own component class.
    if (diceRoll.tagName !== 'DIV') return false;
    for (const className of diceRoll.classList) {
        if (!CORE_DICE_ALLOWED_CLASSES.has(className)) return false;
    }

    // A system-specific tooltip class is an explicit ownership signal (for example,
    // a system may keep the core-looking markup while supplying its own tooltip skin).
    if (diceRoll.hasAttribute?.('data-tooltip-class')) return false;

    const diceResult = Array.from(diceRoll.children || []).find((child) => child.classList?.contains('dice-result'));
    if (!(diceResult instanceof HTMLElement)) return false;

    const formula = diceResult.querySelector?.('.dice-formula');
    const total = diceResult.querySelector?.('.dice-total');
    if (!(formula instanceof HTMLElement) || !(total instanceof HTMLElement)) return false;
    if (formula.closest?.('.dice-roll') !== diceRoll || total.closest?.('.dice-roll') !== diceRoll) return false;

    for (const element of diceRoll.querySelectorAll?.('*') || []) {
        if (element.tagName?.includes('-')) return false; // custom elements remain system-owned
    }
    return true;
}

function classifyCoreDiceRolls(messageContent) {
    if (!(messageContent instanceof HTMLElement)) return 0;

    let count = 0;
    for (const diceRoll of messageContent.querySelectorAll?.('.dice-roll') || []) {
        const isCore = isCoreDiceRoll(diceRoll);
        diceRoll.classList?.toggle(LICHSOMA_CORE_DICE_CLASS, isCore);
        if (isCore) count += 1;
    }
    return count;
}

function hasOnlyGenericDiceElements(messageContent) {
    if (!(messageContent instanceof HTMLElement)) return false;
    const diceRolls = Array.from(messageContent.querySelectorAll?.('.dice-roll') || []);
    if (!diceRolls.length || !diceRolls.every((roll) => roll.classList?.contains(LICHSOMA_CORE_DICE_CLASS))) return false;
    if (messageContent.matches?.(STRUCTURED_PAYLOAD_SELECTOR)) return false;

    // Core Foundry dice themselves carry data-action and may contain structured
    // tooltip markup. Only structured elements outside a classified core dice roll
    // are evidence that the message shell belongs to the game system.
    for (const element of messageContent.querySelectorAll?.(STRUCTURED_PAYLOAD_SELECTOR) || []) {
        if (!element.closest?.(`.${LICHSOMA_CORE_DICE_CLASS}`)) return false;
    }

    // Message-level generic-dice classification stays conservative. It is only used
    // for shell/export fallback behavior; per-die color/font fallback uses the class
    // placed directly on each core dice roll above.
    for (const element of messageContent.querySelectorAll('*')) {
        if (element.tagName.includes('-')) return false;
        if (element.tagName === 'DIV' && !element.matches?.('.dice-roll') && !element.closest?.('.dice-roll')) {
            return false;
        }
    }
    return true;
}

function isSimpleTextPayload(message, messageContent) {
    if (hasAttachedRoll(message)) return false;
    if (message?.flags?.core?.external) return false;
    return hasOnlySimpleTextElements(messageContent);
}

function isGenericDicePayload(message, messageContent) {
    if (!hasAttachedRoll(message)) return false;
    if (message?.flags?.core?.external) return false;
    return hasOnlyGenericDiceElements(messageContent);
}

/**
 * Return true only when the rendered message can safely receive Speaker Selector's
 * full plain-chat presentation.
 */
export function isLichsomaPlainChatMessage(message, messageElement) {
    if (!message || !(messageElement instanceof HTMLElement)) return false;
    if (!isPlainFoundryStyle(message)) return false;
    if (hasAttachedRoll(message)) return false;
    if (hasSystemPayloadData(message)) return false;
    if (message?.flags?.core?.external) return false;

    const messageContent = getMessageContent(messageElement);
    return !!messageContent && hasOnlySimpleTextElements(messageContent);
}

/**
 * Apply semantic presentation classes without restructuring payload DOM.
 * Unknown/structured payloads intentionally receive no message-level fallback class;
 * core-looking dice rolls may receive a narrow class on the dice element itself.
 */
export function classifyLichsomaChatPayload(message, messageElement) {
    if (!message || !(messageElement instanceof HTMLElement)) return false;

    const messageContent = getMessageContent(messageElement);
    const coreDiceCount = messageContent ? classifyCoreDiceRolls(messageContent) : 0;
    const isPlain = !!messageContent && isLichsomaPlainChatMessage(message, messageElement);
    const isSimpleText = !!messageContent && isSimpleTextPayload(message, messageContent);
    const isGenericDice = !!messageContent && isGenericDicePayload(message, messageContent);

    messageElement.classList.toggle(LICHSOMA_PLAIN_MESSAGE_CLASS, isPlain);
    messageElement.classList.toggle(LICHSOMA_SIMPLE_TEXT_CLASS, isSimpleText);
    messageElement.classList.toggle(LICHSOMA_GENERIC_DICE_CLASS, isGenericDice);
    return isPlain || isSimpleText || isGenericDice || coreDiceCount > 0;
}
