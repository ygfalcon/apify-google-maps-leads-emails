import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichWebsite, fetchHtml } from '../src/web/enrich.js';
import { closeScanPool } from '../src/web/scan-pool.js';
import { enrichWebsite as enrichContacts } from '../src/contacts.js';

test.after(async () => {
    await closeScanPool();
});

function htmlResponse(url, body, status = 200) {
    return { statusCode: status, headers: { 'content-type': 'text/html' }, body, url };
}

test('does not probe guessed paths once the homepage has an email and a social', async () => {
    const seen = [];
    const body = '<html><body><a href="mailto:office@acmeplumbing.com">e</a><a href="https://www.instagram.com/acmeplumbing">ig</a></body></html>';
    const result = await enrichWebsite('https://acmeplumbing.com/', {
        maxPages: 3,
        validateMx: false,
        timeoutMs: 200,
        fetchImpl: async (opts) => {
            seen.push(opts.url);
            return htmlResponse(opts.url, body);
        },
    });
    assert.deepEqual(seen, ['https://acmeplumbing.com/']);
    assert.ok(result.emails.includes('office@acmeplumbing.com'));
    assert.ok(result.socials.instagram.includes('https://www.instagram.com/acmeplumbing'));
});

test('still opens a real contact page and a guessed contact page when the email is not on the homepage', async () => {
    const seen = [];
    const pages = {
        'https://contact-only.com/': '<html><body><a href="/our-team">team</a><a href="https://www.youtube.com/@contactonly">y</a></body></html>',
        'https://contact-only.com/our-team': '<html><body><p>owner@contact-only.com</p></body></html>',
        'https://guessed.com/': '<html><body><a href="https://www.instagram.com/guessedco">ig</a></body></html>',
        'https://guessed.com/contact': '<html><body><p>office@guessed.com</p></body></html>',
    };
    const linked = await enrichWebsite('https://contact-only.com/', {
        maxPages: 3,
        validateMx: false,
        timeoutMs: 200,
        fetchImpl: async (opts) => {
            seen.push(opts.url);
            return htmlResponse(opts.url, pages[opts.url] || '<html>no</html>', pages[opts.url] ? 200 : 404);
        },
    });
    assert.ok(seen.includes('https://contact-only.com/our-team'));
    assert.ok(linked.emails.includes('owner@contact-only.com'));

    const guessedSeen = [];
    const guessed = await enrichWebsite('https://guessed.com/', {
        maxPages: 3,
        validateMx: false,
        timeoutMs: 200,
        fetchImpl: async (opts) => {
            guessedSeen.push(opts.url);
            return htmlResponse(opts.url, pages[opts.url] || '<html>no</html>', pages[opts.url] ? 200 : 404);
        },
    });
    assert.ok(guessedSeen.includes('https://guessed.com/contact'));
    assert.ok(guessed.emails.includes('office@guessed.com'));
});

test('fetchHtml hard timeout stays inside the caller budget for one attempt', async () => {
    const started = Date.now();
    const result = await fetchHtml('https://stuck.example/', {
        timeoutMs: 150,
        attempts: 1,
        fetchImpl: () => new Promise(() => {}),
    });
    assert.equal(result, null);
    assert.ok(Date.now() - started < 800, `took ${Date.now() - started}ms`);
});

test('contacts wrapper keeps socials when the site never loads', async () => {
    const result = await enrichContacts('https://www.facebook.com/acmeplumbing', {
        deadlineMs: 1000,
        engine: async () => ({
            error: 'website_unreachable',
            emails: [],
            phones: [],
            socials: { facebook: ['https://www.facebook.com/acmeplumbing'] },
            pagesScanned: 0,
            bytes: 12,
        }),
    });
    assert.equal(result.error, 'website_unreachable');
    assert.deepEqual(result.socials.facebook, ['https://www.facebook.com/acmeplumbing']);
    assert.equal(result.bytes, 12);
});
