import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { enrichWebsite } from './contacts.js';
import { estimatePerThousand } from './cost.js';
import { fetchPlaceDetail } from './detail.js';
import { normalizePhone, toDatasetItem } from './place.js';
import { createLimiter } from './pool.js';

await Actor.init();
const input = (await Actor.getInput()) || {};
const {
    searchTerms = ['coffee shop'], location = 'Austin, TX', startUrls = [],
    maxPlacesPerSearch = 20, language = 'en', extractContacts = true, maxContactPages = 3,
    maxReviews = 0, skipClosed = false, minRating = 0, proxyConfiguration: proxyInput,
} = input;
const maxTotal = Math.max(1, Math.min(Number(maxPlacesPerSearch) || 20, 500));
const reviewLimit = Math.max(0, Math.min(Number(maxReviews) || 0, 8));
const contactPages = Math.max(1, Math.min(Number(maxContactPages) || 3, 6));
log.info(`extractContacts=${Boolean(extractContacts)} maxPlaces=${maxTotal} maxContactPages=${contactPages}`);
const proxy = proxyInput?.useApifyProxy || proxyInput?.proxyUrls ? await Actor.createProxyConfiguration(proxyInput) : undefined;
const seenPlaces = new Set();
let pushed = 0;
const canCharge = !!process.env.ACTOR_RUN_ID; // charge only on platform
const startedAt = Date.now();
const stats = { scrollMs: [], detailMs: [], detailBytes: 0, detailFailures: 0, contactMs: [], contactBytes: 0, contactPages: 0 };
const DETAIL_CONCURRENCY = 20;
const limit = createLimiter(DETAIL_CONCURRENCY);
const tasks = [];

const searches = [
    ...searchTerms.filter(Boolean).map((t) => ({ term: t, url: `https://www.google.com/maps/search/${encodeURIComponent(location ? `${t} in ${location}` : t)}?hl=${language}` })),
    ...startUrls.map((u) => ({ term: null, url: typeof u === 'string' ? u : u.url })),
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
    async requestHandler({ page, request }) {
        await acceptConsent(page);
        const listT0 = Date.now();
        // A one-result search redirects to the place before a feed exists. Schedule it immediately.
        if (page.url().includes('/maps/place/') && await page.locator('div[role="feed"]').count() === 0) {
            stats.scrollMs.push(Date.now() - listT0);
            schedule(page.url().split('?')[0], request.userData.term, 1);
            return;
        }
        // SEARCH: scroll feed until enough unique places or end of list
        const feed = page.locator('div[role="feed"]');
        const hasFeed = await feed.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
        if (!hasFeed) { // single result redirects straight to a place
            if (page.url().includes('/maps/place/')) {
                stats.scrollMs.push(Date.now() - listT0);
                schedule(page.url().split('?')[0], request.userData.term, 1);
                return;
            }
            throw new Error('Results feed not found (possible block); retrying');
        }
        const want = maxTotal; const links = new Set(); let stale = 0; const t0 = Date.now();
        const collect = async () => { for (const h of await page.$$eval('a.hfpxzc', (as) => as.map((a) => a.href))) links.add(h.split('?')[0]); };
        // Google lazy-loads ~20 results per page only when the last card scrolls into view; wait for the feed to grow
        // instead of a fixed short sleep, and allow several retries (with a wheel nudge) before declaring the list exhausted.
        while (links.size < want && stale < 8 && Date.now() - t0 < 180000) {
            await collect(); const before = links.size; if (before >= want) break;
            if (await page.locator('span.HlvSq, p.fontBodyMedium > span > span.HlvSq').count()) break; // "You've reached the end of the list."
            const cards = await page.locator('a.hfpxzc').count();
            await page.locator('a.hfpxzc').last().scrollIntoViewIfNeeded().catch(() => {});
            await feed.evaluate((el) => el.scrollTo(0, el.scrollHeight));
            if (stale >= 2) { await feed.hover().catch(() => {}); await page.mouse.wheel(0, 3000).catch(() => {}); }
            await page.waitForFunction((n) => document.querySelectorAll('a.hfpxzc').length > n || !!document.querySelector('span.HlvSq'), cards, { timeout: 5000 }).catch(() => {});
            await collect(); stale = links.size === before ? stale + 1 : 0;
        }
        const ended = (await page.locator('span.HlvSq').count()) > 0;
        if (links.size < want && !ended && request.retryCount < 2) throw new Error(`Feed stalled at ${links.size}/${want} places before end of list; retrying with a fresh session`);
        const scrollMs = Date.now() - listT0;
        stats.scrollMs.push(scrollMs);
        log.info(`Search "${request.userData.term}": ${links.size} places, scroll ${scrollMs}ms`);
        // Detail pages and website enrichment run over HTTP, outside this browser page, so the scroll can finish
        // and each place is pushed as soon as that place is ready.
        [...links].slice(0, want).forEach((url, i) => schedule(url, request.userData.term, i + 1));
    },
    failedRequestHandler({ request }, err) { log.warning(`Failed ${request.url}: ${err.message}`); },
});

