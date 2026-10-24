import { parentPort } from 'node:worker_threads';
import { extractPage } from './extract.js';

parentPort.on('message', (job) => {
    if (!job || job.type !== 'scan') return;
    try {
        const result = extractPage(job.html || '', job.baseUrl || '', job.pageKind || 'home');
        parentPort.postMessage({ id: job.id, result });
    } catch (error) {
        parentPort.postMessage({ id: job.id, error: String(error?.message || error), result: null });
    }
});
