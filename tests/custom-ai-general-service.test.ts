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

describe("general source generation inside the owned chat job",()=>{
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
