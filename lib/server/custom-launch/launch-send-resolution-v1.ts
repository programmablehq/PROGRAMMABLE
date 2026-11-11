import "server-only";
import { keccak256, toHex, type Hex } from "viem";
import { findUniversalLaunchNonceTransactionV1 } from "@/lib/custom-launch/launch-transaction-discovery-v1";
import type { LaunchSendAttemptV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { checkedLaunchSendResolutionV1, launchSendAttemptHashV1, type LaunchSendResolutionV1 } from "@/lib/custom-launch/launch-send-resolution-v1";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import type { TradeRpcV1 } from "./routed-trade-rpc-v1";

const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Resolution observation unavailable"); return v as Record<string, unknown>; };
const quantity = (v: unknown): bigint => { if (typeof v !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(v)) throw Error("Resolution quantity unavailable"); return BigInt(v); };
const hash = (v: unknown): Hex => { if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/i.test(v)) throw Error("Resolution hash unavailable"); return v.toLowerCase() as Hex; };
const address = (v: unknown): string => { if (typeof v !== "string" || !/^0x[0-9a-f]{40}$/i.test(v)) throw Error("Resolution address unavailable"); return v.toLowerCase(); };
const block = (v: unknown) => { const b=object(v); return {blockHash:hash(b.hash),blockNumber:quantity(b.number).toString()}; };

/** Missing hashes and advancing pending nonces are insufficient. Both configured
 * providers must prove the consuming receipt beneath one canonical finalized block. */
export async function readLaunchSendResolutionV1(attempt: LaunchSendAttemptV1, rpcs: readonly [TradeRpcV1, TradeRpcV1], signal?: AbortSignal): Promise<LaunchSendResolutionV1 | null> {
  const agreed = async <T>(method: string, params: readonly unknown[], parse: (v: unknown) => T): Promise<T> => {
    signal?.throwIfAborted();
    const values=await Promise.all(rpcs.map(async read=>parse(await read(method,params))));
    if(canonicalBrowserJsonV2(values[0])!==canonicalBrowserJsonV2(values[1]))throw Error("Resolution providers disagree");
    return values[0];
  };
  if(await agreed("eth_chainId",[],v=>quantity(v).toString())!=="4663")throw Error("Resolution chain differs");
  const tips=await Promise.all(rpcs.map(async read=>block(await read("eth_getBlockByNumber",["finalized",false]))));
  const height=BigInt(tips[0].blockNumber)<BigInt(tips[1].blockNumber)?tips[0].blockNumber:tips[1].blockNumber;
  const checkpoint=await agreed("eth_getBlockByNumber",[toHex(BigInt(height)),false],block);
  if(checkpoint.blockNumber!==height)throw Error("Resolution checkpoint differs");
  const nonce=await agreed("eth_getTransactionCount",[attempt.controller,toHex(BigInt(height))],v=>quantity(v).toString());
  if(BigInt(nonce)<=BigInt(attempt.nonce))return null;
  const candidate=await findUniversalLaunchNonceTransactionV1({request:({method,params})=>rpcs[0](method,params??[])},attempt,signal);
  if(!candidate)return null;
  const tx=await agreed("eth_getTransactionByHash",[candidate],v=>{
    const t=object(v),input=t.input??t.data;
    if(typeof input!=="string"||!/^0x(?:[a-f0-9]{2})*$/i.test(input)||quantity(t.type??"0x0")>2n||Array.isArray(t.authorizationList)&&t.authorizationList.length)throw Error("Resolution transaction unavailable");
    return {transactionHash:hash(t.hash),blockHash:hash(t.blockHash),blockNumber:quantity(t.blockNumber).toString(),controller:address(t.from),nonce:quantity(t.nonce).toString(),to:t.to===null?null:address(t.to),dataHash:keccak256(input as Hex),value:quantity(t.value).toString()};
  });
  if(tx.transactionHash!==candidate.toLowerCase()||tx.controller!==attempt.controller.toLowerCase()||BigInt(tx.nonce)!==BigInt(attempt.nonce)||BigInt(tx.blockNumber)>BigInt(height))return null;
  const receipt=await agreed("eth_getTransactionReceipt",[candidate],v=>{const r=object(v);return {transactionHash:hash(r.transactionHash),blockHash:hash(r.blockHash),blockNumber:quantity(r.blockNumber).toString(),status:quantity(r.status).toString()};});
  if(receipt.transactionHash!==tx.transactionHash||receipt.blockHash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber||!["0","1"].includes(receipt.status))throw Error("Resolution receipt differs");
  const canonical=await agreed("eth_getBlockByNumber",[toHex(BigInt(tx.blockNumber)),false],block);
  if(canonical.blockHash!==tx.blockHash||canonical.blockNumber!==tx.blockNumber)throw Error("Resolution block differs");
  const sameCall=tx.to===(attempt.transaction.to?.toLowerCase()??null)&&tx.dataHash===keccak256(attempt.transaction.data)&&BigInt(tx.value)===BigInt(attempt.transaction.value);
  if(receipt.status==="1"&&sameCall)return null;
  return checkedLaunchSendResolutionV1(attempt,{schemaVersion:"programmable.launch-send-resolution.v1",attemptHash:launchSendAttemptHashV1(attempt),outcome:receipt.status==="0"?"failed":"replaced",...tx,status:receipt.status==="0"?"0x0":"0x1",checkpoint});
}
