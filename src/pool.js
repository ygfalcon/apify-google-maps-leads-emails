// Tiny concurrency limiter. Each call settles when that job settles, so callers can push
// a place as soon as its own detail and contact work finishes.
export function createLimiter(concurrency) {
    const limit = Math.max(1, concurrency);
    let active = 0;
    const queue = [];
    const pump = () => {
        while (active < limit && queue.length) {
            const job = queue.shift();
            active += 1;
            Promise.resolve()
                .then(job.fn)
                .then(job.resolve, job.reject)
                .finally(() => {
                    active -= 1;
                    pump();
                });
        }
    };
    return function limitFn(fn) {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            pump();
        });
    };
}
