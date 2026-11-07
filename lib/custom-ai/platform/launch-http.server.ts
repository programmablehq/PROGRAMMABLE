import "server-only";
import {getAddress} from "viem";
import {readPreviewBody} from "../access.server";
import {aiError,aiHeaders} from "../http.server";
import {CustomAIError} from "../types";
import {projectCompilationView} from "../project-view";
import type {createPlatformLaunchDrafts} from "./launch-draft.server";
import type {createPlatformContractCheckpoints} from "./contract-checkpoint.server";
import {ProjectError} from "./types";
type Dependencies={enabled:()=>boolean;authorize:(request:Request,write:boolean)=>Promise<{ownerId:string;wallets:readonly string[]}>;consume:(ownerId:string,write:boolean)=>Promise<unknown>;drafts:()=>ReturnType<typeof createPlatformLaunchDrafts>;checkpoints:()=>ReturnType<typeof createPlatformContractCheckpoints>};
export function createPlatformLaunchRoutes(deps:Dependencies){
  async function execute(request:Request,write:boolean){
    try{
      if(!deps.enabled())return new Response(null,{status:404});
      const authority=await deps.authorize(request,write);await deps.consume(authority.ownerId,write);
      const body=write?await readPreviewBody(request,16000) as Record<string,unknown>:Object.fromEntries(new URL(request.url).searchParams);
      if(!body||typeof body.projectId!=="string"||typeof body.account!=="string"||Object.keys(body).some(key=>!(write?["action","projectId","account","expectedRevision","sourceRevision","settings","imageId"]:["projectId","account"]).includes(key)))throw new ProjectError("launch-draft-input","Choose a saved project and linked wallet.");
      let account:string;try{account=getAddress(body.account);}catch{throw new ProjectError("launch-wallet","Choose a linked launch wallet.");}
      if(!authority.wallets.some(wallet=>wallet.toLowerCase()===account.toLowerCase()))throw new ProjectError("launch-wallet","Connect the wallet that owns these launch details.",403);
      const scope={ownerId:authority.ownerId,projectId:body.projectId},drafts=deps.drafts();
      if(!write)return Response.json({draft:await drafts.read(scope,account)},{headers:aiHeaders});
      if(typeof body.sourceRevision!=="string")throw new ProjectError("launch-source-changed","Use the current project revision.",409);
      if(body.action==="save"){
        if(typeof body.expectedRevision!=="number"||body.imageId!==undefined&&body.imageId!==null&&typeof body.imageId!=="string")throw new ProjectError("launch-draft-input","Use the current launch details.");
        return Response.json({draft:await drafts.save(scope,{account,expectedRevision:body.expectedRevision,sourceRevision:body.sourceRevision,settings:body.settings,imageId:body.imageId as string|null|undefined})},{headers:aiHeaders});
      }
      if(body.action!=="freeze")throw new ProjectError("launch-draft-input","Choose a supported launch review action.");
      const source=await deps.checkpoints().freeze(scope,account,body.sourceRevision),draft=await drafts.read(scope,account);
      if(draft.revision!==source.studioRevision||draft.sourceRevision!==body.sourceRevision)throw new ProjectError("launch-source-changed","The launch details changed while they were being reviewed.",409);
      return Response.json({draft,sourceId:source.binding.sourceId,intent:source.project.intent,project:projectCompilationView({project:source.project,compilation:source.compilation,scenarios:source.scenarios,sourceAudit:source.sourceAudit,blueprintId:source.blueprint.id,summary:source.binding.settings.name||"Checked contract"})},{headers:aiHeaders});
    }catch(error){return aiError(error instanceof ProjectError?new CustomAIError(error.code,error.message,error.status):error);}
  }
  return {GET:(request:Request)=>execute(request,false),POST:(request:Request)=>execute(request,true)};
}
