import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {encodeAbiParameters,encodeEventTopics,encodeFunctionResult,getContractAddress,keccak256,parseAbiParameters,toFunctionSelector,toHex,type Address,type Hex} from "viem";
import {launchStampComponentEvent,launchStampLaunchEvent,launchStampRouterReadAbi} from "../lib/alchemy/launch-stamp.server";
import {CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2} from "../lib/custom-launch/atomic-plan-codec-v2";
import {customLaunchPlanDigestBytesV1,customLaunchPlanOccurrenceIdV1} from "../lib/custom-launch/stamp-plan-codec-v1";
import {observeProductRuntime} from "../lib/custom-ai/product/runtime-observer.server";
import {allowedProductRuntimeRPC} from "../lib/custom-ai/product/runtime-rpc";
import type {ProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
import type {BuilderChainId} from "../lib/custom-ai/execution-routing";
import type {TradeRpcV1} from "../lib/server/custom-launch/routed-trade-rpc-v1";

const h=(n:string)=>`0x${n.repeat(64)}` as Hex,a=(n:string)=>`0x${n.repeat(40)}` as Address;
const code="0x6001600055",codeHash=keccak256(code),launch=h("a"),stamp=h("b"),tx=h("c"),blockHash=h("d");
function fixture(chainId:BuilderChainId=1){
  const source={id:`sha256:${"c".repeat(64)}`,preparationId:"runtime-preparation-0001",sourceId:"runtime-source-0001",chainId,controller:a("1"),
    implementationId:`sha256:${"2".repeat(64)}`,executor:{address:a("9"),runtimeCodeHash:codeHash},poolManager:{address:a("8"),runtimeCodeHash:codeHash},
    planHash:`sha256:${"3".repeat(64)}`,manifestDigest:`sha256:${"4".repeat(64)}`,token:a("2"),hook:a("3"),
    targets:[{id:"token",address:a("2"),runtimeCodeHash:codeHash,parent:null,nonce:null},{id:"hook",address:a("3"),runtimeCodeHash:codeHash,parent:null,nonce:null},
      {id:"vault",address:getContractAddress({from:a("3"),nonce:1n}),runtimeCodeHash:codeHash,parent:"hook",nonce:"1"}],
    components:[{id:"vault",targetId:"vault",address:getContractAddress({from:a("3"),nonce:1n}),runtimeCodeHash:codeHash}],
    implementation:{actions:[{id:"inspect-vault",target:"vault",fixture:"vault",signature:"balance()",mutability:"view"}]},
    product:{components:[{id:"vault",name:"Reward vault"}],interfaceActions:[{id:"inspect-vault",kind:"inspect"}]}} as unknown as ProductRuntimeSource;
  const atomic=chainId===4663;
  const graphLaunch={address:source.executor.address,
    topics:encodeEventTopics({abi:[launchStampLaunchEvent],eventName:"ProgrammableLaunchStampedV1",args:{launchId:launch,token:source.token,hook:source.hook}}),
    data:encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"),[source.poolManager.address,h("5"),stamp])};
  const atomicLaunch={address:source.executor.address,
    topics:encodeEventTopics({abi:CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2,eventName:"AtomicPlanStampedV2",args:{launchId:launch,controller:source.controller,planHash:customLaunchPlanDigestBytesV1(source.planHash!)}}),
    data:encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,bytes32"),[customLaunchPlanDigestBytesV1(source.manifestDigest!),h("6"),stamp,h("7")])};
  const componentLogs=source.targets.filter(target=>atomic||target.parent===null).map(target=>atomic?{
    address:source.executor.address,topics:encodeEventTopics({abi:CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2,eventName:"AtomicPlanComponentStampedV2",args:{launchId:launch,componentId:customLaunchPlanOccurrenceIdV1(source.planHash!,"component",target.id),account:target.address}}),
    data:encodeAbiParameters(parseAbiParameters("bytes32"),[target.runtimeCodeHash])}:{
    address:source.executor.address,topics:encodeEventTopics({abi:[launchStampComponentEvent],eventName:"ProgrammableComponentStampedV1",args:{launchId:launch,component:target.address,kind:1}}),
    data:encodeAbiParameters(parseAbiParameters("bytes32"),[target.runtimeCodeHash])});
  const state=atomic?encodeFunctionResult({abi:CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2,functionName:"launchStampV2",result:{stampHash:stamp,orderDigest:h("6"),planHash:customLaunchPlanDigestBytesV1(source.planHash!),manifestDigest:customLaunchPlanDigestBytesV1(source.manifestDigest!),callsHash:h("7"),controller:source.controller,blockNumber:20n}})
    :encodeFunctionResult({abi:launchStampRouterReadAbi,functionName:"launchStamp",result:{kind:1,launchWallet:source.controller,token:source.token,hook:source.hook,poolManager:source.poolManager.address,poolId:h("5"),poolKeyHash:h("6"),componentSetHash:h("7"),routePayloadHash:h("8"),routeLauncher:a("4"),routeLauncherRuntimeCodeHash:codeHash,expectedResultHash:h("9"),permitDigest:h("1"),stampHash:stamp}});
  const receipt={transactionHash:tx,blockNumber:"0x14",blockHash:h("e"),status:"0x1",logs:[atomic?atomicLaunch:graphLaunch,...componentLogs]};
  const calls=[0,0];let broken="",commonReads=[0,0];
  const rpcs=([0,1] as const).map(index=>vi.fn(async(method:string,params:readonly unknown[])=>{
    expect(allowedProductRuntimeRPC(method,params)).toBe(true);calls[index]++;
    if(method==="eth_chainId")return toHex(chainId);
    if(method==="eth_getBlockByNumber"){
      if(params[0]==="finalized")return {number:index===0?"0x65":"0x64",hash:h("d")};
      if(params[0]==="0x14")return {number:"0x14",hash:h("e")};
      commonReads[index]++;
      return {number:"0x64",hash:broken==="providers-disagree"&&index===1||broken==="reorg"&&commonReads[index]>1?h("f"):blockHash};
    }
    if(method==="eth_getTransactionReceipt")return broken==="failed-receipt"?{...receipt,status:"0x0"}:broken==="missing-root"?{...receipt,logs:[receipt.logs[0],...receipt.logs.slice(2)]}:receipt;
    if(method==="eth_getCode")return broken==="changed-vault"&&params[0]===source.targets[2].address?"0x6002":code;
    if(method==="eth_call"){
      expect((params[0] as {data:string}).data.slice(0,10)).toBe(toFunctionSelector(atomic?"launchStampV2(bytes32)":"launchStamp(bytes32)"));
      return state;
    }
    throw Error("Unexpected read");
  })) as unknown as readonly [TradeRpcV1,TradeRpcV1];
  return {source,rpcs,calls,anchor:{transactionHash:tx,launchId:atomic?null:launch},break:(value:string)=>{broken=value;commonReads=[0,0];}};
}
describe("requested finalized product observations",()=>{
  it.each([1,4663,8453,999] as const)("binds source addresses, constructor children and receipt code on chain %s",async chain=>{
    const f=fixture(chain),result=await observeProductRuntime(f.source,f.anchor,f.rpcs,{signal:new AbortController().signal,paceMs:0});
    expect(result.state).toBe("contracts-observed");expect(result.block).toEqual({number:"100",hash:blockHash});
    expect(result.components[0].address).toBe(f.source.targets[2].address);expect(result.actions[0].address).toBe(result.components[0].address);
    expect(result.transactionHash).toBe(tx);expect(result.providerCount).toBe(2);
    expect(f.calls).toEqual([11,11]);
  });
  it.each(["changed-vault","providers-disagree","failed-receipt","missing-root","reorg"])("does not mark %s as observed",async problem=>{
    const f=fixture();f.break(problem);
    await expect(observeProductRuntime(f.source,f.anchor,f.rpcs,{signal:new AbortController().signal,paceMs:0})).rejects.toMatchObject({code:"product-runtime-unconfirmed"});
  });
  it("rejects a child attached to a different constructor before querying providers",async()=>{
    const f=fixture();f.source.targets[2].parent="token";
    await expect(observeProductRuntime(f.source,f.anchor,f.rpcs,{signal:new AbortController().signal,paceMs:0})).rejects.toMatchObject({code:"product-runtime-unconfirmed"});expect(f.calls).toEqual([0,0]);
  });
});
