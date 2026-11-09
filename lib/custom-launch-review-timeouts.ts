// Cold exact-source analysis can use the backend's 120-second compiler budget.
// Leave time for authentication, the saved decision and its response.
export const REVIEW_DECISION_BACKEND_TIMEOUT_MS = 150_000;
export const REVIEW_DECISION_BROWSER_TIMEOUT_MS = 160_000;
