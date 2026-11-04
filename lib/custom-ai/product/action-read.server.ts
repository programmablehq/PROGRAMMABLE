import "server-only";
import {decodeFunctionResult,keccak256,toFunctionSignature,toHex,type Hex} from "viem";
import type {ProductReadRpc} from "./read-rpc";
import {CustomAIError} from "../types";
import {prepareProductActionInput} from "./action-prepare.server";
import type {ProductRuntimeSource} from "./runtime-source.server";
import type {ProductRuntime} from "./runtime";

const unavailable=():never=>{throw new CustomAIError("product-action-read","This contract value could not be confirmed. Refresh the product before trying again.",503);};
type Value=string|boolean|Value[]|{[key:string]:Value};
const same=(a:unknown,b:unknown)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:unavailable();

/** Internal read primitive. The caller must supply an owner-bound source and
 * its independently observed runtime, plus the configured provider pair.
 * It never sends transactions or declares an action executable. */
export async function readProductAction(source:ProductRuntimeSource,runtime:ProductRuntime,
  request:{id:string;caller:`0x${string}`;arguments:unknown},rpcs:readonly[ProductReadRpc,ProductReadRpc],
  options:{signal:AbortSignal;now?:()=>number}){
  const now=options.now??Date.now,age=now()-Date.parse(runtime.checkedAt);
  if(runtime.state!=="contracts-observed"||runtime.providerCount!==2||runtime.sourceBinding!==source.id
    ||runtime.implementationId!==source.implementationId||runtime.chainId!==source.chainId
    ||runtime.sourceId!==source.sourceId||runtime.preparationId!==source.preparationId
    ||!Number.isFinite(age)||age<0||age>60_000||!/^\d{1,30}$/.test(runtime.block.number))return unavailable();
  const input=prepareProductActionInput(source,request.id,request.caller,request.arguments);
  if(!input.read)throw new CustomAIError("product-action-method","This action needs a separately reviewed wallet transaction.",409);
  const action=source.implementation.actions.find(item=>item.id===request.id)!;
  const target=runtime.components.find(item=>item.id===action.target&&same(item.address,input.target));
  const expected=source.targets.find(item=>same(item.address,input.target));
  const component=source.implementation.components.find(item=>item.id===action.target)!;
  const artifact=source.contracts.find(item=>item.source===component.source&&item.contract===component.contract)!;
  const fn=artifact.abi.find(item=>item.type==="function"&&toFunctionSignature(item)===input.signature);
  if(!target||!expected||!same(target.runtimeCodeHash,expected.runtimeCodeHash)||!fn||fn.type!=="function")return unavailable();
  const stopped=new AbortController(),signal=AbortSignal.any([options.signal,stopped.signal,AbortSignal.timeout(15_000)]);
  const ref={blockHash:runtime.block.hash,requireCanonical:true},height=toHex(BigInt(runtime.block.number));
  const results=await Promise.all(rpcs.map(async rpc=>{
    const read=async(method:string,params:readonly unknown[])=>{signal.throwIfAborted();const value=await rpc(method,params,signal);signal.throwIfAborted();return value;};
    if(await read("eth_chainId",[])!==toHex(source.chainId))return unavailable();
    const block=record(await read("eth_getBlockByNumber",[height,false]));
    if(!same(block.hash,ref.blockHash)||block.number!==height)return unavailable();
    const code=await read("eth_getCode",[input.target,ref]);
    if(typeof code!=="string"||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||!same(keccak256(code as Hex),expected.runtimeCodeHash))return unavailable();
    const value=await read("eth_call",[{from:input.caller,to:input.target,data:input.data,gas:"0x7a120"},ref]);
    if(typeof value!=="string"||!/^0x(?:[0-9a-f]{2})*$/i.test(value)||value.length>32770)return unavailable();
    return value.toLowerCase() as Hex;
  })).catch(error=>{stopped.abort(error);throw error;});
  if(results[0]!==results[1])return unavailable();
  const decoded=decodeFunctionResult({abi:[fn],functionName:fn.name,data:results[0]});
  let nodes=0;
  const plain=(value:unknown,depth=0):Value=>{
    if(++nodes>256||depth>8)return unavailable();
    if(typeof value==="bigint"||typeof value==="number")return String(value);
    if(typeof value==="boolean")return value;
    if(typeof value==="string"){if(value.length>4096)return unavailable();return value;}
    if(Array.isArray(value))return value.map(item=>plain(item,depth+1));
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,plain(item,depth+1)]));
    return unavailable();
  };
  const values=fn.outputs.length===0?[]:fn.outputs.length===1?[decoded]:decoded as readonly unknown[];
  const outputs=fn.outputs.map((field,index)=>({name:field.name||`result ${index+1}`,type:field.type,value:plain(values[index])}));
  const result={state:"value-observed" as const,actionId:request.id,callId:input.id,sourceBinding:source.id,
    chainId:source.chainId,caller:input.caller,target:input.target,signature:input.signature,
    block:runtime.block,snapshotAt:runtime.checkedAt,observedAt:new Date(now()).toISOString(),outputs,authorized:false as const};
  if(JSON.stringify(result).length>32768)return unavailable();return result;
}
