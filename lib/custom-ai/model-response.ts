import { CustomAIError } from "./types";
import type { ModelCallMetric } from "./request-metrics";

export type ModelResponseProfile = "contract";
export function reportedTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000 ? value : null;
}
export function modelResponseLimits(profile?: ModelResponseProfile) {
  return profile === "contract"
    ? { maximumCharacters: 128_000, timeoutMs: 180_000 }
    : { maximumCharacters: 48_000, timeoutMs: 60_000 };
}

/** Partial declaration diagnostics are explicit, bounded and non-enumerable.
 * Generated source and ordinary chat responses never opt in. */
export class ModelResponseError extends CustomAIError {
  public readonly usage: { inputTokens: number | null; outputTokens: number | null };
  declare readonly partialDeclaration?: string;
  constructor(public failure: NonNullable<ModelCallMetric["failure"]>, usage: {
    inputTokens: number | null; outputTokens: number | null;
  }, partialDeclaration?:string) {
    super("incomplete", failure === "timeout"
      ? "The model reached its time limit. Your complete idea is still saved."
      : failure === "output-limit"
      ? "The answer reached its response limit. Your complete idea is still saved."
      : failure === "invalid-schema"
      ? "The model response did not match the requested format. Your complete idea is still saved."
      : "The answer was cut short. Your draft is still saved.", 502);
    this.usage = { inputTokens: reportedTokenCount(usage.inputTokens), outputTokens: reportedTokenCount(usage.outputTokens) };
    if(partialDeclaration!==undefined)Object.defineProperty(this,"partialDeclaration",{value:partialDeclaration.slice(0,96000),enumerable:false});
  }
}
