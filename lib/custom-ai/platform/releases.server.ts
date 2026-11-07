import "server-only";
import {randomUUID} from "node:crypto";
import type {AIPool} from "../store.server";
import type {createPlatformStore} from "./project-store.server";
import type {createRuntimeDataStore} from "./runtime-data.server";
import {projectTransaction} from "./transaction.server";
import {projectHash} from "./document";
import {assertExportableFiles,assertExportableMetadata,projectFilePath} from "./files";
import {ProjectError,type ProjectScope,type ProjectFile,type ProjectRevision,type JsonValue} from "./types";

export type AppPlan={framework:"static"|"node"|"vite"|"nextjs";dataVersion:number;outputDirectory?:string;buildCommand?:string};
export type AppPackage={files:Record<string,ProjectFile>;artifactHash:string;artifactId?:string};
export type HostingProvider={
 ensureProject(name:string):Promise<{id:string;name:string}>;
 deploy(input:{projectId:string;projectName:string;releaseId:string;revisionId:string;artifactHash:string;plan:AppPlan;files:Record<string,ProjectFile>;env:Record<string,string>}):Promise<{id:string;url:string}>;
 inspect(id:string):Promise<{state:string;url:string}>;
 probe(url:string,revisionId:string):Promise<boolean>;
 promote(projectId:string,deploymentId:string):Promise<void>;
 pause(projectId:string):Promise<void>;
 resume(projectId:string):Promise<void>;
 findDeployment(projectId:string,releaseId:string):Promise<{id:string;url:string}|null>;
};
type Row=Record<string,unknown>;
export function applicationPlan(revision:ProjectRevision):AppPlan{
 const architecture=revision.document.architecture;
 if(!architecture||typeof architecture!=="object"||Array.isArray(architecture)||!architecture.application||typeof architecture.application!=="object"||Array.isArray(architecture.application))throw new ProjectError("release-plan","Save an application hosting plan before publishing.",409);
 const plan=architecture.application as unknown as AppPlan;
 if(!["static","node","vite","nextjs"].includes(plan.framework)||!Number.isSafeInteger(plan.dataVersion)||plan.dataVersion<1||plan.dataVersion>1000||plan.buildCommand!==undefined&&(typeof plan.buildCommand!=="string"||plan.buildCommand.length>256))throw new ProjectError("release-plan","Use a supported application runtime and data version.",409);
 if(plan.outputDirectory)projectFilePath(plan.outputDirectory);
 return {...plan};
}
function releaseFiles(revision:ProjectRevision,plan:AppPlan){
 assertExportableFiles(revision.document.files);assertExportableMetadata(revision.document.architecture);
 const files=Object.fromEntries(Object.entries(revision.document.files).filter(([path])=>path!=="vercel.json"&&!path.startsWith(".vercel/")));
 const body=`({ok:true,revisionId:${JSON.stringify(revision.revisionId)}})`;
 const path=plan.framework==="nextjs"?"app/api/_programmable/route.js":"api/_programmable.js";
 if(Object.hasOwn(files,path))throw new ProjectError("release-reserved","The _programmable health endpoint is reserved for the hosting service.",409);
 files[path]=plan.framework==="nextjs"?`export function GET(){return Response.json${body};}`:`export default function handler(req,res){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify${body});}`;
 if(plan.framework==="static"&&!files["public/index.html"]&&files["index.html"])files["public/index.html"]=files["index.html"];
 const config={version:2,framework:plan.framework==="vite"||plan.framework==="nextjs"?plan.framework:null,
   ...(plan.framework!=="nextjs"?{outputDirectory:plan.outputDirectory??(plan.framework==="vite"?"dist":"public"),functions:{"api/**/*.js":{maxDuration:30}}}:{}),
   ...(plan.buildCommand?{buildCommand:plan.buildCommand}:{})};
 files["vercel.json"]=JSON.stringify(config);
 return files;
}
const view=(row:Row)=>({id:String(row.id),revisionId:String(row.revision_id),artifactHash:String(row.artifact_hash),mode:String(row.mode),state:String(row.state),dataVersion:Number(row.data_version),url:typeof row.url==="string"?row.url:null,evidence:row.evidence as JsonValue,observedAt:row.observed_at?String(row.observed_at):null,errorCode:row.error_code?String(row.error_code):null});
type ReleaseInput={revisionId:string;idempotencyKey:string;mode:"preview"|"production"};
type ReleaseTicket=ProjectScope&{id:string;lease:string};
export function createProjectReleases(pool:AIPool,dependencies:{projects:ReturnType<typeof createPlatformStore>;data:ReturnType<typeof createRuntimeDataStore>;provider:HostingProvider;assess(ref:ProjectScope&{revisionId:string}):Promise<{verified:boolean;evidence:{id:string}[]}>;pack(revision:ProjectRevision,plan:AppPlan):Promise<AppPackage>;loadPackage?(scope:ProjectScope,id:string):Promise<AppPackage>;platformOrigin:string},now=Date.now){
 const {projects,data,provider}=dependencies;
 const providerName=(scope:ProjectScope)=>`programmable-${projectHash({ownerId:scope.ownerId,projectId:scope.projectId}).slice(7,31)}`;
 async function read(scope:ProjectScope,id:string){return projectTransaction(pool,scope,async db=>{const row=(await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id])).rows[0];if(!row)throw new ProjectError("release-missing","This app release was not found.",404);return row;});}
 async function queue(scope:ProjectScope,input:ReleaseInput){
  if(!["preview","production"].includes(input.mode)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))throw new ProjectError("release-input","Choose a valid release request.");
  const requestHash=projectHash(input);
  const previous=await projectTransaction(pool,scope,async db=>(await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 AND request_key=$3",[scope.ownerId,scope.projectId,input.idempotencyKey])).rows[0]);
  if(previous){if(previous.request_hash!==requestHash)throw new ProjectError("release-idempotency","This release request has different contents.",409);return view(previous);}
  const revision=await projects.readProject(scope);if(revision.revisionId!==input.revisionId)throw new ProjectError("release-stale","Publish the currently reviewed project revision.",409);
  const assessment=await dependencies.assess({...scope,revisionId:input.revisionId});if(!assessment.verified)throw new ProjectError("release-unverified","All project requirements need passing checks before publication.",409);
  const plan=applicationPlan(revision);releaseFiles(revision,plan);
  const row=await projectTransaction(pool,scope,async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["project-hosting-quota-v1"]);
    const prior=(await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 AND request_key=$3",[scope.ownerId,scope.projectId,input.idempotencyKey])).rows[0];
    if(prior){if(prior.request_hash!==requestHash)throw new ProjectError("release-idempotency","This release request has different contents.",409);return prior;}
    const current=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];
    if(current?.current_revision!==input.revisionId)throw new ProjectError("release-stale","The project changed before publication was queued.",409);
    const slot=(await db.query("SELECT provider_name FROM programmable_projects_v1.hosting_slots WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];
    if(!slot){const count=(await db.query("SELECT count(*) AS total,count(*) FILTER(WHERE owner=$1) AS owned FROM programmable_projects_v1.hosting_slots",[scope.ownerId])).rows[0];if(Number(count.owned)>=2||Number(count.total)>=16)throw new ProjectError("release-quota","The current hosted-project allowance is full.",429);await db.query("INSERT INTO programmable_projects_v1.hosting_slots(owner,project_id,provider_name) VALUES($1,$2,$3)",[scope.ownerId,scope.projectId,providerName(scope)]);}
    const limits=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.app_releases WHERE owner=$1 AND created_at>$2",[scope.ownerId,new Date(now()-86400000).toISOString()])).rows[0];if(Number(limits.count)>=20)throw new ProjectError("release-quota","Today's release allowance is used up.",429);
    const id=randomUUID();const saved=(await db.query("INSERT INTO programmable_projects_v1.app_releases(owner,project_id,id,revision_id,request_key,request_hash,artifact_hash,mode,state,data_version,evidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10::jsonb,$11) RETURNING *",[scope.ownerId,scope.projectId,id,input.revisionId,input.idempotencyKey,requestHash,"pending",input.mode,plan.dataVersion,JSON.stringify(assessment.evidence.map(item=>item.id)),new Date(now()).toISOString()])).rows[0];
    await db.query("INSERT INTO programmable_projects_v1.release_queue(owner,project_id,release_id,next_at) VALUES($1,$2,$3,$4)",[scope.ownerId,scope.projectId,id,new Date(now()).toISOString()]);return saved;
  });return view(row);
 }
 async function take(selected?:ProjectScope&{id:string}):Promise<ReleaseTicket|null>{
  const db=await pool.connect(),lease=randomUUID();try{
   const where=selected?"AND owner=$4 AND project_id=$5 AND release_id=$6":"";
   const row=(await db.query(`WITH due AS (SELECT owner,project_id,release_id FROM programmable_projects_v1.release_queue WHERE next_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ${where} ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE programmable_projects_v1.release_queue q SET lease_token=$2,lease_until=$3,attempts=q.attempts+1 FROM due WHERE q.owner=due.owner AND q.project_id=due.project_id AND q.release_id=due.release_id RETURNING q.owner,q.project_id,q.release_id`,[new Date(now()).toISOString(),lease,new Date(now()+360000).toISOString(),...(selected?[selected.ownerId,selected.projectId,selected.id]:[])])).rows[0];
   return row?{ownerId:String(row.owner),projectId:String(row.project_id),id:String(row.release_id),lease}:null;
  }finally{db.release();}
 }
 async function save(ticket:ReleaseTicket,fields:{stage?:string;state?:string;artifactHash?:string;artifactId?:string;providerId?:string;deploymentId?:string;url?:string;errorCode?:string}){
  await projectTransaction(pool,ticket,async db=>{
   const claimed=(await db.query("SELECT release_id FROM programmable_projects_v1.release_queue WHERE owner=$1 AND project_id=$2 AND release_id=$3 AND lease_token=$4 AND lease_until>$5 FOR UPDATE",[ticket.ownerId,ticket.projectId,ticket.id,ticket.lease,new Date(now()).toISOString()])).rows[0];
   if(!claimed)throw new ProjectError("release-lease","Another worker owns this release.",409);
   const columns:Record<string,string>={stage:"stage",state:"state",artifactHash:"artifact_hash",artifactId:"artifact_id",providerId:"provider_id",deploymentId:"deployment_id",url:"url",errorCode:"error_code"};
   const entries=Object.entries(fields);await db.query(`UPDATE programmable_projects_v1.app_releases SET ${entries.map(([key],i)=>`${columns[key]}=$${i+4}`).join(",")} WHERE owner=$1 AND project_id=$2 AND id=$3`,[ticket.ownerId,ticket.projectId,ticket.id,...entries.map(([,value])=>value)]);
  });
 }
 async function process(ticket:ReleaseTicket){
  let row=await read(ticket,ticket.id),packed:AppPackage|undefined;
  try{
   if(["ready","failed","published","stopped"].includes(String(row.state)))return;
   if(now()-new Date(String(row.created_at)).getTime()>1800000){await save(ticket,{state:"failed",errorCode:"release-expired"});return;}
   const revision=await projects.readRevision(ticket,String(row.revision_id)),plan=applicationPlan(revision);
   if(row.stage==="pack"){
    packed=await dependencies.pack(revision,plan);
    await save(ticket,{stage:"project",artifactHash:packed.artifactHash,...(packed.artifactId?{artifactId:packed.artifactId}:{})});row=await read(ticket,ticket.id);
   }
   if(row.stage==="project"){
    const host=await provider.ensureProject(providerName(ticket));
    await projectTransaction(pool,ticket,db=>db.query("INSERT INTO programmable_projects_v1.app_hosts(owner,project_id,provider_id,provider_name) VALUES($1,$2,$3,$4) ON CONFLICT(owner,project_id) DO UPDATE SET provider_id=$3,provider_name=$4",[ticket.ownerId,ticket.projectId,host.id,host.name]));
    await save(ticket,{stage:"deploy",providerId:host.id});row=await read(ticket,ticket.id);
   }
   if(row.stage==="deploy"){
    if(!packed&&row.artifact_id&&dependencies.loadPackage)packed=await dependencies.loadPackage(ticket,String(row.artifact_id));
    if(!packed||packed.artifactHash!==row.artifact_hash)throw new ProjectError("release-artifact","The saved deployment package is unavailable.",409);
    const key=await data.mintAppKey(ticket,ticket.id,plan.dataVersion,"preview");
    await save(ticket,{stage:"submitting",state:"reconcile"});
    const deployment=await provider.deploy({projectId:String(row.provider_id),projectName:providerName(ticket),releaseId:ticket.id,revisionId:String(row.revision_id),artifactHash:packed.artifactHash,plan,files:packed.files,
     env:{PROGRAMMABLE_APP_TOKEN:key.token,PROGRAMMABLE_DATA_URL:new URL("/api/custom-ai/platform/runtime/data",dependencies.platformOrigin).href,PROGRAMMABLE_CONNECTOR_URL:new URL("/api/custom-ai/platform/runtime/connector",dependencies.platformOrigin).href,PROGRAMMABLE_PROJECT_REVISION:String(row.revision_id)}});
    await save(ticket,{stage:"observe",state:"building",deploymentId:deployment.id,url:deployment.url});
   }else if(row.stage==="submitting"){
    const found=await provider.findDeployment(String(row.provider_id),ticket.id);
    if(found)await save(ticket,{stage:"observe",state:"building",deploymentId:found.id,url:found.url});
   }
  }catch(error){
   const latest=await read(ticket,ticket.id);
   if(error instanceof ProjectError&&error.code==="release-lease")return;
   // Only the submission window is ambiguous. A rejected local package has no remote deployment.
   await save(ticket,latest.stage==="submitting"?{state:"reconcile",errorCode:"release-submit-unknown"}:{state:"failed",errorCode:error instanceof ProjectError?error.code:"release-provider"}).catch(()=>undefined);
  }finally{
   const latest=await read(ticket,ticket.id),db=await pool.connect();try{
    if(["failed","ready","published","stopped"].includes(String(latest.state)))await db.query("DELETE FROM programmable_projects_v1.release_queue WHERE owner=$1 AND project_id=$2 AND release_id=$3 AND lease_token=$4",[ticket.ownerId,ticket.projectId,ticket.id,ticket.lease]);
    else await db.query("UPDATE programmable_projects_v1.release_queue SET next_at=$5,lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND release_id=$3 AND lease_token=$4",[ticket.ownerId,ticket.projectId,ticket.id,ticket.lease,new Date(now()+30000).toISOString()]);
   }finally{db.release();}
  }
 }
 async function publish(scope:ProjectScope,input:ReleaseInput){const release=await queue(scope,input);const ticket=await take({...scope,id:release.id});if(ticket)await process(ticket);return view(await read(scope,release.id));}
 async function refresh(scope:ProjectScope,id:string){
  let row=await read(scope,id);
  if(["failed","stopped","published"].includes(String(row.state)))return view(row);
  if(!row.deployment_id&&row.provider_id&&row.stage==="submitting"){
   const found=await provider.findDeployment(String(row.provider_id),id);if(found){await projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.app_releases SET deployment_id=$4,url=$5,state='building',stage='observe' WHERE owner=$1 AND project_id=$2 AND id=$3 AND stage='submitting'",[scope.ownerId,scope.projectId,id,found.id,found.url]));row=await read(scope,id);}
  }
  if(!row.deployment_id)return view(row);
  const remote=await provider.inspect(String(row.deployment_id));
  if(["ERROR","CANCELED"].includes(remote.state))await projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.app_releases SET state='failed',error_code='release-build' WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id]));
  if(remote.state==="READY"&&await provider.probe(remote.url,String(row.revision_id)))await projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.app_releases SET state='ready',url=$4,observed_at=$5 WHERE owner=$1 AND project_id=$2 AND id=$3 AND state IN ('building','reconcile','ready')",[scope.ownerId,scope.projectId,id,remote.url,new Date(now()).toISOString()]));
  const result=await read(scope,id);if(["ready","failed"].includes(String(result.state)))await projectTransaction(pool,scope,db=>db.query("DELETE FROM programmable_projects_v1.release_queue WHERE owner=$1 AND project_id=$2 AND release_id=$3",[scope.ownerId,scope.projectId,id]));return view(result);
 }
 async function processPending(limit=1){
  if(!Number.isInteger(limit)||limit<1||limit>2)throw new TypeError("Invalid release batch");let attempted=0;
  for(let n=0;n<limit;n++){const ticket=await take();if(!ticket)break;await process(ticket);await refresh(ticket,ticket.id);attempted++;}return {attempted};
 }
 async function promote(scope:ProjectScope,id:string,rollback=false){
  const row=await read(scope,id);if(!["ready","published","stopped"].includes(String(row.state))||!row.observed_at)throw new ProjectError("release-unobserved","Verify the deployed preview before publication.",409);
  if(!rollback&&(await projects.readProject(scope)).revisionId!==row.revision_id)throw new ProjectError("release-stale","The workspace changed after this release was tested.",409);
  if(await data.dataVersion(scope)!==Number(row.data_version))throw new ProjectError("release-data-version","This release is incompatible with the current data contract.",409);
  await provider.promote(String(row.provider_id),String(row.deployment_id));
  if(row.state==="stopped")await provider.resume(String(row.provider_id));
  await data.activateRelease(scope,id);await data.setActive(scope,true);
  await projectTransaction(pool,scope,async db=>{await db.query("UPDATE programmable_projects_v1.app_releases SET state='published',mode='production' WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id]);await db.query("UPDATE programmable_projects_v1.app_hosts SET active_release=$3 WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId,id]);});
  return view(await read(scope,id));
 }
 async function setActive(scope:ProjectScope,id:string,active:boolean){
  const row=await read(scope,id);if(!row.provider_id)throw new ProjectError("release-missing","No app service exists for this release.",409);
  const host=await projectTransaction(pool,scope,async db=>(await db.query("SELECT active_release FROM programmable_projects_v1.app_hosts WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0]);
  if(!["published","stopped"].includes(String(row.state))||!row.observed_at||host?.active_release!==id)throw new ProjectError("release-state","Only the active, checked application can be stopped or resumed.",409);
  if(active){await provider.resume(String(row.provider_id));await data.setActive(scope,true);}else{await data.setActive(scope,false);await provider.pause(String(row.provider_id));}
  await projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.app_releases SET state=$4 WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id,active?"published":"stopped"]));
  return view(await read(scope,id));
 }
 const list=(scope:ProjectScope)=>projectTransaction(pool,scope,async db=>(await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 40",[scope.ownerId,scope.projectId])).rows.map(view));
 const receipt=(scope:ProjectScope,key:string)=>projectTransaction(pool,scope,async db=>{const row=(await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 AND request_key=$3",[scope.ownerId,scope.projectId,key])).rows[0];if(!row)throw new ProjectError("release-reconcile","No committed release receipt exists for this action.",409);return view(row);});
 return {queue,publish,refresh,promote,setActive,processPending,list,receipt,read:async(scope:ProjectScope,id:string)=>view(await read(scope,id))};
}
