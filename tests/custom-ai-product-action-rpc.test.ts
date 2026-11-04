import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {allowedProductActionReadRPC,checkedProductActionReadCall} from "../lib/custom-ai/product/action-rpc";
import {createProductionDependencyRpcs} from "../lib/custom-ai/dependency-rpc.server";
const call={chainId:8453 as const,from:`0x${"1".repeat(40)}` as const,to:`0x${"2".repeat(40)}` as const,data:"0x70a08231" as const,blockNumber:"100",blockHash:`0x${"3".repeat(64)}` as const};
const ref={blockHash:call.blockHash,requireCanonical:true};
const params=[{from:call.from,to:call.to,data:call.data,gas:"0x7a120"},ref] as const;
describe("one saved product read RPC boundary",()=>{
  it("permits only the exact call and its pinned code/block reads",()=>{
    const fixed=checkedProductActionReadCall(call);
    expect(allowedProductActionReadRPC("eth_call",params,fixed)).toBe(true);
    expect(allowedProductActionReadRPC("eth_getCode",[call.to,ref],fixed)).toBe(true);
    for(const [method,input] of [["eth_call",[{...params[0],to:call.from},ref]],["eth_call",[params[0],"latest"]],
      ["eth_call",[{...params[0],data:"0x12345678"},ref]],["eth_sendRawTransaction",[call.data]],["eth_getLogs",[{}]],
      ["eth_getBlockByNumber",["0x65",false]]] as const)expect(allowedProductActionReadRPC(method,input,fixed)).toBe(false);
    expect(Object.isFrozen(fixed)).toBe(true);
  });
  it("reuses configured providers and blocks mismatched calls before network use",async()=>{
    const fetcher=vi.fn(async(_url:URL|string|Request,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));return Response.json({jsonrpc:"2.0",id:body.id,result:"0x"});});
    const rpcs=createProductionDependencyRpcs({productActionRead:call,fetcher,env:{BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${"a".repeat(20)}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${"b".repeat(20)}`}});
    await rpcs(8453)[0]("eth_call",params);
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(rpcs(8453)[0]("eth_call",[{...params[0],data:"0x12345678"},ref])).rejects.toMatchObject({code:"launch-dependency"});
    expect(()=>rpcs(1)).toThrow();expect(fetcher).toHaveBeenCalledOnce();
  });
});
