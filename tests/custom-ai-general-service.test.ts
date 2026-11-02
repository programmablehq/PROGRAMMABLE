import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { runCustomAI } from "../lib/custom-ai/service.server";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ContractProject } from "../lib/custom-ai/contract-project";
import type { CompiledProject } from "../lib/custom-ai/contract-project.server";
import type { GeneralProjectDraft } from "../lib/custom-ai/general-builder.server";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import type { ChatRequest } from "../lib/custom-ai/types";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type {ClaudeInput,ClaudeResult} from "../lib/custom-ai/claude.server";
import {generalProjectView} from "../lib/custom-ai/project-view";
import { ModelResponseError } from "../lib/custom-ai/model-response";

const instruction="Build a counter that anyone can increment with no owner.";
const request:ChatRequest={id:"general-service-request-0001",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:instruction}]};
const requirements=[{id:"counter",text:"Anyone can increment the counter",kind:"behavior",instruction,open:null},{id:"no-owner",text:"No owner privileges",kind:"constraint",instruction,open:null}];
const source="pragma solidity 0.8.26; contract Counter { uint public count; function increment() external { count++; } }";
const result=(value:unknown)=>({text:JSON.stringify(value),inputTokens:10,outputTokens:20});
function plan(patch:Record<string,unknown>={}){return result({reply:"I will build the agreed counter.",executionRoute:"custom-contract",intentRequirements:requirements,action:"build",memory:"Counter without an owner",requirements:requirements.map(r=>r.text),feeChecks:[],setupPatch:{},lookups:[],program:null,eventRule:null,composable:null,ruleEdits:[],...patch});}
const generated=(ids=requirements.map(r=>r.id))=>result({reply:"The complete counter source is saved.",summary:"A counter anyone can increment",sourceFiles:[{path:"Counter.sol",content:source}],entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}],requirementIds:ids});
function compile(project:ContractProject):Promise<CompiledProject>{
 const body={version:1 as const,projectHash:project.hash,compiled:false,compiler:GENERAL_PROJECT_COMPILER,diagnostics:[{severity:"error" as const,message:"Needs the next verification step"}],contracts:[],verification:"not-run" as const,launchReady:false as const};
 return Promise.resolve({...body,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",body)});
}
function prior():GeneralProjectDraft{
 const intent:LaunchIntent={version:1,id:"saved-general-design",revision:"a".repeat(64),requirements:requirements.map(rule=>({id:rule.id,text:rule.text,kind:rule.kind as "behavior"|"constraint",open:rule.open,origin:{kind:"legacy" as const}})),unresolved:[],changes:[]};
 const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"paris"},sources:{"Counter.sol":{content:source}},entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}]},intent,1);
 return {version:1,reply:"Saved",summary:"Counter",project,compilation:{version:1,projectHash:project.hash,artifactHash:`sha256:${"b".repeat(64)}`,compiled:true,compiler:GENERAL_PROJECT_COMPILER,diagnostics:[],contracts:[],verification:"not-run",launchReady:false},selection:selectExecutionRoute(intent,1),requirementCoverage:"proposed",launchReady:false};
}

it("turns a casual explicit launch request into a source-bound preparation action without rebuilding",async()=>{
 const previous=prior(),view=generalProjectView(previous);
 view.scenarios={scope:"isolated-declared-scenarios-v2",hash:`sha256:${"3".repeat(64)}`,planHash:`sha256:${"4".repeat(64)}`,passed:true,cases:5,failures:[]};
 const call=vi.fn().mockResolvedValue(plan({action:"answer",launchRequested:true,intentRequirements:[],requirements:[],reply:"Ich bereite den Launch vor."}));
 const compiler=vi.fn(),value=await runCustomAI({...request,draftId:"saved-general-source-0001",messages:[{role:"user",content:"ok passt, lass den coin jetzt launchen"}]},undefined,
  {call,compile:compiler},{generalProjectView:view,intent:previous.project.intent});
 expect(value.nextAction).toEqual({kind:"prepare-launch",sourceId:"saved-general-source-0001"});
 expect(value.intent).toEqual(previous.project.intent);expect(compiler).not.toHaveBeenCalled();expect(call).toHaveBeenCalledTimes(1);
 expect(call.mock.calls[0][0].system).toContain("Questions, quotes, negation and requests to wait mean false");
});
it.each(["how do I launch this?","bitte noch nicht launchen","nice, explain the fees first"])("ordinary conversation does not produce a launch action: %s",async content=>{
 const previous=prior(),view=generalProjectView(previous),call=vi.fn().mockResolvedValue(plan({action:"answer",launchRequested:false,intentRequirements:[],requirements:[]}));
 const value=await runCustomAI({...request,draftId:"saved-general-source-0001",messages:[{role:"user",content}]},undefined,{call,compile:vi.fn()},
  {generalProjectView:view,intent:previous.project.intent});expect(value.nextAction).toBeUndefined();
});
it("never prepares a launch when the source still lacks its successful behavior checks",async()=>{
 const previous=prior(),call=vi.fn().mockResolvedValue(plan({action:"answer",launchRequested:true,intentRequirements:[],requirements:[]}));
 const value=await runCustomAI({...request,draftId:"saved-general-source-0001"},undefined,{call,compile:vi.fn()},
  {generalProject:previous});expect(value.nextAction).toBeUndefined();
});

