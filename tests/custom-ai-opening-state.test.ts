import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { keccak256, toHex, type Hex } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { generalPackFixture } from "./fixtures/custom-ai-general-pack";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { deriveObservedOpeningInputs } from "../lib/custom-ai/opening-inputs.server";
import { replayNativeFeedConstructorRead } from "../lib/custom-ai/dependency-witness.server";
import { packGeneralGraph } from "../lib/custom-ai/general-pack.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";
import type { GeneralRuntimeDependencyResolver } from "../lib/custom-ai/runtime-materialization.server";

const code="0x600760005260206000f3" as Hex;
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("constructed opening state",()=>{
  // Real compiler and isolated deployment; synthetic providers, no public LP.
  it.each([false,true])("rejects an actual supply different from the declaration (children=%s)",async children=>{
    const original=projectLaunchProductionContext(captured.chains["999"],999,protection);
    original.poolManager.runtimeCodeHash=keccak256(code);
    original.protectionBindings!.swapRouter.runtimeCodeHash=keccak256(code);
    original.protectionBindings!.nativeUsdFeed.runtimeCodeHash=keccak256(code);
    const {id:ignored,...body}=original;void ignored;
    const production=createLaunchProductionContext(body),pins=production.protectionBindings!;
    const fixture=await generalPackFixture(999,false,0,children,production,
      {supply:(10n**27n).toString(),targetFdvUsd:"15000",actualSupply:"1"});
    const now=Date.now(),stamp=String(Math.floor(now/1000));
    const raw:Omit<LaunchDependencyObservation,"id">={version:1,productionId:production.id,chainId:999,
      authority:"two-provider-observation",launchReady:false,block:{number:"100",hash:`0x${"12".repeat(32)}`,timestamp:stamp},
      observedAt:now,expiresAt:now+10_000,poolManager:{...production.poolManager,runtimeCode:code},
      swapRouter:{...pins.swapRouter,runtimeCode:code},nativeUsdFeed:{...pins.nativeUsdFeed,runtimeCode:code,
        decimals:7,answer:"10000000",roundId:"1",answeredInRound:"1",updatedAt:stamp},sequencer:null,rpcReads:[9,9]};
    const observation={...raw,id:canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1",raw)};
    fixture.opening={observation,inputs:deriveObservedOpeningInputs(production,observation,{projectHash:fixture.source.project.hash,
      artifactHash:fixture.source.compilation.artifactHash,...fixture.source.project.deployment!.openingPrice!})};
    const resolver:GeneralRuntimeDependencyResolver=async(_production,caller,_signal,pinned)=>{
      expect(pinned).toEqual(observation);
      const rpc=()=>async(method:string)=>method==="debug_traceCall"?{[pins.nativeUsdFeed.address]:{code}}
        :{number:"0x64",hash:observation.block.hash,timestamp:toHex(BigInt(stamp))};
      const read=await replayNativeFeedConstructorRead(observation,caller,{rpcs:[rpc(),rpc()],now:Date.now});
      return {observation,read};
    };
    await expect(packGeneralGraph(fixture,undefined,resolver)).rejects.toMatchObject({code:"runtime-dependency",
      findings:expect.arrayContaining([{target:"token",code:"opening-state-mismatch"}])});
  },120_000);
});
