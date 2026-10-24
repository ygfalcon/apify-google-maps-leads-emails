import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { eventsToCharge } from '../src/billing.js';
import { createPlaceDeduper, foreignKeys, preKeys } from '../src/dedupe.js';
import { fetchPlaceDetail } from '../src/detail.js';
import { isGoogleMapsUrl, normalizeLanguage, normalizeRunInput } from '../src/input.js';
import { cleanWebsite } from '../src/place.js';
import { redactSecrets } from '../src/redact.js';
import { MAX_SPLIT_REQUESTS, planAreaSplits, shouldSplitArea } from '../src/split.js';
import { enrichWebsite as enrichContacts } from '../src/contacts.js';
import { enrichWebsite, fetchHtml } from '../src/web/enrich.js';
import { deobfuscate, extractPage, isValidEmailSyntax } from '../src/web/extract.js';
import { createScanPool } from '../src/web/scan-pool.js';

test('contacts are not billed for duplicates, abandoned work, empty extractions, or failed lookups', () => {
    const kept = {
        title: 'Acme Plumbing',
        contactsStatus: 'ok',
        pagesScanned: 1,
        emails: ['office@acmeplumbing.com'],
        phones: [],
        socials: {},
    };
    assert.deepEqual(eventsToCharge(kept), ['place-scraped', 'contacts-enriched']);
    assert.deepEqual(eventsToCharge({ ...kept, emails: [], socials: { instagram: ['https://www.instagram.com/acme'] } }), ['place-scraped', 'contacts-enriched']);
    assert.deepEqual(eventsToCharge({ ...kept, duplicate: true }), []);
    assert.deepEqual(eventsToCharge({ ...kept, abandoned: true }), []);
    assert.deepEqual(eventsToCharge({ ...kept, title: '   ' }), []);
    assert.deepEqual(eventsToCharge({ ...kept, emails: [], phones: [], socials: {} }), ['place-scraped']);
    assert.deepEqual(eventsToCharge({ ...kept, contactsStatus: 'website_unreachable', emails: [] }), ['place-scraped']);
    assert.deepEqual(eventsToCharge({ ...kept, contactsStatus: 'website_timeout' }), ['place-scraped']);
    assert.deepEqual(eventsToCharge({ ...kept, contactsStatus: 'contacts_failed', emails: [] }), ['place-scraped']);
    assert.deepEqual(eventsToCharge({ ...kept, pagesScanned: 0 }), ['place-scraped']);
});

test('the same feature id is one place even when the list URLs differ', () => {
    const first = 'https://www.google.com/maps/place/Alpha';
    const second = 'https://www.google.com/maps/place/Beta';
    const deduper = createPlaceDeduper();
    assert.equal(deduper.claim(preKeys(first)), true);
    const own = { fid: '0x11:0x22', title: 'Alpha', address: '1 Main St' };
    assert.equal(deduper.conflicts(foreignKeys(first, own)), false);
    deduper.remember(foreignKeys(first, own));
    assert.equal(deduper.claim(preKeys(second)), true);
    assert.equal(deduper.conflicts(foreignKeys(second, { fid: '0x11:0x22', title: 'Beta', address: '9 Other St' })), true);

    const listed = 'https://www.google.com/maps/place/Acme/data=!1s0x11:0x22';
    const self = createPlaceDeduper();
    self.claim(preKeys(listed));
    assert.equal(self.conflicts(foreignKeys(listed, { fid: '0x11:0x22', placeId: 'ChIJself', title: 'Acme' })), false);
});

test('prose "at domain" and digit-glued locals are not emails, real mailboxes stay', () => {
    const prose = extractPage('<p>Shop at store.example.com today.</p>', 'https://store.example.com/', 'home');
    assert.equal(prose.emails.some((row) => row.email.includes('@')), false);
    assert.equal(deobfuscate('info at store.example.com').includes('info@store.example.com'), true);
    const obfuscated = extractPage('<p>info at store.example.com</p>', 'https://store.example.com/', 'home');
    assert.ok(obfuscated.emails.some((row) => row.email === 'info@store.example.com'));
    assert.equal(isValidEmailSyntax('20info@acme.com'), false);
    assert.equal(isValidEmailSyntax('hello@studio.nyc'), true);
    assert.equal(isValidEmailSyntax('sales@acme.co.uk'), true);
});

