import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { keccak256, type Hex } from "viem";
import { TickMath } from "@uniswap/v3-sdk";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { deriveObservedOpeningInputs } from "../lib/custom-ai/opening-inputs.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";

const now=1_900_000_000_000,code="0x600860005260206000f3" as Hex;
function fixture(chain:1|4663|8453|999=1){
  const original=projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains],chain,protection);
  original.poolManager.runtimeCodeHash=keccak256(code);
  original.protectionBindings!.swapRouter.runtimeCodeHash=keccak256(code);
  original.protectionBindings!.nativeUsdFeed.runtimeCodeHash=keccak256(code);
  const {id:ignored,...body}=original;void ignored;
  const production=createLaunchProductionContext(body),pins=production.protectionBindings!,decimals=chain===999?18:8;
  const blockTime=String(now/1000-2);
  const observationBody:Omit<LaunchDependencyObservation,"id">={version:1,productionId:production.id,chainId:chain,
    authority:"two-provider-observation",launchReady:false,block:{number:"100",hash:`0x${"12".repeat(32)}`,timestamp:blockTime},
    observedAt:now-500,expiresAt:now+9500,poolManager:{...production.poolManager,runtimeCode:code},swapRouter:{...pins.swapRouter,runtimeCode:code},
    nativeUsdFeed:{...pins.nativeUsdFeed,runtimeCode:code,decimals,answer:(BigInt(chain===999?25:3000)*10n**BigInt(decimals)).toString(),roundId:"1",answeredInRound:"1",updatedAt:blockTime},
    sequencer:chain===8453?{address:pins.sequencerUptimeFeed!,runtimeCode:code,runtimeCodeHash:keccak256(code),startedAt:String(now/1000-4000),graceSeconds:3600}:null,
    rpcReads:chain===8453?[11,11]:[9,9]};
  const observation={...observationBody,id:canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1",observationBody)};
  const selection={projectHash:`sha256:${"11".repeat(32)}` as const,artifactHash:`sha256:${"22".repeat(32)}` as const,supply:(10n**27n).toString()};
  return {production,observation,selection};
}
function changed(observation:LaunchDependencyObservation,patch:(value:LaunchDependencyObservation)=>void){
  const next=structuredClone(observation);patch(next);const {id:ignored,...body}=next;void ignored;
  next.id=canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1",body);return next;
}
describe("observed opening inputs",()=>{
  it.each([1,4663,8453,999] as const)("derives chain %s pricing from its observed quote with canonical tick rounding",chain=>{
    const {production,observation,selection}=fixture(chain),before=structuredClone(observation);
    const result=deriveObservedOpeningInputs(production,observation,selection,now);
    const fdv=(tick:number)=>{
      const sqrt=BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
      const native=((1n<<192n)*BigInt(selection.supply))/(sqrt*sqrt);
      return native*BigInt(observation.nativeUsdFeed.answer)/(10n**BigInt(18+observation.nativeUsdFeed.decimals));
    };
    expect(result).toMatchObject({chainId:chain,productionId:production.id,observationId:observation.id,projectHash:selection.projectHash,artifactHash:selection.artifactHash,launchReady:false});
    expect(result.initialTick%60).toBe(0);expect(result.sqrtPriceX96).toBe(TickMath.getSqrtRatioAtTick(result.initialTick).toString());
    expect(BigInt(result.openingFdvUsd)).toBe(fdv(result.initialTick));expect(fdv(result.initialTick)).toBeGreaterThanOrEqual(15000n);
    expect(fdv(result.initialTick+60)).toBeLessThan(15000n);expect(observation).toEqual(before);
  });
  it("binds source and target choices into the receipt without changing an existing one",()=>{
    const {production,observation,selection}=fixture(),first=deriveObservedOpeningInputs(production,observation,selection,now);
    const second=deriveObservedOpeningInputs(production,observation,{...selection,targetFdvUsd:"20000"},now);
    expect(second.id).not.toBe(first.id);expect(BigInt(second.openingFdvUsd)).toBeGreaterThanOrEqual(20000n);
    expect(first.targetFdvUsd).toBe("15000");
  });
  it.each(["expired","future","foreign chain","foreign profile","changed code","stale feed","incomplete round","bad reads"])("rejects %s even after an observation hash is recomputed",reason=>{
    const {production,observation,selection}=fixture();
    const next=changed(observation,value=>{
      if(reason==="expired")value.expiresAt=now;
      if(reason==="future")value.observedAt=now+1;
      if(reason==="foreign chain")value.chainId=999;
      if(reason==="foreign profile")value.productionId=`sha256:${"33".repeat(32)}`;
      if(reason==="changed code")value.nativeUsdFeed.runtimeCode="0x00";
      if(reason==="stale feed")value.nativeUsdFeed.updatedAt="1";
      if(reason==="incomplete round")value.nativeUsdFeed.answeredInRound="0";
      if(reason==="bad reads")value.rpcReads=[13,9];
    });
    expect(()=>deriveObservedOpeningInputs(production,next,selection,now)).toThrow("current network observation");
  });
  it.each(["missing","recovering"])("rejects a %s Base sequencer observation",reason=>{
    const {production,observation,selection}=fixture(8453);
    const next=changed(observation,value=>{if(reason==="missing")value.sequencer=null;else value.sequencer!.startedAt=String(now/1000-2000);});
    expect(()=>deriveObservedOpeningInputs(production,next,selection,now)).toThrow();
  });
  it("rejects malformed source bindings, excess supply and a target below the protected floor",()=>{
    const {production,observation,selection}=fixture();
    for(const patch of [{projectHash:"arbitrary"},{supply:(1n<<127n).toString()},{supply:"1.1"},{targetFdvUsd:"14999"}]){
      expect(()=>deriveObservedOpeningInputs(production,observation,{...selection,...patch} as typeof selection,now)).toThrow();
    }
  });
});
