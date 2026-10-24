// Lazy-load crawlee's HTTP client so pure parsing modules (and their tests) don't need crawlee installed.
let cached;
export async function gotScraping(opts) {
    if (!cached) cached = (await import('crawlee')).gotScraping;
    return cached(opts);
}
