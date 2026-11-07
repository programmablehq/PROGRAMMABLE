import "server-only";
import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
import Ajv from "ajv";
import type { AIConnection,AIPool } from "../store.server";
import { projectTransaction } from "./transaction.server";
import { projectHash,canonicalProjectJSON } from "./document";
import { validateConnectorURL } from "./private-http.server";
import { ProjectError,type ProjectScope,type JsonValue } from "./types";
export type ConnectionAction={id:string;description:string;method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE";path:string;effect:"read"|"write";inputSchema:object;outputSchema:object;idempotencyHeader?:string};
export type ConnectionManifest={name:string;kind:"http"|"mcp";baseUrl:string;protocol?:"2026-07-28"|"2025-11-25";
  auth:{kind:"none"}|{kind:"api-key";header:string;prefix?:string}|{kind:"oauth2";authorizeUrl:string;tokenUrl:string;clientId:string;scopes:string[]};actions:ConnectionAction[]};
type Secrets=Record<string,string>;
type Keyring={active:string;keys:Record<string,Buffer>};
type Row=Record<string,unknown>;
const idValid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const invalid=()=>new ProjectError("connection-input","Use a complete, bounded connection configuration.");
export function validateConnectionManifest(input:ConnectionManifest):ConnectionManifest {
  if(!input||typeof input!=="object"||typeof input.name!=="string"||!input.name.trim()||input.name.length>100||!["http","mcp"].includes(input.kind)||!Array.isArray(input.actions)||input.actions.length>64||canonicalProjectJSON(input).length>180000)throw invalid();
  const base=validateConnectorURL(input.baseUrl);if(base.search)throw invalid();
  if(!input.auth||!["none","api-key","oauth2"].includes(input.auth.kind))throw invalid();
  if(input.auth.kind==="api-key"&&(!/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(input.auth.header)||/^(host|cookie|connection|content-length|transfer-encoding|proxy-authorization)$/i.test(input.auth.header)||/[\r\n\0]/.test(input.auth.prefix??"")))throw invalid();
  if(input.auth.kind==="oauth2"){
    validateConnectorURL(input.auth.authorizeUrl);validateConnectorURL(input.auth.tokenUrl);
    if(typeof input.auth.clientId!=="string"||!input.auth.clientId||input.auth.clientId.length>512||!Array.isArray(input.auth.scopes)||input.auth.scopes.length>32||input.auth.scopes.some(scope=>typeof scope!=="string"||!/^[!-~]{1,128}$/.test(scope)))throw invalid();
  }
  if(input.kind==="mcp"&&!["2026-07-28","2025-11-25"].includes(input.protocol??""))throw invalid();
  const ids=new Set<string>();
  for(const action of input.actions){
    if(!action||typeof action.id!=="string"||!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(action.id)||ids.has(action.id)||typeof action.description!=="string"||action.description.length>4000
      ||!["GET","POST","PUT","PATCH","DELETE"].includes(action.method)||!["read","write"].includes(action.effect)||!action.path.startsWith("/")||action.path.startsWith("//")||new URL(action.path,base).origin!==base.origin)throw invalid();
    validateConnectorURL(new URL(action.path,base).href);
    if(input.kind==="http"&&action.method!=="GET"&&action.effect!=="write")throw invalid();
    if(action.idempotencyHeader&&!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(action.idempotencyHeader))throw invalid();
    for(const schema of [action.inputSchema,action.outputSchema]){
      if(!schema||typeof schema!=="object"||Array.isArray(schema)||/"\$(?:async|ref)"\s*:\s*(?:true|"(?:https?:|file:))/.test(JSON.stringify(schema)))throw invalid();
      try{new Ajv({strict:false}).compile(schema);}catch{throw invalid();}
    }
    ids.add(action.id);
  }
  return structuredClone({...input,baseUrl:base.href});
}
export function createConnectionStore(pool:AIPool,keyring:Keyring,now=Date.now){
  if(!keyring.keys[keyring.active]||Object.values(keyring.keys).some(key=>key.length!==32))throw new TypeError("Use 256-bit connection encryption keys");
  const aad=(scope:ProjectScope,id:string)=>Buffer.from(`programmable-connection-v1\0${scope.ownerId}\0${scope.projectId}\0${id}`);
  const seal=(scope:ProjectScope,id:string,secret:Secrets)=>{const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",keyring.keys[keyring.active],iv);cipher.setAAD(aad(scope,id));return Buffer.concat([iv,cipher.update(JSON.stringify(secret)),cipher.final(),cipher.getAuthTag()]).toString("base64");};
  const unseal=(scope:ProjectScope,id:string,row:Row):Secrets=>{
    try{const key=keyring.keys[String(row.key_version)];if(!key)throw invalid();const bytes=Buffer.from(String(row.ciphertext),"base64"),decipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));decipher.setAAD(aad(scope,id));decipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString("utf8"));}
    catch{throw new ProjectError("connection-secret","This private connection needs to be reconnected.",503);}
  };
  const present=(row:Row)=>({id:String(row.id),version:String(row.version),manifest:row.manifest as ConnectionManifest,allowedActions:row.allowed_actions as string[],state:String(row.state)});
  async function read(db:AIConnection,scope:ProjectScope,id:string,lock=false){
    if(!idValid(id))throw invalid();const row=(await db.query(`SELECT * FROM programmable_projects_v1.connections WHERE owner=$1 AND project_id=$2 AND id=$3${lock?" FOR UPDATE":""}`,[scope.ownerId,scope.projectId,id])).rows[0];
    if(!row)throw new ProjectError("connection-missing","This project connection was not found.",404);return row;
  }
  async function saveConnection(scope:ProjectScope,input:{id:string;manifest:ConnectionManifest;allowedActions:string[];secret?:Secrets;expectedVersion?:string}){
    if(!idValid(input.id)||!Array.isArray(input.allowedActions)||new Set(input.allowedActions).size!==input.allowedActions.length)throw invalid();
    const manifest=validateConnectionManifest(input.manifest);
    if(input.allowedActions.some(id=>!manifest.actions.some(action=>action.id===id)))throw invalid();
    if(input.secret&&(Object.keys(input.secret).length>8||Object.values(input.secret).some(value=>typeof value!=="string"||value.length>16000||/[\r\n\0]/.test(value))))throw invalid();
    const version=projectHash({manifest,allowedActions:[...input.allowedActions].sort()});
    return projectTransaction(pool,scope,async db=>{
      const existing=(await db.query("SELECT version FROM programmable_projects_v1.connections WHERE owner=$1 AND project_id=$2 AND id=$3 FOR UPDATE",[scope.ownerId,scope.projectId,input.id])).rows[0];
      if(existing&&input.expectedVersion!==existing.version)throw new ProjectError("connection-version","Reload the connection before changing its permissions.",409);
      if(!existing&&(await db.query("SELECT id FROM programmable_projects_v1.connections WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows.length>=20)throw new ProjectError("connection-limit","Use up to 20 connections per project.",429);
      const timestamp=new Date(now()).toISOString();
      const state=manifest.auth.kind==="none"||input.secret&&(manifest.auth.kind==="api-key"?input.secret.apiKey:input.secret.accessToken)?"active":"pending";
      const saved=(await db.query(`INSERT INTO programmable_projects_v1.connections(owner,project_id,id,version,manifest,allowed_actions,state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$8) ON CONFLICT(owner,project_id,id) DO UPDATE SET version=$4,manifest=$5::jsonb,allowed_actions=$6::jsonb,state=$7,updated_at=$8 RETURNING *`,
        [scope.ownerId,scope.projectId,input.id,version,JSON.stringify(manifest),JSON.stringify(input.allowedActions),state,timestamp])).rows[0];
      if(input.secret)await db.query(`INSERT INTO programmable_projects_v1.connection_secrets(owner,project_id,connection_id,key_version,ciphertext,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(owner,project_id,connection_id) DO UPDATE SET key_version=$4,ciphertext=$5,updated_at=$6`,[scope.ownerId,scope.projectId,input.id,keyring.active,seal(scope,input.id,input.secret),timestamp]);
      return present(saved);
    });
  }
  async function authorize(scope:ProjectScope,id:string,version:string,actionId:string){
    return projectTransaction(pool,scope,async db=>{
      const row=await read(db,scope,id);
      if(row.state==="revoked")throw new ProjectError("connection-revoked","This connection has been disconnected.",403);
      if(row.version!==version)throw new ProjectError("connection-version","Review the updated connection before using it.",409);
      const connection=present(row),action=connection.manifest.actions.find(action=>action.id===actionId);
      if(!action||!connection.allowedActions.includes(actionId))throw new ProjectError("connection-action","This action has not been granted for this project.",403);
      if(row.state!=="active")throw new ProjectError("connection-pending","Connect this account before using its API.",409);
      const secret=(await db.query("SELECT key_version,ciphertext FROM programmable_projects_v1.connection_secrets WHERE owner=$1 AND project_id=$2 AND connection_id=$3",[scope.ownerId,scope.projectId,id])).rows[0];
      return {...connection,action,secret:secret?unseal(scope,id,secret):{}};
    });
  }
  async function beginCall(scope:ProjectScope,input:{connectionId:string;requestKey:string;hash:string;effect:"read"|"write";version:string;actionId:string}){
    if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.requestKey))throw invalid();
    return projectTransaction(pool,scope,async db=>{
      const current=await read(db,scope,input.connectionId,true);
      if(current.state!=="active")throw new ProjectError("connection-revoked","This connection is not active.",403);
      if(current.version!==input.version||!(current.allowed_actions as string[]).includes(input.actionId))throw new ProjectError("connection-version","The connection permissions changed before this action.",409);
      const previous=(await db.query("SELECT * FROM programmable_projects_v1.connector_calls WHERE owner=$1 AND project_id=$2 AND connection_id=$3 AND request_key=$4",[scope.ownerId,scope.projectId,input.connectionId,input.requestKey])).rows[0];
      if(previous){if(previous.input_hash!==input.hash)throw new ProjectError("connection-idempotency","This API action identifier has different arguments.",409);
        if(previous.state==="completed")return {execute:false,result:previous.result as JsonValue};
        if(previous.effect==="read"&&previous.state==="unknown"&&Number(previous.attempts)<3){
          await db.query("UPDATE programmable_projects_v1.connector_calls SET state='pending',attempts=attempts+1 WHERE owner=$1 AND project_id=$2 AND connection_id=$3 AND request_key=$4",[scope.ownerId,scope.projectId,input.connectionId,input.requestKey]);return {execute:true,result:null};}
        throw new ProjectError("connection-unknown","The previous API outcome needs reconciliation before it can be repeated.",409);}
      const count=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.connector_calls WHERE owner=$1 AND created_at>=$2",[scope.ownerId,new Date(Math.floor(now()/86400000)*86400000).toISOString()])).rows[0];
      if(Number(count.count)>=1000)throw new ProjectError("connection-limit","Today's API action limit has been reached.",429);
      await db.query("INSERT INTO programmable_projects_v1.connector_calls(owner,project_id,connection_id,request_key,input_hash,effect,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)",[scope.ownerId,scope.projectId,input.connectionId,input.requestKey,input.hash,input.effect,new Date(now()).toISOString()]);
      return {execute:true,result:null};
    });
  }
  async function finishCall(scope:ProjectScope,id:string,key:string,result:JsonValue|null,failed=false){return projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.connector_calls SET state=$5,result=$6::jsonb WHERE owner=$1 AND project_id=$2 AND connection_id=$3 AND request_key=$4 AND state='pending'",[scope.ownerId,scope.projectId,id,key,failed?"unknown":"completed",JSON.stringify(result)]));}
  async function revoke(scope:ProjectScope,id:string){return projectTransaction(pool,scope,async db=>{await read(db,scope,id,true);await db.query("UPDATE programmable_projects_v1.connections SET state='revoked',allowed_actions='[]'::jsonb,updated_at=$4 WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id,new Date(now()).toISOString()]);await db.query("DELETE FROM programmable_projects_v1.connection_secrets WHERE owner=$1 AND project_id=$2 AND connection_id=$3",[scope.ownerId,scope.projectId,id]);});}
  const listConnections=(scope:ProjectScope)=>projectTransaction(pool,scope,async db=>(await db.query("SELECT * FROM programmable_projects_v1.connections WHERE owner=$1 AND project_id=$2 ORDER BY created_at",[scope.ownerId,scope.projectId])).rows.map(present));
  return {saveConnection,authorize,beginCall,finishCall,revoke,listConnections};
}
