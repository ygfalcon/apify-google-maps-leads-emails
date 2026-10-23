import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createLimiter } from '../src/pool.js';
import { extractFromHtml } from '../src/contacts.js';
import { extractPreviewUrl, fetchPlaceDetail } from '../src/detail.js';
import { normalizePhone, parsePreviewPayload, toDatasetItem } from '../src/place.js';

function setPath(root, path, value) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i];
        if (!Array.isArray(cur[idx])) cur[idx] = [];
        cur = cur[idx];
    }
    cur[path[path.length - 1]] = value;
}

function envelope() {
    const d = [];
    setPath(d, [11], "Kim's Island");
    setPath(d, [13], ['Chinese restaurant', 'Delivery Restaurant', '$$']);
    setPath(d, [18], "Kim's Island, 175 Main St, Staten Island, NY 10307");
    setPath(d, [7, 0], 'https://kimsislandsi.com/?utm_source=google&utm_medium=organic');
    setPath(d, [178, 0, 0], '(718) 356-5168');
    setPath(d, [183, 2, 2, 0], 'GQ62+8M Staten Island, New York');
    setPath(d, [183, 1], ['Tottenville', '175 Main St', '175 Main St', 'Staten Island', '10307', 'New York', 'US']);
    setPath(d, [4, 7], 4.5);
    setPath(d, [4, 8], 104);
    setPath(d, [175, 3], [6, 3, 3, 11, 81]);
    setPath(d, [9, 2], 40.5107736);
    setPath(d, [9, 3], -74.2482624);
    setPath(d, [78], 'ChIJJQz5EZzKw4kRCZ95UajbyGw');
    setPath(d, [10], '0x89c3ca9c11f90c25:0x6cc8dba851799f09');
    setPath(d, [32, 1, 1], 'Family Chinese spot on Main Street.');
    setPath(d, [37, 0, 1, 6, 1], '30 Photos');
    setPath(d, [38, 0], 'http://kimsislandsi.com/menu');
    setPath(d, [46, 0], ['https://www.opentable.com/r/kims-island', 'opentable.com']);
    setPath(d, [88, 0], null);
    setPath(d, [203, 0], [
        ['Friday', 5, [2026, 10, 23], [['11\u202fAM–10:30\u202fPM', [[11], [22, 30]]]], 0, 1],
        ['Monday', 1, [2026, 10, 26], [['Closed']], 0, 2],
    ]);
    setPath(d, [84], [
        [
            [1, [[6, 0, '', 'None', '6 AM'], [7, 35]]],
            [7, [[18, 80]]],
        ],
        null, null, null, null, null,
        'A little busy',
        [22, 76],
    ]);
    const review = [
        'rev1',
        [null, null, 1700000000000000, 1700000000000000, [null, null, ['https://www.google.com/maps/contrib/1'], null, null, ['Ada Lovelace', 'https://example.com/a.jpg']]],
        [],
    ];
    review[1][6] = '2 years ago';
    setPath(review, [2, 0, 0], 5);
    setPath(review, [2, 15, 0, 0], 'Crab rangoon is the one to get.');
    // Live payloads wrap each review tuple in an outer array.
    setPath(d, [175, 9, 0, 0], [[review]]);
    return d;
}

function payload(d) {
    const root = [null, null, null, null, null, null, d];
    return `)]}'\n${JSON.stringify(root)}`;
}

test('normalizePhone turns US display numbers into E.164', () => {
    assert.equal(normalizePhone('(718) 356-5168'), '+17183565168');
    assert.equal(normalizePhone('+1 813-872-0200'), '+18138720200');
    assert.equal(normalizePhone(''), null);
});

