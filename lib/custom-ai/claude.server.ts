import "server-only";
import { CustomAIError, type ChatMessage } from "./types";

export const MODELS = { chat: "claude-haiku-5-5", build: "claude-sonnet-5-5", escalation: "claude-opus-5-5" } as const;
export type Model = typeof MODELS[keyof typeof MODELS];
export type ClaudeInput = { model: Model; system: string; messages: ChatMessage[]; schema: object; maxTokens: number; effort?: "low" | "medium" | "high"; signal?: AbortSignal };
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
      body: JSON.stringify({ model: input.model, max_tokens: input.maxTokens, system: input.system,
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
  const value = await response.json();
  if (value.stop_reason !== "end_turn" || !Array.isArray(value.content)) {
    throw new CustomAIError("incomplete", "The answer was cut short. Try a smaller change to your draft.", 502);
  }
  const text = value.content.filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text).join("");
  if (!text || text.length > 48_000) throw new CustomAIError("response", "The builder returned an incomplete answer.", 502);
  return { text, inputTokens: value.usage?.input_tokens ?? 0, outputTokens: value.usage?.output_tokens ?? 0 };
}
