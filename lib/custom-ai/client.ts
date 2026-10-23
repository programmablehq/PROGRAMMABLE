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
  const response = await fetch("/api/custom-ai", { method: "POST", cache: "no-store", credentials: "same-origin", signal,
    headers: { ...credentials, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) });
  let result: ChatResult | { state: string };
  if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
    for await (const event of readServerEvents(response)) {
      if (event.type === "phase" || event.type === "reply") onProgress?.(event as ChatProgress);
      else if (event.type === "result") return event.result as ChatResult;
      else if (event.type === "error") throw new AIRequestError(String(event.error), Number(event.status), 0, String(event.code), event.requestState === "failed" ? "failed" : undefined);
    }
    // Unknown outcome: retain the request id and recover its stored result.
    throw new AIRequestError("The connection ended before the reply arrived. Send again to check this attempt.", 503);
  } else {
    const value = await response.json();
    if (!response.ok) throw new AIRequestError(value.error || "The reply could not finish.", response.status,
      Math.max(0, Number(response.headers.get("retry-after")) || 0) * 1000, value.code, value.requestState);
    result = value;
  }
  while ("state" in result) {
    if (result.state !== "running") throw new AIRequestError("The previous attempt ended. Send your message again to retry.", 409, 0, "interrupted", "failed");
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
