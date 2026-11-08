import {productionAccountDependencies} from "@/lib/custom-ai/platform/production.server";
import {productionProjectChecks} from "@/lib/custom-ai/platform/agent-production.server";
import {executeProjectRequest} from "@/lib/custom-ai/platform/http.server";
import {aiHeaders} from "@/lib/custom-ai/http.server";
import {ProjectError} from "@/lib/custom-ai/platform/types";
export const runtime="nodejs";
export const GET=(request:Request)=>executeProjectRequest(productionAccountDependencies(),request,"read",async ownerId=>{
  const query=new URL(request.url).searchParams,projectId=query.get("projectId"),revisionId=query.get("revisionId");
  if(!projectId||!revisionId||[...query.keys()].some(key=>!["projectId","revisionId"].includes(key)))throw new ProjectError("check-input","Choose a project revision.");
  return Response.json(await productionProjectChecks().assess({ownerId,projectId,revisionId}),{headers:aiHeaders});
});
