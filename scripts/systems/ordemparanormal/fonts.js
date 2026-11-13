import { createCssSettingEditorClass } from '../../lichsoma-css-setting-editor.js';
import { readFontProfile } from './font-profile.js';

const MODULE_ID = 'lichsoma-speaker-selector';
export const ORDEM_FONT_ROLES = Object.freeze([
    {key: 'opCardHeaderFontCSS', oldKey: 'cardHeaderFontCSS', role: 'header', label: 'Header'},
    {key: 'opCardBodyFontCSS', oldKey: 'cardBodyFontCSS', role: 'body', label: 'Body'}
]);
const NO_FONT = ":not(:where(i, i *, .icon, [class*='fa-'], [class*='fa-'] *, code, code *, pre, pre *))";
const TEXT = `:is(a, button, input, select, option, textarea, label, span, div, p, small, strong, em, h1, h2, h3, h4, h5, h6, table, th, td, ol, ul, li, summary, ruby, rt)${NO_FONT}`;

export function getOrdemFontSettings() {
    return Object.fromEntries(ORDEM_FONT_ROLES.map(({key}) => [key, game.settings.get(MODULE_ID, key)]));
}

export function buildOrdemFontCSS(settings, supports = () => true) {
    const definitions = new Set(), output = [];
    for (const entry of ORDEM_FONT_ROLES) {
        const profile = readFontProfile(settings[entry.key]);
        profile.definitions.forEach(rule => definitions.add(rule));
        const declarations = Object.entries(profile.declarations).filter(([property, value]) => supports(property, value));
        const family = declarations.find(([property]) => property === 'font-family');
        if (!family) continue;
        const base = `.lichsoma-op-message .lichsoma-op-${entry.role === 'header' ? 'title' : 'body'}`;
        const boundary = entry.role === 'body' ? ':not(:where(.lichsoma-op-title, .lichsoma-op-title *))' : '';
        output.push(`${base}${boundary}, ${base} ${TEXT}${boundary} { font-family: ${family[1]} !important; }`);
        const other = declarations.filter(([property]) => property !== 'font-family');
        if (other.length) output.push(`${base} { ${other.map(([p,v]) => `${p}: ${v} !important;`).join(' ')} }`);
    }
    const imports = [...definitions].filter(rule => /^@import\b/i.test(rule));
    const faces = [...definitions].filter(rule => !/^@import\b/i.test(rule));
    return [...imports, ...faces, output.length ? `@layer modules {\n${output.join('\n')}\n}` : ''].filter(Boolean).join('\n\n');
}

function storedClientValue(settings, moduleId, key) {
    return settings.storage?.get?.('client')?.getItem?.(`${moduleId}.${key}`) ?? null;
}

/** One-time transfer, never a fallback or synchronization between modules/roles. */
export async function migrateOrdemFonts(settings = game.settings) {
    if (settings.get(MODULE_ID, 'opFontsMigratedV1')) return;
    for (const {key, oldKey} of ORDEM_FONT_ROLES) {
        if (storedClientValue(settings, MODULE_ID, key) !== null || settings.get(MODULE_ID, key)) continue;
        const raw = storedClientValue(settings, 'lichsoma-ordem-interface', oldKey);
        if (raw === null) continue;
        let value;
        try { value = JSON.parse(raw); } catch { continue; }
        if (typeof value === 'string' && value.trim()) await settings.set(MODULE_ID, key, value);
    }
    await settings.set(MODULE_ID, 'opFontsMigratedV1', true);
}

function refreshFonts() {
    let style = document.getElementById('lichsoma-op-fonts');
    if (!style) {
        style = document.createElement('style');
        style.id = 'lichsoma-op-fonts';
        document.head.append(style);
    }
    style.textContent = buildOrdemFontCSS(getOrdemFontSettings(), (property, value) => CSS.supports(property, value));
}

export function initializeOrdemFonts() {
    for (const {key, label} of ORDEM_FONT_ROLES) {
        const titleKey = `SPEAKERSELECTOR.Ordem.Font.${label}.Name`;
        const savedKey = 'SPEAKERSELECTOR.Ordem.Font.Saved';
        game.settings.register(MODULE_ID, key, {
            name: titleKey, scope: 'client', config: false, type: String, default: '', onChange: refreshFonts
        });
        game.settings.registerMenu(MODULE_ID, `${key}Menu`, {
            name: titleKey, label: `SPEAKERSELECTOR.Ordem.Font.${label}.Edit`,
            hint: `SPEAKERSELECTOR.Ordem.Font.${label}.Hint`, icon: 'fa-solid fa-font', restricted: false,
            type: createCssSettingEditorClass({settingKey: key, titleKey, savedKey, defaultId: `lichsoma-${key}-editor`})
        });
    }
    game.settings.register(MODULE_ID, 'opFontsMigratedV1', {scope: 'client', config: false, type: Boolean, default: false});
    const onReady = async () => {
        try { await migrateOrdemFonts(); }
        catch (error) { console.warn(`[${MODULE_ID}] OP font transfer failed; it will retry on next load.`, error); }
        refreshFonts();
    };
    if (game.ready) void onReady();
    else Hooks.once('ready', onReady);
}
