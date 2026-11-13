import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
const policy = await import(`data:text/javascript;base64,${Buffer.from(read('lichsoma-narrator-policy.js')).toString('base64')}`);
const selectorSource = read('lichsoma-speaker-selector.js');
const gm = { id: 'gm', isGM: true, active: true, getFlag: () => true };
const player = { id: 'player', isGM: false, active: true };
const users = [gm, player];
users.get = id => users.find(user => user.id === id);
const message = overrides => ({ author: gm, content: '<div class="narrator-card">Public text</div>',
    flags: { 'lichsoma-speaker-selector': { narratorTyping: true } },
    whisper: [], blind: false, visible: true, isContentVisible: true, ...overrides });

test('public GM narration is accepted; private and forged narration is rejected', () => {
    assert.equal(policy.getPublicNarratorText(message(), 'gm', users), message().content);
    for (const overrides of [{ whisper: ['player'] }, { blind: true }, { visible: false },
        { isContentVisible: false }, { whisper: undefined }, { content: null },
        { author: player }, { flags: {} }]) {
        assert.equal(policy.getPublicNarratorText(message(overrides), 'gm', users), null);
    }
    assert.equal(policy.getPublicNarratorText(message(), 'player', users), null);
    assert.equal(policy.getPublicNarratorText(message(), 'unknown', users), null);
});

test('GM state updates require a GM operation and an actual narrator change', () => {
    const changes = { flags: { 'lichsoma-speaker-selector': { narratorModeActive: true } } };
    assert.equal(policy.isNarratorStateUpdate(gm, changes, 'gm', users), true);
    assert.equal(policy.isNarratorStateUpdate(gm, changes, 'player', users), false);
    assert.equal(policy.isNarratorStateUpdate(player, changes, 'gm', users), false);
    assert.equal(policy.isNarratorStateUpdate(gm, { name: 'renamed' }, 'gm', users), false);
    assert.equal(policy.isNarratorStateUpdate(gm, { flags: { 'lichsoma-speaker-selector': { '-=narratorModeActive': null } } }, 'gm', users), true);
});

function domStub() {
    return { createElement: () => ({ textContent: '', set innerHTML(value) {
        this.textContent = String(value).replace(/<[^>]*>/g, '');
    } }) };
}

test('synchronization uses completed documents; socket payloads cannot trigger narration', () => {
    const hooks = new Map(), effects = [], socketHandlers = [];
    const start = selectorSource.indexOf('static _setupNarratorSynchronization() {');
    const end = selectorSource.indexOf('// 사용자에게 보이는 문자 단위', start);
    assert.ok(start >= 0 && end > start);
    const method = selectorSource.slice(start, end).trim().replace('static ', '');
    const host = { _updateNarratorLine: active => effects.push(active),
        _startNarratorTyping: text => effects.push(text) };
    vm.runInNewContext(`({${method}})._setupNarratorSynchronization.call(host)`, {
        ...policy, host, game: { users }, document: domStub(),
        Hooks: { on: (name, callback) => hooks.set(name, callback) },
        registerSocketHandler: (...args) => socketHandlers.push(args)
    });
    assert.deepEqual(socketHandlers, []);
    hooks.get('createChatMessage')(message(), {}, 'gm');
    assert.deepEqual(effects, ['Public text']);
    effects.length = 0;
    hooks.get('createChatMessage')(message({ whisper: ['player'] }), {}, 'gm');
    hooks.get('createChatMessage')(message(), {}, 'player');
    assert.deepEqual(effects, []);
    hooks.get('updateUser')(gm, { flags: { 'lichsoma-speaker-selector': { narratorModeActive: true } } }, {}, 'player');
    assert.deepEqual(effects, []);
    hooks.get('updateUser')(gm, { flags: { 'lichsoma-speaker-selector': { narratorModeActive: true } } }, {}, 'gm');
    assert.deepEqual(effects, [true]);
});

function runPreCreate({ input, content, fromInput, narrator = false, whisper = [] }) {
    const start = selectorSource.indexOf("Hooks.on('preCreateChatMessage', (doc, data, options, userId) => {", selectorSource.indexOf('static setupNarratorMode()'));
    const end = selectorSource.indexOf('// 메시지 생성 후 플래그 초기화', start);
    let callback;
    const updates = [], broadcasts = [];
    const host = { SETTINGS: { NARRATOR_CHAT_CARD: 'narratorChatCard' },
        _getChatInputElement: () => ({}), _isChatInputFocused: () => true,
        _getChatInputText: () => input, _isMessageFromChatInput: () => fromInput,
        _replaceTextEllipsesInHtml: text => text, _narratorModeActive: narrator, _selectedSpeaker: 'ooc',
        _buildOocSpeakerData: () => ({ alias: 'GM', actor: null, token: null }),
        _getMessageImageSync: () => ({ src: 'portrait' }),
        _normalizeSpeakerDataForModule: speaker => speaker,
        _applySenderFlagsToDoc: () => {},
        _applySpeakerData: (doc, data, speaker, flags) => doc.updateSource({ flags: { 'lichsoma-speaker-selector': flags } }) };
    const data = { author: 'gm', content, whisper, speaker: { alias: 'GM', actor: null, token: null } };
    vm.runInNewContext(`(function(){${selectorSource.slice(start, end).trim()}}).call(host)`, {
        host, game: { user: gm, users, settings: { get: () => true } }, document: domStub(),
        Hooks: { on: (name, fn) => { callback = fn; } },
        emitSocket: (...args) => broadcasts.push(args)
    });
    callback({ speaker: data.speaker, updateSource: update => updates.push(update) }, data, {}, 'gm');
    return { data, updates, broadcasts };
}

test('separator draft does not overwrite sheet or macro messages', () => {
    const result = runPreCreate({ input: '---', content: '<section>Attack card</section>', fromInput: false });
    assert.equal(result.data.content, '<section>Attack card</section>');
    assert.ok(!result.updates.some(update => 'content' in update));
    const independentSeparator = runPreCreate({ input: '---', content: '---', fromInput: false });
    assert.equal(independentSeparator.data.content, '---');
});

test('separator submitted from chat still becomes a horizontal rule', () => {
    const result = runPreCreate({ input: '---', content: '---', fromInput: true });
    assert.equal(result.data.content, '<hr>');
    assert.ok(result.updates.some(update => update.content === '<hr>'));
});

test('pre-create never broadcasts private narrator text and persists the card', () => {
    const result = runPreCreate({ input: 'Secret', content: 'Secret', fromInput: true,
        narrator: true, whisper: ['player'] });
    assert.deepEqual(result.broadcasts, []);
    assert.ok(result.updates.some(update => update.content === '<div class="narrator-card">Secret</div>'));
});

test('archive iframe has an opaque sandbox before HTML assignment', () => {
    const source = read('lichsoma-chat-log-archive.js');
    const start = source.indexOf("const iframe = document.createElement('iframe');");
    const end = source.indexOf('// iframe 로드 후 검색 기능 연결', start);
    const attributes = {}, iframe = { style: {}, setAttribute: (key, value) => { attributes[key] = value; },
        set srcdoc(value) { assert.equal(attributes.sandbox, 'allow-scripts'); assert.equal(value, 'archive'); } };
    vm.runInNewContext(source.slice(start, end), { document: { createElement: () => iframe }, styledHtml: 'archive' });
    assert.equal(attributes.sandbox, 'allow-scripts');
    assert.equal(attributes.referrerpolicy, 'no-referrer');
    assert.ok(source.includes("if (event.source !== iframe.contentWindow) return;"));
});
