import "server-only";
import { CustomAIError, type ChatMessage } from "./types";
import { readServerEvents } from "./events";

export const MODELS = { chat: "claude-haiku-5-5", build: "claude-sonnet-5-5", escalation: "claude-opus-5-5" } as const;
export type Model = typeof MODELS[keyof typeof MODELS];
export type ClaudeInput = { model: Model; system: string; messages: ChatMessage[]; schema: object; maxTokens: number; effort?: "low" | "medium" | "high"; signal?: AbortSignal; onText?: (text: string) => void };
export type ClaudeResult = { text: string; inputTokens: number; outputTokens: number };

export async function callClaude(input: ClaudeInput): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new CustomAIError("configuration", "The builder is not connected yet.", 503);
  const timeout = AbortSignal.timeout(60_000);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: input.model, max_tokens: input.maxTokens, system: input.system, stream: Boolean(input.onText),
        messages: input.messages, output_config: { effort: input.effort ?? "medium", format: { type: "json_schema", schema: input.schema } } }),
    });
  } catch {
    throw new CustomAIError("connection", "The reply did not arrive. Your draft is still here; try again shortly.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CustomAIError(`provider_${response.status}`, response.status === 429
      ? "The builder is busy. Give it a moment, then try again."
      : "The builder could not answer just now. Your draft is still here.", 503);
  }
  if (input.onText && response.headers.get("content-type")?.includes("text/event-stream")) {
    let text = "", inputTokens = 0, outputTokens = 0, stopReason: unknown, stopped = false;
    try {
      for await (const event of readServerEvents(response)) {
        signal.throwIfAborted();
        if (event.type === "error") throw new CustomAIError("provider_stream", "The reply was interrupted. Your draft is still saved; try again.", 503);
        if (event.type === "message_start") {
          const message = event.message as { usage?: { input_tokens?: number } } | undefined;
          inputTokens = message?.usage?.input_tokens ?? 0;
        }
        if (event.type === "content_block_start") {
          const block = event.content_block as { type?: string; text?: string } | undefined;
          if (block?.type === "text") text += block.text ?? "";
        }
        if (event.type === "content_block_delta") {
          const delta = event.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === "text_delta") text += delta.text ?? "";
        }
        if (text.length > 48_000) throw new CustomAIError("response", "The reply is too large. Try a smaller change.", 502);
        if (event.type === "content_block_delta" || event.type === "content_block_start") input.onText(text);
        if (event.type === "message_delta") {
          stopReason = (event.delta as { stop_reason?: string } | undefined)?.stop_reason;
          outputTokens = (event.usage as { output_tokens?: number } | undefined)?.output_tokens ?? outputTokens;
        }
        if (event.type === "message_stop") { stopped = true; break; }
      }
    } catch (error) {
      if (error instanceof CustomAIError) throw error;
      throw new CustomAIError("connection", "The reply was interrupted. Your draft is still saved; try again.", 503);
    }
    if (!stopped || stopReason !== "end_turn" || !text) throw new CustomAIError("incomplete", "The answer was cut short. Try a smaller change to your draft.", 502);
    return { text, inputTokens, outputTokens };
  }
  const value = await response.json();
  if (value.stop_reason !== "end_turn" || !Array.isArray(value.content)) {
    throw new CustomAIError("incomplete", "The answer was cut short. Try a smaller change to your draft.", 502);
  }
  const text = value.content.filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text).join("");
  if (!text || text.length > 48_000) throw new CustomAIError("response", "The builder returned an incomplete answer.", 502);
  return { text, inputTokens: value.usage?.input_tokens ?? 0, outputTokens: value.usage?.output_tokens ?? 0 };
}
