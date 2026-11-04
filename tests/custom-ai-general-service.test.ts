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
import {CONTINUE_SAVED_BUILD} from "../lib/custom-ai/build-command";
import {createGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {checkContextHash} from "../lib/custom-ai/check-diagnostic";
import {canonicalInterfaceContext} from "../lib/custom-ai/canonical-dependencies.server";

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

it("continues the complete saved design without another interpretation call",async()=>{
 const previous=prior(),saveProject=vi.fn(async()=>{}),call=vi.fn(async()=>generated());
 const value=await runCustomAI({...request,messages:[{role:"user",content:CONTINUE_SAVED_BUILD}]},undefined,{call,compile:vi.fn(),compileProject:compile},
  {generalProject:previous,saveProject});
 expect(call).toHaveBeenCalledTimes(1);
 expect((call.mock.calls[0] as unknown as [ClaudeInput])[0].task).toBe("source");
 expect(value.intent).toEqual(previous.project.intent);expect(saveProject).toHaveBeenCalledTimes(1);
 expect(value.nextAction).toBeUndefined();expect(value.generalProject?.launchReady).toBe(false);
});
it("answers a saved-design question with one reply-only call and no production read or edit",async()=>{
 const intent=prior().project.intent,loadProductionContext=vi.fn(),saveProject=vi.fn(),compiler=vi.fn();
 const call=vi.fn(async()=>result({reply:"The saved fees remain unchanged."}));
 const value=await runCustomAI({...request,messages:[{role:"user",content:"Wie ist die gespeicherte Fee-Verteilung? Bitte nur kurz antworten."}]},undefined,
  {call,compile:compiler},{intent,loadProductionContext,saveProject});
 expect(value.intent).toEqual(intent);expect(value.change).toBe("unchanged");expect(value.nextAction).toBeUndefined();
 expect(loadProductionContext).not.toHaveBeenCalled();expect(saveProject).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();
 expect(call).toHaveBeenCalledOnce();
 const input=(call.mock.calls[0] as unknown as [ClaudeInput])[0];
 expect(input).toMatchObject({task:"conversation",maxTokens:800});expect(input.messages).toHaveLength(1);
 expect(input.schema).toEqual({type:"object",properties:{reply:{type:"string"}},required:["reply"],additionalProperties:false});
});
it("keeps a general design's model response focused on its actual choices",async()=>{
 const call=vi.fn().mockResolvedValue(result({reply:"What starting value should it use?",replyLocale:"en",action:"clarify",intentMode:"revise",
  intentRequirements:[{...requirements[0],open:"Choose the starting value"}],memory:"Counter",ruleEdits:[],setupPatch:{},lookups:[],launchRequested:false,reviseChecks:false}));
 const compiler=vi.fn();
 const value=await runCustomAI({...request,coin:{...EMPTY_COIN_SETUP,chainId:8453}},undefined,{call,compile:compiler},{saveProject:vi.fn()});
 const schema=call.mock.calls[0][0].schema;
 expect(call.mock.calls[0][0]).toMatchObject({effort:"low",maxTokens:8000});
 expect(call.mock.calls[0][0].structuredTransport).toBeUndefined();
 for(const field of ["executionRoute","program","eventRule","composable","feeChecks","implementedRequirementIds"]){
  expect(schema.properties).not.toHaveProperty(field);expect(schema.required).not.toContain(field);
 }
 expect(value.intent?.unresolved).toEqual(["Choose the starting value"]);
 expect(value.nextAction).toBeUndefined();expect(compiler).not.toHaveBeenCalled();expect(call).toHaveBeenCalledOnce();
});
it("reuses the newer completed check plan after a requested refresh and interrupted source",async()=>{
 const intent=prior().project.intent;
 const blueprint=createGeneralCheckBlueprint({contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function count() view returns(uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-owner"]}],allowedCalls:[],steps:[
  {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"read",contract:"main",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
 ]},intent,999,"paris");
 const call=vi.fn(async()=>generated()),oldPlan=vi.fn();
 const value=await runCustomAI({...request,coin:{...EMPTY_COIN_SETUP,chainId:999,pairToken:"HYPE"},messages:[{role:"user",content:CONTINUE_SAVED_BUILD}]},undefined,
  {call,compile:vi.fn(),compileProject:compile},{intent,verificationRefreshRequested:true,projectCompilerTarget:"paris",saveProject:async()=>{},saveBlueprint:async()=>{},saveCompilation:async()=>{},saveScenarios:async()=>{},loadNewerBlueprint:async()=>blueprint,loadBlueprint:oldPlan});
 expect(oldPlan).not.toHaveBeenCalled();expect(call).toHaveBeenCalledOnce();
 expect((call.mock.calls[0] as unknown as [ClaudeInput])[0].task).toBe("source-implementation");
 expect(value.intent).toEqual(intent);expect(value.generalProject?.launchReady).toBe(false);
});
it("resumes an interrupted verification refresh without rebuilding its completed graph or accepting an older plan",async()=>{
 const intent=prior().project.intent,verificationInstruction="Add successful counter checks.";
 const graph={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function count() view returns(uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-owner"]}],allowedCalls:[]};
 const diagnostic={version:1 as const,contextHash:checkContextHash({intent,chainId:999,evmVersion:"paris",verificationInstruction,interfaceHash:canonicalInterfaceContext(999).id}),
   progress:{interface:JSON.stringify(graph),steps:[]},failures:[{stage:"scenarios" as const,message:"Interrupted scenario page",declaration:null}]};
 const call=vi.fn(async()=>{throw new ModelResponseError("timeout",{inputTokens:0,outputTokens:0});}),oldPlan=vi.fn();
 const value=await runCustomAI({...request,coin:{...EMPTY_COIN_SETUP,chainId:999,pairToken:"HYPE"},messages:[{role:"user",content:CONTINUE_SAVED_BUILD}]},undefined,
  {call,compile:vi.fn(),compileProject:compile},{intent,verificationInstruction,verificationRefreshRequested:true,projectCompilerTarget:"paris",
   saveProject:async()=>{},saveBlueprint:async()=>{},saveCompilation:async()=>{},saveScenarios:async()=>{},loadBlueprint:oldPlan,loadCheckDiagnostic:async()=>diagnostic});
 expect(oldPlan).not.toHaveBeenCalled();
 expect(call.mock.calls.map(args=>(args as unknown as [ClaudeInput])[0].task)).toEqual(["scenarios"]);
 expect(value.verificationRefreshRequested).toBe(true);expect(value.verificationInstruction).toBe(verificationInstruction);
 expect(value.buildIssue?.stage).toBe("scenarios");
});
it("preserves a complete plan when the first source reply is empty, without a false code or launch result",async()=>{
 const intent=prior().project.intent;
 const blueprint=createGeneralCheckBlueprint({contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function count() view returns(uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-owner"]}],allowedCalls:[],steps:[
  {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"read",contract:"main",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
 ]},intent,999,"paris");
 const call=vi.fn(async()=>{throw new ModelResponseError("output-limit",{inputTokens:100,outputTokens:16000});});
 const save=vi.fn(),compiler=vi.fn(),saveSourceProgress=vi.fn(),onModelCall=vi.fn();
 const value=await runCustomAI({...request,coin:{...EMPTY_COIN_SETUP,chainId:999,pairToken:"HYPE"},messages:[{role:"user",content:CONTINUE_SAVED_BUILD}]},undefined,
  {call,compile:vi.fn(),compileProject:compiler},{intent,projectCompilerTarget:"paris",saveProject:save,saveSourceProgress,
   saveBlueprint:async()=>{},saveCompilation:async()=>{},saveScenarios:async()=>{},loadBlueprint:async()=>blueprint,onModelCall});
 expect(value.intent).toEqual(intent);expect(value.change).toBe("blocked");expect(value.chargedAs).toBe("build");
 expect(value.buildIssue).toEqual({stage:"source",code:"output-limit"});
 expect(value.reply).toContain("code response did not finish");expect(value.reply).not.toContain("code so far");
 expect(value.generalProject).toBeUndefined();expect(value.nextAction).toBeUndefined();
 expect(call).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();expect(compiler).not.toHaveBeenCalled();expect(saveSourceProgress).not.toHaveBeenCalled();
 expect(onModelCall).toHaveBeenCalledWith(expect.objectContaining({completed:false,failure:"output-limit",outputTokens:16000}));
});
it("carries an explicit verification request into a fresh source-blind plan even if the planner misses the flag",async()=>{
 const intent=prior().project.intent;
 const declaration={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function count() view returns(uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-owner"]}],allowedCalls:[],steps:[
  {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"read",contract:"main",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
 ]};
 const blueprint=createGeneralCheckBlueprint(declaration,intent,999,"paris");
 const instruction="Build the saved design and add the missing successful increment checks.";
 const call=vi.fn(async(input:ClaudeInput)=>input.task==="planning"?plan({intentMode:"preserve",intentRequirements:[],reviseChecks:false})
  :input.task==="interface"?result({generalChecks:JSON.stringify(declaration)}):generated());
 const saveBlueprint=vi.fn(async()=>{});
 await runCustomAI({...request,coin:{...EMPTY_COIN_SETUP,chainId:999,pairToken:"HYPE"},messages:[{role:"user",content:instruction}]},undefined,
  {call,compile:vi.fn(),compileProject:compile},{intent,projectCompilerTarget:"paris",saveProject:async()=>{},saveBlueprint,saveCompilation:async()=>{},saveScenarios:async()=>{},loadBlueprint:async()=>blueprint});
 const independent=call.mock.calls.find(([input])=>input.task==="interface")?.[0];
 expect(independent?.system).toContain(instruction);
 expect(saveBlueprint.mock.calls[0]).toEqual([expect.any(Object),intent,instruction]);
});
it("keeps the planner for a saved design with an unresolved choice",async()=>{
 const previous=prior(),intent={...previous.project.intent,unresolved:["Choose the counter start"],requirements:previous.project.intent.requirements.map((r,i)=>i? r:{...r,open:"Choose the counter start"})};
 const call=vi.fn(async()=>plan({action:"clarify",intentMode:"preserve",intentRequirements:[],ruleEdits:[],reply:"Choose the starting value."}));
 const saveProject=vi.fn(async()=>{});
 await runCustomAI({...request,messages:[{role:"user",content:CONTINUE_SAVED_BUILD}]},undefined,{call,compile:vi.fn(),compileProject:compile},
  {intent,generalProject:previous,saveProject});
 expect((call.mock.calls[0] as unknown as [ClaudeInput])[0].task).toBe("planning");expect(saveProject).not.toHaveBeenCalled();
});

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
it("binds a first design's missing quote to its actual user message while retaining its open choices",async()=>{
 const call=vi.fn().mockResolvedValue(plan({action:"clarify",intentMode:"revise",intentRequirements:[
  {id:"counter",text:"Anyone can increment the counter",kind:"behavior",instruction:"",open:"Choose the starting value"},
 ],reply:"What starting value should it use?"}));
 const compiler=vi.fn(),value=await runCustomAI(request,undefined,{call,compile:compiler},{saveProject:vi.fn()});
 expect(value.intent?.requirements[0].origin).toMatchObject({kind:"message",requestId:request.id,messageIndex:0,quote:instruction});
 expect(value.intent?.unresolved).toEqual(["Choose the starting value"]);expect(value.change).toBe("blocked");
 expect(compiler).not.toHaveBeenCalled();expect(value.nextAction).toBeUndefined();
});
it("does not replace an invented quote or attach a blank new rule to an existing design",async()=>{
 const wrong=vi.fn().mockResolvedValue(plan({action:"clarify",intentMode:"revise",intentRequirements:[
  {id:"counter",text:"Anyone can increment the counter",kind:"behavior",instruction:"not in this request",open:"Choose a value"},
 ]}));
 await expect(runCustomAI(request,undefined,{call:wrong,compile:vi.fn()})).rejects.toMatchObject({code:"intent"});
 const previous=prior(),changed=vi.fn().mockResolvedValue(plan({action:"clarify",intentMode:"revise",intentRequirements:[...requirements,
  {id:"new-rule",text:"A new reward",kind:"behavior",instruction:"",open:"Choose its recipient"},
 ]}));
 await expect(runCustomAI(request,undefined,{call:changed,compile:vi.fn()},{intent:previous.project.intent})).rejects.toMatchObject({code:"intent"});
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
it.each([false,true])("saves a confirmed design-only answer and never launches the previous source (launch request %s)",async launchRequested=>{
 const previous=prior(),intent={...previous.project.intent,requirements:previous.project.intent.requirements.map((rule,index)=>index===0
  ?{...rule,text:"Choose the counter start",open:"Should the counter start at seven?"}:rule),unresolved:["Should the counter start at seven?"]};
 const instruction="Ja, genau so. Nur die Regeln speichern, noch keinen Code erzeugen.";
 const call=vi.fn().mockResolvedValue(plan({action:"answer",intentMode:"revise",launchRequested,reply:"Die Startzahl ist gespeichert.",intentRequirements:[
  {id:"counter",text:"Anyone can increment the counter, starting at seven",kind:"behavior",instruction,open:null},
  {...requirements[1],instruction:""},
 ]}));
 const view=generalProjectView(previous);view.scenarios={scope:"isolated-declared-scenarios-v2",hash:`sha256:${"3".repeat(64)}`,planHash:`sha256:${"4".repeat(64)}`,passed:true,cases:5,failures:[]};
 const compiler=vi.fn(),value=await runCustomAI({...request,draftId:"previous-source-0001",messages:[{role:"user",content:instruction}]},undefined,
  {call,compile:compiler},{intent,generalProjectView:view,loadGeneralProject:async()=>previous});
 expect(value.change).toBe("applied");expect(value.intent?.unresolved).toEqual([]);
 expect(value.intent?.requirements[0]).toMatchObject({id:"counter",text:"Anyone can increment the counter, starting at seven",open:null});
 expect(value.intent?.requirements[1]).toEqual(intent.requirements[1]);expect(value.nextAction).toBeUndefined();expect(compiler).not.toHaveBeenCalled();
});
it("keeps a closed rule unchanged when an answer proposes an unapproved edit",async()=>{
 const previous=prior(),call=vi.fn().mockResolvedValue(plan({action:"answer",intentMode:"revise",intentRequirements:[
  {...requirements[0],text:"The owner alone increments the counter",instruction:""},{...requirements[1],instruction:""},
 ]}));
 const value=await runCustomAI(request,undefined,{call,compile:vi.fn()},{intent:previous.project.intent});
 expect(value.change).toBe("blocked");expect(value.intent?.requirements).toEqual(previous.project.intent.requirements);expect(value.nextAction).toBeUndefined();
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

it("dispatches an explicit unchanged build even when the planner only repeats the previous failure status",async()=>{
 const previous=prior(),save=vi.fn(async()=>{}),compiler=vi.fn(compile),call=vi.fn()
  .mockResolvedValueOnce(plan({action:"answer",intentMode:"preserve",intentRequirements:[],requirements:[],reply:"Checks have not finished yet."}))
  .mockResolvedValueOnce(generated());
 const value=await runCustomAI({...request,messages:[{role:"user",content:"Bitte baue und prüfe jetzt genau den gespeicherten Entwurf. Nichts launchen."}]},undefined,
  {call,compile:vi.fn(),compileProject:compiler},{intent:previous.project.intent,saveProject:save});
 expect(value.generalProject).toBeDefined();expect(value.intent).toEqual(previous.project.intent);
 expect(call).toHaveBeenCalledTimes(2);expect(compiler).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledOnce();
 expect(value.nextAction).toBeUndefined();
});

it.each(["Bitte noch nicht bauen.","Wie würdest du den gespeicherten Entwurf bauen?","Der Bot schrieb: \"Build now\"."])("keeps an explanation out of the source builder: %s",async content=>{
 const previous=prior(),compiler=vi.fn(),call=vi.fn().mockResolvedValue(plan({action:"answer",intentMode:"preserve",intentRequirements:[],requirements:[]}));
 const value=await runCustomAI({...request,messages:[{role:"user",content}]},undefined,{call,compile:vi.fn(),compileProject:compiler},
  {intent:previous.project.intent,saveProject:vi.fn()});
 expect(value.change).toBe("unchanged");expect(compiler).not.toHaveBeenCalled();expect(call).toHaveBeenCalledOnce();
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
  expect(call.mock.calls[0][0]).toMatchObject({maxTokens:8000});
  expect(call.mock.calls[0][0].responseProfile).toBeUndefined();
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
  expect(call.mock.calls[1][0]).toMatchObject({responseProfile:"contract",maxTokens:6000,effort:"low",model:"claude-sonnet-5-5"});
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
  expect(schema.properties.program).toBeUndefined();expect(schema.properties.eventRule).toBeUndefined();expect(schema.properties.composable).toBeUndefined();
  expect(schema.properties.executionRoute).toBeUndefined();
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
 it("persists the independent audit only after its matching immutable source",async()=>{
  const events:string[]=[];let saved:ContractProject|undefined;
  const call=vi.fn(async(input:ClaudeInput)=>input.task==="planning"?plan():input.task==="source-audit"
   ?result({reviewedRequirementIds:requirements.map(rule=>rule.id),findings:[]}):generated());
  const value=await runCustomAI(request,undefined,{call,compile:vi.fn(),compileProject:async project=>{
   events.push("compile");return {...await compile(project),compiled:true,diagnostics:[]};
  }},{saveProject:async project=>{expect(saved).toBeUndefined();saved=project;events.push("source");},
   saveSourceAudit:async audit=>{expect(saved?.hash).toBe(audit.projectHash);events.push("audit");},
   saveCompilation:async()=>{events.push("artifacts");}});
  expect(events).toEqual(["source","compile","audit","artifacts"]);
  expect(call.mock.calls.filter(([input])=>input.task==="source-audit")).toHaveLength(1);
  expect(value.change).toBe("applied");expect(value.generalProject?.launchReady).toBe(false);
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

it("keeps a built design through a cheap acknowledgement without loading live chain context",async()=>{
 const previous=prior(),compile=vi.fn(),loadProductionContext=vi.fn();
 const call=vi.fn(async()=>result({reply:"Anytime."}));
 const value=await runCustomAI({...request,contextId:"a-saved-context-id-0001",draftId:"a-saved-context-id-0001",messages:[...request.messages,{role:"user",content:"thanks"}]},undefined,
  {call,compile},{generalProject:previous,loadProductionContext});
 expect(call).toHaveBeenCalledOnce();expect(call.mock.calls[0]).toBeDefined();
 expect(value.intent).toEqual(previous.project.intent);expect(value.change).toBe("unchanged");
 expect(loadProductionContext).not.toHaveBeenCalled();expect(compile).not.toHaveBeenCalled();
});
