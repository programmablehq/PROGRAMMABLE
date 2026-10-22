import { createPreviewBudget, readPreviewBody } from "@/lib/custom-ai/access.server";
import { runCustomAI } from "@/lib/custom-ai/service.server";
import { CustomAIError, parseChatRequest } from "@/lib/custom-ai/types";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";

export const runtime = "nodejs";
export const maxDuration = 480;
const budget = createPreviewBudget();

export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request, true);
    const input = parseChatRequest(await readPreviewBody(request));
    if (authority.kind === "preview") return Response.json(await budget(input, () => runCustomAI(input, request.signal)), { headers: aiHeaders });
    const store = productionAIStore();
    const reserved = await store.reserve(authority.owner, input);
    if (!reserved.lease) {
      if (reserved.job.state === "completed") return Response.json(reserved.job.result, { headers: aiHeaders });
      if (reserved.job.state === "failed") throw new CustomAIError("interrupted", "The previous request did not finish. Your earlier draft is still saved.", 409);
      return Response.json(reserved.job, { status: 202, headers: { ...aiHeaders, "Retry-After": "2" } });
    }
    try {
      const result = await runCustomAI(input, request.signal);
      await store.finish(authority.owner, input.id, reserved.lease, result);
      return Response.json(result, { headers: aiHeaders });
    } catch (error) {
      await store.finish(authority.owner, input.id, reserved.lease, undefined, error instanceof CustomAIError ? error.code : "unavailable");
      throw error;
    }
  } catch (error) { return aiError(error); }
}

export async function GET(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    const id = new URL(request.url).searchParams.get("id");
    const store = productionAIStore();
    const value = id ? await store.read(authority.owner, id) : await store.list(authority.owner);
    if (!value) throw new CustomAIError("missing", "This draft could not be found.", 404);
    return Response.json(value, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
