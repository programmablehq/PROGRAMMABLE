import "server-only";
import type { ClaudeInput, ClaudeResult } from "./claude.server";
import { CustomAIError } from "./types";
import { classifyProviderFailure, providerError } from "./provider-errors";
import { providerHealth } from "./provider-health.server";
import { readServerEvents } from "./events";
import { prepareSurplusSchema } from "./surplus-schema.server";

const endpoint = "https://api.surplusintelligence.ai/v1";
export async function boundedProviderJSON(response: Response, maximum = 512_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new CustomAIError("response", "No AI response arrived.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) throw new CustomAIError("response", "The AI response was too large. Your draft is still saved.", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  }
  catch { throw new CustomAIError("response", "The AI response was incomplete. Your draft is still saved.", 502); }
}

export async function surplusRequest(path: "/chat/completions" | "/responses", body: object, signal?: AbortSignal) {
  const key = process.env.SURPLUS_API_KEY;
  if (!key) throw new CustomAIError("configuration", "The Surplus connection is not configured yet. Your draft is saved.", 503);
  const health = providerHealth("surplus"); await health.assertAvailable();
  let response: Response;
  try {
    response = await fetch(`${endpoint}${path}`, { method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]) });
  } catch {
    throw new CustomAIError("connection", "The AI connection was interrupted. Your draft is still saved.", 503);
  }
  if (!response.ok) {
    const detail = await boundedProviderJSON(response, 16_000).catch(() => ({}));
    const failure = classifyProviderFailure(response.status === 404 ? 503 : response.status, detail, response.headers.get("retry-after"));
    await health.fail(failure); throw providerError(failure);
  }
  return response;
}

export async function rejectEnvelopeError(value: { error?: unknown }) {
  if (!value.error) return;
  const detail = JSON.stringify(value.error);
  const status = /insufficient|balance|credit|payment/i.test(detail) ? 402 : /rate.limit/i.test(detail) ? 429 : 503;
  const failure = classifyProviderFailure(status, detail);
  await providerHealth("surplus").fail(failure); throw providerError(failure);
}

export async function callSurplus(input: ClaudeInput): Promise<ClaudeResult> {
  const format = prepareSurplusSchema(input.schema);
  const response = await surplusRequest("/chat/completions", {
    model: input.model, max_tokens: input.maxTokens, stream: Boolean(input.onText),
    ...(input.onText ? { stream_options: { include_usage: true } } : {}),
    messages: [{ role: "system", content: input.system }, ...input.messages],
    response_format: { type: "json_schema", json_schema: { name: "custom_ai_reply", strict: true, schema: format.schema } },
    reasoning_effort: input.effort ?? "medium",
  }, input.signal);
  let text = "", inputTokens = 0, outputTokens = 0, finish: unknown;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    let done = false;
    try {
      for await (const event of readServerEvents(response, { allowDoneMarker: true })) {
        input.signal?.throwIfAborted();
        if (event.type === "done") { done = true; break; }
        if (event.error) {
          await providerHealth("surplus").fail({ kind: "stream", retryable: true, cooldownMs: 30_000, refundAccount: false });
          throw new CustomAIError("provider_stream", "The reply was interrupted. Your draft is still saved.", 503);
        }
        const usage = event.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        inputTokens = usage?.prompt_tokens ?? inputTokens; outputTokens = usage?.completion_tokens ?? outputTokens;
        const choices = event.choices as { index?: number; delta?: { content?: string; refusal?: string; tool_calls?: unknown }; finish_reason?: string }[] | undefined;
        const choice = choices?.find(item => item.index === 0) ?? choices?.[0];
        if (choice?.delta?.refusal || choice?.delta?.tool_calls) throw new CustomAIError("response", "The requested design needs clarification. Your draft is saved.", 502);
        if (typeof choice?.delta?.content === "string") text += choice.delta.content;
        if (text.length > 48_000) throw new CustomAIError("response", "The reply is too large. Try a smaller change.", 502);
        if (choice?.finish_reason) finish = choice.finish_reason;
        input.onText?.(text);
      }
    } catch (error) {
      if (error instanceof CustomAIError) throw error;
      throw new CustomAIError("connection", "The reply was interrupted. Your draft is still saved.", 503);
    }
    if (!done) throw new CustomAIError("incomplete", "The answer was cut short. Your draft is still saved.", 502);
  } else {
    const value = await boundedProviderJSON(response); await rejectEnvelopeError(value);
    const choice = value.choices?.[0]; finish = choice?.finish_reason;
    text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (choice?.message?.refusal || choice?.message?.tool_calls) text = "";
    inputTokens = value.usage?.prompt_tokens ?? 0; outputTokens = value.usage?.completion_tokens ?? 0;
  }
  if (finish !== "stop" || !text || text.length > 48_000) throw new CustomAIError("incomplete", "The answer was cut short. Your draft is still saved.", 502);
  return { text: format.decode(text), inputTokens, outputTokens };
}
