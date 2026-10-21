import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, toHex, type Hex } from 'viem';
import { claimEcosystem, type FeeClaim, type Scan } from './ecosystem';

const mocks=vi.hoisted(()=>({client:{} as Record<string,unknown>,send:vi.fn(),entry:null as unknown}));
vi.mock('viem',async importOriginal=>{
 const actual=await importOriginal<typeof import('viem')>();
 return {...actual,createPublicClient:()=>mocks.client,createWalletClient:()=>({sendTransaction:mocks.send}),
  keccak256:(data:Hex)=>data==='0x01'?'0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891':actual.keccak256(data)};
});
vi.mock('./pending',()=>({pending:()=>mocks.entry,remember:(value:unknown)=>{mocks.entry=value;},
 findMinedClaim:vi.fn(),verifyPendingClaim:async()=>({outcome:'confirmed',blockNumber:100n}),walletRequestNotSent:()=>false}));
const account='0xD88539d3c4C460136a733A3Fd60cf6BF269079da';
const connection={account,provider:{request:async({method}:{method:string})=>method==='eth_chainId'?'0x1':[account]}} as unknown as Parameters<typeof claimEcosystem>[1];
const size=(data:Hex)=>decodeFunctionData({abi:multicall3Abi,data}).args![0]!.length;
function scan(count:number):Scan{
 const claims:FeeClaim[]=Array.from({length:count},(_,i)=>({id:String(i),chainId:1,to:toHex(i+1,{size:20}),data:'0x8d19d6ea',
  recipient:account,amount:'1',asset:toHex(0,{size:20}),symbol:'ETH',decimals:18,source:'Module Mode',permissionless:true,runtimeCodeHash:null}));
 return {chainId:1,claims,scannedAt:Date.now(),blockNumber:'99',complete:true,issues:[],unsupported:[],launchCount:count,sourceCount:count};
}
beforeEach(()=>{
 mocks.entry=null;mocks.send.mockReset().mockResolvedValue(toHex(123,{size:32}));
 mocks.client={getCode:async()=>'0x01',getBlockNumber:async()=>100n,getBlock:async()=>({gasLimit:60000000n}),
  estimateGas:vi.fn(async({data}:{data:Hex})=>{if(size(data)>128)throw {cause:{shortMessage:'Multicall3: call failed'}};return 11500000n;}),
  call:vi.fn(async({data}:{data:Hex})=>({data:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:Array.from({length:size(data)},()=>({success:true,returnData:'0x' as const}))})})),
  getGasPrice:async()=>1000000000n,getBalance:async()=>10n**18n,getTransactionCount:async()=>0,getTransactionReceipt:async()=>({})};
});
describe('wallet execution with large claim sets',()=>{
 it('splits oversized packets before asking the wallet, then simulates both smaller packets on both providers',async()=>{
  await claimEcosystem(scan(256),connection,()=>{});
  expect(mocks.send).toHaveBeenCalledTimes(2);
  for(const [tx] of mocks.send.mock.calls){expect(size(tx.data)).toBe(128);expect(tx.gas).toBe(13800000n);expect(tx.value).toBe(0n);}
  expect(mocks.client.call).toHaveBeenCalledTimes(4);
  expect((mocks.client.estimateGas as ReturnType<typeof vi.fn>).mock.calls.map(([tx])=>size(tx.data))).toEqual([256,128,128]);
  for(const [tx] of (mocks.client.estimateGas as ReturnType<typeof vi.fn>).mock.calls)expect(tx.gasPrice).toBe(0n);
 });
 it('does not bypass the actual gas balance check after estimating with zero gas price',async()=>{
  mocks.client.getBalance=async()=>0n;
  await expect(claimEcosystem(scan(2),connection,()=>{})).rejects.toThrow('ETH für Gas');
  expect(mocks.send).not.toHaveBeenCalled();
 });
 it('does not interpret network errors as permission to split and send',async()=>{
  mocks.client.estimateGas=async()=>{throw Error('RPC rate limit');};
  await expect(claimEcosystem(scan(256),connection,()=>{})).rejects.toThrow('RPC rate limit');
  expect(mocks.send).not.toHaveBeenCalled();
 });
 it('keeps a reverted single claim blocked without asking the wallet',async()=>{
  mocks.client.estimateGas=async()=>{throw Error('Multicall3: call failed');};
  await expect(claimEcosystem(scan(1),connection,()=>{})).rejects.toThrow('Multicall3: call failed');
  expect(mocks.send).not.toHaveBeenCalled();
 });
});
