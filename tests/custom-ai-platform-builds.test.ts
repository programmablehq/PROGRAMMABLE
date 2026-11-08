import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createProjectChecks } from "../lib/custom-ai/platform/builds.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { AIPool } from "../lib/custom-ai/store.server";
import {platformContractIntent} from "../lib/custom-ai/platform/contract-plan.server";
const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
let db: PGlite, pool: AIPool, projects: ReturnType<typeof createPlatformStore>;
beforeEach(async () => {
  db = new PGlite(); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve(); pool = { connect: async () => { const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release }; } };
  projects = createPlatformStore(pool);
});
afterEach(async () => { await db.close(); });
const document = { requirements: [{ id: "count", text: "Persists a count", kind: "behavior" as const, open: null, origin: { kind: "legacy" as const } },
  { id: "private", text: "One count per user", kind: "constraint" as const, open: null, origin: { kind: "legacy" as const } }],
  files: { "app.js": "export const count = 1;" }, architecture: { checks: [{ id: "count-check", requirementIds: ["count"], command: "node --test tests/count.test.mjs", kind: "behavior" }] } };

describe("versioned behavior evidence", () => {
  it.each([false, true])("uses the latest exact check result after a same-revision rerun (first pass: %s)", async firstPass => {
    const first = await projects.createProject(scope);
    const revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "retry", patch: {
      ...document, architecture: { checks: [{ ...document.architecture.checks[0], requirementIds: ["count", "private"] }] },
    } });
    const result = { stdout: "check result", stderr: "", truncated: false, files: {}, revisionId: revision.revisionId, durationMs: 1 };
    const execute = vi.fn().mockResolvedValueOnce({ ...result, jobId: "first", exitCode: firstPass ? 0 : 1 })
      .mockResolvedValueOnce({ ...result, jobId: "second", exitCode: firstPass ? 1 : 0 });
    const checks = createProjectChecks(pool, projects, { execute });
    const ref = { ...scope, revisionId: revision.revisionId };
    await checks.verify(ref);
    await db.query("UPDATE programmable_projects_v1.check_evidence SET created_at='2000-01-01T00:00:00Z'");
    const repeated = await checks.verify(ref);
    expect(repeated.assessment.verified).toBe(!firstPass);
    expect(repeated.assessment.evidence).toHaveLength(1);
    expect(repeated.assessment.evidence[0].passed).toBe(!firstPass);
    expect((await db.query("SELECT id FROM programmable_projects_v1.check_evidence")).rows).toHaveLength(2);
  });
  it("does not let another declared check erase a failure or omit a required build check", async () => {
    const first = await projects.createProject(scope);
    const declarations = [
      { id: "behavior", requirementIds: ["count", "private"], kind: "behavior", command: "node test.mjs" },
      { id: "build", requirementIds: [], kind: "build", command: "node build.mjs" },
    ];
    const revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "full-plan", patch: { ...document, architecture: { checks: declarations } } });
    const checks = createProjectChecks(pool, projects, { execute: async () => { throw Error("not used"); } });
    const ref = { ...scope, revisionId: revision.revisionId };
    const { projectHash } = await import("../lib/custom-ai/platform/document");
    await checks.record(ref, { requirementIds: ["count", "private"], passed: true, commandHash: projectHash("node test.mjs"), result: { kind: "behavior", checkId: "behavior" } });
    expect(await checks.assess(ref)).toMatchObject({ verified: false, missingChecks: ["build"] });
    await checks.record(ref, { requirementIds: [], passed: false, commandHash: projectHash("node build.mjs"), result: { kind: "build", checkId: "build" } });
    expect((await checks.assess(ref)).verified).toBe(false);
    await checks.record(ref, { requirementIds: ["count", "private"], passed: true, commandHash: projectHash("node build.mjs"), result: { kind: "behavior", checkId: "build" } });
    expect((await checks.assess(ref)).verified).toBe(false);
  });
  it("keeps a failure when conflicting exact-check results have the same timestamp", async () => {
    const first = await projects.createProject(scope);
    const revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "same-time", patch: {
      ...document, architecture: { checks: [{ ...document.architecture.checks[0], requirementIds: ["count", "private"] }] },
    } });
    let job = 0;
    const checks = createProjectChecks(pool, projects, { execute: async () => ({ exitCode: job++ === 0 ? 1 : 0, stdout: "", stderr: "", truncated: false, files: {}, revisionId: revision.revisionId, jobId: String(job), durationMs: 1 }) });
    const ref = { ...scope, revisionId: revision.revisionId };
    await checks.verify(ref);
    await checks.verify(ref);
    await db.query("UPDATE programmable_projects_v1.check_evidence SET created_at='2000-01-01T00:00:00Z'");
    expect((await checks.assess(ref)).verified).toBe(false);
  });
  it("requires both app and contract evidence without changing the global requirements",async()=>{
    const first=await projects.createProject(scope),revision=await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"mixed",patch:{...document,architecture:{kind:"contract",application:{framework:"static",dataVersion:1},requirementScopes:{contract:["count"],application:["private"]}}}});
    expect(platformContractIntent(revision).requirements.map(rule=>rule.id)).toEqual(["count"]);
    const checks=createProjectChecks(pool,projects,{execute:async()=>{throw Error("Not used")}}),ref={...scope,revisionId:revision.revisionId};
    await checks.record(ref,{requirementIds:["count","private"],passed:true,commandHash:"contract",result:{kind:"contract-scenarios"}});
    await checks.record(ref,{requirementIds:[],passed:true,commandHash:"audit",result:{kind:"source-audit"}});
    expect(await checks.assess(ref)).toMatchObject({verified:false,missingRequirementIds:["private"]});
    await checks.record(ref,{requirementIds:["private"],passed:true,commandHash:"application",result:{kind:"behavior"}});
    expect((await checks.assess(ref)).verified).toBe(true);
    expect((await projects.readProject(scope)).document.requirements).toHaveLength(2);
    expect(()=>platformContractIntent({...revision,document:{...revision.document,architecture:{kind:"contract",application:{framework:"static",dataVersion:1}}}})).toThrow(/Map every requirement/);
  });
  it("redacts recognizable credentials from persisted check logs and replies",async()=>{
    const first=await projects.createProject(scope),revision=await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"logs",patch:document});
    const token=`github_pat_${"fixture".repeat(8)}`;
    const checks=createProjectChecks(pool,projects,{execute:async()=>({exitCode:1,stdout:token,stderr:`Authorization: Bearer ${token}`,truncated:false,files:{},revisionId:revision.revisionId,jobId:"log-test",durationMs:1})});
    const report=await checks.verify({...scope,revisionId:revision.revisionId});
    expect(JSON.stringify(report)).not.toContain(token);
    expect(JSON.stringify(await checks.assess({...scope,revisionId:revision.revisionId}))).not.toContain(token);
    expect(report.evidence[0].output).toContain("[redacted]");
  });
  it("requires a separate source audit before verified contract behavior can be released",async()=>{
    const first=await projects.createProject(scope),revision=await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"contract",patch:{...document,architecture:{kind:"contract",chainId:1}}});
    const checks=createProjectChecks(pool,projects,{execute:async()=>{throw Error("Not used")}}),ref={...scope,revisionId:revision.revisionId};
    await checks.record(ref,{requirementIds:["count","private"],passed:true,commandHash:"scenarios",result:{kind:"contract-scenarios"}});
    expect((await checks.assess(ref)).verified).toBe(false);
    await checks.record(ref,{requirementIds:[],passed:true,commandHash:"source-audit",result:{kind:"source-audit",status:"passed"}});
    expect((await checks.assess(ref)).verified).toBe(true);
  });
  it("does not equate a successful build with complete requirement verification", async () => {
    const first = await projects.createProject(scope), revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "first", patch: document });
    const executor = { execute: vi.fn(async () => ({ exitCode: 0, stdout: "passed", stderr: "", truncated: false, files: {}, revisionId: revision.revisionId, jobId: "job", durationMs: 1 })) };
    const checks = createProjectChecks(pool, projects, executor);
    await checks.verify({ ...scope, revisionId: revision.revisionId });
    expect(await checks.assess({ ...scope, revisionId: revision.revisionId })).toMatchObject({ verified: false, missingRequirementIds: ["private"] });
  });
  it("invalidates evidence after an edit and never upgrades a failed assertion", async () => {
    const first = await projects.createProject(scope), revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "first", patch: document });
    const execute = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "count assertion failed", truncated: false, files: {}, revisionId: revision.revisionId, jobId: "job", durationMs: 1 }));
    const checks = createProjectChecks(pool, projects, { execute });
    expect((await checks.verify({ ...scope, revisionId: revision.revisionId })).passed).toBe(false);
    const next = await projects.applyProjectPatch({ ...scope, expectedRevisionId: revision.revisionId, idempotencyKey: "edit", patch: { title: "Edited" } });
    expect(await checks.assess({ ...scope, revisionId: next.revisionId })).toMatchObject({ verified: false, missingRequirementIds: ["count", "private"] });
  });
  it("binds only the revision identity when called with worker execution context", async () => {
    const first = await projects.createProject(scope), revision = await projects.applyProjectPatch({ ...scope, expectedRevisionId: first.revisionId, idempotencyKey: "first", patch: document });
    const checks = createProjectChecks(pool, projects, { execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "", truncated: false, files: {}, revisionId: revision.revisionId, jobId: "job", durationMs: 1 }) });
    const context = { ...scope, revisionId: revision.revisionId, signal: AbortSignal.timeout(1000), leaseToken: "must-not-be-part-of-evidence", revision };
    expect((await checks.verify(context)).passed).toBe(true);
    expect(JSON.stringify((await checks.assess(context)).evidence)).not.toContain(context.leaseToken);
  });
});
