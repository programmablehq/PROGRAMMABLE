import "server-only";
import {readPreviewBody} from "../access.server";
import {aiError,aiHeaders} from "../http.server";
import {CustomAIError} from "../types";
import {ProjectError,type JsonValue} from "./types";
import type {createRuntimeDataStore,AppDataRequest} from "./runtime-data.server";
import type {createConnectionService} from "./connector-service.server";
import type {createProjectReleases} from "./releases.server";
import {executeProjectRequest,type ProjectAccountDependencies} from "./http.server";
const failed=(error:unknown)=>aiError(error instanceof ProjectError?new CustomAIError(error.code,error.message,error.status):error);
export function createAppRuntimeRoutes(deps:{enabled:()=>boolean;data:()=>ReturnType<typeof createRuntimeDataStore>;connections:()=>ReturnType<typeof createConnectionService>}){
 const post=(kind:"data"|"connector")=>async(request:Request)=>{
  try{
   if(!deps.enabled())return new Response(null,{status:404});
   const auth=request.headers.get("authorization");if(!auth?.startsWith("Bearer "))throw new ProjectError("app-auth","Use an application capability.",401);
   const token=auth.slice(7),data=deps.data();
   if(kind==="data")return Response.json(await data.invoke(token,await readPreviewBody(request,128000) as AppDataRequest),{headers:aiHeaders});
   const principal=await data.authenticate(token),input=await readPreviewBody(request,128000) as Record<string,unknown>;
   if(!input||typeof input!=="object"||Object.keys(input).some(key=>!["connectionId","version","actionId","input","idempotencyKey"].includes(key))||["connectionId","version","actionId","idempotencyKey"].some(key=>typeof input[key]!=="string"))throw new ProjectError("app-connector","Use a reviewed connection action.");
   return Response.json({result:await deps.connections().invoke(principal,{connectionId:input.connectionId as string,version:input.version as string,actionId:input.actionId as string,input:input.input as JsonValue,idempotencyKey:input.idempotencyKey as string},request.signal)},{headers:aiHeaders});
  }catch(error){return failed(error);}
 };
 return {DATA:post("data"),CONNECTOR:post("connector")};
}
export function createReleaseRoutes(deps:ProjectAccountDependencies&{releases:()=>ReturnType<typeof createProjectReleases>}){
 const GET=(request:Request)=>executeProjectRequest(deps,request,"read",async ownerId=>{
  const query=new URL(request.url).searchParams,projectId=query.get("projectId"),releaseId=query.get("releaseId");if(!projectId||[...query.keys()].some(key=>!["projectId","releaseId"].includes(key)))throw new ProjectError("release-input","Choose a project release.");
  const scope={ownerId,projectId};return Response.json(releaseId?{release:await deps.releases().read(scope,releaseId)}:{releases:await deps.releases().list(scope)},{headers:aiHeaders});
 });
 const POST=(request:Request)=>executeProjectRequest(deps,request,"write",async ownerId=>{
  const body=await readPreviewBody(request,6000) as Record<string,unknown>;
  if(!body||typeof body!=="object"||Object.keys(body).some(key=>!["action","projectId","releaseId","revisionId","idempotencyKey","mode"].includes(key))||typeof body.projectId!=="string")throw new ProjectError("release-input","Choose a valid app release action.");
  const scope={ownerId,projectId:body.projectId},releases=deps.releases();
  if(body.action==="publish"||body.action==="queue"){
   if(typeof body.revisionId!=="string"||typeof body.idempotencyKey!=="string"||!["preview","production"].includes(String(body.mode)))throw new ProjectError("release-input","Choose a reviewed revision and release target.");
   const input={revisionId:body.revisionId,idempotencyKey:body.idempotencyKey,mode:body.mode as "preview"|"production"};
   return Response.json({release:await (body.action==="queue"?releases.queue(scope,input):releases.publish(scope,input))},{status:202,headers:aiHeaders});
  }
  if(typeof body.releaseId!=="string")throw new ProjectError("release-input","Choose a saved release.");
  const result=body.action==="refresh"?await releases.refresh(scope,body.releaseId):body.action==="promote"?await releases.promote(scope,body.releaseId):body.action==="rollback"?await releases.promote(scope,body.releaseId,true):body.action==="stop"?await releases.setActive(scope,body.releaseId,false):body.action==="resume"?await releases.setActive(scope,body.releaseId,true):body.action==="retry-control"?await releases.retryControl(scope,body.releaseId):null;
  if(!result)throw new ProjectError("release-input","Choose a valid release action.");return Response.json({release:result},{headers:aiHeaders});
 });
 return {GET,POST};
}
