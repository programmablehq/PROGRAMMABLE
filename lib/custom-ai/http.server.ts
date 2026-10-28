import "server-only";
import { CustomAIError } from "./types";
export const aiHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function aiError(error: unknown, requestState?: "failed") {
  const known = error instanceof CustomAIError ? error : new CustomAIError("unavailable", "The builder could not finish. Your draft is still here.", 503);
  return Response.json({ error: known.message, code: known.code, ...(requestState ? { requestState } : {}) }, { status: known.status,
    headers: { ...aiHeaders, ...((known.status === 429 || known.retryAfterMs > 0) ? { "Retry-After": String(Math.max(1, Math.ceil((known.retryAfterMs || 60_000) / 1000))) } : {}) } });
}
