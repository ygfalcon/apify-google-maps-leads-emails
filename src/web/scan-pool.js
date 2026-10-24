import { Worker } from 'node:worker_threads';
import { emptySocials, extractPage } from './extract.js';

export const SCAN_TIMEOUT_MS = 8000;

export function emptyScan() {
    return { emails: [], phones: [], socials: emptySocials(), people: [], links: [] };
}

function failedScan() {
    return { ...emptyScan(), failed: true };
}

export function createScanPool({ size = 1, timeoutMs = SCAN_TIMEOUT_MS, workerPath, createWorker } = {}) {
    const path = workerPath ?? new URL('./extract-worker.js', import.meta.url);
    const limit = Math.max(1, size);
    let closed = false;
    let seq = 0;
    let failures = 0;
    let pumping = false;
    const workers = [];
    const idle = [];
    const queue = [];

    function drop(state) {
        const idx = workers.indexOf(state);
        if (idx >= 0) workers.splice(idx, 1);
        const idleIdx = idle.indexOf(state);
        if (idleIdx >= 0) idle.splice(idleIdx, 1);
    }

    function settle(state, result) {
        clearTimeout(state.timer);
        state.timer = null;
        const job = state.job;
        state.job = null;
        if (job) job.resolve(result || failedScan());
    }

    function spawn() {
        if (closed || workers.length >= limit) return;
        const worker = createWorker ? createWorker() : new Worker(path, { execArgv: [] });
        const release = () => worker.unref?.();
        release();
        worker.on?.('online', release);
        const state = { worker, job: null, timer: null };
        worker.on('message', (msg) => {
            if (!state.job || !msg || msg.id !== state.job.id) return;
            failures = 0;
            idle.push(state);
            const result = msg.result && !msg.error ? msg.result : failedScan();
            settle(state, result);
            pump();
        });
        worker.on('error', () => {
            failures += 1;
            const job = state.job;
            clearTimeout(state.timer);
            state.timer = null;
            state.job = null;
            drop(state);
            if (job) {
                // The worker failed to start. A timeout kill does not land here.
                // A short page is scanned inline so a missing worker still finds contacts.
                // A huge page is not: that fallback is what froze the run.
                if (String(job.html || '').length > 100_000) job.resolve(failedScan());
                else {
                    try { job.resolve(extractPage(job.html, job.baseUrl, job.pageKind)); }
                    catch { job.resolve(failedScan()); }
                }
            }
            if (!closed && failures < 3) spawn();
            pump();
        });
        workers.push(state);
        idle.push(state);
        return state;
    }

    function kill(state) {
        const worker = state.worker;
        settle(state, failedScan());
        drop(state);
        try { worker?.terminate?.(); } catch { /* already gone */ }
        if (!closed && failures < 8) spawn();
        pump();
    }

    function pump() {
        if (pumping || closed) return;
        pumping = true;
        try {
            while (queue.length && idle.length) {
                const state = idle.pop();
                const job = queue.shift();
                state.job = job;
                state.timer = setTimeout(() => kill(state), timeoutMs);
                try {
                    state.worker.postMessage({
                        type: 'scan',
                        id: job.id,
                        html: job.html,
                        baseUrl: job.baseUrl,
                        pageKind: job.pageKind,
                    });
                } catch {
                    clearTimeout(state.timer);
                    failures += 1;
                    settle(state, failedScan());
                    drop(state);
                    try { state.worker.terminate?.(); } catch { /* already gone */ }
                    if (!closed && failures < 3) spawn();
                }
            }
            if (!idle.length && queue.length && failures >= 3) {
                for (const job of queue.splice(0)) job.resolve(failedScan());
            }
        } finally {
            pumping = false;
        }
    }

    while (workers.length < limit) spawn();

    return {
        scan(html, baseUrl, pageKind = 'home') {
            if (closed) return Promise.resolve(failedScan());
            return new Promise((resolve) => {
                queue.push({ id: ++seq, html: String(html || ''), baseUrl, pageKind, resolve });
                pump();
            });
        },
        async close() {
            closed = true;
            for (const job of queue.splice(0)) job.resolve(failedScan());
            const current = [...workers];
            workers.length = 0;
            idle.length = 0;
            await Promise.all(current.map(async (state) => {
                clearTimeout(state.timer);
                const job = state.job;
                state.job = null;
                if (job) job.resolve(failedScan());
                try { await state.worker.terminate?.(); } catch { /* already gone */ }
            }));
        },
    };
}

let shared;
export function getScanPool() {
    if (!shared) shared = createScanPool();
    return shared;
}

export async function closeScanPool() {
    if (!shared) return;
    const pool = shared;
    shared = null;
    await pool.close();
}
