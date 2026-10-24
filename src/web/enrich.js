import { promises as dns } from 'node:dns'
import { gotScraping } from 'got-scraping'
import {
    extractImpressum,
    extractSocials,
    finalizeContacts,
    hostFromUrl,
    htmlToText,
    mergeSocials,
    pageKindFromUrl,
} from './extract.js'
import { getScanPool } from './scan-pool.js'

const NOREPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|unsubscribe|newsletter|daemon|postmaster|webmaster|root|hostmaster|donotreply)$/i

function hasUsefulEmail(rows) {
    return rows.some((row) => {
        const local = String(row?.email || '').split('@')[0]
        return local && !NOREPLY.test(local)
    })
}

function hasSocial(lists) {
    return lists.some((list) => list && Object.values(list).some((urls) => urls?.length))
}

function dropGuesses(queue) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].guessed) queue.splice(i, 1)
}

const mxCache = new Map()

export function clearMxCache() {
    mxCache.clear()
}

export async function mxOverHttps(domain, timeoutMs = 3000) {
    for (const base of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']) {
        try {
            const response = await fetch(`${base}?name=${encodeURIComponent(domain)}&type=MX`, {
                headers: { accept: 'application/dns-json' },
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!response.ok) continue
            const body = await response.json()
            if (body.Status === 3) return false
            if (body.Status !== 0) continue
            const mx = (body.Answer || []).filter((answer) => answer.type === 15 && !/^0 \.?$/.test(answer.data))
            return mx.length > 0
        } catch { /* try next resolver */ }
    }
    return null
}

export async function checkMx(domain, { resolveMx = dns.resolveMx, timeoutMs = 1500, cache = mxCache, dohImpl } = {}) {
    const key = String(domain || '').toLowerCase()
    if (!key) return null
    if (cache.has(key)) return cache.get(key)
    const pending = (async () => {
        try {
            const records = await Promise.race([
                resolveMx(key),
                new Promise((_, reject) => {
                    const error = new Error('timeout')
                    error.code = 'ETIMEOUT'
                    setTimeout(() => reject(error), timeoutMs).unref?.()
                }),
            ])
            return Array.isArray(records) && records.length > 0
        } catch (error) {
            const code = error?.code
            if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENODOMAIN') {
                // Some resolvers refuse MX queries. Confirm over DNS-over-HTTPS before calling a domain dead.
                const confirmed = await (dohImpl || mxOverHttps)(key, timeoutMs * 2)
                return confirmed
            }
            return null
        }
    })()
    cache.set(key, pending)
    return pending
}

export async function fetchHtml(url, { proxyUrl, timeoutMs = 12000, fetchImpl = gotScraping, attempts = 2 } = {}) {
    // A proxy that never connects used to burn both attempts. After a network failure, try once with no proxy.
    // A clean 4xx (including 403) stays on the proxy so a block is not bypassed.
    const tries = Math.max(1, Number(attempts) || 1)
    let dropProxy = false
    for (let attempt = 0; attempt < tries; attempt++) {
        const useProxy = dropProxy ? undefined : proxyUrl
        const controller = new AbortController()
        let timer
        try {
            // got's own timeout can miss stalls (proxy CONNECT, slow-drip bodies), so race a hard deadline too.
            const response = await Promise.race([fetchImpl({
                signal: controller.signal,
                url,
                proxyUrl: useProxy,
                timeout: { request: timeoutMs },
                followRedirect: true,
                retry: { limit: 0 },
                throwHttpErrors: false,
                headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
            }), new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('hard_timeout')) }, timeoutMs)
            })])
            const status = response.statusCode ?? response.status
            const headers = response.headers || {}
            const type = String(headers['content-type'] || headers['Content-Type'] || '')
            const body = String(response.body ?? '')
            const bytes = Buffer.byteLength(body)
            if (status >= 400 && status < 500) return null
            const looksHtml = type.includes('html') || type.includes('xml') || (!type && body.includes('<'))
            if (status < 400 && looksHtml && body.includes('<')) {
                return { html: body.slice(0, 1_500_000), finalUrl: response.url || url, bytes }
            }
            if (status >= 500) continue
            return null
        } catch {
            if (proxyUrl && !dropProxy) dropProxy = true
        } finally {
            clearTimeout(timer)
        }
    }
    return null
}

