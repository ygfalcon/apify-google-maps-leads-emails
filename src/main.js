import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { createEnrichmentCache, enrichWebsite, websiteCacheKey, withDeadline } from './contacts.js';
import { estimatePerThousand } from './cost.js';
import { eventsToCharge } from './billing.js';
import { createPlaceDeduper, foreignKeys, preKeys } from './dedupe.js';
import { fetchPlaceDetail, shouldRetryDetail } from './detail.js';
import { normalizeRunInput } from './input.js';
import { drainDeadlineMs, PLACE_DEADLINE_MS } from './limits.js';
import { decideRunFinish, hardStopExitCode } from './run-finish.js';
import { redactSecrets } from './redact.js';
import { normalizePhone, toDatasetItem } from './place.js';
import { createLimiter } from './pool.js';
import { selectProxy } from './proxy.js';
import { feedNeedsRetry, mapsSearchUrl, parseMapView, planAreaSplits } from './split.js';
import { wantsImpressum } from './web/extract.js';
import { closeScanPool } from './web/scan-pool.js';

await Actor.init();
const input = (await Actor.getInput()) || {};
const {
    searchTerms, location = 'Austin, TX', startUrls = [],
    maxPlacesPerSearch = 20, language = 'en', extractContacts = true, maxContactPages = 3,
    maxReviews = 0, skipClosed = false, minRating = 0, proxyConfiguration: proxyInput,
} = input;
function clampCount(value, min, max, fallback) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(Math.trunc(n), max));
}
function flagOn(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    const text = String(value).trim().toLowerCase();
    if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false;
    if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true;
    return fallback;
}
const contactsOn = flagOn(extractContacts, true);
const maxTotal = clampCount(maxPlacesPerSearch, 1, 500, 20);
const reviewLimit = clampCount(maxReviews, 0, 8, 0);
const contactPages = clampCount(maxContactPages, 1, 6, 3);
log.info(`extractContacts=${contactsOn} maxPlaces=${maxTotal} maxContactPages=${contactPages}`);
const proxy = await selectProxy(proxyInput, { createProxy: (input) => Actor.createProxyConfiguration(input), log });
const checked = normalizeRunInput({ language, skipClosed, minRating });
const deduper = createPlaceDeduper();
const scheduledByTerm = new Map();
const scheduledAreas = new Set();
const countedSites = new Set();
const cachedEnrich = createEnrichmentCache(enrichWebsite);
let pushed = 0;
let searchFailures = 0;
const canCharge = !!process.env.ACTOR_RUN_ID; // charge only on platform
const startedAt = Date.now();
const stats = { scrollMs: [], detailMs: [], detailBytes: 0, detailFailures: 0, contactMs: [], contactBytes: 0, contactPages: 0 };
const DETAIL_CONCURRENCY = 20;
const limit = createLimiter(DETAIL_CONCURRENCY);
const tasks = [];
let closing = false; // set when the drain deadline passes: late work must not push or charge

const searches = [
    ...((() => {
        const explicit = (Array.isArray(searchTerms) ? searchTerms : (searchTerms == null ? [] : [searchTerms]))
            .map((t) => String(t || '').trim()).filter(Boolean);
        // A start URL is the whole request. Don't invent a coffee-shop search the user would be charged for.
        return explicit.length ? explicit : ((startUrls || []).length ? [] : ['coffee shop']);
    })()).map((t) => ({ term: t, url: mapsSearchUrl({ term: t, location, language }) })),
    ...(startUrls || []).map((u) => {
        const raw = typeof u === 'string' ? u : u?.url;
        let parsed;
        try { parsed = new URL(String(raw || '')); } catch { return null; }
        if (parsed.username || parsed.password) return null;
        if (parsed.protocol === 'http:') parsed.protocol = 'https:';
        if (parsed.protocol !== 'https:') return null;
        const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
        const mapsPath = parsed.pathname === '/maps' || parsed.pathname.startsWith('/maps/');
        const mapsSub = host === 'maps.google.com' || /^maps\.google\.(?:[a-z]{2,3}|com?\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
        if (mapsSub) return (parsed.pathname === '/' || mapsPath) ? { term: null, url: parsed.href } : null;
        const labels = host.split('.');
        if (labels[0] !== 'google' || labels.length > 3 || !mapsPath) return null;
        const tldOk = labels.length === 2
            ? (labels[1] === 'com' || /^[a-z]{2,3}$/.test(labels[1]))
            : /^(?:com|co|org|net|ac|gov)\.[a-z]{2}$/.test(`${labels[1]}.${labels[2]}`);
        if (!tldOk) return null;
        return { term: null, url: parsed.href };
    }).filter(Boolean),
];

async function acceptConsent(page) {
    const btn = page.locator('form[action*="consent"] button, button[aria-label*="Accept all"]').first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForLoadState('domcontentloaded').catch(() => {}); }
}

