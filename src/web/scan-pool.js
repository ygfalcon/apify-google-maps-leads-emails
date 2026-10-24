import { Worker } from 'node:worker_threads';
import { emptySocials, extractPage } from './extract.js';

export const SCAN_TIMEOUT_MS = 8000;

export function emptyScan() {
    return { emails: [], phones: [], socials: emptySocials(), people: [], links: [] };
}

export function createScanPool({ size = 1, timeoutMs = SCAN_TIMEOUT_MS, workerPath } = {}) {
    const path = workerPath ?? new URL('./extract-worker.js', import.meta.url);
    let closed = false;
    let seq = 0;
    let failures = 0;
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
        if (job) job.resolve(result || emptyScan());
    }

    function kill(state) {
        const worker = state.worker;
        settle(state, emptyScan());
        drop(state);
        worker?.terminate();
        if (!closed && failures < 8) spawn();
        pump();
    }

    function spawn() {
        // Don't inherit parent flags such as --input-type; those crash a file-backed worker and would drop every contact.
        const worker = new Worker(path, { execArgv: [] });
        worker.unref();
        const state = { worker, job: null, timer: null };
        worker.on('message', (msg) => {
            if (!state.job || !msg || msg.id !== state.job.id) return;
            failures = 0;
            idle.push(state);
            settle(state, msg.result || emptyScan());
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
                // The worker failed to start or crashed. A timeout kill does not land here.
                // Falling back keeps contacts when the worker cannot boot; a hung regex is killed instead.
                try { job.resolve(extractPage(job.html, job.baseUrl, job.pageKind)); }
                catch { job.resolve(emptyScan()); }
            }
            if (!closed && failures < 3) spawn();
            pump();
        });
        workers.push(state);
        idle.push(state);
        return state;
    }

    function pump() {
        if (closed) return;
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
                kill(state);
            }
        }
    }

    while (workers.length < Math.max(1, size)) spawn();

    return {
        scan(html, baseUrl, pageKind = 'home') {
            if (closed) return Promise.resolve(emptyScan());
            return new Promise((resolve) => {
                queue.push({ id: ++seq, html: String(html || ''), baseUrl, pageKind, resolve });
                pump();
            });
        },
        async close() {
            closed = true;
            for (const job of queue.splice(0)) job.resolve(emptyScan());
            const current = [...workers];
            workers.length = 0;
            idle.length = 0;
            await Promise.all(current.map(async (state) => {
                clearTimeout(state.timer);
                const job = state.job;
                state.job = null;
                if (job) job.resolve(emptyScan());
                await state.worker.terminate();
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
