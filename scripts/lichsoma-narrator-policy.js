const MODULE_ID = 'lichsoma-speaker-selector';

/** Called only from Foundry's post-create hook, whose userId identifies the creator. */
export function getPublicNarratorText(message, userId, users) {
    if (!users?.get(userId)?.isGM || message?.author?.id !== userId) return null;
    if (message.flags?.[MODULE_ID]?.narratorTyping !== true) return null;
    // Fail closed for malformed visibility data; never disclose whispers or blind rolls.
    if (!Array.isArray(message.whisper) || message.whisper.length || message.blind
        || message.visible === false || message.isContentVisible === false) return null;
    return typeof message.content === 'string' ? message.content : null;
}

/** Accept only completed GM operations affecting a GM's narrator state. */
export function isNarratorStateUpdate(user, changes, userId, users) {
    if (!user?.isGM || !users?.get(userId)?.isGM) return false;
    const flags = changes?.flags?.[MODULE_ID];
    return Object.hasOwn(flags ?? {}, 'narratorModeActive')
        || Object.hasOwn(flags ?? {}, '-=narratorModeActive')
        || Object.hasOwn(changes ?? {}, `flags.${MODULE_ID}.narratorModeActive`)
        || Object.hasOwn(changes ?? {}, `flags.${MODULE_ID}.-=narratorModeActive`)
        || Object.hasOwn(changes ?? {}, 'active');
}
