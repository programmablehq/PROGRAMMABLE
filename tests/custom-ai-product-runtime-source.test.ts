import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import {generalPackFixture,generalPackProduct} from "./fixtures/custom-ai-general-pack";
import {packGeneralGraph} from "../lib/custom-ai/general-pack.server";
import {readProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
import {createProductImplementation} from "../lib/custom-ai/product/implementation.server";
import type {AIStore} from "../lib/custom-ai/store.server";
import {allowedProductRuntimeRPC} from "../lib/custom-ai/product/runtime-rpc";
import {encodeFunctionData,parseAbi} from "viem";

describe("product runtime RPC boundary",()=>{
  it("only permits bounded provenance reads",()=>{
    const ref={blockHash:`0x${"a".repeat(64)}`,requireCanonical:true},to=`0x${"1".repeat(40)}`;
    const data=encodeFunctionData({abi:parseAbi(["function launchStamp(bytes32) view returns(bytes32)"]),functionName:"launchStamp",args:[`0x${"2".repeat(64)}`]});
    expect(allowedProductRuntimeRPC("eth_call",[{to,data,gas:"0x7a120"},ref])).toBe(true);
    expect(allowedProductRuntimeRPC("eth_getCode",[to,ref])).toBe(true);
    expect(allowedProductRuntimeRPC("eth_getBlockByNumber",["finalized",false])).toBe(true);
    for(const [method,params] of [["eth_sendRawTransaction",["0xdead"]],["eth_getLogs",[{}]],["eth_call",[{to,data:"0xa9059cbb",gas:"0x7a120"},ref]],
      ["eth_call",[{to,data,gas:"0x7a120"},"latest"]],["eth_call",[{to,data:`${data}00`,gas:"0x7a120"},ref]]] as const){
      expect(allowedProductRuntimeRPC(method,params)).toBe(false);
    }
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("saved product and exact prepared addresses",{timeout:120000},()=>{
  it.each([false,true])("resolves the actual immutable pack; constructor children: %s",async withChildren=>{
    const fixture=await generalPackFixture(1,false,0,withChildren,undefined,undefined,true);
    const {source}=fixture,pack=await packGeneralGraph(fixture),product=generalPackProduct(source.project.intent,withChildren);
    const implementation=createProductImplementation(product,source.blueprint,source.project,source.compilation,source.scenarios)!;
    const sourceId=source.binding.sourceId,owner="owner",payloadHash="b".repeat(64);
    const record={id:"runtime-preparation-0001",selection:{id:sourceId,conversation:source.binding.conversation,projectHash:source.project.hash,artifactHash:source.compilation.artifactHash},
      account:fixture.controller,chainId:1,productionId:source.project.production!.id,requestHash:"sha256:"+"c".repeat(64),requestSha256:"sha256:"+"d".repeat(64),submission:{resourceId:"launch-resource"}};
    const job={state:"completed",payloadHash,request:{conversation:{id:source.binding.conversation,account:fixture.controller}},result:{productBlueprint:product,generalProject:{implementation}}};
    const checkpoint={...source,requestId:sourceId,payloadHash,blueprintId:source.blueprint.id};
    const read=vi.fn(async(readOwner:string,id:string)=>{expect(readOwner).toBe(owner);expect(id).toBe(sourceId);return job;});
    const store={read,projects:{read:vi.fn(async()=>checkpoint),readBlueprint:vi.fn(async()=>({payloadHash,blueprint:source.blueprint})),
      preparations:{readRuntimeInputs:vi.fn(async()=>({record,pack}))}}} as unknown as AIStore;
    const result=await readProductRuntimeSource(store,owner,record.id);
    expect(result.state).toBe("requires-onchain-observation");expect(result.readOnly).toBe(true);
    if(withChildren)expect(result.components.find(component=>component.id==="vault")?.address).not.toBe(result.components.find(component=>component.id==="opening")?.address);
    expect(result.targets.filter(target=>target.parent!==null)).toHaveLength(withChildren?3:0);
    expect(result.packHash).toBe(pack.hash);expect(result.implementationId).toBe(implementation.id);
    job.result.generalProject.implementation={...implementation,id:`sha256:${"f".repeat(64)}`};
    await expect(readProductRuntimeSource(store,owner,record.id)).rejects.toMatchObject({code:"product-runtime-source"});
    expect(store.projects.preparations.readRuntimeInputs).toHaveBeenCalledWith(owner,record.id);
  });
});
