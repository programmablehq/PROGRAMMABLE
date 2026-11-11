import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createRunStore} from "../lib/custom-ai/platform/runs.server";
import {createArtifactStore} from "../lib/custom-ai/platform/artifacts.server";
import {createProjectChecks} from "../lib/custom-ai/platform/builds.server";
import {contractProjectTools} from "../lib/custom-ai/platform/legacy-contract-build.server";
import {canonicalGeneralSourceCatalog} from "../lib/custom-ai/canonical-dependencies.server";
import {CUSTOM_AI_SCHEMA,type AIPool} from "../lib/custom-ai/store.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {platformContractDocument} from "./fixtures/custom-ai-platform-contract";
let db:PGlite;
beforeEach(async()=>{db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);});
afterEach(async()=>{await db.close();});
it("copies exact pinned sources once and preserves the user's edited dependency",async()=>{
 let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const before=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await before;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
 const projects=createPlatformStore(pool),scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
 const first=await projects.createProject(scope),catalog=canonicalGeneralSourceCatalog(undefined,1),edited=Object.keys(catalog)[0];
 const revision=await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"plan",patch:{...platformContractDocument,files:{...platformContractDocument.files,[edited]:"// user edited dependency"}}});
 const runs=createRunStore(pool,{allowance:{hourlyUnits:25,dailyUnits:100,globalDailyUnits:100,concurrent:1},leaseMs:60000,capabilities:{}}),run=await runs.startRun({...scope,revisionId:revision.revisionId,operation:"build",prompt:"Install pinned contract dependencies",idempotencyKey:"start",budgetUnits:5}),lease=(await runs.claimRun(scope,run.runId,"worker"))!;
 const checks=createProjectChecks(pool,projects,{execute:async()=>{throw Error("Not used");}}),tools=contractProjectTools(createArtifactStore(pool),checks,projects),tool=tools.find(tool=>tool.id==="contract.dependencies");expect(tool).toBeDefined();
 const context={...scope,runId:run.runId,leaseToken:lease.token,stepId:`${run.runId}:copy`,revision,prompt:"Install pinned contract dependencies",signal:AbortSignal.timeout(10000)};
 await tool!.execute(context,{});const saved=await projects.readProject(scope);expect(saved.document.files[edited]).toBe("// user edited dependency");
 for(const [path,source] of Object.entries(catalog))if(path!==edited)expect(saved.document.files[path]).toBe(source.content);
 await tool!.reconcile!(context,{});expect((await projects.readProject(scope)).revisionId).toBe(saved.revisionId);
});

it("exposes each supported chain and serves Elysium's own pinned library",async()=>{
 const tools=contractProjectTools({} as never,{} as never,{} as never),context=tools.find(tool=>tool.id==="contract.context")!,library=tools.find(tool=>tool.id==="contract.library")!;
 for(const tool of [context,library])expect((tool.schema as {properties:{chainId:{enum:number[]}}}).properties.chainId.enum).toEqual([1,4663,8453,999,99901]);
 const catalog=canonicalGeneralSourceCatalog(undefined,99901),path=Object.keys(catalog).find(path=>path.includes("Elysium")&&path.endsWith(".sol"))!;
 expect(path).toBeDefined();
 const result=await library.execute({} as never,{chainId:99901,paths:[path]}) as {files:Record<string,string>};
 expect(result.files[path]).toBe(catalog[path].content);
});
