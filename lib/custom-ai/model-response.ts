import { CustomAIError } from "./types";
import type { ModelCallMetric } from "./request-metrics";

export type ModelResponseProfile = "contract";
export function modelResponseLimits(profile?: ModelResponseProfile) {
  return profile === "contract"
    ? { maximumCharacters: 128_000, timeoutMs: 120_000 }
    : { maximumCharacters: 48_000, timeoutMs: 60_000 };
}

/** Keep only bounded diagnostics, never the prompt or partial generated code. */
export class ModelResponseError extends CustomAIError {
  public readonly usage: { inputTokens: number | null; outputTokens: number | null };
  constructor(public failure: NonNullable<ModelCallMetric["failure"]>, usage: {
    inputTokens: number | null; outputTokens: number | null;
  }) {
    super("incomplete", failure === "output-limit"
      ? "The answer reached its response limit. Your complete idea is still saved."
      : "The answer was cut short. Your draft is still saved.", 502);
    const count = (value: number | null) => Number.isSafeInteger(value) && value! >= 0 && value! <= 2_000_000 ? value : null;
    this.usage = { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens) };
  }
}