test('website userinfo and proxy credentials never leave the actor', () => {
    assert.equal(cleanWebsite('https://ada:s3cret@example.com/path?utm_source=x'), 'https://example.com/path');
    const leaked = 'connect ECONNRESET http://auto:s3cret-token@proxy.apify.com:8000';
    const redacted = redactSecrets(leaked);
    assert.equal(redacted.includes('s3cret-token'), false);
    assert.match(redacted, /http:\/\/auto:\*\*\*@proxy\.apify\.com:8000/);
    assert.equal(redactSecrets('apify_token=apify_api_abcdefghij').includes('abcdefghij'), false);
});

test('paid contact extraction cannot be turned on by the string false, and Maps URLs stay on Google', () => {
    const off = normalizeRunInput({
        extractContacts: 'false',
        skipClosed: 'no',
        language: 'en&pb=evil',
        maxPlacesPerSearch: '9999',
        maxContactPages: '0',
        startUrls: [
            'https://www.google.com/maps/search/dentist',
            'https://www.google.com.evil.com/maps/search/dentist',
            'https://user:pw@www.google.com/maps/search/x',
            'https://maps.google.com/maps/place/Acme',
            'http://www.google.com/maps/search/dentist',
            'https://www.google.com/search?q=dentist',
            'https://www.google.com/mapsfoo',
        ],
    });
    assert.equal(off.extractContacts, false);
    assert.equal(off.skipClosed, false);
    assert.equal(off.language, 'en');
    assert.equal(off.maxPlacesPerSearch, 500);
    assert.equal(off.maxContactPages, 1);
    assert.equal(off.startUrls.length, 3);
    assert.ok(off.startUrls.every((url) => url.startsWith('https://')));
    assert.equal(off.startUrls.filter((url) => url === 'https://www.google.com/maps/search/dentist').length, 2);
    assert.equal(isGoogleMapsUrl('http://www.google.com/maps/search/dentist'), true);
    assert.equal(isGoogleMapsUrl('https://www.google.co.uk/maps/search/dentist'), true);
    assert.equal(isGoogleMapsUrl('https://google.com.evil.com/maps'), false);
    assert.equal(normalizeLanguage('de'), 'de');
    assert.equal(normalizeLanguage('../etc'), 'en');
});

test('a worker that cannot accept a page does not recurse, and a hung scan is a failure', async () => {
    let posts = 0;
    const pool = createScanPool({
        size: 1,
        timeoutMs: 500,
        createWorker() {
            return {
                unref() {},
                terminate() {},
                on() {},
                postMessage() {
                    posts += 1;
                    throw new Error('DataCloneError');
                },
            };
        },
    });
    const failed = await pool.scan('<p>office@acme.com</p>', 'https://acme.com/', 'home');
    assert.equal(failed.failed, true);
    assert.ok(posts < 5, `posted ${posts} times`);
    await pool.close();

    const hung = createScanPool({
        size: 1,
        timeoutMs: 200,
        workerPath: new URL('../fixtures/loop-worker.js', import.meta.url),
    });
    const started = Date.now();
    try {
        const found = await hung.scan('<html>never</html>', 'https://example.com/', 'home');
        assert.equal(found.failed, true);
        assert.ok(Date.now() - started < 2000);
    } finally {
        await hung.close();
    }
});

test('a failed page scan is not a successful contact lookup', async () => {
    const result = await enrichWebsite('https://example.com/', {
        maxPages: 1,
        validateMx: false,
        timeoutMs: 200,
        fetchImpl: async (opts) => ({
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html><p>hello</p></html>',
            url: opts.url,
        }),
        scanPool: {
            async scan() {
                return { failed: true, emails: [], phones: [], socials: {}, people: [], links: [] };
            },
        },
    });
    assert.equal(result.error, 'contacts_failed');
    const wrapped = await enrichContacts('https://example.com/', {
        deadlineMs: 1000,
        engine: async () => result,
    });
    assert.equal(wrapped.error, 'contacts_failed');
    assert.deepEqual(eventsToCharge({
        title: 'Example',
        contactsStatus: wrapped.error || 'ok',
        pagesScanned: wrapped.pagesScanned,
        emails: wrapped.emails,
    }), ['place-scraped']);
});