const BLOCK_TYPES = new Set(['image', 'media', 'font']);
const BLOCK_URL = /\/maps\/vt|\/kh\/|googleusercontent\.com\/p\/|streetviewpixels|doubleclick|google-analytics|googletagmanager/;
const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxy,
    maxConcurrency: 3, useSessionPool: true, browserPoolOptions: { maxOpenPagesPerBrowser: 3, retireBrowserAfterPageCount: 200 }, maxRequestRetries: 4, requestHandlerTimeoutSecs: 240, navigationTimeoutSecs: 60,
    launchContext: { launchOptions: { executablePath: process.env.CHROME_PATH || undefined, args: ['--lang=en-US', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote', '--blink-settings=imagesEnabled=false'] } },
    preNavigationHooks: [async ({ page }) => {
        await page.route('**/*', (r) => { const q = r.request(); return (BLOCK_TYPES.has(q.resourceType()) || BLOCK_URL.test(q.url())) ? r.abort() : r.continue(); });
    }],
    async requestHandler({ page, request, addRequests }) {
        const queued = new Set();
        const enqueue = (url) => {
            if (!url || queued.has(url) || queued.size >= maxTotal) return;
            queued.add(url);
            schedule(url, request.userData.term, queued.size);
        };
        await acceptConsent(page);
        const listT0 = Date.now();
        // A one-result search redirects to the place before a feed exists. Schedule it immediately.
        if (page.url().includes('/maps/place/') && await page.locator('div[role="feed"]').count() === 0) {
            stats.scrollMs.push(Date.now() - listT0);
            enqueue(page.url().split('?')[0]);
            return;
        }
        // SEARCH: scroll feed until enough unique places or end of list
        const feed = page.locator('div[role="feed"]');
        const hasFeed = await feed.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
        if (!hasFeed) { // single result redirects straight to a place
            if (page.url().includes('/maps/place/')) {
                stats.scrollMs.push(Date.now() - listT0);
                enqueue(page.url().split('?')[0]);
                return;
            }
            throw new Error('Results feed not found (possible block); retrying');
        }
        const want = maxTotal; const links = new Set(); let stale = 0; const t0 = Date.now();
        const collect = async () => { for (const h of await page.$$eval('a.hfpxzc', (as) => as.map((a) => a.href))) links.add(h.split('?')[0]); };
        // Google lazy-loads ~20 results per page only when the last card scrolls into view; wait for the feed to grow
        // instead of a fixed short sleep, and allow several retries (with a wheel nudge) before declaring the list exhausted.
        // Places already on screen start detail and contact work while the feed is still scrolling.
        while (links.size < want && stale < 8 && Date.now() - t0 < 180000) {
            await collect(); for (const url of links) enqueue(url); const before = links.size; if (before >= want) break;
            if (await page.locator('span.HlvSq, p.fontBodyMedium > span > span.HlvSq').count()) break; // "You've reached the end of the list."
            const cards = await page.locator('a.hfpxzc').count();
            await page.locator('a.hfpxzc').last().scrollIntoViewIfNeeded().catch(() => {});
            await feed.evaluate((el) => el.scrollTo(0, el.scrollHeight));
            if (stale >= 2) { await feed.hover().catch(() => {}); await page.mouse.wheel(0, 3000).catch(() => {}); }
            await page.waitForFunction((n) => document.querySelectorAll('a.hfpxzc').length > n || !!document.querySelector('span.HlvSq'), cards, { timeout: 5000 }).catch(() => {});
            await collect(); for (const url of links) enqueue(url); stale = links.size === before ? stale + 1 : 0;
        }
        const ended = (await page.locator('span.HlvSq').count()) > 0;
        if (feedNeedsRetry({ found: links.size, wanted: want, ended, retryCount: request.retryCount, depth: request.userData.depth || 0 })) throw new Error(`Feed stalled at ${links.size}/${want} places before end of list; retrying with a fresh session`);
        const scrollMs = Date.now() - listT0;
        stats.scrollMs.push(scrollMs);
        log.info(`Search "${request.userData.term}": ${links.size} places, scroll ${scrollMs}ms`);
        // Detail pages and website enrichment run over HTTP, outside this browser page, so the scroll can finish
        // and each place is pushed as soon as that place is ready.
        for (const url of links) enqueue(url);
        const depth = request.userData.depth || 0;
        const view = request.userData.view || parseMapView(page.url());
        const extra = planAreaSplits({
            found: links.size, wanted: maxTotal, depth, view, term: request.userData.term, location, language: checked.language, seenKeys: scheduledAreas,
        });
        for (const req of extra) scheduledAreas.add(req.uniqueKey);
        if (extra.length && typeof addRequests === 'function') await addRequests(extra);
    },
    failedRequestHandler({ request }, err) { searchFailures += 1; log.warning(`Failed ${request.url}: ${redactSecrets(err?.message || err)}`); },
});

async function nextProxyUrl() {
    if (!proxy) return undefined;
    try {
        return await proxy.newUrl();
    } catch (err) {
        log.warning(`Proxy URL unavailable (${redactSecrets(err?.message || err)}); continuing direct.`);
        return undefined;
    }
}

function schedule(url, term, rank) {
    if (!url) return;
    const keys = preKeys(url);
    if (deduper.conflicts(keys)) return;
    const bucket = term || '';
    const count = scheduledByTerm.get(bucket) || 0;
    if (count >= maxTotal) return;
    deduper.remember(keys);
    scheduledByTerm.set(bucket, count + 1);
    const placeRank = rank || count + 1;
    const gate = { open: true };
    tasks.push(limit(() => {
        const job = processPlace({ url, term, rank: placeRank, gate }).catch((err) => log.warning(`Place ${url}: ${redactSecrets(err?.message || err)}`));
        return withDeadline(job, PLACE_DEADLINE_MS, 'place_timeout').catch((err) => {
            gate.open = false;
            log.warning(`Place ${url}: ${redactSecrets(err?.message || err)}`);
        });
    }));
}

async function processPlace({ url, term, rank, gate }) {
    const proxyUrl = await nextProxyUrl();
    const loaded = await loadDetail(url, proxyUrl);
    if (!loaded?.place) {
        stats.detailFailures += 1;
        log.warning(`No detail for ${url}: ${redactSecrets(loaded?.error || 'unknown')}`);
        return;
    }
    const place = loaded.place;
    if (checked.skipClosed && (place.permanentlyClosed || place.temporarilyClosed)) return;
    if (checked.minRating && (place.rating ?? 0) < checked.minRating) return;
    // A nonsense query can make Google jump to the city itself. Skip places that are not businesses.
    if (!place.category && !(place.categories || []).length && !place.phone && place.rating == null) {
        log.info(`Skipping non-business result "${place.title}"`);
        return;
    }
    const identity = foreignKeys(url, place);
    if (deduper.conflicts(identity)) return;
    deduper.remember(identity);
    let emails = [];
    let thirdPartyEmails = [];
    let impressumOwner = null;
    let vatId = null;
    let socials = {};
    let websitePhones = [];
    let pagesScanned = 0;
    let contactsStatus = 'skipped';
    if (contactsOn && place.website) {
        const contactProxy = await nextProxyUrl();
        const c0 = Date.now();
        let siteKey = String(place.website).replace(/\/+$/, '');
        try { siteKey = websiteCacheKey(place.website); } catch { /* keep the raw key */ }
        const firstForSite = !countedSites.has(siteKey);
        if (firstForSite) countedSites.add(siteKey);
        const enriched = await cachedEnrich(place.website, { proxyUrl: contactProxy, maxPages: contactPages });
        stats.contactMs.push(Date.now() - c0);
        if (firstForSite) {
            stats.contactBytes += enriched.bytes || 0;
            stats.contactPages += enriched.pagesScanned || 0;
        }
        emails = enriched.emails;
        thirdPartyEmails = enriched.thirdPartyEmails || [];
        socials = enriched.socials;
        websitePhones = enriched.phones.map((phone) => normalizePhone(phone)).filter(Boolean);
        pagesScanned = enriched.pagesScanned || 0;
        contactsStatus = enriched.error || 'ok';
        if (wantsImpressum(place.countryCode, place.website)) {
            impressumOwner = enriched.impressumOwner || null;
            vatId = enriched.vatId || null;
        }
    } else if (contactsOn) contactsStatus = 'no_website';
    const item = toDatasetItem(place, {
        searchTerm: term || null,
        rank,
        emails,
        thirdPartyEmails,
        impressumOwner,
        vatId,
        socials,
        websitePhones,
        contactsStatus,
        scrapedAt: new Date().toISOString(),
        sourceUrl: url,
    });
    if (!gate?.open || closing) return;
    const events = eventsToCharge({
        title: item.title,
        abandoned: !gate?.open || closing,
        contactsStatus,
        pagesScanned,
        emails,
        phones: websitePhones,
        socials,
    });
    await Actor.pushData(item);
    pushed += 1;
    log.info(`Saved #${pushed} ${item.title}`);
    if (!gate?.open || closing || !canCharge) return;
    for (const eventName of events) {
        if (!gate?.open || closing) return;
        await Actor.charge({ eventName }).catch((err) => log.warning(`Charge ${eventName}: ${redactSecrets(err?.message || err)}`));
    }
}

async function loadDetail(url, proxyUrl) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            last = await fetchPlaceDetail(url, { proxyUrl, language: checked.language, maxReviews: reviewLimit, timeoutMs: 12000 });
        } catch (err) {
            last = { error: redactSecrets(err?.message || err), place: null, bytes: 0, ms: 0 };
        }
        stats.detailMs.push(last.ms || 0);
        stats.detailBytes += last.bytes || 0;
        if (last.place) return last;
        if (!shouldRetryDetail(last.error)) return last;
    }
    return last;
}

