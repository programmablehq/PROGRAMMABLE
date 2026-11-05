import {describe,it,expect,vi,beforeEach} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({compile:vi.fn()}));
vi.mock("../lib/custom-ai/lifecycle.server",()=>({compileLaunchDraft:mocks.compile}));
import {normalizeRuleSpec} from "../lib/custom-ai/rule-spec";
import {ruleExpectations,compileRuleSpec} from "../lib/custom-ai/rule-compiler.server";
import {runCustomAI} from "../lib/custom-ai/service.server";
import {completedBuildReply} from "../lib/custom-ai/build-result";
import {parseRulePlan} from "../lib/custom-ai/rules";
const rule={id:"fee",text:"Fees fall from 2% to 0.5% over one day, then stay at 0.5%."};
const spec=normalizeRuleSpec({version:2,requirements:[rule],creatorShareBps:10000,actions:[],phases:[
 {id:"fall",startsAtSeconds:0,endsAtSeconds:86400,fee:{kind:"ramp",fromBuyBps:200,toBuyBps:50,fromSellBps:200,toSellBps:50,durationSeconds:86400},requirementIds:["fee"]},
 {id:"steady",startsAtSeconds:86400,endsAtSeconds:null,fee:{kind:"fixed",buyBps:50,sellBps:50},requirementIds:["fee"]},
]});
const checks=[{afterSeconds:0,buy:true,totalFeeBps:200},{afterSeconds:0,buy:false,totalFeeBps:200},{afterSeconds:21600,buy:true,totalFeeBps:163},{afterSeconds:86400,buy:false,totalFeeBps:50}];
const initialContent="Build a hook with fees from 2% to 0.5% over one day, then keep 0.5%.";
const plan=(patch:Record<string,unknown>={})=>({text:JSON.stringify({reply:"I will build the fee curve now.",replyLocale:"en",action:"build",intentMode:"revise",memory:"",executionRoute:"composed-module",
 intentRequirements:[{...rule,kind:"behavior",instruction:initialContent,open:null}],ruleEdits:[],implementedRequirementIds:["fee"],feeChecks:checks,
 composable:JSON.stringify(spec),program:null,eventRule:null,setupPatch:{},lookups:[],productPlan:null,...patch}),inputTokens:1,outputTokens:1});
