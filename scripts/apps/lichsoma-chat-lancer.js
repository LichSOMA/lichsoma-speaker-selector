import { fetchTextAsset, uint8ArrayToBase64 } from '../lichsoma-shared-utils.js';

/**
 * LANCER — HTML 내보내기용 CSS 보정.
 *
 * LANCER 시스템의 채팅 카드 CSS를 내보낸 HTML에도 포함하되,
 * 채팅 메시지 바깥 프레임/헤더/본문 padding 및 background는
 * LichSOMA Speaker Selector 쪽 스타일이 우선하도록 정리한다.
 */
const LANCER_SYSTEM_ID = 'lancer';
const LANCER_MODULE_EXPORT_CSS_PATH = 'modules/lichsoma-speaker-selector/styles/export/lichsoma-chat-lancer-export.css';

const LANCER_EXPORT_CSS_PATHS = [
    'systems/lancer/fonts/compcon/glyphs.css',
    'systems/lancer/fonts/mdi.css',
    'systems/lancer/fonts/orbitron/orbitron.css',
    'systems/lancer/styles/lancer.css'
];


// LANCER의 cci-* 아이콘은 원래 compcon 아이콘 폰트로 표시된다.
// 내보낸 HTML을 Foundry 밖에서 열 때 폰트 로딩이 깨지는 환경이 있어,
// HTML export에서는 같은 시스템 SVG를 CSS mask로 강제 연결한다.
const LANCER_CCI_ICON_PATHS = {
    'cci-npc-template': 'assets/icons/npc_template.svg',
    'cci-license': 'assets/icons/license.svg',
    'cci-npc-feature': 'assets/icons/npc_feature.svg',
    'cci-npc-class': 'assets/icons/npc_class.svg',
    'cci-squad': 'assets/icons/squad.svg',
    'cci-status-downandout': 'assets/icons/status_downandout.svg',
    'cci-condition-immobilized': 'assets/icons/condition_immobilized.svg',
    'cci-condition-slow': 'assets/icons/condition_slow.svg',
    'cci-manufacturer': 'assets/icons/manufacturer.svg',
    'cci-condition-stunned': 'assets/icons/condition_stunned.svg',
    'cci-condition-shredded': 'assets/icons/condition_shredded.svg',
    'cci-condition-lock-on': 'assets/icons/condition_lockon.svg',
    'cci-condition-jammed': 'assets/icons/condition_jammed.svg',
    'cci-status-shut-down': 'assets/icons/status_shutdown.svg',
    'cci-status-prone': 'assets/icons/status_prone.svg',
    'cci-status-invisible': 'assets/icons/status_invisible.svg',
    'cci-status-hidden': 'assets/icons/status_hidden.svg',
    'cci-status-exposed': 'assets/icons/status_exposed.svg',
    'cci-status-engaged': 'assets/icons/status_engaged.svg',
    'cci-status-danger-zone': 'assets/icons/status_dangerzone.svg',
    'cci-activation-full': 'assets/icons/activation_full.svg',
    'cci-activation-quick': 'assets/icons/activation_quick.svg',
    'cci-tech-full': 'assets/icons/tech_full.svg',
    'cci-tech-quick': 'assets/icons/tech_quick.svg',
    'cci-edef': 'assets/icons/edef.svg',
    'cci-downtime': 'assets/icons/downtime.svg',
    'cci-evasion': 'assets/icons/evasion.svg',
    'cci-npc-tier-custom': 'assets/icons/npc_tier_custom.svg',
    'cci-npc-tier-3': 'assets/icons/npc_tier_3.svg',
    'cci-npc-tier-2': 'assets/icons/npc_tier_2.svg',
    'cci-npc-tier-1': 'assets/icons/npc_tier_1.svg',
    'cci-free-action': 'assets/icons/free_action.svg',
    'cci-reaction': 'assets/icons/reaction.svg',
    'cci-reserve-tac': 'assets/icons/reserve_tac.svg',
    'cci-reserve-mech': 'assets/icons/reserve_mech.svg',
    'cci-system-point': 'assets/icons/system_point.svg',
    'cci-generic-item': 'assets/icons/generic_item.svg',
    'cci-save': 'assets/icons/save.svg',
    'cci-sensor': 'assets/icons/sensor.svg',
    'cci-weapon-profile': 'assets/icons/weapon_profile.svg',
    'cci-protocol': 'assets/icons/protocol.svg',
    'cci-drone': 'assets/icons/drone.svg',
    'cci-skill': 'assets/icons/skill.svg',
    'cci-talent': 'assets/icons/talent.svg',
    'cci-grenade': 'assets/icons/grenade.svg',
    'cci-deployable': 'assets/icons/deployable.svg',
    'cci-content-manager': 'assets/icons/content_manager.svg',
    'cci-campaign': 'assets/icons/campaign.svg',
    'cci-encounter': 'assets/icons/encounter.svg',
    'cci-compendium': 'assets/icons/compendium.svg',
    'cci-mine': 'assets/icons/mine.svg',
    'cci-ship': 'assets/icons/ship.svg',
    'cci-vehicle': 'assets/icons/vehicle.svg',
    'cci-accuracy': 'assets/icons/accuracy.svg',
    'cci-activate': 'assets/icons/activate.svg',
    'cci-range': 'assets/icons/range.svg',
    'cci-burst': 'assets/icons/aoe_burst.svg',
    'cci-blast': 'assets/icons/aoe_blast.svg',
    'cci-cone': 'assets/icons/aoe_cone.svg',
    'cci-line': 'assets/icons/aoe_line.svg',
    'cci-corebonus': 'assets/icons/corebonus.svg',
    'cci-burn': 'assets/icons/damage_burn.svg',
    'cci-energy': 'assets/icons/damage_energy.svg',
    'cci-explosive': 'assets/icons/damage_explosive.svg',
    'cci-heat': 'assets/icons/damage_heat.svg',
    'cci-kinetic': 'assets/icons/damage_kinetic.svg',
    'cci-variable': 'assets/icons/damage_variable.svg',
    'cci-deactivate': 'assets/icons/deactivate.svg',
    'cci-condition-impaired': 'assets/icons/condition_impaired.svg',
    'cci-difficulty': 'assets/icons/difficulty.svg',
    'cci-frame': 'assets/icons/frame.svg',
    'cci-melee': 'assets/icons/melee.svg',
    'cci-overcharge': 'assets/icons/overcharge.svg',
    'cci-pilot': 'assets/icons/pilot.svg',
    'cci-thrown': 'assets/icons/thrown.svg',
    'cci-reactor': 'assets/icons/reactor.svg',
    'cci-repair': 'assets/icons/repair.svg',
    'cci-role-artillery': 'assets/icons/role_artillery.svg',
    'cci-role-controller': 'assets/icons/role_controller.svg',
    'cci-role-striker': 'assets/icons/role_striker.svg',
    'cci-role-support': 'assets/icons/role_support.svg',
    'cci-role-tank': 'assets/icons/role_tank.svg',
    'cci-role-defender': 'assets/icons/role_defender.svg',
    'cci-size-1': 'assets/icons/size_1.svg',
    'cci-size-2': 'assets/icons/size_2.svg',
    'cci-size-3': 'assets/icons/size_3.svg',
    'cci-size-4': 'assets/icons/size_4.svg',
    'cci-size-half': 'assets/icons/size_half.svg',
    'cci-structure': 'assets/icons/structure.svg',
    'cci-system': 'assets/icons/system.svg',
    'cci-mech-system': 'assets/icons/mech_system.svg',
    'cci-threat': 'assets/icons/threat.svg',
    'cci-weapon-mod': 'assets/icons/weapon_mod.svg',
    'cci-weaponmod': 'assets/icons/weapon_mod.svg',
    'cci-trait': 'assets/icons/trait.svg',
    'cci-weapon': 'assets/icons/weapon.svg',
    'cci-mech-weapon': 'assets/icons/mech_weapon.svg',
    'cci-rank-1': 'assets/icons/rank_1.svg',
    'cci-rank-2': 'assets/icons/rank_2.svg',
    'cci-rank-3': 'assets/icons/rank_3.svg',
    'cci-nested-hexagons': 'assets/icons/nested_hexagons.svg',
    'cci-orbit': 'assets/icons/orbit.svg',
    'cci-orbital': 'assets/icons/orbital.svg',
    'cci-large-beam': 'assets/icons/large_beam.svg',
    'cci-ammo': 'assets/icons/ammo.svg',
    'cci-burning': 'assets/icons/burning.svg',
    'cci-balance': 'assets/icons/balance.svg',
    'cci-reticule': 'assets/icons/reticule.svg',
    'cci-spikes': 'assets/icons/spikes.svg',
    'cci-eclipse': 'assets/icons/eclipse.svg',
    'cci-sword-array': 'assets/icons/sword_array.svg',
    'cci-marker': 'assets/icons/marker.svg',
    'cci-barrage': 'assets/icons/barrage.svg'
};

