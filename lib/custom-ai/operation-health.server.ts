import "server-only";
import type { AIStore } from "./store.server";
export type OperationalSnapshot = { status: "ready" | "blocked"; checkedAt: number; validUntil: number; blockers: string[] };
export async function readOperationalSnapshot(store: AIStore, chainId: number, requirements: string[], now = Date.now()): Promise<OperationalSnapshot> {
  const observations = await Promise.all(requirements.map(id => store.readObject<OperationalSnapshot>("system", "operation-health", `chain-${chainId}-${id}`)));
  const blockers = requirements.filter((_, index) => { const value = observations[index]?.value;
    return !value || value.status !== "ready" || value.checkedAt > now || value.validUntil <= now; });
  return { status: blockers.length ? "blocked" : "ready", checkedAt: now,
    validUntil: blockers.length ? now : Math.min(...observations.map(o => o!.value.validUntil)), blockers };
}
