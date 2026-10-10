import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, multicall3Abi, keccak256 } from 'viem';

export const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const MULTICALL_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
export const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const need = (ok, message) => { if (!ok) throw new Error(message); };
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const clientsByChain = new Map();
const immutable = new Map();
const inflight = new Map();

// Limit provider pressure and reuse only immutable, explicitly numbered history.
export function paced(fetcher) {
  let active=0, next=0; const queue=[];
  return async (url, options) => {
    if(active>=6) await new Promise(resolve=>queue.push(resolve)); active++;
    // Providers meter JSON-RPC calls, not HTTP requests. A ten-call batch
    // otherwise consumes ten times the intended budget and exhausts 50/s plans.
    let weight=1;
    if(typeof options?.body==='string'){
      try{const payload=JSON.parse(options.body);if(Array.isArray(payload))weight=Math.max(1,payload.length);}catch{}
    }
    const now=Date.now(),start=Math.max(now,next);next=start+Math.max(75,weight*30);
    try { if(start>now)await new Promise(r=>setTimeout(r,start-now));return await fetcher(url, options); }
    finally { active--; queue.shift()?.(); }
  };
}
function cached(client, label) {
  const request=client.request.bind(client);
  client.request=async args=>{
    const p=args.params??[];
    const stable=args.method==='eth_getLogs' || (args.method==='eth_getCode' && /^0x[0-9a-f]+$/i.test(p[1]??''));
    if(!stable) return request(args);
    const key=json([label,args]);
    if(immutable.has(key)) return immutable.get(key);
    if(inflight.has(key)) return inflight.get(key);
    const pending=request(args).then(value=>{ if(immutable.size>4096) immutable.delete(immutable.keys().next().value); immutable.set(key,value); return value; }).finally(()=>inflight.delete(key));
    inflight.set(key,pending); return pending;
  };
  return client;
}
export function rpcClients(chainId) {
  need(chainId===1||chainId===4663, 'Unbekannte Chain.');
  if(clientsByChain.has(chainId)) return clientsByChain.get(chainId);
  const urls=chainId===1 ? [process.env.ETH_PRIMARY,process.env.ETH_SECONDARY??'https://mainnet.gateway.tenderly.co',process.env.ETH_TERTIARY??'https://rpc.mevblocker.io'] : [process.env.RH_PRIMARY,process.env.RH_SECONDARY];
  need(urls.every(u=>typeof u==='string'&&u.startsWith('https://')), 'Die Netzwerkverbindung ist noch nicht eingerichtet.');
  // The archive fallback can reject large batches with a single rate-limit
  // object. A conservative batch size preserves viem's response mapping.
  const clients=urls.map((url,i)=>cached(createPublicClient({ transport:http(url,{batch:{wait:5,batchSize:10},timeout:20000,retryCount:3,retryDelay:600,fetchFn:paced(fetch)}) }),`${chainId}:${i}`));
  clientsByChain.set(chainId,clients); return clients;
}
export async function pin(clients, binding, blockNumber) {
  const codes=await Promise.all(clients.map(c=>c.getCode({address:binding.address,blockNumber})));
  need(codes.every(code=>code&&code!=='0x'&&same(keccak256(code),binding.runtimeCodeHash)), `Vertragsprüfung fehlgeschlagen: ${binding.address}`);
  return codes[0];
}
export async function readBoth(clients, calls, blockNumber, allowFailure=false) {
  if(!calls.length) return [];
  const data=encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[calls.map(c=>({target:c.address,allowFailure,callData:encodeFunctionData(c)}))]});
  const result=await Promise.all(clients.map(c=>c.call({to:MULTICALL,data,blockNumber})));
  need(result[0].data&&result.every(r=>same(r.data,result[0].data)), 'Die Netzwerk-Anbieter melden unterschiedliche Gebühren.');
  return decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:result[0].data}).map((r,i)=>{
    if(!r.success&&allowFailure) return null;
    need(r.success,'Ein Gebührenkonto konnte nicht gelesen werden.');
    return decodeFunctionResult({...calls[i],data:r.returnData});
  });
}
export async function checkpoint(clients, chainId) {
  need((await Promise.all(clients.map(c=>c.getChainId()))).every(id=>id===chainId), 'Falsches Netzwerk.');
  const heads=await Promise.all(clients.map(c=>c.getBlockNumber({cacheTime:0})));
  const number=heads.reduce((a,b)=>a<b?a:b)-(chainId===1?2n:16n);
  const blocks=await Promise.all(clients.map(c=>c.getBlock({blockNumber:number})));
  need(blocks.every(b=>same(b.hash,blocks[0].hash))&&Math.abs(Date.now()/1000-Number(blocks[0].timestamp))<180,'Netzwerkdaten sind nicht aktuell.');
  return {number,hash:blocks[0].hash};
}
export async function mapLimit(items, limit, action) {
  const output=new Array(items.length); let index=0, failed=false, failure;
  await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{
    while(!failed&&index<items.length){
      const i=index++;
      try{output[i]=await action(items[i],i);}catch(error){if(!failed){failed=true;failure=error;}}
    }
  }));
  if(failed)throw failure;
  return output;
}

