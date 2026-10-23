import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { enrichWebsite } from './contacts.js';

await Actor.init();
const input = (await Actor.getInput()) || {};
const {
    searchTerms = ['coffee shop'], location = 'Austin, TX', startUrls = [],
    maxPlacesPerSearch = 20, language = 'en', extractContacts = false, maxContactPages = 3,
    skipClosed = false, minRating = 0, proxyConfiguration: proxyInput,
} = input;
const maxTotal = Math.max(1, Math.min(Number(maxPlacesPerSearch) || 20, 500));
const proxy = proxyInput?.useApifyProxy || proxyInput?.proxyUrls ? await Actor.createProxyConfiguration(proxyInput) : undefined;
const seenPlaces = new Set();
let pushed = 0;
const canCharge = !!process.env.ACTOR_RUN_ID; // charge only on platform

const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && String(s).match(/\d/) ? n : null; };

const searches = [
    ...searchTerms.filter(Boolean).map((t) => ({ term: t, url: `https://www.google.com/maps/search/${encodeURIComponent(location ? `${t} in ${location}` : t)}?hl=${language}` })),
    ...startUrls.map((u) => ({ term: null, url: typeof u === 'string' ? u : u.url })),
];

async function acceptConsent(page) {
    const btn = page.locator('form[action*="consent"] button, button[aria-label*="Accept all"]').first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForLoadState('domcontentloaded').catch(() => {}); }
}

