// Website contact enrichment: emails, phones, social profiles. Plain HTTP (no browser), retries, small page budget.
import { gotScraping } from './http.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|^(u00|x22)|@\d+x\./i;
const BAD_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|json|php|html?|aspx?|woff2?|ttf|mp4|pdf|local|invalid|test|example)$/i;
const BAD_DOMAIN = /@(?:[a-z0-9-]+\.)*(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|mysite\.com|website\.com|company\.com|sentry\.io|sentry\.wixpress\.com|wixpress\.com|godaddy\.com|placeholder\.com|test\.com)$/i;
const BAD_LOCAL = /^(john\.wick|john\.doe|jane\.doe|user|name|your|yourname|youremail|test|email|example|sample|firstname\.lastname|first\.last|username|info@domain)@/i;
export function isPlausibleEmail(e) {
    if (!e || e.length >= 80 || BAD_EMAIL.test(e) || BAD_TLD.test(e) || BAD_DOMAIN.test(e) || BAD_LOCAL.test(e)) return false;
    const [local, domain] = e.split('@');
    if (!local || !domain || domain.includes('..') || local.startsWith('.') || /^[0-9a-f]{24,}$/i.test(local)) return false;
    return true;
}
const SOCIAL = {
    facebook: /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|plugins|tr\b|dialog)[A-Za-z0-9_.\-/]+/gi,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|share)[A-Za-z0-9_.]+/gi,
    linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[A-Za-z0-9_\-%.]+/gi,
    twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]{1,15}(?=["'\/?#\s<])/gi,
    tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/gi,
    youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[A-Za-z0-9_\-.]+/gi,
    pinterest: /https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/(?!pin\/)[A-Za-z0-9_]+/gi,
};
const CONTACT_HINT = /contact|kontakt|about|impressum|team|support|get-in-touch/i;

async function fetchHtml(url, proxyUrl, timeoutMs = 15000, attempts = 2) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await gotScraping({ url, proxyUrl, timeout: { request: timeoutMs }, followRedirect: true, retry: { limit: 0 }, throwHttpErrors: false });
            const type = String(res.headers['content-type'] || '');
            const html = String(res.body ?? '');
            if (res.statusCode < 400 && type.includes('html')) return { html: html.slice(0, 2_000_000), finalUrl: res.url, bytes: Buffer.byteLength(html) };
            if (res.statusCode < 500) return null;
        } catch { /* retry */ }
    }
    return null;
}

export function extractFromHtml(html, baseUrl) {
    const decoded = html.replace(/&#64;|\[at\]|\(at\)/gi, '@').replace(/%40/g, '@');
    const emails = new Set();
    for (const m of decoded.matchAll(/mailto:([^"'?>\s]+)/gi)) { let v = m[1]; try { v = decodeURIComponent(v); } catch {} const e = v.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/); if (e) emails.add(e[0].toLowerCase()); }
    for (const m of decoded.match(EMAIL_RE) || []) emails.add(m.toLowerCase());
    const phones = new Set();
    for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) phones.add(decodeURIComponent(m[1]).replace(/[^\d+]/g, ''));
    const socials = {};
    for (const [k, re] of Object.entries(SOCIAL)) {
        const found = new Set((html.match(re) || []).map((u) => u.replace(/[/"']+$/, '').replace(/^http:/, 'https:')));
        if (found.size) socials[k] = [...found].slice(0, 5);
    }
    const links = [];
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
        try { const u = new URL(m[1], baseUrl); if (CONTACT_HINT.test(u.pathname) && u.host === new URL(baseUrl).host) links.push(u.href); } catch {}
    }
    return {
        emails: [...emails].map((e) => e.replace(/^[^a-z0-9]+|[^a-z]+$/g, '')).filter(isPlausibleEmail),
        phones: [...phones].filter((p) => p.length >= 7),
        socials, contactLinks: [...new Set(links)].slice(0, 3),
    };
}

export async function enrichWebsite(website, { proxyUrl, maxPages = 3, timeoutMs = 15000, attempts = 2 } = {}) {
    const out = { emails: [], phones: [], socials: {}, pagesScanned: 0, bytes: 0, error: null };
    if (!website) return out;
    let url = website.startsWith('http') ? website : `https://${website}`;
    const first = await fetchHtml(url, proxyUrl, timeoutMs, attempts);
    if (!first) { out.error = 'website_unreachable'; return out; }
    const queue = [first]; const seen = new Set([first.finalUrl]);
    const emails = new Set(); const phones = new Set(); const socials = {};
    while (queue.length && out.pagesScanned < maxPages) {
        const page = queue.shift(); out.pagesScanned++; out.bytes += page.bytes || 0;
        const r = extractFromHtml(page.html, page.finalUrl);
        r.emails.forEach((e) => emails.add(e)); r.phones.forEach((p) => phones.add(p));
        for (const [k, v] of Object.entries(r.socials)) socials[k] = [...new Set([...(socials[k] || []), ...v])].slice(0, 5);
        for (const l of r.contactLinks) {
            if (seen.has(l) || seen.size >= maxPages) continue; seen.add(l);
            const p = await fetchHtml(l, proxyUrl, timeoutMs, attempts); if (p) queue.push(p);
        }
    }
    // Rank emails: same domain as website first.
    let host = ''; try { host = new URL(first.finalUrl).hostname.replace(/^www\./, ''); } catch {}
    out.emails = [...emails].sort((a, b) => (b.endsWith(host) ? 1 : 0) - (a.endsWith(host) ? 1 : 0)).slice(0, 10);
    const norm = new Map(); for (const p of phones) { const k = p.replace(/^\+?1(?=\d{10}$)/, ''); if (!norm.has(k)) norm.set(k, p); }
    out.phones = [...norm.values()].slice(0, 5); out.socials = socials;
    return out;
}
