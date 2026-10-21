import { scanEcosystem, cleanError } from '../server/scanner.mjs';
import { json } from '../server/rpc.mjs';
export const config={maxDuration:300};
const jobs=new Map();
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).end();
  const params=new URL(req.url,'https://hazarrobin.vercel.app').searchParams;
  const chainId=Number(params.get('chainId'));
  const rawMinimum=params.get('minimumBlock')??'0';if(!/^\d{1,12}$/.test(rawMinimum))return res.status(400).end();const minimumBlock=BigInt(rawMinimum);
  if(chainId!==1&&chainId!==4663)return res.status(400).json({error:'Ungültige Chain.'});
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=value=>{if(!res.destroyed&&!res.writableEnded)res.write(json(value)+'\n');};
  send({type:'progress',message:'Gebühren werden auf der Chain geprüft…'});
  try {
    for(;;){
      let job=jobs.get(chainId);
      if(!job||(job.result&&(job.expires<Date.now()||BigInt(job.result.blockNumber)<minimumBlock))){
        const listeners=new Set();job={expires:Infinity,listeners,promise:null,result:null};jobs.set(chainId,job);
        const ownJob=job;
        job.promise=scanEcosystem(chainId,message=>{for(const fn of listeners)fn({type:'progress',message});},minimumBlock)
          .then(result=>{ownJob.expires=Date.now()+(result.issues.length?0:15000);ownJob.result=result;return result;})
          .catch(error=>{if(jobs.get(chainId)===ownJob)jobs.delete(chainId);throw error;});
      }
      job.listeners.add(send);
      let result;
      try{result=await job.promise;}finally{job.listeners.delete(send);}
      // A claim can confirm while an older scan is in flight. Wait for it to
      // finish, then refresh; never return its pre-claim balance or fork a job.
      if(BigInt(result.blockNumber)<minimumBlock){if(jobs.get(chainId)===job)jobs.delete(chainId);continue;}
      send({type:'result',result});break;
    }
  }catch(error){send({type:'error',message:cleanError(error)});}
  finally{res.end();}
}
