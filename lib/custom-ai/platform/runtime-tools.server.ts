import "server-only";
import type {ProjectTool} from "./agent.server";
import type {createProjectReleases} from "./releases.server";
import type {createAppJobs,AppJob} from "./jobs.server";
import {ProjectError,type JsonValue} from "./types";

export function runtimeTools(releases:ReturnType<typeof createProjectReleases>,jobs:ReturnType<typeof createAppJobs>):ProjectTool[]{
 const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value));
 return [
  {id:"project.publish",version:"1",description:"Queue a durable, source-bound application preview. Allowed only after an explicit deploy request. The receipt is not a live publication; inspect project.releases and use project.promote only after the preview is checked.",schema:{type:"object",additionalProperties:false,properties:{},required:[]},
   execute:async context=>json(await releases.queue(context,{revisionId:context.revision.revisionId,idempotencyKey:context.stepId,mode:"preview"})),
   reconcile:async context=>json(await releases.receipt(context,context.stepId))},
  {id:"project.releases",version:"1",description:"Read application releases or check the actual provider state of one saved release.",schema:{type:"object",additionalProperties:false,properties:{releaseId:{type:"string"}}},
   execute:async(context,input)=>{const id=(input as {releaseId?:string}).releaseId;return json(id?await releases.refresh(context,id):await releases.list(context));}},
  {id:"project.promote",version:"1",description:"Publish a checked application preview when the user requested publication. Cannot skip checks, change source or deploy an onchain contract.",schema:{type:"object",additionalProperties:false,properties:{releaseId:{type:"string"}},required:["releaseId"]},
   execute:async(context,input)=>json(await releases.promote(context,(input as {releaseId:string}).releaseId)),
   reconcile:async(context,input)=>{const release=await releases.read(context,(input as {releaseId:string}).releaseId);if(release.state!=="published")throw new ProjectError("release-reconcile","Publication needs reconciliation before another attempt.",409);return json(release);}},
  {id:"app.jobs",version:"1",description:"Read scheduled task definitions and actual run receipts for this project.",schema:{type:"object",additionalProperties:false,properties:{}},execute:async context=>json(await jobs.list(context))},
  {id:"app.schedule",version:"1",description:"Configure a task on the published app after the user requests it. Callbacks use a stable runId as the idempotency key. Set idempotent only when the handler guarantees repeated runIds cannot repeat an effect.",schema:{type:"object",additionalProperties:false,properties:{id:{type:"string"},path:{type:"string"},intervalSeconds:{type:"integer",minimum:60,maximum:604800},idempotent:{type:"boolean"},body:{},enabled:{type:"boolean"}},required:["id","path","intervalSeconds","idempotent","body"]},execute:async(context,input)=>json(await jobs.define(context,input as AppJob)),reconcile:async context=>json(await jobs.list(context))},
 ];
}
