import type { ChatRequest, ChatResult } from "./types";

export type AISessionHeaders = () => Promise<Record<string, string>>;
export class AIRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) { super(message); }
}
export async function aiRequest<T>(path: string, headers: AISessionHeaders, body?: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const credentials = await headers();
  signal?.throwIfAborted();
  const response = await fetch(`/api/custom-ai${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...credentials },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  });
  const value = await response.json().catch(error => { if (response.ok) throw error; return null; });
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const seconds = retry === null ? 0 : Number(retry);
    const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry!) - Date.now());
    throw new AIRequestError(value?.error || "The request could not finish. Try again shortly.", response.status,
      Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0);
  }
  return value as T;
}

export async function sendAIChat(input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal): Promise<ChatResult> {
  let result = await aiRequest<ChatResult | { state: string }>("", headers, input, signal);
  while ("state" in result) {
    if (result.state !== "running") throw Error("The previous reply did not finish. Your draft is still saved.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const job = await aiRequest<{ state: string; result?: ChatResult }>(`?id=${encodeURIComponent(input.id)}`, headers, undefined, signal);
    result = job.state === "completed" && job.result ? job.result : job;
  }
  return result;
}
