import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createSandboxExecutor, type SandboxProvider } from "../lib/custom-ai/platform/sandbox-executor.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { AIPool } from "../lib/custom-ai/store.server";

let db: PGlite, pool: AIPool, store: ReturnType<typeof createPlatformStore>;
const alice = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
beforeEach(async () => {
  db = new PGlite(); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  pool = { connect: async () => { const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release }; } };
  store = createPlatformStore(pool);
});
afterEach(async () => { await db.close(); });
const provider = () => ({ create: vi.fn(async () => ({
  writeFiles: vi.fn(async () => undefined), install: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false })),
  execute: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "", truncated: false })),
  readFile: vi.fn(async () => Buffer.from("output")), close: vi.fn(async () => undefined),
})), cleanup: vi.fn(async () => undefined) }) satisfies SandboxProvider;

describe("isolated revision execution", () => {
  it("reports provider failure metadata without logging credentials or request bodies", async () => {
    const revision = await store.createProject(alice), driver = provider();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Authorization: Bearer private-token; source=private-source"), { name: "APIError", status: 403, code: "forbidden", request: { authorization: "private-token" } });
    driver.create.mockRejectedValueOnce(error);
    try {
      await expect(createSandboxExecutor(pool, store, driver).execute({ ...alice, revisionId: revision.revisionId, script: "true", outputPaths: [] })).rejects.toMatchObject({ code: "sandbox-provider" });
      expect(warning).toHaveBeenCalledWith("Project sandbox provider failure", expect.objectContaining({ stage: "create", name: "APIError", status: 403, code: "forbidden" }));
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/private-token|private-source|Authorization/);
    } finally { warning.mockRestore(); }
  });
  it("materializes only the owned revision with fixed resource and egress limits", async () => {
    const initial = await store.createProject(alice);
    const revision = await store.applyProjectPatch({ ...alice, expectedRevisionId: initial.revisionId, idempotencyKey: "files", patch: { files: { "app.js": "console.log('ok')" } } });
    const driver = provider(), sandbox = createSandboxExecutor(pool, store, driver);
    const result = await sandbox.execute({ ...alice, revisionId: revision.revisionId, script: "node app.js", outputPaths: [] });
    expect(result.exitCode).toBe(0); expect(result.revisionId).toBe(revision.revisionId);
    expect(driver.create).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 240_000, vcpus: 1, network: "deny-all" }), expect.any(AbortSignal));
    const instance = await driver.create.mock.results[0].value;
    expect(instance.writeFiles).toHaveBeenCalledWith({ "app.js": "console.log('ok')" }, expect.any(AbortSignal));
    expect(instance.close).toHaveBeenCalledOnce();
    expect((await db.query("SELECT id FROM programmable_projects_v1.sandbox_slots")).rows).toHaveLength(0);
    expect((await db.query<{ state: string }>("SELECT state FROM programmable_projects_v1.sandbox_jobs")).rows[0].state).toBe("cleaned");
  });
  it("rejects cross-owner access and invalid artifact paths before creating resources", async () => {
    const revision = await store.createProject(alice), driver = provider(), sandbox = createSandboxExecutor(pool, store, driver);
    await expect(sandbox.execute({ ...alice, ownerId: "bob", revisionId: revision.revisionId, script: "pwd", outputPaths: [] })).rejects.toMatchObject({ status: 404 });
    await expect(sandbox.execute({ ...alice, revisionId: revision.revisionId, script: "pwd", outputPaths: ["../../secret"] })).rejects.toMatchObject({ code: "project-input" });
    expect(driver.create).not.toHaveBeenCalled();
  });
  it("requires a pinned registry lock before dependency installation", async () => {
    const initial = await store.createProject(alice), driver = provider(), sandbox = createSandboxExecutor(pool, store, driver);
    const revision = await store.applyProjectPatch({ ...alice, expectedRevisionId: initial.revisionId, idempotencyKey: "files", patch: { files: { "package.json": '{"dependencies":{"x":"1.0.0"}}' } } });
    await expect(sandbox.execute({ ...alice, revisionId: revision.revisionId, script: "npm test", outputPaths: [] })).rejects.toMatchObject({ code: "sandbox-lock" });
    expect(driver.create).not.toHaveBeenCalled();
  });
  it("keeps a cleanup reservation when the provider cannot confirm destruction", async () => {
    const revision = await store.createProject(alice), driver = provider();
    driver.create.mockImplementationOnce(async () => { throw new Error("uncertain create"); });
    driver.cleanup.mockRejectedValueOnce(new Error("provider unavailable"));
    const sandbox = createSandboxExecutor(pool, store, driver);
    await expect(sandbox.execute({ ...alice, revisionId: revision.revisionId, script: "true", outputPaths: [] })).rejects.toMatchObject({ code: "sandbox-provider" });
    expect((await db.query("SELECT id FROM programmable_projects_v1.sandbox_slots")).rows).toHaveLength(1);
    expect((await db.query<{ state: string }>("SELECT state FROM programmable_projects_v1.sandbox_jobs")).rows[0].state).toBe("cleanup_pending");
    await expect(sandbox.execute({ ...alice, revisionId: revision.revisionId, script: "true", outputPaths: [] })).rejects.toMatchObject({ code: "sandbox-busy" });
  });
  it("never converts a failed command into verification success", async () => {
    const revision = await store.createProject(alice), driver = provider();
    const instance = await driver.create(); instance.execute.mockResolvedValue({ exitCode: 7, stdout: "", stderr: "assertion failed", truncated: false });
    driver.create.mockResolvedValue(instance);
    const result = await createSandboxExecutor(pool, store, driver).execute({ ...alice, revisionId: revision.revisionId, script: "exit 7", outputPaths: [] });
    expect(result.exitCode).toBe(7); expect(instance.close).toHaveBeenCalledOnce();
  });
});
