import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createArtifactStore } from "../lib/custom-ai/platform/artifacts.server";
import { createArtifactRoutes } from "../lib/custom-ai/platform/artifact-http.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { CustomAIError } from "../lib/custom-ai/types";
import type { AIPool } from "../lib/custom-ai/store.server";

const projectId = "11111111-1111-4111-8111-111111111111";
let db: PGlite, routes: ReturnType<typeof createArtifactRoutes>;
beforeEach(async () => {
  db = new PGlite(); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  const pool: AIPool = { connect: async () => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } };
  await createPlatformStore(pool).createProject({ ownerId: "alice", projectId });
  const store = createArtifactStore(pool, { maxArtifactBytes: 16, maxOwnerBytes: 32, maxProjectBytes: 32, lifetimeSeconds: 60 });
  routes = createArtifactRoutes({ enabled: () => true, store: () => store, maxBodyBytes: 16, consume: async () => undefined,
    authorize: async request => {
      const ownerId = request.headers.get("x-test-owner");
      if (!ownerId) throw new CustomAIError("auth", "Sign in.", 401);
      return { ownerId };
    } });
});
afterEach(async () => { await db.close(); });

describe("authenticated artifact transfer", () => {
  it("uploads and downloads bytes privately for the authenticated owner", async () => {
    const uploaded = await routes.POST(new Request(`https://example.test/artifacts?projectId=${projectId}`, { method: "POST", headers: { "x-test-owner": "alice", "Content-Type": "application/octet-stream" }, body: new Uint8Array([1, 2, 255]) }));
    expect(uploaded.status).toBe(201);
    const { artifact } = await uploaded.json();
    const url = `https://example.test/artifacts?projectId=${projectId}&artifactId=${artifact.id}`;
    const downloaded = await routes.GET(new Request(url, { headers: { "x-test-owner": "alice" } }));
    expect(Array.from(new Uint8Array(await downloaded.arrayBuffer()))).toEqual([1, 2, 255]);
    expect(downloaded.headers.get("Cache-Control")).toBe("private, no-store");
    expect(downloaded.headers.get("Content-Disposition")).toContain("attachment");
    expect((await routes.GET(new Request(url, { headers: { "x-test-owner": "bob" } }))).status).toBe(404);
  });
  it("rejects anonymous writes and oversized bodies", async () => {
    const url = `https://example.test/artifacts?projectId=${projectId}`;
    expect((await routes.POST(new Request(url, { method: "POST", body: "data" }))).status).toBe(401);
    expect((await routes.POST(new Request(url, { method: "POST", headers: { "x-test-owner": "alice" }, body: "x".repeat(17) }))).status).toBe(413);
    expect((await db.query("SELECT id FROM programmable_projects_v1.artifacts")).rows).toHaveLength(0);
  });
});
