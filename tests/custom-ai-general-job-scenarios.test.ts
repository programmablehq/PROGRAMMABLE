import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import { runCustomAI, type AIContext } from "../lib/custom-ai/service.server";
import { createAIStore, CUSTOM_AI_SCHEMA, type AIStore } from "../lib/custom-ai/store.server";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import { compileExistingProject, readCompilationSource } from "../lib/custom-ai/compile-existing.server";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { CustomAIError, type ChatRequest } from "../lib/custom-ai/types";
import type { ClaudeInput } from "../lib/custom-ai/claude.server";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import type { GeneralProjectDraft } from "../lib/custom-ai/general-builder.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const account=`0x${"a".repeat(40)}`,chat="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",instruction="Build a counter anyone can increment, starting at zero, with no owner privileges.";
const request:ChatRequest={id:"general-scenario-job-00001",intent:"chat",messages:[{role:"user",content:instruction}],coin:EMPTY_COIN_SETUP,conversation:{account,id:chat,revision:0}};
const requirements=[{id:"counter",text:"Anyone can increment by one, starting at zero",kind:"behavior",instruction,open:null},
  {id:"no-owner",text:"No owner privileges",kind:"constraint",instruction,open:null}];
const declaration=()=>({contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function count() view returns (uint256)","function increment()"],
  allowReceive:false,allowFallback:false,surfaceRequirements:["no-owner"]}],allowedCalls:[],steps:[
  {id:"zero",contract:"main",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["0"]}},
  {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"one",contract:"main",signature:"count()",arguments:[],from:"trader-b",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
]});
const response=(value:unknown)=>({text:JSON.stringify(value),inputTokens:10,outputTokens:20});
const plan=(checks:unknown=declaration())=>response({reply:"I will build the agreed counter.",executionRoute:"custom-contract",intentRequirements:requirements,action:"build",memory:"Counter without an owner",requirements:requirements.map(rule=>rule.text),
  feeChecks:[],setupPatch:{},lookups:[],program:null,eventRule:null,composable:null,ruleEdits:[],generalChecks:JSON.stringify(checks)});
const generated=(increment=1,role="auxiliary")=>response({reply:"The counter source is saved.",summary:"Counter without an owner",sourceFiles:[{path:"Counter.sol",content:`pragma solidity 0.8.26; contract Counter { uint256 public count; function increment() external { count+=${increment}; } }`}],
  entrypoints:[{source:"Counter.sol",contract:"Counter",role}],requirementIds:["counter","no-owner"]});
