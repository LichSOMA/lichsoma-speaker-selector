// Image payloads stay outside message HTML and are saved once per unique image.
export const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CONCURRENT_IMAGES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function imageError(reason, retryable = false) {
    const error = new Error(reason);
    error.reason = reason;
    error.retryable = retryable;
    return error;
}

export function normalizeExportImageUrl(value, baseUrl = location.origin) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const base = baseUrl === location.origin ? document.baseURI : `${baseUrl.replace(/\/+$/, '')}/`;
        const url = new URL(value.trim(), base);
        return ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

async function readResponseBlob(response, maxBytes, signal, touch) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) {
        await response.body?.cancel().catch(() => {});
        throw imageError('too-large');
    }
    if (!response.body?.getReader) {
        const blob = await response.blob();
        if (blob.size > maxBytes) throw imageError('too-large');
        return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            if (signal.aborted) throw imageError('download-timeout', true);
            const { done, value } = await reader.read();
            if (done) break;
            touch();
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel().catch(() => {});
                throw imageError('too-large');
            }
            chunks.push(value);
        }
        return new Blob(chunks, { type: response.headers.get('content-type') || '' });
    } finally {
        reader.releaseLock();
    }
}

export async function fetchExportImageBlob(url, {
    maxBytes = MAX_EMBEDDED_IMAGE_BYTES, retries = 3,
    timeoutMs = 300_000, idleTimeoutMs = 30_000, backoffMs = 400
} = {}) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        const controller = new AbortController();
        let idleTimer;
        const touch = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
        };
        const totalTimer = setTimeout(() => controller.abort(), timeoutMs);
        touch();
        try {
            const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
            touch();
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                throw imageError(`http-${response.status}`, RETRYABLE_STATUS.has(response.status));
            }
            return await readResponseBlob(response, maxBytes, controller.signal, touch);
        } catch (error) {
            lastError = controller.signal.aborted ? imageError('download-timeout', true) : error;
        } finally {
            clearTimeout(totalTimer);
            clearTimeout(idleTimer);
        }
        if (lastError.retryable === false || attempt + 1 === retries) break;
        await wait(backoffMs * (2 ** attempt));
    }
    throw lastError;
}

async function imageMime(blob) {
    if (!blob.size) throw imageError('empty-image');
    const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
    if (starts(255, 216, 255)) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 2) === 'BM') return 'image/bmp';
    if (starts(0, 0, 1, 0)) return 'image/x-icon';
    if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 40))) return 'image/avif';
    const type = blob.type.split(';')[0].toLowerCase();
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trimStart()
        .replace(/^<\?xml[^]*?\?>\s*/i, '').replace(/<!--[^]*?-->/g, '').trimStart();
    if (/^<(?:!doctype\s+html|html\b|body\b)/i.test(text)) throw imageError('invalid-image');
    if (/^<(?:!doctype\s+svg|svg\b)/i.test(text) || type === 'image/svg+xml') return 'image/svg+xml';
    if (/^image\/[a-z0-9.+-]+$/.test(type)) return type;
    throw imageError('invalid-image');
}

function readDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(imageError('encode-failed'));
        reader.onerror = () => reject(reader.error || imageError('encode-failed'));
        reader.onabort = () => reject(imageError('encode-aborted'));
        reader.readAsDataURL(blob);
    });
}

export async function imageToExportRecord(src, baseUrl, options = {}) {
    const absoluteUrl = normalizeExportImageUrl(src, baseUrl);
    try {
        if (!absoluteUrl) throw imageError('invalid-url');
        const maxBytes = options.maxBytes ?? MAX_EMBEDDED_IMAGE_BYTES;
        // Avoid decoding an already oversized Base64 string into another large buffer.
        if (/^data:[^,]*;base64,/i.test(absoluteUrl)) {
            const payload = absoluteUrl.slice(absoluteUrl.indexOf(',') + 1).replace(/\s/g, '');
            const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
            if (Math.floor(payload.length * 3 / 4) - padding > maxBytes) throw imageError('too-large');
        }
        const blob = await fetchExportImageBlob(absoluteUrl, options);
        const type = await imageMime(blob);
        const dataUrl = await readDataUrl(blob.type === type ? blob : blob.slice(0, blob.size, type));
        return { dataUrl, byteSize: blob.size, absoluteUrl, reason: null };
    } catch (error) {
        return { dataUrl: '', byteSize: 0, absoluteUrl, reason: error.reason || 'fetch-failed' };
    }
}

async function hash(value) {
    let result = 0;
    for (let index = 0; index < value.length; index++) {
        result = ((result << 5) - result + value.charCodeAt(index)) | 0;
        if (index && index % (8 * 1024 * 1024) === 0) await wait(0);
    }
    return Math.abs(result).toString(36);
}

function removeResponsiveSources(img) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
}

