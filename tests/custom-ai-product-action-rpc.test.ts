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
  it("keeps provider cooldown when a second scoped action creates a fresh client",async()=>{
    const env={BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${"a".repeat(20)}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${"b".repeat(20)}`};
    let calls=0;
    const fetcher=vi.fn(async(_url:URL|string|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      return ++calls===1?new Response(null,{status:429}):Response.json({jsonrpc:"2.0",id:body.id,result:"0x2105"});
    });
    const now=()=>1000;
    const first=createProductionDependencyRpcs({productActionRead:call,env,fetcher,now})(8453)[0];
    await expect(first("eth_chainId",[])).rejects.toThrow();
    const second=createProductionDependencyRpcs({productActionRead:{...call,data:"0x18160ddd"},env,fetcher,now})(8453)[0];
    await expect(second("eth_chainId",[])).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shares the in-flight provider bound across independently scoped calls",async()=>{
    const env={BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${"c".repeat(20)}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${"d".repeat(20)}`};
    const finish:(()=>void)[]=[];
    const fetcher=vi.fn((_url:URL|string|Request,init?:RequestInit)=>new Promise<Response>(resolve=>{
      const body=JSON.parse(String(init?.body));finish.push(()=>resolve(Response.json({jsonrpc:"2.0",id:body.id,result:"0x2105"})));
    }));
    const requests=Array.from({length:5},()=>createProductionDependencyRpcs({productActionRead:call,env,fetcher,now:()=>1000})(8453)[0]("eth_chainId",[]));
    const settled=Promise.allSettled(requests);finish.forEach(done=>done());const results=await settled;
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
  });
  it("shares only provider pressure while retaining separate call permissions",async()=>{
    const env={BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${"e".repeat(20)}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${"f".repeat(20)}`};
    const fetcher=vi.fn(async(_url:URL|string|Request,init?:RequestInit)=>Response.json({jsonrpc:"2.0",id:JSON.parse(String(init?.body)).id,result:"0x"}));
    const first=createProductionDependencyRpcs({productActionRead:call,env,fetcher})(8453)[0];
    const other={...call,data:"0x18160ddd" as const};
    const second=createProductionDependencyRpcs({productActionRead:other,env,fetcher})(8453)[0];
    await expect(first("eth_call",[{from:other.from,to:other.to,data:other.data,gas:"0x7a120"},ref])).rejects.toThrow();
    await expect(second("eth_call",[{from:other.from,to:other.to,data:other.data,gas:"0x7a120"},ref])).resolves.toBe("0x");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("aborts stalled provider calls and releases their slots",async()=>{
    const env={BASE_RPC_PRIMARY_URL:`https://lb.drpc.live/base/${"g".repeat(20)}`,BASE_RPC_SECONDARY_URL:`https://base-mainnet.g.alchemy.com/v2/${"h".repeat(20)}`};
    const signals:AbortSignal[]=[];
    const fetcher=vi.fn((_url:URL|string|Request,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      const signal=init!.signal!;signals.push(signal);signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
    }));
    const rpc=createProductionDependencyRpcs({productActionRead:call,env,fetcher})(8453)[0],controller=new AbortController();
    const pending=Promise.allSettled(Array.from({length:4},()=>rpc("eth_chainId",[],controller.signal)));
    controller.abort();await pending;expect(signals.every(signal=>signal.aborted)).toBe(true);
    const next=new AbortController(),again=rpc("eth_chainId",[],next.signal).catch(()=>undefined);expect(fetcher).toHaveBeenCalledTimes(5);next.abort();await again;
  });
});