const BLOCK_TYPES = new Set(['image', 'media', 'font']);
const BLOCK_URL = /\/maps\/vt|\/kh\/|googleusercontent\.com\/p\/|streetviewpixels|\/gen_204|\/log\?|doubleclick|google-analytics|googletagmanager/;
const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxy,
    maxConcurrency: 3, useSessionPool: true, browserPoolOptions: { maxOpenPagesPerBrowser: 3, retireBrowserAfterPageCount: 200 }, maxRequestRetries: 4, requestHandlerTimeoutSecs: 240, navigationTimeoutSecs: 60,
    launchContext: { launchOptions: { executablePath: process.env.CHROME_PATH || undefined, args: ['--lang=en-US', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote', '--blink-settings=imagesEnabled=false'] } },
    preNavigationHooks: [async ({ page }) => {
        await page.route('**/*', (r) => { const q = r.request(); return (BLOCK_TYPES.has(q.resourceType()) || BLOCK_URL.test(q.url())) ? r.abort() : r.continue(); });
    }],
    async requestHandler({ page, request, crawler: c }) {
        await acceptConsent(page);
        if (request.label === 'PLACE') return handlePlace(page, request);
        // SEARCH: scroll feed until enough unique places or end of list
        const feed = page.locator('div[role="feed"]');
        const hasFeed = await feed.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
        if (!hasFeed) { // single result redirects straight to a place
            if (page.url().includes('/maps/place/')) return handlePlace(page, request);
            throw new Error('Results feed not found (possible block); retrying');
        }
        const want = maxTotal; const links = new Set(); let stale = 0;
        while (links.size < want && stale < 4) {
            const before = links.size;
            for (const h of await page.$$eval('a.hfpxzc', (as) => as.map((a) => a.href))) links.add(h.split('?')[0]);
            if (await page.locator('span.HlvSq').count()) break; // "You've reached the end of the list."
            await feed.evaluate((el) => el.scrollBy(0, 4000)); await page.waitForTimeout(700);
            stale = links.size === before ? stale + 1 : 0;
        }
        log.info(`Search "${request.userData.term}": ${links.size} places`);
        await c.addRequests([...links].slice(0, want).map((url, i) => ({ url: `${url}?hl=${language}`, uniqueKey: url, label: 'PLACE', userData: { term: request.userData.term, rank: i + 1 } })));
    },
    failedRequestHandler({ request }, err) { log.warning(`Failed ${request.url}: ${err.message}`); },
});

async function handlePlace(page, request) {
    await page.waitForSelector('h1', { timeout: 30000 });
    await page.waitForSelector('button[data-item-id], div.F7nice', { timeout: 3000 }).catch(() => {});
    const d = await page.evaluate(() => {
        const t = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;
        const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]');
        const reviewsEl = [...document.querySelectorAll('div.F7nice span[aria-label]')].find((s) => /review/i.test(s.getAttribute('aria-label')));
        const hours = [...document.querySelectorAll('table.eK4R0e tr, table.WgFkxc tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).filter(Boolean).join(': ')).map((x) => x.replace(/[:\s]+$/, '')).filter(Boolean);
        const statusText = document.body.innerText.match(/Permanently closed|Temporarily closed/i)?.[0] || null;
        return {
            title: t('h1.DUwDvf') || t('h1'),
            category: t('button.DkEaL') || null,
            address: attr('button[data-item-id="address"]', 'aria-label')?.replace(/^Address:\s*/, '').trim() || null,
            website: attr('a[data-item-id="authority"]', 'href'),
            phone: attr('button[data-item-id^="phone:tel:"]', 'data-item-id')?.replace('phone:tel:', '') || null,
            plusCode: attr('button[data-item-id="oloc"]', 'aria-label')?.replace(/^Plus code:\s*/, '') || null,
            rating: ratingEl?.textContent || null,
            reviews: reviewsEl?.getAttribute('aria-label') || null,
            priceLevel: [...document.querySelectorAll('span[aria-label^="Price"]')][0]?.textContent?.trim() || null,
            openingHours: hours.length ? hours : null,
            status: statusText,
        };
    });
    const url = page.url();
    const lat = url.match(/!3d(-?\d+\.\d+)/)?.[1]; const lng = url.match(/!4d(-?\d+\.\d+)/)?.[1];
    const placeKey = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] || null;
    const placeId = url.match(/!19s([A-Za-z0-9_-]+)/)?.[1] || null;
    const key = placeId || placeKey || `${d.title}|${d.address}`;
    if (seenPlaces.has(key)) return; seenPlaces.add(key);
    const rating = num(d.rating); const reviewsCount = num(d.reviews);
    const closed = d.status ? d.status.toLowerCase().replace(' ', '_') : null;
    if (skipClosed && closed) return;
    if (minRating && (rating ?? 0) < minRating) return;
    let website = d.website;
    try { if (website?.includes('google.com/url')) website = new URL(website).searchParams.get('q'); } catch {}
    try { if (website) { const w = new URL(website); [...w.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => w.searchParams.delete(k)); website = w.href.replace(/\?$/, ''); } } catch {}
    const item = {
        title: d.title, category: d.category, address: d.address, phone: d.phone, website,
        rating, reviewsCount, priceLevel: d.priceLevel, closedStatus: closed, plusCode: d.plusCode,
        location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
        placeId, cid: placeKey ? BigInt(placeKey.split(':')[1]).toString() : null,
        googleMapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : url.split('?')[0],
        openingHours: d.openingHours, searchTerm: request.userData.term || null, rank: request.userData.rank || null,
        emails: [], socials: {}, websitePhones: [], contactsStatus: 'skipped', scrapedAt: new Date().toISOString(),
    };
    if (extractContacts && website) {
        const proxyUrl = proxy ? await proxy.newUrl() : undefined;
        let e = await enrichWebsite(website, { proxyUrl, maxPages: maxContactPages });
        if (e.error) { // fallback: render with the real browser (handles JS sites and bot walls)
            try {
                const p2 = await page.context().newPage();
                await p2.route('**/*', (r) => (BLOCK_TYPES.has(r.request().resourceType()) || r.request().resourceType() === 'stylesheet' ? r.abort() : r.continue()));
                await p2.goto(website, { timeout: 30000, waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(500);
                const { extractFromHtml } = await import('./contacts.js');
                const r = extractFromHtml(await p2.content(), p2.url()); await p2.close();
                e = { emails: r.emails, phones: r.phones, socials: r.socials, error: null };
            } catch { /* keep original error */ }
        }
        Object.assign(item, { emails: e.emails, socials: e.socials, websitePhones: e.phones, contactsStatus: e.error || 'ok' });
    } else if (extractContacts) item.contactsStatus = 'no_website';
    await Actor.pushData(item); pushed++;
    if (canCharge) {
        await Actor.charge({ eventName: 'place-scraped' }).catch(() => {});
        if (item.contactsStatus === 'ok') await Actor.charge({ eventName: 'contacts-enriched' }).catch(() => {});
    }
}

if (!searches.length) throw new Error('Provide searchTerms or startUrls');
await crawler.run(searches.map((s) => ({ url: s.url, uniqueKey: s.url, label: 'SEARCH', userData: { term: s.term } })));
log.info(`Done. ${pushed} unique places saved.`);
await Actor.exit();