if (!searches.length) {
    await Actor.fail('Add at least one search term (e.g. "dentist") or a Google Maps search URL.');
}
await crawler.run(searches.map((s) => ({ url: s.url, uniqueKey: s.url, label: 'SEARCH', userData: { term: s.term } })));
const scrollDoneAt = Date.now();
// Every place has its own hard limits, but never let one stuck job keep the run (and its compute) alive.
const drainMs = drainDeadlineMs(tasks.length);
const hardStop = setTimeout(() => {
    log.warning('Hard stop: exiting so this run cannot hang.');
    process.exit(hardStopExitCode(pushed));
}, drainMs + 30000);
const allDone = Promise.allSettled(tasks).then(() => true);
const finished = await withDeadline(allDone, drainMs, 'drain_timeout').catch(() => false);
if (!finished) {
    closing = true;
    log.warning(`Stopped waiting for unfinished places after ${drainMs / 1000}s; they were not saved or charged.`);
}
const totalMs = Date.now() - startedAt;
const report = buildReport({ stats, pushed, totalMs, scrollDoneAt, startedAt });
log.info(`Timing ${JSON.stringify(report)}`);
await Actor.setValue('TIMING', report).catch(() => {});
const plan = decideRunFinish({
    pushed,
    searchFailures,
    scheduled: tasks.length,
    detailFailures: stats.detailFailures,
});
log.info(`Done. ${pushed} unique places saved.`);
try {
    await closeScanPool();
    if (plan.action === 'fail') await Actor.fail(plan.message);
    else await Actor.exit();
} finally {
    clearTimeout(hardStop);
}

