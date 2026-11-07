import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createRunStore } from "../lib/custom-ai/platform/runs.server";
import { createProjectTools } from "../lib/custom-ai/platform/tools.server";
import { createSandboxExecutor, type SandboxProvider } from "../lib/custom-ai/platform/sandbox-executor.server";
import { createProjectChecks } from "../lib/custom-ai/platform/builds.server";
import { CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { ToolContext } from "../lib/custom-ai/platform/agent.server";

let db:PGlite, projects:ReturnType<typeof createPlatformStore>,tools:ReturnType<typeof createProjectTools>,context:ToolContext;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
beforeEach(async()=>{
 db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);
 let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const prior=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await prior;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};
 projects=createPlatformStore(pool);const revision=await projects.createProject(scope);
 const runs=createRunStore(pool,{allowance:{hourlyUnits:25,dailyUnits:100,globalDailyUnits:200,concurrent:1},leaseMs:60000,capabilities:{}});
 const run=await runs.startRun({...scope,revisionId:revision.revisionId,operation:"build",prompt:"create counter and keep private",idempotencyKey:"work",budgetUnits:5});
 const lease=(await runs.claimRun(scope,run.runId,"worker"))!;
 context={...scope,runId:run.runId,leaseToken:lease.token,stepId:"first",revision,prompt:"create counter and keep private",signal:AbortSignal.timeout(60000)};
 const driver={create:vi.fn(async()=>{throw Error("not expected")}),cleanup:vi.fn(async()=>undefined)} satisfies SandboxProvider;
 const sandbox=createSandboxExecutor(pool,projects,driver);tools=createProjectTools(projects,sandbox,createProjectChecks(pool,projects,sandbox));
});
afterEach(async()=>{await db.close()});
const planned={title:"Counter",requirements:[{id:"counter",text:"Increments counter",kind:"behavior",open:null,instruction:"counter"},{id:"private",text:"Isolates owners",kind:"constraint",open:null,instruction:"private"}],edits:[],architecture:{checks:[{id:"count",requirementIds:["counter","private"],command:"node --test counter.test.mjs",kind:"behavior"}]}};
describe("guarded project tools",()=>{
 it("preserves saved requirements when a new model plan silently omits one",async()=>{
   const plan=tools.find(tool=>tool.id==="project.plan")!;
   await plan.execute(context,planned);
   context={...context,revision:await projects.readProject(scope),stepId:"second"};
   await expect(plan.execute(context,{...planned,requirements:[planned.requirements[0]]})).rejects.toMatchObject({code:"project-requirements"});
   expect((await projects.readProject(scope)).document.requirements.map(rule=>rule.id)).toEqual(["counter","private"]);
 });
 it("requires a plan and preserves unrelated rules during file edits",async()=>{
   const patch=tools.find(tool=>tool.id==="project.patch")!;
   await expect(patch.execute(context,{fileChanges:[{operation:"write",path:"app.js",beforeHash:null,content:"hello"}]})).rejects.toMatchObject({code:"project-plan"});
   await tools.find(tool=>tool.id==="project.plan")!.execute(context,planned);
   context={...context,revision:await projects.readProject(scope),stepId:"second"};
   await patch.execute(context,{fileChanges:[{operation:"write",path:"app.js",beforeHash:null,content:"hello"}]});
   const result=await projects.readProject(scope);expect(result.document.requirements).toEqual(context.revision.document.requirements);
   expect(result.document.files["app.js"]).toBe("hello");
 });
 it("does not treat an unsupported quote as approval to replace a rule",async()=>{
   const plan=tools.find(tool=>tool.id==="project.plan")!;await plan.execute(context,planned);
   context={...context,revision:await projects.readProject(scope),stepId:"second"};
   await expect(plan.execute(context,{...planned,requirements:[{...planned.requirements[0],text:"Send money"},planned.requirements[1]],edits:[{requirementId:"counter",operation:"replace",instruction:"send money"}]})).rejects.toMatchObject({code:"edit"});
 });
});
