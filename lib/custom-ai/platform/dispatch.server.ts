import "server-only";
import { randomUUID, type KeyObject } from "node:crypto";
import type { AIPool } from "../store.server";
import type { createRunStore } from "./runs.server";
import type { ProjectScope } from "./types";
import { validateScope } from "./document";
import { issueWorkerGrant } from "./worker-auth.server";
import { projectDate } from "./time";

type DispatchItem = ProjectScope & { runId: string; attempts: number; reservedUntil: string };
type Options = { signingKey: KeyObject | string; sendGrant: (token: string, runId: string) => Promise<void>; now?: () => number };

/** Server-only dispatcher. The outbox contains routing metadata, never source
 * or credentials; clients cannot enumerate or claim it. */
export function createDispatchService(pool: AIPool, runs: ReturnType<typeof createRunStore>, options: Options) {
  const now = options.now ?? Date.now;
  async function take(limit: number, selected?: ProjectScope & { runId: string }): Promise<DispatchItem[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new TypeError("Invalid dispatch limit");
    if (selected) validateScope(selected);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const where = selected ? "AND owner=$4 AND project_id=$5 AND run_id=$6" : "";
      const rows = (await db.query(`WITH due AS (
        SELECT owner,project_id,run_id FROM programmable_projects_v1.dispatch_outbox WHERE next_attempt_at<=$1 ${where}
        ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED)
        UPDATE programmable_projects_v1.dispatch_outbox q SET attempts=q.attempts+1,next_attempt_at=$2
        FROM due WHERE q.owner=due.owner AND q.project_id=due.project_id AND q.run_id=due.run_id
        RETURNING q.owner,q.project_id,q.run_id,q.attempts,q.next_attempt_at`,
        [new Date(now()).toISOString(), new Date(now() + 30_000).toISOString(), limit,
          ...(selected ? [selected.ownerId, selected.projectId, selected.runId] : [])])).rows;
      await db.query("COMMIT");
      return rows.map(row => ({ ownerId: String(row.owner), projectId: String(row.project_id), runId: String(row.run_id),
        attempts: Number(row.attempts), reservedUntil: projectDate(row.next_attempt_at).toISOString() }));
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { db.release(); }
  }
  async function process(items: DispatchItem[]) {
    let accepted = 0, failed = 0;
    for (const item of items) {
      try {
        const run = await runs.readRun(item, item.runId);
        if (now() - projectDate(run.createdAt).getTime() > 600_000) {
          await runs.claimRun(item, item.runId, "dispatch-expiry");
          continue;
        }
        if (!["queued", "running", "retryable"].includes(run.status)) continue;
        const token = issueWorkerGrant({ ownerId: item.ownerId, projectId: item.projectId, runId: item.runId, workerId: `worker-${randomUUID()}` }, options.signingKey, now());
        await options.sendGrant(token, item.runId);
        accepted++;
      } catch {
        failed++;
        const db = await pool.connect();
        try {
          await db.query(`UPDATE programmable_projects_v1.dispatch_outbox SET next_attempt_at=$4
            WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND next_attempt_at=$5 AND attempts=$6`,
            [item.ownerId, item.projectId, item.runId, new Date(now() + Math.min(60_000, 5000 * 2 ** Math.min(item.attempts - 1, 4))).toISOString(), item.reservedUntil, item.attempts]);
        } finally { db.release(); }
      }
    }
    return { accepted, failed };
  }
  return {
    dispatchPending: async (limit = 20) => process(await take(limit)),
    dispatchOne: async (scope: ProjectScope, runId: string) => process(await take(1, { ...scope, runId })),
  };
}
