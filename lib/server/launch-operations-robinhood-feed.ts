import "server-only";
import { get, put } from "@vercel/blob";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { isDiscoverableRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { parseLaunchProjectionV1, projectionToRobinhoodLaunch } from "@/lib/custom-launch/launch-projection-v1";
import type { OperationsLaunch, ObservationStatus } from "@/lib/launch-operations";
import { launchProjectionSourceV1, type LaunchProjectionSourceV1 } from "./robinhood-index/launch-projection-source";

const path = "website-index/operations/robinhood-finalized-v1.json";
const maxBytes = 8 * 1024 * 1024, maxRows = 10_000;
export type OperationsFeedState = {
  version: 1; updatedAt: string; completedAt: string | null; nextCursor: string | null;
  rows: OperationsLaunch[]; pendingRows: OperationsLaunch[]; cursors: string[]; failed: boolean;
};
export type OperationsFeedStore = {
  read(): Promise<{ state: OperationsFeedState; etag: string } | null>;
  write(state: OperationsFeedState, etag: string | null): Promise<void>;
};
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const cursor = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
const address = (value: unknown) => typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value);
const hash = (value: unknown) => typeof value === "string" && /^0x[\da-f]{64}$/iu.test(value);
function parseState(value: unknown): OperationsFeedState {
  const v = value as OperationsFeedState | null;
  const validRows = (rows: unknown): rows is OperationsLaunch[] => Array.isArray(rows) && rows.length <= maxRows
    && rows.every(r => r && r.chainId === 4663 && address(r.token) && typeof r.launchId === "string" && r.launchId.length > 0 && r.launchId.length <= 256
      && r.mode === "custom" && r.stamp === "recorded" && typeof r.listed === "boolean"
      && typeof r.name === "string" && r.name.length <= 4096 && typeof r.symbol === "string" && r.symbol.length <= 4096
      && (r.transactionHash === null || hash(r.transactionHash)) && (r.observedAt === null || date(r.observedAt))
      && (r.subjectHash === undefined || /^sha256:[\da-f]{64}$/u.test(r.subjectHash)))
    && new Set(rows.map(r => r.launchId)).size === rows.length;
  if (!v || v.version !== 1 || !date(v.updatedAt) || !(v.completedAt === null || date(v.completedAt) && Date.parse(v.completedAt) <= Date.parse(v.updatedAt))
    || !(v.nextCursor === null || cursor(v.nextCursor)) || typeof v.failed !== "boolean" || !validRows(v.rows) || !validRows(v.pendingRows)
    || !Array.isArray(v.cursors) || v.cursors.length > maxRows || !v.cursors.every(cursor) || new Set(v.cursors).size !== v.cursors.length
    || (v.nextCursor !== null && !v.cursors.includes(v.nextCursor))) throw new Error("Invalid operations feed checkpoint");
  return v;
}
function feedStore(): OperationsFeedStore {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Operations feed storage unavailable");
  return {
    async read() {
      const result = await get(path, { token, access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error("Operations feed read failed");
      const reader = result.stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > maxBytes) throw new Error("Operations feed size exceeded"); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const etag = result.blob.etag.trim();
      if (!/^"[\da-f]{32}"$/iu.test(etag)) throw new Error("Invalid operations feed version");
      return { state: parseState(JSON.parse(Buffer.concat(chunks).toString("utf8"))), etag };
    },
    async write(state, etag) {
      const body = JSON.stringify(parseState(state));
      if (Buffer.byteLength(body) > maxBytes) throw new Error("Operations feed size exceeded");
      await put(path, body, { token, access: "private", contentType: "application/json", addRandomSuffix: false,
        allowOverwrite: etag !== null, ...(etag ? { ifMatch: etag } : {}), cacheControlMaxAge: 60 });
    },
  };
}
function observation(state: OperationsFeedState, now: number) {
  const rows = [...new Map([...state.rows, ...state.pendingRows].map(row => [row.launchId, row])).values()];
  const complete = !state.failed && state.completedAt !== null && now - Date.parse(state.completedAt) <= 300_000;
  const status: ObservationStatus = complete ? "ready" : state.completedAt ? "stale" : state.failed && !rows.length ? "unavailable" : "partial";
  return { rows, status, complete, updatedAt: state.completedAt ?? state.updatedAt };
}

/** Persist independent API observations, not website-index membership. Bounded batches resume
 * across requests and instances; a new pass retains the last complete pass until it finishes. */
export async function readRobinhoodOperationsFeed(input: {
  store?: OperationsFeedStore; source?: Pick<LaunchProjectionSourceV1, "page">; now?: () => number; maxPages?: number;
} = {}) {
  const store = input.store ?? feedStore(), now = input.now ?? Date.now;
  const saved = await store.read();
  const previous: OperationsFeedState = saved?.state ?? { version: 1, updatedAt: new Date(0).toISOString(), completedAt: null,
    nextCursor: null, rows: [], pendingRows: [], cursors: [], failed: false };
  if (saved && now() - Date.parse(previous.updatedAt) < 10_000) return observation(previous, now());
  const state = structuredClone(previous);
  const pending = new Map(state.pendingRows.map(row => [row.launchId, row]));
  const source = input.source ?? launchProjectionSourceV1(AbortSignal.timeout(6_000));
  const started = now(); let completedPages = 0; state.failed = false;
  try {
    for (let page = 0; page < (input.maxPages ?? 100) && now() - started < 6_000; page++) {
      const data = await source.page(state.nextCursor);
      if (data.nextCursor !== null && (!cursor(data.nextCursor) || state.cursors.includes(data.nextCursor))) throw new Error("Repeated feed cursor");
      const batch = data.launches.map(value => {
        const projection = parseLaunchProjectionV1(value);
        if (projection.chainId !== "4663" || projection.finality.status !== "final") throw new Error("Invalid finalized feed");
        const row = projectionToRobinhoodLaunch(projection, projection.finalizedAt);
        const result: OperationsLaunch = { chainId: 4663, token: row.tokenAddress,
          name: row.name || `${row.tokenAddress.slice(0, 8)}…${row.tokenAddress.slice(-4)}`, symbol: row.symbol || "",
          mode: "custom", launchId: projection.launchId, subjectHash: projection.planHash ?? undefined,
          transactionHash: row.transactionHash, observedAt: projection.finalizedAt, stamp: "recorded",
          listed: projection.publication?.visibility !== "unlisted" && isPublicExploreIdentityV1(row, 4663) && isDiscoverableRobinhoodToken(row.tokenAddress) };
        const old = pending.get(result.launchId) ?? state.rows.find(row => row.launchId === result.launchId);
        if (old && (old.token.toLowerCase() !== result.token.toLowerCase() || old.transactionHash !== result.transactionHash)) throw new Error("Finalized launch identity changed");
        return result;
      });
      if (pending.size + batch.filter(row => !pending.has(row.launchId)).length > maxRows || state.cursors.length >= maxRows) throw new Error("Operations feed bounds exceeded");
      for (const row of batch) pending.set(row.launchId, row);
      completedPages++;
      state.nextCursor = data.nextCursor;
      if (data.nextCursor === null) {
        state.rows = [...pending.values()]; pending.clear(); state.cursors = []; state.completedAt = new Date(now()).toISOString(); break;
      }
      state.cursors.push(data.nextCursor);
    }
  } catch { state.failed = completedPages === 0 || now() - started < 6_000; }
  state.pendingRows = [...pending.values()]; state.updatedAt = new Date(now()).toISOString();
  try { await store.write(state, saved?.etag ?? null); }
  catch {
    // A concurrent writer may have advanced the checkpoint. Never overwrite that progress.
    const winner = await store.read().catch(() => null);
    return observation(winner?.state ?? { ...previous, failed: true }, now());
  }
  return observation(state, now());
}
