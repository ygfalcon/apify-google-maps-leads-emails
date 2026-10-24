import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('places are queued while the results list is still scrolling', () => {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(src, /while \(links\.size < want && stale < 8 && Date\.now\(\) - t0 < 180000\)/);
    assert.match(src, /for \(const url of links\) enqueue\(url\)/);
    const loopAt = src.indexOf('while (links.size < want && stale < 8 && Date.now() - t0 < 180000)');
    const enqueueAt = src.indexOf('for (const url of links) enqueue(url)');
    const afterLoop = src.indexOf('Feed stalled at', loopAt);
    assert.ok(loopAt >= 0 && enqueueAt > loopAt && enqueueAt < afterLoop);
});

test('published prices stay $0.0034 per place and $0.0015 per contacts result', () => {
    const pricing = JSON.parse(fs.readFileSync(new URL('../.actor/pricing.json', import.meta.url), 'utf8'));
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.equal(pricing.events.find((event) => event.eventName === 'place-scraped').priceUsd, 0.0034);
    assert.equal(pricing.events.find((event) => event.eventName === 'contacts-enriched').priceUsd, 0.0015);
    assert.match(main, /0\.0034/);
    assert.match(main, /0\.0015/);
});
