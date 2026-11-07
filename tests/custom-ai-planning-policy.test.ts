import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {hasInventedPlatformRate,hasConflictingFeeMeaning,hasInventedFeeFloor} from "../lib/custom-ai/planning-policy";
import {runCustomAI} from "../lib/custom-ai/service.server";
import {createLaunchProductionContext} from "../lib/custom-ai/launch-production";
import {EMPTY_COIN_SETUP} from "../lib/custom-ai/coin-setup";
import {requiresCustomFeeContract} from "../lib/custom-ai/mechanism-knowledge";

it("uses the general route for requested buyback-and-burn without changing a plain fee request",()=>{
 expect(requiresCustomFeeContract("20% to buying back and burning this coin")).toBe(true);
 expect(requiresCustomFeeContract("20% buyback and burn, 80% to me")).toBe(true);
 expect(requiresCustomFeeContract("2% falling to zero in 24 hours")).toBe(false);
 expect(requiresCustomFeeContract("No buyback and burn; only pay my creator wallet")).toBe(false);
});

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

it("omits the competing fee-module schema from a fresh stateful build",async()=>{
 const call=vi.fn().mockResolvedValue({text:JSON.stringify(plan("0.3","1.7")),outputTokens:300,inputTokens:1});
 await runCustomAI({id:"platform-policy-request-04",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:user}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async()=>production});
 expect(call).toHaveBeenCalledTimes(1);
 expect(call.mock.calls[0][0].schema.properties).not.toHaveProperty("composable");
 expect(call.mock.calls[0][0].schema.properties).not.toHaveProperty("feeChecks");
 expect(call.mock.calls[0][0].system).not.toContain("Platform fee: 50 bps");
});

it("binds a first design to its owned message even when the model paraphrases a quote",async()=>{
 const value=plan("0.3","1.7");
 value.intentRequirements=value.intentRequirements.map(rule=>({...rule,instruction:"A paraphrase of the user's request."}));
 const call=vi.fn().mockResolvedValue({text:JSON.stringify(value),outputTokens:300,inputTokens:1});
 const result=await runCustomAI({id:"platform-policy-request-05",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:user}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async()=>production});
 for(const rule of result.intent!.requirements)expect(rule.origin).toMatchObject({kind:"message",quote:user});
 expect(call).toHaveBeenCalledTimes(1);
});

it("loads a changed chain before finalizing its fee policy",async()=>{
 const oldPlan={...plan("0.5","1.5"),action:"answer",setupPatch:{chainId:8453}};
 const corrected={...plan("0.3","1.7"),action:"answer",setupPatch:{}};
 const seen:number[]=[];
 const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify(oldPlan),outputTokens:300,inputTokens:1})
  .mockResolvedValueOnce({text:JSON.stringify(corrected),outputTokens:300,inputTokens:1});
 const result=await runCustomAI({id:"platform-chain-change-01",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:"Use Base instead. Plan 2% total fees, with 30% of project fees to locked liquidity, 20% buyback and burn, 50% to me. Discuss first, no build yet."}]},undefined,
  {call,compile:vi.fn()},{loadProductionContext:async chainId=>{seen.push(chainId);if(chainId===1)return production;const {id,...value}=production;void id;return createLaunchProductionContext({...value,chainId,
   tradeFee:{...value.tradeFee,collection:"pool-enforced-native"},protections:{openingFeePpm:10000,openingSeconds:60,buyerLimitBps:100,recipientLimitBps:200,protectionSeconds:60,maximumAdditionalTaxExemptWallets:10,minimumFdvUsd:"1000"}});}});
 expect(seen).toEqual([1,8453]);
 expect(result.setupPatch?.chainId).toBe(8453);
 expect(result.intent?.requirements.map(rule=>rule.text).join(" ")).toContain("fixed 0.3% platform fee");
 expect(call.mock.calls[1][0].system).toContain('"chainId":8453');
});

it("detects a project rate being relabelled as the total in the reply",()=>{
 expect(hasConflictingFeeMeaning(["Project swap fee is 2%, falling to 1% during rain."],"The 1% rate is the total fee during rain.")).toBe(true);
 expect(hasConflictingFeeMeaning(["Die Projektgebühr beträgt 2%."],"Die Gesamtgebühr beträgt 2%.")).toBe(true);
 expect(hasConflictingFeeMeaning(["Project swap fee is 2%, falling to 1% during rain."],"Project fees are 1% during rain, plus the platform fee.")).toBe(false);
 expect(hasConflictingFeeMeaning(["Project fee is 1%, total fee is 1.3%."],"Total fees are 1.3%.")).toBe(false);
 expect(hasConflictingFeeMeaning(["Project fee is 1%."],"The 1% is not the total fee; the platform component is separate.")).toBe(false);
});

