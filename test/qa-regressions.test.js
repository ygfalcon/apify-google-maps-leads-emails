import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { enrichWebsite as engineEnrich, fetchHtml } from '../src/web/enrich.js';
import { closeScanPool } from '../src/web/scan-pool.js';
import { extractPage, extractSocials, finalizeContacts, isValidEmailSyntax } from '../src/web/extract.js';
import { enrichWebsite, isPlausibleEmail } from '../src/contacts.js';

test.after(async () => {
    await closeScanPool();
});
import { fetchPlaceDetail } from '../src/detail.js';
import { parsePreviewPayload, toDatasetItem } from '../src/place.js';

function setPath(root, path, value) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i];
        if (!Array.isArray(cur[idx])) cur[idx] = [];
        cur = cur[idx];
    }
    cur[path[path.length - 1]] = value;
}

function payload(d) {
    return `)]}'\n${JSON.stringify([null, null, null, null, null, null, d])}`;
}

function emailsOf(html, base = 'https://ku64.de/kontakt/') {
    return extractPage(html, base, 'contact').emails.map((row) => row.email);
}

test('adjacent tel and mailto anchors do not glue the phone, the email, or the following word', () => {
    const html = '<a href="tel:+49308647320">030 86 4732 0</a><a href="mailto:info@ku64.de">info@ku64.de</a>Kurfürstendamm';
    const page = extractPage(html, 'https://ku64.de/kontakt/', 'contact');
    const emails = page.emails.map((row) => row.email);
    assert.ok(emails.includes('info@ku64.de'), emails.join(','));
    assert.equal(emails.includes('0info@ku64.dekurf'), false);
    const fin = finalizeContacts({
        emailRows: page.emails,
        people: page.people,
        phoneEntries: page.phones,
        siteHost: 'ku64.de',
    });
    assert.ok(fin.phones.includes('+49308647320'), fin.phones.join(','));
    assert.equal(fin.phones.includes('+4930864732'), false);
});

test('a phone glued onto a gmail address is not an email', () => {
    const emails = emailsOf('<p>312.600.2777higoodbeautychicago@gmail.com</p>', 'https://goodbeautychicago.com/');
    assert.equal(emails.some((email) => email.includes('higoodbeautychicago')), false);
    assert.equal(isValidEmailSyntax('312.600.2777higoodbeautychicago@gmail.com'), false);
});

test('closing a strong tag before a mailto span keeps the real gmail address', () => {
    const html = '<p>Email us</strong><span>higoodbeautychicago@gmail.com</span></p>';
    assert.deepEqual(emailsOf(html, 'https://goodbeautychicago.com/'), ['higoodbeautychicago@gmail.com']);
});

test('a glued "us" prefix is dropped when the same mailbox is also present', () => {
    const html = '<p>ushigoodbeautychicago@gmail.com higoodbeautychicago@gmail.com</p>';
    const fin = finalizeContacts({
        emailRows: extractPage(html, 'https://goodbeautychicago.com/', 'home').emails,
        people: [],
        phoneEntries: [],
        siteHost: 'goodbeautychicago.com',
    });
    assert.deepEqual(fin.emails, ['higoodbeautychicago@gmail.com']);
});

test('an address split by a span around @ still joins, and "contact us at" does not', () => {
    assert.ok(emailsOf('<p>info<span>@</span>acme.dev</p>', 'https://acme.dev/').includes('info@acme.dev'));
    assert.equal(emailsOf('<p>contact us at acme.dev</p>', 'https://acme.dev/').includes('us@acme.dev'), false);
    assert.equal(isValidEmailSyntax('contact-us@ku64.de'), true);
});

test('instagram handles are not emails, and real TLDs still are', () => {
    for (const email of ['angy@mucho.cabello', 'stylist@styles.by.zy', 'by@hailey.the.stylist']) {
        assert.equal(isValidEmailSyntax(email), false, email);
        assert.equal(isPlausibleEmail(email), false, email);
    }
    for (const email of ['create@epochchicago.com', 'hello@acme.dev', 'hello@studio.nyc', 'sales@acme.co.uk', 'info@ku64.de']) {
        assert.equal(isValidEmailSyntax(email), true, email);
        assert.equal(isPlausibleEmail(email), true, email);
    }
    const found = emailsOf('<p>Angy @mucho.cabello</p><p>create@epochchicago.com</p>', 'https://epochchicago.com/');
    assert.deepEqual(found, ['create@epochchicago.com']);
});

