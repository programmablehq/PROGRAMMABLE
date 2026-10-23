import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to see your allowance.", 401);
    return Response.json(await productionAIStore().usage(authority.owner), { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
