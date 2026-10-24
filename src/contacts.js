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

// Contact enrichment uses the same engine as the Website Email Extractor actor: de-obfuscation
// (Cloudflare, [at]/(dot), entities, split tags), JSON-LD, footer-linked contact/about/impressum pages,
// validated E.164 phones and 13 canonical social networks.
import { enrichWebsite as engineEnrich } from './web/enrich.js';

// Hard cap on one website's whole enrichment (homepage + contact pages), whatever the network does.
export const SITE_DEADLINE_MS = 30000;

export function withDeadline(promise, ms, label = 'timeout') {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

export async function enrichWebsite(website, { proxyUrl, maxPages = 3, deadlineMs = SITE_DEADLINE_MS, engine = engineEnrich } = {}) {
    const out = { emails: [], phones: [], socials: {}, pagesScanned: 0, bytes: 0, error: null };
    if (!website) return out;
    let r;
    try {
        r = await withDeadline(engine(website, { proxyUrl, maxPages, validateMx: false, timeoutMs: 6000 }), deadlineMs, 'enrich_timeout');
    } catch (err) {
        out.error = err?.message === 'enrich_timeout' ? 'website_timeout' : 'website_unreachable';
        return out;
    }
    if (r.error) { out.error = r.error === 'invalid_url' ? 'website_unreachable' : r.error; return out; }
    out.emails = r.emails.filter(isPlausibleEmail).slice(0, 10);
    out.phones = r.phones.slice(0, 5);
    for (const [k, v] of Object.entries(r.socials)) if (v?.length) out.socials[k] = v;
    out.pagesScanned = r.pagesScanned;
    out.bestContact = r.bestContact ? { email: r.bestContact.email, name: r.bestContact.name, role: r.bestContact.role } : null;
    return out;
}