test('an empty website is not reported as a successful enrichment', async () => {
    const result = await enrichContacts('', { engine: async () => ({ emails: ['a@b.com'], error: null }) });
    assert.equal(result.error, 'invalid_url');
    assert.deepEqual(result.emails, []);
});

test('proxy and HTTP failures retry a bounded number of times and do not echo credentials', async () => {
    let throws = 0;
    const page = await fetchHtml('https://example.com/', {
        proxyUrl: 'http://auto:s3cret@proxy.example:8000',
        timeoutMs: 200,
        attempts: 2,
        fetchImpl: async (opts) => {
            throws += 1;
            if (opts.proxyUrl) throw new Error(`boom ${opts.proxyUrl}`);
            return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>', url: opts.url };
        },
    });
    assert.ok(page?.html?.includes('ok'));
    assert.equal(throws, 2);

    let serverErrors = 0;
    const again = await fetchHtml('https://example.com/down', {
        timeoutMs: 200,
        attempts: 2,
        fetchImpl: async () => {
            serverErrors += 1;
            return { statusCode: 500, headers: { 'content-type': 'text/html' }, body: '<html>no</html>', url: 'https://example.com/down' };
        },
    });
    assert.equal(again, null);
    assert.equal(serverErrors, 2);

    const seen = [];
    const detail = await fetchPlaceDetail('https://www.google.com/maps/place/data=!4m5', {
        proxyUrl: 'http://auto:s3cret@proxy.example:8000',
        timeoutMs: 300,
        fetchImpl: async (url, opts) => {
            seen.push(opts.proxyUrl ?? null);
            throw new Error(`proxy down ${opts.proxyUrl || ''}`);
        },
    });
    assert.equal(detail.place, null);
    assert.ok(seen.includes(null));
    assert.ok(seen.length <= 4);
    assert.equal(String(detail.error).includes('s3cret'), false);
});

test('map splits stop for a bad depth and for a seen-set that is already full', () => {
    assert.equal(shouldSplitArea({ found: 120, wanted: 500, depth: Number.NaN }), false);
    assert.equal(planAreaSplits({
        found: 120,
        wanted: 500,
        depth: Number.NaN,
        view: { lat: 1, lng: 2, zoom: 12 },
        term: 'cafe',
    }).length, 0);
    const seen = new Set(Array.from({ length: MAX_SPLIT_REQUESTS }, (_, i) => `area:${i}`));
    assert.equal(planAreaSplits({
        found: 120,
        wanted: 500,
        depth: 0,
        view: { lat: 41.8, lng: -87.6, zoom: 12 },
        term: 'bakery',
        seenKeys: seen,
    }).length, 0);
});

test('published prices stay $0.0034 and $0.0015 everywhere they are stated', () => {
    const pricing = JSON.parse(fs.readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
    assert.equal(pricing.events.find((event) => event.eventName === 'place-scraped').priceUsd, 0.0034);
    assert.equal(pricing.events.find((event) => event.eventName === 'contacts-enriched').priceUsd, 0.0015);
    const files = ['README.md', '.actor/actor.json', '.actor/input_schema.json', '.actor/pricing.json', 'src/main.js'];
    for (const file of files) {
        const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.equal(/\$0\.003(?!4)/.test(text), false, file);
        assert.equal(/\$0\.001(?!5)/.test(text), false, file);
        assert.match(text, /0\.0034/);
        assert.match(text, /0\.0015/);
    }
    const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(readme, /\$4\.90/);
    assert.equal(readme.includes('$3 per 1,000'), false);
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(main, /eventsToCharge/);
    assert.match(main, /gate\.open/);
    assert.match(main, /redactSecrets/);
    assert.match(main, /normalizeRunInput/);
    assert.match(main, /foreignKeys/);
});
