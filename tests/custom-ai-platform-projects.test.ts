import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { IntentRequirement } from "../lib/custom-ai/launch-intent";

const projectId = "11111111-1111-4111-8111-111111111111";
const scope = { ownerId: "alice", projectId };
const rule = (id: string, text: string): IntentRequirement => ({
  id, text, kind: "behavior", open: null,
  origin: { kind: "message", requestId: "user-request-000001", messageIndex: 0, quote: text },
});
let db: PGlite;
let store: ReturnType<typeof createPlatformStore>;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(PROJECT_PLATFORM_SCHEMA);
  await db.exec(`CREATE ROLE platform_test_runtime NOLOGIN NOSUPERUSER NOINHERIT;
    GRANT USAGE ON SCHEMA programmable_projects_v1 TO platform_test_runtime;
    GRANT SELECT,INSERT,UPDATE ON programmable_projects_v1.projects TO platform_test_runtime;
    GRANT SELECT,INSERT ON programmable_projects_v1.revisions,programmable_projects_v1.idempotency TO platform_test_runtime;
    SET ROLE platform_test_runtime;`);
  let tail = Promise.resolve();
  store = createPlatformStore({ connect: async () => {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    return { query: async (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } });
});
afterEach(async () => { await db.close(); });

describe("owner-scoped project revisions", () => {
  it("creates a durable project and returns its original revision on a duplicate create", async () => {
    const first = await store.createProject(scope);
    expect(await store.readProject(scope)).toEqual(first);
    expect(await store.createProject(scope)).toEqual(first);
    expect((await store.listProjects("alice")).map(project => project.projectId)).toEqual([projectId]);
  });

  it("does not reveal another owner's project through read or list", async () => {
    await store.createProject(scope);
    await expect(store.readProject({ ...scope, ownerId: "bob" })).rejects.toMatchObject({ code: "project-missing", status: 404 });
    expect(await store.listProjects("bob")).toEqual([]);
    await store.createProject({ ...scope, ownerId: "bob" });
    expect((await store.listProjects("bob")).map(project => project.projectId)).toEqual([projectId]);
  });

  it("enforces tenant scope in PostgreSQL even when a query omits the owner predicate", async () => {
    await store.createProject(scope);
    await store.createProject({ ownerId: "bob", projectId: "22222222-2222-4222-8222-222222222222" });
    await db.exec("BEGIN");
    try {
      await db.query("SELECT set_config('programmable.project_owner',$1,true)", ["alice"]);
      expect((await db.query<{ owner: string }>("SELECT owner FROM programmable_projects_v1.projects")).rows).toEqual([{ owner: "alice" }]);
      await expect(db.query("INSERT INTO programmable_projects_v1.projects(owner,id,current_revision,created_at,updated_at) VALUES($1,$2,$3,now(),now())", ["bob", "33333333-3333-4333-8333-333333333333", "forged"])).rejects.toMatchObject({ code: "42501" });
    } finally { await db.exec("ROLLBACK"); }
  });

  it("atomically saves requirements and title in a new immutable revision", async () => {
    const first = await store.createProject(scope);
    const next = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "set-requirements", patch: { title: "Game", requirements: [rule("cooldown", "Keep the cooldown")] } });
    expect(next.document.title).toBe("Game");
    expect(next.document.requirements).toEqual([rule("cooldown", "Keep the cooldown")]);
    expect(next.parentRevisionId).toBe(first.revisionId);
    expect(await store.readRevision(scope, first.revisionId)).toEqual(first);
    expect((await store.readProject(scope)).revisionId).toBe(next.revisionId);
  });

  it("rejects a stale edit without partially overwriting newer requirements", async () => {
    const first = await store.createProject(scope);
    const next = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "first-edit", patch: { title: "First edit" } });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "stale-edit", patch: { title: "Lost edit" } })).rejects.toMatchObject({ code: "project-conflict", status: 409 });
    expect(await store.readProject(scope)).toEqual(next);
    expect(await store.listRevisions(scope)).toHaveLength(2);
  });

  it("commits only one of two edits from the same base revision", async () => {
    const first = await store.createProject(scope);
    const outcomes = await Promise.allSettled(["one", "two"].map(id => store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: id, patch: { title: id } })));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await store.listRevisions(scope)).toHaveLength(2);
  });

  it("returns the original idempotent result after the head advances", async () => {
    const first = await store.createProject(scope);
    const request = { ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "repeat-edit", patch: { title: "Repeat" } };
    const second = await store.applyProjectPatch(request);
    const third = await store.applyProjectPatch({ ...scope, expectedRevisionId: second.revisionId, idempotencyKey: "another-edit", patch: { title: "After" } });
    expect(await store.applyProjectPatch(request)).toEqual(second);
    expect(await store.readProject(scope)).toEqual(third);
    await expect(store.applyProjectPatch({ ...request, patch: { title: "Different" } })).rejects.toMatchObject({ code: "project-idempotency", status: 409 });
  });

  it("keeps all rules for unrelated edits and requires explicit removal", async () => {
    const first = await store.createProject(scope);
    const rules = [rule("cooldown", "Keep cooldown"), rule("cap", "Keep cap")];
    const second = await store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "rules", patch: { requirements: rules } });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: second.revisionId, idempotencyKey: "lose-rule", patch: { requirements: [rules[1]] } })).rejects.toMatchObject({ code: "project-requirements" });
    const third = await store.applyProjectPatch({ ...scope, expectedRevisionId: second.revisionId, idempotencyKey: "rename", patch: { title: "Renamed" } });
    expect(third.document.requirements).toEqual(rules);
    const fourth = await store.applyProjectPatch({ ...scope, expectedRevisionId: third.revisionId, idempotencyKey: "explicit-removal", patch: { requirements: [rules[1]], removeRequirementIds: ["cooldown"] } });
    expect(fourth.document.requirements).toEqual([rules[1]]);
  });

  it("does not expose mutable references to saved source or requirements", async () => {
    const first = await store.createProject(scope);
    first.document.title = "Changed outside a revision";
    expect((await store.readProject(scope)).document.title).toBe("New project");
  });

  it("rejects malformed scope, duplicate requirements and oversized state", async () => {
    await expect(store.createProject({ ...scope, projectId: "not-a-uuid" })).rejects.toMatchObject({ code: "project-input" });
    const first = await store.createProject(scope);
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "duplicate", patch: { requirements: [rule("same", "One"), rule("same", "Two")] } })).rejects.toMatchObject({ code: "project-input" });
    await expect(store.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "huge", patch: { title: "x".repeat(1000) } })).rejects.toMatchObject({ code: "project-input" });
    expect(await store.listRevisions(scope)).toHaveLength(1);
  });
});
