import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPage } from '../src/web/extract.js';
import { fetchHtml } from '../src/web/enrich.js';
import { enrichWebsite } from '../src/contacts.js';

test('huge inline base64 / long tokens do not freeze extraction', () => {
    const html = `<html><body><img src="data:image/png;base64,${'A'.repeat(500000)}"><p>${'x'.repeat(300000)}@</p>
<a href="mailto:office@vidadental.com">mail</a> call (305) 555-0100 office@vidadental.com</body></html>`;
    const t0 = Date.now();
    const r = extractPage(html, 'https://vidadental.com/', 'home');
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
    assert.ok(r.emails.some((e) => e.email === 'office@vidadental.com'));
});

test('fetchHtml gives up on a fetch that never settles', async () => {
    const t0 = Date.now();
    const r = await fetchHtml('https://stuck.example/', { timeoutMs: 100, fetchImpl: () => new Promise(() => {}) });
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 6000);
});

test('enrichWebsite enforces a per-site deadline and reports website_timeout', async () => {
    const t0 = Date.now();
    const r = await enrichWebsite('https://stuck.example', { deadlineMs: 200, engine: () => new Promise(() => {}) });
    assert.equal(r.error, 'website_timeout');
    assert.ok(Date.now() - t0 < 1000);
});
