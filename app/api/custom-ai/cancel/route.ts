import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request, true);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to cancel this request.", 401);
    const input = await readPreviewBody(request) as { id?: unknown };
    if (typeof input.id !== "string") throw new CustomAIError("input", "Choose a saved request.");
    const job = await productionAIStore().cancel(authority.owner, input.id);
    if (!job) throw new CustomAIError("missing", "The saved request was not found.", 404);
    return Response.json(job, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
