import "server-only";
import { getAddress } from "viem";
import { requireFreshCustomAIAuthority, type AIAuthority } from "./auth.server";
import type { createCustomAIBackendLaunchBridge } from "./backend-launch.server";
import type { GeneralPreparation } from "./general-preparation-store.server";
import { readGeneralLaunchStatus, type GeneralLaunchStatus } from "./general-preparation";
import { CustomAIError } from "./types";

/** Only compact, request-bound facts are shared, for two seconds at most. Each
 * caller still proves its own current Request/session and linked wallet. */
export function createGeneralLaunchStatusReader(deps: { bridge: () => Pick<ReturnType<typeof createCustomAIBackendLaunchBridge>, "status">; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const cacheClock = deps.now ?? (() => performance.now());
  const cache = new Map<string, { until: number; value?: GeneralLaunchStatus; pending?: Promise<GeneralLaunchStatus> }>();
  return async function read(request: Request, authority: AIAuthority, saved: GeneralPreparation) {
    saved = structuredClone(saved);
    const current = requireFreshCustomAIAuthority(request, authority), account = getAddress(saved.account);
    if (request.method !== "GET" || !current.principal.wallets.some(wallet => getAddress(wallet) === account))
      throw new CustomAIError("wallet", "Select the wallet that owns this saved submission.", 403);
    const resourceId = saved.submission?.state === "completed" ? saved.submission.resourceId : undefined;
    if (!resourceId || !saved.requestHash || saved.packState !== "complete" || saved.chainId === 4663 && !saved.requestSha256)
      throw new CustomAIError("launch-status", "Recover the original submission before checking its current status.", 409);
    const key = JSON.stringify([current.owner, account, saved.id, saved.chainId, resourceId, saved.requestHash, saved.requestSha256, saved.identity.deadline]);
    let entry = cache.get(key);
    if (entry && !entry.pending && entry.until <= cacheClock()) { cache.delete(key); entry = undefined; }
    if (!entry) {
      while (cache.size >= 128) {
        const oldest = [...cache].find(([, value]) => !value.pending);
        if (!oldest) throw new CustomAIError("launch-status-busy", "Status checks are busy. Your submission is saved.", 429, 2000);
        cache.delete(oldest[0]);
      }
      entry = { until: 0 }; cache.set(key, entry);
      const cell = entry;
      cell.pending = (async () => {
        const reply = await deps.bridge().status(request, authority, { chainId: saved.chainId, account, resourceId });
        let value: GeneralLaunchStatus;
        try { value = readGeneralLaunchStatus({ status: reply.value }, { account, chainId: saved.chainId, resourceId, requestHash: saved.requestHash!,
          ...(saved.chainId === 4663 ? { rawRequestSha256: saved.requestSha256! } : {}), deadline: saved.identity.deadline }); }
        catch { throw new CustomAIError("launch-status-binding", "The current launch status could not be confirmed. Your submission is saved.", 503); }
        if (reply.httpStatus !== 200 || reply.location !== null || Math.abs(now() - Date.parse(value.checkedAt)) > 30_000)
          throw new CustomAIError("launch-status-binding", "The current launch status could not be confirmed. Your submission is saved.", 503);
        cell.value = value; cell.until = cacheClock() + 2000; return value;
      })().catch(error => { if (cache.get(key) === cell) cache.delete(key); throw error; }).finally(() => { delete cell.pending; });
    }
    const value = entry.pending ? await entry.pending : entry.value!;
    requireFreshCustomAIAuthority(request, authority);
    if (Math.abs(now() - Date.parse(value.checkedAt)) > 30_000) {
      cache.delete(key); throw new CustomAIError("launch-status-binding", "Check the current status again. Your submission is saved.", 503);
    }
    if (!current.principal.wallets.some(wallet => getAddress(wallet) === account)) throw new CustomAIError("wallet", "Reconnect the original launch wallet.", 403);
    return structuredClone(value);
  };
}
