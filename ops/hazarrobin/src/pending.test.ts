import { beforeEach, expect, it, vi } from 'vitest';
import { concat, encodeAbiParameters, encodeFunctionData, parseAbiParameters, toHex } from 'viem';
import { findMinedClaim, pending, pendingClaims, remember, verifyPendingClaim, walletExecutionAbi, walletRequestNotSent, type PendingClaim } from './pending';
vi.mock('viem',async importOriginal=>{
 const actual=await importOriginal<typeof import('viem')>();
 return {...actual,keccak256:(value:`0x${string}`)=>value==='0x6000'?'0xe45747f90ecec2ba96ae9f4a15c36289653efdfef7690bcfb90a1945bb0fe207':actual.keccak256(value)};
});
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
    getBlock:async()=>({hash:blockHash,transactions:[tx]}),getTransaction:async()=>tx,getCode:async()=>'0x6000',
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
it('clears a proven insufficient-funds rejection but preserves unknown broadcasts',()=>{expect(walletRequestNotSent({cause:{name:'InsufficientFundsError'}})).toBe(true);expect(walletRequestNotSent({cause:{name:'TransactionNotFoundError'}})).toBe(false);});

const relayer='0x0000000000000000000000000000000000000003';
const delegationType=parseAbiParameters('(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]');
function relayedTransaction(root: `0x${string}` = account) {
 const context=encodeAbiParameters(delegationType,[[{delegate:relayer,delegator:root,authority:toHex(2n**256n-1n,{size:32}),caveats:[],salt:0n,signature:'0x01'}]]);
 return {from:relayer,nonce:83,to:'0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',input:encodeFunctionData({abi:walletExecutionAbi,functionName:'redeemDelegations',args:[[context],[toHex(0,{size:32})],[concat([entry.to,toHex(0,{size:32}),entry.data])]]})};
}
it('confirms the exact wallet-returned relayed claim using its root account and pinned manager',async()=>{
 expect((await verifyPendingClaim(entry,hash,readers(relayedTransaction()))).outcome).toBe('confirmed');
});
it('requires the saved wallet hash before recognizing a relayed claim',async()=>{
 await expect(verifyPendingClaim({...entry,hash:undefined},hash,readers(relayedTransaction()))).rejects.toThrow('Wallet-Transaktion');
});
it('rejects a relayed claim for another root wallet',async()=>{
 await expect(verifyPendingClaim(entry,hash,readers(relayedTransaction(to)))).rejects.toThrow('Wallet-Transaktion');
});
it('rejects an unrecognized manager runtime on either provider',async()=>{
 const clients=readers(relayedTransaction()) as unknown as Array<{getCode:()=>Promise<string>}>;
 clients[1]!.getCode=async()=>'0x6001';
 await expect(verifyPendingClaim(entry,hash,clients as never)).rejects.toThrow('Wallet-Ausführungsvertrag');
});
it('separates RPC disagreement from a wallet identity mismatch',async()=>{
 const clients=readers() as unknown as Array<{getTransaction:()=>Promise<unknown>}>;
 clients[1]!.getTransaction=async()=>({hash,from:to,to,input:entry.data,value:0n,nonce:7});
 await expect(verifyPendingClaim(entry,hash,clients as never)).rejects.toThrow('unterschiedliche Transaktionsdaten');
});
