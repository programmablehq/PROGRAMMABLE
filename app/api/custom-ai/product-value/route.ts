import {authorizeCustomAI} from "@/lib/custom-ai/auth.server";
import {createProductionDependencyRpcs} from "@/lib/custom-ai/dependency-rpc.server";
import {aiError, aiHeaders} from "@/lib/custom-ai/http.server";
import {createProductValueReader} from "@/lib/custom-ai/product/action-service.server";
import {readProductionProductRuntime} from "@/lib/custom-ai/product/runtime-production.server";
import {productionAIStore} from "@/lib/custom-ai/store.server";
import {CustomAIError} from "@/lib/custom-ai/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const read = createProductValueReader({store: productionAIStore, runtime: readProductionProductRuntime, rpcs: createProductionDependencyRpcs});

export async function GET(request: Request) {
  try {
    if (process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED !== "true") throw new CustomAIError("unavailable", "Product values are not available here yet.", 404);
    const authority = await authorizeCustomAI(request, false, true);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    const query = new URL(request.url).searchParams, id = query.get("id"), action = query.get("action");
    if (!id || !action || [...query.keys()].some(key => !["id", "action"].includes(key) || query.getAll(key).length !== 1))
      throw new CustomAIError("product-value-input", "Choose one value from your saved product.", 400);
    await productionAIStore().consume(authority.owner, "product-value-read", 30);
    return Response.json(await read(request, authority, id, action), {headers: aiHeaders});
  } catch (error) {return aiError(error);}
}
