import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
// Pure contact extraction: de-obfuscation, syntax checks, socials, phones, names, and ranking.
// Network I/O and MX lookups live in enrich.js.

export const SOCIAL_NETWORKS = [
    'facebook',
    'instagram',
    'linkedin',
    'twitter',
    'youtube',
    'tiktok',
    'pinterest',
    'discord',
    'snapchat',
    'threads',
    'telegram',
    'reddit',
    'whatsapp',
]

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g

const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    commat: '@',
    period: '.',
}

const BAD_TLDS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'mjs', 'map', 'woff', 'woff2',
    'ttf', 'eot', 'ico', 'bmp', 'tif', 'tiff', 'mp4', 'mp3', 'pdf', 'html', 'htm', 'php',
    'asp', 'aspx', 'local', 'invalid', 'test', 'example',
])

const BAD_DOMAINS = new Set([
    'example.com', 'example.org', 'example.net', 'example.edu', 'domain.com', 'email.com',
    'test.com', 'invalid', 'localhost', 'sentry.io', 'wixpress.com', 'schema.org',
    'yourdomain.com', 'mysite.com', 'emailaddress.com',
])

const BAD_DOMAIN_SUFFIXES = [
    'sentry.io', 'wixpress.com', 'schema.org', 'cloudflare.com', 'googleapis.com', 'gstatic.com',
    'w3.org', 'gravatar.com', 'wordpress.org', 'jquery.com', 'jsdelivr.net', 'sentry-next.wixpress.com',
    'noreply.github.com', 'godaddy.com',
]

const BAD_LOCAL = /^(john\.wick|user|name|your|yourname|your-name|test|email|example|foo|bar|sample|firstname\.lastname|first\.last|username|emailaddress|you|someone|abc|xxx|none|null|undefined|name\.surname)$/i

const ROLE_LOCAL = new Set([
    'info', 'hello', 'contact', 'sales', 'support', 'office', 'team', 'hi', 'enquiries', 'inquiries',
    'enquiry', 'inquiry', 'admin', 'help', 'service', 'billing', 'press', 'media', 'partners',
    'careers', 'jobs', 'mail', 'general', 'reception', 'accounts', 'hr', 'legal', 'privacy',
    'marketing', 'customerservice', 'customer', 'reservations', 'booking', 'bookings',
])

const LOW_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|unsubscribe|newsletter|daemon|postmaster|webmaster|root|hostmaster|donotreply)$/i

const FREE_MAIL = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com',
    'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com',
    'gmx.de', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'msn.com',
])

const SPACED_LOCAL_BLOCK = new Set([
    'us', 'me', 'the', 'our', 'your', 'all', 'team', 'mail', 'email', 'address', 'here', 'now',
    'we', 'you', 'him', 'her', 'them', 'it', 'and', 'or', 'for', 'to', 'from', 'this', 'that',
    'with', 'at', 'in', 'on', 'of', 'a', 'an', 'my', 'just', 'only', 'please', 'click', 'call',
    'write', 'reach', 'visit', 'contact', 'emailing',
])

const INBOX_ROLE = {
    sales: 'Sales',
    support: 'Support',
    help: 'Support',
    service: 'Customer service',
    customerservice: 'Customer service',
    customer: 'Customer service',
    info: 'General',
    hello: 'General',
    contact: 'General',
    hi: 'General',
    mail: 'General',
    general: 'General',
    office: 'Office',
    reception: 'Reception',
    team: 'Team',
    press: 'Press',
    media: 'Press',
    careers: 'Careers',
    jobs: 'Careers',
    billing: 'Billing',
    accounts: 'Billing',
    hr: 'Human resources',
    legal: 'Legal',
    privacy: 'Privacy',
    marketing: 'Marketing',
    partners: 'Partnerships',
    admin: 'Admin',
    enquiries: 'Enquiries',
    inquiries: 'Enquiries',
    enquiry: 'Enquiries',
    inquiry: 'Enquiries',
    reservations: 'Reservations',
    booking: 'Reservations',
    bookings: 'Reservations',
}

const MULTI_PART_SUFFIX = new Set([
    'co.uk', 'com.au', 'co.nz', 'com.br', 'co.jp', 'co.za', 'com.mx', 'co.in', 'com.tr', 'com.ar',
    'co.kr', 'com.sg', 'com.hk', 'com.tw', 'co.id', 'com.my', 'co.il', 'com.co', 'com.ng', 'com.ph',
    'com.vn', 'com.ua', 'com.pl', 'co.at', 'com.es', 'com.pt', 'co.th', 'com.pe', 'com.ec',
])

const NAME_RE = /^[\p{Lu}][\p{L}'’.-]{1,40}(?:\s+[\p{Lu}][\p{L}'’.-]{1,40}){1,3}$/u
const ROLE_RE = /\b(?:chief\s+[a-z]+\s+officer|c[eotmf]o|founder|co[- ]founder|owner|president|vice president|\bvp\b|director|head of [a-z][a-z &/-]{2,40}|manager|partner|consultant|engineer|developer|designer|account executive|customer success|product manager|office manager|general manager|managing director|coordinator|specialist|representative|attorney|counsel|professor|principal|recruiter|editor)\b/i
const NAME_STOP = /^(contact us|about us|read more|learn more|get in touch|email us|call us|our team|the team|privacy policy|click here|meet the team|our story|follow us)$/i

