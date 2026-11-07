import "server-only";
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import type {AIPool} from "../store.server";
import type {createConnectionStore} from "./connections.server";
import {projectTransaction} from "./transaction.server";
import {redactConnectorData} from "./private-http.server";
import {ProjectError,type ProjectScope} from "./types";
export function createProjectWebhooks(pool:AIPool,connections:ReturnType<typeof createConnectionStore>,now=Date.now){
  async function create(scope:ProjectScope,connectionId:string){
    const connection=await connections.privateConnection(scope,connectionId);
    if(connection.state!=="active")throw new ProjectError("connection-revoked","Activate this connection before adding events.",409);
    const id=randomUUID(),secret=randomBytes(32).toString("hex");
    await connections.rotateSecret(scope,connectionId,connection.version,{...connection.secret,webhookKey:secret});
    await projectTransaction(pool,scope,db=>db.query("INSERT INTO programmable_projects_v1.webhook_routes(id,owner,project_id,connection_id,version) VALUES($1,$2,$3,$4,$5)",[id,scope.ownerId,scope.projectId,connectionId,connection.version]));
    return {id,path:`/api/custom-ai/platform/webhooks/${id}`,secret};
  }
  async function ingest(input:{routeId:string;eventId:string;timestamp:string;signature:string;body:string}){
    if(!/^[a-f0-9-]{36}$/i.test(input.routeId)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(input.eventId)||!/^\d{10}$/.test(input.timestamp)||Math.abs(now()/1000-Number(input.timestamp))>300||!/^[a-f0-9]{64}$/i.test(input.signature)||Buffer.byteLength(input.body)>128000)throw new ProjectError("webhook-signature","The event signature or timestamp is invalid.",403);
    const db=await pool.connect();let route:Record<string,unknown>|undefined;
    try{route=(await db.query("SELECT owner,project_id,connection_id,version FROM programmable_projects_v1.webhook_routes WHERE id=$1",[input.routeId])).rows[0];}finally{db.release();}
    if(!route)throw new ProjectError("webhook-signature","The event endpoint was not found.",404);
    const scope={ownerId:String(route.owner),projectId:String(route.project_id)},connectionId=String(route.connection_id);
    const connection=await connections.privateConnection(scope,connectionId);
    if(connection.state!=="active"||connection.version!==route.version||!connection.secret.webhookKey)throw new ProjectError("connection-revoked","This event connection is not active.",403);
    const signed=JSON.stringify(["programmable-webhook-v1",input.routeId,input.eventId,input.timestamp,input.body]);
    const expected=createHmac("sha256",connection.secret.webhookKey).update(signed).digest();
    if(!timingSafeEqual(expected,Buffer.from(input.signature,"hex")))throw new ProjectError("webhook-signature","The event signature is invalid.",403);
    let raw:unknown;try{raw=JSON.parse(input.body);}catch{throw new ProjectError("webhook-json","Use a JSON event body.");}
    const payload=redactConnectorData(raw,Object.values(connection.secret)),bodyHash=createHash("sha256").update(input.body).digest("hex");
    return projectTransaction(pool,scope,async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`project-webhook:${input.routeId}`]);
      const duplicate=(await db.query("SELECT body_hash FROM programmable_projects_v1.webhook_inbox WHERE owner=$1 AND project_id=$2 AND connection_id=$3 AND event_id=$4",[scope.ownerId,scope.projectId,connectionId,input.eventId])).rows[0];
      if(duplicate){if(duplicate.body_hash!==bodyHash)throw new ProjectError("webhook-conflict","This event identifier has different contents.",409);return {accepted:true,duplicate:true};}
      const count=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.webhook_inbox WHERE owner=$1 AND project_id=$2 AND connection_id=$3 AND received_at>$4",[scope.ownerId,scope.projectId,connectionId,new Date(now()-60000).toISOString()])).rows[0];
      if(Number(count.count)>=120)throw new ProjectError("webhook-rate","This event connection is receiving too many events.",429);
      await db.query("INSERT INTO programmable_projects_v1.webhook_inbox(owner,project_id,connection_id,event_id,body_hash,payload,received_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[scope.ownerId,scope.projectId,connectionId,input.eventId,bodyHash,JSON.stringify(payload),new Date(now()).toISOString()]);
      return {accepted:true,duplicate:false};
    });
  }
  async function list(scope:ProjectScope,connectionId:string){await connections.privateConnection(scope,connectionId);return projectTransaction(pool,scope,async db=>({events:(await db.query("SELECT event_id,payload,received_at FROM programmable_projects_v1.webhook_inbox WHERE owner=$1 AND project_id=$2 AND connection_id=$3 ORDER BY received_at DESC LIMIT 50",[scope.ownerId,scope.projectId,connectionId])).rows}));}
  return {create,ingest,list};
}
