import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { encodeLaunchValue } from "@/lib/custom-ai/wallet";
import { advanceLaunch, createLaunchSession, dispatchLaunchStep, loadLaunch, saveLaunch } from "@/lib/custom-ai/launch.server";
import type { CoinSettings } from "@/lib/custom-ai/preview";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    const account = getAddress(new URL(request.url).searchParams.get("account") ?? "");
    if (!authority.principal.wallets.some(address => getAddress(address) === account)) throw new CustomAIError("wallet", "Reconnect the launch wallet.", 403);
    const store = productionAIStore();
    const id = await store.activeLaunch(authority.owner, account);
    const saved = id ? await loadLaunch(store, authority.owner, id) : null;
    return new Response(encodeLaunchValue(saved), { headers: { ...aiHeaders, "Content-Type": "application/json" } });
  } catch (error) { return aiError(error); }
}
export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    const input = await readPreviewBody(request) as { action: string; id: string; stepId?: string; hash?: string;
      account: string; draftId: string; imageId: string; settings: CoinSettings };
    if (!input || !/^[a-zA-Z0-9-]{16,64}$/.test(input.id) || !["create","next","retry","dispatch","submitted","rejected"].includes(input.action)) {
      throw new CustomAIError("input", "Invalid launch request.");
    }
    const store = productionAIStore();
    await store.consume(authority.owner, "launch", 360);
    let saved = input.action === "create"
      ? await createLaunchSession(store, authority.owner, authority.principal.wallets, input)
      : await loadLaunch(store, authority.owner, input.id);
    if (!authority.principal.wallets.some(address => getAddress(address) === saved.session.account)) {
      throw new CustomAIError("wallet", "Reconnect the wallet used for this launch.", 403);
    }
    if (input.action === "retry") {
      if (saved.session.state !== "failed" || saved.session.steps.at(-1)?.state !== "failed") throw new CustomAIError("step", "Check the saved transaction before trying again.", 409);
      saved.session.state = "preparing";
      saved = await saveLaunch(store, authority.owner, saved);
    }
    if (["create","next","retry"].includes(input.action)) saved = await advanceLaunch(store, authority.owner, saved);
    else if (input.action === "dispatch") saved = await dispatchLaunchStep(store, authority.owner, saved, input.stepId ?? "");
    else {
      const step = saved.session.steps.at(-1);
      if (!step || step.id !== input.stepId || !["dispatching","submitted"].includes(step.state)) throw new CustomAIError("step", "Refresh the saved launch before continuing.", 409);
      if (input.action === "submitted") {
        if (!/^0x[0-9a-f]{64}$/i.test(input.hash ?? "") || step.hash && step.hash.toLowerCase() !== input.hash?.toLowerCase()) throw new CustomAIError("hash", "The transaction hash differs from the saved launch.", 409);
        step.hash = input.hash!.toLowerCase() as `0x${string}`; step.state = "submitted";
      } else {
        if (step.hash || step.state !== "dispatching") throw new CustomAIError("sent", "This transaction was already sent. Check its status.", 409);
        // Only an explicit wallet rejection calls this route. Preserve the exact
        // nonce/request so retrying cannot spend the initial buy twice.
        step.state = "prepared"; step.walletRejected=true; saved.session.state = "ready";
      }
      saved = await saveLaunch(store, authority.owner, saved);
    }
    return new Response(encodeLaunchValue(saved), { headers: { ...aiHeaders, "Content-Type": "application/json" } });
  } catch (error) { return aiError(error); }
}