const SOCIAL_RULES = [
    {
        key: 'facebook',
        re: /https?:\/\/(?:(?:www|m|web)\.)?(?:facebook\.com|fb\.com)\/(?:pages\/[A-Za-z0-9.\-]+\/[0-9]+|profile\.php\?id=[0-9]+|(?!sharer(?:\.php)?|share(?:\.php)?|plugins|dialog|tr|login|recover|watch|photo\.php|privacy|policies|help|settings|story\.php|people|pg|events|notes)[A-Za-z0-9.]{2,})(?:\/[A-Za-z0-9.\-]+)?/gi,
    },
    {
        key: 'instagram',
        re: /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?!p\/|reel\/|reels\/|explore|share|accounts|stories|directory|about|legal|developer)[A-Za-z0-9_.]{1,30}/gi,
    },
    {
        key: 'linkedin',
        re: /https?:\/\/(?:[\w]{2,3}\.)?linkedin\.com\/(?:company|in|school|showcase|pub)\/[A-Za-z0-9_\-%.]+/gi,
    },
    {
        key: 'twitter',
        re: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share|home|search|hashtag|i\/|privacy|tos|login|signup|settings|explore|notifications)[A-Za-z0-9_]{1,15}/gi,
    },
    {
        key: 'youtube',
        re: /https?:\/\/(?:(?:www|m)\.)?youtube\.com\/(?:@[A-Za-z0-9_\-]+|(?:channel|c|user)\/[A-Za-z0-9_\-]+)/gi,
    },
    {
        key: 'tiktok',
        re: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/gi,
    },
    {
        key: 'pinterest',
        re: /https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/(?!pin\/|ideas\/|search\/)[A-Za-z0-9_]+/gi,
    },
    {
        key: 'discord',
        re: /https?:\/\/(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/gi,
    },
    {
        key: 'snapchat',
        re: /https?:\/\/(?:www\.)?snapchat\.com\/add\/[A-Za-z0-9._-]{2,}/gi,
    },
    {
        key: 'threads',
        re: /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+/gi,
    },
    {
        key: 'telegram',
        re: /https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.org)\/(?!share(?:\/|$)|s\/)[A-Za-z0-9_]{3,}/gi,
    },
    {
        key: 'reddit',
        re: /https?:\/\/(?:(?:www|old)\.)?reddit\.com\/(?:user|u|r)\/[A-Za-z0-9_-]+/gi,
    },
    {
        key: 'whatsapp',
        re: /https?:\/\/(?:wa\.me\/\d{6,15}|api\.whatsapp\.com\/send\?[^"'<\s]*phone=\d{6,15}|chat\.whatsapp\.com\/[A-Za-z0-9]+)/gi,
    },
]

const COMMON_PATHS = [
    ['/contact', 'contact', 95],
    ['/kontakt', 'contact', 68],
    ['/about', 'about', 52],
    ['/impressum', 'impressum', 50],
    ['/contact-us', 'contact', 46],
    ['/get-in-touch', 'contact', 44],
    ['/contacto', 'contact', 43],
    ['/about-us', 'about', 36],
    ['/imprint', 'impressum', 35],
    ['/team', 'team', 30],
]

export function emptySocials() {
    return Object.fromEntries(SOCIAL_NETWORKS.map((key) => [key, []]))
}

export function decodeHtmlEntities(input) {
    return String(input).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (full, body) => {
        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X'
            const cp = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
            if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return full
            try {
                return String.fromCodePoint(cp)
            } catch {
                return full
            }
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body.toLowerCase())
            ? NAMED_ENTITIES[body.toLowerCase()]
            : full
    })
}

export function decodeCfEmail(hex) {
    const clean = String(hex || '').trim().toLowerCase()
    if (!/^[0-9a-f]{4,}$/.test(clean) || clean.length % 2 !== 0) return null
    const key = Number.parseInt(clean.slice(0, 2), 16)
    let out = ''
    for (let i = 2; i < clean.length; i += 2) {
        out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16) ^ key)
    }
    return out.includes('@') ? out : null
}

export function deobfuscate(text) {
    let t = String(text).replace(ZERO_WIDTH, '')
    t = decodeHtmlEntities(t)
    t = t.replace(/%40/gi, '@')
    t = t.replace(/\s*[\[({]\s*(?:at|@)\s*[\])}]\s*/gi, '@')
    t = t.replace(/\s*[\[({]\s*(?:dot|period)\s*[\])}]\s*/gi, '.')
    t = t.replace(/([a-z0-9._%+-]{1,64})\s+at\s+([a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+)/gi, (full, local, rest) => {
        if (SPACED_LOCAL_BLOCK.has(local.toLowerCase())) return full
        return `${local}@${rest.replace(/\s+dot\s+/gi, '.')}`
    })
    t = t.replace(/([a-z0-9._%+-]{1,64})\s+at\s+((?:[a-z0-9-]+\.)+[a-z]{2,24})/gi, (full, local, domain) => {
        if (SPACED_LOCAL_BLOCK.has(local.toLowerCase()) || local.length < 2) return full
        return `${local}@${domain}`
    })
    t = t.replace(/([a-z0-9._%+-])\s*@\s*([a-z0-9.-])/gi, '$1@$2')
    return t
}

export function htmlToText(html) {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '\n')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6]|section|footer|header|article|td|th|address|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
}

export function isValidEmailSyntax(email) {
    if (typeof email !== 'string') return false
    const value = email.trim().toLowerCase()
    if (value.length < 6 || value.length > 254) return false
    if (value.includes('..') || value.includes('.@') || value.startsWith('.') || value.includes('@.') || value.endsWith('.')) return false
    const at = value.indexOf('@')
    if (at <= 0 || value.indexOf('@', at + 1) !== -1) return false
    const local = value.slice(0, at)
    const domain = value.slice(at + 1)
    if (local.length > 64 || domain.length > 253) return false
    if (!/^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?$/.test(local)) return false
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return false
    const labels = domain.split('.')
    if (labels.some((label) => label.length > 63)) return false
    const tld = labels[labels.length - 1]
    if (tld.length < 2 || !/^[a-z]+$/.test(tld) || BAD_TLDS.has(tld)) return false
    if (BAD_DOMAINS.has(domain)) return false
    if (BAD_DOMAIN_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) return false
    if (BAD_LOCAL.test(local)) return false
    if (/^[0-9a-f]{24,}$/.test(local)) return false
    if (/@\d+x\./.test(value)) return false
    if (/\d{5,}/.test(domain.split('.')[0]) && /^(?:19|20)\d{2}/.test(local)) return false
    return true
}