// LANCER 채팅 카드 일부는 Material Design Icons(mdi)를 사용한다.
// systems/lancer/fonts/mdi.css는 CDN @import만 포함되어 있는데, export HTML의 <style> 중간에
// @import가 들어가면 브라우저가 무시할 수 있다. 따라서 export 단계에서 공식 MDI CSS를
// 직접 가져와 webfont까지 Base64로 인라인 처리한다. cci-*는 LANCER 로컬 SVG를 쓰지만,
// mdi-*는 원래 외부 webfont 아이콘이므로 수동 SVG 경로로 대체하지 않는다.
const LANCER_MDI_CSS_URL = 'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css';
const LANCER_MDI_FONT_WOFF2_URL = 'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/fonts/materialdesignicons-webfont.woff2?v=7.4.47';

const LANCER_MDI_MINIMAL_FALLBACK_CSS = `/* --- Material Design Icons minimal fallback for exported HTML --- */
@font-face{
  font-family:"Material Design Icons";
  src:url("${LANCER_MDI_FONT_WOFF2_URL}") format("woff2");
  font-weight:normal;
  font-style:normal;
}
body.lichsoma-chat-log-export .mdi:before,
body.lichsoma-chat-log-export .mdi-set{
  display:inline-block;
  font:normal normal normal 24px/1 "Material Design Icons";
  font-size:inherit;
  text-rendering:auto;
  line-height:inherit;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
body.lichsoma-chat-log-export .mdi-fire-extinguisher:before{content:"\F0EF2";}
body.lichsoma-chat-log-export .mdi-dice-multiple:before{content:"\F076E";}
`;