function schedule(url, term, rank) {
    tasks.push(limit(() => processPlace({ url, term, rank }).catch((err) => log.warning(`Place ${url}: ${err.message}`))));
}

async function processPlace({ url, term, rank }) {
    const proxyUrl = proxy ? await proxy.newUrl() : undefined;
    const loaded = await loadDetail(url, proxyUrl);
    if (!loaded?.place) {
        stats.detailFailures += 1;
        log.warning(`No detail for ${url}: ${loaded?.error || 'unknown'}`);
        return;
    }
    const place = loaded.place;
    if (skipClosed && (place.permanentlyClosed || place.temporarilyClosed)) return;
    if (minRating && (place.rating ?? 0) < minRating) return;
    const key = place.placeId || place.fid || `${place.title}|${place.address}`;
    if (seenPlaces.has(key)) return;
    seenPlaces.add(key);
    let emails = [];
    let socials = {};
    let websitePhones = [];
    let contactsStatus = 'skipped';
    if (extractContacts && place.website) {
        const contactProxy = proxy ? await proxy.newUrl() : undefined;
        const c0 = Date.now();
        const enriched = await enrichWebsite(place.website, { proxyUrl: contactProxy, maxPages: contactPages, timeoutMs: 6000, attempts: 1 });
        stats.contactMs.push(Date.now() - c0);
        stats.contactBytes += enriched.bytes || 0;
        stats.contactPages += enriched.pagesScanned || 0;
        emails = enriched.emails;
        socials = enriched.socials;
        websitePhones = enriched.phones.map((phone) => normalizePhone(phone)).filter(Boolean);
        contactsStatus = enriched.error || 'ok';
    } else if (extractContacts) contactsStatus = 'no_website';
    const item = toDatasetItem(place, {
        searchTerm: term || null,
        rank,
        emails,
        socials,
        websitePhones,
        contactsStatus,
        scrapedAt: new Date().toISOString(),
        sourceUrl: url,
    });
    await Actor.pushData(item);
    pushed += 1;
    log.info(`Saved #${pushed} ${item.title}`);
    if (canCharge) {
        await Actor.charge({ eventName: 'place-scraped' }).catch(() => {});
        if (item.contactsStatus === 'ok') await Actor.charge({ eventName: 'contacts-enriched' }).catch(() => {});
    }
}

async function loadDetail(url, proxyUrl) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            last = await fetchPlaceDetail(url, { proxyUrl, language, maxReviews: reviewLimit, timeoutMs: 12000 });
        } catch (err) {
            last = { error: err.message, place: null, bytes: 0, ms: 0 };
        }
        stats.detailMs.push(last.ms || 0);
        stats.detailBytes += last.bytes || 0;
        if (last.place) return last;
    }
    return last;
}

if (!searches.length) throw new Error('Provide searchTerms or startUrls');
await crawler.run(searches.map((s) => ({ url: s.url, uniqueKey: s.url, label: 'SEARCH', userData: { term: s.term } })));
const scrollDoneAt = Date.now();
await Promise.all(tasks);
const totalMs = Date.now() - startedAt;
const report = buildReport({ stats, pushed, totalMs, scrollDoneAt, startedAt });
log.info(`Timing ${JSON.stringify(report)}`);
await Actor.setValue('TIMING', report).catch(() => {});
log.info(`Done. ${pushed} unique places saved.`);
await Actor.exit();

function buildReport({ stats: s, pushed: count, totalMs, scrollDoneAt, startedAt: t0 }) {
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const per1000 = estimatePerThousand({
        places: count,
        wallMs: totalMs,
        detailBytes: s.detailBytes,
        contactBytes: s.contactBytes,
        memoryGb: 1,
    });
    const grossPer1000 = 4; // unchanged prices: $0.003 place + $0.001 contacts
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
        note: 'per1000 scales this run linearly at 1 GB. Compute $0.20/CU, external transfer $0.20/GB, dataset writes $0.005/1000. Datacenter proxy is not per-GB. Prices unchanged at $0.003 + $0.001.',
    };
}
