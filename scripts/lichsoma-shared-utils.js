const MODULE_ID = 'lichsoma-speaker-selector';

export function normalizeFontFamilyName(value) {
    if (value == null || typeof value !== 'string') return '';
    let text = value.trim();
    while (text.length >= 2) {
        const first = text[0];
        const last = text[text.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            text = text.slice(1, -1).trim();
        } else {
            break;
        }
    }
    return text;
}

function stripCssComments(cssText) {
    return String(cssText ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function extractPreferredWebfontBlock(cssText) {
    const css = stripCssComments(cssText);
    const marker = css.match(/\.(?:lichsoma-webfont-settings|lichsoma-webfont-family-marker)\s*\{([\s\S]*?)\}/i);
    return marker?.[1] || '';
}

function extractFirstDeclaration(cssText, propertyName) {
    const css = stripCssComments(cssText);
    const escapedProperty = String(propertyName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedProperty}\\s*:\\s*([^;}{]+)`, 'i');
    const preferredBlock = extractPreferredWebfontBlock(css);
    const match = (preferredBlock && preferredBlock.match(pattern)) || css.match(pattern);
    return String(match?.[1] ?? '').replace(/\s*!important\s*$/i, '').trim();
}

export function extractFirstFontFamily(cssText) {
    const declaration = extractFirstDeclaration(cssText, 'font-family');
    if (!declaration) return '';
    const firstFamily = declaration.split(',')[0]?.trim() ?? '';
    return normalizeFontFamilyName(firstFamily);
}

function normalizeFontWeight(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (/^(?:normal|bold|bolder|lighter)$/i.test(text)) return text.toLowerCase();
    if (/^var\(.+\)$/i.test(text)) return text;
    if (/^\d{1,4}$/.test(text)) {
        const numeric = Number(text);
        return numeric >= 1 && numeric <= 1000 ? String(numeric) : '';
    }
    // @font-face의 가변 범위(예: 200 900)는 요소의 font-weight 값으로는 쓸 수 없다.
    return '';
}

function normalizeFontStyle(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (/^(?:normal|italic)$/i.test(text)) return text.toLowerCase();
    if (/^oblique(?:\s+-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn))?$/i.test(text)) return text;
    if (/^var\(.+\)$/i.test(text)) return text;
    return '';
}

function normalizeFontVariationSettings(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (/^normal$/i.test(text)) return 'normal';
    if (/^var\(.+\)$/i.test(text)) return text;
    // 브라우저가 최종 유효성을 판단하도록 선언값은 보존하되, CSS 블록을 깨는 문자는 거부한다.
    if (/[{};]/.test(text)) return '';
    return text;
}

export function extractWebfontPresentation(cssText) {
    return {
        family: extractFirstFontFamily(cssText),
        weight: normalizeFontWeight(extractFirstDeclaration(cssText, 'font-weight')),
        style: normalizeFontStyle(extractFirstDeclaration(cssText, 'font-style')),
        variationSettings: normalizeFontVariationSettings(extractFirstDeclaration(cssText, 'font-variation-settings'))
    };
}

export function escapeCssString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ');
}

export function quoteFontFamily(value) {
    const normalized = normalizeFontFamilyName(value);
    return normalized ? `"${escapeCssString(normalized)}"` : '';
}

export function getMessageAuthorId(message) {
    return message?.author?.id || message?.user?.id || message?.user || null;
}

export function getMessageAuthorName(message) {
    if (!message) return '';
    if (message.author && typeof message.author === 'object' && 'name' in message.author) {
        return message.author.name || '';
    }

    const authorId = getMessageAuthorId(message);
    return authorId ? (game.users?.get(authorId)?.name || '') : '';
}

export function getMessageAuthorColor(message) {
    if (!message) return null;
    if (message.author && typeof message.author === 'object' && 'color' in message.author) {
        return message.author.color || null;
    }

    const authorId = getMessageAuthorId(message);
    return authorId ? (game.users?.get(authorId)?.color || null) : null;
}

export async function fetchTextAsset(path, {
    label = '텍스트 에셋',
    trim = true,
    warn = true
} = {}) {
    const rawPath = String(path || '');
    if (!rawPath) return '';

    const url = /^https?:\/\//i.test(rawPath)
        ? rawPath
        : `${window.location.origin}/${rawPath.replace(/^\//, '')}`;

    try {
        const parsedUrl = new URL(url, window.location.origin);
        const response = await fetch(parsedUrl.href, {
            credentials: parsedUrl.origin === window.location.origin ? 'same-origin' : 'omit'
        });
        if (!response.ok) return '';
        const text = await response.text();
        if (!trim) return text;
        return text.trim() ? text : '';
    } catch (error) {
        if (warn) {
            console.warn(`${MODULE_ID}: ${label} 로드 실패`, path, error);
        }
        return '';
    }
}

export function uint8ArrayToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
