import "server-only";
import {decodeEventLog,decodeFunctionResult,encodeFunctionData,getContractAddress,keccak256,parseAbi,toHex,type Hex} from "viem";
import {CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2} from "@/lib/custom-launch/atomic-plan-codec-v2";
import {customLaunchPlanDigestBytesV1,customLaunchPlanOccurrenceIdV1} from "@/lib/custom-launch/stamp-plan-codec-v1";
import type {TradeRpcV1} from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import {CustomAIError} from "../types";
import type {ProductRuntimeSource} from "./runtime-source.server";
import type {ProductRuntime} from "./runtime";

const graphAbi=parseAbi([
  "event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)",
  "event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)",
  "function launchStamp(bytes32 launchId) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash) record)",
]);
const fail=():never=>{throw new CustomAIError("product-runtime-unconfirmed","The deployed contracts could not be confirmed yet. Your product is saved.",503);};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const hash=(value:unknown):Hex=>typeof value==="string"&&/^0x[0-9a-f]{64}$/i.test(value)?value.toLowerCase() as Hex:fail();
const quantity=(value:unknown):bigint=>typeof value==="string"&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)?BigInt(value):fail();
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const nonzero=(value:Hex)=>!/^0x0{64}$/.test(value);
const block=(value:unknown)=>{const raw=object(value);return {number:quantity(raw.number),hash:hash(raw.hash)};};

/** Exactly one receipt and bounded code reads, never an index scan or transaction.
 * Receipt component events are emitted by the pinned executor after its runtime
 * checks. Re-reading every per-component registry mapping would duplicate them. */