async function openHomepage(url, fetchOptions) {
    // Try HTTPS first even for http:// listings (most sites support it and some networks block port 80),
    // then fall back to plain HTTP. The protocol switch is the retry, so HTTP is attempted once.
    const secure = url.replace(/^http:\/\//, 'https://')
    const first = await fetchHtml(secure, { ...fetchOptions, attempts: 2 })
    if (first) return first
    return fetchHtml(secure.replace('https://', 'http://'), { ...fetchOptions, attempts: 1 })
}

export async function enrichWebsite(website, {
    proxyUrl,
    maxPages = 3,
    validateMx = true,
    mxTimeoutMs = 1500,
    resolveMx,
    fetchImpl,
    mxCache: cache,
    timeoutMs = 12000,
    scanPool,
} = {}) {
    const empty = {
        emails: [],
        emailDetails: [],
        phones: [],
        socials: mergeSocials([]),
        contacts: [],
        bestContact: null,
        primaryPhone: null,
        pagesScanned: 0,
        pages: [],
        finalUrl: null,
        impressum: { owner: null, vatId: null },
        error: null,
    }
    if (!website) {
        empty.error = 'invalid_url'
        return empty
    }
    let start
    try {
        start = website.startsWith('http') ? new URL(website) : new URL(`https://${website}`)
    } catch {
        empty.error = 'invalid_url'
        return empty
    }
    const fetchOptions = { proxyUrl, fetchImpl, timeoutMs }
    const scan = scanPool || getScanPool()
    let bytes = 0
    const seeded = extractSocials(start.href)
    const home = await openHomepage(start.href, fetchOptions)
    if (!home) {
        empty.socials = mergeSocials([seeded])
        empty.error = 'website_unreachable'
        return empty
    }
    bytes += home.bytes || 0

    const pageBudget = Math.min(Math.max(1, maxPages), 10)
    const seen = new Set()
    const queue = []
    const emailRows = []
    const people = []
    const phoneEntries = []
    const socialLists = [seeded]
    const pages = []
    const impressum = { owner: null, vatId: null }
    const startHost = hostFromUrl(home.finalUrl)
    const startIsLinktree = pageKindFromUrl(home.finalUrl) === 'linktree'

    const consume = async (page, kind) => {
        if (pages.includes(page.finalUrl)) return
        // Regex scanning runs in a worker so a pathological page can be killed without freezing the run.
        const extracted = await scan.scan(page.html, page.finalUrl, kind)
        emailRows.push(...(extracted.emails || []).map((row) => ({ ...row, mxValid: null })))
        people.push(...(extracted.people || []))
        phoneEntries.push(...(extracted.phones || []))
        socialLists.push(extracted.socials || {})
        pages.push(page.finalUrl)
        if (kind === 'impressum') {
            const parsed = extractImpressum(htmlToText(page.html))
            if (!impressum.owner && parsed.owner) impressum.owner = parsed.owner
            if (!impressum.vatId && parsed.vatId) impressum.vatId = parsed.vatId
        }
        for (const link of extracted.links || []) {
            if (kind === 'linktree' && !startIsLinktree) continue
            if (seen.has(link.url)) continue
            queue.push(link)
        }
    }

    seen.add(home.finalUrl)
    await consume(home, startIsLinktree ? 'linktree' : 'home')
    if (hasUsefulEmail(emailRows) && hasSocial(socialLists)) dropGuesses(queue)

    let extra = 0
    let attempts = 0
    const attemptCap = pageBudget + 2
    while (extra < pageBudget - 1 && attempts < attemptCap && queue.length) {
        if (hasUsefulEmail(emailRows) && hasSocial(socialLists)) dropGuesses(queue)
        if (!queue.length) break
        queue.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
        const batch = []
        while (batch.length < Math.min(4, pageBudget - 1 - extra) && queue.length && attempts + batch.length < attemptCap) {
            const next = queue.shift()
            if (!next || seen.has(next.url)) continue
            seen.add(next.url)
            batch.push(next)
        }
        if (!batch.length) break
        attempts += batch.length
        const fetched = await Promise.all(batch.map(async (link) => ({
            link,
            page: await fetchHtml(link.url, { ...fetchOptions, attempts: 1 }),
        })))
        for (const { link, page } of fetched) {
            if (!page || extra >= pageBudget - 1) continue
            bytes += page.bytes || 0
            extra += 1
            const kind = pageKindFromUrl(page.finalUrl || link.url)
            await consume(page, kind === 'other' ? (link.family === 'other' ? 'other' : link.family) : kind)
        }
    }

    if (validateMx) {
        const domains = [...new Set(emailRows.map((row) => row.email.split('@')[1]).filter(Boolean))]
        const lookups = new Map(await Promise.all(domains.map(async (domain) => [
            domain,
            await checkMx(domain, { resolveMx, timeoutMs: mxTimeoutMs, cache }),
        ])))
        for (const row of emailRows) row.mxValid = lookups.get(row.email.split('@')[1]) ?? null
    }

    const finalized = finalizeContacts({ emailRows, people, phoneEntries, siteHost: startHost })
    return {
        ...empty,
        ...finalized,
        socials: mergeSocials(socialLists),
        impressum,
        pagesScanned: pages.length,
        pages,
        finalUrl: home.finalUrl,
        bytes,
        error: null,
    }
}
