import { rpcClients } from '../server/rpc.mjs';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_estimateGas','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBalance','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount']);
const limits=new Map();
export function publicRpcError(error,method){
  let current=error,gasLimit=false,data,code=-32000;
  for(let i=0;current&&i<8;i++,current=current.cause){
    if(Number.isInteger(current.code))code=current.code;
    if(typeof current.data==='string'&&/^0x[0-9a-f]{0,4096}$/i.test(current.data))data=current.data;
    if(/out of gas|Multicall3: call failed|gas required exceeds allowance|exceeds.*gas limit|gas.*cap|intrinsic gas too low/i.test(String(current.shortMessage??current.message??'')))gasLimit=true;
  }
  // Preserve only a safe capacity signal so the browser can split a batch.
  // Provider URLs, credentials and raw error bodies never cross this boundary.
  return {code,message:method==='eth_estimateGas'&&gasLimit?'Simulation gas cap exceeded.':'Netzwerkanfrage fehlgeschlagen.',...(data?{data}:{})};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).end();
  const origin=req.headers.origin;
  if(origin&&new URL(origin).host!==req.headers.host)return res.status(403).end();
  try{
    const url=new URL(req.url,'https://hazarrobin.vercel.app');const chainId=Number(url.searchParams.get('chainId'));
    const index=url.searchParams.get('provider')==='secondary'?1:0;
    const client=rpcClients(chainId)[index];
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const inputs=Array.isArray(body)?body:[body];
    if(inputs.length<1||inputs.length>64||JSON.stringify(body).length>128000)throw Error();
    const ip=String(req.headers['x-forwarded-for']??'local').split(',')[0];const now=Date.now();let limit=limits.get(ip);
    if(!limit||limit.until<now){limit={until:now+60000,count:0};if(limits.size>1024)limits.clear();limits.set(ip,limit);}
    limit.count+=inputs.length;if(limit.count>180)return res.status(429).json({error:'Bitte kurz warten und erneut versuchen.'});
    const replies=await Promise.all(inputs.map(async input=>{
      if(!allowed.has(input?.method)||!Array.isArray(input.params??[])||input.jsonrpc!=='2.0')return {jsonrpc:'2.0',id:input?.id??null,error:{code:-32600,message:'Nur Lesezugriffe sind erlaubt.'}};
      if(['eth_call','eth_estimateGas'].includes(input.method)){
        const call=input.params[0];if(!call||call.value&&BigInt(call.value)!==0n||call.gas&&BigInt(call.gas)>16000000n)return {jsonrpc:'2.0',id:input.id,error:{code:-32602,message:'Dieser Aufruf ist nicht erlaubt.'}};
      }
      try{return {jsonrpc:'2.0',id:input.id,result:await client.request({method:input.method,params:input.params??[]})};}
      catch(error){return {jsonrpc:'2.0',id:input.id,error:publicRpcError(error,input.method)};}
    }));
    return res.status(200).json(Array.isArray(body)?replies:replies[0]);
  }catch{return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Ungültige Leseanfrage.'}});}
}
