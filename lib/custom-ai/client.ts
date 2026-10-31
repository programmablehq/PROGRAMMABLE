import { CHAT_PHASES, parseChatRequest, type ChatPhase, type ChatProgress, type ChatRequest, type ChatResult } from "./types";
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
  signal.throwIfAborted();
  const credentials = await headers();
  signal.throwIfAborted();
  const readStored = () => readReply(input,headers,signal);
  let result: ChatResult | SavedReply = { state: "running" };
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
  return "state" in result ? followSavedReply(result,input,headers,signal,onProgress) : result;
}
