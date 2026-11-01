import { CHAT_PHASES, parseChatRequest, type ChatPhase, type ChatProgress, type ChatRequest, type ChatResult } from "./types";
import { readServerEvents } from "./events";

export type AISessionHeaders = () => Promise<Record<string, string>>;
export class AIRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0,
    readonly code = "", readonly requestState?: "failed") { super(message); }
}

const requestTimeout = (path: string) => /^\/(launch|general-launch|trade)(?:\?|$)/.test(path) ? 130_000
  : /^\/(readiness|preview|quote|tokens)(?:\?|$)/.test(path) ? 70_000 : 30_000;

/** Includes credentials and response consumption, even if a transport ignores abort. */
async function boundedRequest<T>(signal: AbortSignal | undefined, timeoutMs: number, work: (signal: AbortSignal, resetTimeout: (ms: number) => void) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new AIRequestError(
      "The connection took too long. Your saved work is kept. Reconnect or try again.", 408, 0, "timeout")), ms);
  };
  resetTimeout(timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([work(controller.signal, resetTimeout), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    controller.abort();
  }
}

function retryAfter(response: Response) {
  const value = response.headers.get("retry-after");
  if (value === null) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

async function responseValue(response: Response) {
  const invalid = Symbol("invalid-json");
  const value = await response.json().catch(() => invalid);
  if (!response.ok) {
    const fallback = response.status === 401 ? "Reconnect your wallet to continue. Your saved work is kept."
      : response.status === 429 ? "Too many requests right now. Wait a moment before trying again."
      : "The service could not finish this request. Your saved work is kept. Try again shortly.";
    throw new AIRequestError(typeof value?.error === "string" ? value.error : fallback, response.status,
      retryAfter(response), typeof value?.code === "string" ? value.code : "response", value?.requestState);
  }
  if (value === invalid) throw new AIRequestError("The service returned an unreadable response. Your saved work is kept. Try loading it again.", 502, 0, "response");
  return value;
}
export async function aiRequest<T>(path: string, headers: AISessionHeaders, body?: unknown, signal?: AbortSignal): Promise<T> {
  return boundedRequest(signal, requestTimeout(path), async requestSignal => {
  const credentials = await headers();
  requestSignal.throwIfAborted();
  const response = await fetch(`/api/custom-ai${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...credentials },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal,
  });
  requestSignal.throwIfAborted();
  return await responseValue(response) as T;
  });
}

type SavedReply = { id?: string; state: string; request?: ChatRequest; payloadHash?: string; result?: ChatResult; errorCode?: string; phase?: ChatPhase; heartbeatAt?: number };
export const sameAIRequest = (left: ChatRequest, right: ChatRequest) => JSON.stringify(parseChatRequest(left)) === JSON.stringify(parseChatRequest(right));
const readReply = (input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal, statusOnly=false) =>
  aiRequest<SavedReply>(`?id=${encodeURIComponent(input.id)}${statusOnly?"&view=status":""}`, headers, undefined, signal);

async function followSavedReply(initial: SavedReply, input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal,
  onProgress?: (event: ChatProgress) => void): Promise<ChatResult> {
  let job=initial,delay=2000,boundHash:string|undefined;
  const deadline=Date.now()+450_000;
  for (;;) {
    signal.throwIfAborted();
    if (job.id !== input.id) {
      throw new AIRequestError("The saved reply belongs to another request. Your current design is kept.",409,0,"context");
    }
    if (job.state === "failed") throw new AIRequestError(job.errorCode === "cancelled" ? "This reply was stopped. Your saved design is kept."
      : "The previous attempt ended. Send your message again to retry.",409,0,job.errorCode??"interrupted","failed");
    if (job.request) {
      if(!sameAIRequest(input,job.request)||boundHash&&job.payloadHash!==boundHash)throw new AIRequestError("The saved reply belongs to another request. Your current design is kept.",409,0,"context");
      if(typeof job.payloadHash==="string"&&/^[a-f0-9]{64}$/.test(job.payloadHash))boundHash=job.payloadHash;
    } else if(!boundHash||job.payloadHash!==boundHash)throw new AIRequestError("The saved reply belongs to another request. Your current design is kept.",409,0,"context");
    if (job.state === "completed" && job.result) return job.result;
    if (job.state !== "running") throw new AIRequestError("The saved reply could not be read. Your design is kept.",502,0,"response");
    if (Date.now() >= deadline) throw new AIRequestError("This request is still saved. Reconnect to check its result.",503);
    const age=Date.now()-(job.heartbeatAt??0),fresh=age>=-5000&&age<45000;
    onProgress?.({type:"phase",phase:fresh&&job.phase&&CHAT_PHASES.includes(job.phase)?job.phase:"reconnecting"});
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},delay);
      signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
    });
    delay=Math.min(10000,delay*1.5);
    job=await readReply(input,headers,signal,Boolean(boundHash));
  }
}

/** Reload/reconnect only reads an existing owned request. It never POSTs. */
export async function resumeAIChat(input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal,
  onProgress?: (event: ChatProgress) => void): Promise<ChatResult> {
  return followSavedReply(await readReply(input,headers,signal),input,headers,signal,onProgress);
}

export async function sendAIChat(input: ChatRequest, headers: AISessionHeaders, signal: AbortSignal,
  onProgress?: (event: ChatProgress) => void): Promise<ChatResult> {
  const readStored = () => readReply(input,headers,signal);
  let result: ChatResult | SavedReply;
  try {
    result = await boundedRequest(signal, 30_000, async (requestSignal, resetTimeout) => {
    const credentials = await headers();
    requestSignal.throwIfAborted();
    const response = await fetch("/api/custom-ai", { method: "POST", cache: "no-store", credentials: "same-origin", signal: requestSignal,
      headers: { ...credentials, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) });
    requestSignal.throwIfAborted();
    resetTimeout(450_000);
    if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
      for await (const event of readServerEvents(response, { signal: requestSignal, idleTimeoutMs: 45_000 })) {
        if (event.type === "phase" || event.type === "reply") onProgress?.(event as ChatProgress);
        else if (event.type === "result") return event.result as ChatResult;
        else if (event.type === "error") throw new AIRequestError(String(event.error), Number(event.status), 0, String(event.code), event.requestState === "failed" ? "failed" : undefined);
      }
      throw new Error("The response stream ended before its result.");
    }
    const value = await responseValue(response);
    if (!value || typeof value !== "object" || typeof value.reply !== "string" && typeof value.state !== "string") {
      throw new AIRequestError("The saved reply could not be read. Reconnect to check its result.", 502, 0, "response");
    }
    return value as ChatResult | SavedReply;
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AIRequestError && (error.requestState === "failed"
      || error.status >= 400 && error.status < 500 && error.code !== "timeout"
      || error.code !== "timeout" && error.code !== "response")) throw error;
    // Recover the same saved request. Never regenerate after an unknown outcome.
    result = await readStored();
  }
  return "state" in result ? followSavedReply(result,input,headers,signal,onProgress) : result;
}
