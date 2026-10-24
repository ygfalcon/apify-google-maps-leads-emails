import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlausibleEmail } from '../src/contacts.js';

test('rejects placeholder and asset-like emails', () => {
    for (const e of ['logo@2x.png', 'john.doe@gmail.com', 'info@yourdomain.com', 'abc@o123.ingest.sentry.io', '8f14e45fceea167a5a36dedd4bea2543@sentry.wixpress.com', 'x@site.webp', 'a@b..com']) {
        assert.equal(isPlausibleEmail(e), false, e);
    }
});
test('keeps real business emails', () => {
    for (const e of ['info@joespizza.com', 'sales@acme-plumbing.co.uk', 'hello@studio.nyc']) assert.equal(isPlausibleEmail(e), true, e);
});
