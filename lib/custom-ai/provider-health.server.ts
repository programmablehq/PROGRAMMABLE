import "server-only";
import { createHash } from "node:crypto";
import { CustomAIError } from "./types";
import { productionAIStore, type AIStore } from "./store.server";
import type { ProviderFailure } from "./provider-errors";
type Health = { until: number; kind: ProviderFailure["kind"] };
const local = new Map<string, Health>();
export function createProviderHealth(store?: Pick<AIStore, "readObject" | "saveObject">, now = Date.now) {
  const id = createHash("sha256").update(`anthropic:${process.env.ANTHROPIC_API_KEY ?? "unconfigured"}`).digest("hex");
  return {
    async assertAvailable() {
      const health = store ? (await store.readObject<Health>("system", "provider-health", id))?.value : local.get(id);
      if (health && health.until > now()) throw new CustomAIError("provider_cooldown", "The AI provider is temporarily unavailable. Your saved design is unchanged.", 503, health.until - now());
    },
    async fail(failure: ProviderFailure) {
      if (!failure.cooldownMs) return;
      const value = { until: now() + failure.cooldownMs, kind: failure.kind };
      if (!store) { local.set(id, value); return; }
      // Compare-and-swap keeps the longest concurrent cooldown. No upstream retries.
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await store.readObject<Health>("system", "provider-health", id);
        if (previous && previous.value.until >= value.until) return;
        try { await store.saveObject("system", "provider-health", id, value, previous?.revision ?? 0); return; }
        catch (error) { if (!(error instanceof CustomAIError) || error.code !== "conflict" || attempt === 2) throw error; }
      }
    },
  };
}
export function providerHealth() {
  return createProviderHealth(process.env.CUSTOM_AI_DATABASE_URL ? productionAIStore() : undefined);
}
