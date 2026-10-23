import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// new Function bodies are scripts, so the section's template literals stay intact.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// The actor's startup path from getInput through the contact-page clamp and the
// log that prints it. Executing this source (instead of matching it as text) fails
// when a const is read before its declaration.
function inputDefaultsSection(src) {
    const start = src.indexOf('const input = (await Actor.getInput())');
    const contactDecl = src.indexOf('const contactPages =', start);
    const logLine = src.indexOf('log.info(`extractContacts=', start);
    const proxyLine = src.indexOf('\nconst proxy =', start);
    assert.ok(start >= 0, 'missing Actor.getInput defaulting');
    assert.ok(contactDecl > start, 'missing contactPages declaration');
    assert.ok(logLine > start, 'missing startup log');
    assert.ok(proxyLine > start, 'missing proxy setup');
    const last = Math.max(contactDecl, logLine);
    const lineEnd = src.indexOf('\n', last);
    // The later of the two lines ends at the proxy line, or on a blank line just before it.
    assert.ok(lineEnd > last && lineEnd <= proxyLine, 'startup log and contactPages must run before proxy setup');
    return src.slice(start, lineEnd);
}

async function runInputDefaults(input) {
    const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const section = inputDefaultsSection(src);
    const logs = [];
    const body = `"use strict";\n${section}\nreturn { contactPages, maxTotal, reviewLimit, extractContacts, maxContactPages };`;
    const run = new AsyncFunction('Actor', 'log', body);
    const result = await run(
        { getInput: async () => input },
        { info(message) { logs.push(String(message)); } },
    );
    return { result, logs };
}

test('main.js input defaults do not throw when the actor starts', async () => {
    const { result, logs } = await runInputDefaults({});
    assert.equal(result.extractContacts, true);
    assert.equal(result.maxContactPages, 3);
    assert.equal(result.contactPages, 3);
    assert.equal(result.maxTotal, 20);
    assert.equal(result.reviewLimit, 0);
    assert.deepEqual(logs, ['extractContacts=true maxPlaces=20 maxContactPages=3']);

    const clamped = await runInputDefaults({
        extractContacts: false,
        maxContactPages: 99,
        maxPlacesPerSearch: 1000,
        maxReviews: 50,
    });
    assert.equal(clamped.result.extractContacts, false);
    assert.equal(clamped.result.contactPages, 6);
    assert.equal(clamped.result.maxTotal, 500);
    assert.equal(clamped.result.reviewLimit, 8);
    assert.deepEqual(clamped.logs, ['extractContacts=false maxPlaces=500 maxContactPages=6']);
});
