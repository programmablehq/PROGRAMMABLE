import "server-only";
import { createHash } from "node:crypto";
import { CustomAIError, isBriefChat, type ChatRequest, type ChatResult } from "./types";

// Local preview only. Public rollout requires shared account quotas and the
// existing wallet-authenticated API; an in-memory guard is not a public quota.
export function allowLocalPreview(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" || process.env.CUSTOM_AI_LOCAL_PREVIEW !== "true"
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new CustomAIError("unavailable", "Custom AI is not available here yet.", 404);
  }
  let origin: URL | undefined;
  try { origin = new URL(request.headers.get("origin") ?? ""); } catch { /* Missing/invalid origin is denied below. */ }
  // Next may normalize the internal request URL to localhost even when the
  // browser uses 127.0.0.1. Match the browser Origin to the actual Host header.
  if (!origin || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    || origin.host !== request.headers.get("host") || origin.port !== url.port || origin.protocol !== url.protocol) {
    throw new CustomAIError("origin", "Open the builder on this device to continue.", 403);
  }
}

export function createPreviewBudget() {
  let started = Date.now(), used = 0, active = 0;
  const requests = new Map<string, { hash: string; result: Promise<ChatResult> }>();
  return async (request: ChatRequest, run: () => Promise<ChatResult>) => {
    if (Date.now() - started > 3_600_000 && active === 0) { started = Date.now(); used = 0; requests.clear(); }
    const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const prior = requests.get(request.id);
    if (prior) {
      if (prior.hash !== hash) throw new CustomAIError("conflict", "Start a new request for this change.", 409);
      return prior.result;
    }
    // Units avoid fractional accounting. A conversational turn can now build,
    // so reserve all five units until a reply confirms no draft was produced.
    const reserve = isBriefChat(request) ? 1 : 5;
    if (active >= 2 || used + reserve > 25) throw new CustomAIError("budget", "The preview has reached its request budget. Try again later.", 429);
    used += reserve; active++;
    // Reserve conservatively, including failed/aborted provider calls. Never
    // auto-retry a transport or billing error on a more expensive model.
    const result = Promise.resolve().then(run).then(value => {
      if (request.intent === "chat" && !value.draft) used -= reserve - 1;
      return value;
    }).finally(() => { active--; });
    requests.set(request.id, { hash, result });
    return result;
  };
}

export async function readPreviewBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new CustomAIError("input", "Send a JSON request.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new CustomAIError("input", "Send a message first.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 64_000) { await reader.cancel(); throw new CustomAIError("input", "This message is too large.", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new CustomAIError("input", "The message could not be read."); }
  } finally { reader.releaseLock(); }
}
