import type { ChatProgress, ChatRequest, ChatResult } from "./types";
import { readServerEvents } from "./events";

export type AISessionHeaders = () => Promise<Record<string, string>>;
export class AIRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0,
    readonly code = "", readonly requestState?: "failed") { super(message); }
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
      Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0, value?.code, value?.requestState);
  }
  return value as T;
}

export async function sendAIChat(input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal,
  onProgress?: (event: ChatProgress) => void): Promise<ChatResult> {
  signal.throwIfAborted();
  const credentials = await headers();
  signal.throwIfAborted();
  const readStored = async () => {
    const job = await aiRequest<{ state: string; result?: ChatResult }>(`?id=${encodeURIComponent(input.id)}`, headers, undefined, signal);
    return job.state === "completed" && job.result ? job.result : job;
  };
  let result: ChatResult | { state: string } = { state: "running" };
  let response: Response | undefined;
  try {
    response = await fetch("/api/custom-ai", { method: "POST", cache: "no-store", credentials: "same-origin", signal,
      headers: { ...credentials, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) });
  } catch {
    signal.throwIfAborted();
    result = await readStored();
  }
  if (response?.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
    try {
      for await (const event of readServerEvents(response)) {
        if (event.type === "phase" || event.type === "reply") onProgress?.(event as ChatProgress);
        else if (event.type === "result") return event.result as ChatResult;
        else if (event.type === "error") throw new AIRequestError(String(event.error), Number(event.status), 0, String(event.code), event.requestState === "failed" ? "failed" : undefined);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AIRequestError && error.requestState === "failed") throw error;
    }
    // Recover the same saved request. Never regenerate after an unknown outcome.
    result = await readStored();
  } else if (response) {
    const value = await response.json();
    if (!response.ok) throw new AIRequestError(value.error || "The reply could not finish.", response.status,
      Math.max(0, Number(response.headers.get("retry-after")) || 0) * 1000, value.code, value.requestState);
    result = value;
  }
  const recoveryDeadline = Date.now() + 450_000;
  let pollDelay = 2000;
  while ("state" in result) {
    if (Date.now() >= recoveryDeadline) throw new AIRequestError("This request is still saved. Open it again to check the result.", 503);
    if (result.state !== "running") throw new AIRequestError("The previous attempt ended. Send your message again to retry.", 409, 0, "interrupted", "failed");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, pollDelay);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    pollDelay = Math.min(10_000, pollDelay * 1.5);
    const job = await aiRequest<{ state: string; result?: ChatResult }>(`?id=${encodeURIComponent(input.id)}`, headers, undefined, signal);
    result = job.state === "completed" && job.result ? job.result : job;
  }
  return result;
}
