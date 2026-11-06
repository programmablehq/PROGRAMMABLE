import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {execFileSync} from "node:child_process";
import {canonicalInterfaceContext,canonicalGeneralSourceCatalog} from "../lib/custom-ai/canonical-dependencies.server";
import {PROTOCOL_TOPICS} from "../lib/custom-ai/protocol-knowledge";
import {getCapabilities} from "../lib/custom-ai/capabilities/registry.server";
import {dispatchTool} from "../lib/custom-ai/capabilities/dispatch.server";
import {modelTask} from "../lib/custom-ai/model-tasks";
import {parseAbi} from "viem";

describe("protocol knowledge and model routing",()=>{
  it("keeps the local interface catalog identical to the pinned source artifacts",()=>{
    execFileSync(process.execPath,["scripts/custom-ai/build-interface-catalog.mjs","--check"]);
    for(const chain of [1,4663,8453,999] as const){
      const context=canonicalInterfaceContext(chain),sources=canonicalGeneralSourceCatalog(undefined,chain);
      expect(context.contracts).toHaveLength(5);
      expect(context.contracts.every(contract=>sources[contract.source])).toBe(true);
      expect(context.construction).toHaveLength(5);
      for(const item of context.construction){
        expect(sources[item.source].content).toContain(item.constructorSource);
        expect(item.constructorSource.length).toBeLessThan(24001);
        for(const declaration of item.callbackDeclarations)expect(sources[item.source].content).toContain(declaration);
      }
      const snapshot=structuredClone(context);context.contracts.length=0;
      expect(canonicalInterfaceContext(chain)).toEqual(snapshot);
    }
  });
  it("supplies actual pinned constructor creation and override constraints before generation",()=>{
    const context=canonicalInterfaceContext(8453),hook=context.construction.find(item=>item.contract==="BaseProtectedNative30HookV1")!;
    expect(hook.constructorSource).toContain("feeVault = new EthereumNativeFeeVaultV3");
    expect(hook.structSources.some(item=>item.includes("address creatorFeeRecipient;")&&item.includes("address module;"))).toBe(true);
    expect(hook.constructorSource).toContain("protection = new BaseLaunchProtectionModuleV1");
    expect(hook.constructorSource).toContain("openingTaxVault = new EthereumNativeFeeVaultV3");
    expect(hook.callbackDeclarations.some(item=>item.includes("_afterSwap"))).toBe(true);
    expect(hook.initializationSources.some(item=>item.includes("permissions.beforeSwapReturnDelta = true"))).toBe(true);
    expect(context.construction.find(item=>item.contract==="BaseProtectedNativeInitializerV1")?.initializationSources.some(item=>item.includes("msg.sender != graphFactory"))).toBe(true);
  });
  it.each([1,4663,8453,999] as const)("keeps fee quote argument and result names in the reference on %i",chainId=>{
    const hook=canonicalInterfaceContext(chainId).contracts.find(contract=>contract.contract.endsWith("ProtectedNative30HookV1"))!;
    const quote=parseAbi(hook.functions).find(item=>item.type==="function"&&item.name==="quoteFees");
    expect(quote?.type).toBe("function");
    if(quote?.type!=="function")throw new Error("Missing canonical fee quote");
    expect(quote.inputs.map(parameter=>parameter.name)).toEqual(["amount","amountIsNet","isBuy"]);
    expect(quote.outputs.map(parameter=>parameter.name)).toEqual(["gross","platformFee","creatorFee"]);
  });
  it.each([1,4663,8453,999] as const)("provides every protocol topic on %i without external requests",async chainId=>{
    const fetcher=vi.spyOn(globalThis,"fetch");
    try{
      for(const topic of Object.keys(PROTOCOL_TOPICS)){
        const context={owner:"alice",chainId,allowWeb:false,budget:{remaining:1}};
        const tool=getCapabilities(context).find(tool=>tool.ref.id==="protocol")!;
        expect(await dispatchTool(tool.ref,{topic},context)).toMatchObject({status:"reviewed-protocol-knowledge",facts:{topic,chainId}});
        expect(context.budget.remaining).toBe(0);
      }
      expect(fetcher).not.toHaveBeenCalled();
    }finally{fetcher.mockRestore();}
  });
  it("keeps all task choices inside one configured provider's roles",()=>{
    const models={chat:"provider/planner",build:"provider/builder",escalation:"provider/repair"};
    expect(modelTask("planning",models)).toMatchObject({model:models.chat,structuredTransport:"json-object"});
    expect(modelTask("declaration-correction",models)).toMatchObject({model:models.build,maxTokens:8000});
    expect(modelTask("source-audit",models)).toMatchObject({model:models.escalation,maxTokens:3500});
    expect(modelTask("scenarios",models)).toMatchObject({model:models.escalation,maxTokens:4000});
    expect(modelTask("source-implementation",models)).toMatchObject({model:models.build,maxTokens:16000,structuredTransport:"json-object"});
  });
});