let database:PGlite,store:AIStore;
beforeEach(async()=>{
 database=new PGlite();await database.exec(CUSTOM_AI_SCHEMA);let queue=Promise.resolve();
 store=createAIStore({connect:async()=>{const previous=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await previous;
  return {query:(sql,values)=>database.query<Record<string,unknown>>(sql,values),release};}},{hourlyUnits:100,dailyUnits:100,globalDailyUnits:100,concurrent:1});
 await store.conversations.create("alice",account,chat);
});
afterEach(async()=>{await database.close();});
function context(lease:string,events:string[]=[]):AIContext{
 return {saveBlueprint:async(blueprint,intent)=>{events.push("plan");await store.projects.saveBlueprint("alice",request.id,lease,{intent,blueprint});},
  saveProject:async project=>{events.push("source");await store.projects.save("alice",request.id,lease,project);},
  saveCompilation:async compilation=>{events.push("artifacts");await store.projects.complete("alice",request.id,lease,compilation);},
  saveScenarios:async report=>{events.push("report");await store.projects.saveScenarios("alice",request.id,lease,report);}};
}

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("general scenarios in the actual owned job",{timeout:60_000},()=>{
 it.each([1,2])("persists the oracle before generation and detects increment-by%i in the actual compiler and EVM",async increment=>{
  const attempt=await store.reserve("alice",request),events:string[]=[];
  const call=vi.fn(async(input:ClaudeInput)=>{
   if(call.mock.calls.length===1){expect(input.schema).not.toHaveProperty("properties.generalChecks");return plan();}
   if(call.mock.calls.length===2){return response({generalChecks:JSON.stringify(declaration())});}
   expect(input.system).toContain("fixedChecks");
   expect(await store.projects.readBlueprint("alice",request.id)).not.toBeNull();events.push("generation");return generated(increment);
  });
  const compiler=vi.fn(async(project:Parameters<typeof compileContractProject>[0],signal?:AbortSignal)=>{events.push("compile");return compileContractProject(project,signal);});
  const checks=vi.fn(async(...args:Parameters<typeof checkGeneralScenarios>)=>{
   expect((await store.projects.read("alice",request.id))?.compilation?.artifactHash).toBe(args[1].artifactHash);events.push("checks");return checkGeneralScenarios(...args);
  });
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler,checkProject:checks},context(attempt.lease!,events));
  expect(events).toEqual(["plan","generation","source","compile","artifacts","checks","report"]);
  expect(call).toHaveBeenCalledTimes(3);expect(compiler).toHaveBeenCalledTimes(1);expect(checks).toHaveBeenCalledTimes(1);
  expect(value.generalProject?.scenarios?.passed).toBe(increment===1);expect(value.change).toBe(increment===1?"applied":"blocked");
  expect(value.generalProject?.launchReady).toBe(false);expect(value.generalProject?.verification).toBe("not-run");expect(JSON.stringify(value)).not.toContain("pragma solidity");
  const checkpoint=await store.projects.read("alice",request.id);expect(checkpoint?.scenarios?.hash).toBe(value.generalProject?.scenarios?.hash);
  expect(await store.projects.overview("alice",request.id)).toMatchObject({blueprintId:value.generalProject?.blueprintId,scenarios:{passed:increment===1}});
 });
 it("keeps an incomplete oracle as a blocked complete design without spending generation or compiler work",async()=>{
  const attempt=await store.reserve("alice",request),call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(response({generalChecks:JSON.stringify({...declaration(),steps:[]})})),compiler=vi.fn(),checks=vi.fn();
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler,checkProject:checks},context(attempt.lease!));
  expect(value.change).toBe("blocked");expect(value.intent?.requirements).toHaveLength(2);expect(call).toHaveBeenCalledTimes(2);expect(compiler).not.toHaveBeenCalled();expect(checks).not.toHaveBeenCalled();
  expect(await store.projects.readBlueprint("alice",request.id)).toBeNull();expect(await store.projects.read("alice",request.id)).toBeNull();
 });
 it("does not spend source generation after the plan's owning lease was stopped",async()=>{
  const attempt=await store.reserve("alice",request);await store.cancel("alice",request.id);const call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration())}));
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:vi.fn()},context(attempt.lease!))).rejects.toMatchObject({code:"interrupted"});
  expect(call).toHaveBeenCalledTimes(2);expect(await store.projects.read("alice",request.id)).toBeNull();
 });
 it("cannot replace a planned entrypoint role in generated source",async()=>{
  const attempt=await store.reserve("alice",request),call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration())})).mockResolvedValueOnce(generated(1,"token")),compiler=vi.fn();
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},context(attempt.lease!))).rejects.toMatchObject({code:"behavior-context"});
  expect(await store.projects.readBlueprint("alice",request.id)).not.toBeNull();expect(await store.projects.read("alice",request.id)).toBeNull();expect(compiler).not.toHaveBeenCalled();
 });
 it("uses a source-blind oracle after an explicit source inspection instead of accepting code-derived expectations",async()=>{
  const intent:LaunchIntent={version:1,id:"old-counter-design",revision:"a".repeat(64),unresolved:[],changes:[],requirements:requirements.map(rule=>({id:rule.id,text:rule.text,kind:rule.kind as "behavior"|"constraint",open:null,origin:{kind:"legacy"}}))};
  const old=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},sources:{"Counter.sol":{content:"pragma solidity 0.8.26; contract Counter { uint public count; function increment() external {count+=2;} } // ADVERSARIAL_ORACLE_TOUCH"}},entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}]},intent,1);
  const previous:GeneralProjectDraft={version:1,reply:"Earlier source",summary:"Counter",project:old,compilation:{version:1,projectHash:old.hash,artifactHash:`sha256:${"b".repeat(64)}`,compiled:true,compiler:GENERAL_PROJECT_COMPILER,diagnostics:[],contracts:[],verification:"not-run",launchReady:false},
    selection:selectExecutionRoute(intent,1),requirementCoverage:"proposed",launchReady:false};
  const inspected={...request,messages:[{role:"user" as const,content:"Inspect the source code and rebuild the agreed counter."}]},attempt=await store.reserve("alice",inspected),poisoned=declaration();poisoned.steps[2].expect.returns![0]="2";
  const call=vi.fn(async(input:ClaudeInput)=>{
   if(call.mock.calls.length===1){expect(input.system).toContain("ADVERSARIAL_ORACLE_TOUCH");return plan(poisoned);}
   if(call.mock.calls.length===2){expect(input.system).not.toContain("ADVERSARIAL_ORACLE_TOUCH");expect(JSON.stringify(input.messages)).not.toContain("ADVERSARIAL_ORACLE_TOUCH");return response({generalChecks:JSON.stringify(declaration())});}
   return generated();
  });
  const value=await runCustomAI(inspected,undefined,{call,compile:vi.fn(),compileProject:compileContractProject},{...context(attempt.lease!),intent,generalProject:previous});
  expect(call).toHaveBeenCalledTimes(3);expect(value.generalProject?.scenarios?.passed).toBe(true);
  expect((await store.projects.readBlueprint("alice",request.id))?.blueprint.scenarios.steps[2].expect.returns).toEqual(["1"]);
 });
 it("resumes only the failed worker with its original oracle and artifacts, without inference or a second compilation",async()=>{
  const attempt=await store.reserve("alice",request),call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration())})).mockResolvedValueOnce(generated()),compiler=vi.fn(compileContractProject),outage=vi.fn(async()=>{throw new CustomAIError("behavior-worker","Fixture worker unavailable",503);});
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler,checkProject:outage},context(attempt.lease!))).rejects.toMatchObject({code:"behavior-worker"});
  await store.finish("alice",request.id,attempt.lease!,undefined,"behavior-worker");
  const saved=(await store.projects.read("alice",request.id))!;expect(saved.compilation?.compiled).toBe(true);expect(saved.scenarios).toBeUndefined();
  const retry:ChatRequest={id:"general-scenario-retry-00001",intent:"compile",messages:[],conversation:{account,id:chat,revision:0},coin:EMPTY_COIN_SETUP,compilationOf:{id:request.id,projectHash:saved.project.hash}};
  const original=await readCompilationSource(store,"alice",retry,saved.project.intent),resumed=await store.reserve("alice",retry),noCompile=vi.fn(),check=vi.fn(checkGeneralScenarios);
  const value=await compileExistingProject({store,owner:"alice",id:retry.id,lease:resumed.lease!,source:original},undefined,noCompile,check);
  await store.finish("alice",retry.id,resumed.lease!,value);
  expect(value.generalProject?.scenarios?.passed).toBe(true);expect(value.generalProject?.projectHash).toBe(saved.project.hash);expect(value.generalProject?.blueprintId).toBe(saved.blueprintId);
  expect(noCompile).not.toHaveBeenCalled();expect(check).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(3);expect(compiler).toHaveBeenCalledTimes(1);
  expect((await store.projects.read("alice",request.id))?.scenarios).toBeUndefined();expect((await store.projects.read("alice",retry.id))?.scenarios?.passed).toBe(true);
  expect((await database.query<{reserved:number}>("SELECT reserved FROM programmable_custom_ai_v1.jobs WHERE id=$1",[retry.id])).rows[0].reserved).toBe(1);
  expect((await store.reserve("alice",retry)).lease).toBeNull();expect(check).toHaveBeenCalledTimes(1);
 });
});
