// Coerce actor input before it reaches Maps URLs, billing, or the browser.

const LANGUAGE = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i;

export function coerceBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    const text = String(value).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    return fallback;
}

export function clampInt(value, min, max, fallback) {
    const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

function clip(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeLanguage(value) {
    const text = String(value ?? '').trim();
    return LANGUAGE.test(text) ? text.toLowerCase() : 'en';
}

export function isGoogleMapsUrl(value) {
    const raw = value && typeof value === 'object' ? value.url : value;
    if (typeof raw !== 'string' || !raw.trim()) return false;
    let url;
    try {
        url = new URL(raw.trim());
    } catch {
        return false;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const mapsPath = url.pathname === '/maps' || url.pathname.startsWith('/maps/');
    if (host === 'maps.google.com' || /^maps\.google\.(?:[a-z]{2,3}|com?\.[a-z]{2}|co\.[a-z]{2})$/.test(host)) {
        return url.pathname === '/' || mapsPath;
    }
    const labels = host.split('.');
    if (labels[0] !== 'google' || labels.length > 3 || !mapsPath) return false;
    if (labels.length === 2) return labels[1] === 'com' || /^[a-z]{2,3}$/.test(labels[1]);
    return /^(?:com|co|org|net|ac|gov)\.[a-z]{2}$/.test(`${labels[1]}.${labels[2]}`);
}

export function normalizeStartUrls(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const kept = [];
    for (const entry of list) {
        if (!isGoogleMapsUrl(entry)) continue;
        const raw = entry && typeof entry === 'object' ? entry.url : entry;
        const url = new URL(String(raw).trim());
        url.protocol = 'https:';
        url.username = '';
        url.password = '';
        kept.push(url.href);
        if (kept.length >= 50) break;
    }
    return kept;
}

function normalizeTerms(value) {
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => clip(item, 200)).filter(Boolean).slice(0, 25);
}

export function normalizeRunInput(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
    if ('searchTerms' in source) source.searchTerms = normalizeTerms(source.searchTerms);
    if ('location' in source) source.location = clip(source.location, 120);
    if ('language' in source) source.language = normalizeLanguage(source.language);
    if ('startUrls' in source) source.startUrls = normalizeStartUrls(source.startUrls);
    if ('maxPlacesPerSearch' in source) source.maxPlacesPerSearch = clampInt(source.maxPlacesPerSearch, 1, 500, 20);
    if ('maxContactPages' in source) source.maxContactPages = clampInt(source.maxContactPages, 1, 6, 3);
    if ('maxReviews' in source) source.maxReviews = clampInt(source.maxReviews, 0, 8, 0);
    if ('minRating' in source) source.minRating = clampInt(source.minRating, 0, 5, 0);
    if ('extractContacts' in source) source.extractContacts = coerceBool(source.extractContacts, true);
    if ('skipClosed' in source) source.skipClosed = coerceBool(source.skipClosed, false);
    return source;
}
