import {describe,it,expect,vi,beforeEach} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({compile:vi.fn()}));
vi.mock("../lib/custom-ai/lifecycle.server",()=>({compileLaunchDraft:mocks.compile}));
import {normalizeRuleSpec} from "../lib/custom-ai/rule-spec";
import {ruleExpectations,compileRuleSpec} from "../lib/custom-ai/rule-compiler.server";
import {runCustomAI} from "../lib/custom-ai/service.server";
const rule={id:"fee",text:"Fees fall from 2% to 0.5% over one day, then stay at 0.5%."};
const spec=normalizeRuleSpec({version:2,requirements:[rule],creatorShareBps:10000,actions:[],phases:[
 {id:"fall",startsAtSeconds:0,endsAtSeconds:86400,fee:{kind:"ramp",fromBuyBps:200,toBuyBps:50,fromSellBps:200,toSellBps:50,durationSeconds:86400},requirementIds:["fee"]},
 {id:"steady",startsAtSeconds:86400,endsAtSeconds:null,fee:{kind:"fixed",buyBps:50,sellBps:50},requirementIds:["fee"]},
]});
const checks=[{afterSeconds:0,buy:true,totalFeeBps:200},{afterSeconds:0,buy:false,totalFeeBps:200},{afterSeconds:21600,buy:true,totalFeeBps:163},{afterSeconds:86400,buy:false,totalFeeBps:50}];
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
  const content="Build a hook with fees from 2% to 0.5% over one day, then keep 0.5%.";
  const call=vi.fn(async()=>({text:JSON.stringify({reply:rule.text,action:"build",intentMode:"revise",memory:"",executionRoute:"composed-module",
   intentRequirements:[{...rule,kind:"behavior",instruction:content,open:null}],ruleEdits:[],implementedRequirementIds:["fee"],feeChecks:checks,
   composable:JSON.stringify(spec),program:null,eventRule:null,setupPatch:{},lookups:[],productPlan:null}),inputTokens:1,outputTokens:1}));
  const sourceCompiler=vi.fn();
  const result=await runCustomAI({id:"structured-fees-00001",intent:"chat",messages:[{role:"user",content}]},undefined,{call,compile:sourceCompiler});
  expect(call).toHaveBeenCalledOnce();expect(sourceCompiler).not.toHaveBeenCalled();expect(mocks.compile).toHaveBeenCalledOnce();
  expect(result.draft?.verification?.status).toBe("passed");
  expect(result.draft?.verification?.checks).toContainEqual(expect.objectContaining(checks[2]));
  expect(result.productBlueprint?.components.map(component=>component.id)).toEqual(["fixed-fee-module"]);
 });
});
