const DAY_NAMES = {
    1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday', 7: 'sunday',
};
const PRICE_WORDS = { inexpensive: '$', moderate: '$$', expensive: '$$$', 'very expensive': '$$$$' };

const at = (node, ...path) => path.reduce((cur, idx) => (cur == null ? null : cur[idx]), node);

function cleanSpace(value) {
    return String(value).replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizePhone(raw) {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    if (trimmed.startsWith('+')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
}

export function cleanWebsite(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let href = raw.trim();
    if (!href) return null;
    try {
        if (href.startsWith('/url?') || href.includes('google.com/url')) {
            const abs = href.startsWith('/') ? `https://www.google.com${href}` : href;
            href = new URL(abs).searchParams.get('q') || href;
        }
        const url = new URL(href.startsWith('http') ? href : `https://${href}`);
        if (!/^https?:$/.test(url.protocol)) return null;
        for (const key of [...url.searchParams.keys()]) {
            if (key.startsWith('utm_') || key === 'gclid' || key === 'fbclid') url.searchParams.delete(key);
        }
        return url.href.replace(/\?$/, '');
    } catch {
        return null;
    }
}

function text(value) {
    if (typeof value !== 'string') return null;
    const trimmed = cleanSpace(value);
    return trimmed || null;
}

function priceFrom(value) {
    const s = text(value);
    if (!s) return null;
    if (/^\$+$/.test(s)) return s;
    if (PRICE_WORDS[s.toLowerCase()]) return PRICE_WORDS[s.toLowerCase()];
    if (/^\$\d/.test(s)) return s.replace(/[\u2013\u2014]/g, '-');
    return null;
}

function categoriesOf(d) {
    const raw = at(d, 13);
    if (!Array.isArray(raw)) return { categories: [], priceLevel: null };
    const categories = [];
    let priceLevel = null;
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const price = priceFrom(entry);
        if (price && /^\$+$/.test(price)) { priceLevel = priceLevel || price; continue; }
        const name = text(entry);
        if (name && !categories.includes(name)) categories.push(name);
    }
    return { categories, priceLevel };
}

function addressOf(d, title) {
    const parts = at(d, 183, 1);
    const pick = (idx) => (Array.isArray(parts) ? text(parts[idx]) : null);
    const street = pick(1) || pick(2);
    let address = text(at(d, 18));
    if (address && title) {
        const prefix = `${title},`;
        if (address.toLowerCase().startsWith(prefix.toLowerCase())) address = address.slice(prefix.length).trim();
    }
    return {
        address,
        neighborhood: pick(0),
        street,
        city: pick(3),
        postalCode: pick(4),
        state: pick(5),
        countryCode: pick(6),
    };
}

function openingHours(d) {
    let rows = at(d, 203, 0);
    if (!Array.isArray(rows) || !rows.length) rows = at(d, 34, 1);
    if (!Array.isArray(rows)) return null;
    const lines = [];
    for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const day = text(row[0]);
        if (!day) continue;
        let times = [];
        if (Array.isArray(row[3]) && row[3].some(Array.isArray)) {
            times = row[3].map((slot) => (Array.isArray(slot) ? text(slot[0]) : null)).filter(Boolean);
        } else if (Array.isArray(row[1])) {
            times = row[1].map(text).filter(Boolean);
        }
        const hours = times.length ? times.join(', ') : 'Closed';
        lines.push(`${day}: ${hours}`);
    }
    return lines.length ? lines : null;
}

export function classifyBusinessStatus(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 80) return null;
    // "Closed · Opens 9 AM Mon" and "Geschlossen · Öffnet …" are the open-now line, not a closure.
    const openNow = /[·•]/.test(text) || /\b(?:opens|öffnet|oeffnet|reopens|geöffnet|geoeffnet|open 24|24 stunden)\b/i.test(text);
    // "contemporary" contains "temporar", so the closure words stay specific.
    const closureWord = /permanen|temporarily|vorübergehend|voruebergehend|dauerhaft/i.test(text);
    if (openNow && !closureWord) return null;
    if (/permanently[\s_-]*closed|closed[\s_-]*permanently|^closed$|^geschlossen$|dauerhaft\s+geschlossen|endgültig\s+geschlossen|endgueltig\s+geschlossen/i.test(text)) {
        return 'permanently_closed';
    }
    if (/temporar(?:ily)?[\s_-]*closed|closed[\s_-]*temporar|vorübergehend|voruebergehend/i.test(text)) return 'temporarily_closed';
    return null;
}

