// Google Maps stops a single search feed at about 120 places. When the user asked for more than that
// and the feed actually filled up, split the viewport into four closer searches. A short feed is the
// whole area, so it is not split.

export const MAPS_SEARCH_CAP = 120;
export const MAX_SPLIT_REQUESTS = 200;

export function feedNeedsRetry({ found, wanted, ended, retryCount = 0, depth = 0, cap = MAPS_SEARCH_CAP } = {}) {
    if (ended || found >= wanted) return false;
    // A full feed is the Maps cap, not a stall. Splitting beats scrolling the same view again.
    if (shouldSplitArea({ found, wanted, depth, cap })) return false;
    return retryCount < 2;
}

export function shouldSplitArea({ found, wanted, depth = 0, maxDepth = 3, cap = MAPS_SEARCH_CAP } = {}) {
    const level = Number(depth);
    if (!Number.isFinite(level) || level < 0 || level >= maxDepth) return false;
    if (!(wanted > found)) return false;
    if (found < cap - 20) return false;
    return true;
}

export function parseMapView(url) {
    const match = String(url || '').match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    if (!match) return null;
    return { lat: Number(match[1]), lng: Number(match[2]), zoom: Number(match[3]) };
}

function wrapLng(lng) {
    let value = lng;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
}

export function childViews(view) {
    const parentZoom = Number(view?.zoom) || 12;
    const zoom = Math.min(parentZoom + 1, 20);
    const tileDegrees = 360 / (2 ** parentZoom);
    const offset = (3.5 * tileDegrees) / 4;
    const views = [];
    for (const latSign of [1, -1]) {
        for (const lngSign of [-1, 1]) {
            views.push({
                lat: Math.max(-85, Math.min(85, view.lat + latSign * offset)),
                lng: wrapLng(view.lng + lngSign * offset),
                zoom,
            });
        }
    }
    return views;
}

export function mapsSearchUrl({ term, location, language = 'en', view } = {}) {
    const raw = String(language || '');
    const hl = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(raw) ? raw.toLowerCase() : 'en';
    if (!view) {
        const query = location ? `${term} in ${location}` : term;
        return `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${hl}`;
    }
    return `https://www.google.com/maps/search/${encodeURIComponent(term)}/@${Number(view.lat)},${Number(view.lng)},${Number(view.zoom)}z?hl=${hl}`;
}

export function planAreaSplits({ found, wanted, depth = 0, view, term, location, language = 'en', seenKeys } = {}) {
    if ((seenKeys?.size || 0) >= MAX_SPLIT_REQUESTS) return [];
    if (!view || !shouldSplitArea({ found, wanted, depth })) return [];
    const seen = seenKeys || new Set();
    const requests = [];
    for (const child of childViews(view)) {
        const uniqueKey = `area:${term}:${child.lat},${child.lng},${child.zoom}`;
        if (seen.has(uniqueKey)) continue;
        requests.push({
            url: mapsSearchUrl({ term, location, language, view: child }),
            uniqueKey,
            userData: { term, depth: depth + 1, view: child },
        });
    }
    return requests;
}
