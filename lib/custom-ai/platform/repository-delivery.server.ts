import "server-only";
import {createHash,randomUUID} from "node:crypto";
import type {AIPool} from "../store.server";
import type {createPlatformStore} from "./project-store.server";
import type {RepositoryClient} from "./repository-import.server";
import {repositoryName} from "./repository-import.server";
import {projectTransaction} from "./transaction.server";
import {projectDate} from "./time";
import {projectHash} from "./document";
import {exportProjectBundle} from "./transfer";
import {projectFileBytes} from "./files";
import {ProjectError,type ProjectScope} from "./types";
type Row=Record<string,unknown>;
export type RepositoryDeliveryInput={repository:string;revisionId:string;idempotencyKey:string;connectionId:string;connectionVersion:string;baseRef?:string;pullRequest?:boolean};
const sha=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const object=(value:unknown):value is Row=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const failed=()=>new ProjectError("repository-delivery","The repository result does not match this project export.",409);
const view=(row:Row)=>({id:String(row.id),revisionId:String(row.revision_id),repository:String(row.repository),branch:String(row.branch),state:String(row.state),url:row.url?String(row.url):null,errorCode:row.error_code?String(row.error_code):null});
export function createRepositoryDelivery(pool:AIPool,projects:ReturnType<typeof createPlatformStore>,clientFor:(scope:ProjectScope,input:RepositoryDeliveryInput,signal?:AbortSignal)=>Promise<RepositoryClient>,now=Date.now){
 async function deliver(scope:ProjectScope,input:RepositoryDeliveryInput,signal?:AbortSignal){
  repositoryName(input.repository);
  if(typeof input.idempotencyKey!=="string"||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey)||!/^sha256:[a-f0-9]{64}$/.test(input.revisionId)||typeof input.connectionId!=="string"||!input.connectionId||typeof input.connectionVersion!=="string"||!input.connectionVersion||input.pullRequest!==undefined&&typeof input.pullRequest!=="boolean"||input.baseRef!==undefined&&(typeof input.baseRef!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(input.baseRef)))throw new ProjectError("repository-input","Choose a project revision and an authorized GitHub destination.");
  const requestHash=projectHash({...input,pullRequest:input.pullRequest!==false,baseRef:input.baseRef??null}),lease=randomUUID();
  let row=await projectTransaction(pool,scope,async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`github-delivery:${scope.ownerId}`]);
   const previous=(await db.query("SELECT * FROM programmable_projects_v1.repository_deliveries WHERE owner=$1 AND project_id=$2 AND request_key=$3 FOR UPDATE",[scope.ownerId,scope.projectId,input.idempotencyKey])).rows[0];
   if(previous){
    if(previous.request_hash!==requestHash)throw new ProjectError("repository-idempotency","This export identifier has different contents.",409);
    if(previous.state==="complete")return previous;
    if(previous.lease_until&&projectDate(previous.lease_until).getTime()>now())throw new ProjectError("repository-busy","This export is still running.",409);
    if(Number(previous.attempts)>=5)throw new ProjectError("repository-reconcile","Review the saved branch before starting another export.",409);
    return (await db.query("UPDATE programmable_projects_v1.repository_deliveries SET lease_token=$4,lease_until=$5,attempts=attempts+1,state='running' WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *",[scope.ownerId,scope.projectId,previous.id,lease,new Date(now()+600000).toISOString()])).rows[0];
   }
   const used=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.repository_deliveries WHERE owner=$1 AND created_at>$2",[scope.ownerId,new Date(now()-86400000).toISOString()])).rows[0];if(Number(used.count)>=20)throw new ProjectError("repository-quota","Today's repository export allowance is used up.",429);
   const id=randomUUID(),branch=`programmable/${scope.projectId.slice(0,8)}-${id.slice(0,8)}-${input.revisionId.slice(7,15)}`;
   return (await db.query("INSERT INTO programmable_projects_v1.repository_deliveries(owner,project_id,id,request_key,request_hash,revision_id,repository,branch,state,created_at,lease_token,lease_until,attempts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,$10,$11,1) RETURNING *",[scope.ownerId,scope.projectId,id,input.idempotencyKey,requestHash,input.revisionId,input.repository,branch,new Date(now()).toISOString(),lease,new Date(now()+600000).toISOString()])).rows[0];
  });
  if(row.state==="complete")return view(row);
  async function save(values:Row){
   const columns:Record<string,string>={baseRef:"base_ref",baseSha:"base_sha",treeSha:"tree_sha",commitSha:"commit_sha",state:"state",url:"url",errorCode:"error_code"},entries=Object.entries(values);
   const saved=await projectTransaction(pool,scope,async db=>(await db.query(`UPDATE programmable_projects_v1.repository_deliveries SET ${entries.map(([key],i)=>`${columns[key]}=$${i+5}`).join(",")} WHERE owner=$1 AND project_id=$2 AND id=$3 AND lease_token=$4 AND lease_until>$${entries.length+5} RETURNING *`,[scope.ownerId,scope.projectId,row.id,lease,...entries.map(([,value])=>value),new Date(now()).toISOString()])).rows[0]);
   if(!saved)throw new ProjectError("repository-lease","Another worker owns this export.",409);row=saved;
  }
  try{
   const revision=await projects.readRevision(scope,input.revisionId),bundle=exportProjectBundle(revision),files=Object.entries(bundle.document.files);
   if(!files.length||files.length>128)throw new ProjectError("repository-size","Deliver up to 128 files through GitHub or download the complete JSON export.",413);
   const client=await clientFor(scope,input,signal);if(!client.post)throw new ProjectError("github-connection","A write-capable GitHub connection is required.",403);
   const root=`/repos/${input.repository}`;
   if(!row.base_sha){
    const info=await client.get(root),baseRef=input.baseRef??(object(info)?info.default_branch:null);
    if(typeof baseRef!=="string"||!baseRef||baseRef.length>200)throw failed();
    const base=await client.get(`${root}/commits/${encodeURIComponent(baseRef)}`);if(!object(base)||!sha(base.sha))throw failed();
    await save({baseRef,baseSha:base.sha});
   }
   const provenance=(revision.document.architecture as {importProvenance?:{fileModes?:Record<string,string>}}|null)?.importProvenance;
   const tree=files.map(([path,file])=>{const bytes=projectFileBytes(file);return {path,mode:provenance?.fileModes?.[path]==="100755"?"100755":"100644",type:"blob",sha:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),bytes};});
   if(!row.tree_sha){
    for(const item of tree){
     // Git blobs are content addressed; repeating this object creation cannot move a ref.
     const created=await client.post(`${root}/git/blobs`,{encoding:"base64",content:item.bytes.toString("base64")},`${row.id}:blob:${item.sha}:${row.attempts}`);
     if(!object(created)||created.sha!==item.sha)throw failed();
    }
    const created=await client.post(`${root}/git/trees`,{tree:tree.map(({path,mode,type,sha})=>({path,mode,type,sha}))},`${row.id}:tree:${row.attempts}`);
    if(!object(created)||!sha(created.sha))throw failed();
    const remote=await client.get(`${root}/git/trees/${created.sha}?recursive=1`);
    if(!object(remote)||remote.sha!==created.sha||remote.truncated!==false||!Array.isArray(remote.tree))throw failed();
    const blobs=remote.tree.filter(item=>object(item)&&item.type==="blob") as Row[];
    if(blobs.length!==tree.length||tree.some(item=>!blobs.some(remote=>remote.path===item.path&&remote.sha===item.sha&&remote.mode===item.mode)))throw failed();
    await save({treeSha:created.sha});
   }
   if(!row.commit_sha){
    const identity={name:"Programmable",email:"noreply@programmable.market",date:projectDate(row.created_at).toISOString()};
    const created=await client.post(`${root}/git/commits`,{message:`Export ${revision.document.title}\n\nProject revision: ${revision.revisionId}\nDelivery: ${row.id}`,tree:row.tree_sha,parents:[row.base_sha],author:identity,committer:identity},`${row.id}:commit:${row.attempts}`);
    if(!object(created)||!sha(created.sha))throw failed();await save({commitSha:created.sha});
   }
   const branch=String(row.branch),ref=`refs/heads/${branch}`,refPath=`${root}/git/ref/heads/${encodeURIComponent(branch)}`;
   let existing=await client.get(refPath);
   if(!existing){await client.post(`${root}/git/refs`,{ref,sha:row.commit_sha},`${row.id}:branch`);existing=await client.get(refPath);}
   if(!object(existing)||existing.ref!==ref||!object(existing.object)||existing.object.sha!==row.commit_sha)throw new ProjectError("repository-branch","The saved branch changed. Review it before continuing.",409);
   if(input.pullRequest===false){await save({state:"complete",url:`https://github.com/${input.repository}/tree/${encodeURIComponent(branch)}`});return view(row);}
   const pullPath=`${root}/pulls?head=${encodeURIComponent(`${input.repository.split("/")[0]}:${branch}`)}&state=all`;
   const listed=await client.get(pullPath);if(!Array.isArray(listed))throw failed();
   let pull=listed.find(value=>object(value)&&object(value.head)&&value.head.ref===branch&&object(value.base)&&value.base.ref===row.base_ref);
   if(!pull)pull=await client.post(`${root}/pulls`,{title:`Export ${revision.document.title}`.slice(0,240),head:branch,base:row.base_ref,draft:true,body:`Project revision: ${revision.revisionId}\n\nThis draft contains the complete exported source snapshot. Review its changes and checks before merging. No branch was force-updated.`},`${row.id}:pull`);
   if(!object(pull)||!object(pull.head)||pull.head.sha!==row.commit_sha||!object(pull.base)||pull.base.ref!==row.base_ref||typeof pull.number!=="number"||pull.html_url!==`https://github.com/${input.repository}/pull/${pull.number}`)throw failed();
   await save({state:"complete",url:pull.html_url,errorCode:null});
  }catch(error){
   if(error instanceof ProjectError&&error.code==="repository-lease")throw error;
   await save({state:"reconcile",errorCode:error instanceof ProjectError?error.code:"repository-network"});
  }finally{
   await projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.repository_deliveries SET lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND id=$3 AND lease_token=$4",[scope.ownerId,scope.projectId,row.id,lease]));
  }
  return view(row);
 }
 const list=(scope:ProjectScope)=>projectTransaction(pool,scope,async db=>(await db.query("SELECT * FROM programmable_projects_v1.repository_deliveries WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 50",[scope.ownerId,scope.projectId])).rows.map(view));
 return {deliver,list};
}
