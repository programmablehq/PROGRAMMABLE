import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { prepareLaunch, type LaunchInputs } from "@/lib/custom-ai/launch-preparation.server";
import { CustomAIError } from "@/lib/custom-ai/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request, true);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to prepare this launch.", 401);
    const input = await readPreviewBody(request) as LaunchInputs;
    if (!authority.principal.wallets.some(wallet => wallet.toLowerCase() === input.account?.toLowerCase())) throw new CustomAIError("wallet", "Select a connected wallet.", 403);
    const store = productionAIStore(); await store.consume(authority.owner, "prepare", 30, 60000);
    return Response.json(await prepareLaunch(store, authority.owner, input), { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
