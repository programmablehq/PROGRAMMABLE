import {afterEach,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createArtifactStore} from "../lib/custom-ai/platform/artifacts.server";
import {createProjectChecks} from "../lib/custom-ai/platform/builds.server";
import {contractProjectTools} from "../lib/custom-ai/platform/legacy-contract-build.server";
import {CUSTOM_AI_SCHEMA,type AIPool} from "../lib/custom-ai/store.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {platformContractDocument} from "./fixtures/custom-ai-platform-contract";

let db:PGlite;
afterEach(async()=>{await db?.close();});
it("returns the exact unexpected ABI while preserving the failed check and saved declaration",async()=>{
 db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);
 let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const before=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await before;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
 const projects=createPlatformStore(pool),scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
 const first=await projects.createProject(scope),revision=await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"source",patch:{...platformContractDocument,files:{"Counter.sol":"pragma solidity 0.8.26; contract Counter { uint public value; uint public constant UNPLANNED = 170; }"}}});
 const checks=createProjectChecks(pool,projects,{execute:async()=>{throw Error("Not used");}}),tools=contractProjectTools(createArtifactStore(pool),checks,projects);
 const context={...scope,runId:"22222222-2222-4222-8222-222222222222",leaseToken:"test",stepId:"compile",revision,prompt:"Verify the saved implementation",signal:AbortSignal.timeout(60000)};
 const result=await tools.find(tool=>tool.id==="contract.verify")!.execute(context,{}) as {compiled:boolean;passed:boolean;failures:{code:string;message:string}[]};
 expect(result.compiled).toBe(true);
 expect(result.passed).toBe(false);expect(result.failures[0].code).toBe("unexpected-interface");
 expect(result.failures[0].message).toContain("UNPLANNED()");
 const assessment=await checks.assess({...scope,revisionId:revision.revisionId});expect(assessment.verified).toBe(false);
 expect(JSON.stringify(assessment.evidence)).toContain("The compiled public functions differ from the declared interface.");
 expect((await projects.readProject(scope)).document).toEqual(revision.document);
},60000);