it("repairs a reply that contradicts the saved project fee meaning",async()=>{
 const request="Plan a coin with a 2% project swap fee, falling to 1% in London rain. Project fees go to me. Don't build yet.";
 const value={...plan("0.3","2"),action:"answer",reply:"The 1% rate is the total fee during rain.",intentRequirements:[
  {id:"fees",text:"Project swap fee is 2%, falling to 1% during London rain.",kind:"behavior",open:null,instruction:""}]};
 const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify(value),outputTokens:200,inputTokens:1})
  .mockResolvedValueOnce({text:JSON.stringify({...value,reply:"Project fees are 1% during rain, plus the platform fee."}),outputTokens:200,inputTokens:1});
 const result=await runCustomAI({id:"project-fee-meaning-001",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:request}]},undefined,{call,compile:vi.fn()},{loadProductionContext:async()=>production});
 expect(result.reply).toBe("Project fees are 1% during rain, plus the platform fee.");
 expect(call).toHaveBeenCalledTimes(2);
});

it("checks an inferred minimum against the selected policy without changing an explicit endpoint",()=>{
 const request="Total fee starts at 2% and falls to the lowest permitted total fee after 24 hours.";
 expect(hasInventedFeeFloor(["Total fee falls linearly to 0.5% over 24 hours."],request,3000)).toBe(true);
 expect(hasInventedFeeFloor(["Total fee falls linearly to 0.3% over 24 hours."],request,3000)).toBe(false);
 expect(hasInventedFeeFloor(["Total fee falls linearly to 1% over 24 hours."],"Use a 2% total fee falling to 1%.",3000)).toBe(false);
 expect(hasInventedFeeFloor(["Total fee falls linearly to 1% over 24 hours."],"Use a 2% total fee falling to 1%, my chosen minimum fee.",3000)).toBe(false);
});

it("keeps a project endpoint separate from the total fee floor",()=>{
 const request="Die Gesamtgebühr soll auf die minimal erlaubte Gebühr sinken.";
 expect(hasInventedFeeFloor(["Die Gesamtgebühr fällt von 2 % auf 0,3 %. Die Projektgebühr fällt von 1,7 % auf 0 %."],request,3000)).toBe(false);
 expect(hasInventedFeeFloor(["Total fee falls to 0.3%, while the project fee falls to 0%."],"Total fee should fall to the minimum permitted fee.",3000)).toBe(false);
 expect(hasInventedFeeFloor(["Die Gesamtgebühr fällt von 2 % auf 0 %. Die Projektgebühr bleibt bei 0 %."],request,3000)).toBe(true);
});

it("retains the changed chain after a follow-up lookup",async()=>{
 const basePlan={...plan("0.3","1.7"),action:"answer",setupPatch:{chainId:8453}};
 const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify(basePlan),outputTokens:100,inputTokens:1})
  .mockResolvedValueOnce({text:JSON.stringify({...basePlan,lookups:[{kind:"catalog",input:{query:"example"}}]}),outputTokens:100,inputTokens:1})
  .mockResolvedValueOnce({text:JSON.stringify({...basePlan,setupPatch:{}}),outputTokens:100,inputTokens:1});
 const {id,...body}=production;void id;
 const base=createLaunchProductionContext({...body,chainId:8453,tradeFee:{...body.tradeFee,collection:"pool-enforced-native"},protections:{openingFeePpm:10000,openingSeconds:60,buyerLimitBps:100,recipientLimitBps:200,protectionSeconds:60,maximumAdditionalTaxExemptWallets:10,minimumFdvUsd:"1000"}});
 const result=await runCustomAI({id:"chain-lookup-retain-001",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:"Use Base instead. Plan 2% total fees with 30% liquidity, 20% buyback and burn and 50% to me. Find an example coin; don't build yet."}]},undefined,
  {call,compile:vi.fn(),lookup:async()=>({status:"found",facts:"No exact match",sources:[]})},{loadProductionContext:async chain=>chain===1?production:base});
 expect(result.setupPatch?.chainId).toBe(8453);
});

it("repairs a discussion clarification that omitted its canonical rules",async()=>{
 const value={...plan("0.3","1.7"),action:"clarify",intentRequirements:[],reply:"Should the joke appear in the description?"};
 const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify(value),inputTokens:1,outputTokens:100})
  .mockResolvedValueOnce({text:JSON.stringify({...plan("0.3","1.7"),action:"answer"}),inputTokens:1,outputTokens:100});
 const compile=vi.fn();
 const result=await runCustomAI({id:"discussion-missing-rules-01",intent:"chat",coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:"Plan a satirical coin with 2% total fees and 30% project fees to LP, 20% buyback and burn, 50% to me. Don't build yet."}]},undefined,{call,compile},{loadProductionContext:async()=>production});
 expect(result.intent?.requirements).toHaveLength(2);
 expect(call).toHaveBeenCalledTimes(2);expect(compile).not.toHaveBeenCalled();
});
