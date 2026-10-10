import { parseAbi, encodeFunctionData, keccak256, getAddress } from 'viem';
import deployments from '../vendor/deployments.json' with {type:'json'};
import nonProjectCustom from '../vendor/non-project-custom.json' with {type:'json'};
import customRevenueVaults from '../vendor/custom-revenue-vaults.json' with {type:'json'};
import { createFoundationScanner } from './foundation.mjs';
import { scanLegacyEthereum } from './legacy-ethereum.mjs';
import { executableClaims } from './claimability.mjs';
import { immutablePoolFeeRequiredAddresses, proveImmutablePoolFeeRuntime, ethereumNative30RequiredAddressesV1, proveEthereumNative30RuntimeV1 } from '../vendor/native-proofs.mjs';
import { rpcClients, checkpoint, pin, readBoth, mapLimit, recoverRpcRead, rangeLogs, same, need, json, MULTICALL, MULTICALL_HASH } from './rpc.mjs';
import { LAUNCH_STAMP_TOPICS, reduceLaunchStampLogs } from '../vendor/logic.mjs';

export const PROJECT_WALLETS=['0xD88539d3c4C460136a733A3Fd60cf6BF269079da','0x39544A7023081B56D7405c1af0bFaf72da7e24F6','0x4957f49620AFf3Adbbe8195a4f633E49cc93376c'];
const ZERO='0x0000000000000000000000000000000000000000';
const ABI=parseAbi(['function claimable(address) view returns(uint256)','function claimableEth(address) view returns(uint256)','function treasury() view returns(address)',
  'function claim(address) returns(uint256)','function claimEthFor(address) returns(uint256)','function claim(address,address) returns(uint256)',
  'function claimPlatform() returns(uint256)','function platformAccrued() view returns(uint256)','function creatorAccrued() view returns(uint256)',
  'function creatorRecipient() view returns(address)','function PLATFORM_RECIPIENT() view returns(address)','function balanceOf(address,uint256) view returns(uint256)',
  'function FEE_RECIPIENT() view returns(address)',
  'function platformRevenue() view returns(address)','function poolManager() view returns(address)','function beneficiary() view returns(address)',
  'function hook() view returns(address)','function canonicalPlatformBalance() view returns(uint256)','function additionalPlatformBalance() view returns(uint256)',
  'function unassignedBalance() view returns(uint256)','function balance() view returns(uint256)',
  'function claimCanonical(uint256)','function claimAdditional(uint256)','function claimUnassigned(uint256)',
  'function lpFee() view returns(uint24)','function tickSpacing() view returns(int24)','function token() view returns(address)',
  'function implementation() view returns(address)','function implementationCodeHash() view returns(bytes32)','function GRAPH_FACTORY() view returns(address)','function initialized() view returns(bool)']);
const call=(address,functionName,args=[])=>({address,abi:ABI,functionName,args});
const selectors={platform:encodeFunctionData(call(ZERO,'claimPlatform'))};
const groups=new Map();

function descriptor(input) {
  return {...input,id:`${input.chainId}:${input.to.toLowerCase()}:${input.data.toLowerCase()}`,amount:String(input.amount),decimals:input.decimals??18,symbol:input.symbol??'ETH',asset:input.asset??ZERO};
}

export async function ethereumDiscovery(clients, block, abis, progress=()=>{}) {
  const releases=(deployments.ethereumModuleHistory??[deployments.ethereumModule]).map(r=>r.payload);
  const root=deployments.ethereum.canonicalStamp;
  const active=releases.filter(r=>BigInt(r.startBlock)<=block.number);
  await Promise.all([...active.map(r=>pin(clients,r.implementation,block.number)),pin(clients,root.graphFactory,block.number)]);
  const event=abis.v3.find(e=>e.type==='event');
  const from=releases.reduce((a,r)=>BigInt(r.startBlock)<a?BigInt(r.startBlock):a,BigInt(releases[0].startBlock));
  const logs=await rangeLogs(clients[1],{event},from,block.number);
  progress(`${logs.length} Ethereum-Module werden geprüft…`);
  let checked=0;
  const batches=[];for(let i=0;i<logs.length;i+=12)batches.push(logs.slice(i,i+12));
  return (await mapLimit(batches,2,async batch=>{
    for(const log of batch)need(log.args?.token&&log.args?.ledger&&!log.removed,'Ungültiger Ethereum-Moduleintrag.');
    const recognized=(await Promise.all(batch.map(async log=>{
      const codes=await Promise.all(clients.map(c=>c.getCode({address:log.address,blockNumber:block.number})));
      need(codes.every(c=>same(c,codes[0])),'Ethereum-Module unterscheiden sich zwischen Anbietern.');
      const release=active.find(r=>codes[0]&&keccak256(codes[0])===r.proxyRuntimeCodeHash&&log.blockNumber>=BigInt(r.startBlock));
      return release?{log,release}:null;
    }))).filter(Boolean);
    const values=recognized.length?await readBoth(clients,recognized.flatMap(({log})=>['implementation','implementationCodeHash','GRAPH_FACTORY','initialized'].map(n=>call(log.address,n))),block.number):[];
    const found=recognized.map(({log,release},i)=>{
      const [impl,hash,factory,initialized]=values.slice(i*4,i*4+4);
      need(same(impl,release.implementation.address)&&same(hash,release.implementation.runtimeCodeHash)&&same(factory,root.graphFactory.address)&&initialized,'Module-Quelle stimmt nicht.');
      return {...log.args,log,release:{factoryVersion:'v3',factory:{address:log.address},startBlock:BigInt(release.startBlock)}};
    });
    checked+=found.length;progress(`Ethereum-Module: ${checked}/${logs.length}`);return found;
  })).flat();
}

