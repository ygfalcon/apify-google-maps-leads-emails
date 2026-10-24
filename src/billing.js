// Which pay-per-event names a saved lead may emit. Prices live in .actor/pricing.json.

function hasSocial(socials) {
    return !!socials && typeof socials === 'object'
        && Object.values(socials).some((urls) => Array.isArray(urls) && urls.length > 0);
}

export function eventsToCharge({
    title,
    duplicate = false,
    abandoned = false,
    contactsStatus = 'skipped',
    pagesScanned = 0,
    emails = [],
    phones = [],
    socials = {},
} = {}) {
    if (duplicate || abandoned || !String(title || '').trim()) return [];
    const events = ['place-scraped'];
    const reached = contactsStatus === 'ok' && pagesScanned > 0;
    const kept = (emails?.length || 0) > 0 || (phones?.length || 0) > 0 || hasSocial(socials);
    // An empty extraction or a failed lookup is not a contacts event.
    if (reached && kept) events.push('contacts-enriched');
    return events;
}
