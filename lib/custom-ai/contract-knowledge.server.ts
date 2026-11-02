import "server-only";
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, toHex } from "viem";
import { agreedTradeRpcV1, bytesV1, quantityV1, readTradeCheckpointV1, tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { createProductionDependencyRpcs } from "./dependency-rpc.server";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { CustomAIError } from "./types";
import type { KnowledgeResult } from "./knowledge";

const abi=parseAbi(["function name() view returns(string)","function symbol() view returns(string)","function decimals() view returns(uint8)","function totalSupply() view returns(uint256)"]);
const explorers:Record<BuilderChainId,string>={1:"https://etherscan.io",4663:"https://robinhoodchain.blockscout.com",8453:"https://basescan.org",999:"https://hyperevmscan.io"};
const unavailable=()=>new CustomAIError("lookup","The selected network's contract data could not be verified. Try again shortly.",503);

/** An exact-address metadata observation, shared briefly across conversations.
 * No logs, balance scans, arbitrary calls, signing or provider fallback. */
export function createContractKnowledgeReader(dependencies:{rpcs:(chainId:BuilderChainId)=>readonly[TradeRpcV1,TradeRpcV1];now:()=>number}) {
  const cache=new Map<string,{until:number;pending?:Promise<KnowledgeResult>;value?:KnowledgeResult}>();
  async function observe(chainId:BuilderChainId,address:`0x${string}`):Promise<KnowledgeResult>{
    const providers=dependencies.rpcs(chainId),counts=[0,0];
    if(providers.length!==2||providers[0]===providers[1])throw unavailable();
    const rpcs=providers.map((rpc,index):TradeRpcV1=>async(method,params)=>{
      if(++counts[index]>10)throw unavailable();return rpc(method,params);
    }) as [TradeRpcV1,TradeRpcV1];
    const agreed=agreedTradeRpcV1(rpcs);
    if(await agreed("eth_chainId",[],value=>quantityV1(value).toString())!==String(chainId))throw unavailable();
    const block=await readTradeCheckpointV1(rpcs,chainId===4663?16n:2n),reference={blockHash:block.hash,requireCanonical:true};
    const fresh=()=>{const age=Math.floor(dependencies.now()/1000)-Number(block.timestamp);if(age< -5||age>90)throw unavailable();};
    fresh();
    const code=await agreed("eth_getCode",[address,reference],value=>{const bytes=bytesV1(value);if(bytes.length>2+24576*2)throw unavailable();return bytes;});
    const fields=code==="0x"?[]:await Promise.allSettled((["name","symbol","decimals","totalSupply"] as const).map(async functionName=>{
      const data=encodeFunctionData({abi,functionName});
      const output=await agreed("eth_call",[{to:address,data,gas:"0x186a0"},reference],bytesV1);
      return String(decodeFunctionResult({abi,functionName,data:output})).slice(0,180);
    }));
    const field=(index:number)=>fields[index]?.status==="fulfilled"?fields[index].value:null;
    const final=await agreed("eth_getBlockByNumber",[toHex(BigInt(block.number)),false],tradeBlockV1);
    if(final.hash!==block.hash||final.timestamp!==block.timestamp)throw unavailable();fresh();
    return {status:"agreed-chain-read",facts:{chainId,address,block,hasCode:code!=="0x",runtimeHash:code==="0x"?null:keccak256(code),
      name:field(0),symbol:field(1),decimals:field(2),totalSupplyRaw:field(3),
      boundary:"Two configured providers agreed on this block and contract code. Missing metadata is not invented. This is not a source audit, trade test or launch approval."},
      sources:[{title:`${builderChain(chainId).name} contract`,url:`${explorers[chainId]}/address/${address}`,retrievedAt:new Date(dependencies.now()).toISOString()}]};
  }
  return async(chainId:BuilderChainId,rawAddress:string,signal?:AbortSignal)=>{
    signal?.throwIfAborted();builderChain(chainId);const address=getAddress(rawAddress),key=`${chainId}:${address.toLowerCase()}`;
    const old=cache.get(key);
    let pending=old?.pending;
    if(!pending&&old&&old.until>dependencies.now()){if(!old.value)throw unavailable();return structuredClone(old.value);}
    if(!pending){
      if(cache.size>=128)cache.delete(cache.keys().next().value!);
      pending=observe(chainId,address).then(value=>{cache.set(key,{until:dependencies.now()+30000,value});return value;},()=>{cache.set(key,{until:dependencies.now()+5000});throw unavailable();});
      cache.set(key,{until:0,pending});
    }
    if(!signal)return structuredClone(await pending);
    return new Promise<KnowledgeResult>((resolve,reject)=>{
      const stop=()=>{signal.removeEventListener("abort",stop);reject(signal.reason);};signal.addEventListener("abort",stop,{once:true});
      if(signal.aborted)stop();
      pending!.then(value=>{signal.removeEventListener("abort",stop);if(!signal.aborted)resolve(structuredClone(value));},error=>{signal.removeEventListener("abort",stop);if(!signal.aborted)reject(error);});
    });
  };
}
let reader:ReturnType<typeof createContractKnowledgeReader>|undefined;
export function readSelectedContractKnowledge(chainId:BuilderChainId,address:string,signal?:AbortSignal){
  reader??=createContractKnowledgeReader({rpcs:createProductionDependencyRpcs({metadataOnly:true}),now:Date.now});
  return reader(chainId,address,signal);
}
