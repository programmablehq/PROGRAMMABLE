import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, decodeFunctionResult, multicall3Abi, keccak256, type Address, type Hex, type EIP1193Provider } from 'viem';
import { mainnet } from 'viem/chains';
import { robinhoodChain } from './config';
import { pending, remember, findMinedClaim, verifyPendingClaim, walletRequestNotSent } from './pending';
export { pending, pendingClaims, remember, walletRequestNotSent } from './pending';
interface ClaimAsset {asset:Address;amount:string;symbol:string;decimals:number}
export interface FeeClaim extends ClaimAsset {id:string;chainId:1|4663;to:Address;data:Hex;recipient:Address;source:string;permissionless:boolean;runtimeCodeHash:Hex|null;additionalAssets?:ClaimAsset[]}
export interface Scan {chainId:1|4663;scannedAt:number;blockNumber:string;claims:FeeClaim[];blockedClaims?:{claim:FeeClaim;reason:string}[];complete:boolean;issues:{source:string;message:string}[];unsupported:string[];launchCount:number;sourceCount:number}
const MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11' as Address;
export const MAX_BATCH_CLAIMS=256;
const MULTICALL_HASH='0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
const confirmedBlocks=new Map<number,bigint>();
const same=(a:unknown,b:unknown)=>String(a).toLowerCase()===String(b).toLowerCase();
const address=(v:unknown):v is Address=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
const hex=(v:unknown):v is Hex=>typeof v==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(v);
export const chain=idChain;
function idChain(id:1|4663){return id===1?mainnet:robinhoodChain;}
export function readers(id:1|4663){return ['primary','secondary'].map(p=>createPublicClient({chain:chain(id),transport:http(`/api/rpc?chainId=${id}&provider=${p}`,{timeout:25000,retryCount:1})}));}
export function validateScan(value:Scan):Scan {
  if(!value||![1,4663].includes(value.chainId)||!Array.isArray(value.claims)||!Array.isArray(value.issues)||!Array.isArray(value.unsupported))throw Error('Der Scan ist unvollständig.');
  const ids=new Set();
  for(const c of value.claims){
    if(c.chainId!==value.chainId||!address(c.to)||!address(c.recipient)||!address(c.asset)||!hex(c.data)||c.data.length<10||!/^\d+$/.test(c.amount)||BigInt(c.amount)<=0n||!Number.isInteger(c.decimals)||c.decimals<0||c.decimals>36||typeof c.symbol!=='string'||c.symbol.length>64||typeof c.permissionless!=='boolean')throw Error('Ein Claim ist nicht vollständig geprüft.');
    for(const a of c.additionalAssets??[])if(!address(a.asset)||!/^\d+$/.test(a.amount)||BigInt(a.amount)<=0n||!Number.isInteger(a.decimals)||a.decimals<0||a.decimals>36||typeof a.symbol!=='string'||a.symbol.length>64)throw Error('Zusätzliche Token-Gebühren sind nicht geprüft.');
    const id=`${c.chainId}:${c.to.toLowerCase()}:${c.data.toLowerCase()}`;if(ids.has(id))throw Error('Doppelter Claim.');ids.add(id);
  }return value;
}
export async function scanChain(id:1|4663,progress:(s:string)=>void):Promise<Scan>{
  const response=await fetch(`/api/scan?chainId=${id}&minimumBlock=${confirmedBlocks.get(id)??0n}`,{cache:'no-store',signal:AbortSignal.timeout(310000)});if(!response.ok||!response.body)throw Error('Scan ist gerade nicht erreichbar.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',result:Scan|undefined;
  const line=(s:string)=>{if(!s.trim())return;const data=JSON.parse(s);if(data.type==='progress')progress(data.message);if(data.type==='error')throw Error(data.message);if(data.type==='result')result=validateScan(data.result);};
  try{for(;;){const chunk=await reader.read();text+=decoder.decode(chunk.value,{stream:!chunk.done});let n;while((n=text.indexOf('\n'))>=0){line(text.slice(0,n));text=text.slice(n+1);}if(chunk.done)break;}if(text)line(text);}finally{reader.releaseLock();}
  if(!result||result.chainId!==id)throw Error('Scan wurde nicht abgeschlossen. Bitte erneut scannen.');return result;
}
export async function connect():Promise<{provider:EIP1193Provider;account:Address}>{
  const provider=window.ethereum;if(!provider)throw Error('Bitte in einer Wallet öffnen oder MetaMask verbinden.');
  const accounts=await provider.request({method:'eth_requestAccounts'}) as Address[];if(!accounts[0])throw Error('Keine Wallet verbunden.');return {provider,account:accounts[0]};
}
export async function ensureChain(provider:EIP1193Provider,id:1|4663){
  const chainId=`0x${id.toString(16)}`;if(same(await provider.request({method:'eth_chainId'}),chainId))return;
  try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
  catch(e){if((e as {code?:number}).code!==4902)throw e;const network=chain(id);await provider.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:network.name,nativeCurrency:network.nativeCurrency,rpcUrls:[network.rpcUrls.default.http[0]],blockExplorerUrls:[network.blockExplorers!.default.url]}]});}
  if(!same(await provider.request({method:'eth_chainId'}),chainId))throw Error('Bitte die angezeigte Chain in der Wallet wählen.');
}
export function totals(claims:FeeClaim[]){const map=new Map<string,{symbol:string;decimals:number;amount:bigint}>();for(const claim of claims)for(const c of [claim,...claim.additionalAssets??[]]){const key=c.asset.toLowerCase();const item=map.get(key)??{symbol:c.symbol,decimals:c.decimals,amount:0n};if(item.decimals!==c.decimals)throw Error('Währungsdaten stimmen nicht.');item.amount+=BigInt(c.amount);map.set(key,item);}return [...map.values()];}
export function eligible(claims:FeeClaim[],account?:Address){return claims.filter(c=>c.permissionless||same(account,c.recipient));}
export function buildBatch(claims:FeeClaim[]){
  if(!claims.length||claims.length>MAX_BATCH_CLAIMS||claims.some(c=>!c.permissionless)||new Set(claims.map(c=>c.chainId)).size!==1)throw Error('Ungültiger Sammelclaim.');
  validateScan({chainId:claims[0]!.chainId,claims,issues:[],unsupported:[],complete:true,blockNumber:'0',scannedAt:Date.now(),sourceCount:claims.length,launchCount:0});
  return {to:MULTICALL,data:encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[claims.map(c=>({target:c.to,allowFailure:false,callData:c.data}))]}),value:0n};
}
export async function checkPending(progress:(message:string)=>void,chainId?:1|4663){
  const entry=pending(chainId);if(!entry)return;
  const clients=readers(entry.chainId);
  if(entry.atomic){
    if(!entry.batchId||!window.ethereum)throw Error('Bitte den letzten Sammelclaim in der Wallet prüfen.');
    const rpc=window.ethereum as unknown as {request(args:{method:string;params:unknown[]}):Promise<{id:string;chainId:string;status:number;atomic:boolean;receipts?:{transactionHash:Hex;blockHash:Hex;status:string}[]}>};
    progress('Sammelclaim wird bestätigt…');
    for(let i=0;i<90;i++){
      const status=await rpc.request({method:'wallet_getCallsStatus',params:[entry.batchId]});
      if(!same(status.id,entry.batchId)||BigInt(status.chainId)!==BigInt(entry.chainId)||status.atomic!==true)throw Error('Die Wallet-Bestätigung stimmt nicht mit diesem Sammelclaim überein.');
      if(status.status===200){
        if(!status.receipts?.length||status.receipts.some(r=>r.status!=='0x1'))throw Error('Die Wallet hat keinen vollständigen Beleg geliefert.');
        for(const proof of status.receipts){const receipts=await Promise.all(clients.map(c=>c.getTransactionReceipt({hash:proof.transactionHash})));if(receipts.some(r=>r.status!=='success'||!same(r.blockHash,proof.blockHash)))throw Error('Sammelclaim wird noch auf der Chain geprüft.');confirmedBlocks.set(entry.chainId,receipts[0]!.blockNumber);}
        remember(null,entry.chainId);progress('Sammelclaim bestätigt.');return status.receipts[0]!.transactionHash;
      }
      if(status.status>=400){remember(null,entry.chainId);throw Error('Sammelclaim fehlgeschlagen. Bitte erneut scannen.');}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw Error('Bestätigung dauert noch. Du kannst den Status später weiter prüfen.');
  }
  progress('Vorherigen Wallet-Auftrag prüfen…');
  let mined=entry.hash;
  if(mined){
    try{await clients[0]!.getTransactionReceipt({hash:mined});}
    catch(error){
      if((error as Error).name!=='TransactionReceiptNotFoundError')throw error;
      mined=await findMinedClaim(entry,clients)??undefined;
    }
  }else mined=await findMinedClaim(entry,clients)??undefined;
  if(!mined&&entry.hash){
    progress('Auf Bestätigung warten…');
    const receipt=await clients[0]!.waitForTransactionReceipt({hash:entry.hash,timeout:30000,
      onReplaced:({transaction})=>{entry.hash=transaction.hash;remember(entry);}});
    mined=receipt.transactionHash;
  }
  if(!mined)throw Error('Der letzte Wallet-Auftrag ist noch offen. Bitte in der Wallet abschließen oder ablehnen.');
  if(entry.hash!==mined){entry.hash=mined;remember(entry);}
  const result=await verifyPendingClaim(entry,mined,clients);
  confirmedBlocks.set(entry.chainId,result.blockNumber);
  remember(null,entry.chainId);
  progress(result.outcome==='confirmed'?'Claim bestätigt.':result.outcome==='replaced'?'Vorheriger Auftrag wurde ersetzt. Du kannst erneut claimen.':'Vorheriger Claim fehlgeschlagen. Du kannst erneut claimen.');
  return result;

}
function gasResourceLimit(error:unknown):boolean{
 let e=error as {message?:string;shortMessage?:string;cause?:unknown}|undefined;
 for(let i=0;e&&i<8;i++,e=e.cause as typeof e){
  if(/out of gas|Multicall3: call failed|gas required exceeds allowance|exceeds.*gas limit|gas.*cap|intrinsic gas too low/i.test(String(e.shortMessage??e.message??'')))return true;
 }return false;
}

export async function claimEcosystem(scan:Scan,connection:{provider:EIP1193Provider;account:Address},progress:(message:string)=>void){
  if(pending(scan.chainId))await checkPending(progress,scan.chainId);
  await ensureChain(connection.provider,scan.chainId);
  const accounts=await connection.provider.request({method:'eth_accounts'}) as Address[];
  if(!same(accounts[0],connection.account))throw Error('Wallet wurde gewechselt. Bitte erneut verbinden.');
  const claims=eligible(scan.claims,connection.account);if(!claims.length)throw Error('Für diese Wallet sind keine geprüften Claims offen.');
  if(Date.now()-scan.scannedAt>120000)throw Error('Bitte zuerst neu scannen, damit die Beträge aktuell sind.');
  const clients=readers(scan.chainId);
  const codes=await Promise.all(clients.map(c=>c.getCode({address:MULTICALL})));if(codes.some(code=>!code||!same(keccak256(code),MULTICALL_HASH)))throw Error('Sammelclaim-Vertrag stimmt nicht.');
  const packets:{to:Address;data:Hex;value:bigint;batch:boolean;atomic?:FeeClaim[];claims?:FeeClaim[]}[]=[];
  const publicClaims=claims.filter(c=>c.permissionless);
  for(let i=0;i<publicClaims.length;i+=MAX_BATCH_CLAIMS){const chunk=publicClaims.slice(i,i+MAX_BATCH_CLAIMS);packets.push({...buildBatch(chunk),batch:true,claims:chunk});}
  const restricted=claims.filter(c=>!c.permissionless);
  const rpc=connection.provider as unknown as {request(args:{method:string;params:unknown[]}):Promise<unknown>};
  let atomic=false;
  if(restricted.length>1){try{const capability=await rpc.request({method:'wallet_getCapabilities',params:[connection.account,[`0x${scan.chainId.toString(16)}`]]}) as Record<string,{atomic?:{status?:string}}>;
    atomic=['ready','supported'].includes(capability[`0x${scan.chainId.toString(16)}`]?.atomic?.status??'');}catch{/* Older wallets retain individual claims. */}}
  if(atomic){for(let i=0;i<restricted.length;i+=10)packets.push({to:connection.account,data:'0x',value:0n,batch:false,atomic:restricted.slice(i,i+10)});}
  else for(const c of restricted)packets.push({to:c.to,data:c.data,value:0n,batch:false});
  const wallet=createWalletClient({account:connection.account,chain:chain(scan.chainId),transport:custom(connection.provider)});
  for(let i=0;i<packets.length;i++){
    const packet=packets[i]!;progress(`Claim ${i+1}/${packets.length} wird vorbereitet…`);
    const heads=await Promise.all(clients.map(c=>c.getBlockNumber({cacheTime:0})));const blockNumber=heads.reduce((a,b)=>a<b?a:b);
    if(packet.atomic){
      for(const c of packet.atomic){const results=await Promise.all(clients.map(client=>client.call({to:c.to,data:c.data,account:connection.account,blockNumber})));if(!same(results[0]!.data,results[1]!.data))throw Error('Sammelclaim-Simulation stimmt nicht überein.');}
      const entry={chainId:scan.chainId,account:connection.account,to:packet.to,data:packet.data,nonce:0,created:Date.now(),atomic:true};remember(entry);
      try{
        progress(`Sammelclaim in der Wallet bestätigen · ${i+1}/${packets.length}`);
        const result=await rpc.request({method:'wallet_sendCalls',params:[{version:'2.0.0',chainId:`0x${scan.chainId.toString(16)}`,from:connection.account,atomicRequired:true,calls:packet.atomic.map(c=>({to:c.to,data:c.data,value:'0x0'}))}]}) as string|{id:string};
        const batchId=typeof result==='string'?result:result.id;if(typeof batchId!=='string'||!batchId.length)throw Error('Die Wallet hat keine Sammelclaim-ID geliefert.');remember({...entry,batchId});
      }catch(error){if(walletRequestNotSent(error,[4001,4100,-32602,5700,5710,5740,5750,5760]))remember(null,entry.chainId);throw error;}
      await checkPending(progress,scan.chainId);continue;
    }
    // Bound a wallet transaction by current chain capacity and RPC simulation
    // limits. Oversized groups split before any wallet request is created.
    const splitPacket=()=>{
      if(!packet.claims||packet.claims.length<2)return false;
      const mid=Math.ceil(packet.claims.length/2);
      packets.splice(i,1,...[packet.claims.slice(0,mid),packet.claims.slice(mid)].map(chunk=>({...buildBatch(chunk),batch:true,claims:chunk})));
      i--;return true;
    };
    let gas:bigint;
    // Ignore the sender balance only while estimating execution. The actual
    // network price and available ETH are checked before requesting a signature.
    try{gas=await clients[0]!.estimateGas({to:packet.to,data:packet.data,value:0n,account:connection.account,gas:16000000n,gasPrice:0n});}
    catch(error){if(gasResourceLimit(error)&&splitPacket())continue;throw error;}
    const block=await clients[0]!.getBlock({blockNumber});
    const gasCeiling=block.gasLimit*9n/10n<16000000n?block.gasLimit*9n/10n:16000000n;
    if(gas*120n/100n>gasCeiling){
      if(splitPacket())continue;
      throw Error('Dieser Claim überschreitet das sichere Gas-Limit.');
    }
    const calls=await Promise.all(clients.map(c=>c.call({to:packet.to,data:packet.data,account:connection.account,blockNumber,gas:gas*120n/100n})));
    if(!same(calls[0]!.data,calls[1]!.data))throw Error('Die Claim-Simulation stimmt nicht überein. Bitte neu scannen.');
    if(packet.batch){const results=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:calls[0]!.data!});if(results.some(r=>!r.success))throw Error('Mindestens ein Claim ist nicht mehr verfügbar. Bitte neu scannen.');}
    const [price,balance,nonce]=await Promise.all([clients[0]!.getGasPrice(),clients[0]!.getBalance({address:connection.account}),clients[0]!.getTransactionCount({address:connection.account,blockTag:'pending'})]);
    if(balance<gas*price*125n/100n)throw Error(`Bitte etwas ETH für Gas auf ${chain(scan.chainId).name} nachlegen.`);
    const entry={chainId:scan.chainId,account:connection.account,to:packet.to,data:packet.data,nonce,created:Date.now()};remember(entry);
    try{progress(`In der Wallet bestätigen · ${i+1}/${packets.length}`);const hash=await wallet.sendTransaction({to:packet.to,data:packet.data,value:0n,gas:gas*120n/100n,nonce});remember({...entry,hash});}
    catch(error){if(walletRequestNotSent(error))remember(null,entry.chainId);throw error;}
    const result=await checkPending(progress,scan.chainId);
    if(result&&typeof result!=='string'&&result.outcome!=='confirmed')throw Error('Der Claim wurde ersetzt oder ist fehlgeschlagen. Bitte neu scannen und erneut claimen.');
  }
  return {count:claims.length,remaining:scan.claims.length-claims.length};
}
