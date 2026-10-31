import { LEGACY_CONVERSATION, validConversationId } from "./conversation";
import type { StoredStudio } from "./studio";

export function scopedCacheKeys(scope: string, account: string, conversation = LEGACY_CONVERSATION) {
  if (!/^[a-f0-9]{64}$/.test(scope) || !/^0x[0-9a-f]{40}$/i.test(account) || !validConversationId(conversation)) throw Error("Reload your wallet session before opening chats.");
  const wallet = account.toLowerCase(), suffix = conversation === LEGACY_CONVERSATION ? "" : `:chat:${conversation}`;
  return { selected: `programmable.custom-ai.selected.v2:${scope}:${wallet}`,
    studio: `programmable.custom-ai.studio.v2:${scope}:${wallet}${suffix}`,
    legacyStudio: `programmable.custom-ai.studio.v1:${wallet}${suffix}` };
}

/** Revision numbers and matching wallets alone cannot identify the old cache's
 * principal. Migration requires an exact job reference in the owned response. */
export function canMigrateLegacyCache(value: unknown, server: StoredStudio | null): boolean {
  if (!value || typeof value !== "object" || !server) return false;
  const saved = value as { version?: number; draftId?: string; contextId?: string; retry?: { id?: string }; draft?: { sourceHash?: string }; image?: { id?: string; hash?: string } };
  if (saved.version !== 1) return false;
  const refs = [saved.draftId, saved.contextId, saved.retry?.id].filter((id): id is string => Boolean(id));
  if (!refs.length || refs.some(id => ![server.state.draftId, server.state.contextId, server.activeRequest?.id].includes(id))) return false;
  if (saved.draftId && saved.draftId !== server.state.draftId || saved.contextId && saved.contextId !== server.state.contextId) return false;
  if (saved.draft && saved.draft.sourceHash !== server.draft?.sourceHash) return false;
  if (saved.image && (saved.image.id !== server.state.image?.id || saved.image.hash !== server.state.image?.hash)) return false;
  return true;
}
