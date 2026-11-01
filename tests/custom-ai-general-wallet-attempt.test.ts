import {describe,expect,it} from "vitest";
import {assertGraphWalletSendAvailable,beginGraphWalletAttempt,finalizeGraphWalletAttempt,graphWalletActionHash,readGraphWalletAttempts,rejectGraphWalletAttempt,rememberGraphWalletHash,type GraphWalletAction,type GraphWalletContext} from "../lib/custom-ai/general-wallet-attempt";
import {WalletRequestNotSubmittedError} from "../lib/wallet-request-lock";
const controller=`0x${"11".repeat(20)}`,requestId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",hash=`0x${"33".repeat(32)}` as const,requestHash=`sha256:${"44".repeat(32)}` as const;
function store(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
const action=(chainId="1"):GraphWalletAction=>({chainId,from:controller,to:`0x${"22".repeat(20)}`,data:"0x12345678",value:"0x1"});
const context=(value:GraphWalletAction):GraphWalletContext=>({requestId,requestHash,actionHash:graphWalletActionHash(value)});
describe("digest-only graph wallet recovery journal",()=>{
 it.each(["1","8453","999"] as const)("persists the original %s action without calldata and never authorizes or broadcasts",chainId=>{
  const s=store(),value=action(chainId),saved=beginGraphWalletAttempt(context(value),value,s);
  expect(saved.chainId).toBe(chainId);expect(saved.transactionHash).toBeNull();expect([...s.values.values()][0]).not.toContain(value.data);
  expect(readGraphWalletAttempts(controller,chainId,s)).toEqual([saved]);Object.assign(saved,{to:"changed"});
  expect(readGraphWalletAttempts(controller,chainId,s)[0].to).toBe(value.to);
 });
 it("blocks an unknown send after reload or any passage of time",()=>{
  const s=store(),value=action();beginGraphWalletAttempt(context(value),value,s,1);
  expect(()=>assertGraphWalletSendAvailable(value,s)).toThrow("original launch");
  expect(()=>beginGraphWalletAttempt({...context(value),requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},value,s,Date.now()+864000000)).toThrow("recovery");
  expect(()=>assertGraphWalletSendAvailable(action("8453"),s)).not.toThrow();
 });
 it("retains unknown errors and only clears an explicit rejection or trusted no-send failure",()=>{
  for(const error of [Error("Transport lost"),{message:"not submitted"},{notSubmitted:true}]){
   const s=store(),value=action(),saved=beginGraphWalletAttempt(context(value),value,s);rejectGraphWalletAttempt(saved,error,s);expect(readGraphWalletAttempts(controller,"1",s)).toHaveLength(1);
  }
  for(const error of [{code:4001},new WalletRequestNotSubmittedError("Stopped before request")]){
   const s=store(),value=action(),saved=beginGraphWalletAttempt(context(value),value,s);rejectGraphWalletAttempt(saved,error,s);expect(readGraphWalletAttempts(controller,"1",s)).toEqual([]);
  }
 });
 it("keeps a known original hash, prevents a repeat, and allows a different identified launch",()=>{
  const s=store(),value=action(),saved=beginGraphWalletAttempt(context(value),value,s),sent=rememberGraphWalletHash(saved,hash,s);
  rejectGraphWalletAttempt(sent,{code:4001},s);expect(readGraphWalletAttempts(controller,"1",s)).toEqual([sent]);
  expect(()=>assertGraphWalletSendAvailable(value,s)).toThrow("original launch");
  const next={...value,data:"0x98765432" as const};expect(()=>assertGraphWalletSendAvailable(next,s)).not.toThrow();
  const second=beginGraphWalletAttempt({...context(next),requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},next,s);expect(second.transactionHash).toBeNull();
  expect(()=>rememberGraphWalletHash(sent,`0x${"55".repeat(32)}`,s)).toThrow();
 });
 it("requires the exact original finalized transaction before releasing its record",()=>{
  const s=store(),value=action(),saved=rememberGraphWalletHash(beginGraphWalletAttempt(context(value),value,s),hash,s);
  for(const change of [{finality:"pending" as const},{requestHash:"wrong"},{transactionHash:`0x${"55".repeat(32)}` as const}]){
   finalizeGraphWalletAttempt(saved,{requestId,requestHash,transactionHash:hash,finality:"final",...change},s);expect(readGraphWalletAttempts(controller,"1",s)).toHaveLength(1);
  }
  finalizeGraphWalletAttempt(saved,{requestId,requestHash,transactionHash:hash,finality:"final"},s);expect(readGraphWalletAttempts(controller,"1",s)).toEqual([]);
 });
 it("rejects modified action data, actor, network, values and invalid storage",()=>{
  const value=action();for(const changed of [{...value,data:"0xaabb" as const},{...value,value:"0x2" as const},{...value,from:`0x${"66".repeat(20)}`}])
   expect(()=>beginGraphWalletAttempt(context(value),changed,store())).toThrow();
  expect(()=>beginGraphWalletAttempt(context(value),action("4663"),store())).toThrow();
  const s=store();beginGraphWalletAttempt(context(value),value,s);const key=[...s.values.keys()][0];s.setItem(key,"broken");expect(()=>assertGraphWalletSendAvailable(value,s)).toThrow("cannot be read");
 });
 it("refuses to begin when recovery storage cannot persist the record",()=>{
  const s={getItem:()=>null,setItem:()=>{throw Error("Storage full");},removeItem:()=>{}};
  expect(()=>beginGraphWalletAttempt(context(action()),action(),s)).toThrow("Storage full");
 });
});
