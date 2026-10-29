import { CustomAIError } from "./types";
export type ProviderFailureKind = "billing" | "authentication" | "rate_limit" | "overloaded" | "request" | "connection" | "stream";
export type ProviderFailure = { kind: ProviderFailureKind; retryable: boolean; cooldownMs: number; refundAccount: boolean };
export function classifyProviderFailure(status: number, body: unknown, retryAfter: string | null = null): ProviderFailure {
  const message = typeof body === "string" ? body.slice(0, 8192) : JSON.stringify(body ?? {}).slice(0, 8192);
  const wait = Math.min(3_600_000, Math.max(1000, Number(retryAfter) * 1000 || Date.parse(retryAfter ?? "") - Date.now() || 60_000));
  if (status === 402 || [400, 429].includes(status) && /credit|billing|balance|payment|insufficient funds|spend.{0,30}(?:limit|cap)/i.test(message)) return { kind: "billing", retryable: false, cooldownMs: 600_000, refundAccount: true };
  if ([401, 403].includes(status)) return { kind: "authentication", retryable: false, cooldownMs: 600_000, refundAccount: true };
  if (status === 429) return { kind: "rate_limit", retryable: true, cooldownMs: wait, refundAccount: true };
  if (status >= 500) return { kind: "overloaded", retryable: true, cooldownMs: Math.max(15_000, wait), refundAccount: true };
  return { kind: "request", retryable: false, cooldownMs: 0, refundAccount: false };
}
export function providerError(failure: ProviderFailure): CustomAIError {
  const message = failure.kind === "billing" || failure.kind === "authentication"
    ? "The AI provider is temporarily unavailable. Your design is saved and this attempt will not use your generation allowance."
    : "The AI provider is busy. Your design is saved; try again shortly.";
  return new CustomAIError(`provider_${failure.kind}`, message, 503, failure.cooldownMs);
}
export function refundsProviderFailure(code?: string) {
  return ["provider_billing", "provider_authentication", "provider_rate_limit", "provider_overloaded", "provider_cooldown"].includes(code ?? "");
}