function closedOf(d) {
    const candidates = [at(d, 88, 0), at(d, 34, 4, 4), at(d, 96, 10, 1, 0, 3, 2, 1)];
    let temporary = false;
    for (const raw of candidates) {
        const status = classifyBusinessStatus(raw);
        if (status === 'permanently_closed') {
            return { permanentlyClosed: true, temporarilyClosed: false, closedStatus: 'permanently_closed' };
        }
        if (status === 'temporarily_closed') temporary = true;
    }
    if (temporary) return { permanentlyClosed: false, temporarilyClosed: true, closedStatus: 'temporarily_closed' };
    return { permanentlyClosed: false, temporarilyClosed: false, closedStatus: null };
}

function imagesCount(d) {
    const direct = at(d, 37, 0, 1, 6, 1);
    const parsed = photoCount(direct);
    if (parsed != null) return parsed;
    const blob = JSON.stringify(at(d, 37));
    return photoCount(blob);
}

function photoCount(value) {
    if (typeof value === 'number' && value >= 0) return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/(\d[\d,]*)\s+photos?/i);
    if (!match) return null;
    const n = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function httpUrl(value) {
    const s = text(value);
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
}

function reservationUrl(d) {
    const rows = at(d, 46);
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
        const url = httpUrl(Array.isArray(row) ? row[0] : row);
        if (url) return url;
    }
    return null;
}

function popularTimes(node) {
    const empty = { popularTimesHistogram: null, popularTimesLiveText: null, popularTimesLivePercent: null };
    if (!Array.isArray(node)) return empty;
    const days = Array.isArray(node[0]) ? node[0] : [];
    const histogram = {};
    for (const row of days) {
        if (!Array.isArray(row)) continue;
        const name = DAY_NAMES[row[0]];
        if (!name || !Array.isArray(row[1])) continue;
        const slots = row[1].filter(Array.isArray).map((slot) => ({
            hour: slot[0],
            occupancyPercent: slot[1],
        })).filter((slot) => Number.isFinite(slot.hour) && Number.isFinite(slot.occupancyPercent));
        if (slots.length) histogram[name] = slots;
    }
    const liveText = text(node[6]);
    let livePercent = null;
    if (Array.isArray(node[7]) && Number.isFinite(node[7][1])) livePercent = node[7][1];
    else if (Number.isFinite(node[7])) livePercent = node[7];
    return {
        popularTimesHistogram: Object.keys(histogram).length ? histogram : null,
        popularTimesLiveText: liveText,
        popularTimesLivePercent: livePercent,
    };
}

function reviewsOf(d, maxReviews) {
    if (!maxReviews) return [];
    let list = at(d, 175, 9, 0, 0);
    if (!Array.isArray(list)) list = at(d, 175, 9, 0);
    if (!Array.isArray(list)) return [];
    const reviews = [];
    for (const raw of list) {
        const node = unwrapReview(raw);
        if (!node) continue;
        const author = text(at(node, 1, 4, 5, 0));
        const textBody = text(at(node, 2, 15, 0, 0)) || text(at(node, 2, 15, 0));
        const rating = at(node, 2, 0, 0);
        const relativeTime = text(at(node, 1, 6));
        const micros = at(node, 1, 2);
        const publishedAt = publishedFromMicros(micros);
        if (!author && !textBody) continue;
        reviews.push({
            author,
            rating: typeof rating === 'number' ? rating : null,
            text: textBody,
            relativeTime,
            publishedAt,
        });
        if (reviews.length >= maxReviews) break;
    }
    return reviews;
}

function unwrapReview(raw) {
    if (!Array.isArray(raw)) return null;
    if (Array.isArray(raw[0]) && (typeof raw[0][0] === 'string' || Array.isArray(raw[0][1]))) return raw[0];
    if (typeof raw[0] === 'string') return raw;
    return null;
}

function publishedFromMicros(micros) {
    if (typeof micros !== 'number' || micros < 1e15) return null;
    const date = new Date(micros / 1000);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getUTCFullYear() < 2007 || date.getTime() > Date.now() + 86400000) return null;
    return date.toISOString();
}

