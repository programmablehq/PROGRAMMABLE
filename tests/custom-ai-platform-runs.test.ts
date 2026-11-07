import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createRunStore } from "../lib/custom-ai/platform/runs.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { CUSTOM_AI_SCHEMA, createAIStore, type AIPool } from "../lib/custom-ai/store.server";

const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
let db: PGlite, runs: ReturnType<typeof createRunStore>, project: Awaited<ReturnType<ReturnType<typeof createPlatformStore>["createProject"]>>, clock: number;
let pool: AIPool;
const input = (key = "request-one") => ({ ...scope, revisionId: project.revisionId, operation: "build" as const, prompt: "Build the saved project", idempotencyKey: key, budgetUnits: 5 });
beforeEach(async () => {
  clock = Date.UTC(2026, 10, 7);
  db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  pool = { connect: async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } };
  project = await createPlatformStore(pool, () => clock).createProject(scope);
  runs = createRunStore(pool, { allowance: { hourlyUnits: 20, dailyUnits: 40, globalDailyUnits: 80, concurrent: 1 }, leaseMs: 1000,
    capabilities: { read: { units: 1, effect: "read", operations: ["build"] }, write: { units: 2, effect: "write", operations: ["build"] } } }, () => clock);
});
afterEach(async () => { await db.close(); });

