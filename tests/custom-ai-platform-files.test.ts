import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { exportProjectBundle, readProjectBundle } from "../lib/custom-ai/platform/transfer";

const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
let db: PGlite, store: ReturnType<typeof createPlatformStore>;
beforeEach(async () => {
  db = new PGlite(); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  store = createPlatformStore({ connect: async () => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } });
});
afterEach(async () => { await db.close(); });

describe("complete project file changes", () => {
  it("changes one file while preserving every other file", async () => {
    const first = await store.createProject(scope);
    const source = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "source", patch: { files: { "src/app.ts": "old", "src/api.ts": "preserved" } } });
    const next = await store.applyProjectPatch({ ...scope, expectedRevisionId: source.revisionId, idempotencyKey: "edit", patch: {
      fileChanges: [{ operation: "write", path: "src/app.ts", beforeHash: hash("old"), content: "new" }],
    } });
    expect(next.document.files).toEqual({ "src/app.ts": "new", "src/api.ts": "preserved" });
  });
  it("rejects an incorrect source hash without modifying any file", async () => {
    const first = await store.createProject(scope);
    const source = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "source", patch: { files: { "app.ts": "old" } } });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: source.revisionId, idempotencyKey: "wrong-source", patch: {
      fileChanges: [{ operation: "write", path: "app.ts", beforeHash: hash("different"), content: "new" }],
    } })).rejects.toMatchObject({ code: "project-file-conflict", status: 409 });
    expect(await store.readProject(scope)).toEqual(source);
  });
  it("requires explicit deletion and rejects conflicting operations on one path", async () => {
    const first = await store.createProject(scope);
    const source = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "source", patch: { files: { "app.ts": "app", "api.ts": "api" } } });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: source.revisionId, idempotencyKey: "truncate", patch: { files: { "app.ts": "app" } } })).rejects.toMatchObject({ code: "project-file-removal" });
    const next = await store.applyProjectPatch({ ...scope, expectedRevisionId: source.revisionId, idempotencyKey: "delete", patch: {
      fileChanges: [{ operation: "delete", path: "api.ts", beforeHash: hash("api") }],
    } });
    expect(next.document.files).toEqual({ "app.ts": "app" });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: next.revisionId, idempotencyKey: "ambiguous", patch: {
      fileChanges: [
        { operation: "write", path: "new.ts", beforeHash: null, content: "one" },
        { operation: "write", path: "new.ts", beforeHash: null, content: "two" },
      ],
    } })).rejects.toMatchObject({ code: "project-input" });
  });
  it.each(["../outside.ts", "/outside.ts", "src\\outside.ts", ".git/config", ".GIT/config", ".env", "src/.env.production", "src/line\nbreak.ts"])("rejects unsafe or secret file path %s", async path => {
    const first = await store.createProject(scope);
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "unsafe", patch: { files: { [path]: "secret" } } })).rejects.toMatchObject({ code: "project-input" });
  });
  it("preserves binary assets in a complete export and rejects a tampered bundle", async () => {
    const first = await store.createProject(scope);
    const binary = { encoding: "base64" as const, mediaType: "image/png", content: "AAECAw==" };
    const source = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "asset", patch: { files: { "src/app.ts": "code", "public/pixel.png": binary } } });
    const bundle = exportProjectBundle(source);
    expect(readProjectBundle(bundle).files).toEqual({ "src/app.ts": "code", "public/pixel.png": binary });
    expect(JSON.stringify(bundle)).not.toContain('"ownerId"');
    expect(() => readProjectBundle({ ...bundle, document: { ...bundle.document, title: "Tampered" } })).toThrow();
  });
  it("creates a new revision when restoring and preserves the previous history", async () => {
    const first = await store.createProject(scope);
    const second = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "first", patch: { files: { "app.ts": "first" } } });
    const third = await store.applyProjectPatch({ ...scope, expectedRevisionId: second.revisionId, idempotencyKey: "second", patch: { files: { "app.ts": "second" } } });
    const restored = await store.restoreProjectRevision({ ...scope, expectedRevisionId: third.revisionId, revisionId: second.revisionId, idempotencyKey: "restore" });
    expect(restored.revisionId).not.toBe(second.revisionId);
    expect(restored.parentRevisionId).toBe(third.revisionId);
    expect(restored.document).toEqual(second.document);
    expect((await store.readRevision(scope, third.revisionId)).document.files["app.ts"]).toBe("second");
    expect(await store.listRevisions(scope)).toHaveLength(4);
  });
  it("rejects file/directory collisions and inline credentials before saving a revision", async () => {
    const first = await store.createProject(scope);
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "collision", patch: { files: { src: "file", "src-extra.ts": "unrelated", "src/app.ts": "child" } } })).rejects.toMatchObject({ code: "project-input" });
    const secret = `sk-proj-${"a".repeat(50)}`;
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "inline-key", patch: { files: { "config.ts": `export const key = '${secret}'` } } })).rejects.toMatchObject({code:"project-secret"});
    expect((await store.readProject(scope)).revisionId).toBe(first.revisionId);
  });
  it("does not save credentials hidden in project metadata", async () => {
    const first = await store.createProject(scope);
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "metadata-key", patch: { architecture: { connection: { apiKey: "private-service-password" } } } })).rejects.toMatchObject({code:"project-secret"});
  });
});