test('fbml namespaces and numeric instagram fragments are not profiles', () => {
    const html = `
      <html xmlns:fb="http://www.facebook.com/2008/fbml">
        <a href="https://www.facebook.com/goodambler">fb</a>
        <a href="https://www.facebook.com/194190773839">page</a>
        <a href="https://www.facebook.com/profile.php?id=12345">profile</a>
        <a href="https://www.instagram.com/17841401847327097/">plugin</a>
        <a href="https://www.instagram.com/thebakehousechicago">ig</a>
      </html>`;
    const socials = extractSocials(html);
    assert.equal(socials.facebook.some((url) => url.includes('fbml')), false);
    assert.ok(socials.facebook.includes('https://www.facebook.com/goodambler'));
    assert.ok(socials.facebook.includes('https://www.facebook.com/194190773839'));
    assert.ok(socials.facebook.includes('https://www.facebook.com/profile.php?id=12345'));
    assert.equal(socials.instagram.some((url) => url.includes('17841401847327097')), false);
    assert.ok(socials.instagram.includes('https://www.instagram.com/thebakehousechicago'));
});

test('third-party mailboxes are separated from the business and from free mail', async () => {
    const { isThirdPartyEmail } = await import('../src/web/extract.js');
    assert.equal(typeof isThirdPartyEmail, 'function');
    const host = 'dental21-charlottenburg.de';
    for (const email of [
        'dental21-jobs@m.personio.de',
        'medizinproduktesicherheit@patient21.com',
        'datenschutz@dental21.de',
        'mailbox@datenschutz-berlin.de',
        'online@booking.mangomint.com',
        'pr-inquiry@horsepowerbrands.com',
        'holladayhills@magnoliabakeryfranchise.com',
        'admin@igniteyourtaxes.com',
        'chris@nmaab.com',
        'contact@digitalagenten.com',
    ]) {
        assert.equal(isThirdPartyEmail(email, host), true, email);
    }
    assert.equal(isThirdPartyEmail('info@mightydogroofing.com', 'www.mightydogroofing.com'), false);
    assert.equal(isThirdPartyEmail('hello@gmail.com', host), false);
    assert.equal(isThirdPartyEmail('info@ku64.de', 'ku64.de'), false);

    const enriched = await enrichWebsite('https://ku64.de/', {
        engine: async () => ({
            emails: ['info@ku64.de', 'contact@digitalagenten.com', 'studio@gmail.com'],
            phones: [],
            socials: {},
            pagesScanned: 1,
            error: null,
            finalUrl: 'https://ku64.de/',
        }),
    });
    assert.deepEqual(enriched.emails, ['info@ku64.de', 'studio@gmail.com']);
    assert.deepEqual(enriched.thirdPartyEmails, ['contact@digitalagenten.com']);
});

test('German Impressum text yields the owner and a labelled VAT id', async () => {
    const { extractImpressum, wantsImpressum } = await import('../src/web/extract.js');
    assert.equal(typeof extractImpressum, 'function');
    const f80 = [
        'Vertreten durch den Geschäftsführer:',
        'Dr. Stephan Ziegler',
        'Redaktionell verantwortlich',
        'Dr. James Belcher',
        'HRB 230854 B',
    ].join('\n');
    const fromF80 = extractImpressum(f80);
    assert.equal(fromF80.owner, 'Dr. Stephan Ziegler');
    assert.equal(fromF80.vatId, null);

    const ku64 = 'Geschäftsführender Gesellschafter Dr. med. dent. Stephan Ziegler (Zahnarzt Berlin Charlottenburg)\nUSt-IdNr.: DE 136695976\nTel: +49 30 8647320';
    const fromKu = extractImpressum(ku64);
    assert.equal(fromKu.owner, 'Dr. med. dent. Stephan Ziegler');
    assert.equal(fromKu.vatId, 'DE136695976');
    assert.equal(extractImpressum('Tel: +49 30 8647320').vatId, null);
    assert.equal(wantsImpressum('DE', 'https://example.com'), true);
    assert.equal(wantsImpressum('US', 'https://ku64.de/kontakt'), true);
    assert.equal(wantsImpressum('US', 'https://example.com'), false);
});

