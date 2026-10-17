import { beforeEach, expect, it } from 'vitest';
import { findMinedClaim, pending, pendingClaims, remember, verifyPendingClaim, walletRequestNotSent, type PendingClaim } from './pending';
const account='0x0000000000000000000000000000000000000001', to='0x0000000000000000000000000000000000000002';
const hash=`0x${'ab'.repeat(32)}` as const, blockHash=`0x${'cd'.repeat(32)}` as const;
const entry:PendingClaim={chainId:4663,account,to,data:'0x12345678',nonce:7,created:1,hash};
beforeEach(()=>{
  const data=new Map<string,string>();
  Object.assign(globalThis,{localStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)}});
});
function readers(change={}){
  const tx={hash,from:account,to,input:entry.data,value:0n,nonce:7,...change};
  return [0,1].map(()=>({getChainId:async()=>4663,getBlockNumber:async()=>1000n,
    getTransactionCount:async({blockNumber}:{blockNumber:bigint})=>blockNumber>=20n?8:7,
    getBlock:async()=>({hash:blockHash,transactions:[tx]}),getTransaction:async()=>tx,
    getTransactionReceipt:async()=>({transactionHash:hash,blockHash,blockNumber:20n,status:'success'})})) as never;
}
it('migrates the old pending claim without losing a second chain',()=>{
  localStorage.setItem('hazarrobin.pending-claim.v2',JSON.stringify(entry));
  remember({...entry,chainId:1});expect(pendingClaims()).toHaveLength(2);
  remember(null,1);expect(pending(4663)).toEqual(entry);expect(pending(1)).toBeNull();
});
it('confirms only the exact successful payout',async()=>expect((await verifyPendingClaim(entry,hash,readers())).outcome).toBe('confirmed'));
it('resolves a confirmed cancellation without reporting a payout',async()=>expect((await verifyPendingClaim(entry,hash,readers({to:account,input:'0x'}))).outcome).toBe('replaced'));
it('rejects a transaction from a different sender',async()=>expect(verifyPendingClaim(entry,hash,readers({from:to}))).rejects.toThrow('Wallet-Transaktion'));
it('recovers an exact stored V4 hash when the old build recorded a stale nonce',async()=>expect((await verifyPendingClaim(entry,hash,readers({nonce:8}))).outcome).toBe('confirmed'));
it('does not discard another transaction under a mismatched nonce',async()=>expect(verifyPendingClaim(entry,hash,readers({nonce:8,to:account,input:'0x'}))).rejects.toThrow('Wallet-Transaktion'));
it('rejects disagreement between receipt providers',async()=>{
  const clients=readers() as unknown as Array<{getTransactionReceipt:()=>Promise<unknown>}>;
  clients[1]!.getTransactionReceipt=async()=>({transactionHash:hash,blockHash:`0x${'ee'.repeat(32)}`,blockNumber:20n,status:'success'});
  await expect(verifyPendingClaim(entry,hash,clients as never)).rejects.toThrow('beiden Verbindungen');
});
it('finds an old mined transaction outside the previous 16-block window',async()=>expect(await findMinedClaim({...entry,hash:undefined},readers())).toBe(hash));

it('clears rejected wallet requests through wrapped viem errors only',()=>{expect(walletRequestNotSent({cause:{cause:{code:4001}}})).toBe(true);expect(walletRequestNotSent({cause:{code:-32000}})).toBe(false);});
