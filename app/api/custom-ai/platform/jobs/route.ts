import {productionAccountDependencies} from "@/lib/custom-ai/platform/production.server";
import {productionAppJobs} from "@/lib/custom-ai/platform/runtime-production.server";
import {executeProjectRequest} from "@/lib/custom-ai/platform/http.server";
import {readPreviewBody} from "@/lib/custom-ai/access.server";
import {aiHeaders} from "@/lib/custom-ai/http.server";
import {ProjectError} from "@/lib/custom-ai/platform/types";
import type {AppJob} from "@/lib/custom-ai/platform/jobs.server";
export const runtime="nodejs";
export const GET=(request:Request)=>executeProjectRequest(productionAccountDependencies(),request,"read",async ownerId=>{
 const query=new URL(request.url).searchParams,projectId=query.get("projectId");if(!projectId||[...query.keys()].some(key=>key!=="projectId"))throw new ProjectError("job-input","Choose a project.");
 return Response.json(await productionAppJobs().list({ownerId,projectId}),{headers:aiHeaders});
});
export const POST=(request:Request)=>executeProjectRequest(productionAccountDependencies(),request,"write",async ownerId=>{
 const body=await readPreviewBody(request,18000) as {projectId:string;job:AppJob};if(!body||typeof body.projectId!=="string"||Object.keys(body).some(key=>!["projectId","job"].includes(key)))throw new ProjectError("job-input","Choose a project task.");
 return Response.json(await productionAppJobs().define({ownerId,projectId:body.projectId},body.job),{headers:aiHeaders});
});
export const PATCH=(request:Request)=>executeProjectRequest(productionAccountDependencies(),request,"write",async ownerId=>{
 const body=await readPreviewBody(request,4000) as {projectId:string;jobId:string;enabled:boolean};
 if(!body||typeof body.projectId!=="string"||typeof body.jobId!=="string"||typeof body.enabled!=="boolean"||Object.keys(body).some(key=>!["projectId","jobId","enabled"].includes(key)))throw new ProjectError("job-input","Choose a saved project task.");
 return Response.json(await productionAppJobs().setEnabled({ownerId,projectId:body.projectId},body.jobId,body.enabled),{headers:aiHeaders});
});
