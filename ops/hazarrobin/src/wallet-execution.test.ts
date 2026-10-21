import {expect,it} from 'vitest';
import {concat,encodeAbiParameters,encodeFunctionData,parseAbi,parseAbiParameters,toHex} from 'viem';
import {matchesWalletExecution,walletExecutionAbi,type PendingClaim} from './pending';
const entry:PendingClaim={chainId:4663,account:'0x0000000000000000000000000000000000000001',to:'0x0000000000000000000000000000000000000002',data:'0x12345678',nonce:7,created:1};
const manager='0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
const single=concat([entry.to,toHex(0,{size:32}),entry.data]);
const delegationType = parseAbiParameters('(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]');
const emptyContext = encodeAbiParameters(delegationType,[[]]);
const wrap=(executions=[single],modes=[toHex(0,{size:32})])=>({from:entry.account,to:manager,value:0n,input:encodeFunctionData({abi:walletExecutionAbi,functionName:'redeemDelegations',args:[[emptyContext],modes,executions]})});
it('recognizes exactly one zero-value MetaMask execution of the prepared claim',()=>expect(matchesWalletExecution(entry,wrap())).toBe('metamask'));
it('rejects added calls and failure-tolerant or batch wallet modes',()=>{expect(matchesWalletExecution(entry,wrap([single,single]))).toBeNull();expect(matchesWalletExecution(entry,wrap([single],[toHex(1,{size:32})]))).toBeNull();});
it('rejects changes to the inner recipient, amount, calldata or manager',()=>{for(const packed of [concat([entry.account,toHex(0,{size:32}),entry.data]),concat([entry.to,toHex(1,{size:32}),entry.data]),concat([entry.to,toHex(0,{size:32}),'0x87654321'])])expect(matchesWalletExecution(entry,wrap([packed]))).toBeNull();expect(matchesWalletExecution(entry,{...wrap(),to:entry.account})).toBeNull();});
it('rejects nonzero outer value and extra bytes',()=>{expect(matchesWalletExecution(entry,{...wrap(),value:1n})).toBeNull();expect(matchesWalletExecution(entry,{...wrap(),input:concat([wrap().input,'0x00'])})).toBeNull();});

const relayer = '0x0000000000000000000000000000000000000003';
function relayContext(root: `0x${string}` = entry.account) {
 return encodeAbiParameters(delegationType, [[{delegate: relayer, delegator: root, authority: `0x${'ff'.repeat(32)}`, caveats: [], salt: 0n, signature: '0x01'}]]);
}
const relay = (root: `0x${string}` = entry.account) => ({...wrap(), from: relayer, input: encodeFunctionData({abi:walletExecutionAbi,functionName:'redeemDelegations',args:[[relayContext(root)],[toHex(0,{size:32})],[single]]})});
it('binds a relayed MetaMask execution to the delegated account, not the gas payer',()=>expect(matchesWalletExecution(entry,relay())).toBe('metamask'));
it('does not treat another account delegation as this wallet execution',()=>expect(matchesWalletExecution(entry,relay(relayer))).toBeNull());
it('rejects self-authorization sent by another wallet',()=>expect(matchesWalletExecution(entry,{...wrap(),from:relayer})).toBeNull());
it('rejects a relayer not named as the delegate',()=>expect(matchesWalletExecution(entry,{...relay(),from:entry.to})).toBeNull());
it('does not accept a direct call by another account as this wallet execution',()=>expect(matchesWalletExecution(entry,{from:relayer,to:entry.to,input:entry.data,value:0n})).toBeNull());

const batchType = parseAbiParameters('(address target,uint256 value,bytes callData)[]');
const batchMode = `0x01${'00'.repeat(31)}` as const;
const enforcer = '0x1e141e455d08721Dd5BCDA1BaA6Ea5633Afd5017';
const claim = {target: entry.to, value: 0n, callData: entry.data};
const payment = {target: toHex(4, {size:20}), value: 0n,
 callData: encodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),functionName:'transfer',args:[toHex(5,{size:20}),100n]})};
function batch(calls = [claim, payment], options: {terms?: `0x${string}`; mode?: `0x${string}`; root?: `0x${string}`; enforcer?: `0x${string}`} = {}) {
 const packed = encodeAbiParameters(batchType,[calls]);
 const context = encodeAbiParameters(delegationType,[[{delegate:relayer,delegator:options.root??entry.account,
  authority:`0x${'ff'.repeat(32)}`,caveats:[{enforcer:options.enforcer??enforcer,terms:options.terms??packed,args:'0x'}],salt:0n,signature:'0x01'}]]);
 return {...wrap(),from:relayer,input:encodeFunctionData({abi:walletExecutionAbi,functionName:'redeemDelegations',args:[[context],[options.mode??batchMode],[packed]]})};
}
it('recognizes the exact claim in a strict signed MetaMask batch with a token gas payment',()=>{
 expect(matchesWalletExecution(entry,batch())).toBe('metamask');
 expect(matchesWalletExecution(entry,batch([claim]))).toBe('metamask');
});
it('keeps the stored claim and root wallet exact inside a batch',()=>{
 expect(matchesWalletExecution({...entry,data:'0x87654321'},batch())).toBeNull();
 expect(matchesWalletExecution({...entry,to:relayer},batch())).toBeNull();
 expect(matchesWalletExecution(entry,batch(undefined,{root:relayer}))).toBeNull();
 expect(matchesWalletExecution(entry,{...batch(),from:entry.to})).toBeNull();
});
it('requires the signed full-batch commitment and strict execution mode',()=>{
 expect(matchesWalletExecution(entry,batch(undefined,{terms:encodeAbiParameters(batchType,[[claim]])}))).toBeNull();
 expect(matchesWalletExecution(entry,batch(undefined,{enforcer:entry.to}))).toBeNull();
 expect(matchesWalletExecution(entry,batch(undefined,{mode:`0x0101${'00'.repeat(30)}`}))).toBeNull();
});
it('does not accept arbitrary extra calls or payments as a claim receipt',()=>{
 for(const calls of [[claim,payment,payment],[payment,claim],[claim,claim],[{...claim,value:1n},payment],
  [claim,{...payment,value:1n}],[claim,{...payment,callData:'0x12345678' as const}],
  [claim,{...payment,callData:concat([payment.callData,'0x00'])}]]) expect(matchesWalletExecution(entry,batch(calls))).toBeNull();
});
