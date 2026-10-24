import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPlaceDetail, shouldRetryDetail } from '../src/detail.js';

test('fetchPlaceDetail gives up when a hop never settles', async () => {
    const started = Date.now();
    const result = await fetchPlaceDetail('https://www.google.com/maps/place/data=!4m5', {
        timeoutMs: 200,
        fetchImpl: () => new Promise(() => {}),
    });
    assert.equal(result.place, null);
    assert.equal(result.error, 'hard_timeout');
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
});

test('parse failures are not retried and network failures are', () => {
    assert.equal(shouldRetryDetail('place_parse_failed'), false);
    assert.equal(shouldRetryDetail('place_page_failed'), true);
    assert.equal(shouldRetryDetail('preview_failed'), true);
    assert.equal(shouldRetryDetail('hard_timeout'), true);
});
