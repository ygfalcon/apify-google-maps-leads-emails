import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceDeduper, fidFromMapsUrl, postKeys, preKeys } from '../src/dedupe.js';
import { drainDeadlineMs } from '../src/limits.js';

test('feature id from a Maps URL dedupes the same place', () => {
    const url = 'https://www.google.com/maps/place/Acme/data=!4m7!3m6!1s0x88c5c3d00907c1dd:0x275297802a680340!8m2';
    const encoded = 'https://www.google.com/maps/place/Acme/data=%214m7%213m6%211s0x88c5c3d00907c1dd:0x275297802a680340';
    assert.equal(fidFromMapsUrl(url), '0x88c5c3d00907c1dd:0x275297802a680340');
    assert.equal(fidFromMapsUrl(encoded), fidFromMapsUrl(url));
    const deduper = createPlaceDeduper();
    assert.equal(deduper.claim(preKeys(url)), true);
    assert.equal(deduper.claim(preKeys('https://www.google.com/maps/place/Acme-copy/data=!1s0x88c5c3d00907c1dd:0x275297802a680340')), false);
});

test('place id, phone plus website, and name plus postal code dedupe after detail', () => {
    const deduper = createPlaceDeduper();
    const place = {
        placeId: 'ChIJabc',
        phone: '+18135550100',
        website: 'https://www.joespizza.com/',
        title: "Joe's Pizza",
        postalCode: '33614',
    };
    assert.equal(deduper.conflicts(postKeys(place)), false);
    deduper.remember(postKeys(place));
    assert.equal(deduper.conflicts(postKeys({ placeId: 'ChIJabc', title: 'Other', postalCode: '00000' })), true);
    assert.equal(deduper.conflicts(postKeys({ phone: '+18135550100', website: 'https://joespizza.com/menu', title: 'Different' })), true);
    assert.equal(deduper.conflicts(postKeys({ title: 'Joes Pizza', postalCode: '33614' })), true);
    assert.equal(deduper.conflicts(postKeys({ title: 'Joes Pizza', postalCode: '33615', phone: '+19995550111', website: 'https://other.example' })), false);
});

test('different places both pass', () => {
    const deduper = createPlaceDeduper();
    assert.equal(deduper.claim(preKeys('https://www.google.com/maps/place/A/data=!1s0x1:0x2')), true);
    assert.equal(deduper.claim(preKeys('https://www.google.com/maps/place/B/data=!1s0x3:0x4')), true);
});

test('drain deadline grows with the queue and stays capped', () => {
    assert.equal(drainDeadlineMs(0), 120000);
    assert.equal(drainDeadlineMs(10), 120000);
    assert.equal(drainDeadlineMs(100), 150000);
    assert.equal(drainDeadlineMs(100000), 15 * 60 * 1000);
});