test('an impressum page visited during enrichment fills owner and VAT', async () => {
    const home = '<html><body><a href="/impressum">Impressum</a><a href="mailto:info@ku64.de">mail</a></body></html>';
    const impressum = '<html><body><p>Geschäftsführender Gesellschafter Dr. med. dent. Stephan Ziegler (Zahnarzt Berlin Charlottenburg)</p><p>USt-IdNr.: DE 136695976</p><p>Redaktionell verantwortlich Dr. James Belcher</p></body></html>';
    const result = await engineEnrich('https://ku64.de/', {
        validateMx: false,
        maxPages: 3,
        timeoutMs: 1000,
        fetchImpl: async ({ url }) => ({
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: String(url).includes('impressum') ? impressum : home,
            url,
        }),
    });
    assert.equal(result.impressum?.owner, 'Dr. med. dent. Stephan Ziegler');
    assert.equal(result.impressum?.vatId, 'DE136695976');
    assert.notEqual(result.impressum?.owner, 'Dr. James Belcher');
});

test('locations that share one website reuse one enrichment, including one already in flight', async () => {
    const { createEnrichmentCache } = await import('../src/contacts.js');
    assert.equal(typeof createEnrichmentCache, 'function');
    let calls = 0;
    const cache = createEnrichmentCache(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { emails: ['info@thebakehousechicago.com'], error: null };
    });
    const [a, b] = await Promise.all([
        cache('http://www.thebakehousechicago.com/'),
        cache('https://thebakehousechicago.com'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.emails[0], b.emails[0]);
});

test('different paths on the same host are enriched separately', async () => {
    const { createEnrichmentCache } = await import('../src/contacts.js');
    let calls = 0;
    const cache = createEnrichmentCache(async (website) => {
        calls += 1;
        return { emails: [website], error: null };
    });
    await cache('https://levainbakery.com/pages/west-loop');
    await cache('https://levainbakery.com/pages/river-north/');
    assert.equal(calls, 2);
});

test('a failed enrichment is not reused, so a later location can try again', async () => {
    const { createEnrichmentCache } = await import('../src/contacts.js');
    let calls = 0;
    const cache = createEnrichmentCache(async () => {
        calls += 1;
        if (calls === 1) return { emails: [], error: 'website_unreachable' };
        return { emails: ['info@thebakehousechicago.com'], error: null };
    });
    const first = await cache('https://thebakehousechicago.com/');
    assert.equal(first.error, 'website_unreachable');
    const second = await cache('https://www.thebakehousechicago.com');
    assert.equal(second.error, null);
    assert.equal(calls, 2);
});

test('proxy setup falls back to a direct connection when the proxy cannot be created or reached', async () => {
    const { selectProxy, proxyResponds } = await import('../src/proxy.js');
    assert.equal(await selectProxy({}, { createProxy: () => { throw new Error('should not be called'); } }), undefined);
    assert.equal(await selectProxy({ useApifyProxy: true }, {
        createProxy: async () => { throw new Error('no token'); },
        log: { warning() {} },
    }), undefined);
    const proxy = { newUrl: async () => 'http://proxy.example:8000' };
    assert.equal(await selectProxy({ useApifyProxy: true }, {
        createProxy: async () => proxy,
        probe: async () => false,
        log: { warning() {} },
    }), undefined);
    assert.equal(await selectProxy({ proxyUrls: ['http://proxy.example:8000'] }, {
        createProxy: async () => proxy,
        probe: async () => true,
    }), proxy);
    const t0 = Date.now();
    const ok = await proxyResponds(proxy, { timeoutMs: 50, fetchImpl: () => new Promise(() => {}) });
    assert.equal(ok, false);
    assert.ok(Date.now() - t0 < 1000);
});

test('website fetch retries a proxy network error once without the proxy, and does not bypass a 403', async () => {
    const seen = [];
    const page = await fetchHtml('https://ku64.de/', {
        proxyUrl: 'http://proxy.example:8000',
        timeoutMs: 500,
        fetchImpl: async (opts) => {
            seen.push(opts.proxyUrl);
            if (opts.proxyUrl) throw new Error('ECONNRESET');
            return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>', url: opts.url };
        },
    });
    assert.ok(page?.html?.includes('ok'));
    assert.ok(seen.includes(undefined));

    const blocked = [];
    const denied = await fetchHtml('https://www.google.com/maps', {
        proxyUrl: 'http://proxy.example:8000',
        timeoutMs: 500,
        fetchImpl: async (opts) => {
            blocked.push(opts.proxyUrl);
            return { statusCode: 403, headers: { 'content-type': 'text/html' }, body: 'no', url: opts.url };
        },
    });
    assert.equal(denied, null);
    assert.deepEqual(blocked, ['http://proxy.example:8000']);
});

test('place detail retries a proxy network error on a direct connection', async () => {
    const html = '<a href="/maps/preview/place?authuser=0&amp;hl=en&amp;pb=%211sfeature">x</a>';
    const seen = [];
    const result = await fetchPlaceDetail('https://www.google.com/maps/place/data=!4m5!1s0x1:0x2', {
        proxyUrl: 'http://proxy.example:8000',
        fetchImpl: async (url, opts) => {
            seen.push(opts.proxyUrl ?? null);
            if (opts.proxyUrl) throw new Error('proxy timeout');
            if (String(url).includes('preview/place')) return { status: 200, body: payload([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Blockbuster']), bytes: 20 };
            return { status: 200, body: html, bytes: 10 };
        },
    });
    assert.equal(result.error, null);
    assert.equal(result.place.title, 'Blockbuster');
    assert.ok(seen.includes(null));
});

test('a capped search that still wants more places splits into four closer views', async () => {
    const { shouldSplitArea, childViews, feedNeedsRetry, mapsSearchUrl, parseMapView, planAreaSplits } = await import('../src/split.js');
    assert.equal(shouldSplitArea({ found: 40, wanted: 200 }), false);
    assert.equal(shouldSplitArea({ found: 99, wanted: 200 }), false);
    assert.equal(shouldSplitArea({ found: 120, wanted: 200 }), true);
    assert.equal(shouldSplitArea({ found: 100, wanted: 500 }), true);
    assert.equal(shouldSplitArea({ found: 120, wanted: 200, depth: 3 }), false);
    assert.equal(shouldSplitArea({ found: 120, wanted: 50 }), false);
    assert.equal(shouldSplitArea({ found: 20, wanted: 20 }), false);
    const children = childViews({ lat: 41.88, lng: -87.63, zoom: 12 });
    assert.equal(children.length, 4);
    assert.equal(new Set(children.map((view) => `${view.lat},${view.lng}`)).size, 4);
    assert.ok(children.every((view) => view.zoom === 13));
    assert.equal(
        mapsSearchUrl({ term: 'bakery', location: 'Chicago', language: 'en' }),
        'https://www.google.com/maps/search/bakery%20in%20Chicago?hl=en',
    );
    const zoomed = mapsSearchUrl({ term: 'bakery', location: 'Chicago', language: 'en', view: children[0] });
    assert.match(zoomed, /@/);
    assert.doesNotMatch(zoomed, / in /);
    assert.deepEqual(parseMapView('https://www.google.com/maps/search/bakery/@41.88,-87.63,12z/data=!3m1'), { lat: 41.88, lng: -87.63, zoom: 12 });
    const planned = planAreaSplits({
        found: 120,
        wanted: 200,
        depth: 0,
        view: { lat: 41.88, lng: -87.63, zoom: 12 },
        term: 'bakery',
        location: 'Chicago',
        language: 'en',
    });
    assert.equal(planned.length, 4);
    assert.equal(planned[0].userData.depth, 1);
    assert.equal(planAreaSplits({ found: 20, wanted: 20, depth: 0, view: { lat: 1, lng: 2, zoom: 3 }, term: 'cafe' }).length, 0);
    assert.equal(feedNeedsRetry({ found: 40, wanted: 200, ended: false, retryCount: 0 }), true);
    assert.equal(feedNeedsRetry({ found: 120, wanted: 200, ended: false, retryCount: 0 }), false);
    assert.equal(feedNeedsRetry({ found: 40, wanted: 200, ended: true, retryCount: 0 }), false);
});

test('header and German closed phrases set the status, and an hours line does not', () => {
    const open = [];
    setPath(open, [11], 'Heidenreich & Heidenreich, CPAs, PLLC');
    setPath(open, [88, 0], null);
    setPath(open, [203, 0], null);
    setPath(open, [96, 10, 1, 0, 3, 2, 1], 'Add hours');
    assert.equal(parsePreviewPayload(payload(open)).closedStatus, null);
    assert.equal(parsePreviewPayload(payload(open)).permanentlyClosed, false);

    const permanent = [];
    setPath(permanent, [11], 'Blockbuster');
    setPath(permanent, [88, 0], null);
    setPath(permanent, [96, 10, 1, 0, 3, 2, 1], 'Permanently closed');
    assert.equal(parsePreviewPayload(payload(permanent)).closedStatus, 'permanently_closed');

    const temporary = [];
    setPath(temporary, [11], 'Cafe');
    setPath(temporary, [88, 0], null);
    setPath(temporary, [96, 10, 1, 0, 3, 2, 1], 'Temporarily closed');
    assert.equal(parsePreviewPayload(payload(temporary)).closedStatus, 'temporarily_closed');

    const hours = [];
    setPath(hours, [11], 'Bakery');
    setPath(hours, [88, 0], null);
    setPath(hours, [96, 10, 1, 0, 3, 2, 1], 'Closed · Opens 9 AM Mon');
    assert.equal(parsePreviewPayload(payload(hours)).closedStatus, null);

    const germanOpen = [];
    setPath(germanOpen, [11], 'Bäckerei');
    setPath(germanOpen, [88, 0], 'Geschlossen · Öffnet 9 Uhr Mo');
    assert.equal(parsePreviewPayload(payload(germanOpen)).closedStatus, null);

    const dauerhaft = [];
    setPath(dauerhaft, [11], 'Laden');
    setPath(dauerhaft, [88, 0], 'Dauerhaft geschlossen');
    assert.equal(parsePreviewPayload(payload(dauerhaft)).closedStatus, 'permanently_closed');

    const vor = [];
    setPath(vor, [11], 'Laden');
    setPath(vor, [88, 0], 'Vorübergehend geschlossen');
    assert.equal(parsePreviewPayload(payload(vor)).closedStatus, 'temporarily_closed');

    const enumClosed = [];
    setPath(enumClosed, [11], 'Shop');
    setPath(enumClosed, [88, 0], 'CLOSED_PERMANENTLY');
    assert.equal(parsePreviewPayload(payload(enumClosed)).closedStatus, 'permanently_closed');

    const exact = [];
    setPath(exact, [11], 'Shop');
    setPath(exact, [88, 0], 'GESCHLOSSEN');
    assert.equal(parsePreviewPayload(payload(exact)).closedStatus, 'permanently_closed');
});

test('dataset rows carry third-party emails and German impressum fields, and prices stay the same', () => {
    const place = parsePreviewPayload(payload((() => {
        const d = [];
        setPath(d, [11], 'ku64');
        setPath(d, [183, 1], [null, null, null, 'Berlin', '10719', null, 'DE']);
        return d;
    })()));
    const item = toDatasetItem(place, {
        emails: ['info@ku64.de'],
        thirdPartyEmails: ['contact@digitalagenten.com'],
        impressumOwner: 'Dr. med. dent. Stephan Ziegler',
        vatId: 'DE136695976',
        contactsStatus: 'ok',
    });
    assert.deepEqual(item.thirdPartyEmails, ['contact@digitalagenten.com']);
    assert.equal(item.impressumOwner, 'Dr. med. dent. Stephan Ziegler');
    assert.equal(item.vatId, 'DE136695976');
    const empty = toDatasetItem(place, { contactsStatus: 'ok' });
    assert.deepEqual(empty.thirdPartyEmails, []);
    assert.equal(empty.impressumOwner, null);
    assert.equal(empty.vatId, null);
    const pricing = JSON.parse(fs.readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
    assert.equal(pricing.events.find((event) => event.eventName === 'place-scraped').priceUsd, 0.0034);
    assert.equal(pricing.events.find((event) => event.eventName === 'contacts-enriched').priceUsd, 0.0015);
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(main, /const proxy = await selectProxy\(/);
    assert.match(main, /createEnrichmentCache/);
    assert.match(main, /planAreaSplits/);
    assert.match(main, /while \(links\.size < want && stale < 8 && Date\.now\(\) - t0 < 180000\)/);
});
