import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createArtifactStore } from "../lib/custom-ai/platform/artifacts.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { AIPool } from "../lib/custom-ai/store.server";

const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
let db: PGlite, store: ReturnType<typeof createArtifactStore>, projects: ReturnType<typeof createPlatformStore>, clock: number;
beforeEach(async () => {
  clock = Date.UTC(2026, 10, 7);
  db = new PGlite(); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  const pool: AIPool = { connect: async () => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } };
  projects = createPlatformStore(pool, () => clock);
  await projects.createProject(scope);
  store = createArtifactStore(pool, { maxArtifactBytes: 16, maxOwnerBytes: 20, maxProjectBytes: 20, lifetimeSeconds: 60 }, () => clock);
});
afterEach(async () => { await db.close(); });

describe("private bounded project artifacts", () => {
  it("rejects recognizable credentials before saving an artifact",async()=>{
    const connect=vi.fn(),privateStore=createArtifactStore({connect} as unknown as AIPool);
    await expect(privateStore.saveArtifact(scope,{bytes:Buffer.from(`github_pat_${"fixture".repeat(8)}`),mediaType:"text/plain"})).rejects.toMatchObject({code:"project-secret"});
    expect(connect).not.toHaveBeenCalled();
  });
  it("round-trips exact binary bytes for the owning project", async () => {
    const artifact = await store.saveArtifact(scope, { bytes: new Uint8Array([0, 1, 255]), mediaType: "application/octet-stream" });
    const read = await store.readArtifact(scope, artifact.id);
    expect(Array.from(read.bytes)).toEqual([0, 1, 255]);
    expect(read.id).toBe(artifact.id);
    expect(read.size).toBe(3);
  });
  it("does not expose an artifact to another owner or project", async () => {
    const artifact = await store.saveArtifact(scope, { bytes: new Uint8Array([1]), mediaType: "text/plain" });
    await expect(store.readArtifact({ ...scope, ownerId: "bob" }, artifact.id)).rejects.toMatchObject({ status: 404 });
    await expect(store.readArtifact({ ...scope, projectId: "22222222-2222-4222-8222-222222222222" }, artifact.id)).rejects.toMatchObject({ status: 404 });
  });
  it("deduplicates retries without consuming the storage budget twice", async () => {
    const input = { bytes: new Uint8Array(15).fill(1), mediaType: "text/plain" };
    const first = await store.saveArtifact(scope, input);
    expect(await store.saveArtifact(scope, input)).toEqual(first);
    await expect(store.saveArtifact(scope, { bytes: new Uint8Array(6).fill(2), mediaType: "text/plain" })).rejects.toMatchObject({ code: "project-artifact-budget" });
    expect((await db.query("SELECT id FROM programmable_projects_v1.artifacts")).rows).toHaveLength(1);
  });
  it("enforces one owner's total budget across simultaneous projects", async () => {
    const second = { ...scope, projectId: "22222222-2222-4222-8222-222222222222" };
    await projects.createProject(second);
    const outcomes = await Promise.allSettled([scope, second].map((value, index) => store.saveArtifact(value, { bytes: new Uint8Array(12).fill(index), mediaType: "text/plain" })));
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
  });
  it("expires old content and removes expired rows during the next write", async () => {
    const old = await store.saveArtifact(scope, { bytes: new Uint8Array(15), mediaType: "text/plain" });
    clock += 61_000;
    await expect(store.readArtifact(scope, old.id)).rejects.toMatchObject({ status: 404 });
    await store.saveArtifact(scope, { bytes: new Uint8Array(15).fill(1), mediaType: "text/plain" });
    expect((await db.query("SELECT id FROM programmable_projects_v1.artifacts")).rows).toHaveLength(1);
  });
  it("rejects oversized content and unsafe media types", async () => {
    await expect(store.saveArtifact(scope, { bytes: new Uint8Array(17), mediaType: "text/plain" })).rejects.toMatchObject({ status: 413 });
    await expect(store.saveArtifact(scope, { bytes: new Uint8Array(1), mediaType: "text/plain\r\nInjected: true" })).rejects.toMatchObject({ code: "project-input" });
  });
  it("preserves millisecond precision in persisted expiry timestamps", async () => {
    clock += 123;
    const artifact = await store.saveArtifact(scope, { bytes: new Uint8Array([1]), mediaType: "text/plain" });
    expect((await store.readArtifact(scope, artifact.id)).expiresAt).toBe(new Date(clock + 60_000).toISOString());
  });
});
