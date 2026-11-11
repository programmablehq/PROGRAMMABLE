import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {toHex,type Hex} from "viem";
import {readLaunchSendResolutionV1} from "@/lib/server/custom-launch/launch-send-resolution-v1";
import {archiveResolvedLaunchSendV1,readLaunchSendJournalV1,type LaunchSendAttemptV1} from "@/lib/custom-launch/launch-send-journal-v1";
import {checkedLaunchSendResolutionV1} from "@/lib/custom-launch/launch-send-resolution-v1";
import {atomicRecordFixture} from "./fixtures/atomic-launch-v2";
import {controller,hash} from "./fixtures/universal-launch-v1";
import type {TradeRpcV1} from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const record=atomicRecordFixture(),step=record.steps[0],blockHash=`0x${"ab".repeat(32)}` as Hex,checkpointHash=`0x${"cd".repeat(32)}` as Hex,replacementHash=`0x${"ef".repeat(32)}` as Hex;
const attempt:LaunchSendAttemptV1={schemaVersion:"programmable.custom-launch-send.v1",sourceVersion:"custom_launch_plan_v1",launchId:record.planId,stepId:step.stepId,binding:step.transactionDigest,controller,chainId:"4663",nonce:"0x7",startedAt:"2026-10-12T20:00:00.000Z",transactionHash:hash,
 transaction:{chainId:"0x1237",from:controller,to:step.transaction.to!,data:step.transaction.data,value:toHex(BigInt(step.transaction.value)),gas:toHex(BigInt(step.transaction.gasLimit)),nonce:"0x7"}};
function rpc(options:{failed?:boolean;replacement?:boolean;notFinal?:boolean;disagree?:boolean;wrongChain?:boolean;reorg?:boolean}={}):TradeRpcV1 {
 return vi.fn(async(method,params)=>{
  const txHash=options.replacement?replacementHash:hash;
  if(method==="eth_chainId")return options.wrongChain?"0x1":"0x1237";
  if(method==="eth_blockNumber")return "0x2730";
  if(method==="eth_getTransactionCount")return options.notFinal||BigInt(String(params[1]))<10000n?"0x7":"0x8";
  if(method==="eth_getBlockByNumber"){
   if(params[0]==="finalized"||params[0]==="0x2ee0")return {number:"0x2ee0",hash:checkpointHash};
   expect(params[0]).toBe("0x2710");
   return {number:"0x2710",hash:options.reorg&&!params[1]?checkpointHash:blockHash,transactions:[{from:controller,nonce:"0x7",hash:txHash}]};
  }
  if(method==="eth_getTransactionByHash")return {hash:txHash,blockHash,blockNumber:"0x2710",from:controller,nonce:"0x7",to:attempt.transaction.to,input:options.replacement?"0x":attempt.transaction.data,value:attempt.transaction.value,type:"0x2"};
  if(method==="eth_getTransactionReceipt")return {transactionHash:txHash,blockHash:options.disagree?checkpointHash:blockHash,blockNumber:"0x2710",status:options.failed?"0x0":"0x1"};
  throw Error("Unexpected RPC "+method);
 });
}
function storage(){const items=new Map<string,string>([[`programmable:custom-launch-send:v1:4663:${controller.toLowerCase()}`,JSON.stringify(attempt)]]);return {items,getItem:(k:string)=>items.get(k)??null,setItem:(k:string,v:string)=>{items.set(k,v);},removeItem:(k:string)=>{items.delete(k);}};}
describe("finalized failed/replaced launch recovery",()=>{
 it.each([{failed:true},{replacement:true}])("archives only the bound resolved attempt and retains its evidence (%j)",async options=>{
  const first=rpc(options),second=rpc(options),proof=await readLaunchSendResolutionV1(attempt,[first,second]);expect(proof?.outcome).toBe(options.failed?"failed":"replaced");
  const store=storage();archiveResolvedLaunchSendV1(attempt,proof,store);expect(readLaunchSendJournalV1(controller,store)).toBeNull();expect([...store.items.values()].map(value=>JSON.parse(value))).toEqual([{attempt,resolution:proof}]);
  const methods=vi.mocked(first).mock.calls.map(call=>call[0]);expect(methods.some(method=>/send|sign|wallet_|accounts/.test(method))).toBe(false);
 });
 it("keeps a successful original launch locked for normal backend finality",async()=>{expect(await readLaunchSendResolutionV1(attempt,[rpc(),rpc()])).toBeNull();});
 it("keeps a pending nonce and unfinalized replacement locked",async()=>{expect(await readLaunchSendResolutionV1(attempt,[rpc({notFinal:true}),rpc({notFinal:true})])).toBeNull();});
 it.each(["disagree","wrongChain","reorg"] as const)("does not release when providers cannot prove the same canonical result (%s)",async key=>{
  const store=storage();await expect(readLaunchSendResolutionV1(attempt,[rpc({failed:true}),rpc({failed:true,[key]:true})])).rejects.toThrow();expect(readLaunchSendJournalV1(controller,store)).not.toBeNull();
 });
 it("rejects a proof for another attempt and a storage failure without losing the active journal",async()=>{
  const proof=(await readLaunchSendResolutionV1(attempt,[rpc({failed:true}),rpc({failed:true})]))!;
  expect(()=>checkedLaunchSendResolutionV1({...attempt,startedAt:"2026-10-12T21:00:00.000Z"},proof)).toThrow();
  const store=storage();expect(()=>archiveResolvedLaunchSendV1(attempt,proof,{...store,setItem:()=>{throw Error("Storage full");}})).toThrow();expect(readLaunchSendJournalV1(controller,store)).not.toBeNull();
 });
 it("rechecks the exact journal under the lock and does not clear a newer attempt",async()=>{
  const proof=(await readLaunchSendResolutionV1(attempt,[rpc({failed:true}),rpc({failed:true})]))!,store=storage();
  const key=[...store.items.keys()][0];store.setItem(key,JSON.stringify({...attempt,startedAt:"2026-10-12T21:00:00.000Z"}));
  expect(()=>archiveResolvedLaunchSendV1(attempt,proof,store)).toThrow(/changed/);expect(readLaunchSendJournalV1(controller,store)).not.toBeNull();
 });
 it("rejects aborted observations before any RPC or journal mutation",async()=>{
  const abort=new AbortController();abort.abort();const first=rpc();await expect(readLaunchSendResolutionV1(attempt,[first,rpc()],abort.signal)).rejects.toThrow();expect(first).not.toHaveBeenCalled();
 });
});
