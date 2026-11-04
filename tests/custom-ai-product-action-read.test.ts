import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {encodeFunctionResult,keccak256,parseAbi,toHex} from "viem";
import {readProductAction} from "../lib/custom-ai/product/action-read.server";
import type {ProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
import type {ProductRuntime} from "../lib/custom-ai/product/runtime";
import type {TradeRpcV1} from "../lib/server/custom-launch/routed-trade-rpc-v1";
const now=Date.parse("2026-11-04T14:00:00Z"),caller=`0x${"1".repeat(40)}` as const,target=`0x${"2".repeat(40)}` as const;
const code="0x6001",runtimeCodeHash=keccak256(code),hash=`0x${"3".repeat(64)}` as const;
function fixture(){
  const abi=parseAbi(["function claimable(address holder) view returns(uint256 amount)"]);
  const source={id:`sha256:${"a".repeat(64)}`,sourceId:"source-test",preparationId:"preparation-test",implementationId:`sha256:${"b".repeat(64)}`,chainId:1,
    implementation:{components:[{id:"vault",fixture:"vault",source:"Vault.sol",contract:"Vault"}],actions:[{id:"read-rewards",target:"vault",fixture:"vault",signature:"claimable(address)",mutability:"view"}]},
    components:[{id:"vault",address:target}],targets:[{id:"vault",address:target,runtimeCodeHash}],contracts:[{source:"Vault.sol",contract:"Vault",abi}]} as unknown as ProductRuntimeSource;
  const runtime={state:"contracts-observed",sourceBinding:source.id,sourceId:source.sourceId,preparationId:source.preparationId,implementationId:source.implementationId,
    chainId:1,providerCount:2,checkedAt:new Date(now).toISOString(),block:{number:"100",hash},components:[{id:"vault",address:target,runtimeCodeHash}]} as ProductRuntime;
  const amount=900719925474099312345n;
  const result=encodeFunctionResult({abi,functionName:"claimable",result:amount});
  const rpcs=[0,1].map(()=>vi.fn(async(method:string)=>method==="eth_chainId"?toHex(1):method==="eth_getBlockByNumber"?{number:"0x64",hash}:method==="eth_getCode"?code:result)) as unknown as [ReturnType<typeof vi.fn<TradeRpcV1>>,ReturnType<typeof vi.fn<TradeRpcV1>>];
  return {source,runtime,rpcs,amount};
}
describe("bound product getter reads",()=>{
  it("reads the exact caller and bound function at the observed block without losing units",async()=>{
    const f=fixture(),result=await readProductAction(f.source,f.runtime,{id:"read-rewards",caller,arguments:[caller]},f.rpcs,{signal:new AbortController().signal,now:()=>now});
    expect(result).toMatchObject({state:"value-observed",caller,target,authorized:false,outputs:[{name:"amount",type:"uint256",value:f.amount.toString()}]});
    expect(f.rpcs[0].mock.calls.map(([method])=>method)).toEqual(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_call"]);
    const [,params]=f.rpcs[0].mock.calls[3];expect(params[0]).toMatchObject({from:caller,to:target,gas:"0x7a120"});expect(params[1]).toEqual({blockHash:hash,requireCanonical:true});
  });
  it("rejects stale observations and mismatched source identity before querying a provider",async()=>{
    for(const change of [{checkedAt:new Date(now-60_001).toISOString()},{sourceBinding:"another-source"}]){
      const f=fixture();await expect(readProductAction(f.source,{...f.runtime,...change},{id:"read-rewards",caller,arguments:[caller]},f.rpcs,{signal:new AbortController().signal,now:()=>now})).rejects.toMatchObject({code:"product-action-read"});
      expect(f.rpcs[0]).not.toHaveBeenCalled();expect(f.rpcs[1]).not.toHaveBeenCalled();
    }
  });
  it("does not present disagreement as a balance",async()=>{
    const f=fixture(),base=f.rpcs[1];f.rpcs[1]=vi.fn(async(method,params)=>method==="eth_call"?encodeFunctionResult({abi:f.source.contracts[0].abi,functionName:"claimable",result:1n}):base(method,params));
    await expect(readProductAction(f.source,f.runtime,{id:"read-rewards",caller,arguments:[caller]},f.rpcs,{signal:new AbortController().signal,now:()=>now})).rejects.toMatchObject({code:"product-action-read"});
  });
  it("never simulates a write through the getter path",async()=>{
    const f=fixture();f.source.contracts[0].abi=parseAbi(["function withdraw(address holder)"]);
    f.source.implementation.actions[0]={...f.source.implementation.actions[0],signature:"withdraw(address)",mutability:"nonpayable"};
    await expect(readProductAction(f.source,f.runtime,{id:"read-rewards",caller,arguments:[caller]},f.rpcs,{signal:new AbortController().signal,now:()=>now})).rejects.toMatchObject({code:"product-action-method"});
    expect(f.rpcs[0]).not.toHaveBeenCalled();
  });
});
