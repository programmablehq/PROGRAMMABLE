import "server-only";
import {readPreviewBody} from "../access.server";
import {aiHeaders} from "../http.server";
import {executeProjectRequest,type ProjectAccountDependencies} from "./http.server";
import type {createRepositoryImporter,RepositoryRequest} from "./repository-import.server";
import type {createRepositoryDelivery,RepositoryDeliveryInput} from "./repository-delivery.server";
import {githubConnectionManifest} from "./github.server";
import {ProjectError} from "./types";
export function createRepositoryRoutes(deps:ProjectAccountDependencies&{importer:()=>ReturnType<typeof createRepositoryImporter>;delivery:()=>ReturnType<typeof createRepositoryDelivery>}){
 const GET=(request:Request)=>executeProjectRequest(deps,request,"read",async ownerId=>{
  const query=new URL(request.url).searchParams,projectId=query.get("projectId");if(!projectId||[...query.keys()].some(key=>key!=="projectId"))throw new ProjectError("repository-input","Choose a project.");
  return Response.json({deliveries:await deps.delivery().list({ownerId,projectId})},{headers:aiHeaders});
 });
 const POST=(request:Request)=>executeProjectRequest(deps,request,"write",async ownerId=>{
  const body=await readPreviewBody(request,4100000) as Record<string,unknown>;
  if(!body||typeof body.projectId!=="string"||Object.keys(body).some(key=>!["action","projectId","request","bundle","idempotencyKey"].includes(key)))throw new ProjectError("repository-input","Choose a project import or export.");
  const scope={ownerId,projectId:body.projectId};
  if(body.action==="import-bundle"){
   if(typeof body.idempotencyKey!=="string")throw new ProjectError("repository-input","Use a valid import request.");
   return Response.json({project:await deps.importer().importBundle(scope,{bundle:body.bundle,idempotencyKey:body.idempotencyKey})},{headers:aiHeaders});
  }
  const input=body.request as Record<string,unknown>;
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["repository","ref","idempotencyKey","connectionId","connectionVersion","revisionId","baseRef","pullRequest"].includes(key))||typeof input.repository!=="string")throw new ProjectError("repository-input","Use a complete repository request.");
  if(body.action==="connection-template")return Response.json({manifest:githubConnectionManifest(input.repository)},{headers:aiHeaders});
  if(body.action==="import-github")return Response.json({project:await deps.importer().importRepository(scope,input as RepositoryRequest)},{headers:aiHeaders});
  if(body.action==="deliver")return Response.json({delivery:await deps.delivery().deliver(scope,input as RepositoryDeliveryInput)},{headers:aiHeaders});
  throw new ProjectError("repository-input","Choose a supported repository action.");
 });
 return {GET,POST};
}