it("builds the complete saved design when a casual request explicitly preserves it",async()=>{
 const previous=prior(),save=vi.fn(async()=>{}),compiler=vi.fn(compile),call=vi.fn()
  .mockResolvedValueOnce(plan({intentMode:"preserve",intentRequirements:[],requirements:[]})).mockResolvedValueOnce(generated());
 const value=await runCustomAI({...request,messages:[{role:"user",content:"okay, bau genau den gespeicherten entwurf fertig, alles bleibt gleich"}]},undefined,
  {call,compile:vi.fn(),compileProject:compiler},{intent:previous.project.intent,saveProject:save});
 expect(value.intent).toEqual(previous.project.intent);expect(value.generalProject?.intentRevision).toBe(previous.project.intent.revision);
 expect(save).toHaveBeenCalledOnce();expect(compiler).toHaveBeenCalledOnce();expect(call).toHaveBeenCalledTimes(2);
 expect(call.mock.calls[0][0].schema.properties.intentMode.enum).toEqual(["preserve","revise"]);
 expect(call.mock.calls[1][0].system).toContain("counter");expect(call.mock.calls[1][0].system).toContain("no-owner");
});

it.each([
 {intentRequirements:requirements,ruleEdits:[]},
 {intentRequirements:[],ruleEdits:[{requirementId:"counter",operation:"remove",instruction:"remove counter"}]},
])("never hides additions or removals inside an unchanged build: %j",async patch=>{
 const previous=prior(),compiler=vi.fn(),call=vi.fn().mockResolvedValue(plan({intentMode:"preserve",...patch}));
 await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},
  {intent:previous.project.intent,saveProject:vi.fn()})).rejects.toMatchObject({code:"intent"});
 expect(compiler).not.toHaveBeenCalled();expect(call).toHaveBeenCalledOnce();
});

it("cannot invent a saved design for an empty preserve request",async()=>{
 const call=vi.fn().mockResolvedValue(plan({intentMode:"preserve",intentRequirements:[],ruleEdits:[]}));
 await expect(runCustomAI(request,undefined,{call,compile:vi.fn()},{saveProject:vi.fn()})).rejects.toMatchObject({code:"intent"});
 expect(call.mock.calls[0][0].schema.properties.intentMode.enum).toEqual(["revise"]);
});

