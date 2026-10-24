// The default input turns the Apify proxy on. Locally that proxy often never connects and the whole
// run sits in navigation retries. Probe it, and keep going with a direct connection when it does not answer.

const PROBE_MS = 8000;

export async function proxyResponds(proxy, { timeoutMs = PROBE_MS, fetchImpl } = {}) {
    let proxyUrl;
    try {
        proxyUrl = await proxy.newUrl();
    } catch {
        return false;
    }
    const fetch = fetchImpl || (async (opts) => {
        const { gotScraping } = await import('./http.js');
        return gotScraping({ ...opts, throwHttpErrors: false, retry: { limit: 0 }, followRedirect: true });
    });
    let timer;
    try {
        const response = await Promise.race([
            fetch({
                url: 'https://www.google.com/generate_204',
                proxyUrl,
                timeout: { request: timeoutMs },
            }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('probe_timeout')), timeoutMs);
            }),
        ]);
        const status = response?.statusCode ?? response?.status ?? 0;
        return status >= 200 && status < 400;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export async function selectProxy(proxyInput, { createProxy, probe = proxyResponds, log } = {}) {
    const urls = proxyInput?.proxyUrls;
    const enabled = Boolean(proxyInput?.useApifyProxy) || (Array.isArray(urls) && urls.length > 0);
    if (!enabled) return undefined;
    let proxy;
    let timer;
    try {
        proxy = await Promise.race([
            Promise.resolve().then(() => createProxy(proxyInput)),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('proxy_setup_timeout')), PROBE_MS);
            }),
        ]);
    } catch (err) {
        log?.warning?.(`Proxy setup failed (${err?.message || err}); continuing without a proxy.`);
        return undefined;
    } finally {
        clearTimeout(timer);
    }
    if (!proxy) return undefined;
    let ok = false;
    try {
        ok = await probe(proxy);
    } catch {
        ok = false;
    }
    if (!ok) {
        log?.warning?.('Apify proxy did not respond; continuing with a direct connection.');
        return undefined;
    }
    return proxy;
}
