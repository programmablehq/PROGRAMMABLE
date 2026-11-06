import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {hasInventedPlatformRate} from "../lib/custom-ai/planning-policy";
import {runCustomAI} from "../lib/custom-ai/service.server";
import {createLaunchProductionContext} from "../lib/custom-ai/launch-production";
import {EMPTY_COIN_SETUP} from "../lib/custom-ai/coin-setup";

it("detects a copied platform default without treating an explicit user rate as an assumption",()=>{
 expect(hasInventedPlatformRate(["Total swap fee is 2%, with the fixed 0.5% platform fee included."],"Use 2% total fees",3000)).toBe(true);
 expect(hasInventedPlatformRate(["Platform fee is 50 bps"],"Use 2% total fees",3000)).toBe(true);
 expect(hasInventedPlatformRate(["Plattformgebühr 0,5%"],"Zwei Prozent insgesamt",3000)).toBe(true);
 expect(hasInventedPlatformRate(["The fixed 0.3% platform fee is included."],"Use 2% total fees",3000)).toBe(false);
 expect(hasInventedPlatformRate(["The fixed 0.5% platform fee is included."],"I want a 0.5% platform fee",3000)).toBe(false);
 expect(hasInventedPlatformRate(["Total swap fee is 2%"],"Use 2% total fees",3000)).toBe(false);
});

const production=createLaunchProductionContext({version:1,chainId:1,route:"graph-v3",profileVersion:"3.6.0",
 poolManager:{address:`0x${"1".repeat(40)}`,runtimeCodeHash:`0x${"2".repeat(64)}`},executor:{address:`0x${"3".repeat(40)}`,runtimeCodeHash:`0x${"4".repeat(64)}`},
 graphProfile:{},manifestDigest:null,tradeFee:{policyVersion:"test.v1",ratePpm:3000,recipient:`0x${"5".repeat(40)}`,collection:"programmable-routed-native"},protections:null});
const user="Build 2% total swap fees with 30% of project fees in locked liquidity, 20% buyback and burn, 50% to me.";
const plan=(rate:string,project:string)=>({reply:"Building the fee split.",action:"build",executionRoute:"custom-contract",intentMode:"revise",
 intentRequirements:[{id:"fees",text:`Total swap fees are 2%, including a fixed ${rate}% platform fee.`,kind:"behavior",open:null,instruction:""},
 {id:"split",text:`The ${project}% project portion is split 30% to locked liquidity, 20% buyback and burn, 50% to the linked creator.`,kind:"behavior",open:null,instruction:""}],
 requirements:[],feeChecks:[],setupPatch:{},lookups:[],program:null,eventRule:null,composable:null,ruleEdits:[],memory:"",productPlan:null});

it("corrects a mistaken route assumption once before saving the canonical design",async()=>{
 const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify(plan("0.5","1.5")),outputTokens:300,inputTokens:1})
  .mockResolvedValueOnce({text:JSON.stringify(plan("0.3","1.7")),outputTokens:300,inputTokens:1});
 const result=await runCustomAI({id:"platform-policy-request-01",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:user}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async()=>production});
 expect(call).toHaveBeenCalledTimes(2);
 expect(call.mock.calls[1][0].system).toContain("tradeFee.ratePpm=3000");
 expect(call.mock.calls[1][0].system).not.toContain("Platform fee: 50 bps");
 expect(result.intent?.requirements.map(rule=>rule.text).join(" ")).toContain("fixed 0.3% platform fee");
 expect(result.intent?.requirements.map(rule=>rule.text).join(" ")).toContain("1.7% project portion");
 expect(result.selection?.route).toBe("custom-contract");
});

it("does not keep retrying if the interpreter repeats the incorrect default",async()=>{
 const call=vi.fn().mockResolvedValue({text:JSON.stringify(plan("0.5","1.5")),outputTokens:300,inputTokens:1});
 await expect(runCustomAI({id:"platform-policy-request-02",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:user}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async()=>production})).rejects.toMatchObject({code:"plan-policy"});
 expect(call).toHaveBeenCalledTimes(2);
});

it("keeps the complete custom design when a model also emits unused fixed-core fee examples",async()=>{
 const value={...plan("0.3","1.7"),feeChecks:[{afterSeconds:0,buy:true,totalFeeBps:200}]};
 const call=vi.fn().mockResolvedValue({text:JSON.stringify(value),outputTokens:300,inputTokens:1});
 const result=await runCustomAI({id:"platform-policy-request-03",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:user}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async()=>production});
 expect(call).toHaveBeenCalledTimes(1);expect(result.selection?.route).toBe("custom-contract");
 expect(result.intent?.requirements.map(rule=>rule.text)).toEqual(value.intentRequirements.map(rule=>rule.text));
});
