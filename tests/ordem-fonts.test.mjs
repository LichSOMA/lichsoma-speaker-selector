import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.foundry = {applications: {api: {ApplicationV2: class {}}}};
const {buildOrdemFontCSS, migrateOrdemFonts} = await import('../scripts/systems/ordemparanormal/fonts.js');
const {readFontProfile} = await import('../scripts/systems/ordemparanormal/font-profile.js');

test('OP headings and body are independent, font-only and exclude icons/code', () => {
    const header = buildOrdemFontCSS({opCardHeaderFontCSS: '.lichsoma-op-font-settings{font-family:Georgia;}'});
    assert.match(header, /op-title/);
    assert.doesNotMatch(header, /op-body/);
    const body = buildOrdemFontCSS({opCardBodyFontCSS: 'body{font-family:Courier;color:red;}'});
    assert.match(body, /op-body/);
    assert.match(body, /not\(:where\(\.lichsoma-op-title/);
    assert.match(body, /code/);
    assert.doesNotMatch(body, /body\s*\{|color:red|message-sender|loi-sheet/);
    assert.equal(buildOrdemFontCSS({}), '');
});
test('font descriptors do not accidentally replace a marked profile', () => {
    const value = '@font-face{font-family:Definition;src:url("data:font/woff2;base64,abc");font-weight:100 900;} .lichsoma-op-font-settings{font-family:Chosen;font-weight:600;}';
    assert.equal(readFontProfile(value).declarations['font-family'], 'Chosen');
    const css = buildOrdemFontCSS({opCardHeaderFontCSS: value, opCardBodyFontCSS: '@import url("https://example.test/font.css");'+value});
    assert.ok(css.startsWith('@import'));
    assert.equal((css.match(/@font-face/g) ?? []).length, 1);
});
function mockSettings(entries = {}) {
    const storage = new Map(Object.entries(entries).map(([key,value]) => [key,JSON.stringify(value)]));
    return {
        raw: storage,
        storage: new Map([['client',{getItem:key=>storage.get(key) ?? null}]]),
        get(ns,key) { return JSON.parse(storage.get(`${ns}.${key}`) ?? (key==='opFontsMigratedV1' ? 'false' : '""')); },
        async set(ns,key,value) { storage.set(`${ns}.${key}`,JSON.stringify(value)); }
    };
}
test('one-time transfer retains role boundaries without depending on active Interface', async () => {
    const settings = mockSettings({'lichsoma-ordem-interface.cardHeaderFontCSS':'title', 'lichsoma-ordem-interface.cardBodyFontCSS':'body', 'lichsoma-ordem-interface.sheetFontCSS':'sheet'});
    await migrateOrdemFonts(settings);
    assert.equal(settings.get('lichsoma-speaker-selector','opCardHeaderFontCSS'), 'title');
    assert.equal(settings.get('lichsoma-speaker-selector','opCardBodyFontCSS'), 'body');
    settings.raw.set('lichsoma-ordem-interface.cardBodyFontCSS', JSON.stringify('later'));
    await migrateOrdemFonts(settings);
    assert.equal(settings.get('lichsoma-speaker-selector','opCardBodyFontCSS'), 'body');
});
test('existing new settings, including an intentional empty value, are never overwritten', async () => {
    const settings = mockSettings({'lichsoma-ordem-interface.cardHeaderFontCSS':'old title', 'lichsoma-ordem-interface.cardBodyFontCSS':'old body', 'lichsoma-speaker-selector.opCardHeaderFontCSS':'', 'lichsoma-speaker-selector.opCardBodyFontCSS':'new body'});
    await migrateOrdemFonts(settings);
    assert.equal(settings.get('lichsoma-speaker-selector','opCardHeaderFontCSS'), '');
    assert.equal(settings.get('lichsoma-speaker-selector','opCardBodyFontCSS'), 'new body');
});
