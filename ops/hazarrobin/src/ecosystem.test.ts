import { describe, expect, it } from 'vitest';
import { decodeFunctionData, multicall3Abi, toHex } from 'viem';
import { buildBatch, MAX_BATCH_CLAIMS, eligible, totals, validateScan, type FeeClaim, type Scan } from './ecosystem';
const treasury='0xD88539d3c4C460136a733A3Fd60cf6BF269079da';
const base:FeeClaim={id:'x',chainId:4663,to:'0x0000000000000000000000000000000000000001',data:'0x8d19d6ea',recipient:treasury,amount:'1',asset:'0x0000000000000000000000000000000000000000',symbol:'ETH',decimals:18,source:'Module Mode',permissionless:true,runtimeCodeHash:null};
const scan=(claims:FeeClaim[]):Scan=>({chainId:4663,claims,scannedAt:1,blockNumber:'1',complete:true,issues:[],unsupported:[],launchCount:1,sourceCount:claims.length});
describe('fee ownership and batching',()=>{
 it('encodes only zero-value fixed-recipient claims and cannot partially execute',()=>{const tx=buildBatch([base]);expect(tx.value).toBe(0n);const decoded=decodeFunctionData({abi:multicall3Abi,data:tx.data});expect(decoded.functionName).toBe('aggregate3');expect(decoded.args?.[0]).toEqual([{target:base.to,allowFailure:false,callData:base.data}]);});
 it('never puts sender-restricted fees in Multicall',()=>{expect(()=>buildBatch([{...base,permissionless:false}])).toThrow();expect(eligible([{...base,permissionless:false}],base.to)).toHaveLength(0);expect(eligible([{...base,permissionless:false}],treasury)).toHaveLength(1);});
 it('rejects duplicate claims even when the API gives them different labels',()=>expect(()=>validateScan(scan([base,{...base,id:'different'}]))).toThrow());
 it('rejects mixing Ethereum claims into a Robinhood transaction',()=>expect(()=>buildBatch([base,{...base,to:treasury,chainId:1}])).toThrow());
 it('keeps token units apart and includes dust without a minimum',()=>{const result=totals([base,{...base,to:treasury,asset:treasury,symbol:'USDC',decimals:6,amount:'2'}]);expect(result).toEqual([{symbol:'ETH',decimals:18,amount:1n},{symbol:'USDC',decimals:6,amount:2n}]);});
 it('counts a dual-currency claim once while showing both payouts',()=>{const c:FeeClaim={...base,additionalAssets:[{asset:treasury,amount:'50',symbol:'V4',decimals:18}]};expect(validateScan(scan([c])).claims).toHaveLength(1);expect(totals([c])).toHaveLength(2);});
 it.each(['0','-1','1.2'])('rejects nonclaimable amount %s',amount=>expect(()=>validateScan(scan([{...base,amount}]))).toThrow());
});

it('groups 256 fee accounts within the RPC size bound and rejects larger requests',()=>{
 const claims=Array.from({length:MAX_BATCH_CLAIMS},(_,i)=>({...base,to:toHex(i+1,{size:20})}));
 const tx=buildBatch(claims);
 expect(decodeFunctionData({abi:multicall3Abi,data:tx.data}).args?.[0]).toHaveLength(256);
 expect(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[tx]},(_,v)=>typeof v==='bigint'?'0x0':v).length).toBeLessThan(128000);
 expect(()=>buildBatch([...claims,{...base,to:treasury}])).toThrow();
});