test('parsePreviewPayload fills the fields compass has and we were missing', () => {
    const place = parsePreviewPayload(payload(envelope()), { maxReviews: 2 });
    assert.equal(place.title, "Kim's Island");
    assert.deepEqual(place.categories, ['Chinese restaurant', 'Delivery Restaurant']);
    assert.equal(place.category, 'Chinese restaurant');
    assert.equal(place.priceLevel, '$$');
    assert.equal(place.street, '175 Main St');
    assert.equal(place.neighborhood, 'Tottenville');
    assert.equal(place.city, 'Staten Island');
    assert.equal(place.postalCode, '10307');
    assert.equal(place.state, 'New York');
    assert.equal(place.countryCode, 'US');
    assert.equal(place.address, '175 Main St, Staten Island, NY 10307');
    assert.equal(place.phone, '+17183565168');
    assert.equal(place.website, 'https://kimsislandsi.com/');
    assert.equal(place.rating, 4.5);
    assert.equal(place.reviewsCount, 104);
    assert.deepEqual(place.reviewsDistribution, { oneStar: 6, twoStar: 3, threeStar: 3, fourStar: 11, fiveStar: 81 });
    assert.equal(place.imagesCount, 30);
    assert.equal(place.description, 'Family Chinese spot on Main Street.');
    assert.equal(place.menuUrl, 'http://kimsislandsi.com/menu');
    assert.equal(place.reservationUrl, 'https://www.opentable.com/r/kims-island');
    assert.equal(place.permanentlyClosed, false);
    assert.equal(place.temporarilyClosed, false);
    assert.equal(place.closedStatus, null);
    assert.deepEqual(place.openingHours, ['Friday: 11 AM–10:30 PM', 'Monday: Closed']);
    assert.equal(place.popularTimesLiveText, 'A little busy');
    assert.equal(place.popularTimesLivePercent, 76);
    assert.deepEqual(place.popularTimesHistogram.monday, [{ hour: 6, occupancyPercent: 0 }, { hour: 7, occupancyPercent: 35 }]);
    assert.deepEqual(place.popularTimesHistogram.sunday, [{ hour: 18, occupancyPercent: 80 }]);
    assert.equal(place.reviews.length, 1);
    assert.equal(place.reviews[0].author, 'Ada Lovelace');
    assert.equal(place.reviews[0].rating, 5);
    assert.equal(place.reviews[0].text, 'Crab rangoon is the one to get.');
    assert.equal(place.placeId, 'ChIJJQz5EZzKw4kRCZ95UajbyGw');
    assert.equal(place.cid, '7838756667406262025');
    assert.deepEqual(place.location, { lat: 40.5107736, lng: -74.2482624 });
});

test('reviews stay empty unless requested, and closed flags are explicit', () => {
    const d = envelope();
    setPath(d, [88, 0], 'CLOSED');
    const off = parsePreviewPayload(payload(d), { maxReviews: 0 });
    assert.deepEqual(off.reviews, []);
    assert.equal(off.permanentlyClosed, true);
    assert.equal(off.temporarilyClosed, false);
    assert.equal(off.closedStatus, 'permanently_closed');
    setPath(d, [88, 0], 'TEMPORARILY_CLOSED');
    const temp = parsePreviewPayload(payload(d));
    assert.equal(temp.temporarilyClosed, true);
    assert.equal(temp.permanentlyClosed, false);
    assert.equal(temp.closedStatus, 'temporarily_closed');
});

test('a long editorial blurb is not treated as a closed flag', () => {
    const d = envelope();
    setPath(d, [88, 0], 'Michelin-starred seasonal, contemporary American restaurant');
    const place = parsePreviewPayload(payload(d));
    assert.equal(place.permanentlyClosed, false);
    assert.equal(place.closedStatus, null);
});

test('extractPreviewUrl reads the pb link and ignores the bare endpoint', () => {
    const html = '<link href="/maps/preview/place?authuser=0&amp;hl=en&amp;pb=%211m17" /><script>"/maps/preview/place?authuser\\u003d0"</script>';
    assert.equal(extractPreviewUrl(html), 'https://www.google.com/maps/preview/place?authuser=0&hl=en&pb=%211m17');
    const ampersand = extractPreviewUrl('<a href="/maps/preview/place?q=Air+%26+Electric&amp;pb=%211m1">');
    assert.equal(ampersand, 'https://www.google.com/maps/preview/place?q=Air+%26+Electric&pb=%211m1');
    assert.equal(extractPreviewUrl('<html>nope</html>'), null);
});

