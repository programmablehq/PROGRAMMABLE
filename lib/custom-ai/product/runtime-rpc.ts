import { toFunctionSelector } from "viem";

const selectors=new Map([
  [toFunctionSelector("launchStamp(bytes32)"),1],
  [toFunctionSelector("launchStampV2(bytes32)"),1],
]);
const address=(value:unknown)=>typeof value==="string"&&/^0x[a-f0-9]{40}$/i.test(value);
const hash=(value:unknown)=>typeof value==="string"&&/^0x[a-f0-9]{64}$/i.test(value);
const reference=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)
  &&Object.keys(value).sort().join()==="blockHash,requireCanonical"&&(value as {requireCanonical?:unknown}).requireCanonical===true&&hash((value as {blockHash?:unknown}).blockHash);

/** Read-only launch provenance protocol. It cannot send a transaction or run
 * a caller-selected function, tracer, range scan or simulation. */
export function allowedProductRuntimeRPC(method:string,params:readonly unknown[]):boolean {
  if(method==="eth_chainId")return params.length===0;
  if(method==="eth_getTransactionReceipt")return params.length===1&&hash(params[0]);
  if(method==="eth_getBlockByNumber")return params.length===2&&(params[0]==="finalized"||typeof params[0]==="string"&&/^0x[0-9a-f]{1,64}$/i.test(params[0]))&&params[1]===false;
  if(method==="eth_getCode")return params.length===2&&address(params[0])&&Boolean(reference(params[1]));
  if(method!=="eth_call"||params.length!==2||!reference(params[1]))return false;
  const call=params[0] as {to?:unknown;data?:unknown;gas?:unknown};
  if(!call||typeof call!=="object"||Array.isArray(call)||Object.keys(call).sort().join()!=="data,gas,to"
    ||!address(call.to)||call.gas!=="0x7a120"||typeof call.data!=="string"||!/^0x[0-9a-f]+$/i.test(call.data))return false;
  const words=selectors.get(call.data.slice(0,10).toLowerCase() as `0x${string}`);
  return words!==undefined&&call.data.length===10+64*words;
}
