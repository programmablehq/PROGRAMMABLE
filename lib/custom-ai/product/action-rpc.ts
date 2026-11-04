import {toHex} from "viem";
import type {BuilderChainId} from "../execution-routing";

/** Constructed by the server from one saved function and observed product.
 * No browser-selected target, selector, provider or block is accepted. */
export type ProductActionReadCall={chainId:BuilderChainId;from:`0x${string}`;to:`0x${string}`;data:`0x${string}`;blockNumber:string;blockHash:`0x${string}`};
const same=(a:unknown,b:string)=>typeof a==="string"&&a.toLowerCase()===b.toLowerCase();
const object=(v:unknown):Record<string,unknown>|undefined=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
export function checkedProductActionReadCall(call:ProductActionReadCall):ProductActionReadCall{
  if(!call||Object.keys(call).sort().join()!=="blockHash,blockNumber,chainId,data,from,to"
    ||![1,4663,8453,999].includes(call.chainId)||!/^0x[0-9a-f]{40}$/i.test(call.from)||!/^0x[0-9a-f]{40}$/i.test(call.to)
    ||!/^0x(?:[0-9a-f]{2}){4,8192}$/i.test(call.data)||!/^\d{1,30}$/.test(call.blockNumber)||!/^0x[0-9a-f]{64}$/i.test(call.blockHash))throw new TypeError("Use one bound product read.");
  return Object.freeze({...call});
}
export function allowedProductActionReadRPC(method:string,params:readonly unknown[],expected:ProductActionReadCall):boolean{
  if(method==="eth_chainId")return params.length===0;
  if(method==="eth_getBlockByNumber")return params.length===2&&params[0]===toHex(BigInt(expected.blockNumber))&&params[1]===false;
  const ref=object(params[1]);
  if(params.length!==2||!ref||Object.keys(ref).sort().join()!=="blockHash,requireCanonical"||ref.requireCanonical!==true||!same(ref.blockHash,expected.blockHash))return false;
  if(method==="eth_getCode")return same(params[0],expected.to);
  const call=object(params[0]);
  return method==="eth_call"&&Boolean(call&&Object.keys(call).sort().join()==="data,from,gas,to"&&call.gas==="0x7a120"
    &&same(call.to,expected.to)&&same(call.from,expected.from)&&same(call.data,expected.data));
}