export async function observeProductRuntime(source:ProductRuntimeSource,anchor:{transactionHash:Hex;launchId:Hex|null},
  rpcs:readonly [TradeRpcV1,TradeRpcV1],options:{signal:AbortSignal;now?:()=>number;paceMs?:number}):Promise<ProductRuntime>{
  const stopped=new AbortController();
  const now=options.now??Date.now,started=now(),signal=AbortSignal.any([options.signal,stopped.signal,AbortSignal.timeout(30_000)]);
  const reads=[0,0],last=[0,0];
  const read=async(index:0|1,method:string,params:readonly unknown[])=>{
    signal.throwIfAborted();if(now()-started>30_000||++reads[index]>32)return fail();
    const wait=Math.max(0,(options.paceMs??80)-(now()-last[index]));
    if(wait)await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},wait);signal.addEventListener("abort",abort,{once:true});});
    signal.throwIfAborted();last[index]=now();const result=await rpcs[index](method,[...params]);signal.throwIfAborted();return result;
  };
  if(source.targets.length<1||source.targets.length>16||new Set(source.targets.map(item=>item.id)).size!==source.targets.length
    ||new Set(source.targets.map(item=>item.address.toLowerCase())).size!==source.targets.length)return fail();
  for(const target of source.targets){
    if(target.parent===null)continue;
    const parent=source.targets.find(item=>item.id===target.parent);
    if(!parent||target.nonce===null||!/^\d{1,20}$/.test(target.nonce)
      ||!same(getContractAddress({from:parent.address,nonce:BigInt(target.nonce)}),target.address))return fail();
  }
  const observations=await Promise.all(([0,1] as const).map(async index=>{
    if(quantity(await read(index,"eth_chainId",[]))!==BigInt(source.chainId))return fail();
    return block(await read(index,"eth_getBlockByNumber",["finalized",false]));
  })).catch(error=>{stopped.abort(error);throw error;});
  const height=observations[0].number<observations[1].number?observations[0].number:observations[1].number;
  const common=await Promise.all(([0,1] as const).map(index=>read(index,"eth_getBlockByNumber",[toHex(height),false]).then(block)))
    .catch(error=>{stopped.abort(error);throw error;});
  if(common.some(item=>item.number!==height||item.hash!==common[0].hash))return fail();
  const ref={blockHash:common[0].hash,requireCanonical:true};
  const results=await Promise.all(([0,1] as const).map(async index=>{
    const receipt=object(await read(index,"eth_getTransactionReceipt",[anchor.transactionHash]));
    const receiptBlock=quantity(receipt.blockNumber),receiptHash=hash(receipt.blockHash);
    if(!same(receipt.transactionHash,anchor.transactionHash)||quantity(receipt.status)!==1n||receiptBlock>height
      ||!Array.isArray(receipt.logs)||receipt.logs.length>512)return fail();
    const canonical=block(await read(index,"eth_getBlockByNumber",[toHex(receiptBlock),false]));
    if(canonical.number!==receiptBlock||canonical.hash!==receiptHash)return fail();
    const code=await read(index,"eth_getCode",[source.executor.address,ref]);
    if(typeof code!=="string"||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||!same(keccak256(code as Hex),source.executor.runtimeCodeHash))return fail();
    const logs=receipt.logs.map(object).filter(log=>same(log.address,source.executor.address));
    const atomic=source.chainId===4663;
    const abi=atomic?CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2:graphAbi;
    const decoded=logs.flatMap(log=>{
      if(!Array.isArray(log.topics)||log.topics.length<1||log.topics.length>4||typeof log.data!=="string"||!/^0x(?:[0-9a-f]{2})*$/i.test(log.data))return fail();
      try{return [decodeEventLog({abi,data:log.data as Hex,topics:log.topics.map(hash) as [Hex,...Hex[]],strict:true})];}catch{return [];}
    });
    const launches=decoded.filter(log=>log.eventName===(atomic?"AtomicPlanStampedV2":"ProgrammableLaunchStampedV1"));
    if(launches.length!==1)return fail();
    const event=launches[0].args as Record<string,unknown>,launchId=hash(event.launchId),stampHash=hash(event.stampHash);
    if(!nonzero(launchId)||!nonzero(stampHash)||anchor.launchId!==null&&!same(launchId,anchor.launchId))return fail();
    const result=await read(index,"eth_call",[{to:source.executor.address,gas:"0x7a120",
      data:atomic?encodeFunctionData({abi:CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2,functionName:"launchStampV2",args:[launchId]})
        :encodeFunctionData({abi:graphAbi,functionName:"launchStamp",args:[launchId]})},ref]);
    if(typeof result!=="string"||!/^0x(?:[0-9a-f]{2})+$/i.test(result))return fail();
    if(atomic){
      if(!source.planHash||!source.manifestDigest||!same(event.planHash,customLaunchPlanDigestBytesV1(source.planHash))
        ||!same(event.manifestDigest,customLaunchPlanDigestBytesV1(source.manifestDigest))||!same(event.controller,source.controller))return fail();
      const stamp=decodeFunctionResult({abi:CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2,functionName:"launchStampV2",data:result as Hex});
      if(!same(stamp.controller,source.controller)||!same(stamp.planHash,event.planHash)||!same(stamp.manifestDigest,event.manifestDigest)
        ||!same(stamp.stampHash,stampHash)||!same(stamp.orderDigest,event.orderDigest)||!same(stamp.callsHash,event.callsHash))return fail();
    }else{
      const stamp=decodeFunctionResult({abi:graphAbi,functionName:"launchStamp",data:result as Hex});
      if(!same(event.token,source.token)||!same(event.hook,source.hook)||!same(event.poolManager,source.poolManager.address)
        ||!same(stamp.launchWallet,source.controller)||!same(stamp.token,source.token)||!same(stamp.hook,source.hook)
        ||!same(stamp.poolManager,source.poolManager.address)||!same(stamp.poolId,event.poolId)||!same(stamp.stampHash,stampHash))return fail();
    }
    for(const target of source.targets){
      const component=decoded.filter(log=>log.eventName===(atomic?"AtomicPlanComponentStampedV2":"ProgrammableComponentStampedV1")
        &&same((log.args as Record<string,unknown>).launchId,launchId)
        &&same((log.args as Record<string,unknown>)[atomic?"account":"component"],target.address));
      // Constructor-created children are proven by their original parent,
      // CREATE nonce and materialized runtime; not all executors stamp them separately.
      if((target.parent===null||atomic)&&component.length!==1||component.length>1)return fail();
      if(component.length&&(!same((component[0].args as Record<string,unknown>).runtimeCodeHash,target.runtimeCodeHash)
        ||atomic&&!same((component[0].args as Record<string,unknown>).componentId,customLaunchPlanOccurrenceIdV1(source.planHash!,"component",target.id))))return fail();
      const currentCode=await read(index,"eth_getCode",[target.address,ref]);
      if(typeof currentCode!=="string"||!/^0x(?:[0-9a-f]{2})+$/i.test(currentCode)||!same(keccak256(currentCode as Hex),target.runtimeCodeHash))return fail();
    }
    // EIP-1898 makes each code/state read canonical. This last check also
    // catches a reorg of the chosen block while the snapshot was being read.
    const end=block(await read(index,"eth_getBlockByNumber",[toHex(height),false]));
    if(end.hash!==ref.blockHash||end.number!==height)return fail();
    return {launchId,stampHash,receiptBlock:receiptBlock.toString(),receiptHash};
  })).catch(error=>{stopped.abort(error);throw error;});
  if(JSON.stringify(results[0])!==JSON.stringify(results[1]))return fail();
  const components=source.components.map(component=>({...component,name:source.product.components.find(item=>item.id===component.id)!.name}));
  return {version:1,state:"contracts-observed",preparationId:source.preparationId,sourceId:source.sourceId,sourceBinding:source.id,
    implementationId:source.implementationId,chainId:source.chainId,transactionHash:anchor.transactionHash,launchId:results[0].launchId,
    checkedAt:new Date(now()).toISOString(),block:{number:height.toString(),hash:ref.blockHash},providerCount:2,
    components:components.map(({id,name,address,runtimeCodeHash})=>({id,name,address,runtimeCodeHash})),
    actions:source.implementation.actions.map(action=>({id:action.id,kind:source.product.interfaceActions.find(item=>item.id===action.id)!.kind,
      address:source.components.find(item=>item.id===action.target)!.address,signature:action.signature,mutability:action.mutability}))};
}
