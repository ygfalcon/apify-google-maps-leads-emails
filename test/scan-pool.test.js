import assert from 'node:assert/strict';
import test from 'node:test';
import { createScanPool } from '../src/web/scan-pool.js';

test('scan pool extracts contacts from a real page and then closes', async () => {
    const pool = createScanPool({ size: 1, timeoutMs: 8000 });
    try {
        const found = await pool.scan(
            '<a href="mailto:office@acmeplumbing.com">x</a><a href="https://www.instagram.com/acmeplumbing">ig</a>',
            'https://acmeplumbing.com/',
            'home',
        );
        assert.ok(found.emails.some((row) => row.email === 'office@acmeplumbing.com'));
        assert.ok(found.socials.instagram.includes('https://www.instagram.com/acmeplumbing'));
    } finally {
        await pool.close();
    }
});

test('a stuck regex scan is killed and the call returns', async () => {
    const pool = createScanPool({
        size: 1,
        timeoutMs: 200,
        workerPath: new URL('../fixtures/loop-worker.js', import.meta.url),
    });
    const started = Date.now();
    try {
        const found = await pool.scan('<html>never</html>', 'https://example.com/', 'home');
        assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
        assert.deepEqual(found.emails, []);
        assert.deepEqual(found.phones, []);
    } finally {
        await pool.close();
    }
});
