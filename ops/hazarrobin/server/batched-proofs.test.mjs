import { describe, expect, it } from 'vitest';
import { codeHashProbe, readCodeHashes, quorumLogs } from './rpc.mjs';
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const hash='0x'+'12'.repeat(32), second='0x'+'34'.repeat(32);
const log={address:a,blockNumber:10n,blockHash:hash,transactionHash:second,logIndex:0,data:'0x',topics:[hash]};
describe('batched current runtime proofs',()=>{
 it('encodes only EXTCODEHASH and memory/return opcodes with fixed address operands',()=>{
  expect(codeHashProbe([a,b])).toBe('0x73'+a.slice(2)+'3f6100005273'+b.slice(2)+'3f610020526100406000f3');
  for(const addresses of [[],[a+'00'],['0x'],Array(129).fill(a)])expect(()=>codeHashProbe(addresses)).toThrow();
 });
 it('requires full independent replies at the exact requested block',async()=>{
  const seen=[];const client={call:async args=>{seen.push(args);return {data:hash+second.slice(2)}}};
  expect(await readCodeHashes([client,client],[a,b],42n)).toEqual([hash,second]);
  expect(seen.every(x=>x.blockNumber===42n&&x.to===undefined)).toBe(true);
  await expect(readCodeHashes([client,{call:async()=>({data:hash})}],[a,b],42n)).rejects.toThrow();
  await expect(readCodeHashes([client,{call:async()=>({data:second+hash.slice(2)})}],[a,b],42n)).rejects.toThrow();
 });
});
describe('quorum event proofs',()=>{
 const c=logs=>({getLogs:async()=>logs});
 it('accepts the exact mined event set independently of provider order',async()=>{
  const other={...log,logIndex:1};
  expect(await quorumLogs([c([log,other]),c([other,log])],{},1n,20n)).toEqual([log,other]);
 });
 it('rejects omissions, altered receipt data and reorged events',async()=>{
  for(const logs of [[],[{...log,transactionHash:hash}],[{...log,blockHash:second}],[{...log,data:'0xab'}],[{...log,removed:true}],[{...log,blockNumber:21n}]]){
   await expect(quorumLogs([c([log]),c(logs)],{},1n,20n)).rejects.toThrow();
  }
 });
});
