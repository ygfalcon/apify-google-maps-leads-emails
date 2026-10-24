import { gotScraping } from './http.js';
import { parsePreviewPayload } from './place.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function extractPreviewUrl(html) {
    if (!html) return null;
    const match = String(html).match(/\/maps\/preview\/place\?[^"'\\\s<>]*pb=[^"'\\\s<>]+/i);
    if (!match) return null;
    // Keep percent-encoding. decodeURIComponent would turn a "%26" in the business name into "&" and split the query.
    const path = match[0]
        .replaceAll('&amp;', '&')
        .replaceAll('\\u0026', '&')
        .replaceAll('\\u003d', '=')
        .replaceAll('\\/', '/');
    return `https://www.google.com${path}`;
}

async function defaultFetch(url, { proxyUrl, timeoutMs = 12000 } = {}) {
    const res = await gotScraping({
        url,
        proxyUrl,
        timeout: { request: timeoutMs },
        followRedirect: true,
        retry: { limit: 0 },
        throwHttpErrors: false,
        headers: {
            'user-agent': UA,
            'accept-language': 'en-US,en;q=0.9',
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
    });
    const body = String(res.body ?? '');
    return { status: res.statusCode, body, bytes: Buffer.byteLength(body) };
}

export async function fetchPlaceDetail(placeUrl, options = {}) {
    const fetchImpl = options.fetchImpl || defaultFetch;
    const started = Date.now();
    let bytes = 0;
    const pageUrl = withLanguage(placeUrl, options.language || 'en');
    const html = await fetchImpl(pageUrl, options);
    bytes += html.bytes || 0;
    if (!html.body || (html.status && html.status >= 400)) {
        return { error: 'place_page_failed', place: null, bytes, ms: Date.now() - started };
    }
    const previewUrl = extractPreviewUrl(html.body);
    if (!previewUrl) return { error: 'preview_url_missing', place: null, bytes, ms: Date.now() - started };
    const preview = await fetchImpl(previewUrl, options);
    bytes += preview.bytes || 0;
    if (!preview.body || (preview.status && preview.status >= 400)) {
        return { error: 'preview_failed', place: null, bytes, ms: Date.now() - started };
    }
    const place = parsePreviewPayload(preview.body, { maxReviews: options.maxReviews || 0 });
    if (!place?.title) return { error: 'place_parse_failed', place: null, bytes, ms: Date.now() - started };
    return { error: null, place, bytes, ms: Date.now() - started };
}

function withLanguage(url, language) {
    try {
        const parsed = new URL(url);
        if (!parsed.searchParams.has('hl')) parsed.searchParams.set('hl', language);
        return parsed.href;
    } catch {
        return url;
    }
}
