// A green run with an empty dataset looks like "no businesses here". It is a failed scrape:
// nothing was saved and nothing should be billed as a finished lead list.
export function decideRunFinish({ pushed = 0, searchFailures = 0, scheduled = 0, detailFailures = 0 } = {}) {
    if (pushed > 0) return { action: 'exit' };
    if (searchFailures > 0 && scheduled === 0) {
        return { action: 'fail', message: 'No places were saved because Google Maps did not return a results list. Nothing was charged.' };
    }
    if (detailFailures > 0 && scheduled > 0) {
        return { action: 'fail', message: 'No places were saved because every place lookup failed or every result was filtered out. Nothing was charged.' };
    }
    return { action: 'fail', message: 'No places were saved. Nothing was charged.' };
}

// The watchdog must not report success when it abandons a run that delivered nothing.
export function hardStopExitCode(pushed) {
    return pushed > 0 ? 0 : 1;
}