export async function scanFoundation(chainId, clients, progress, onDiscovered) {
  const manager=chainId===1?deployments.ethereum.contracts.poolManager:deployments.robinhoodCustom.contracts.poolManager;
  const scanner=createFoundationScanner({chainId,manager,lag:chainId===1?2:16});
  const result=await scanner.scanFees({clients,releases:chainId===4663?scanner.parseReleases(deployments.foundation):[],progress,onDiscovered,
    ...(chainId===1?{discover:(c,b,a)=>ethereumDiscovery(c,b,a,progress)}:{})});
  const assets=new Map(result.assets.map(a=>[a.address.toLowerCase(),a]));
  return {claims:result.claims.map(c=>descriptor({chainId,to:c.ledger,data:selectors.platform,recipient:PROJECT_WALLETS[0],amount:c.amount,
    asset:c.quote,symbol:assets.get(c.quote.toLowerCase()).symbol,decimals:assets.get(c.quote.toLowerCase()).decimals,source:'Module Mode',permissionless:true,
      runtimeCodeHash:null,token:c.token})), launchCount:result.launchCount,coveredHooks:result.launches.map(c=>c.hook),coveredTokens:result.launches.map(c=>c.token),unsupported:[]};
}

async function scanHistoricalRobinhood(clients,block) {
  const claims=[];
  for(const release of deployments.legacy){
    const native=release.contracts.rewardLedger, binding=native??release.contracts.ledger;
    await pin(clients,binding,block.number);
    // Native Module Mode credits by wallet; AnyQuote settles ETH to the same fixed beneficiary.
    const read=native?'claimable':'claimableEth';
    const recipients=[...PROJECT_WALLETS];
    const [treasury]=await readBoth(clients,[call(binding.address,'treasury')],block.number,true);
    if(treasury&&!recipients.some(w=>same(w,treasury))) recipients.push(treasury);
    const amounts=await readBoth(clients,recipients.map(w=>call(binding.address,read,[w])),block.number);
    for(let i=0;i<recipients.length;i++)if(amounts[i]>0n)claims.push(descriptor({chainId:4663,to:binding.address,
      data:encodeFunctionData(call(binding.address,native?'claim':'claimEthFor',[recipients[i]])),recipient:recipients[i],amount:amounts[i],
      source:'Module Mode · frühere Version',permissionless:true,runtimeCodeHash:binding.runtimeCodeHash}));
  }
  return {claims,launchCount:0,unsupported:[]};
}

export async function robinhoodHooks(clients,block) {
  const binding=deployments.robinhoodCustom.contracts.programmableLaunchStampRouter;
  await pin(clients,binding,block.number);
  const from=BigInt(deployments.robinhoodCustom.deploymentEvidence.blockNumber);
  const filters={address:binding.address};
  const raw=await rangeLogs(clients[1],{...filters,event:parseAbi(['event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)'])[0]},from,block.number,1000000n);
  // The canonical reducer validates exact event words and duplicate launch identities.
  return raw.map(l=>({...l.args,blockNumber:l.blockNumber,transactionHash:l.transactionHash}));
}

