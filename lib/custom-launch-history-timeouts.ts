// The history API allows up to 25 seconds across authenticated read attempts.
// Leave time for the response to reach the browser.
export const launchHistoryRefreshTimeoutMs = 30_000;
