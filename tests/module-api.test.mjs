import assert from 'node:assert/strict';
import { installModuleApi, getModuleApi } from '../scripts/lichsoma-module-api.js';
import { ChatSystemBridge, registerChatSystemModule, unregisterChatSystemModule } from '../scripts/lichsoma-chat-system-registry.js';

globalThis.game = { modules: new Map() };
assert.equal(installModuleApi({}), null);
assert.equal(getModuleApi(), null);
game.modules.set('lichsoma-speaker-selector', {});

const api = installModuleApi({
    ChatSystemBridge, registerChatSystemModule, unregisterChatSystemModule,
    getChatTheme: () => 'dark-simple',
    formatChatText: element => element
});
assert.equal(api, getModuleApi());
assert.equal(api.apiVersion, 1);
assert.equal(Object.isFrozen(api), true);
assert.equal(Object.isFrozen(api.capabilities), true);
for (const feature of ['chatMergeRules', 'chatExportRules', 'chatPresentation', 'speakerPresentation', 'chatTheme', 'textFormatting']) {
    assert.equal(api.supports(feature), true);
}
for (const feature of ['unknown', 'toString', '__proto__', null, ['chatPresentation']]) {
    assert.equal(api.supports(feature), false);
}
// The released 3.0.0 can register rules but cannot promise presentation support.
const oldApi = { apiVersion: 1, registerChatSystemModule };
assert.equal(oldApi.supports?.('chatPresentation') === true, false);

const message = { id: 'share' }, element = {};
let liveCalls = 0, exportCalls = 0;
api.registerChatSystemModule('test-share', {
    mergeExcludeCurrent: ctx => ctx.message === message,
    exportExcludeCurrent: ctx => ctx.message === message,
    isNativeHeader: ctx => ctx.message === message,
    prepareLivePresentation: ctx => { assert.equal(ctx.element, element); liveCalls++; return true; },
    prepareExportPresentation: async ctx => { assert.equal(ctx.message, message); exportCalls++; return true; },
    getSenderAlias: () => 'Share sender'
});
assert.equal(api.ChatSystemBridge.merge.excludeCurrent(message, element), true);
assert.equal(api.ChatSystemBridge.export.excludeCurrent(message, element), true);
assert.equal(api.ChatSystemBridge.presentation.isNativeHeader(message, element), true);
assert.equal(api.ChatSystemBridge.presentation.prepareLive(message, element), true);
assert.equal(await api.ChatSystemBridge.presentation.prepareExport(message, element), true);
assert.equal(api.ChatSystemBridge.speaker.getSenderAlias({}), 'Share sender');
assert.equal(liveCalls, 1);
assert.equal(exportCalls, 1);
// Existing IDs update a registration rather than accumulating duplicate handlers.
api.registerChatSystemModule('test-share', { mergeExcludeCurrent: () => false });
assert.equal(api.ChatSystemBridge.merge.excludeCurrent(message, element), false);
assert.equal(api.ChatSystemBridge.presentation.isNativeHeader(message, element), false);
api.unregisterChatSystemModule('test-share');
assert.equal(api.ChatSystemBridge.speaker.getSenderAlias({}), null);
assert.equal(await api.ChatSystemBridge.presentation.prepareExport(message, element), false);
console.log('Speaker Selector API capability and presentation integration tests passed');