describe("general source generation inside the owned chat job",()=>{
 it("binds all canonical general rules without treating a redundant fee subset as source coverage",async()=>{
  const call=vi.fn().mockResolvedValueOnce(plan({implementedRequirementIds:["old-fee-rule"],requirements:["Redundant prose"]}))
   .mockResolvedValueOnce(generated());
  const save=vi.fn(async()=>{}),compiler=vi.fn(compile);
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},{saveProject:save});
  expect(value.intent?.requirements.map(rule=>rule.id)).toEqual(["counter","no-owner"]);
  expect(value.generalProject?.intentRevision).toBe(value.intent?.revision);
  expect(value.generalProject?.compiled).toBe(false);expect(value.generalProject?.launchReady).toBe(false);
  expect(save).toHaveBeenCalledOnce();expect(compiler).toHaveBeenCalledOnce();expect(call).toHaveBeenCalledTimes(2);
 });
 it("retains the known cost and distinguishes an output-limited planner without retrying",async()=>{
  const onModelCall=vi.fn(),call=vi.fn(async()=>{throw new ModelResponseError("output-limit",{inputTokens:14900,outputTokens:8000});});
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn()},{onModelCall})).rejects.toMatchObject({code:"incomplete"});
  expect(onModelCall).toHaveBeenCalledWith(expect.objectContaining({inputTokens:14900,outputTokens:8000,completed:false,failure:"output-limit"}));
  expect(call).toHaveBeenCalledTimes(1);
 });
 it("keeps an ordinary answer out of the independent declaration step",async()=>{
  const call=vi.fn<(input:ClaudeInput)=>Promise<ClaudeResult>>(async()=>plan({action:"answer",intentRequirements:[],requirements:[],generalChecks:null}));
  await runCustomAI(request,undefined,{call,compile:vi.fn()},{saveBlueprint:async()=>{},saveScenarios:async()=>{},saveCompilation:async()=>{}});
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toMatchObject({responseProfile:"contract",maxTokens:16000});
  expect(call.mock.calls[0][0].schema).not.toHaveProperty("properties.generalChecks");
 });
 it.each(["output-limit","timeout"] as const)("preserves every agreed rule when the separate declaration fails with %s without retrying or generating source",async failure=>{
  const call=vi.fn<(input:ClaudeInput)=>Promise<ClaudeResult>>()
   .mockResolvedValueOnce(plan())
   .mockRejectedValueOnce(new ModelResponseError(failure,{inputTokens:2000,outputTokens:16000}));
  const save=vi.fn(),compiler=vi.fn(),onModelCall=vi.fn();
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},{
   saveProject:save,saveBlueprint:async()=>{},saveCompilation:async()=>{},saveScenarios:async()=>{},onModelCall,
  });
  expect(value.change).toBe("blocked");expect(value.intent?.requirements.map(rule=>rule.id)).toEqual(["counter","no-owner"]);
  expect(value.unresolved).toContain("Contract checks could not be prepared");expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[0][0].schema).not.toHaveProperty("properties.generalChecks");
  expect(call.mock.calls[1][0]).toMatchObject({responseProfile:"contract",maxTokens:8000,effort:"low",model:"claude-sonnet-5-5"});
  expect(call.mock.calls[1][0].messages).toHaveLength(1);
  expect(onModelCall).toHaveBeenLastCalledWith(expect.objectContaining({completed:false,failure,outputTokens:16000}));
  expect(save).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();
 });
 it("keeps an existing general project on its source route even if the interpreter proposes a fee template",async()=>{
  const previous=prior(),call=vi.fn().mockResolvedValueOnce(plan({executionRoute:"fee-module",feeChecks:[{afterSeconds:0,buy:true,totalFeeBps:100},{afterSeconds:0,buy:false,totalFeeBps:100}]})).mockResolvedValueOnce(generated()),fee=vi.fn();
  const value=await runCustomAI(request,undefined,{call,compile:fee,compileProject:compile},{generalProject:previous,saveProject:async()=>{}});
  expect(value.selection?.route).toBe("custom-contract");expect(value.generalProject).toBeDefined();expect(fee).not.toHaveBeenCalled();
 });
 it("omits unavailable fee-program schemas and context from an ordinary general-source question",async()=>{
  const captured:ClaudeInput[]=[],call=vi.fn(async(input:ClaudeInput)=>{captured.push(input);return plan({action:"answer",intentRequirements:[],requirements:[]});});
  const question={...request,messages:[{role:"user" as const,content:"Explain the agreed behavior briefly."}]};
  await runCustomAI(question,undefined,{call,compile:vi.fn()});
  await runCustomAI(question,undefined,{call,compile:vi.fn()},{generalProject:prior()});
  const fee=captured[0],general=captured[1],schema=general.schema as {properties:{program:unknown;eventRule:unknown;composable:unknown;executionRoute:unknown}};
  expect(schema.properties.program).toEqual({type:"null"});expect(schema.properties.eventRule).toEqual({type:"null"});expect(schema.properties.composable).toEqual({type:"null"});
  expect(schema.properties.executionRoute).toEqual({type:"string",enum:["custom-contract"]});
  expect(JSON.stringify(general.schema).length).toBeLessThan(JSON.stringify(fee.schema).length);
  expect(general.system.length).toBeLessThan(fee.system.length);expect(call).toHaveBeenCalledTimes(2);
 });
 it.each([1,4663,8453,999] as const)("saves every rule on chain%i before compilation and never calls the fee compiler",async chainId=>{
  const events:string[]=[],call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(generated()),fee=vi.fn();
  const value=await runCustomAI({...request,coin:applyCoinSetupPatch(EMPTY_COIN_SETUP,{chainId})},undefined,{call,compile:fee,compileProject:async project=>{events.push("compile");return compile(project);}},{
   saveProject:async project=>{events.push("source");expect(project.chainId).toBe(chainId);expect(project.intent.requirements.map(r=>r.id)).toEqual(["counter","no-owner"]);},
   saveCompilation:async checked=>{events.push("artifacts");expect(checked.launchReady).toBe(false);},
  });
  expect(events).toEqual(["source","compile","artifacts"]);expect(call).toHaveBeenCalledTimes(2);expect(fee).not.toHaveBeenCalled();
  expect(value.generalProject?.sourceFiles).toBe(1);expect(value.generalProject?.verification).toBe("not-run");expect(JSON.stringify(value.generalProject)).not.toContain(source);expect(value.selection?.route).toBe("custom-contract");expect(value.draft).toBeUndefined();expect(value.chargedAs).toBe("build");
 });
 it.each([8453,999] as const)("cannot route even a proposed complete fee template on chain%i into another chain's fixed core",async chainId=>{
  const call=vi.fn().mockResolvedValueOnce(plan({executionRoute:"fee-module",feeChecks:[{afterSeconds:0,buy:true,totalFeeBps:100},{afterSeconds:0,buy:false,totalFeeBps:100}]})).mockResolvedValueOnce(generated()),fee=vi.fn();
  const value=await runCustomAI({...request,coin:applyCoinSetupPatch(EMPTY_COIN_SETUP,{chainId})},undefined,{call,compile:fee,compileProject:compile},{saveProject:async()=>{}});
  expect(value.selection).toMatchObject({route:"custom-contract",chainId,reason:"no-fee-core-on-network"});expect(fee).not.toHaveBeenCalled();expect(call).toHaveBeenCalledTimes(2);
 });
 it("does not spend a generation when the durable project connection is missing",async()=>{
  const call=vi.fn(async()=>plan()),fee=vi.fn(),compiler=vi.fn(compile);
  const value=await runCustomAI(request,undefined,{call,compile:fee,compileProject:compiler});
  expect(value.change).toBe("blocked");expect(value.intent?.requirements).toHaveLength(2);expect(value.generalProject).toBeUndefined();expect(call).toHaveBeenCalledTimes(1);expect(fee).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();
 });
 it("continues from its owned source after more than one saved clarification revision",async()=>{
  const previous=prior(),latest={...structuredClone(previous.project.intent),revision:"c".repeat(64),parentRevision:"b".repeat(64)},fee=vi.fn();
  const call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(generated()),save=vi.fn<(project:ContractProject)=>Promise<void>>(async()=>{});
  const value=await runCustomAI(request,undefined,{call,compile:fee,compileProject:compile},{intent:latest,generalProject:previous,saveProject:save});
  expect(value.intent?.id).toBe(latest.id);expect(value.intent?.requirements.map(rule=>rule.id)).toEqual(["counter","no-owner"]);
  expect(save.mock.calls[0][0].intent).toEqual(value.intent);expect(previous.project.intent.revision).toBe("a".repeat(64));
  expect(call).toHaveBeenCalledTimes(2);expect(fee).not.toHaveBeenCalled();
 });
 it("routes a proposed template missing a saved constraint to the complete contract path",async()=>{
  const call=vi.fn().mockResolvedValueOnce(plan({executionRoute:"fee-module",requirements:[requirements[0].text],feeChecks:[{afterSeconds:0,buy:true,totalFeeBps:100},{afterSeconds:0,buy:false,totalFeeBps:100}]})).mockResolvedValueOnce(generated());
  const fee=vi.fn(),save=vi.fn(async()=>{});
  const value=await runCustomAI(request,undefined,{call,compile:fee,compileProject:compile},{saveProject:save});
  expect(value.intent?.requirements.map(r=>r.id)).toEqual(["counter","no-owner"]);expect(value.generalProject?.intentRevision).toBe(value.intent?.revision);expect(fee).not.toHaveBeenCalled();expect(save).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(2);
 });
 it("keeps material choices open without generating an executable subset",async()=>{
  const call=vi.fn(async()=>plan({intentRequirements:requirements.map(r=>r.id==="counter"?{...r,open:"Who may increment?"}:r)})),save=vi.fn(async()=>{}),compiler=vi.fn(compile);
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},{saveProject:save});
  expect(value.change).toBe("blocked");expect(value.intent?.requirements).toHaveLength(2);expect(value.unresolved).toContain("Who may increment?");expect(call).toHaveBeenCalledTimes(1);expect(save).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();
 });
 it("rejects a generated source package which omits the explicit negative constraint",async()=>{
  const call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(generated(["counter"])),save=vi.fn(async()=>{}),compiler=vi.fn(compile);
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},{saveProject:save})).rejects.toMatchObject({code:"project-response"});
  expect(save).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();expect(call).toHaveBeenCalledTimes(2);
 });
 it("retains saved source after compiler failure without a paid repair loop",async()=>{
  const call=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(generated()),save=vi.fn(async()=>{}),compiler=vi.fn(async()=>{throw Error("Compiler temporarily unavailable");});
  await expect(runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:compiler},{saveProject:save})).rejects.toThrow("Compiler temporarily unavailable");
  expect(save).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(2);expect(compiler).toHaveBeenCalledTimes(1);
 });
 it("answers from complete saved rules without copying general source into an ordinary follow-up",async()=>{
  const previous=prior(),call=vi.fn<(input:ClaudeInput)=>Promise<ClaudeResult>>(async()=>plan({action:"answer",intentRequirements:[],requirements:[]})),save=vi.fn(async()=>{});
  const value=await runCustomAI({...request,messages:[{role:"user",content:"Summarize our agreed behavior in one sentence."}]},undefined,{call,compile:vi.fn()},{generalProject:previous,saveProject:save});
  expect(value.intent).toEqual(previous.project.intent);expect(value.generalProject).toBeUndefined();expect(save).not.toHaveBeenCalled();expect(call).toHaveBeenCalledTimes(1);
  const input=call.mock.calls[0][0] as {system:string};expect(input.system).toContain(previous.project.hash);expect(input.system).toContain('"sourceIncluded":false');expect(input.system).not.toContain(source);
 });
 it("rejects a stale selected general rule before any model call",async()=>{
  const previous=prior(),call=vi.fn();
  await expect(runCustomAI({...request,draftId:"owned-general-source-0001",editTarget:{sourceHash:"c".repeat(64),requirementId:"counter"}},undefined,{call,compile:vi.fn()},{generalProject:previous})).rejects.toMatchObject({code:"edit",status:409});expect(call).not.toHaveBeenCalled();
 });
 it("does not read the larger checkpoint for a normal question, but reads it once for explicit source inspection",async()=>{
  const previous=prior(),view=generalProjectView(previous),load=vi.fn(async()=>previous);
  const call=vi.fn<(input:ClaudeInput)=>Promise<ClaudeResult>>(async()=>plan({action:"answer",intentRequirements:[],requirements:[]}));
  const context={intent:previous.project.intent,generalProjectView:view,loadGeneralProject:load};
  await runCustomAI({...request,messages:[{role:"user",content:"Explain our agreed rule in one sentence."}]},undefined,{call,compile:vi.fn()},context);
  expect(load).not.toHaveBeenCalled();expect(call.mock.calls[0][0].system).not.toContain(source);
  await runCustomAI({...request,messages:[{role:"user",content:"Inspect the Solidity source."}]},undefined,{call,compile:vi.fn()},context);
  expect(load).toHaveBeenCalledTimes(1);expect(call.mock.calls[1][0].system).toContain(source);
 });
 it("rejects a mismatched checkpoint before model use and never substitutes another source",async()=>{
  const previous=prior(),view=generalProjectView(previous),call=vi.fn();
  await expect(runCustomAI({...request,messages:[{role:"user",content:"Inspect the source."}]},undefined,{call,compile:vi.fn()},{intent:previous.project.intent,generalProjectView:{...view,artifactHash:`sha256:${"c".repeat(64)}`},loadGeneralProject:async()=>previous})).rejects.toMatchObject({code:"project-context",status:409});expect(call).not.toHaveBeenCalled();
 });
 it("keeps large source and bytecode out of the browser projection while retaining exact references",()=>{
  const previous=prior(),content=source+"\n//"+"private-source".repeat(5000);
  const project=createContractProject({compiler:previous.project.compiler,sources:{"Counter.sol":{content}},entrypoints:previous.project.entrypoints},previous.project.intent,1);
  const bytecode=`0x${"ab".repeat(24_000)}` as `0x${string}`;
  const body={version:1 as const,projectHash:project.hash,compiler:GENERAL_PROJECT_COMPILER,compiled:true,diagnostics:[],contracts:[{...project.entrypoints[0],abi:[],creationBytecode:bytecode,runtimeBytecode:bytecode,immutableReferences:{},storageLayout:{}}],verification:"not-run" as const,launchReady:false as const};
  const full={...previous,project,compilation:{...body,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",body)}},view=generalProjectView(full),serialized=JSON.stringify(view);
  expect(view.projectHash).toBe(project.hash);expect(view.artifactHash).toBe(full.compilation.artifactHash);expect(view.sourceBytes).toBe(new TextEncoder().encode(content).length);
  expect(serialized.length).toBeLessThan(2000);expect(serialized).not.toContain("private-source");expect(serialized).not.toContain("ab".repeat(128));expect(view).not.toHaveProperty("sources");expect(view).not.toHaveProperty("contracts");expect(full.project.sources["Counter.sol"].content).toBe(content);expect(view.launchReady).toBe(false);
 });
});