export function cleanEmail(raw) {
    if (!raw) return null
    let value = String(raw).trim().replace(ZERO_WIDTH, '')
    value = decodeHtmlEntities(value)
    value = value.replace(/^mailto:/i, '')
    const q = value.indexOf('?')
    if (q !== -1) value = value.slice(0, q)
    try {
        value = decodeURIComponent(value)
    } catch {
        value = value.replace(/%20/gi, '')
    }
    value = value.replace(ZERO_WIDTH, '').trim().toLowerCase()
    value = value.replace(/^[\s"'<>[(]+|[\s"'<>),.;:]+$/g, '')
    value = value.replace(/^%20+/i, '')
    return value
}

export function registrableDomain(host) {
    const normalized = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    const parts = normalized.split('.').filter(Boolean)
    if (parts.length <= 2) return normalized
    const lastTwo = parts.slice(-2).join('.')
    if (MULTI_PART_SUFFIX.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.')
    return lastTwo
}

export function sameSite(emailDomain, siteHost) {
    if (!emailDomain || !siteHost) return false
    return registrableDomain(emailDomain) === registrableDomain(siteHost)
}

function addEmail(store, raw, source) {
    const email = cleanEmail(raw)
    if (!email || !isValidEmailSyntax(email)) return
    let row = store.get(email)
    if (!row) {
        row = { email, sources: new Set(), name: null, role: null, roleSource: null, phone: null }
        store.set(email, row)
    }
    row.sources.add(source)
}

function scriptConcatEmails(html) {
    const found = []
    const patterns = [
        /(['"])([a-z0-9._%+-]{1,64})\1\s*\+\s*(['"])@\3\s*\+\s*(['"])([a-z0-9.-]+\.[a-z]{2,24})\4/gi,
        /(['"])([a-z0-9._%+-]{1,64})\1\s*\+\s*(['"])(@[a-z0-9.-]+\.[a-z]{2,24})\3/gi,
    ]
    for (const re of patterns) {
        for (const match of html.matchAll(re)) {
            found.push(match[5] ? `${match[2]}@${match[5]}` : `${match[2]}${match[4]}`)
        }
    }
    return found
}

function asArray(value) {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

function flatString(value) {
    if (!value) return null
    if (typeof value === 'string') return value.trim() || null
    if (typeof value === 'object') {
        if (typeof value.email === 'string') return value.email.trim() || null
        if (typeof value.name === 'string') return value.name.trim() || null
        if (typeof value['@value'] === 'string') return value['@value'].trim() || null
    }
    return null
}

function walkJsonLd(node, people, depth) {
    if (!node || depth > 8) return
    if (Array.isArray(node)) {
        for (const item of node) walkJsonLd(item, people, depth + 1)
        return
    }
    if (typeof node !== 'object') return
    const type = asArray(node['@type']).map((item) => String(item).toLowerCase()).join(' ')
    const emails = asArray(node.email).map(flatString).filter(Boolean)
    const phones = asArray(node.telephone).map(flatString).filter(Boolean)
    if (type.includes('person') || node.jobTitle || (emails.length && (node.name || node.jobTitle))) {
        const name = looksLikeName(flatString(node.name)) ? flatString(node.name) : null
        const role = cleanRole(flatString(node.jobTitle))
        for (const email of emails) {
            people.push({
                name,
                role,
                roleSource: role ? 'jobTitle' : null,
                email: cleanEmail(email),
                phone: phones[0] ? normalizePhone(phones[0]) : null,
                sources: ['jsonld'],
            })
        }
        if (!emails.length && (name || phones.length)) {
            people.push({
                name,
                role,
                roleSource: role ? 'jobTitle' : null,
                email: null,
                phone: phones[0] ? normalizePhone(phones[0]) : null,
                sources: ['jsonld'],
            })
        }
    }
    for (const point of asArray(node.contactPoint)) {
        if (!point || typeof point !== 'object') continue
        const pointEmails = asArray(point.email).map(flatString).filter(Boolean)
        const pointPhones = asArray(point.telephone).map(flatString).filter(Boolean)
        const role = cleanRole(flatString(point.contactType) || flatString(point.name))
        for (const email of pointEmails) {
            people.push({
                name: looksLikeName(flatString(point.name)) ? flatString(point.name) : null,
                role,
                roleSource: role ? 'contactType' : null,
                email: cleanEmail(email),
                phone: pointPhones[0] ? normalizePhone(pointPhones[0]) : null,
                sources: ['jsonld'],
            })
        }
        if (!pointEmails.length && pointPhones.length) {
            people.push({
                name: looksLikeName(flatString(point.name)) ? flatString(point.name) : null,
                role,
                roleSource: role ? 'contactType' : null,
                email: null,
                phone: normalizePhone(pointPhones[0]),
                sources: ['jsonld'],
            })
        }
    }
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') walkJsonLd(value, people, depth + 1)
    }
}

function extractJsonLd(html) {
    const people = []
    const emails = []
    for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const raw = match[1].trim().replace(/<!--|-->/g, '')
        try {
            const data = JSON.parse(raw)
            const found = []
            walkJsonLd(data, found, 0)
            for (const person of found) {
                people.push(person)
                if (person.email) emails.push(person.email)
            }
            collectSchemaEmails(data, emails)
        } catch {
            // Ignore broken JSON-LD blocks. Visible text is still scanned.
        }
    }
    return { people, emails }
}

function collectSchemaEmails(node, emails, depth = 0) {
    if (!node || depth > 8) return
    if (typeof node === 'string') {
        const cleaned = cleanEmail(node)
        if (cleaned && cleaned.includes('@')) emails.push(cleaned)
        return
    }
    if (Array.isArray(node)) {
        for (const item of node) collectSchemaEmails(item, emails, depth + 1)
        return
    }
    if (typeof node !== 'object') return
    if (node.email) collectSchemaEmails(node.email, emails, depth + 1)
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') collectSchemaEmails(value, emails, depth + 1)
    }
}

export function looksLikeName(value) {
    if (!value) return false
    const text = String(value).replace(/\s+/g, ' ').trim()
    if (text.length < 3 || text.length > 80) return false
    if (NAME_STOP.test(text) || text.includes('@') || /\d/.test(text)) return false
    if (/\b(?:inc|llc|ltd|gmbh|corp|corporation|company|group|plc|ag|bv|sa|sas|oy|ab)\b\.?$/i.test(text)) return false
    return NAME_RE.test(text)
}

export function cleanRole(value) {
    if (!value) return null
    const text = String(value).replace(/\s+/g, ' ').replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()
    if (text.length < 2 || text.length > 80) return null
    if (text.includes('@') || /^https?:/i.test(text)) return null
    return text
}

function itempropValues(html, prop) {
    const out = []
    const re = new RegExp(`<([a-z0-9]+)([^>]*\\bitemprop=["']${prop}["'][^>]*)>([\\s\\S]*?)<\\/\\1>|<[^>]*\\bitemprop=["']${prop}["'][^>]*>`, 'gi')
    for (const match of html.matchAll(re)) {
        const attrs = match[2] || match[0]
        const content = /content=["']([^"']+)["']/i.exec(attrs)
        if (content) out.push(decodeHtmlEntities(content[1]).replace(/\s+/g, ' ').trim())
        else if (match[3]) out.push(htmlToText(match[3]).replace(/\s+/g, ' ').trim())
    }
    return out.filter(Boolean)
}

function classText(chunk, classPattern) {
    const re = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i')
    const match = chunk.match(re)
    return match ? htmlToText(match[2]).replace(/\s+/g, ' ').trim() : null
}

function peopleFromChunk(chunk, pageKind) {
    const people = []
    const emails = []
    for (const match of chunk.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.push(cleanEmail(match[1]))
    for (const value of itempropValues(chunk, 'email')) emails.push(cleanEmail(value))
    const uniqueEmails = [...new Set(emails.filter((email) => email && isValidEmailSyntax(email)))]
    if (!uniqueEmails.length && !/itemprop=["'](?:name|jobTitle|telephone)["']/i.test(chunk)) return people

    const plain = htmlToText(chunk)
    if (plain.length > 900 && uniqueEmails.length !== 1) return people
    const nameCandidates = [
        ...itempropValues(chunk, 'name'),
        classText(chunk, 'person-name|member-name|team-name|full-name|fullname|author-name|staff-name'),
    ]
    for (const heading of chunk.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
        nameCandidates.push(htmlToText(heading[1]).replace(/\s+/g, ' ').trim())
    }
    for (const match of chunk.matchAll(/<a\b[^>]*href=["']mailto:[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        nameCandidates.push(htmlToText(match[1]).replace(/\s+/g, ' ').trim())
    }
    const name = nameCandidates.map((item) => item && item.replace(/\s+/g, ' ').trim()).find((item) => looksLikeName(item)) || null

    const roleCandidates = [
        ...itempropValues(chunk, 'jobTitle'),
        ...itempropValues(chunk, 'contactType'),
        classText(chunk, 'job-title|jobtitle|position|designation|member-role|person-role|staff-role|\\brole\\b'),
    ]
    let role = null
    let roleSource = null
    for (const candidate of roleCandidates) {
        const cleaned = cleanRole(candidate)
        if (!cleaned || looksLikeName(cleaned)) continue
        role = cleaned
        roleSource = /contactType/i.test(chunk) && itempropValues(chunk, 'contactType').includes(candidate) ? 'contactType' : 'page'
        if (itempropValues(chunk, 'jobTitle').some((item) => cleanRole(item) === cleaned)) roleSource = 'jobTitle'
        break
    }
    if (!role) {
        const text = htmlToText(chunk)
        const lines = text.split('\n').map((line) => line.trim()).filter((line) => line && line.length < 80)
        for (const line of lines) {
            if (ROLE_RE.test(line) && !line.includes('@')) {
                role = cleanRole(line)
                roleSource = 'page'
                break
            }
        }
    }
    const phone = itempropValues(chunk, 'telephone').map(normalizePhone).find(Boolean)
        || [...chunk.matchAll(/href=["']tel:([^"']+)["']/gi)].map((match) => normalizePhone(decodeURIComponentSafe(match[1]))).find(Boolean)
        || null
    const sources = ['page', pageKind]
    if (!uniqueEmails.length && name && phone) {
        people.push({ name, role, roleSource, email: null, phone, sources })
        return people
    }
    for (const email of uniqueEmails) {
        people.push({ name, role, roleSource, email, phone, sources })
    }
    return people
}

function contextPeople(text, pageKind) {
    const people = []
    const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim())
    for (let i = 0; i < lines.length; i++) {
        const emails = lines[i].match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi) || []
        if (!emails.length) continue
        const window = [lines[i - 2], lines[i - 1], lines[i], lines[i + 1]].filter(Boolean)
        let name = null
        let role = null
        for (const line of window) {
            const withoutEmail = line.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi, ' ').replace(/\s+/g, ' ').trim()
            const combo = withoutEmail.match(/^([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,3})\s*[,|–—:-]\s*(.{2,60})$/u)
            if (combo && looksLikeName(combo[1])) {
                name = combo[1]
                role = cleanRole(combo[2])
                break
            }
        }
        if (!name) {
            for (const line of window) {
                if (looksLikeName(line)) {
                    name = line
                    break
                }
            }
        }
        if (!role) {
            for (const line of window) {
                if (ROLE_RE.test(line) && !line.includes('@') && line.length < 80) {
                    role = cleanRole(line)
                    break
                }
            }
        }
        if (!name && !role) continue
        for (const email of emails) {
            people.push({
                name,
                role,
                roleSource: role ? 'page' : null,
                email: cleanEmail(email),
                phone: null,
                sources: ['text', pageKind],
            })
        }
    }
    return people
}

export function normalizePhone(raw) {
    if (!raw) return null
    let value = String(raw).trim()
    value = value.replace(/^tel:/i, '')
    value = decodeURIComponentSafe(value)
    value = value.split(/[;,]/)[0].trim()
    if (looksLikeDate(value)) return null
    const digitsOnly = value.replace(/\D/g, '')
    if (digitsOnly.length < 7 || digitsOnly.length > 15) return null
    if (/^(\d)\1+$/.test(digitsOnly)) return null
    let normalized = value.replace(/[^\d+]/g, '')
    const only = normalized.replace(/\+/g, '')
    if (only.length < 7 || only.length > 15) return null
    if (normalized.startsWith('00') && only.length >= 10) normalized = `+${only.slice(2)}`
    else if (normalized.startsWith('+')) normalized = `+${only}`
    else normalized = only
    return normalized
}

function looksLikeDate(raw) {
    const text = raw.trim()
    if (/^(19|20)\d{2}[\s./-](19|20)\d{2}$/.test(text)) return true
    if (/^(19|20)\d{2}[\s./-]\d{1,2}[\s./-]\d{1,2}$/.test(text)) return true
    if (/^\d{1,2}[\s./-]\d{1,2}[\s./-](19|20)\d{2}$/.test(text)) return true
    if (/^\d+\.\d+\.\d+$/.test(text)) return true
    return false
}

function plausibleTextPhone(raw) {
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) return false
    if (looksLikeDate(raw)) return false
    const trimmed = raw.trim()
    const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00')
    const separators = (trimmed.match(/[\s()./-]/g) || []).length
    if (!hasPlus && separators < 2) return false
    if (/^(\d)\1+$/.test(digits)) return false
    return true
}

function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function extractTextPhones(text) {
    const phones = []
    const withoutUrls = text.replace(/https?:\/\/\S+/g, ' ')
    const re = /(?:\+\d{1,3}[\s().-]?)?(?:\(?\d{2,4}\)?[\s().-]?){2,4}\d{2,4}/g
    for (const match of withoutUrls.matchAll(re)) {
        const raw = match[0].trim()
        if (!plausibleTextPhone(raw)) continue
        const phone = normalizePhone(raw)
        if (phone) phones.push(phone)
    }
    return phones
}

function canonicalizeSocial(key, url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    parsed.hash = ''
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase()
    if (key !== 'whatsapp') {
        const tracking = [...parsed.searchParams.keys()].filter((name) => /^(utm_|fbclid|gclid|ref|source|mc_|igshid|si)$/i.test(name) || name.toLowerCase().startsWith('utm_'))
        for (const name of tracking) parsed.searchParams.delete(name)
    }
    if (key === 'facebook') {
        parsed.hostname = 'www.facebook.com'
        if (parsed.pathname === '/profile.php') {
            const id = parsed.searchParams.get('id')
            if (!id) return null
            return `https://www.facebook.com/profile.php?id=${id}`
        }
        parsed.search = ''
    }
    if (key === 'instagram') {
        parsed.hostname = 'www.instagram.com'
        parsed.search = ''
        const handle = parsed.pathname.split('/').filter(Boolean)[0]
        if (!handle) return null
        return `https://www.instagram.com/${handle.toLowerCase()}`
    }
    if (key === 'twitter') {
        parsed.hostname = 'x.com'
        parsed.search = ''
        const handle = parsed.pathname.split('/').filter(Boolean)[0]
        if (!handle || /^(intent|share|home|search|hashtag)$/i.test(handle)) return null
        return `https://x.com/${handle}`
    }
    if (key === 'tiktok') {
        parsed.hostname = 'www.tiktok.com'
        parsed.search = ''
        const handle = parsed.pathname.split('/').filter(Boolean)[0]
        if (!handle || !handle.startsWith('@')) return null
        return `https://www.tiktok.com/${handle}`
    }
    if (key === 'youtube') {
        parsed.hostname = 'www.youtube.com'
        parsed.search = ''
    }
    if (key === 'linkedin') {
        parsed.hostname = 'www.linkedin.com'
        parsed.search = ''
        parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    }
    if (key === 'threads') {
        parsed.hostname = 'www.threads.net'
        parsed.search = ''
        const handle = parsed.pathname.split('/').filter(Boolean)[0]
        if (!handle) return null
        return `https://www.threads.net/${handle}`
    }
    if (key === 'telegram') {
        parsed.hostname = 't.me'
        parsed.search = ''
        let path = parsed.pathname.replace(/^\/s\//, '/')
        const handle = path.split('/').filter(Boolean)[0]
        if (!handle || /^(share|joinchat)$/i.test(handle) && path.split('/').filter(Boolean).length < 2) {
            if (!handle || handle.toLowerCase() === 'share') return null
        }
        return `https://t.me/${path.split('/').filter(Boolean).join('/')}`
    }
    if (key === 'discord') {
        const code = parsed.pathname.split('/').filter(Boolean).pop()
        if (!code) return null
        return `https://discord.gg/${code}`
    }
    if (key === 'snapchat') {
        const handle = parsed.pathname.split('/').filter(Boolean)[1] || parsed.pathname.split('/').filter(Boolean).pop()
        if (!handle) return null
        return `https://www.snapchat.com/add/${handle}`
    }
    if (key === 'reddit') {
        parsed.hostname = 'www.reddit.com'
        parsed.search = ''
        const parts = parsed.pathname.split('/').filter(Boolean)
        if (parts.length < 2) return null
        const kind = parts[0].toLowerCase() === 'u' ? 'user' : parts[0].toLowerCase()
        return `https://www.reddit.com/${kind}/${parts[1]}`
    }
    if (key === 'pinterest') {
        parsed.search = ''
        parsed.hostname = parsed.hostname.toLowerCase()
        const handle = parsed.pathname.split('/').filter(Boolean)[0]
        if (!handle) return null
        return `https://${parsed.hostname}/${handle}`
    }
    if (key === 'whatsapp') {
        const phone = parsed.hostname === 'wa.me'
            ? parsed.pathname.replace(/\D/g, '')
            : (parsed.searchParams.get('phone') || '').replace(/\D/g, '')
        if (phone) return `https://wa.me/${phone}`
        if (parsed.hostname === 'chat.whatsapp.com') {
            const id = parsed.pathname.split('/').filter(Boolean)[0]
            return id ? `https://chat.whatsapp.com/${id}` : null
        }
        return null
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    if ([...parsed.searchParams.keys()].length === 0) parsed.search = ''
    return parsed.toString()
}

export function extractSocials(html) {
    const socials = emptySocials()
    const seen = Object.fromEntries(SOCIAL_NETWORKS.map((key) => [key, new Set()]))
    for (const rule of SOCIAL_RULES) {
        for (const match of html.matchAll(rule.re)) {
            const canonical = canonicalizeSocial(rule.key, match[0])
            if (!canonical || seen[rule.key].has(canonical)) continue
            seen[rule.key].add(canonical)
            if (socials[rule.key].length < 5) socials[rule.key].push(canonical)
        }
    }
    return socials
}

function scorePath(pathname) {
    const path = pathname.toLowerCase()
    if (/contact|kontakt|contacto|contato|get-in-touch|reach-us|nous-contacter/.test(path)) return { score: 100, family: 'contact' }
    if (/impressum|imprint|legal-notice|mentions-legales/.test(path)) return { score: 90, family: 'impressum' }
    if (/about|ueber-uns|uber-uns|qui-sommes|sobre/.test(path)) return { score: 74, family: 'about' }
    if (/team|staff|people|leadership/.test(path)) return { score: 64, family: 'team' }
    if (/support|help|customer/.test(path)) return { score: 58, family: 'support' }
    return { score: 0, family: 'other' }
}

export function pageKindFromUrl(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return 'other'
    }
    if (/linktr\.ee|linktree\.com/i.test(parsed.hostname)) return 'linktree'
    const { family } = scorePath(parsed.pathname)
    if (family === 'contact' || family === 'impressum' || family === 'about' || family === 'team') return family
    return 'other'
}

const SOCIAL_HOST = /(?:^|\.)(?:facebook\.com|fb\.com|instagram\.com|instagr\.am|linkedin\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+|discord\.gg|discord\.com|discordapp\.com|snapchat\.com|threads\.net|threads\.com|t\.me|telegram\.me|telegram\.org|reddit\.com|wa\.me|whatsapp\.com)$/i

export function discoverLinks(html, baseUrl, { followExternal = false } = {}) {
    let base
    try {
        base = new URL(baseUrl)
    } catch {
        return []
    }
    const site = registrableDomain(base.hostname)
    const baseIsLinktree = /linktr\.ee|linktree\.com/.test(base.hostname)
    const footerHrefs = new Set()
    for (const footer of html.matchAll(/<footer\b[\s\S]*?<\/footer>/gi)) {
        for (const href of footer[0].matchAll(/href=["']([^"'#]+)["']/gi)) footerHrefs.add(href[1])
    }
    const links = []
    const seen = new Set()
    for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
        let url
        try {
            url = new URL(match[1], base)
        } catch {
            continue
        }
        if (!/^https?:$/.test(url.protocol)) continue
        if (/\.(?:png|jpe?g|gif|svg|webp|pdf|zip|css|js|mp4|mp3|ico)(?:$|\?)/i.test(url.pathname)) continue
        const host = url.hostname.toLowerCase()
        const linktree = /linktr\.ee|linktree\.com/.test(host)
        const same = registrableDomain(host) === site
        const external = followExternal && !same && !linktree && !SOCIAL_HOST.test(host)
        if (!same && !linktree && !external) continue
        url.hash = ''
        const key = `${url.origin}${url.pathname}`.replace(/\/+$/, '/')
        if (seen.has(key) || key === `${base.origin}${base.pathname}`.replace(/\/+$/, '/')) continue
        const scored = linktree
            ? { score: 80, family: 'linktree' }
            : external
                ? { score: 55, family: 'external' }
                : scorePath(url.pathname)
        if (!linktree && !external && scored.score <= 0 && !footerHrefs.has(match[1])) continue
        if (footerHrefs.has(match[1])) scored.score += 8
        seen.add(key)
        links.push({ url: url.href, score: scored.score, family: scored.family })
    }
    if (!baseIsLinktree) {
        for (const [pathname, family, score] of COMMON_PATHS) {
            const url = new URL(pathname, base.origin).href
            const key = url.replace(/\/+$/, '/')
            if (seen.has(key)) continue
            seen.add(key)
            links.push({ url, score, family })
        }
    }
    links.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    return links
}

function dedupePhones(entries) {
    const ranked = []
    for (const entry of entries) {
        const digits = entry.phone.replace(/\D/g, '')
        const key = digits.length >= 10 ? digits.slice(-10) : digits
        const existing = ranked.find((item) => item.key === key)
        if (!existing) {
            ranked.push({ key, ...entry })
            continue
        }
        const better = entry.phone.startsWith('+') && !existing.phone.startsWith('+')
            || (entry.source === 'tel' && existing.source === 'text')
            || (entry.source === 'jsonld' && existing.source === 'text')
        if (better) {
            existing.phone = entry.phone
            existing.source = entry.source
        }
    }
    const sourceRank = { jsonld: 0, tel: 1, whatsapp: 2, text: 3 }
    ranked.sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9) || b.phone.length - a.phone.length)
    return ranked.slice(0, 8).map(({ phone, source }) => ({ phone, source }))
}

export function extractPage(html, baseUrl, pageKind = 'home') {
    const raw = String(html || '')
    const emails = new Map()
    const people = []
    const phoneEntries = []

    const jsonLd = extractJsonLd(raw)
    for (const email of jsonLd.emails) addEmail(emails, email, 'jsonld')
    for (const person of jsonLd.people) {
        if (person.email) addEmail(emails, person.email, 'jsonld')
        people.push(person)
        if (person.phone) phoneEntries.push({ phone: person.phone, source: 'jsonld' })
    }

    for (const match of raw.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
        const decoded = decodeCfEmail(match[1])
        if (decoded) addEmail(emails, decoded, 'cloudflare')
    }
    for (const match of raw.matchAll(/email-protection#([0-9a-f]+)/gi)) {
        const decoded = decodeCfEmail(match[1])
        if (decoded) addEmail(emails, decoded, 'cloudflare')
    }
    for (const email of scriptConcatEmails(raw)) addEmail(emails, email, 'script')

    for (const match of raw.matchAll(/mailto:([^"'?\s>]+)/gi)) addEmail(emails, match[1], 'mailto')
    for (const match of raw.matchAll(/\bdata-(?:e-?mail|email)=["']([^"']+)["']/gi)) addEmail(emails, deobfuscate(match[1]), 'attribute')

    const footerHtml = (raw.match(/<footer\b[\s\S]*?<\/footer>/gi) || []).join('\n')
    const footerText = deobfuscate(htmlToText(footerHtml))
    const text = deobfuscate(htmlToText(raw))
    const emailRe = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi
    const footerEmails = new Set((footerText.match(emailRe) || []).map((item) => cleanEmail(item)).filter(Boolean))
    for (const match of text.match(emailRe) || []) {
        const source = footerEmails.has(cleanEmail(match)) ? 'footer' : 'text'
        addEmail(emails, match, source)
    }
    for (const email of emails.keys()) emails.get(email).sources.add(pageKind)

    for (const match of raw.matchAll(/href=["']tel:([^"']+)["']/gi)) {
        const phone = normalizePhone(decodeURIComponentSafe(match[1]))
        if (phone) phoneEntries.push({ phone, source: 'tel' })
    }
    for (const value of itempropValues(raw, 'telephone')) {
        const phone = normalizePhone(value)
        if (phone) phoneEntries.push({ phone, source: 'jsonld' })
    }
    for (const phone of extractTextPhones(text)) phoneEntries.push({ phone, source: 'text' })

    const socials = extractSocials(raw)
    for (const url of socials.whatsapp) {
        const digits = url.replace(/\D/g, '')
        const phone = normalizePhone(`+${digits}`)
        if (phone && url.includes('wa.me')) phoneEntries.push({ phone, source: 'whatsapp' })
    }

    const chunks = raw.split(/<(?:div|li|article|section|tr|address|footer)\b/i).filter((chunk) => chunk.length < 5000)
    for (const chunk of chunks) people.push(...peopleFromChunk(chunk, pageKind))
    people.push(...contextPeople(text, pageKind))

    return {
        emails: [...emails.values()].map((row) => ({ ...row, sources: [...row.sources] })),
        phones: dedupePhones(phoneEntries),
        socials,
        people,
        links: discoverLinks(raw, baseUrl, {
            followExternal: pageKind === 'linktree' || /linktr\.ee|linktree\.com/i.test(hostFromUrl(baseUrl)),
        }),
    }
}

const ROLE_SOURCE_RANK = { jobTitle: 4, page: 3, contactType: 2, inbox: 1 }

function preferPerson(current, incoming) {
    const next = { ...current }
    const incomingName = incoming.name && looksLikeName(incoming.name) ? incoming.name.replace(/\s+/g, ' ').trim() : null
    if (incomingName && !next.name) next.name = incomingName
    const incomingRole = cleanRole(incoming.role)
    const incomingRank = ROLE_SOURCE_RANK[incoming.roleSource] || 0
    const currentRank = ROLE_SOURCE_RANK[next.roleSource] || 0
    if (incomingRole && incomingRank >= currentRank) {
        next.role = incomingRole
        next.roleSource = incoming.roleSource || 'page'
    }
    if (incoming.phone && !next.phone) next.phone = incoming.phone
    return next
}

export function scoreEmail(row, siteHost) {
    const [local, domain] = row.email.split('@')
    const sources = new Set(row.sources || [])
    let score = 0
    const reasons = []
    if (sameSite(domain, siteHost)) {
        score += 60
        reasons.push('same-domain')
    } else if (FREE_MAIL.has(domain)) {
        score += 5
        reasons.push('free-mail')
    } else {
        score += 18
    }
    if (ROLE_LOCAL.has(local)) {
        score += 25
        reasons.push('role-inbox')
    }
    if (LOW_LOCAL.test(local)) {
        score -= 80
        reasons.push('low-value-inbox')
    }
    if (sources.has('jsonld')) {
        score += 14
        reasons.push('schema')
    }
    if (sources.has('mailto')) {
        score += 8
        reasons.push('mailto')
    }
    if (sources.has('contact')) {
        score += 18
        reasons.push('contact-page')
    }
    if (sources.has('impressum')) {
        score += 16
        reasons.push('impressum')
    }
    if (sources.has('footer')) {
        score += 10
        reasons.push('footer')
    }
    if (sources.has('about') || sources.has('team')) {
        score += 6
        reasons.push(sources.has('team') ? 'team-page' : 'about-page')
    }
    if (sources.has('cloudflare') || sources.has('script') || sources.has('attribute')) {
        score += 4
        reasons.push('deobfuscated')
    }
    if (row.name) {
        score += 36
        reasons.push('named-contact')
    }
    if (row.role && row.roleSource && row.roleSource !== 'inbox') {
        score += 15
        reasons.push('role')
    }
    if (row.mxValid === true) {
        score += 20
        reasons.push('mx-valid')
    } else if (row.mxValid === false) {
        score -= 90
        reasons.push('mx-missing')
    }
    return { score, reasons }
}

const CC_TLD = { uk: 'GB', de: 'DE', at: 'AT', ch: 'CH', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', be: 'BE', ie: 'IE', au: 'AU', nz: 'NZ', ca: 'CA', in: 'IN', br: 'BR', mx: 'MX', jp: 'JP', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI', pl: 'PL', pt: 'PT', za: 'ZA', sg: 'SG', hk: 'HK' }

// Keep only numbers that are real, dialable phone numbers. Returns E.164 or null.
export function validatePhone(raw, siteHost = '') {
    if (!raw) return null
    const value = String(raw)
    const tld = String(siteHost).split('.').pop()
    const regions = [...new Set([CC_TLD[tld], 'US'].filter(Boolean))]
    const attempts = value.startsWith('+') ? [[value]] : regions.map((region) => [value, region])
    for (const args of attempts) {
        try {
            const parsed = parsePhoneNumberFromString(...args)
            if (parsed?.isValid()) return parsed.number
        } catch { /* ignore */ }
    }
    return null
}

export function finalizeContacts({ emailRows, people: rawPeople, phoneEntries: rawPhoneEntries, siteHost }) {
    const phoneEntries = rawPhoneEntries
        .map((entry) => ({ ...entry, phone: validatePhone(entry.phone, siteHost) }))
        .filter((entry) => entry.phone)
    const people = rawPeople.map((person) => ({ ...person, phone: validatePhone(person.phone, siteHost) }))
    emailRows = emailRows.map((row) => ({ ...row, phone: row.phone ? validatePhone(row.phone, siteHost) : row.phone }))
    const emails = new Map()
    for (const row of emailRows) {
        const email = cleanEmail(row.email)
        if (!email || !isValidEmailSyntax(email)) continue
        const existing = emails.get(email) || {
            email,
            sources: new Set(),
            name: null,
            role: null,
            roleSource: null,
            phone: null,
            mxValid: row.mxValid ?? null,
        }
        for (const source of row.sources || []) existing.sources.add(source)
        if (row.mxValid != null) existing.mxValid = row.mxValid
        emails.set(email, preferPerson(existing, row))
    }
    for (const person of people) {
        const email = person.email ? cleanEmail(person.email) : null
        if (email && isValidEmailSyntax(email)) {
            const existing = emails.get(email) || {
                email,
                sources: new Set(person.sources || []),
                name: null,
                role: null,
                roleSource: null,
                phone: null,
                mxValid: null,
            }
            for (const source of person.sources || []) existing.sources.add(source)
            emails.set(email, preferPerson(existing, person))
        }
    }
    for (const row of emails.values()) {
        if (!row.role) {
            const inbox = INBOX_ROLE[row.email.split('@')[0]]
            if (inbox) {
                row.role = inbox
                row.roleSource = 'inbox'
            }
        }
    }

    const emailDetails = [...emails.values()].map((row) => {
        const { score, reasons } = scoreEmail(row, siteHost)
        return {
            email: row.email,
            syntaxValid: true,
            mxValid: row.mxValid ?? null,
            score,
            reasons,
            sources: [...row.sources].sort(),
            name: row.name,
            role: row.role,
            roleSource: row.roleSource,
            phone: row.phone,
        }
    })
    emailDetails.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))

    const phones = dedupePhones(phoneEntries)
    const contacts = emailDetails.map((row) => ({
        name: row.name,
        role: row.role,
        roleSource: row.roleSource,
        email: row.email,
        phone: row.phone,
        syntaxValid: true,
        mxValid: row.mxValid,
        score: row.score,
        sources: row.sources,
    }))
    for (const person of people) {
        if (person.email) continue
        if (!person.phone && !person.name) continue
        contacts.push({
            name: person.name && looksLikeName(person.name) ? person.name : null,
            role: cleanRole(person.role),
            roleSource: person.roleSource || null,
            email: null,
            phone: person.phone || null,
            syntaxValid: null,
            mxValid: null,
            score: (person.name ? 12 : 0) + (person.role ? 8 : 0) + (person.phone ? 10 : 0),
            sources: [...new Set(person.sources || [])].sort(),
        })
    }
    contacts.sort((a, b) => b.score - a.score || String(a.email).localeCompare(String(b.email)))

    const best = contacts.find((contact) => contact.email) || contacts.find((contact) => contact.phone) || null
    const bestContact = best
        ? {
            name: best.name,
            role: best.role,
            roleSource: best.roleSource,
            email: best.email,
            phone: best.phone,
            syntaxValid: best.syntaxValid,
            mxValid: best.mxValid,
            score: best.score,
            reasons: emailDetails.find((row) => row.email === best.email)?.reasons || [],
        }
        : null

    return {
        emails: emailDetails.map((row) => row.email).slice(0, 15),
        emailDetails: emailDetails.slice(0, 15).map(({ email, syntaxValid, mxValid, score, sources, name, role }) => ({
            email, syntaxValid, mxValid, score, sources, name, role,
        })),
        phones: phones.map((item) => item.phone),
        contacts: contacts.slice(0, 20),
        bestContact,
        primaryPhone: best?.phone || phones[0]?.phone || null,
    }
}

export function mergeSocials(lists) {
    const socials = emptySocials()
    for (const list of lists) {
        for (const key of SOCIAL_NETWORKS) {
            for (const url of list?.[key] || []) {
                if (!socials[key].includes(url) && socials[key].length < 5) socials[key].push(url)
            }
        }
    }
    return socials
}

export function hostFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}