export async function scanNativeVaults(chainId,clients,block,candidates,progress) {
  const manager=chainId===1?deployments.ethereum.contracts.poolManager:deployments.robinhoodCustom.contracts.poolManager;
  await pin(clients,manager,block.number);
  const unique=[...new Map(candidates.map(c=>[(c.hook??c.hookAddress).toLowerCase(),c])).values()];
  const found=await mapLimit(unique,5,async candidate=>{
    const hook=candidate.hook??candidate.hookAddress;
    const codes=await Promise.all(clients.map(c=>c.getCode({address:hook,blockNumber:block.number})));
    need(codes.every(c=>same(c,codes[0])),'Custom-Hook-Daten unterscheiden sich.');
    const revenue=customRevenueVaults.find(p=>p.chainId===chainId&&same(p.hook,hook));
    if(revenue){
      await pin(clients,revenue,block.number);
      const [recipient,boundHook,core,canonical,additional,unassigned,balance]=await readBoth(clients,
        ['beneficiary','hook','poolManager','canonicalPlatformBalance','additionalPlatformBalance','unassignedBalance','balance'].map(n=>call(revenue.address,n)),block.number);
      need(same(recipient,revenue.beneficiary)&&PROJECT_WALLETS.some(w=>same(w,recipient))&&same(boundHook,hook)&&same(core,manager.address)&&balance===canonical+additional+unassigned,'Custom-Gebührenzuordnung stimmt nicht.');
      const [activeVault]=await readBoth(clients,[call(hook,'platformRevenue')],block.number,true);
      const claims=[['claimCanonical',canonical],['claimAdditional',additional],['claimUnassigned',unassigned]]
        .filter(([,amount])=>amount>0n).map(([fn,amount])=>descriptor({chainId,to:revenue.address,data:encodeFunctionData(call(revenue.address,fn,[amount])),amount,
          recipient,source:'Custom Launch',permissionless:true,runtimeCodeHash:revenue.runtimeCodeHash}));
      return {claims,...(same(activeVault,revenue.address)?{covered:hook}:{unsupported:hook})};
    }
    const excluded=nonProjectCustom.find(p=>p.chainId===chainId&&same(p.address,hook));
    if(excluded){
      need(same(keccak256(codes[0]),excluded.runtimeCodeHash),'Der geprüfte Custom-Vertrag hat sich geändert.');
      if(excluded.noFees)return {covered:hook};
      const [recipient]=await readBoth(clients,[call(hook,'FEE_RECIPIENT')],block.number);
      need(same(recipient,excluded.recipient)&&!PROJECT_WALLETS.some(w=>same(w,recipient)),'Die Custom-Gebührenzuordnung hat sich geändert.');
      return {covered:hook};
    }
    // These immutable kernels expose the pool key. Arbitrary custom bytecode is never treated as an adapter.
    const fields=await readBoth(clients,['lpFee','tickSpacing','token'].map(n=>call(hook,n)),block.number,true);
    if(fields.some(v=>v===null))return {unsupported:hook};
    const market={chainId:String(chainId),poolManager:manager.address,currency0:ZERO,currency1:fields[2],fee:Number(fields[0]),tickSpacing:Number(fields[1]),hooks:hook};
    const addresses=(chainId===1?ethereumNative30RequiredAddressesV1:immutablePoolFeeRequiredAddresses)(market,codes[0]);
    if(!addresses)return {unsupported:hook};
    const codeMap=Object.fromEntries(await Promise.all(addresses.map(async address=>{
      const values=await Promise.all(clients.map(c=>c.getCode({address,blockNumber:block.number})));
      need(values.every(v=>same(v,values[0])),'Custom-Vertragsdaten unterscheiden sich.');return [address,values[0]];
    })));
    const proof=(chainId===1?proveEthereumNative30RuntimeV1:proveImmutablePoolFeeRuntime)(market,codeMap);
    need(proof,'Custom-Gebührenvertrag stimmt nicht mit seiner Quelle überein.');
    const [amount,creatorAmount,backing]=await readBoth(clients,[call(proof.feeVault,'platformAccrued'),call(proof.feeVault,'creatorAccrued'),call(manager.address,'balanceOf',[proof.feeVault,0n])],block.number);
    need(backing>=amount+creatorAmount,'Custom-Gebühren sind nicht gedeckt.');
    return {claim:amount>0n?descriptor({chainId,to:proof.feeVault,data:selectors.platform,amount,recipient:proof.recipient,source:'Custom Launch',permissionless:true,
      runtimeCodeHash:keccak256(codeMap[proof.feeVault]),token:fields[2]}):null,covered:hook};
  });
  progress('Custom-Gebühren geprüft.');
  return {claims:found.flatMap(x=>x.claims??(x.claim?[x.claim]:[])),launchCount:unique.length,unsupported:found.filter(x=>x.unsupported).map(x=>x.unsupported),covered:found.filter(x=>x.covered).map(x=>x.covered)};
}

