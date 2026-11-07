import "server-only";
import type {ProjectTool} from "./agent.server";
import type {createPlatformStore} from "./project-store.server";
import type {createRepositoryImporter,RepositoryRequest} from "./repository-import.server";
import type {createRepositoryDelivery,RepositoryDeliveryInput} from "./repository-delivery.server";
import {ProjectError,type JsonValue} from "./types";
export function repositoryTools(projects:ReturnType<typeof createPlatformStore>,importer:ReturnType<typeof createRepositoryImporter>,delivery:ReturnType<typeof createRepositoryDelivery>):ProjectTool[]{
 const input={repository:{type:"string"},connectionId:{type:"string"},connectionVersion:{type:"string"}};
 return [
  {id:"repository.import",version:"1",description:"Import a GitHub repository at a pinned commit into this empty project. Preserves provenance, refuses links/submodules and never executes imported source. Use a reviewed project connection for private repositories.",schema:{type:"object",additionalProperties:false,properties:{...input,ref:{type:"string"}},required:["repository"]},execute:async(context,raw)=>{
   const project=await importer.importRepository({...context,execution:{runId:context.runId,leaseToken:context.leaseToken}},{...raw as Omit<RepositoryRequest,"idempotencyKey">,idempotencyKey:context.stepId},context.signal);return {revisionId:project.revisionId,title:project.document.title,files:Object.keys(project.document.files),verification:"not-run"};
  },reconcile:async context=>{const receipt=await projects.readPatchReceipt(context,context.stepId);if(!receipt)throw new ProjectError("repository-reconcile","No committed import receipt exists.",409);return {revisionId:receipt.revisionId};}},
  {id:"repository.deliver",version:"1",description:"Send the current project's complete source to a separate branch and draft pull request after the user requests this GitHub destination. Requires the project's approved GitHub write connection. Does not merge or update the default branch.",schema:{type:"object",additionalProperties:false,properties:{...input,baseRef:{type:"string"},pullRequest:{type:"boolean"}},required:["repository","connectionId","connectionVersion"]},execute:async(context,raw)=>JSON.parse(JSON.stringify(await delivery.deliver(context,{...raw as Omit<RepositoryDeliveryInput,"idempotencyKey"|"revisionId">,revisionId:context.revision.revisionId,idempotencyKey:context.stepId},context.signal))) as JsonValue,
   reconcile:async(context)=>{const rows=await delivery.list(context);return JSON.parse(JSON.stringify(rows)) as JsonValue;}},
  {id:"repository.status",version:"1",description:"Read saved GitHub export receipts and branches for this project.",schema:{type:"object",additionalProperties:false,properties:{}},execute:async context=>JSON.parse(JSON.stringify(await delivery.list(context))) as JsonValue},
 ];
}
