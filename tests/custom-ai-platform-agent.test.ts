import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createRunStore } from "../lib/custom-ai/platform/runs.server";
import { createProjectAgent, type AgentDecision, type ProjectTool } from "../lib/custom-ai/platform/agent.server";
import { CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { WorkerGrantClaims } from "../lib/custom-ai/platform/protocol.generated";

let db: PGlite, runs: ReturnType<typeof createRunStore>, projects: ReturnType<typeof createPlatformStore>, revisionId: string;
const scope = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111" };
beforeEach(async () => {
  db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve(); const pool: AIPool = { connect: async () => { const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release=resolve; }); await prior;
    return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release}; } };
  projects = createPlatformStore(pool); revisionId = (await projects.createProject(scope)).revisionId;
  runs = createRunStore(pool, { allowance: {hourlyUnits:25,dailyUnits:100,globalDailyUnits:200,concurrent:1},leaseMs:60000,
    capabilities: {"model.plan":{units:1,effect:"read",operations:["plan","build"]},"project.patch":{units:1,effect:"write",operations:["build"]}} });
});
afterEach(async()=>{await db.close();});
const start=async(operation:"plan"|"build"="build")=>{
  const run=await runs.startRun({...scope,revisionId,operation,prompt:"Create app.js",idempotencyKey:"build",budgetUnits:10});
  const lease=(await runs.claimRun(scope,run.runId,"worker-one"))!;
  const grant={...scope,runId:run.runId,workerId:"worker-one"} as WorkerGrantClaims;
  return {grant,lease};
};
const decisions:AgentDecision[]=[{kind:"tool",tool:"project.patch",input:{},message:"Writing file",claim:"planned"},{kind:"reply",tool:null,input:null,message:"The source is saved.",claim:"built"}];

describe("durable project agent",()=>{
  it("stops before a third automatic repair after failed behavior checks",async()=>{
    const pool:AIPool={connect:async()=>({query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release(){}})};
    runs=createRunStore(pool,{allowance:{hourlyUnits:100,dailyUnits:100,globalDailyUnits:200,concurrent:1},leaseMs:60000,capabilities:{"model.plan":{units:0,effect:"read",operations:["build"]},"project.patch":{units:0,effect:"write",operations:["build"]},"project.check":{units:0,effect:"read",operations:["build"]}}});
    const {grant,lease}=await start();let decisions=0;
    const patch=vi.fn(async()=>({revisionId})),check=vi.fn(async()=>({passed:false}));
    const tools:ProjectTool[]=[{id:"project.patch",version:"1",description:"Repair",schema:{type:"object"},execute:patch},{id:"project.check",version:"1",description:"Check",schema:{type:"object"},execute:check}];
    const agent=createProjectAgent({runs,projects,tools,choose:async()=>({kind:"tool",tool:decisions++%2===0?"project.check":"project.patch",input:{},message:"Work",claim:"built"}),assess:async()=>({level:"built"})});
    for(let n=0;n<16;n++){const state=await agent.advance(grant,lease.token);if(state.run.status!=="running")break;}
    expect(patch).toHaveBeenCalledTimes(2);expect(check).toHaveBeenCalledTimes(3);
    expect(await runs.readRun(scope,grant.runId)).toMatchObject({status:"waiting_user"});
  });
  it("resumes a saved model decision and never writes a file twice",async()=>{
    const {grant,lease}=await start();let next=0;
    const choose=vi.fn(async()=>decisions[next++]);
    const execute=vi.fn(async context=>{
      const revision=await projects.applyProjectPatch({...scope,expectedRevisionId:context.revision.revisionId,idempotencyKey:context.stepId,
        patch:{files:{"app.js":"console.log('hello')"}},execution:{runId:grant.runId,leaseToken:lease.token}});
      return {revisionId:revision.revisionId};
    });
    const tools:ProjectTool[]=[{id:"project.patch",version:"1",description:"Write files",schema:{type:"object",additionalProperties:false},execute}];
    const agent=()=>createProjectAgent({runs,projects,tools,choose,assess:async()=>({level:"built" as const})});
    await agent().advance(grant,lease.token);
    expect(execute).not.toHaveBeenCalled();
    await agent().advance(grant,lease.token);
    expect(execute).toHaveBeenCalledOnce();
    await agent().advance(grant,lease.token);
    expect((await agent().advance(grant,lease.token)).run.status).toBe("succeeded");
    expect(execute).toHaveBeenCalledOnce();expect(choose).toHaveBeenCalledTimes(2);
    expect((await projects.readProject(scope)).document.files["app.js"]).toContain("hello");
  });
  it("keeps discussion tools from gaining file-write authority",async()=>{
    const {grant,lease}=await start("plan"),execute=vi.fn(async()=>({}));
    const agent=createProjectAgent({runs,projects,tools:[{id:"project.patch",version:"1",description:"Write",schema:{type:"object"},execute}],choose:async()=>decisions[0],assess:async()=>({level:"planned" as const})});
    await agent.advance(grant,lease.token);
    expect((await agent.advance(grant,lease.token)).run.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a claimed release when only source has been saved",async()=>{
    const {grant,lease}=await start();
    const agent=createProjectAgent({runs,projects,tools:[],choose:async()=>({kind:"reply",tool:null,input:null,message:"Live and verified!",claim:"operational"}),assess:async()=>({level:"built" as const})});
    await agent.advance(grant,lease.token);
    const result=await agent.advance(grant,lease.token);
    expect(result.run.summary).not.toContain("Live and verified");
    expect(result.run.status).toBe("failed");
  });
});
