import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { createContractKnowledgeReader } from "../lib/custom-ai/contract-knowledge.server";
import { createProductionDependencyRpcs } from "../lib/custom-ai/dependency-rpc.server";
import { getCapabilities } from "../lib/custom-ai/capabilities/registry.server";
import { dispatchTool } from "../lib/custom-ai/capabilities/dispatch.server";
import type { TradeRpcV1 } from "../lib/server/custom-launch/routed-trade-rpc-v1";

const address=`0x${"12".repeat(20)}`,hash=`0x${"34".repeat(32)}`;
const block={number:"0x64",hash,timestamp:"0x3e8"};
const text=(value:string)=>encodeAbiParameters(parseAbiParameters("string"),[value]);
const number=(value:bigint)=>encodeAbiParameters(parseAbiParameters("uint256"),[value]);
function pair(chainId:number,overrides:Record<string,unknown>={}){
  const read=vi.fn(async(method:string,params:readonly unknown[])=>{
    if(Object.hasOwn(overrides,method)){const value=overrides[method];if(value instanceof Error)throw value;return value;}
    if(method==="eth_chainId")return `0x${chainId.toString(16)}`;
    if(method==="eth_getBlockByNumber")return {...block,number:params[0]==="latest"?block.number:params[0]};
    if(method==="eth_getCode")return "0x6000";
    if(method==="eth_call"){
      expect(params[1]).toEqual({blockHash:hash,requireCanonical:true});
      const call=params[0] as {data:string;gas:string};expect(call.gas).toBe("0x186a0");
      return ({"0x06fdde03":text("Test Token"),"0x95d89b41":text("TST"),"0x313ce567":number(18n),"0x18160ddd":number(1000n)})[call.data];
    }
    throw Error("Unexpected network operation");
  });
  const reads=[read,vi.fn((method:string,params:readonly unknown[])=>read(method,params))] as unknown as [TradeRpcV1,TradeRpcV1];return {reads,read};
}
describe("selected-network contract knowledge",()=>{
  it.each([1,4663,8453,999] as const)("reads chain %s and shares duplicate reads without model calls",async chainId=>{
    const p=pair(chainId),select=vi.fn(()=>p.reads);
    const reader=createContractKnowledgeReader({rpcs:select,now:()=>1000000});
    const [a,b]=await Promise.all([reader(chainId,address),reader(chainId,address)]);
    expect(a).toMatchObject({status:"agreed-chain-read",facts:{chainId,hasCode:true,name:"Test Token",symbol:"TST",decimals:"18",totalSupplyRaw:"1000"}});
    expect(b).toEqual(a);expect(select).toHaveBeenCalledTimes(1);expect(p.read).toHaveBeenCalledTimes(18);
    await reader(chainId,address);expect(p.read).toHaveBeenCalledTimes(18);
  });
  it("never borrows a different chain and caches failure briefly",async()=>{
    const p=pair(1),reader=createContractKnowledgeReader({rpcs:()=>p.reads,now:()=>1000000});
    await expect(reader(8453,address)).rejects.toMatchObject({code:"lookup"});
    await expect(reader(8453,address)).rejects.toMatchObject({code:"lookup"});expect(p.read).toHaveBeenCalledTimes(2);
  });
  it("keeps an account without code distinct from a token",async()=>{
    const p=pair(999,{eth_getCode:"0x"}),reader=createContractKnowledgeReader({rpcs:()=>p.reads,now:()=>1000000});
    expect(await reader(999,address)).toMatchObject({facts:{hasCode:false,runtimeHash:null,name:null,symbol:null,decimals:null,totalSupplyRaw:null}});
    expect(p.read.mock.calls.filter(([method])=>method==="eth_call")).toHaveLength(0);
  });
  it("rejects a code disagreement without reading unverified metadata",async()=>{
    const a=pair(8453),b=pair(8453,{eth_getCode:"0x6001"});
    const reader=createContractKnowledgeReader({rpcs:()=>[a.reads[0],b.reads[0]],now:()=>1000000});
    await expect(reader(8453,address)).rejects.toMatchObject({code:"lookup"});
    expect(a.read.mock.calls.filter(([method])=>method==="eth_call")).toHaveLength(0);
  });
  it("bounds metadata authority without granting trace or transfer access",async()=>{
    const credential="thisIsOnlyAFakeTestCredential123";
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>Response.json({jsonrpc:"2.0",id:JSON.parse(String(init?.body)).id,result:text("TST")})) as unknown as typeof fetch;
    const env={BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${credential}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${credential}`};
    const rpc=createProductionDependencyRpcs({env,fetcher,metadataOnly:true})(8453)[0],reference={blockHash:hash,requireCanonical:true};
    await rpc("eth_call",[{to:address,data:"0x06fdde03",gas:"0x186a0"},reference]);
    for(const [method,params] of [["eth_sendRawTransaction",["0x00"]],["eth_getLogs",[{}]],
      ["eth_call",[{to:address,data:"0x06fdde03",gas:"0x186a1"},reference]],
      ["eth_call",[{to:address,data:"0xa9059cbb",gas:"0x186a0"},reference]],
      ["debug_traceCall",[{from:address,to:address,data:"0x313ce567",value:"0x0",gas:"0x1e8480"},"0x64",{tracer:"prestateTracer",timeout:"5s",tracerConfig:{diffMode:false}}]]] as [string,unknown[]][]){
      await expect(rpc(method,params)).rejects.toMatchObject({code:"launch-dependency"});
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(createProductionDependencyRpcs({env,fetcher})(8453)[0]("eth_call",[{to:address,data:"0x06fdde03",gas:"0x186a0"},reference])).rejects.toThrow();
  });
  it("rejects a tool request that changes the selected network",async()=>{
    const context={owner:"test",chainId:8453 as const,allowWeb:false,budget:{remaining:1}},tool=getCapabilities(context).find(t=>t.ref.id==="contract")!;
    await expect(dispatchTool(tool.ref,{query:"token",chainId:1,address},context)).rejects.toMatchObject({code:"lookup"});
  });
});
