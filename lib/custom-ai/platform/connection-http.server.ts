import "server-only";
import {readPreviewBody} from "../access.server";
import {aiHeaders} from "../http.server";
import {executeProjectRequest,type ProjectAccountDependencies} from "./http.server";
import type {createConnectionStore,ConnectionManifest} from "./connections.server";
import type {createConnectionService} from "./connector-service.server";
import type {createProjectOAuth} from "./oauth.server";
import type {createProjectWebhooks} from "./webhooks.server";
import {discoverMCP} from "./mcp.server";
import {importOpenAPI} from "./openapi.server";
import {ProjectError,type JsonValue} from "./types";

const bad=()=>new ProjectError("connection-input","Choose a valid project connection request.");
function bodyObject(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw bad();return value as Record<string,unknown>;}
export function createConnectionRoutes(deps:ProjectAccountDependencies&{store:()=>ReturnType<typeof createConnectionStore>;service:()=>ReturnType<typeof createConnectionService>;oauth:()=>ReturnType<typeof createProjectOAuth>;webhooks:()=>ReturnType<typeof createProjectWebhooks>}){
  const GET=(request:Request)=>executeProjectRequest(deps,request,"read",async ownerId=>{
    const query=new URL(request.url).searchParams,projectId=query.get("projectId");if(!projectId||[...query.keys()].some(key=>!["projectId","connectionId"].includes(key)))throw bad();
    const scope={ownerId,projectId},connectionId=query.get("connectionId");
    return Response.json(connectionId?await deps.webhooks().list(scope,connectionId):{connections:await deps.store().listConnections(scope)},{headers:aiHeaders});
  });
  const POST=(request:Request)=>executeProjectRequest(deps,request,"write",async ownerId=>{
    const raw=await readPreviewBody(request,1200000);if(!raw||typeof raw!=="object"||Array.isArray(raw))throw bad();
    const action=(raw as Record<string,unknown>).action;
    if(action==="oauth-complete"){
      const data=bodyObject(raw,["action","state","code"]);if(typeof data.state!=="string"||typeof data.code!=="string")throw bad();
      return Response.json(await deps.oauth().complete(ownerId,data.state,data.code,request.signal),{headers:aiHeaders});
    }
    if(action==="openapi"){
      const data=bodyObject(raw,["action","document","name","server","auth"]);if(typeof data.name!=="string"||data.server!==undefined&&typeof data.server!=="string")throw bad();
      return Response.json(importOpenAPI(data.document,{name:data.name,server:data.server as string|undefined,auth:data.auth as ConnectionManifest["auth"]|undefined}),{headers:aiHeaders});
    }
    const data=bodyObject(raw,["action","projectId","connectionId","manifest","allowedActions","secret","expectedVersion","version","actionId","input","idempotencyKey"]);
    if(typeof data.projectId!=="string"||typeof data.connectionId!=="string")throw bad();const scope={ownerId,projectId:data.projectId},id=data.connectionId;
    if(action==="save"){
      const result=await deps.store().saveConnection(scope,{id,manifest:data.manifest as ConnectionManifest,allowedActions:data.allowedActions as string[],secret:data.secret as Record<string,string>|undefined,expectedVersion:data.expectedVersion as string|undefined});
      return Response.json({connection:result},{headers:aiHeaders});
    }
    if(action==="oauth-start")return Response.json(await deps.oauth().start(scope,id),{headers:aiHeaders});
    if(action==="webhook-create")return Response.json(await deps.webhooks().create(scope,id),{headers:aiHeaders});
    if(action==="mcp-discover"){
      const connection=await deps.store().privateConnection(scope,id);if(connection.manifest.kind!=="mcp"||connection.state!=="active")throw bad();
      const headers:Record<string,string>={},auth=connection.manifest.auth;
      if(auth.kind==="api-key")headers[auth.header]=`${auth.prefix??""}${connection.secret.apiKey??""}`;
      if(auth.kind==="oauth2")headers.Authorization=`Bearer ${connection.secret.accessToken??""}`;
      const actions=await discoverMCP(connection.manifest,headers,undefined,request.signal);
      const saved=await deps.store().saveConnection(scope,{id,manifest:{...connection.manifest,actions},allowedActions:[],secret:connection.secret,expectedVersion:connection.version});
      return Response.json({connection:saved,reviewRequired:true},{headers:aiHeaders});
    }
    if(action==="invoke"){
      if(typeof data.version!=="string"||typeof data.actionId!=="string"||typeof data.idempotencyKey!=="string")throw bad();
      return Response.json({result:await deps.service().invoke(scope,{connectionId:id,version:data.version,actionId:data.actionId,input:data.input as JsonValue,idempotencyKey:data.idempotencyKey},request.signal)},{headers:aiHeaders});
    }
    throw bad();
  });
  const DELETE=(request:Request)=>executeProjectRequest(deps,request,"write",async ownerId=>{
    const query=new URL(request.url).searchParams,projectId=query.get("projectId"),id=query.get("connectionId");
    if(!projectId||!id||[...query.keys()].some(key=>!["projectId","connectionId"].includes(key)))throw bad();
    await deps.store().revoke({ownerId,projectId},id);return Response.json({revoked:true},{headers:aiHeaders});
  });
  return {GET,POST,DELETE};
}