const initialRequest={id:"structured-fees-00001",intent:"chat" as const,messages:[{role:"user" as const,content:initialContent}]};
beforeEach(()=>{mocks.compile.mockReset();mocks.compile.mockImplementation(async(source,_signal,expectations,_feed,composable)=>({
 source,sourceHash:"a".repeat(64),compiled:true,diagnostics:[],composable,
 validation:{version:"self-contained-fee-v1",status:"passed",artifactHash:"fixture",cases:expectations.length*4,expectationCases:expectations.length*4,samples:[],deployments:[]},
 lifecycle:{status:"passed",scope:"isolated-core-with-synthetic-quotes",bundleHash:"fixture",cases:1,diagnostics:[],scenarios:[]},
}));});
describe("structured fee schedules",()=>{
 it("retains independent requested samples alongside generated boundaries",()=>{
  const expectations=ruleExpectations(spec,[],checks);
  expect(expectations).toContainEqual(expect.objectContaining(checks[2]));
  expect(expectations.filter(row=>row.afterSeconds===0&&row.buy)).toHaveLength(1);
 });
 it("does not compile a rule that conflicts with independent expected fees",async()=>{
  await expect(compileRuleSpec(spec,1,[],undefined,[{afterSeconds:43200,buy:true,totalFeeBps:126}])).rejects.toThrow();
  expect(mocks.compile).not.toHaveBeenCalled();
 });
 it("builds and verifies a complete fee schedule from one model response",async()=>{
  const call=vi.fn(async()=>plan());
  const sourceCompiler=vi.fn();
  const result=await runCustomAI(initialRequest,undefined,{call,compile:sourceCompiler});
  expect(call).toHaveBeenCalledOnce();expect(sourceCompiler).not.toHaveBeenCalled();expect(mocks.compile).toHaveBeenCalledOnce();
  expect(result.draft?.verification?.status).toBe("passed");
  expect(result.draft?.verification?.checks).toContainEqual(expect.objectContaining(checks[2]));
  expect(result.productBlueprint?.components.map(component=>component.id)).toEqual(["fixed-fee-module"]);
  expect(result.reply).toBe(completedBuildReply());
 });
 it("applies a short timer edit to the saved curve including its final phase",async()=>{
  const first=await runCustomAI(initialRequest,undefined,{call:async()=>plan(),compile:vi.fn()});
  mocks.compile.mockClear();
  const content="make that 12 hours";
  const next=structuredClone(spec);
  next.requirements[0].text="Fees fall from 2% to 0.5% over 12 hours, then stay at 0.5%.";
  next.phases[0].endsAtSeconds=43200;
  if(next.phases[0].fee.kind!=="ramp")throw Error("Expected the saved ramp");
  next.phases[0].fee.durationSeconds=43200;
  next.phases[1].startsAtSeconds=43200;
  const call=vi.fn(async()=>plan({composable:JSON.stringify(next),
   intentRequirements:[{...next.requirements[0],kind:"behavior",instruction:content,open:null}],
   ruleEdits:[{requirementId:"fee",operation:"replace",instruction:content}],
   feeChecks:[...checks.slice(0,2),{afterSeconds:21600,buy:true,totalFeeBps:125},{afterSeconds:43200,buy:false,totalFeeBps:50}]}));
  const result=await runCustomAI({...initialRequest,id:"structured-fees-edit-01",contextId:initialRequest.id,draftId:initialRequest.id,
   messages:[...initialRequest.messages,{role:"user",content}]},undefined,{call,compile:vi.fn()},
   {intent:first.intent,draft:first.draft,productBlueprint:first.productBlueprint});
  expect(result.change).toBe("applied");expect(call).toHaveBeenCalledOnce();expect(mocks.compile).toHaveBeenCalledOnce();
  expect(result.ruleSpec).toEqual(next);
  expect(result.draft?.verification?.checks).toContainEqual(expect.objectContaining({afterSeconds:21600,buy:true,totalFeeBps:125}));
  expect(result.intent?.changes).toMatchObject([{requirementId:"fee",operation:"replace",origin:{quote:content}}]);
 });
 it("renames a checked coin without rebuilding or changing the agreed curve",async()=>{
  const first=await runCustomAI(initialRequest,undefined,{call:async()=>plan(),compile:vi.fn()});
  mocks.compile.mockClear();
  const call=vi.fn(async()=>plan({reply:"Renamed to Daylight.",action:"answer",intentMode:"preserve",intentRequirements:[],
   implementedRequirementIds:[],feeChecks:[],composable:"null",setupPatch:{name:"Daylight"}}));
  const result=await runCustomAI({...initialRequest,id:"structured-fees-name-01",contextId:initialRequest.id,draftId:initialRequest.id,
   messages:[...initialRequest.messages,{role:"user",content:"Call it Daylight instead"}]},undefined,{call,compile:vi.fn()},
   {intent:first.intent,draft:first.draft,productBlueprint:first.productBlueprint});
  expect(result.setupPatch).toEqual({name:"Daylight"});expect(result.intent).toBe(first.intent);
  expect(result.ruleSpec).toEqual(first.ruleSpec);expect(result.draft).toBeUndefined();
  expect(call).toHaveBeenCalledOnce();expect(mocks.compile).not.toHaveBeenCalled();
 });
 it("does not treat a serialized null program as a complete build",()=>{
  expect(()=>parseRulePlan({reply:"Building",action:"build",memory:"",requirements:[rule.text],
   unresolved:[],lookups:[],feeChecks:[],composable:"null"})).toThrow("Both buy and sell rules");
 });
 it("updates shared fee-phase timing while preserving the recipient without an extra model call",async()=>{
  const shared=structuredClone(spec);
  const recipient={id:"recipient",text:"Additional fees go to the linked creator wallet."};
  shared.requirements.push(recipient);
  shared.phases.forEach(phase=>phase.requirementIds.push(recipient.id));
  const declared=shared.requirements.map(r=>({...r,kind:"behavior",instruction:initialContent,open:null}));
  const first=await runCustomAI(initialRequest,undefined,{call:async()=>plan({composable:JSON.stringify(shared),
   intentRequirements:declared,implementedRequirementIds:["fee","recipient"]}),compile:vi.fn()});
  mocks.compile.mockClear();
  const content="make that 12 hours";
  const next=structuredClone(shared);
  next.requirements[0].text="Fees fall from 2% to 0.5% over 12 hours, then stay at 0.5%.";
  next.phases[0].endsAtSeconds=43200;
  if(next.phases[0].fee.kind!=="ramp")throw Error("Expected ramp");
  next.phases[0].fee.durationSeconds=43200;next.phases[1].startsAtSeconds=43200;
  const relabeled=structuredClone(next);relabeled.requirements[0].id="fee-12h";
  relabeled.phases.forEach(phase=>phase.requirementIds=phase.requirementIds.map(id=>id==="fee"?"fee-12h":id));
  const call=vi.fn(async()=>plan({composable:JSON.stringify(relabeled),implementedRequirementIds:["fee-12h","recipient"],
   intentRequirements:relabeled.requirements.map(r=>({...r,kind:"behavior",instruction:r.id==="fee-12h"?content:"",open:null})),
   ruleEdits:[{requirementId:"fee",operation:"remove",instruction:content},{requirementId:"fee-12h",operation:"replace",instruction:content}],
   feeChecks:[...checks.slice(0,2),{afterSeconds:21600,buy:true,totalFeeBps:125},{afterSeconds:43200,buy:false,totalFeeBps:50}]}));
  const result=await runCustomAI({...initialRequest,id:"shared-phase-edit-01",contextId:initialRequest.id,draftId:initialRequest.id,
   messages:[...initialRequest.messages,{role:"user",content}]},undefined,{call,compile:vi.fn()},
   {intent:first.intent,draft:first.draft,productBlueprint:first.productBlueprint});
  expect(call).toHaveBeenCalledOnce();expect(mocks.compile).toHaveBeenCalledOnce();
  expect(result.change).toBe("applied");expect(result.ruleSpec).toEqual(next);
  expect(result.intent?.changes.map(change=>change.requirementId)).toEqual(["fee"]);
 });
 it("keeps the last accepted intent when an edit changes an unrelated saved phase",async()=>{
  const saved=structuredClone(spec);
  saved.requirements.push({id:"later",text:"Keep the later fee phase unchanged."});
  saved.phases[1].requirementIds=["later"];
  const first=await runCustomAI(initialRequest,undefined,{call:async()=>plan({composable:JSON.stringify(saved),
   intentRequirements:saved.requirements.map(r=>({...r,kind:"behavior",instruction:initialContent,open:null})),
   implementedRequirementIds:["fee","later"]}),compile:vi.fn()});
  const next=structuredClone(saved);next.phases[1].startsAtSeconds=90000;next.phases[0].endsAtSeconds=90000;
  if(next.phases[0].fee.kind!=="ramp")throw Error("Expected ramp");
  next.phases[0].fee.durationSeconds=90000;
  next.requirements[0].text="Extend the first phase.";
  const content="Extend the first phase";
  const result=await runCustomAI({...initialRequest,id:"rejected-edit-0001",contextId:initialRequest.id,draftId:initialRequest.id,
   messages:[...initialRequest.messages,{role:"user",content}]},undefined,{call:async()=>plan({composable:JSON.stringify(next),
    intentRequirements:next.requirements.map(r=>({...r,kind:"behavior",instruction:r.id==="fee"?content:"",open:null})),
    ruleEdits:[{requirementId:"fee",operation:"replace",instruction:content}],implementedRequirementIds:["fee","later"]}),compile:vi.fn()},
   {intent:first.intent,draft:first.draft,productBlueprint:first.productBlueprint});
  expect(result.change).toBe("blocked");expect(result.intent?.revision).toBe(first.intent?.revision);
  expect(result.ruleSpec).toEqual(saved);expect(result.draft).toBeUndefined();
 });
 it("does not turn failed source checks into a completion message",async()=>{
  mocks.compile.mockResolvedValueOnce({source:"invalid",sourceHash:"a".repeat(64),compiled:false,diagnostics:["Invalid fee curve"],validation:{status:"failed"}});
  const result=await runCustomAI(initialRequest,undefined,{call:async()=>plan(),compile:vi.fn()});
  expect(result.change).toBe("blocked");expect(result.reply).not.toBe(completedBuildReply());expect(result.draft).toBeUndefined();
 });
});
