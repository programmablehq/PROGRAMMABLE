import "server-only";
import {randomUUID} from "node:crypto";
import type {AIPool} from "../store.server";
import type {createRuntimeDataStore} from "./runtime-data.server";
import type {ConnectorTransport} from "./private-http.server";
import {projectTransaction} from "./transaction.server";
import {canonicalProjectJSON,projectHash} from "./document";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";

export type AppJob={id:string;path:string;intervalSeconds:number;idempotent:boolean;body:JsonValue;enabled?:boolean};
type Ticket=ProjectScope&{jobId:string;lease:string};
const validPath=(path:string)=>/^\/api\/[A-Za-z0-9_/-]{1,160}$/.test(path)&&!path.includes("..")&&!path.includes("//")&&!path.startsWith("/api/_programmable");

/** The queue contains routing only. Payloads and run receipts remain owner-scoped. */
export function createAppJobs(pool:AIPool,data:ReturnType<typeof createRuntimeDataStore>,send:ConnectorTransport,now=Date.now){
 async function define(scope:ProjectScope,input:AppJob){
  if(!input||Object.keys(input).some(key=>!["id","path","intervalSeconds","idempotent","body","enabled"].includes(key))||!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)||!validPath(input.path)||!Number.isInteger(input.intervalSeconds)||input.intervalSeconds<60||input.intervalSeconds>604800||typeof input.idempotent!=="boolean"||input.enabled!==undefined&&typeof input.enabled!=="boolean"||Buffer.byteLength(canonicalProjectJSON(input.body))>16000)throw new ProjectError("job-input","Choose an API path and a schedule between one minute and one week.");
  return projectTransaction(pool,scope,async db=>{
   await db.query("SELECT id FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE",[scope.ownerId,scope.projectId]);
   const existing=(await db.query("SELECT definition_hash FROM programmable_projects_v1.app_jobs WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,input.id])).rows[0];
   const hash=projectHash(input);if(existing?.definition_hash===hash)return {id:input.id};
   const count=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.app_jobs WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];
   if(!existing&&Number(count.count)>=10)throw new ProjectError("job-quota","This project already has ten scheduled tasks.",429);
   // An in-flight old definition keeps its immutable receipt; it is never replayed as new code.
   await db.query("UPDATE programmable_projects_v1.app_job_runs SET state='reconcile' WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND state='pending'",[scope.ownerId,scope.projectId,input.id]);
   await db.query("INSERT INTO programmable_projects_v1.app_jobs(owner,project_id,id,path,interval_seconds,idempotent,body,enabled,definition_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(owner,project_id,id) DO UPDATE SET path=$4,interval_seconds=$5,idempotent=$6,body=$7::jsonb,enabled=$8,definition_hash=$9",[scope.ownerId,scope.projectId,input.id,input.path,input.intervalSeconds,input.idempotent,JSON.stringify(input.body),input.enabled!==false,hash]);
   await db.query("INSERT INTO programmable_projects_v1.app_job_queue(owner,project_id,job_id,next_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner,project_id,job_id) DO UPDATE SET next_at=$4,run_id=NULL,lease_token=NULL,lease_until=NULL",[scope.ownerId,scope.projectId,input.id,new Date(now()+input.intervalSeconds*1000).toISOString()]);
   return {id:input.id};
  });
 }
 async function take():Promise<Ticket|null>{
  const db=await pool.connect();const lease=randomUUID();
  try{
   const row=(await db.query("WITH due AS (SELECT owner,project_id,job_id FROM programmable_projects_v1.app_job_queue WHERE next_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE programmable_projects_v1.app_job_queue q SET lease_token=$2,lease_until=$3 FROM due WHERE q.owner=due.owner AND q.project_id=due.project_id AND q.job_id=due.job_id RETURNING q.owner,q.project_id,q.job_id",[new Date(now()).toISOString(),lease,new Date(now()+30000).toISOString()])).rows[0];
   return row?{ownerId:String(row.owner),projectId:String(row.project_id),jobId:String(row.job_id),lease}:null;
  }finally{db.release();}
 }
 async function dispatch(ticket:Ticket){
  const scope={ownerId:ticket.ownerId,projectId:ticket.projectId};
  const task=await projectTransaction(pool,scope,async db=>{
   const row=(await db.query("SELECT j.*,q.run_id,r.id AS release_id,r.url,r.data_version,r.state AS release_state FROM programmable_projects_v1.app_job_queue q JOIN programmable_projects_v1.app_jobs j ON j.owner=q.owner AND j.project_id=q.project_id AND j.id=q.job_id LEFT JOIN programmable_projects_v1.app_hosts h ON h.owner=q.owner AND h.project_id=q.project_id LEFT JOIN programmable_projects_v1.app_releases r ON r.owner=h.owner AND r.project_id=h.project_id AND r.id=h.active_release WHERE q.owner=$1 AND q.project_id=$2 AND q.job_id=$3 AND q.lease_token=$4 FOR UPDATE OF q",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease])).rows[0];
   if(!row)return null;
   const later=new Date(now()+Number(row.interval_seconds)*1000).toISOString();
   if(!row.enabled||row.release_state!=="published"){
    await db.query("UPDATE programmable_projects_v1.app_job_queue SET next_at=$5,lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND lease_token=$4",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease,later]);return null;
   }
   let run=row.run_id?(await db.query("SELECT * FROM programmable_projects_v1.app_job_runs WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,row.run_id])).rows[0]:undefined;
   if(run&&(run.release_id!==row.release_id||run.definition_hash!==row.definition_hash||run.state!=="pending"||Number(run.attempts)>=3||!row.idempotent&&Number(run.attempts)>0)){
    await db.query("UPDATE programmable_projects_v1.app_job_runs SET state=CASE WHEN state='completed' THEN state ELSE 'reconcile' END WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,run.id]);
    await db.query("UPDATE programmable_projects_v1.app_job_queue SET next_at=$5,run_id=NULL,lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND lease_token=$4",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease,later]);return null;
   }
   if(!run){
    // Retain a bounded history; only finished non-replayable job receipts may be pruned.
    await db.query("DELETE FROM programmable_projects_v1.app_job_runs WHERE owner=$1 AND project_id=$2 AND state<>'pending' AND created_at<$3",[scope.ownerId,scope.projectId,new Date(now()-7*86400000).toISOString()]);
    run=(await db.query("INSERT INTO programmable_projects_v1.app_job_runs(owner,project_id,id,job_id,release_id,definition_hash,state,attempts,created_at) VALUES($1,$2,$3,$4,$5,$6,'pending',0,$7) RETURNING *",[scope.ownerId,scope.projectId,randomUUID(),ticket.jobId,row.release_id,row.definition_hash,new Date(now()).toISOString()])).rows[0];
    await db.query("UPDATE programmable_projects_v1.app_job_queue SET run_id=$5 WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND lease_token=$4",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease,run.id]);
   }
   await db.query("UPDATE programmable_projects_v1.app_job_runs SET attempts=attempts+1 WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,run.id]);
   return {runId:String(run.id),releaseId:String(row.release_id),url:String(row.url),path:String(row.path),body:row.body as JsonValue,idempotent:Boolean(row.idempotent),dataVersion:Number(row.data_version),attempt:Number(run.attempts)+1,interval:Number(row.interval_seconds)};
  });
  if(!task)return false;
  let completed=false;
  try{
   const base=new URL(task.url);if(base.protocol!=="https:"||!base.hostname.endsWith(".vercel.app")||base.username||base.password||base.port||!validPath(task.path))throw new Error("Invalid hosted task target");
   const key=await data.mintAppKey(scope,task.releaseId,task.dataVersion);
   const response=await send({url:new URL(task.path,base.origin).href,method:"POST",headers:{Authorization:`Bearer ${key.token}`,"Content-Type":"application/json","Idempotency-Key":task.runId},body:JSON.stringify({jobId:ticket.jobId,runId:task.runId,input:task.body}),signal:AbortSignal.timeout(25000)});
   completed=response.status>=200&&response.status<300;
  }catch{/* An unknown result keeps its stable run identity; never invent success. */}
  await projectTransaction(pool,scope,async db=>{
   const active=(await db.query("SELECT run_id FROM programmable_projects_v1.app_job_queue WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND lease_token=$4 FOR UPDATE",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease])).rows[0];
   if(active?.run_id!==task.runId)return;
   const retry=!completed&&task.idempotent&&task.attempt<3;
   if(!completed&&!retry)await db.query("UPDATE programmable_projects_v1.app_jobs SET enabled=false WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,ticket.jobId]);
   await db.query("UPDATE programmable_projects_v1.app_job_runs SET state=$4,finished_at=$5 WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,task.runId,completed?"completed":retry?"pending":"reconcile",retry?null:new Date(now()).toISOString()]);
   await db.query("UPDATE programmable_projects_v1.app_job_queue SET run_id=$5,next_at=$6,lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND job_id=$3 AND lease_token=$4",[scope.ownerId,scope.projectId,ticket.jobId,ticket.lease,retry?task.runId:null,new Date(now()+(retry?30000:task.interval*1000)).toISOString()]);
  });
  return completed;
 }
 async function dispatchDue(limit=4){
  if(!Number.isInteger(limit)||limit<1||limit>8)throw new TypeError("Invalid scheduled task limit");
  let completed=0,attempted=0;
  for(let n=0;n<limit;n++){const ticket=await take();if(!ticket)break;if(await dispatch(ticket))completed++;attempted++;}
  return {attempted,completed};
 }
 const list=(scope:ProjectScope)=>projectTransaction(pool,scope,async db=>({
  jobs:(await db.query("SELECT id,path,interval_seconds AS \"intervalSeconds\",idempotent,enabled FROM programmable_projects_v1.app_jobs WHERE owner=$1 AND project_id=$2 ORDER BY id",[scope.ownerId,scope.projectId])).rows,
  runs:(await db.query("SELECT id,job_id AS \"jobId\",release_id AS \"releaseId\",state,attempts,created_at AS \"createdAt\",finished_at AS \"finishedAt\" FROM programmable_projects_v1.app_job_runs WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",[scope.ownerId,scope.projectId])).rows,
 }));
 return {define,dispatchDue,list};
}
