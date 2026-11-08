import {productionProjectWebhooks} from "@/lib/custom-ai/platform/connection-production.server";
import {ProjectError} from "@/lib/custom-ai/platform/types";
import {aiError,aiHeaders} from "@/lib/custom-ai/http.server";
import {CustomAIError} from "@/lib/custom-ai/types";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    if(process.env.CUSTOM_AI_PLATFORM_ENABLED!=="true")return new Response(null,{status:404});
    const reader=request.body?.getReader();if(!reader)throw new ProjectError("webhook-body","Send a signed event body.");
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>128000)throw new ProjectError("webhook-size","The event body is too large.",413);chunks.push(part.value);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const result=await productionProjectWebhooks().ingest({routeId:(await context.params).id,eventId:request.headers.get("x-programmable-event-id")??"",timestamp:request.headers.get("x-programmable-timestamp")??"",signature:request.headers.get("x-programmable-signature")??"",body:Buffer.concat(chunks).toString("utf8")});
    return Response.json(result,{status:202,headers:aiHeaders});
  }catch(error){return aiError(error instanceof ProjectError?new CustomAIError(error.code,error.message,error.status):error);}
}
