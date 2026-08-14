import { getMessageAuthorName } from './lichsoma-shared-utils.js';

const MODULE_ID = 'lichsoma-speaker-selector';
const NBSP = '\u00A0';

export function isDnd5eSystem() {
    return game.system?.id === 'dnd5e';
}

export function isDnd5eMessageElement(messageElement) {
    if (!isDnd5eSystem() || !messageElement) return false;

    const header = messageElement.querySelector?.('.message-header');
    if (!header) return false;

    return messageElement.classList.contains('dnd5e2')
        || messageElement.classList.contains('lichsoma-dnd5e-native-header')
        || !!header.querySelector?.('.message-sender .name-stacked')
        || !!header.querySelector?.('.message-sender .avatar')
        || !!header.querySelector?.('h4.message-sender')
        || !!header.querySelector?.('.message-sender');
}

export function getDnd5eTitleAlias(message) {
    if (!message) return '';

    const flags = message.flags?.[MODULE_ID] || {};
    if (flags.senderAlias) return flags.senderAlias;

    const speaker = message.speaker || {};
    const actorId = flags.actorId || speaker.actor || null;
    const actor = actorId ? game.actors?.get(actorId) : null;

    if (isDnd5eSystem() && actor?.name) {
        let alwaysUseActor = false;
        try {
            alwaysUseActor = game.settings.get(MODULE_ID, 'alwaysUseActor') === true;
        } catch (_error) {
            alwaysUseActor = false;
        }

        const mergeType = flags.mergeSpeakerType || null;
        if (alwaysUseActor || mergeType === 'actor' || !speaker.token) {
            return actor.name;
        }
    }

    return speaker.alias
        || message.alias
        || actor?.name
        || getMessageAuthorName(message)
        || '';
}

function collectExistingSenderText(sender, avatar) {
    return Array.from(sender.childNodes)
        .filter((node) => node !== avatar)
        .map((node) => node.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function ensureDnd5eNameStacked(messageElement, {
    titleFallback = NBSP,
    subtitleFallback = null,
    ensureSubtitle = false
} = {}) {
    if (!isDnd5eMessageElement(messageElement)) return null;

    const header = messageElement.querySelector('.message-header');
    const sender = header?.querySelector('.message-sender');
    if (!sender) return null;

    let nameStacked = sender.querySelector('.name-stacked');
    let title = nameStacked?.querySelector('.title') || null;

    if (!nameStacked) {
        const avatar = sender.querySelector(':scope > .avatar');
        const existingTitleText = collectExistingSenderText(sender, avatar);

        Array.from(sender.childNodes).forEach((node) => {
            if (node !== avatar) node.remove();
        });

        nameStacked = document.createElement('span');
        nameStacked.classList.add('name-stacked');

        title = document.createElement('span');
        title.classList.add('title');
        title.textContent = existingTitleText || titleFallback || NBSP;

        nameStacked.appendChild(title);
        sender.appendChild(nameStacked);
    } else if (!title) {
        title = document.createElement('span');
        title.classList.add('title');
        title.textContent = titleFallback || NBSP;
        nameStacked.insertBefore(title, nameStacked.firstChild);
    }

    let subtitle = nameStacked.querySelector('.subtitle');
    if (ensureSubtitle && !subtitle) {
        subtitle = document.createElement('span');
        subtitle.classList.add('subtitle');
        nameStacked.appendChild(subtitle);
    }

    if (ensureSubtitle && subtitle && !subtitle.textContent?.trim()) {
        subtitle.textContent = subtitleFallback || NBSP;
    }

    return { header, sender, nameStacked, title, subtitle };
}

export function applyDnd5eTitleAlias(message, messageElement, {
    ensureSubtitle = false,
    subtitleFallback = null,
    titleFallback = null
} = {}) {
    if (!isDnd5eMessageElement(messageElement)) return null;

    const fallback = titleFallback
        || message?.speaker?.alias
        || message?.alias
        || getMessageAuthorName(message)
        || NBSP;

    const structure = ensureDnd5eNameStacked(messageElement, {
        titleFallback: fallback,
        subtitleFallback: subtitleFallback || getMessageAuthorName(message) || NBSP,
        ensureSubtitle
    });
    if (!structure) return null;

    const alias = getDnd5eTitleAlias(message);
    if (alias && structure.title) {
        structure.title.textContent = alias;
        structure.title.dataset.lichsomaSenderAlias = 'true';
    }

    return structure;
}
