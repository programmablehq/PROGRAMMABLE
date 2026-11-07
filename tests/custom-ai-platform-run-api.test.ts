import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createRunStore } from "../lib/custom-ai/platform/runs.server";
import { createRunRoutes, createWorkerRoutes } from "../lib/custom-ai/platform/run-http.server";
import { issueWorkerGrant, verifyWorkerGrant } from "../lib/custom-ai/platform/worker-auth.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";
import { CustomAIError } from "../lib/custom-ai/types";

const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
const keys = generateKeyPairSync("ed25519");
let db: PGlite, store: ReturnType<typeof createRunStore>, routes: ReturnType<typeof createRunRoutes>, worker: ReturnType<typeof createWorkerRoutes>, revisionId: string;
beforeEach(async () => {
  db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  const pool: AIPool = { connect: async () => {
    const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } };
  revisionId = (await createPlatformStore(pool).createProject(scope)).revisionId;
  store = createRunStore(pool, { allowance: { hourlyUnits: 25, dailyUnits: 100, globalDailyUnits: 200, concurrent: 1 }, leaseMs: 60_000,
    capabilities: { read: { units: 1, effect: "read", operations: ["build"] } } });
  routes = createRunRoutes({ enabled: () => true, store: () => store, consume: async () => undefined, onQueued: async () => { throw new Error("Worker temporarily unavailable"); },
    authorize: async request => {
      const ownerId = request.headers.get("x-test-owner"); if (!ownerId) throw new CustomAIError("auth", "Sign in", 401); return { ownerId };
    } });
  worker = createWorkerRoutes({ enabled: () => true, store: () => store,
    authorize: async request => verifyWorkerGrant((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""), keys.publicKey) });
});
afterEach(async () => { await db.close(); });
const start = () => routes.POST(new Request("https://example.test/runs", { method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": "alice" },
  body: JSON.stringify({ projectId: scope.projectId, revisionId, operation: "build", prompt: "Build the project", idempotencyKey: "work-one", budgetUnits: 5 }) }));

describe("project run API boundaries", () => {
  it("recovers the saved transcript without a browser-held run identifier and isolates its owner", async () => {
    const { run } = await (await start()).json();
    const url = `https://example.test/runs?projectId=${scope.projectId}`;
    const response = await routes.GET(new Request(url, { headers: { "x-test-owner": "alice" } }));
    expect(response.status).toBe(200);
    const { runs } = await response.json();
    expect(runs).toMatchObject([{ runId: run.runId, prompt: "Build the project", operation: "build", status: "queued" }]);
    expect(JSON.stringify(runs)).not.toContain('lease_token');
    expect((await routes.GET(new Request(url, { headers: { "x-test-owner": "bob" } }))).status).toBe(404);
  });
  it("durably queues a run even when waking the worker fails", async () => {
    const response = await start(); expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.run.status).toBe("queued");
    expect(payload).not.toHaveProperty("grant"); expect(payload.run).not.toHaveProperty("lease_token");
    expect((await db.query("SELECT run_id FROM programmable_projects_v1.dispatch_outbox")).rows).toHaveLength(1);
    expect((await (await start()).json()).run.runId).toBe(payload.run.runId);
  });
  it("protects status and cancellation from another account", async () => {
    const { run } = await (await start()).json();
    const url = `https://example.test/runs?projectId=${scope.projectId}&runId=${run.runId}`;
    expect((await routes.GET(new Request(url, { headers: { "x-test-owner": "bob" } }))).status).toBe(404);
    expect((await routes.DELETE(new Request(url, { method: "DELETE", headers: { "x-test-owner": "bob" } }))).status).toBe(404);
    expect((await store.readRun(scope, run.runId)).status).toBe("queued");
  });
  it("requires a signed scoped worker grant and ignores client ownership claims", async () => {
    const { run } = await (await start()).json();
    const token = issueWorkerGrant({ ...scope, runId: run.runId, workerId: "worker-one" }, keys.privateKey);
    const call = (body: unknown, grant = token) => worker.POST(new Request("https://example.test/worker", { method: "POST", headers: { Authorization: `Bearer ${grant}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect((await call({ action: "claim" }, "invalid")).status).toBe(403);
    expect((await call({ action: "claim", ownerId: "bob" })).status).toBe(400);
    const claimed = await call({ action: "claim" }); expect(claimed.status).toBe(200);
    expect((await claimed.json()).lease.run.ownerId).toBe("alice");
    expect((await call({ action: "broadcast" })).status).toBe(400);
  });
});
