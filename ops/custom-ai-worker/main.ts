import { normalizeWorkerHealth } from "./health";
import type { AIPool } from "../../lib/custom-ai/store.server";
import { createOperationJournal } from "../../lib/custom-ai/operation-journal.server";
import { runDueJobs, type WorkerAdapter } from "./jobs";
/** Invoked by the existing operator runtime, never by a public request. */
export async function runWorkerOnce(pool: AIPool, adapters: WorkerAdapter[]) {
  if (adapters.some(a => a.dailyLimitWei <= 0n || a.transactionLimitWei <= 0n || a.transactionLimitWei > a.dailyLimitWei || a.allowedTargets.size > 16)) {
    throw Error("Explicit worker budgets and bounded target sets are required");
  }
  const result = await runDueJobs(createOperationJournal(pool), adapters);
  for (const adapter of adapters) {
    const health = normalizeWorkerHealth(await adapter.health?.().catch(() => ({})) ?? {}, Date.now());
    const db = await pool.connect();
    try {
      for (const [kind, observation] of Object.entries(health)) await db.query(
        "INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','operation-health',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()",
        [`chain-${adapter.chainId}-${kind}`, JSON.stringify(observation)]);
    } finally { db.release(); }
  }
  return result;
}
