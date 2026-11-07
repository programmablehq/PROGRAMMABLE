import {PGlite} from "@electric-sql/pglite";
import {createPlatformStore} from "../../lib/custom-ai/platform/project-store.server";
import {createProjectRoutes} from "../../lib/custom-ai/platform/http.server";
import {createRunStore} from "../../lib/custom-ai/platform/runs.server";
import {createRunRoutes} from "../../lib/custom-ai/platform/run-http.server";
import {createConnectionStore} from "../../lib/custom-ai/platform/connections.server";
import {createConnectionRoutes} from "../../lib/custom-ai/platform/connection-http.server";
import {PROJECT_PLATFORM_SCHEMA} from "../../lib/custom-ai/platform/schema.generated";
import {CUSTOM_AI_SCHEMA,type AIPool} from "../../lib/custom-ai/store.server";
import {CustomAIError} from "../../lib/custom-ai/types";

/** Local-only synthetic accounts. The UI talks over HTTP to the real stores/routes.
 * This fixture does not stand in for production identity or a real LLM test. */
export async function createPlatformFixture(){
  const db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(done=>{release=done;});await previous;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
  const store=createPlatformStore(pool),runs=createRunStore(pool,{allowance:{hourlyUnits:1000,dailyUnits:1000,globalDailyUnits:2000,concurrent:1},leaseMs:60000,capabilities:{}});
  let paused=false;
  const account=(request:Request)=>{const ownerId=request.headers.get("authorization")?.replace(/^Bearer fixture-/,"");if(!ownerId||!["alice","bob"].includes(ownerId))throw new CustomAIError("auth","Sign in",401);return ownerId;};
  const dependencies={enabled:()=>true,consume:async()=>{},authorize:async(request:Request,write:boolean)=>{const ownerId=account(request);if(write&&request.headers.get("x-custom-ai-cache-scope")!==`fixture:${ownerId}`)throw new CustomAIError("cache-scope","Reconnect",401);return{ownerId};}};
  const projects=createProjectRoutes({...dependencies,store:()=>store});
  const connections=createConnectionStore(pool,{active:"fixture",keys:{fixture:Buffer.alloc(32,7)}});
  const connectionRoutes=createConnectionRoutes({...dependencies,store:()=>connections,service:()=>{throw Error("Not used in UI persistence fixture")},oauth:()=>{throw Error("Not used in UI persistence fixture")},webhooks:()=>{throw Error("Not used in UI persistence fixture")}});
  const work=createRunRoutes({...dependencies,store:()=>runs,onQueued:async(scope,id)=>{
    if(paused)return;
    setTimeout(()=>void(async()=>{
      const lease=await runs.claimRun(scope,id,"fixture-worker");if(!lease)return;
      const current=await store.readProject(scope),read=await runs.readWork(scope,id,lease.token);
      await store.applyProjectPatch({...scope,expectedRevisionId:current.revisionId,idempotencyKey:`fixture:${id}`,patch:{title:"Shared counter",files:{"index.js":"export const count = 1;\n"},requirements:[{id:"counter",text:read.prompt,kind:"behavior",open:null,origin:{kind:"message",requestId:id,messageIndex:0,quote:read.prompt}}]},execution:{runId:id,leaseToken:lease.token}});
      await runs.finishRun(scope,id,lease.token,"The counter source is saved. Behavior checks have not run yet.");
    })().catch(()=>{}),100);
  }});
  async function handle(request:Request){
    const url=new URL(request.url);
    if(url.pathname==="/fixture/pause"){paused=(await request.json()).paused;return Response.json({paused});}
    if(url.pathname==="/api/custom-ai/conversations"){try{return Response.json({cacheScope:`fixture:${account(request)}`});}catch{return new Response(null,{status:401});}}
    const name=url.pathname.split("/").at(-1),method=request.method;
    const routes=name==="projects"?projects:name==="runs"?work:name==="connections"?connectionRoutes:undefined;
    const handler=routes?.[method as keyof typeof routes] as ((request:Request)=>Promise<Response>)|undefined;
    if(name==="export")return projects.DOWNLOAD(request);if(name==="restore")return projects.RESTORE(request);
    return handler?handler(request):new Response(null,{status:404});
  }
  return {handle,close:()=>db.close()};
}
