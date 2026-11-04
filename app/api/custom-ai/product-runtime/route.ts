import {authorizeCustomAI} from "@/lib/custom-ai/auth.server";
import {aiError,aiHeaders} from "@/lib/custom-ai/http.server";
import {readProductionProductRuntime as read} from "@/lib/custom-ai/product/runtime-production.server";
import {productionAIStore} from "@/lib/custom-ai/store.server";
import {CustomAIError} from "@/lib/custom-ai/types";

export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
  try{
    if(process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED!=="true")throw new CustomAIError("unavailable","Product contracts are not available here yet.",404);
    const authority=await authorizeCustomAI(request,false,true);
    if(authority.kind!=="account")throw new CustomAIError("auth","Connect your wallet to continue.",401);
    const query=new URL(request.url).searchParams,id=query.get("id");
    if(!id||[...query.keys()].some(key=>key!=="id"||query.getAll(key).length!==1))throw new CustomAIError("product-runtime-input","Open one saved product.",400);
    await productionAIStore().consume(authority.owner,"product-runtime-read",60);
    return Response.json({runtime:await read(request,authority,id)},{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