function buildReport({ stats: s, pushed: count, totalMs, scrollDoneAt, startedAt: t0 }) {
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const per1000 = estimatePerThousand({
        places: count,
        wallMs: totalMs,
        detailBytes: s.detailBytes,
        contactBytes: s.contactBytes,
        memoryGb: 1,
    });
    const grossPer1000 = 4.9; // $0.0034 place + $0.0015 contacts
    const netPer1000 = grossPer1000 * 0.8;
    return {
        places: count,
        totalMs,
        scrollMs: s.scrollMs,
        scrollSumMs: s.scrollMs.reduce((a, b) => a + b, 0),
        afterScrollMs: scrollDoneAt - t0,
        detailCount: s.detailMs.length,
        detailAvgMs: avg(s.detailMs),
        detailBytes: s.detailBytes,
        detailFailures: s.detailFailures,
        contactCount: s.contactMs.length,
        contactAvgMs: avg(s.contactMs),
        contactBytes: s.contactBytes,
        contactPages: s.contactPages,
        per1000,
        marginOnNet: per1000.totalUsd ? Math.round((1 - per1000.totalUsd / netPer1000) * 1000) / 1000 : null,
        note: 'per1000 scales this run linearly at 1 GB. Compute $0.20/CU, external transfer $0.20/GB, dataset writes $0.005/1000. Datacenter proxy is not per-GB. Prices $0.0034 + $0.0015.',
    };
}
