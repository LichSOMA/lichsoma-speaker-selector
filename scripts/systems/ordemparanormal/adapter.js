import { registerChatSystemModule } from '../../lichsoma-chat-system-registry.js';
import { LICHSOMA_SYSTEM_PAYLOAD_CLASS } from '../../lichsoma-chat-payload-classifier.js';
import { fetchTextAsset } from '../../lichsoma-shared-utils.js';
import { initializeOrdemFonts, buildOrdemFontCSS, getOrdemFontSettings } from './fonts.js';

const SYSTEM_ID = 'ordemparanormal';
const CARDS = '.ordemparanormal.chat-card, .chat-card.dt-card, .chat-card.oposto-request, .chat-card.oposto-results';
const NATIVE_ROLL_CLASSES = new Set(['dice-roll', 'expanded', 'lichsoma-core-dice', 'lichsoma-op-dice']);

function isCoreShapedRoll(element) {
    return element.tagName === 'DIV' && element.classList.contains('dice-roll')
        && [...element.classList].every(name => NATIVE_ROLL_CLASSES.has(name))
        && !element.hasAttribute('data-tooltip-class')
        && !!element.querySelector(':scope > .dice-result .dice-formula')
        && !!element.querySelector(':scope > .dice-result .dice-total');
}

/** No translated text, item names, result values, UUID fetches, or rule inference. */
export function isOrdemChatPayload(message, element) {
    if (message?.isContentVisible === false || message?.flags?.core?.external) return false;
    const content = element?.querySelector(':scope > .message-content');
    if (!content) return false;
    if (content.querySelector(CARDS)) return true;
    if (Object.keys(message?.flags?.ordemparanormal ?? {}).length) return true;
    if ((message?.rolls ?? []).some(roll => ['D20Roll', 'BasicRoll'].includes(roll.constructor?.name))) return true;

    // Native threat, formula, and untargeted/mixed damage rolls have no OP flag.
    // They share core markup with /r. Style this narrow actor-roll family alike,
    // while retaining generic /r without an OP actor and foreign structured cards.
    const actor = game.actors?.get?.(message?.speaker?.actor);
    if (!['agent', 'threat'].includes(actor?.type) || !message?.rolls?.length) return false;
    const children = [...content.children];
    return children.length > 0 && children.every(isCoreShapedRoll);
}

export function prepareOrdemPresentation({ message, element }) {
    if (game.system?.id !== SYSTEM_ID || !isOrdemChatPayload(message, element)) return false;
    element.classList.add('lichsoma-op-message');
    const content = element.querySelector(':scope > .message-content');
    content.classList.add(LICHSOMA_SYSTEM_PAYLOAD_CLASS, 'lichsoma-op-body');
    for (const title of element.querySelectorAll(
        ':scope > .message-header .flavor-text, .chat-card > .header > h2, .chat-card > .card-header > h3, .dice-roll > .dice-flavor'
    )) title.classList.add('lichsoma-op-title');
    for (const roll of content.querySelectorAll('.dice-roll')) {
        if (isCoreShapedRoll(roll)) {
            roll.classList.add('lichsoma-op-dice');
            roll.classList.remove('lichsoma-core-dice');
        }
    }
    // The existing sender/portrait/merge presentation continues unchanged.
    return false;
}

let initialized = false;
let chatCssPromise;
export function initializeSystemAdapter() {
    if (initialized || game.system?.id !== SYSTEM_ID) return;
    initialized = true;
    initializeOrdemFonts();
    registerChatSystemModule(SYSTEM_ID, {
        prepareLivePresentation: prepareOrdemPresentation,
        prepareExportPresentation: prepareOrdemPresentation,
        exportBodyClasses: () => ['system-ordemparanormal']
    });
    // OP appends hit/reaction/damage controls after the core render hook.
    // Decorate its finished DOM without re-running system logic or adding listeners.
    Hooks.on('ordemparanormal.renderChatMessage', (message, html) => {
        prepareOrdemPresentation({message, element: html?.jquery ? html[0] : html});
    });
    Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', async () => {
        chatCssPromise ??= fetchTextAsset('modules/lichsoma-speaker-selector/styles/systems/ordemparanormal/chat.css', {label: 'Ordem chat CSS'});
        return [buildOrdemFontCSS(getOrdemFontSettings()), await chatCssPromise].filter(Boolean).join('\n\n');
    });
}
