import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {execFileSync} from "node:child_process";
import {canonicalInterfaceContext,canonicalGeneralSourceCatalog} from "../lib/custom-ai/canonical-dependencies.server";
import {PROTOCOL_TOPICS} from "../lib/custom-ai/protocol-knowledge";
import {getCapabilities} from "../lib/custom-ai/capabilities/registry.server";
import {dispatchTool} from "../lib/custom-ai/capabilities/dispatch.server";
import {modelTask} from "../lib/custom-ai/model-tasks";

describe("protocol knowledge and model routing",()=>{
  it("keeps the local interface catalog identical to the pinned source artifacts",()=>{
    execFileSync(process.execPath,["scripts/custom-ai/build-interface-catalog.mjs","--check"]);
    for(const chain of [1,4663,8453,999] as const){
      const context=canonicalInterfaceContext(chain),sources=canonicalGeneralSourceCatalog(undefined,chain);
      expect(context.contracts).toHaveLength(5);
      expect(context.contracts.every(contract=>sources[contract.source])).toBe(true);
      const snapshot=structuredClone(context);context.contracts.length=0;
      expect(canonicalInterfaceContext(chain)).toEqual(snapshot);
    }
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
    expect(modelTask("planning",models)).toMatchObject({model:models.chat});
    expect(modelTask("declaration-correction",models)).toMatchObject({model:models.build,maxTokens:16000});
    expect(modelTask("source-audit",models)).toMatchObject({model:models.build,maxTokens:3500});
  });
});