function distribution(d) {
    const raw = at(d, 175, 3);
    if (!Array.isArray(raw) || raw.length < 5) return null;
    const nums = raw.slice(0, 5).map((n) => (typeof n === 'number' ? n : null));
    if (nums.some((n) => n == null)) return null;
    return { oneStar: nums[0], twoStar: nums[1], threeStar: nums[2], fourStar: nums[3], fiveStar: nums[4] };
}

function cidFromFid(fid) {
    if (typeof fid !== 'string' || !fid.includes(':')) return null;
    const hex = fid.split(':')[1];
    try { return BigInt(hex).toString(); } catch { return null; }
}

function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parsePreviewPayload(body, { maxReviews = 0 } = {}) {
    const root = decodePayload(body);
    const d = Array.isArray(root) && Array.isArray(root[6]) ? root[6] : (Array.isArray(body) ? body : null);
    if (!d) return null;
    const title = text(at(d, 11));
    const { categories, priceLevel: priceFromCategory } = categoriesOf(d);
    const priceLevel = priceFrom(at(d, 4, 2)) || priceFromCategory;
    const address = addressOf(d, title);
    const lat = asNumber(at(d, 9, 2));
    const lng = asNumber(at(d, 9, 3));
    const fid = text(at(d, 10));
    const closed = closedOf(d);
    const times = popularTimes(at(d, 84));
    return {
        title,
        category: categories[0] || null,
        categories,
        ...address,
        phone: normalizePhone(at(d, 178, 0, 0)),
        website: cleanWebsite(at(d, 7, 0)),
        plusCode: text(at(d, 183, 2, 2, 0)),
        rating: asNumber(at(d, 4, 7)),
        reviewsCount: asNumber(at(d, 4, 8)),
        reviewsDistribution: distribution(d),
        priceLevel,
        openingHours: openingHours(d),
        ...closed,
        imagesCount: imagesCount(d),
        description: text(at(d, 32, 1, 1)),
        menuUrl: httpUrl(at(d, 38, 0)),
        reservationUrl: reservationUrl(d),
        ...times,
        reviews: reviewsOf(d, maxReviews),
        location: lat != null && lng != null ? { lat, lng } : null,
        placeId: text(at(d, 78)),
        fid,
        cid: cidFromFid(fid),
    };
}

function decodePayload(body) {
    if (Array.isArray(body)) return body;
    if (typeof body !== 'string') return null;
    const json = body.replace(/^\)\]\}'\s*/, '');
    try { return JSON.parse(json); } catch { return null; }
}

export function toDatasetItem(place, meta) {
    const placeId = place.placeId || null;
    return {
        title: place.title,
        category: place.category,
        categories: place.categories || [],
        address: place.address,
        street: place.street,
        neighborhood: place.neighborhood,
        city: place.city,
        state: place.state,
        postalCode: place.postalCode,
        countryCode: place.countryCode,
        phone: place.phone,
        website: place.website,
        rating: place.rating,
        reviewsCount: place.reviewsCount,
        reviewsDistribution: place.reviewsDistribution,
        priceLevel: place.priceLevel,
        closedStatus: place.closedStatus,
        permanentlyClosed: place.permanentlyClosed,
        temporarilyClosed: place.temporarilyClosed,
        plusCode: place.plusCode,
        location: place.location,
        placeId,
        fid: place.fid,
        cid: place.cid,
        googleMapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : (meta.sourceUrl || 'https://www.google.com/maps'),
        openingHours: place.openingHours,
        description: place.description,
        menuUrl: place.menuUrl,
        reservationUrl: place.reservationUrl,
        imagesCount: place.imagesCount,
        popularTimesHistogram: place.popularTimesHistogram,
        popularTimesLiveText: place.popularTimesLiveText,
        popularTimesLivePercent: place.popularTimesLivePercent,
        reviews: place.reviews || [],
        searchTerm: meta.searchTerm || null,
        rank: meta.rank ?? null,
        emails: meta.emails || [],
        thirdPartyEmails: meta.thirdPartyEmails || [],
        impressumOwner: meta.impressumOwner || null,
        vatId: meta.vatId || null,
        socials: meta.socials || {},
        websitePhones: meta.websitePhones || [],
        contactsStatus: meta.contactsStatus || 'skipped',
        scrapedAt: meta.scrapedAt,
    };
}
