import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createEnrichmentCache } from '../src/contacts.js';
import { mapsSearchUrl } from '../src/split.js';
import { enrichWebsite } from '../src/web/enrich.js';
import { closeScanPool } from '../src/web/scan-pool.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test.after(async () => {
    await closeScanPool();
});

function inputDefaultsSection(src) {
    const start = src.indexOf('const input = (await Actor.getInput())');
    const contactDecl = src.indexOf('const contactPages =', start);
    const logLine = src.indexOf('log.info(`extractContacts=', start);
    const proxyLine = src.indexOf('\nconst proxy =', start);
    const last = Math.max(contactDecl, logLine);
    const lineEnd = src.indexOf('\n', last);
    return src.slice(start, lineEnd);
}

async function runInputDefaults(input) {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const body = `"use strict";\n${inputDefaultsSection(src)}\nreturn { contactPages, maxTotal, reviewLimit };`;
    const run = new AsyncFunction('Actor', 'log', body);
    return run({ getInput: async () => input }, { info() {} });
}

function searchesSection(src) {
    const destructureAt = src.indexOf('const {\n    searchTerms');
    const destructureEnd = src.indexOf('} = input;', destructureAt);
    const searchesAt = src.indexOf('const searches = [');
    const searchesEnd = src.indexOf('];', searchesAt);
    assert.ok(destructureAt >= 0 && searchesAt > destructureAt);
    return `${src.slice(destructureAt, destructureEnd + '} = input;'.length)}\n${src.slice(searchesAt, searchesEnd + 2)}`;
}

async function searchesFrom(input) {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const run = new AsyncFunction('input', 'mapsSearchUrl', `"use strict";\n${searchesSection(src)}\nreturn searches;`);
    return run(input, mapsSearchUrl);
}

function htmlResponse(url, body) {
    return { statusCode: 200, headers: { 'content-type': 'text/html' }, body, url };
}

test('explicit zero place and page limits stay at the minimum instead of the paid default', async () => {
    const result = await runInputDefaults({ maxPlacesPerSearch: 0, maxContactPages: 0, maxReviews: 0 });
    assert.equal(result.maxTotal, 1);
    assert.equal(result.contactPages, 1);
    assert.equal(result.reviewLimit, 0);
});

test('maps links on maps.google.com and http are kept and do not add the default search', async () => {
    const searches = await searchesFrom({
        startUrls: [
            'https://maps.google.com/maps/search/dentist+in+Austin',
            'http://www.google.com/maps/search/plumber+in+Tampa',
        ],
    });
    assert.equal(searches.some((search) => search.term === 'coffee shop'), false);
    assert.equal(searches.length, 2);
});

test('a non-maps start URL does not fall through to the default paid search', async () => {
    const searches = await searchesFrom({ startUrls: ['https://example.com/not-maps'] });
    assert.equal(searches.length, 0);
});

test('different query ids on one host are enriched separately', async () => {
    let calls = 0;
    const cache = createEnrichmentCache(async (website) => {
        calls += 1;
        return { emails: [website], error: null };
    });
    await cache('https://booking.example/s?id=1');
    await cache('https://booking.example/s?id=2');
    await cache('https://www.booking.example/s?id=1&utm_source=google');
    assert.equal(calls, 2);
});

test('a cross-domain redirect is not stored or chargeable as that business contacts', async () => {
    const result = await enrichWebsite('https://acme-plumbing.com/', {
        validateMx: false,
        maxPages: 2,
        timeoutMs: 1000,
        fetchImpl: async () => htmlResponse(
            'https://directory-listings.com/acme',
            '<html><body><a href="mailto:sales@directory-listings.com">e</a><a href="tel:+12125550199">p</a></body></html>',
        ),
    });
    assert.equal(result.emails.includes('sales@directory-listings.com'), false);
    assert.equal((result.phones || []).some((phone) => String(phone).includes('2125550199')), false);
    assert.ok(result.error);
});

test('a same-site redirect still keeps the business email', async () => {
    const result = await enrichWebsite('https://acme-plumbing.com/', {
        validateMx: false,
        maxPages: 1,
        timeoutMs: 1000,
        fetchImpl: async () => htmlResponse(
            'https://www.acme-plumbing.com/',
            '<html><body><a href="mailto:info@acme-plumbing.com">e</a></body></html>',
        ),
    });
    assert.ok(result.emails.includes('info@acme-plumbing.com'));
    assert.equal(result.error, null);
});

test('a loaded Facebook website is not mined for the platform email or phone', async () => {
    const result = await enrichWebsite('https://www.facebook.com/acmeplumbing', {
        validateMx: false,
        maxPages: 1,
        timeoutMs: 1000,
        fetchImpl: async ({ url }) => htmlResponse(
            url,
            '<html><body><a href="mailto:privacy@facebook.com">p</a><a href="tel:+16505437600">t</a></body></html>',
        ),
    });
    assert.equal(result.emails.includes('privacy@facebook.com'), false);
    assert.equal((result.phones || []).some((phone) => String(phone).includes('6505437600')), false);
    assert.ok(result.socials.facebook.some((url) => url.includes('facebook.com/acmeplumbing')));
    assert.ok(result.error);
});

test('a run that saves zero places fails instead of exiting successfully', async () => {
    const { decideRunFinish, hardStopExitCode } = await import('../src/run-finish.js');
    assert.equal(decideRunFinish({ pushed: 0, searchFailures: 2, scheduled: 0 }).action, 'fail');
    assert.equal(decideRunFinish({ pushed: 0, scheduled: 4, detailFailures: 4 }).action, 'fail');
    assert.equal(decideRunFinish({ pushed: 0, scheduled: 0, searchFailures: 0 }).action, 'fail');
    assert.equal(decideRunFinish({ pushed: 3, searchFailures: 1 }).action, 'exit');
    assert.equal(hardStopExitCode(0), 1);
    assert.equal(hardStopExitCode(2), 0);
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(src, /decideRunFinish\(/);
    assert.doesNotMatch(src, /process\.exit\(0\)/);
});
