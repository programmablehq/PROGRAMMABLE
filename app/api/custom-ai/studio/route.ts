import { LEGACY_CONVERSATION } from "@/lib/custom-ai/conversation";
import { conversationStorageId, jobMatchesConversation } from "@/lib/custom-ai/conversation.server";
import type { Conversation } from "@/lib/custom-ai/conversation";
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
async function context(request: Request, accountValue: unknown, conversationValue: unknown) {
  const authority = await authorizeCustomAI(request, false, request.method === "POST");
  if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
  if(typeof accountValue!=="string"||!/^0x[0-9a-f]{40}$/i.test(accountValue))throw new CustomAIError("wallet","Select your connected wallet.");
  const account = getAddress(accountValue);
  if (!authority.principal.wallets.some(value => getAddress(value) === account)) throw new CustomAIError("wallet", "Reconnect the selected wallet.", 403);
  if(conversationValue!==undefined&&typeof conversationValue!=="string")throw new CustomAIError("conversation","Choose a saved chat.");
  const chatId = typeof conversationValue === "string" ? conversationValue : LEGACY_CONVERSATION;
  return { store: productionAIStore(), owner: authority.owner, account, chatId, id: conversationStorageId(account,chatId) };
}
export async function GET(request: Request) {
  try {
    const query=new URL(request.url).searchParams;
    const { store, owner, id } = await context(request, query.get("account"), query.get("conversation")??undefined);
    const saved = await store.readObject<StudioState>(owner, "studio", id);
    if (!saved) return Response.json(null, { headers: aiHeaders });
    const job = saved.value.draftId ? await store.read(owner, saved.value.draftId) : null;
    const latest = saved.value.contextId === saved.value.draftId ? job
      : saved.value.contextId ? await store.read(owner, saved.value.contextId) : null;
    const meta=(await store.readObject<Conversation>(owner,"conversation",id))?.value;
    const active=meta?.activeRequest&&saved.value.contextId!==meta.activeRequest?await store.read(owner,meta.activeRequest):null;
    return Response.json({ revision: saved.revision, state: saved.value, ...(active?.request&&active.state!=="failed"?{activeRequest:active.request}:{}), draft: job?.result?.draft,
      intent: latest?.result?.intent ?? job?.result?.intent }, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
export async function POST(request: Request) {
  try {
    const input = await readPreviewBody(request) as { account: string; conversationId?: string; revision: number; state: StudioState };
    if(!input||typeof input!=="object")throw new CustomAIError("input","Choose a saved draft.");
    const { store, owner, id, account, chatId } = await context(request, input.account,input.conversationId);
    await store.consume(owner, "studio", 600);
    if(input.conversationId && !await store.readObject(owner,"conversation",id)) throw new CustomAIError("missing","That chat was not found.",404);
    const raw = input.state;
    if (!raw || !Array.isArray(raw.messages) || raw.messages.length > 48 || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new CustomAIError("input", "This draft could not be saved.");
    const messages: ChatMessage[] = raw.messages.map(message => {
      if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 8000) throw new CustomAIError("input", "This conversation is too long to save.");
      const sources = safeKnowledgeSources(message.sources);
      return { role: message.role, content: message.content, ...(sources.length ? { sources } : {}) };
    });
    if (messages.reduce((sum, message) => sum + message.content.length, 0) > 48000) throw new CustomAIError("input", "This conversation is too long to save.");
    const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, parseCoinSetupPatch(raw.settings));
    if (raw.pendingChange !== undefined && (typeof raw.pendingChange !== "string" || raw.pendingChange.length > 8000)) throw new CustomAIError("input", "The pending change could not be saved.");
    if(raw.input!==undefined&&(typeof raw.input!=="string"||raw.input.length>8000))throw new CustomAIError("input","The unsent message could not be saved.");
    if(raw.editTarget&&(!raw.draftId||!/^([a-f0-9]{64})$/i.test(raw.editTarget.sourceHash)||!/^([a-z][a-z0-9-]{0,63})$/.test(raw.editTarget.requirementId)))throw new CustomAIError("edit","Choose a saved rule.");
    for(const contextId of new Set([raw.draftId,raw.contextId].filter((value):value is string=>Boolean(value)))){
      if(typeof contextId!=="string"||!/^([a-zA-Z0-9-]{16,64})$/.test(contextId))throw new CustomAIError("context","Choose a saved design.");
      const job=await store.read(owner,contextId);
      if(!job?.result||contextId===raw.draftId&&!job.result.draft)throw new CustomAIError("draft","The saved design could not be found.");
      if(!jobMatchesConversation(job.request,account,chatId))throw new CustomAIError("context","That design belongs to another chat.",409);
    }
    const image = raw.image?.id ? (await store.readObject<ImageReceipt>(owner, "image", raw.image.id))?.value : undefined;
    if (raw.image && !image) throw new CustomAIError("image", "The saved image could not be found.");
    const state: StudioState = { settings, messages, ...(raw.draftId ? { draftId: raw.draftId } : {}), ...(image ? { image } : {}),
      ...(raw.contextId ? { contextId: raw.contextId } : {}), ...(raw.pendingChange ? { pendingChange: raw.pendingChange } : {}), ...(raw.input ? { input:raw.input } : {}), ...(raw.editTarget ? { editTarget:{sourceHash:raw.editTarget.sourceHash,requirementId:raw.editTarget.requirementId} } : {}) };
    const revision = await store.saveObject(owner, "studio", id, state, input.revision);
    return Response.json({ revision }, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