function isLancerSystem() {
    return game.system?.id === LANCER_SYSTEM_ID;
}

function dirname(path) {
    return String(path || '').replace(/\/[^/]*$/, '');
}

function cssAssetMimeType(assetUrl, response) {
    const contentType = response?.headers?.get?.('content-type') || '';
    if (contentType && !/application\/octet-stream/i.test(contentType)) {
        return contentType.split(';')[0].trim();
    }

    let path = String(assetUrl || '');
    try {
        path = new URL(assetUrl).pathname;
    } catch (e) {
        // path fallback below
    }

    const clean = path.toLowerCase();
    if (clean.endsWith('.svg')) return 'image/svg+xml';
    if (clean.endsWith('.png')) return 'image/png';
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
    if (clean.endsWith('.gif')) return 'image/gif';
    if (clean.endsWith('.webp')) return 'image/webp';
    if (clean.endsWith('.woff2')) return 'font/woff2';
    if (clean.endsWith('.woff')) return 'font/woff';
    if (clean.endsWith('.ttf')) return 'font/ttf';
    if (clean.endsWith('.otf')) return 'font/otf';
    return 'application/octet-stream';
}

function shouldInlineCssAsset(assetUrl) {
    try {
        const url = new URL(assetUrl);
        const isLancerLocalAsset = url.origin === window.location.origin && url.pathname.startsWith('/systems/lancer/');
        const isMdiCdnFont = url.hostname === 'cdn.jsdelivr.net' && /\/@mdi\/font@7\.4\.47\/fonts\//i.test(url.pathname);
        if (!isLancerLocalAsset && !isMdiCdnFont) return false;
        return /\.(svg|png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(url.pathname);
    } catch (e) {
        return false;
    }
}

async function fetchCssAssetAsDataUrl(assetUrl) {
    try {
        const response = await fetch(assetUrl, {
            credentials: new URL(assetUrl).origin === window.location.origin ? 'same-origin' : 'omit'
        });
        if (!response.ok) return '';

        const mimeType = cssAssetMimeType(assetUrl, response);
        if (/image\/svg\+xml/i.test(mimeType)) {
            const text = await response.text();
            const bytes = new TextEncoder().encode(text || '');
            return `data:image/svg+xml;base64,${uint8ArrayToBase64(bytes)}`;
        }

        const buffer = await response.arrayBuffer();
        return `data:${mimeType};base64,${uint8ArrayToBase64(new Uint8Array(buffer))}`;
    } catch (error) {
        console.warn('lichsoma-speaker-selector: LANCER CSS asset Base64 변환 실패', assetUrl, error);
        return '';
    }
}

async function rewriteRelativeUrls(css, cssPath) {
    if (!css || !cssPath) return css || '';

    const base = /^https?:\/\//i.test(String(cssPath || ''))
        ? new URL('.', String(cssPath)).toString()
        : `${window.location.origin}/${dirname(cssPath).replace(/^\//, '')}/`;
    const text = String(css);
    const cache = new Map();
    const re = /url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^'")]+)\1\s*\)/gi;
    let out = '';
    let lastIndex = 0;
    let match;

    while ((match = re.exec(text)) !== null) {
        out += text.slice(lastIndex, match.index);

        const rawUrl = String(match[2] || '').trim();
        if (!rawUrl) {
            out += 'url("")';
            lastIndex = match.index + match[0].length;
            continue;
        }

        let resolvedUrl = '';
        try {
            resolvedUrl = new URL(rawUrl.replace(/^\.\//, ''), base).toString();
        } catch (e) {
            resolvedUrl = `${base}${rawUrl.replace(/^\.\//, '')}`;
        }

        let finalUrl = resolvedUrl;
        if (shouldInlineCssAsset(resolvedUrl)) {
            if (!cache.has(resolvedUrl)) {
                cache.set(resolvedUrl, await fetchCssAssetAsDataUrl(resolvedUrl));
            }
            finalUrl = cache.get(resolvedUrl) || resolvedUrl;
        }

        out += `url("${finalUrl}")`;
        lastIndex = match.index + match[0].length;
    }

    out += text.slice(lastIndex);
    return out;
}


let lancerCciIconCssCache = null;

function escapeCssString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

async function fetchLancerIconAsDataUrl(path) {
    const assetUrl = `${window.location.origin}/systems/lancer/${String(path || '').replace(/^\//, '')}`;
    return fetchCssAssetAsDataUrl(assetUrl);
}

async function buildLancerCciIconCss() {
    if (lancerCciIconCssCache) return lancerCciIconCssCache;

    lancerCciIconCssCache = (async () => {
        const rules = [];
        const entries = Object.entries(LANCER_CCI_ICON_PATHS);

        await Promise.all(entries.map(async ([className, path]) => {
            const dataUrl = await fetchLancerIconAsDataUrl(path);
            if (!dataUrl || !dataUrl.startsWith('data:image/')) return;

            const selector = `body.lichsoma-chat-log-export .${className}`;
            const escapedUrl = escapeCssString(dataUrl);
            rules.push(`${selector} {
  display: inline-block !important;
  flex: 0 0 auto !important;
  width: 1em !important;
  min-width: 1em !important;
  height: 1em !important;
  min-height: 1em !important;
  line-height: 1 !important;
  vertical-align: -0.125em !important;
  color: currentColor !important;
  font-family: inherit !important;
  font-style: normal !important;
  font-weight: normal !important;
  background-color: currentColor !important;
  -webkit-mask: url("${escapedUrl}") center / contain no-repeat !important;
  mask: url("${escapedUrl}") center / contain no-repeat !important;
}
${selector}::before {
  content: "" !important;
  display: none !important;
}`);
        }));

        if (!rules.length) return '';

        return `/* --- LANCER cci SVG icon fallback for exported HTML --- */
body.lichsoma-chat-log-export [class^="cci-"],
body.lichsoma-chat-log-export [class*=" cci-"] {
  speak: never;
}
${rules.join('\n\n')}`;
    })();

    return lancerCciIconCssCache;
}


let lancerMdiIconCssCache = null;
const lancerInlineCciSvgCache = new Map();

async function buildLancerMdiIconCss() {
    if (lancerMdiIconCssCache) return lancerMdiIconCssCache;

    lancerMdiIconCssCache = (async () => {
        const raw = await fetchTextAsset(LANCER_MDI_CSS_URL, { label: 'LANCER MDI CSS' });
        if (!raw?.trim()) return LANCER_MDI_MINIMAL_FALLBACK_CSS;

        const rewritten = await rewriteRelativeUrls(raw, LANCER_MDI_CSS_URL);
        return `/* --- Material Design Icons official CSS for exported HTML --- */
${rewritten}

/* Keep MDI webfont icons aligned inside exported LANCER chat cards. */
body.lichsoma-chat-log-export .mdi,
body.lichsoma-chat-log-export [class^="mdi-"],
body.lichsoma-chat-log-export [class*=" mdi-"] {
  speak: never;
}
body.lichsoma-chat-log-export .lancer-header i.mdi,
body.lichsoma-chat-log-export .lancer-button i.mdi {
  display: inline-flex !important;
  flex: 0 0 auto !important;
  align-items: center !important;
  justify-content: center !important;
  margin-right: 0.35em !important;
  vertical-align: -0.125em !important;
}
body.lichsoma-chat-log-export .lancer-button i.mdi {
  margin-right: 0.4em !important;
}`;
    })();

    return lancerMdiIconCssCache;
}

function sanitizeInlineSvg(svgText) {
    let svg = String(svgText || '').trim();
    if (!svg) return '';
    svg = svg
        .replace(/<\?xml[^>]*>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .trim();
    if (!/^<svg[\s>]/i.test(svg)) return '';
    svg = svg.replace(/<svg\b/i, '<svg aria-hidden="true" focusable="false"');
    return svg;
}

async function fetchLancerIconSvgMarkup(path) {
    const key = String(path || '');
    if (!key) return '';
    if (lancerInlineCciSvgCache.has(key)) return lancerInlineCciSvgCache.get(key);

    const assetUrl = `${window.location.origin}/systems/lancer/${key.replace(/^\//, '')}`;
    const promise = (async () => {
        try {
            const response = await fetch(assetUrl, { credentials: 'same-origin' });
            if (!response.ok) return '';
            return sanitizeInlineSvg(await response.text());
        } catch (error) {
            console.warn('lichsoma-speaker-selector: LANCER SVG icon inline 변환 실패', assetUrl, error);
            return '';
        }
    })();

    lancerInlineCciSvgCache.set(key, promise);
    return promise;
}

function getIconClass(element, prefix) {
    return Array.from(element?.classList || []).find((cls) => cls.startsWith(prefix) && cls !== prefix.replace(/-$/, '')) || '';
}

async function transformLancerExportIconsToInlineSvg(html) {
    if (!isLancerSystem() || !html || typeof html !== 'string') return html || '';

    const root = document.createElement('div');
    root.innerHTML = html;

    const icons = Array.from(root.querySelectorAll('i.cci, i[class*=" cci-"]'));
    if (!icons.length) return html;

    await Promise.all(icons.map(async (icon) => {
        const cciClass = getIconClass(icon, 'cci-');
        if (cciClass && LANCER_CCI_ICON_PATHS[cciClass]) {
            const svg = await fetchLancerIconSvgMarkup(LANCER_CCI_ICON_PATHS[cciClass]);
            if (svg) {
                icon.innerHTML = svg;
                icon.classList.add('lichsoma-lancer-inline-icon', 'lichsoma-lancer-inline-cci-icon');
                icon.setAttribute('aria-hidden', 'true');
            }
        }
    }));

    return root.innerHTML;
}

function sanitizeLancerCssForExport(css) {
    if (!css) return '';
    let out = String(css);

    // 내보낸 HTML은 <ol id="chat-log" class="chat-log chat-scroll ..."> 구조를 사용하므로
    // LANCER 원본 CSS의 #chat-log 스코프가 그대로 동작한다.

    // LANCER 원본의 메시지 프레임/헤더/본문 배경 및 padding은
    // Speaker Selector의 채팅 헤더/본문 스타일과 충돌하므로 제거한다.
    out = out
        .replace(/#chat-log\s+\.message\s*,\s*\.chat-popout\s+\.message\s*\{[^{}]*\}/g, '')
        .replace(/#chat-log\s+\.message-header\s*,\s*\.chat-popout\s+\.message-header\s*\{[^{}]*\}/g, '')
        .replace(/#chat-log\s+\.message-header\s+\*\s*,\s*\.chat-popout\s+\.message-header\s+\*\s*\{[^{}]*\}/g, '')
        .replace(/#chat-log\s+\.message-content\s*,\s*\.chat-popout\s+\.message-content\s*\{[^{}]*\}/g, '');

    return out;
}

function getCurrentLancerThemeCssVariables() {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const keys = [
        '--color-shadow-primary',
        '--primary-color',
        '--primary-highlight',
        '--light-text',
        '--dark-text',
        '--background-color',
        '--secondary-color',
        '--secondary-highlight',
        '--secondary-text',
        '--dark-gray-color',
        '--light-gray-color',
        '--tooltip-background',
        '--tooltip-text',
        '--ref-color',
        '--system-color',
        '--weapon-color',
        '--trait-color',
        '--mod-color',
        '--bonus-color',
        '--bonus-list-color',
        '--tech-color',
        '--talent-color',
        '--pilot-stat-color',
        '--reaction-color',
        '--protocol-color',
        '--quick-color',
        '--full-color',
        '--free-color',
        '--move-color',
        '--crit-color',
        '--hit-color',
        '--miss-color',
        '--error-color',
        '--accurate-color',
        '--difficult-color',
        '--darken-color',
        '--lighten-color'
    ];

    const pairs = [];
    for (const key of keys) {
        const value = (bodyStyle.getPropertyValue(key) || rootStyle.getPropertyValue(key) || '').trim();
        if (value) pairs.push(`  ${key}: ${value};`);
    }

    if (!pairs.length) return '';
    return `:root {\n${pairs.join('\n')}\n}`;
}

async function fetchLancerLogExportAdditionalCss() {
    if (!isLancerSystem()) return '';

    const cssParts = [];
    const themeVars = getCurrentLancerThemeCssVariables();
    if (themeVars) cssParts.push(`/* --- LANCER current theme variables --- */\n${themeVars}`);

    for (const path of LANCER_EXPORT_CSS_PATHS) {
        // LANCER의 mdi.css는 CDN @import만 담고 있어 export HTML의 style 중간에 들어가면 무시될 수 있다.
        // 필요한 mdi 아이콘은 아래 buildLancerMdiIconCss()/HTML transform에서 직접 처리한다.
        if (/\/fonts\/mdi\.css$/i.test(path)) continue;

        const raw = await fetchTextAsset(path, { label: 'LANCER CSS' });
        if (!raw) continue;
        const rewritten = await rewriteRelativeUrls(raw, path);
        const sanitized = path.endsWith('/lancer.css') || path.endsWith('lancer.css')
            ? sanitizeLancerCssForExport(rewritten)
            : rewritten;
        if (sanitized.trim()) {
            cssParts.push(`/* --- ${path} (export) --- */\n${sanitized}`);
        }
    }

    const cciIconCss = await buildLancerCciIconCss();
    if (cciIconCss?.trim()) cssParts.push(cciIconCss);

    const mdiIconCss = await buildLancerMdiIconCss();
    if (mdiIconCss?.trim()) cssParts.push(mdiIconCss);

    const moduleExportCss = await fetchTextAsset(LANCER_MODULE_EXPORT_CSS_PATH, { label: 'LANCER module export CSS' });
    if (moduleExportCss?.trim()) {
        cssParts.push(`/* --- lichsoma-chat-lancer-export.css --- */\n${moduleExportCss}`);
    }

    return `/* --- LANCER chat export CSS --- */\n${cssParts.join('\n\n')}`;
}

let initialized = false;

export function initializeSystemAdapter() {
    if (initialized || !isLancerSystem()) return;
    initialized = true;

    const register = () => {
        Hooks.on('lichsoma-speaker-selector.chatLogExportAdditionalCSS', () => fetchLancerLogExportAdditionalCss());
        Hooks.on('lichsoma-speaker-selector.chatLogExportHTMLTransform', (html) => transformLancerExportIconsToInlineSvg(html));
    };

    if (game.ready) register();
    else Hooks.once('ready', register);
}
