import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError, type ChatMessage } from "@/lib/custom-ai/types";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { ImageReceipt, StudioState } from "@/lib/custom-ai/studio";
import { safeKnowledgeSources } from "@/lib/custom-ai/knowledge";

export const runtime = "nodejs";
async function context(request: Request, accountValue: unknown) {
  const authority = await authorizeCustomAI(request);
  if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
  const account = getAddress(String(accountValue));
  if (!authority.principal.wallets.some(value => getAddress(value) === account)) throw new CustomAIError("wallet", "Reconnect the selected wallet.", 403);
  return { store: productionAIStore(), owner: authority.owner, id: createHash("sha256").update(account.toLowerCase()).digest("hex") };
}
export async function GET(request: Request) {
  try {
    const { store, owner, id } = await context(request, new URL(request.url).searchParams.get("account"));
    const saved = await store.readObject<StudioState>(owner, "studio", id);
    if (!saved) return Response.json(null, { headers: aiHeaders });
    const job = saved.value.draftId ? await store.read(owner, saved.value.draftId) : null;
    const latest = saved.value.contextId === saved.value.draftId ? job
      : saved.value.contextId ? await store.read(owner, saved.value.contextId) : null;
    return Response.json({ revision: saved.revision, state: saved.value, draft: job?.result?.draft,
      intent: latest?.result?.intent ?? job?.result?.intent }, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
export async function POST(request: Request) {
  try {
    const input = await readPreviewBody(request) as { account: string; revision: number; state: StudioState };
    const { store, owner, id } = await context(request, input.account);
    await store.consume(owner, "studio", 600);
    const raw = input.state;
    if (!raw || !Array.isArray(raw.messages) || raw.messages.length > 48 || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new CustomAIError("input", "This draft could not be saved.");
    const messages: ChatMessage[] = raw.messages.map(message => {
      if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 8000) throw new CustomAIError("input", "This conversation is too long to save.");
      const sources = safeKnowledgeSources(message.sources);
      return { role: message.role, content: message.content, ...(sources.length ? { sources } : {}) };
    });
    if (messages.reduce((sum, message) => sum + message.content.length, 0) > 48000) throw new CustomAIError("input", "This conversation is too long to save.");
    const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, parseCoinSetupPatch(raw.settings));
    if (raw.draftId && (typeof raw.draftId !== "string" || !(await store.read(owner, raw.draftId))?.result?.draft)) throw new CustomAIError("draft", "The saved hook could not be found.");
    if (raw.contextId && (typeof raw.contextId !== "string" || !(await store.read(owner, raw.contextId))?.result)) throw new CustomAIError("context", "The saved conversation could not be found.");
    if (raw.pendingChange !== undefined && (typeof raw.pendingChange !== "string" || raw.pendingChange.length > 8000)) throw new CustomAIError("input", "The pending change could not be saved.");
    const image = raw.image?.id ? (await store.readObject<ImageReceipt>(owner, "image", raw.image.id))?.value : undefined;
    if (raw.image && !image) throw new CustomAIError("image", "The saved image could not be found.");
    const state: StudioState = { settings, messages, ...(raw.draftId ? { draftId: raw.draftId } : {}), ...(image ? { image } : {}),
      ...(raw.contextId ? { contextId: raw.contextId } : {}), ...(raw.pendingChange ? { pendingChange: raw.pendingChange } : {}) };
    const revision = await store.saveObject(owner, "studio", id, state, input.revision);
    return Response.json({ revision }, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