describe("durable project runs", () => {
  it("reserves once and returns the same run for an idempotent request", async () => {
    const run = await runs.startRun(input());
    expect(await runs.startRun(input())).toEqual(run);
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(5);
    await expect(runs.startRun({ ...input(), prompt: "Different" })).rejects.toMatchObject({ code: "run-idempotency" });
  });
  it("rolls admission back when the allowance is insufficient", async () => {
    await expect(runs.startRun({ ...input(), budgetUnits: 21 })).rejects.toMatchObject({ code: "budget" });
    expect((await db.query("SELECT id FROM programmable_projects_v1.runs")).rows).toHaveLength(0);
    expect((await db.query("SELECT used FROM programmable_custom_ai_v1.budgets")).rows).toHaveLength(0);
  });
  it("keeps run state private to its owning project", async () => {
    const run = await runs.startRun(input());
    await expect(runs.readRun({ ...scope, ownerId: "bob" }, run.runId)).rejects.toMatchObject({ status: 404 });
    await expect(runs.cancelRun({ ...scope, projectId: "22222222-2222-4222-8222-222222222222" }, run.runId)).rejects.toMatchObject({ status: 404 });
  });
  it("fences expired workers and preserves completed steps across recovery", async () => {
    const run = await runs.startRun(input());
    const first = await runs.claimRun(scope, run.runId, "worker-one");
    expect(first).not.toBeNull();
    await runs.beginStep(scope, run.runId, first!.token, { id: "inspect", capabilityId: "read", input: { file: "app.ts" } });
    await runs.finishStep(scope, run.runId, first!.token, { id: "inspect", result: { content: "source" } });
    clock += 1001;
    const next = await runs.claimRun(scope, run.runId, "worker-two");
    expect(next!.run.cursor).toBe("1");
    expect((await runs.readWork(scope, run.runId, next!.token)).steps[0].result).toEqual({ content: "source" });
    expect(next!.token).not.toBe(first!.token);
    await expect(runs.beginStep(scope, run.runId, first!.token, { id: "old", capabilityId: "read", input: {} })).rejects.toMatchObject({ code: "run-lease" });
    expect((await runs.readRun(scope, run.runId)).cursor).toBe("1");
  });
  it("never executes an unknown write twice after a worker disappears", async () => {
    const run = await runs.startRun(input());
    const first = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    expect((await runs.beginStep(scope, run.runId, first.token, { id: "deploy", capabilityId: "write", input: { version: "one" } })).execute).toBe(true);
    clock += 1001;
    const next = (await runs.claimRun(scope, run.runId, "worker-two"))!;
    expect(await runs.beginStep(scope, run.runId, next.token, { id: "deploy", capabilityId: "write", input: { version: "one" } })).toMatchObject({ execute: false, reconcile: true });
    await expect(runs.finishRun(scope, run.runId, next.token, "done")).rejects.toMatchObject({ code: "run-unresolved" });
  });
  it("cancels without reviving a worker and refunds only unused units", async () => {
    const run = await runs.startRun(input());
    const lease = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    await runs.beginStep(scope, run.runId, lease.token, { id: "read", capabilityId: "read", input: {} });
    expect((await runs.cancelRun(scope, run.runId)).status).toBe("cancelled");
    await expect(runs.finishStep(scope, run.runId, lease.token, { id: "read", result: {} })).rejects.toMatchObject({ code: "run-lease" });
    expect(await runs.claimRun(scope, run.runId, "worker-two")).toBeNull();
    await runs.cancelRun(scope, run.runId);
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(1);
  });
  it("rejects unavailable tools and commits known results only once", async () => {
    const run = await runs.startRun(input());
    const lease = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    await expect(runs.beginStep(scope, run.runId, lease.token, { id: "unknown", capabilityId: "arbitrary-shell", input: {} })).rejects.toMatchObject({ code: "run-capability" });
    await runs.beginStep(scope, run.runId, lease.token, { id: "read", capabilityId: "read", input: {} });
    await runs.finishStep(scope, run.runId, lease.token, { id: "read", result: { found: true } });
    expect(await runs.beginStep(scope, run.runId, lease.token, { id: "read", capabilityId: "read", input: {} })).toMatchObject({ execute: false, result: { found: true } });
    expect((await runs.finishRun(scope, run.runId, lease.token, "done")).status).toBe("succeeded");
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(1);
  });
  it("keeps a live worker lease while its heartbeat succeeds", async () => {
    const run = await runs.startRun(input());
    const lease = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    clock += 750;
    expect(await runs.heartbeat(scope, run.runId, lease.token)).toBe(true);
    clock += 750;
    expect(await runs.claimRun(scope, run.runId, "worker-two")).toBeNull();
    await runs.cancelRun(scope, run.runId);
    expect(await runs.heartbeat(scope, run.runId, lease.token)).toBe(false);
  });
  it("does not advance twice when a completed step receipt is repeated", async () => {
    const run = await runs.startRun(input());
    const lease = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    await runs.beginStep(scope, run.runId, lease.token, { id: "read", capabilityId: "read", input: {} });
    await runs.finishStep(scope, run.runId, lease.token, { id: "read", result: { found: true } });
    expect((await runs.finishStep(scope, run.runId, lease.token, { id: "read", result: { found: true } })).cursor).toBe("1");
    await expect(runs.finishStep(scope, run.runId, lease.token, { id: "read", result: { found: false } })).rejects.toMatchObject({ code: "run-step" });
  });
  it("shares the existing chat allowance instead of granting a second budget", async () => {
    const old = createAIStore(pool, { hourlyUnits: 20, dailyUnits: 40, globalDailyUnits: 80, concurrent: 1 }, () => clock);
    await old.reserve("alice", { id: "00000000-0000-4000-8000-000000000001", intent: "build", messages: [{ role: "user", content: "Build" }] });
    await expect(runs.startRun({ ...input(), budgetUnits: 16 })).rejects.toMatchObject({ code: "budget" });
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(5);
  });
  it("does not resume under a changed capability policy", async () => {
    const run = await runs.startRun(input());
    const different = createRunStore(pool, { allowance: { hourlyUnits: 20, dailyUnits: 40, globalDailyUnits: 80, concurrent: 1 }, leaseMs: 1000,
      capabilities: { read: { units: 2, effect: "read", operations: ["build"] } } }, () => clock);
    await expect(different.claimRun(scope, run.runId, "worker-two")).rejects.toMatchObject({ code: "run-policy" });
  });
  it("records a terminal failure without releasing already consumed work", async () => {
    const run = await runs.startRun(input());
    const lease = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    await runs.beginStep(scope, run.runId, lease.token, { id: "read", capabilityId: "read", input: {} });
    expect((await runs.failRun(scope, run.runId, lease.token, "provider-auth", false)).status).toBe("failed");
    expect(await runs.claimRun(scope, run.runId, "worker-two")).toBeNull();
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(1);
  });
  it("expires an abandoned work unit and releases unused allowance", async () => {
    const run = await runs.startRun(input());
    clock += 600_001;
    expect(await runs.claimRun(scope, run.runId, "worker-one")).toBeNull();
    expect((await runs.readRun(scope, run.runId)).status).toBe("failed");
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(0);
  });
  it("expires abandoned work during admission without requiring a dispatcher", async () => {
    const abandoned = await runs.startRun(input());
    clock += 600_001;
    const next = await runs.startRun(input("next-work"));
    expect(next.runId).not.toBe(abandoned.runId);
    expect((await runs.readRun(scope, abandoned.runId)).status).toBe("failed");
    expect((await db.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='account-day:alice'")).rows[0].used).toBe(5);
  });
  it("resumes retryable work only at the saved cursor and replays committed progress", async () => {
    const run = await runs.startRun(input());
    const first = (await runs.claimRun(scope, run.runId, "worker-one"))!;
    await runs.beginStep(scope, run.runId, first.token, { id: "inspect", capabilityId: "read", input: {} });
    await runs.finishStep(scope, run.runId, first.token, { id: "inspect", result: { found: true } });
    await runs.failRun(scope, run.runId, first.token, "transport", true);
    await expect(runs.resumeRun(scope, run.runId, "0")).rejects.toMatchObject({ code: "run-cursor" });
    expect((await runs.resumeRun(scope, run.runId, "1")).status).toBe("queued");
    const replay = await runs.readProgress(scope, run.runId, "0");
    expect(replay.events).toEqual([{ cursor: "1", stepId: "inspect", capabilityId: "read", state: "completed" }]);
    expect((await runs.readProgress(scope, run.runId, "1")).events).toEqual([]);
    await expect(runs.readProgress({ ...scope, ownerId: "bob" }, run.runId, "0")).rejects.toMatchObject({ status: 404 });
  });
});
