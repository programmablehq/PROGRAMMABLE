import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createRunStore } from "../lib/custom-ai/platform/runs.server";
import { createDispatchService } from "../lib/custom-ai/platform/dispatch.server";
import { verifyWorkerGrant } from "../lib/custom-ai/platform/worker-auth.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";

const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
const keys = generateKeyPairSync("ed25519");
let db: PGlite, pool: AIPool, runs: ReturnType<typeof createRunStore>, runId: string, clock: number;
beforeEach(async () => {
  clock = Date.UTC(2026, 10, 7); db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  pool = { connect: async () => { const before = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await before;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release }; } };
  const project = await createPlatformStore(pool).createProject(scope);
  runs = createRunStore(pool, { allowance: { hourlyUnits: 25, dailyUnits: 100, globalDailyUnits: 200, concurrent: 1 }, leaseMs: 60_000, capabilities: {} }, () => clock);
  runId = (await runs.startRun({ ...scope, revisionId: project.revisionId, operation: "plan", prompt: "Plan the project", budgetUnits: 5, idempotencyKey: "start" })).runId;
});
afterEach(async () => { await db.close(); });

describe("durable worker dispatch", () => {
  it("retains a failed wakeup and retries with a scoped grant", async () => {
    let offline = true;
    const service = createDispatchService(pool, runs, { signingKey: keys.privateKey, now: () => clock, sendGrant: async token => {
      const claim = verifyWorkerGrant(token, keys.publicKey, clock);
      expect(claim.ownerId).toBe("alice"); expect(claim.projectId).toBe(scope.projectId); expect(claim.runId).toBe(runId);
      if (offline) throw new Error("Offline");
      await runs.claimRun(scope, runId, claim.workerId);
    } });
    expect((await service.dispatchPending()).accepted).toBe(0);
    expect((await runs.readRun(scope, runId)).status).toBe("queued");
    expect((await db.query("SELECT run_id FROM programmable_projects_v1.dispatch_outbox")).rows).toHaveLength(1);
    offline = false; clock += 31_000;
    expect((await service.dispatchPending()).accepted).toBe(1);
    expect((await runs.readRun(scope, runId)).status).toBe("running");
  });
  it("reserves a pending dispatch once across concurrent dispatchers", async () => {
    let sent = 0;
    const service = createDispatchService(pool, runs, { signingKey: keys.privateKey, now: () => clock, sendGrant: async () => { sent++; } });
    const results = await Promise.all([service.dispatchPending(), service.dispatchPending()]);
    expect(results.reduce((sum, result) => sum + result.accepted, 0)).toBe(1); expect(sent).toBe(1);
  });
  it("expires obsolete queued work without invoking a worker", async () => {
    clock += 600_001;
    let sent = 0;
    const service = createDispatchService(pool, runs, { signingKey: keys.privateKey, now: () => clock, sendGrant: async () => { sent++; } });
    await service.dispatchPending();
    expect(sent).toBe(0); expect((await runs.readRun(scope, runId)).status).toBe("failed");
    expect((await db.query("SELECT run_id FROM programmable_projects_v1.dispatch_outbox")).rows).toHaveLength(0);
  });
});