export async function scanEcosystem(chainId,progress=()=>{},minimumBlock=0n) {
  const clients=rpcClients(chainId); const pair=clients.slice(0,2);let block=await checkpoint(pair,chainId);
  for(let i=0;block.number<minimumBlock&&i<30;i++){progress('Auszahlung bestätigt. Gebührenstand wird aktualisiert…');await new Promise(r=>setTimeout(r,1000));block=await checkpoint(pair,chainId);}
  need(block.number>=minimumBlock,'Der neue Gebührenstand wird noch übernommen. Bitte erneut scannen.');
  await pin(pair,{address:MULTICALL,runtimeCodeHash:MULTICALL_HASH},block.number);
  const results=[];const issues=[];
  const run=async(label,fn)=>{progress(label);try{const result=await recoverRpcRead(fn,()=>progress(label+': Verbindung wird erneut geprüft…'));results.push(result);return result;}catch(e){const message=cleanError(e);issues.push({source:label,message});progress(label+': '+message);return null;}};
  // Foundation provenance and balances are already verified independently. Do
  // not re-read hundreds of the same tokens through the older custom adapter.
  let foundation,legacy,discovered=[];
  const capture=launches=>{discovered=launches;};
  if(chainId===1){
    foundation=await run('Module Mode',()=>scanFoundation(chainId,pair,progress,capture));
    legacy=await run('Frühere Launch-Versionen',()=>scanLegacyEthereum({clients,progress,balanceBlockNumber:block.number,excludedTokens:new Set(discovered.map(l=>l.token.toLowerCase()))}));
  }else [foundation,legacy]=await Promise.all([
    run('Module Mode',()=>scanFoundation(chainId,pair,progress,capture)),run('Frühere Launch-Versionen',()=>scanHistoricalRobinhood(pair,block)),
  ]);
  const candidates=chainId===1?legacy?.launches:await run('Custom-Launch-Historie',async()=>({launches:await robinhoodHooks(pair,block),claims:[],unsupported:[]}));
  const knownHooks=new Set(discovered.map(l=>l.hook.toLowerCase()));
  const list=(chainId===1?(candidates??[]):(candidates?.launches??[])).filter(c=>!knownHooks.has(c.hook.toLowerCase())&&c.claimMode!=='covered-by-known-hook');
  const native=await run('Custom Launches',()=>scanNativeVaults(chainId,pair,block,list,progress));
  const claims=new Map();for(const result of results)for(const raw of result.claims??[]){
    const secondary=raw.secondaryAmount>0n?{amount:String(raw.secondaryAmount),asset:raw.secondaryAsset,symbol:raw.secondaryUnit,decimals:raw.secondaryDecimals}:null;
    const c=raw.chainId?raw:descriptor({chainId,to:raw.to,data:raw.data,recipient:raw.recipient,amount:raw.amount,asset:raw.asset,
      symbol:raw.unit,decimals:raw.decimals,source:'Ethereum · frühere Version',permissionless:false,runtimeCodeHash:raw.runtimeCodeHash,
      ...(secondary?(raw.amount>0n?{additionalAssets:[secondary]}:secondary):{})});
    if(!claims.has(c.id))claims.set(c.id,c);
    else need(json(claims.get(c.id))===json(c),'Ein Claim wurde widersprüchlich ermittelt.');
  }
  const historicalHooks=deployments.legacy.flatMap(r=>[r.contracts.hook?.address,r.contracts.sharedHook?.address].filter(Boolean));
  const covered=new Set([...(native?.covered??[]),...discovered.map(l=>l.hook),...historicalHooks,
    '0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080'].map(a=>a.toLowerCase()));
  const unsupported=(!foundation&&discovered.length===0?[]:(chainId===1?(legacy?.unsupported??[]):(native?.unsupported??[]))).filter(x=>!covered.has((x.hook??x).toLowerCase()));
  // Unknown custom adapters stay visible; a scan failure must never masquerade as zero fees.
  const latest=await checkpoint(pair,chainId);
  const canonical=await pair[0].getBlock({blockNumber:block.number});need(same(canonical.hash,block.hash),'Scan-Block hat sich geändert.');
  progress('Auszahlungen werden geprüft…');
  const execution=await executableClaims(pair,[...claims.values()],latest.number);
  return {chainId,scannedAt:Date.now(),blockNumber:latest.number.toString(),head:latest.number.toString(),claims:execution.available,blockedClaims:execution.blocked,
    complete:issues.length===0&&unsupported.length===0&&execution.blocked.length===0,issues,unsupported:unsupported.map(x=>typeof x==='string'?x:x.hook),
    launchCount:(foundation?.launchCount??0)+(legacy?.launchCount??0),sourceCount:execution.available.length};
}

export function cleanError(e) {
  const message=String(e?.shortMessage??e?.message??'Scan fehlgeschlagen.');
  return message.replace(/https?:\/\/[^\s"')]+/g,'[RPC]').slice(0,240);
}