test('fetchPlaceDetail uses one proxy for the html and preview hops', async () => {
    const calls = [];
    const html = '<a href="/maps/preview/place?authuser=0&amp;hl=en&amp;pb=%211sfeature">x</a>';
    const fetchImpl = async (url, opts) => {
        calls.push({ url, proxyUrl: opts.proxyUrl });
        if (url.includes('preview/place')) return { status: 200, body: payload(envelope()), bytes: 40 };
        return { status: 200, body: html, bytes: 10 };
    };
    const result = await fetchPlaceDetail('https://www.google.com/maps/place/data=!4m5!1s0x1:0x2', {
        proxyUrl: 'http://proxy.example:8000',
        maxReviews: 0,
        fetchImpl,
    });
    assert.equal(result.error, null);
    assert.equal(result.place.title, "Kim's Island");
    assert.equal(result.bytes, 50);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].proxyUrl, calls[1].proxyUrl);
    assert.ok(calls[1].url.includes('preview/place'));
});

test('dataset item matches the dataset schema and keeps prices unchanged', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../.actor/dataset_schema.json', import.meta.url), 'utf8'));
    const pricing = JSON.parse(fs.readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
    const place = parsePreviewPayload(payload(envelope()), { maxReviews: 1 });
    const item = toDatasetItem(place, {
        searchTerm: 'plumber',
        rank: 1,
        emails: ['ada@example.com'],
        socials: { facebook: ['https://www.facebook.com/ada'] },
        websitePhones: ['+17183565168'],
        contactsStatus: 'ok',
        scrapedAt: '2026-10-23T00:00:00.000Z',
    });
    const props = schema.fields.properties;
    for (const [key, value] of Object.entries(item)) {
        assert.ok(props[key], `dataset schema is missing ${key}`);
        assert.ok(valueAllowed(props[key], value), `${key} does not match the schema`);
    }
    for (const key of schema.fields.required) assert.ok(item[key]);
    assert.equal(pricing.events.find((e) => e.eventName === 'place-scraped').priceUsd, 0.003);
    assert.equal(pricing.events.find((e) => e.eventName === 'contacts-enriched').priceUsd, 0.001);
});

test('contact extractor still keeps same-domain emails and social profiles', () => {
    const html = `
      <a href="mailto:Ada@Cafe.example">x</a>
      <a href="tel:+1 (813) 872-0200">p</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=1">share</a>
      <a href="https://www.instagram.com/everydayplumber">ig</a>
      <a href="/contact">contact</a>
      <img src="photo@2x.png">
    `;
    const got = extractFromHtml(html, 'https://cafe.example/');
    assert.deepEqual(got.emails, ['ada@cafe.example']);
    assert.ok(got.phones.includes('+18138720200') || got.phones.some((p) => p.includes('8138720200')));
    assert.deepEqual(got.socials.instagram, ['https://www.instagram.com/everydayplumber']);
    assert.equal(got.socials.facebook, undefined);
    assert.ok(got.contactLinks[0].includes('/contact'));
});

test('the search scroll loop is the 11cf288 loop', () => {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(src, /while \(links\.size < want && stale < 8 && Date\.now\(\) - t0 < 180000\)/);
    assert.match(src, /waitForFunction\(\(n\) => document\.querySelectorAll\('a\.hfpxzc'\)\.length > n \|\| !!document\.querySelector\('span\.HlvSq'\), cards, \{ timeout: 5000 \}\)/);
    assert.match(src, /if \(stale >= 2\)/);
    assert.match(src, /Feed stalled at/);
});

test('limiter runs queued work and resolves each job when that job finishes', async () => {
    const limit = createLimiter(2);
    const order = [];
    const slow = limit(async () => { await delay(40); order.push('slow'); return 'slow'; });
    const fast = limit(async () => { await delay(5); order.push('fast'); return 'fast'; });
    const values = await Promise.all([slow, fast]);
    assert.deepEqual(order, ['fast', 'slow']);
    assert.deepEqual(values, ['slow', 'fast']);
});

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function valueAllowed(schema, value) {
    const types = [].concat(schema.type);
    if (value === null) return types.includes('null');
    if (types.includes('array')) return Array.isArray(value);
    if (types.includes('object')) return typeof value === 'object' && !Array.isArray(value);
    if (types.includes('string')) return typeof value === 'string';
    if (types.includes('number')) return typeof value === 'number' && Number.isFinite(value);
    if (types.includes('boolean')) return typeof value === 'boolean';
    if (types.includes('integer')) return Number.isInteger(value);
    return false;
}
