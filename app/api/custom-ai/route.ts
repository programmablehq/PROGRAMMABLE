import { after } from "next/server";
import { providerHealth } from "@/lib/custom-ai/provider-health.server";
import { assertModelConnection, researchAvailable } from "@/lib/custom-ai/provider-config.server";
import { executionProfile, getCapabilities } from "@/lib/custom-ai/capabilities/registry.server";
import { createPreviewBudget, readPreviewBody } from "@/lib/custom-ai/access.server";
import { runCustomAI, type AIContext } from "@/lib/custom-ai/service.server";
import { CustomAIError, parseChatRequest, type ChatProgress, type ChatResult } from "@/lib/custom-ai/types";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { requestMetrics, type ModelCallMetric } from "@/lib/custom-ai/request-metrics";

export const runtime = "nodejs";
export const maxDuration = 480;
const budget = createPreviewBudget();
// Development hot reload must not orphan a draft that is still visible in the
// local preview. Production context always comes from the account-owned store.
const previewGlobal = globalThis as typeof globalThis & { customAIPreviewResults?: Map<string, ChatResult> };
const previewResults = previewGlobal.customAIPreviewResults ?? new Map<string, ChatResult>();
if (process.env.NODE_ENV === "development") previewGlobal.customAIPreviewResults = previewResults;

export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request, true);
    const input = parseChatRequest(await readPreviewBody(request));
    const store = authority.kind === "account" ? productionAIStore() : null;
    const readResult = async (id?: string) => {
      if (!id) return undefined;
      const result = store && authority.kind === "account" ? (await store.read(authority.owner, id))?.result : previewResults.get(id);
      if (!result) throw new CustomAIError("context", "Your saved conversation could not be found. Reload it before continuing.", 409);
      return result;
    };
    const [previous, current] = await Promise.all([readResult(input.contextId), readResult(input.draftId)]);
    const context: AIContext = { owner: authority.kind === "account" ? authority.owner : "local-preview", memory: previous?.memory, ruleSpec: previous?.ruleSpec, draft: current?.draft };
    if (input.draftId && !context.draft) throw new CustomAIError("context", "Your saved contract could not be found. Reload it before continuing.", 409);
    // Known billing/rate-limit outages do not reserve a new user attempt.
    if (!store || authority.kind !== "account" || !await store.read(authority.owner, input.id)) {
      assertModelConnection();
      await providerHealth().assertAvailable();
    }
    const profile = executionProfile(getCapabilities({ owner: context.owner!, chainId: input.coin?.chainId ?? 1,
      allowWeb: researchAvailable(), budget: { remaining: 2 } }));
    const reserved = store && authority.kind === "account" ? await store.reserve(authority.owner, input, profile) : null;
    if (reserved && !reserved.lease) {
      if (reserved.job.state === "completed") return Response.json(reserved.job.result, { headers: aiHeaders });
      if (reserved.job.state === "failed") return aiError(new CustomAIError("interrupted", "The previous attempt ended. Send your message again to retry.", 409), "failed");
      return Response.json(reserved.job, { status: 202, headers: { ...aiHeaders, "Retry-After": "2" } });
    }
    let requestState: "failed" | undefined;
    const execute = async (initialSignal: AbortSignal, onProgress?: (event: ChatProgress) => void) => {
      const startedAt=Date.now(),calls:ModelCallMetric[]=[];let completed=false;
      const cancellation = new AbortController();
      const signal = AbortSignal.any([initialSignal, cancellation.signal]);
      let checking = false;
      const cancelCheck = store && authority.kind === "account" ? setInterval(() => {
        if (checking) return; checking = true;
        void store.read(authority.owner, input.id).then(job => {
          if (job?.errorCode === "cancelled") cancellation.abort();
        }).catch(() => undefined).finally(() => { checking = false; });
      }, 10000) : undefined;
      try {
        const run = () => runCustomAI(input, signal, undefined, { ...context, onProgress,onModelCall:call=>calls.push(call) });
        const result = authority.kind === "preview" ? await budget(input, run) : await run();
        if (store && authority.kind === "account" && reserved?.lease) await store.finish(authority.owner, input.id, reserved.lease, result);
        if (authority.kind === "preview") {
          previewResults.set(input.id, result);
          if (previewResults.size > 128) previewResults.delete(previewResults.keys().next().value!);
        }
        completed=true;return result;
      } catch (error) {
        if (store && authority.kind === "account" && reserved?.lease) {
          const saved = await store.read(authority.owner, input.id).catch(() => null);
          if (saved?.state === "completed" && saved.result) { completed=true;return saved.result; }
          await store.finish(authority.owner, input.id, reserved.lease, undefined, error instanceof CustomAIError ? error.code : "unavailable");
          requestState = "failed";
        } else if (authority.kind === "preview") requestState = "failed";
        throw error;
      } finally {
        if (cancelCheck) clearInterval(cancelCheck);
        if(store&&authority.kind==="account")await store.saveObject(authority.owner,"request-metrics",input.id,requestMetrics(startedAt,calls,completed),0).catch(()=>undefined);
      }
    };
    const workSignal = authority.kind === "account" ? AbortSignal.timeout(420_000) : request.signal;
    if (!request.headers.get("accept")?.includes("text/event-stream")) {
      const task = execute(workSignal);
      after(() => task.then(() => undefined, () => undefined));
      try { return Response.json(await task, { headers: aiHeaders }); }
      catch (error) { return aiError(error, requestState); }
    }
    const abort = new AbortController();
    const signal = authority.kind === "account" ? workSignal : AbortSignal.any([request.signal, abort.signal]);
    let connected = true;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { connected = false; } } };
        const heartbeat = setInterval(() => { if (connected) { try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { connected = false; } } }, 15_000);
        const task = execute(signal, send).then(result => send({ type: "result", result })).catch(error => {
          const known = error instanceof CustomAIError ? error : new CustomAIError("unavailable", "The reply could not finish. Your draft is still saved.", 503);
          send({ type: "error", error: known.message, code: known.code, status: known.status, requestState });
        }).finally(() => { clearInterval(heartbeat); if (connected) { connected = false; controller.close(); } });
        // Keep the server invocation alive after a tab/stream disconnect. Completion is durable before delivery.
        after(() => task);
      },
      cancel() { connected = false; if (authority.kind === "preview") abort.abort(); },
    });
    return new Response(stream, { headers: { ...aiHeaders, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
  } catch (error) { return aiError(error); }
}

export async function GET(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    const id = new URL(request.url).searchParams.get("id");
    const store = productionAIStore();
    const value = id ? await store.read(authority.owner, id) : await store.list(authority.owner);
    if (!value) throw new CustomAIError("missing", "This draft could not be found.", 404);
    return Response.json(value, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
