import "server-only";
import {createHash,randomBytes} from "node:crypto";
import type {AIPool} from "../store.server";
import type {createProjectSecretBox} from "./secrets.server";
import {projectTransaction} from "./transaction.server";
import {canonicalProjectJSON,projectHash} from "./document";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";
export type AppDataRequest={op:"get"|"list"|"put"|"delete"|"increment";collection:string;key?:string;value?:JsonValue;delta?:number;expectedVersion?:number;idempotencyKey?:string;cursor?:string};
const tokenHash=(token:string)=>createHash("sha256").update(`programmable-app-key-v1\0${token}`).digest("hex");
const invalid=()=>new ProjectError("app-data-input","Use a valid application data request.");
export function createRuntimeDataStore(pool:AIPool,secrets:ReturnType<typeof createProjectSecretBox>,now=Date.now){
  const purpose=(scope:ProjectScope,id:string)=>`${scope.ownerId}\0${scope.projectId}\0app-key\0${id}`;
  async function mintAppKey(scope:ProjectScope,id:string,dataVersion:number,mode:"preview"|"production"="production"){
    if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(dataVersion)||dataVersion<1)throw invalid();
    return projectTransaction(pool,scope,async db=>{
      await db.query("INSERT INTO programmable_projects_v1.app_config(owner,project_id,data_version) VALUES($1,$2,$3) ON CONFLICT(owner,project_id) DO NOTHING",[scope.ownerId,scope.projectId,dataVersion]);
      const config=(await db.query("SELECT data_version FROM programmable_projects_v1.app_config WHERE owner=$1 AND project_id=$2 FOR UPDATE",[scope.ownerId,scope.projectId])).rows[0];
      if(Number(config.data_version)!==dataVersion)throw new ProjectError("app-data-version","This release needs an explicit compatible data migration.",409);
      const previous=(await db.query("SELECT secret_envelope FROM programmable_projects_v1.app_keys WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id])).rows[0];
      if(previous)return {id,token:(secrets.open(purpose(scope,id),String(previous.secret_envelope)) as {token:string}).token};
      const token=`pp1_${randomBytes(32).toString("base64url")}`;
      await db.query("INSERT INTO programmable_projects_v1.app_keys(owner,project_id,id,data_version,secret_envelope,data_namespace) VALUES($1,$2,$3,$4,$5,$6)",[scope.ownerId,scope.projectId,id,dataVersion,secrets.seal(purpose(scope,id),{token}),mode==="preview"?id:"production"]);
      await db.query("INSERT INTO programmable_projects_v1.app_key_index(token_hash,owner,project_id,key_id) VALUES($1,$2,$3,$4)",[tokenHash(token),scope.ownerId,scope.projectId,id]);
      return {id,token};
    });
  }
  async function authenticate(token:string){
    if(!/^pp1_[A-Za-z0-9_-]{43}$/.test(token))throw new ProjectError("app-auth","Invalid application capability.",401);
    const connection=await pool.connect();let row:Record<string,unknown>|undefined;
    try{row=(await connection.query("SELECT owner,project_id,key_id FROM programmable_projects_v1.app_key_index WHERE token_hash=$1",[tokenHash(token)])).rows[0];}finally{connection.release();}
    if(!row)throw new ProjectError("app-auth","Invalid application capability.",401);
    const scope={ownerId:String(row.owner),projectId:String(row.project_id)},keyId=String(row.key_id);
    return projectTransaction(pool,scope,async db=>{
      const config=(await db.query("SELECT c.active,c.data_version,k.active AS key_active,k.data_version AS key_version,k.data_namespace FROM programmable_projects_v1.app_config c JOIN programmable_projects_v1.app_keys k ON k.owner=c.owner AND k.project_id=c.project_id WHERE c.owner=$1 AND c.project_id=$2 AND k.id=$3",[scope.ownerId,scope.projectId,keyId])).rows[0];
      if(!config?.active||!config.key_active)throw new ProjectError("app-stopped","This application is stopped.",403);
      if(config.data_version!==config.key_version)throw new ProjectError("app-data-version","This application uses an incompatible data contract.",409);
      return {...scope,keyId,dataVersion:Number(config.data_version),namespace:String(config.data_namespace)};
    });
  }
  async function activateRelease(scope:ProjectScope,id:string){
    return projectTransaction(pool,scope,async db=>{
      const selected=(await db.query("SELECT id FROM programmable_projects_v1.app_keys WHERE owner=$1 AND project_id=$2 AND id=$3 FOR UPDATE",[scope.ownerId,scope.projectId,id])).rows[0];
      if(!selected)throw new ProjectError("app-auth","The release credential is missing.",409);
      await db.query("UPDATE programmable_projects_v1.app_keys SET active=(id=$3) WHERE owner=$1 AND project_id=$2 AND data_namespace='production'",[scope.ownerId,scope.projectId,id]);
      await db.query("UPDATE programmable_projects_v1.app_keys SET active=true,data_namespace='production' WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id]);
    });
  }
  async function setActive(scope:ProjectScope,active:boolean){return projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.app_config SET active=$3 WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId,active]));}
  async function dataVersion(scope:ProjectScope){return projectTransaction(pool,scope,async db=>Number((await db.query("SELECT data_version FROM programmable_projects_v1.app_config WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0]?.data_version??1));}
  async function invoke(token:string,input:AppDataRequest):Promise<JsonValue>{
    if(!input||Object.keys(input).some(key=>!["op","collection","key","value","delta","expectedVersion","idempotencyKey","cursor"].includes(key))||!["get","list","put","delete","increment"].includes(input.op)||typeof input.collection!=="string"||!/^[A-Za-z0-9_.-]{1,100}$/.test(input.collection)
      ||input.op!=="list"&&(typeof input.key!=="string"||!input.key||input.key.length>200)||canonicalProjectJSON(input).length>128000
      ||input.expectedVersion!==undefined&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0))throw invalid();
    const write=["put","delete","increment"].includes(input.op);
    if(write&&(typeof input.idempotencyKey!=="string"||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey)))throw invalid();
    if(input.op==="put"&&(input.value===undefined||Buffer.byteLength(canonicalProjectJSON(input.value))>64000))throw invalid();
    if(input.op==="increment"&&(!Number.isSafeInteger(input.delta)||Math.abs(input.delta!)>1000000000))throw invalid();
    const principal=await authenticate(token),scope={ownerId:principal.ownerId,projectId:principal.projectId};
    return projectTransaction(pool,scope,async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`project-app-data:${scope.ownerId}:${scope.projectId}`]);
      const config=(await db.query("SELECT c.active,c.data_version,k.active AS key_active,k.data_namespace FROM programmable_projects_v1.app_config c JOIN programmable_projects_v1.app_keys k ON k.owner=c.owner AND k.project_id=c.project_id WHERE c.owner=$1 AND c.project_id=$2 AND k.id=$3 FOR SHARE",[scope.ownerId,scope.projectId,principal.keyId])).rows[0];
      if(!config?.active||!config.key_active||config.data_namespace!==principal.namespace)throw new ProjectError("app-stopped","This application is stopped.",403);
      if(Number(config.data_version)!==principal.dataVersion)throw new ProjectError("app-data-version","The data contract changed.",409);
      const usage=await db.query("INSERT INTO programmable_projects_v1.app_usage(owner,project_id,day,requests) VALUES($1,$2,$3,1) ON CONFLICT(owner,project_id,day) DO UPDATE SET requests=programmable_projects_v1.app_usage.requests+1 WHERE programmable_projects_v1.app_usage.requests<10000 RETURNING requests",[scope.ownerId,scope.projectId,Math.floor(now()/86400000)]);
      if(!usage.rows.length)throw new ProjectError("app-rate","This application's daily request allowance is used up.",429);
      if(write){const receipt=(await db.query("SELECT request_hash,result FROM programmable_projects_v1.app_receipts WHERE owner=$1 AND project_id=$2 AND request_key=$3 AND data_namespace=$4",[scope.ownerId,scope.projectId,input.idempotencyKey,principal.namespace])).rows[0];
        if(receipt){if(receipt.request_hash!==projectHash(input))throw new ProjectError("app-idempotency","This mutation identifier has different contents.",409);return receipt.result as JsonValue;}}
      if(write){
        const usage=(await db.query("SELECT count(*) AS count,COALESCE(sum(octet_length(result::text)),0) AS bytes FROM programmable_projects_v1.app_receipts WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];
        if(Number(usage.count)>=25000||Number(usage.bytes)>32000000)throw new ProjectError("app-receipts","The application mutation allowance is full; export or archive its stored history before continuing.",429);
      }
      if(input.op==="list"){
        const rows=(await db.query("SELECT item_key,value,version FROM programmable_projects_v1.app_items WHERE owner=$1 AND project_id=$2 AND collection=$3 AND item_key>$4 AND data_namespace=$5 AND NOT deleted ORDER BY item_key LIMIT 101",[scope.ownerId,scope.projectId,input.collection,input.cursor??"",principal.namespace])).rows;
        const items:JsonValue[]=[];let size=0;
        for(const row of rows.slice(0,100)){const item={key:String(row.item_key),value:row.value as JsonValue,version:Number(row.version)};size+=canonicalProjectJSON(item).length;if(size>256000)break;items.push(item);}
        return {items,cursor:items.length<rows.length&&items.length?(items.at(-1) as {key:string}).key:null};
      }
      const current=(await db.query("SELECT value,version,deleted FROM programmable_projects_v1.app_items WHERE owner=$1 AND project_id=$2 AND collection=$3 AND item_key=$4 AND data_namespace=$5 FOR UPDATE",[scope.ownerId,scope.projectId,input.collection,input.key,principal.namespace])).rows[0];
      const version=Number(current?.version??0);
      if(input.op==="get")return {value:current?.deleted?null:current?.value as JsonValue??null,version};
      if(input.expectedVersion!==undefined&&input.expectedVersion!==version)throw new ProjectError("app-data-conflict","The item changed before this update.",409);
      let result:JsonValue;
      if(input.op==="delete"){
        const removed=Boolean(current&&!current.deleted);
        if(removed)await db.query("UPDATE programmable_projects_v1.app_items SET value='null'::jsonb,deleted=true,version=version+1 WHERE owner=$1 AND project_id=$2 AND collection=$3 AND item_key=$4 AND data_namespace=$5",[scope.ownerId,scope.projectId,input.collection,input.key,principal.namespace]);
        result={deleted:removed,version:version+(removed?1:0)};
      }else{
        const value=input.op==="increment"?Number(current?.deleted?0:current?.value??0)+input.delta!:input.value!;
        if(input.op==="increment"&&(current&&!current.deleted&&typeof current.value!=="number"||!Number.isSafeInteger(value)))throw invalid();
        const quota=(await db.query("SELECT COALESCE(sum(octet_length(value::text)),0) AS bytes,count(*) AS items FROM programmable_projects_v1.app_items WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];
        if(Number(quota.bytes)-(current?canonicalProjectJSON(current.value).length:0)+canonicalProjectJSON(value).length>32000000||!current&&Number(quota.items)>=4096)throw new ProjectError("app-storage","This project's data allowance is full.",413);
        await db.query("INSERT INTO programmable_projects_v1.app_items(owner,project_id,collection,item_key,value,version,updated_at,data_namespace) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT(owner,project_id,data_namespace,collection,item_key) DO UPDATE SET value=$5::jsonb,version=$6,updated_at=$7,deleted=false",[scope.ownerId,scope.projectId,input.collection,input.key,JSON.stringify(value),version+1,new Date(now()).toISOString(),principal.namespace]);result={value,version:version+1};
      }
      await db.query("INSERT INTO programmable_projects_v1.app_receipts(owner,project_id,request_key,request_hash,result,data_namespace) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[scope.ownerId,scope.projectId,input.idempotencyKey,projectHash(input),JSON.stringify(result),principal.namespace]);
      return result;
    });
  }
  return {mintAppKey,authenticate,activateRelease,setActive,dataVersion,invoke};
}
