import { createHash } from "node:crypto";
import { readCustomAIToken } from "@/lib/custom-ai/index.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import type { CoinOperationStatus } from "@/ops/custom-ai-worker/runtime.server";
export const runtime="nodejs";
export async function GET(request:Request){
  try{
    const q=new URL(request.url).searchParams,chain=Number(q.get("chain")),token=q.get("token")?.toLowerCase();
    if(![1,4663].includes(chain)||!token||!/^0x[0-9a-f]{40}$/.test(token))throw new CustomAIError("input","Choose a valid coin.",400);
    if(!await readCustomAIToken(chain as 1|4663,token))throw new CustomAIError("missing","This coin was not found.",404);
    const id=createHash("sha256").update(`${chain}:${token}`).digest("hex");
    const value=(await productionAIStore().readObject<CoinOperationStatus>("system","coin-operation",id))?.value;
    const status=value?{...value,...(Date.now()-value.checkedAt>180000?{state:"blocked" as const,reason:"The last service update is out of date."}:{})}:null;
    return Response.json({status},{headers:{"Cache-Control":"public, max-age=15, s-maxage=30","X-Content-Type-Options":"nosniff"}});
  }catch(error){return aiError(error);}
}
