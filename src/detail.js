import { gotScraping } from './http.js';
import { parsePreviewPayload } from './place.js';
import { redactSecrets } from './redact.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HTTP_DETAIL_ERRORS = new Set(['place_page_failed', 'preview_failed', 'preview_url_missing', 'place_parse_failed']);

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

async function defaultFetch(url, { proxyUrl, timeoutMs = 12000, signal } = {}) {
    const res = await gotScraping({
        url,
        proxyUrl,
        signal,
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

export function shouldRetryDetail(error) {
    return error === 'place_page_failed' || error === 'preview_failed' || error === 'preview_url_missing' || error === 'hard_timeout';
}

async function loadPlace(placeUrl, options, started) {
    const fetchImpl = options.fetchImpl || defaultFetch;
    const timeoutMs = options.timeoutMs ?? 12000;
    const deadline = started + timeoutMs;
    let bytes = 0;
    const hop = async (url) => {
        const remaining = Math.max(1, deadline - Date.now());
        if (Date.now() >= deadline) throw new Error('hard_timeout');
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                fetchImpl(url, { ...options, signal: controller.signal, timeoutMs: remaining }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(new Error('hard_timeout'));
                    }, remaining);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const pageUrl = withLanguage(placeUrl, options.language || 'en');
        const html = await hop(pageUrl);
        bytes += html?.bytes || 0;
        if (!html?.body || (html.status && html.status >= 400)) {
            return { error: 'place_page_failed', place: null, bytes, ms: Date.now() - started };
        }
        const previewUrl = extractPreviewUrl(html.body);
        if (!previewUrl) return { error: 'preview_url_missing', place: null, bytes, ms: Date.now() - started };
        const preview = await hop(previewUrl);
        bytes += preview?.bytes || 0;
        if (!preview?.body || (preview.status && preview.status >= 400)) {
            return { error: 'preview_failed', place: null, bytes, ms: Date.now() - started };
        }
        const place = parsePreviewPayload(preview.body, { maxReviews: options.maxReviews || 0 });
        if (!place?.title) return { error: 'place_parse_failed', place: null, bytes, ms: Date.now() - started };
        return { error: null, place, bytes, ms: Date.now() - started };
    } catch (err) {
        const error = err?.message === 'hard_timeout' ? 'hard_timeout' : redactSecrets(err?.message || 'place_page_failed');
        return { error, place: null, bytes, ms: Date.now() - started };
    }
}

export async function fetchPlaceDetail(placeUrl, options = {}) {
    const started = Date.now();
    const first = await loadPlace(placeUrl, options, started);
    // A proxy that drops the connection is retried once directly, inside the same deadline.
    // An HTTP status (including a block) is returned and is not bypassed.
    if (first.place || !options.proxyUrl || HTTP_DETAIL_ERRORS.has(first.error)) return first;
    return loadPlace(placeUrl, { ...options, proxyUrl: undefined }, started);
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
