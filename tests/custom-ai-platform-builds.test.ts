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
