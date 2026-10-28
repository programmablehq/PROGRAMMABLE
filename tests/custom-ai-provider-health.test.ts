import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { classifyProviderFailure, refundsProviderFailure } from "../lib/custom-ai/provider-errors";
import { createProviderHealth } from "../lib/custom-ai/provider-health.server";
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", `fixture-${Math.random()}`));
describe("provider failure boundaries", () => {
  it("distinguishes funding/authentication from overload without exposing upstream text", () => {
    expect(classifyProviderFailure(400, { error: { message: "Your credit balance is too low" } })).toMatchObject({ kind: "billing", retryable: false });
    expect(classifyProviderFailure(401, "secret").kind).toBe("authentication");
    expect(classifyProviderFailure(429, "", "120")).toMatchObject({ kind: "rate_limit", cooldownMs: 120000 });
    expect(classifyProviderFailure(529, "").kind).toBe("overloaded");
    expect(refundsProviderFailure("provider_stream")).toBe(false);
  });
  it("blocks known outages until the cooldown ends without retrying the provider", async () => {
    let now = 1000;
    const health = createProviderHealth(undefined, () => now);
    await health.fail(classifyProviderFailure(402, ""));
    await expect(health.assertAvailable()).rejects.toMatchObject({ code: "provider_cooldown" });
    now += 600001;
    await expect(health.assertAvailable()).resolves.toBeUndefined();
  });
});
