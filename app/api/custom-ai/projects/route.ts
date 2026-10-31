import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { validConversationId } from "@/lib/custom-ai/conversation";
import { jobMatchesConversation } from "@/lib/custom-ai/conversation.server";

export const runtime = "nodejs";

/** Complete source/artifacts are an explicit owned read, never part of normal
 * chat restoration or status polling. Failed builds keep their saved source. */
export async function GET(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to open saved source.", 401);
    const query = new URL(request.url).searchParams, id = query.get("id"), wallet = query.get("account"), conversation = query.get("conversation");
    if (!id || !/^[a-zA-Z0-9-]{16,64}$/.test(id) || !wallet || !/^0x[0-9a-f]{40}$/i.test(wallet) || !validConversationId(conversation)) throw new CustomAIError("project", "Choose the saved source from this chat.");
    const account = getAddress(wallet);
    if (!authority.principal.wallets.some(value => getAddress(value) === account)) throw new CustomAIError("wallet", "Select the wallet that owns this project.", 403);
    const store = productionAIStore();
    await store.consume(authority.owner, "project-source-read", 120);
    const job = await store.read(authority.owner, id);
    if (!job) throw new CustomAIError("missing", "That saved source was not found.", 404);
    if (!job.request?.conversation || !jobMatchesConversation(job.request, account, conversation.toLowerCase())) throw new CustomAIError("context", "That source belongs to another chat.", 409);
    const saved = await store.projects.read(authority.owner, id);
    if (!saved) throw new CustomAIError("missing", "Source has not been saved for this request yet.", 404);
    return Response.json(saved, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
