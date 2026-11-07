import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { createProjectRoutes } from "../lib/custom-ai/platform/http.server";
import { CustomAIError } from "../lib/custom-ai/types";

const id = "11111111-1111-4111-8111-111111111111";
let db: PGlite, store: ReturnType<typeof createPlatformStore>, routes: ReturnType<typeof createProjectRoutes>;
const request = (method: string, owner?: string, body?: unknown, query = "") => new Request(`https://example.test/api/custom-ai/platform/projects${query}`, {
  method, headers: { "Content-Type": "application/json", ...(owner ? { "x-test-owner": owner } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeEach(async () => {
  db = new PGlite();
  await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  store = createPlatformStore({ connect: async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return { query: async (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } });
  routes = createProjectRoutes({ enabled: () => true, store: () => store, consume: async () => undefined,
    authorize: async input => {
      const ownerId = input.headers.get("x-test-owner");
      if (!ownerId) throw new CustomAIError("auth", "Sign in.", 401);
      return { ownerId };
    } });
});
afterEach(async () => { await db.close(); });

describe("project platform authenticated routes", () => {
  it("requires a verified account before creating a project", async () => {
    expect((await routes.POST(request("POST", undefined, { projectId: id }))).status).toBe(401);
    expect(await store.listProjects("alice")).toEqual([]);
  });
  it("derives ownership from authentication and rejects a supplied owner", async () => {
    expect((await routes.POST(request("POST", "alice", { projectId: id, ownerId: "bob" }))).status).toBe(400);
    const created = await routes.POST(request("POST", "alice", { projectId: id }));
    expect(created.status).toBe(201);
    expect((await created.json()).project.ownerId).toBe("alice");
    expect(await store.listProjects("bob")).toEqual([]);
  });
  it("does not expose a project to another account", async () => {
    await store.createProject({ ownerId: "alice", projectId: id });
    expect((await routes.GET(request("GET", "bob", undefined, `?projectId=${id}`))).status).toBe(404);
    expect((await (await routes.GET(request("GET", "bob"))).json()).projects).toEqual([]);
  });
  it("updates the exact revision and reports a stale write as a conflict", async () => {
    const initial = await store.createProject({ ownerId: "alice", projectId: id });
    const body = { projectId: id, expectedRevisionId: initial.revisionId, idempotencyKey: "edit-one", patch: { title: "Game" } };
    const updated = await routes.PATCH(request("PATCH", "alice", body));
    expect(updated.status).toBe(200);
    expect((await updated.json()).project.document.title).toBe("Game");
    expect((await routes.PATCH(request("PATCH", "alice", { ...body, idempotencyKey: "edit-two", patch: { title: "Stale" } }))).status).toBe(409);
    expect((await store.readProject({ ownerId: "alice", projectId: id })).document.title).toBe("Game");
  });
  it("does not allow clients to assign verified or deployed state", async () => {
    const initial = await store.createProject({ ownerId: "alice", projectId: id });
    expect((await routes.PATCH(request("PATCH", "alice", { projectId: id, expectedRevisionId: initial.revisionId, idempotencyKey: "forged-status", patch: { verified: true } }))).status).toBe(400);
    expect((await store.readProject({ ownerId: "alice", projectId: id })).revisionId).toBe(initial.revisionId);
  });
  it("keeps the surface unavailable until its rollout is enabled", async () => {
    const disabled = createProjectRoutes({ enabled: () => false, store: () => store, consume: async () => undefined, authorize: async () => ({ ownerId: "alice" }) });
    expect((await disabled.POST(request("POST", "alice", { projectId: id }))).status).toBe(404);
    expect(await store.listProjects("alice")).toEqual([]);
  });
});
