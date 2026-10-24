import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverLinks, extractPage, guessPathsFor } from '../src/web/extract.js';
import { enrichWebsite } from '../src/web/enrich.js';
import { closeScanPool } from '../src/web/scan-pool.js';

test.after(async () => {
    await closeScanPool();
});

test('reads an email stored only in a script blob', () => {
    const html = '<script>window.__DATA__={"email":"office@script-proto.com","telephone":"(813) 872-0200"}</script>';
    const found = extractPage(html, 'https://script-proto.com/', 'home');
    assert.ok(found.emails.some((row) => row.email === 'office@script-proto.com'));
    assert.ok(found.phones.some((row) => String(row.phone).includes('8138720200')));
});

test('reads an email from a meta or aria-label attribute', () => {
    const html = '<meta name="email" content="office@meta-fbp.com"><a aria-label="Email office@aria.com" href="/contact">c</a>';
    const found = extractPage(html, 'https://meta-fbp.com/', 'home');
    assert.ok(found.emails.some((row) => row.email === 'office@meta-fbp.com'));
    assert.ok(found.emails.some((row) => row.email === 'office@aria.com'));
});

test('reads protocol-relative social profiles and Facebook /p/ and /people/ URLs', () => {
    const html = [
        '<a href="//www.instagram.com/scriptproto">ig</a>',
        '<a href="https://www.facebook.com/p/Meta-Plumbing-100076940813037/">fb</a>',
        '<a href="https://www.facebook.com/people/People-Plumbing/100076940813037">people</a>',
        '<a href="https://www.facebook.com/sharer/sharer.php?u=1">share</a>',
    ].join('');
    const found = extractPage(html, 'https://example.com/', 'home');
    assert.ok(found.socials.instagram.includes('https://www.instagram.com/scriptproto'));
    assert.ok(found.socials.facebook.some((url) => url.includes('/p/Meta-Plumbing-100076940813037')));
    assert.ok(found.socials.facebook.some((url) => url.includes('/people/People-Plumbing/100076940813037')));
    assert.equal(found.socials.facebook.some((url) => url.includes('sharer')), false);
});

test('reads sameAs profiles when the JSON escapes slashes', () => {
    const html = '<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https:\\/\\/www.instagram.com\\/escapedco","https:\\/\\/x.com\\/escapedco"]}</script>';
    const found = extractPage(html, 'https://escaped.com/', 'home');
    assert.ok(found.socials.instagram.includes('https://www.instagram.com/escapedco'));
    assert.ok(found.socials.twitter.includes('https://x.com/escapedco'));
});

test('still decodes [at] and [dot] obfuscation', () => {
    const found = extractPage('<p>office [at] obfuscated [dot] com</p>', 'https://obfuscated.com/', 'home');
    assert.ok(found.emails.some((row) => row.email === 'office@obfuscated.com'));
});

test('guesses one contact path per family and skips impressum on a plain .com site', () => {
    const links = discoverLinks('<a href="/contact-us">Contact</a>', 'https://acmeplumbing.com/');
    const paths = links.map((link) => new URL(link.url).pathname);
    assert.ok(paths.includes('/contact-us'));
    assert.equal(paths.includes('/contact'), false);
    assert.equal(paths.includes('/kontakt'), false);
    assert.equal(paths.includes('/impressum'), false);
    assert.ok(paths.includes('/about'));
    assert.ok(paths.includes('/team'));
    assert.equal(guessPathsFor('meister.de', '').some((row) => row[0] === '/impressum'), true);
});

test('a Facebook website is a social profile even when the fetch fails', async () => {
    const result = await enrichWebsite('https://www.facebook.com/fbwebsite', {
        maxPages: 1,
        validateMx: false,
        timeoutMs: 200,
        fetchImpl: async (opts) => ({ statusCode: 403, headers: { 'content-type': 'text/html' }, body: '', url: opts.url }),
    });
    assert.equal(result.error, 'website_unreachable');
    assert.ok(result.socials.facebook.some((url) => url.includes('facebook.com/fbwebsite')));
});
