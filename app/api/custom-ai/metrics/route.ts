import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError,aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { summarizeRequestMetrics, type RequestMetrics } from "@/lib/custom-ai/request-metrics";
export const runtime="nodejs";
export async function GET(request:Request){
  try{
    const auth=await authorizeCustomAI(request);if(auth.kind!=="account")throw new CustomAIError("auth","Connect your wallet to see your request metrics.",401);
    const store=productionAIStore();await store.consume(auth.owner,"metrics",60);
    const rows=await store.recentRequestMetrics(auth.owner) as RequestMetrics[];
    return Response.json(summarizeRequestMetrics(rows), {headers:aiHeaders});
  }catch(error){return aiError(error);}
}
