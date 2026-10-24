// Identity keys for a Google Maps place. Claiming any shared key means it is the same business.

export function fidFromMapsUrl(url) {
    const raw = String(url || '');
    let text = raw;
    try { text = decodeURIComponent(raw); } catch { /* keep the raw url */ }
    const match = text.match(/1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || raw.match(/1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    return match ? match[1].toLowerCase() : null;
}

export function websiteHost(website) {
    try {
        return new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

export function normalizeLoose(value) {
    return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

export function preKeys(url) {
    if (!url) return [];
    const keys = [`url:${String(url).split('?')[0]}`];
    const fid = fidFromMapsUrl(url);
    if (fid) keys.push(`fid:${fid}`);
    return keys;
}

export function postKeys(place) {
    if (!place) return [];
    const keys = [];
    if (place.placeId) keys.push(`pid:${place.placeId}`);
    if (place.cid) keys.push(`cid:${place.cid}`);
    const host = websiteHost(place.website);
    if (place.phone && host) keys.push(`phone:${place.phone}|${host}`);
    const name = normalizeLoose(place.title);
    const postal = String(place.postalCode || '').replace(/\s+/g, '').toLowerCase();
    if (name && postal) keys.push(`name:${name}|${postal}`);
    const address = normalizeLoose(place.address);
    if (name && address) keys.push(`addr:${name}|${address}`);
    return keys;
}

export function createPlaceDeduper() {
    const seen = new Set();
    return {
        claim(keys) {
            const ids = [...new Set((keys || []).filter(Boolean))];
            if (!ids.length) return true;
            if (ids.some((id) => seen.has(id))) return false;
            for (const id of ids) seen.add(id);
            return true;
        },
        conflicts(keys) {
            return (keys || []).filter(Boolean).some((id) => seen.has(id));
        },
        remember(keys) {
            for (const id of keys || []) if (id) seen.add(id);
        },
    };
}