export function createExportImagePipeline({ baseUrl = location.origin, preserveDimensions = () => {} } = {}) {
    const registry = new Map(), reverse = new Map(), cache = new Map(), failures = new Map();
    async function register(dataUrl) {
        const base = await hash(dataUrl) || 'image';
        const candidates = reverse.get(base) || [];
        for (const candidate of candidates) {
            const payload = registry.get(candidate);
            if (payload.length === dataUrl.length && await payload.blob.text() === dataUrl) return candidate;
        }
        let key = base, suffix = 2;
        while (registry.has(key)) key = `${base}-${suffix++}`;
        registry.set(key, { blob: new Blob([dataUrl]), length: dataUrl.length });
        candidates.push(key);
        reverse.set(base, candidates);
        return key;
    }
    async function process(container) {
        const groups = new Map();
        for (const img of container.querySelectorAll('img[src], img[srcset], picture img')) {
            const set = img.getAttribute('srcset') || img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset') || '';
            const src = img.getAttribute('src') || img.currentSrc || set.trim().split(/\s+/)[0].replace(/,$/, '');
            const url = normalizeExportImageUrl(src, baseUrl);
            const key = url || src || '(empty image source)';
            if (!groups.has(key)) groups.set(key, { src, images: [] });
            groups.get(key).images.push(img);
        }
        const queue = [...groups.entries()];
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_IMAGES, queue.length) }, async () => {
            while (next < queue.length) {
                const [sourceKey, { src, images }] = queue[next++];
                if (!cache.has(sourceKey)) cache.set(sourceKey, (async () => {
                    const record = await imageToExportRecord(src, baseUrl);
                    return { key: record.dataUrl ? await register(record.dataUrl) : null,
                        absoluteUrl: record.absoluteUrl, reason: record.reason };
                })());
                const record = await cache.get(sourceKey);
                const key = record.key;
                if (!key) failures.set(sourceKey, record.reason);
                for (const img of images) {
                    preserveDimensions(img);
                    if (!key) {
                        if (record.absoluteUrl) img.setAttribute('src', record.absoluteUrl);
                        continue;
                    }
                    removeResponsiveSources(img);
                    img.setAttribute('data-lichsoma-image-src-key', key);
                    img.removeAttribute('src');
                    img.closest('.message-header, .lichsoma-chat-header, .item-header')
                        ?.querySelectorAll('[data-lichsoma-portrait-src], [data-lichsoma-original-src]')
                        .forEach(el => { el.removeAttribute('data-lichsoma-portrait-src'); el.removeAttribute('data-lichsoma-original-src'); });
                    img.closest('.lichsoma-chat-portrait-container')?.removeAttribute('data-preview-attached');
                }
                await wait(0);
            }
        }));
    }
    function payloadParts() {
        const parts = ['<script id="lichsoma-image-registry" type="application/json">{"format":2}</script>\n'];
        for (const [key, payload] of registry) {
            // FileReader produces canonical image MIME + Base64, with no HTML delimiters.
            parts.push(`<script type="application/octet-stream" data-lichsoma-embedded-image="${key}">`, payload.blob, '</script>\n');
        }
        return parts;
    }
    return { process, payloadParts,
        get failures() { return new Map(failures); },
        get count() { return registry.size; },
        release() { registry.clear(); reverse.clear(); cache.clear(); }
    };
}

// Standalone: this function is serialized into the saved HTML, without module imports.
async function restoreExportImages(failureText) {
    const failedKeys = new Set();
    const images = new Map();
    document.querySelectorAll('img[data-lichsoma-image-src-key]').forEach(img => {
        const key = img.getAttribute('data-lichsoma-image-src-key');
        if (!images.has(key)) images.set(key, []);
        images.get(key).push(img);
    });
    for (const element of document.querySelectorAll('script[data-lichsoma-embedded-image]')) {
        const key = element.getAttribute('data-lichsoma-embedded-image');
        try {
            const data = element.textContent;
            const comma = data.indexOf(',');
            const type = data.slice(5, data.indexOf(';'));
            if (comma < 0 || !/^image\/[a-z0-9.+-]+$/i.test(type)) throw new Error('Invalid image payload');
            const chunks = [];
            const size = 1024 * 1024; // Base64 boundaries must be divisible by four.
            for (let offset = comma + 1; offset < data.length; offset += size) {
                const binary = atob(data.slice(offset, offset + size));
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
                chunks.push(bytes);
                if (chunks.length % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            }
            const url = URL.createObjectURL(new Blob(chunks, { type }));
            for (const img of images.get(key) || []) {
                img.removeAttribute('srcset');
                img.removeAttribute('sizes');
                img.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
                img.src = url;
                img.removeAttribute('data-lichsoma-image-src-key');
            }
            const first = images.get(key)?.[0];
            if (first?.decode) await first.decode();
        } catch (error) {
            failedKeys.add(key);
            console.error('LichSOMA embedded image restore failed.', key, error);
        } finally { element.remove(); }
    }
    for (const [key, group] of images) {
        if (group.some(img => img.hasAttribute('data-lichsoma-image-src-key'))) failedKeys.add(key);
    }
    const failed = failedKeys.size;
    if (failed) {
        const warning = document.createElement('p');
        warning.setAttribute('role', 'status');
        warning.textContent = failureText;
        document.querySelector('.chat-outer')?.prepend(warning);
    }
    document.dispatchEvent(new CustomEvent('lichsoma-export-images-restored', { detail: { failed } }));
}

export function buildExportImageRestoreScript(failureText) {
    const text = JSON.stringify(String(failureText)).replace(/</g, '\\u003c');
    return `(${restoreExportImages.toString()})(${text});`;
}
