// Hard caps so one stuck place or a long queue cannot keep a run alive forever.
export const PLACE_DEADLINE_MS = 35000;

export function drainDeadlineMs(taskCount, { floor = 120000, perTask = 1500, cap = 15 * 60 * 1000 } = {}) {
    const n = Math.max(0, Number(taskCount) || 0);
    return Math.min(cap, Math.max(floor, n * perTask));
}