/** Retry only interrupted reads. Contract reverts and failed proofs stay errors. */
export async function recoverRpcRead(read, onRetry=()=>{}) {
  try{return await read();}catch(error){
    let current=error, transient=false;
    for(let i=0;current&&i<8;i++,current=current.cause){
      if(['ContractFunctionRevertedError','ExecutionRevertedError'].includes(current.name))throw error;
      const status=Number(current.status??current.statusCode);
      if([408,429,500,502,503,504].includes(status)||[-32005,-32007,-32016].includes(current.code)
        ||['HttpRequestError','TimeoutError','SocketClosedError'].includes(current.name)
        ||(current instanceof TypeError&&/fetch|network/i.test(current.message)))transient=true;
    }
    if(!transient)throw error;
    onRetry();
    await new Promise(resolve=>setTimeout(resolve,600));
    return read();
  }
}
export async function rangeLogs(client, filter, from, to, window=10000n) {
  const ranges=[];for(let first=from;first<=to;first+=window) ranges.push([first,first+window-1n<to?first+window-1n:to]);
  const groups=await mapLimit(ranges,4,async ([fromBlock,toBlock])=>{
    try {const logs=await client.getLogs({...filter,fromBlock,toBlock,strict:true}); if(logs.length>=1000)throw new Error('range');return logs;}
    catch(e){if(fromBlock>=toBlock||!/range|too many|more than|response size|limit exceeded/i.test(String(e.details??e.message)))throw e;const mid=(fromBlock+toBlock)/2n;return [...await rangeLogs(client,filter,fromBlock,mid,window),...await rangeLogs(client,filter,mid+1n,toBlock,window)];}
  });
  return groups.flat();
}

/** Batch pure getter reads, preserving sender-sensitive simulations as direct calls. */
export function legacyReader(client) {
  const queues=new Map();
  return (method,params=[])=>{
    if(method!=='eth_call'||params[0]?.from)return client.request({method,params});
    const block=params[1]??'latest';
    return new Promise((resolve,reject)=>{
      if(!queues.has(block)){
        const queue=[];queues.set(block,queue);
        setTimeout(async()=>{
          queues.delete(block);
          for(let i=0;i<queue.length;i+=64){
            const batch=queue.slice(i,i+64);
            try{
              const data=encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[batch.map(item=>({target:item.call.to,allowFailure:true,callData:item.call.data}))]});
              const result=await client.request({method:'eth_call',params:[{to:MULTICALL,data},block]});
              const values=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:result});
              values.forEach((v,index)=>v.success?batch[index].resolve(v.returnData):batch[index].reject(new Error('Vertragsabfrage fehlgeschlagen.')));
            }catch(error){batch.forEach(item=>item.reject(error));}
          }
        },5);
      }
      queues.get(block).push({call:params[0],resolve,reject});
    });
  };
}
