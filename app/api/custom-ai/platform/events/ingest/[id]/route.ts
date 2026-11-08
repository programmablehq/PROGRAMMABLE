import {readPreviewBody} from "@/lib/custom-ai/access.server";
import {aiError,aiHeaders} from "@/lib/custom-ai/http.server";
import {CustomAIError} from "@/lib/custom-ai/types";
import {productionGameEvents} from "@/lib/custom-ai/platform/event-production.server";
import {ProjectError} from "@/lib/custom-ai/platform/types";
import type {SignedGameEvent} from "@/lib/custom-ai/platform/game-events";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  if(process.env.CUSTOM_AI_PLATFORM_ENABLED!=="true")return new Response(null,{status:404});
  const {id}=await context.params;if(!/^0x[a-f0-9]{64}$/.test(id))throw new ProjectError("game-binding","Choose a valid event binding.",404);
  const events=productionGameEvents(),scope=await events.route(id);
  const event=await events.ingest(scope,id,await readPreviewBody(request,12000) as SignedGameEvent);
  return Response.json({accepted:true,eventId:event.id,state:event.state},{status:202,headers:aiHeaders});
 }catch(error){return aiError(error instanceof ProjectError?new CustomAIError(error.code,error.message,error.status):error);}
}
