import { aiRequest, type AISessionHeaders } from "./client";
import type { StoredStudio, StudioState } from "./studio";

export type StudioBase = { revision: number; snapshot: string };
export class StudioConflictError extends Error {
  constructor(readonly server: StoredStudio | null) {
    super("Your online draft changed in another window. Your changes are still saved on this device.");
  }
}

// PostgreSQL JSONB may reorder keys. Compare the actual editable values.
export function studioSnapshot(state: StudioState) {
  const { settings, image } = state;
  return JSON.stringify([settings.name, settings.symbol, settings.chainId, settings.pairToken, settings.initialBuy,
    state.messages.map(message => [message.role, message.content, ...(message.sources?.length ? [message.sources] : [])]), state.draftId ?? null,
    image ? [image.id, image.url, image.hash] : null, state.contextId ?? null, state.pendingChange ?? null]);
}
export function studioBase(server: StoredStudio | null): StudioBase {
  return { revision: server?.revision ?? 0, snapshot: server ? studioSnapshot(server.state) : "" };
}
export function restoreStudio(local: StudioState | null, previous: StudioBase | undefined, server: StoredStudio | null) {
  const base = studioBase(server);
  const snapshot = local ? studioSnapshot(local) : "";
  const dirty = Boolean(local && snapshot !== base.snapshot && snapshot !== previous?.snapshot);
  const conflict = dirty && (previous
    ? previous.revision !== base.revision || previous.snapshot !== base.snapshot
    : server !== null);
  return { base, keepLocal: dirty, conflict };
}

function retryDelay(error: unknown, attempt: number): number | null {
  const { status, retryAfterMs } = (error ?? {}) as { status?: number; retryAfterMs?: number };
  if (status !== 408 && status !== 429 && !(status && status >= 500) && !(error instanceof TypeError)
    && !(error instanceof Error && error.message === "Wallet access is temporarily unavailable. Please try again.")) return null;
  return Math.max(status === 429 ? 30_000 : 1000 * 2 ** attempt, retryAfterMs || 0);
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Only draft reads/writes retry here. Wallet actions never use this path. */
export async function loadStudio(account: string, headers: AISessionHeaders, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try { return await aiRequest<StoredStudio | null>(`/studio?account=${account}`, headers, undefined, signal); }
    catch (error) {
      const delay = retryDelay(error, attempt);
      if (signal.aborted || delay === null || attempt >= 3) throw error;
      await wait(delay, signal);
    }
  }
}

export async function saveStudio(input: {
  account: string; headers: AISessionHeaders; state: StudioState; base: StudioBase;
  signal: AbortSignal; onRetry: () => void;
}): Promise<StudioBase> {
  const { account, headers, state, base, signal } = input;
  const snapshot = studioSnapshot(state);
  let reconcile = false;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      if (reconcile) {
        const server = await aiRequest<StoredStudio | null>(`/studio?account=${account}`, headers, undefined, signal);
        const current = studioBase(server);
        // A lost response is not a failed write. Never replay it blindly.
        if (current.snapshot === snapshot) return current;
        if (current.revision !== base.revision || current.snapshot !== base.snapshot) {
          throw new StudioConflictError(server);
        }
      }
      const saved = await aiRequest<{ revision: number }>("/studio", headers, { account, revision: base.revision, state }, signal);
      return { revision: saved.revision, snapshot };
    } catch (error) {
      if (signal.aborted) throw error;
      // A conflict can also mean the previous write succeeded without a reply.
      const status = (error as { status?: number } | null)?.status;
      const delay = status === 409 && !reconcile ? 0 : retryDelay(error, attempt);
      if (delay === null || attempt >= 3) throw error;
      reconcile = true;
      input.onRetry();
      await wait(delay, signal);
    }
  }
}
