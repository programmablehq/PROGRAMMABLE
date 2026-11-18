import "server-only";

import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { get, list, put } from "@vercel/blob";
import { encodeAbiParameters, keccak256 } from "viem";
import { parseCustomLaunchReview } from "@/lib/custom-launch-review";
import type { CoinMetadata } from "@/lib/coin-metadata";
import { projectLinkLabel } from "@/lib/project-link-label";
import { publicLaunchMetadataHttpsUriV1 } from "./custom-launch/finalized-custom-launch-metadata-feed-v1";

const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const MAX_BYTES = 32_768;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type ApprovedPresentationIdentity = {
  chainId?: 1 | 4663 | 8453 | 999 | 99901;
  tokenAddress: string;
  hookAddress?: string | null;
  poolId?: string | null;
  creator?: string;
  creatorAddress?: string;
  launchId?: string;
  launchStampProvenance?: { launchId: string };
};
export type ApprovedLaunchPresentation = CoinMetadata & {
  version: 1; chainId: 1 | 4663; reviewId: string; subjectHash: string; approvedAt: string;
  tokenAddress: string; hookAddress: string; poolId: string; creator: string;
  routerLaunchId: string | null;
};

function displayText(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.length <= limit && !/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
    ? value.trim() || null : null;
}
function imageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{31,127})$/i.test(value)) return `https://ipfs.io/ipfs/${new URL(value).hostname}`;
  if (/^ar:\/\/[A-Za-z0-9_-]{43}$/.test(value)) return `https://arweave.net/${new URL(value).hostname}`;
  return publicLaunchMetadataHttpsUriV1(value);
}
function poolId(currency0: unknown, currency1: unknown, fee: unknown, tickSpacing: unknown, hooks: unknown) {
  if (typeof currency0 !== "string" || !ADDRESS.test(currency0) || typeof currency1 !== "string" || !ADDRESS.test(currency1)
    || BigInt(currency0) >= BigInt(currency1) || typeof hooks !== "string" || !ADDRESS.test(hooks)
    || typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || (fee > 1_000_000 && fee !== 8_388_608)
    || typeof tickSpacing !== "number" || !Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) return null;
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [currency0 as `0x${string}`, currency1 as `0x${string}`, fee, tickSpacing, hooks as `0x${string}`]));
}

/** Called only with a successful authenticated reviewer response. Nothing from a pending/rejected request is saved. */
export function approvedLaunchPresentationFromReview(value: unknown): ApprovedLaunchPresentation | null {
  try {
    const review = parseCustomLaunchReview(value);
    if (review.state !== "approved" || !review.approvedAt || review.supersededBy || !object(value) || !object(value.request)) return null;
    const request = value.request;
    let token: unknown, hook: unknown, pool: string | null = null, routerLaunchId: string | null = null;
    let presentation: ObjectValue;
    if (request.schemaVersion === "programmable.custom-launch-plan.v1") {
      if (String(request.chainId) !== review.chainId || !object(request.controller) || typeof request.controller.address !== "string" || !same(request.controller.address,review.controller)
        || !object(request.publication) || request.publication.visibility !== "listed"
        || !Array.isArray(request.components) || !Array.isArray(request.markets)) return null;
      presentation = request.publication;
      const components = request.components.filter(object);
      const market = request.markets.find(item => object(item) && item.marketId === presentation.primaryMarketId);
      token = components.find(item => item.componentId === presentation.primaryComponentId)?.expectedAddress;
      if (!object(market) || market.kind !== "uniswap_v4") return null;
      const resolve = (ref: unknown) => object(ref) ? ref.address ?? components.find(item => item.componentId === ref.componentId)?.expectedAddress : null;
      const currency0 = resolve(market.currency0), currency1 = resolve(market.currency1);
      hook = resolve(market.hooks);
      if (typeof token !== "string" || typeof currency0 !== "string" || typeof currency1 !== "string"
        || !same(token,currency0) && !same(token,currency1)) return null;
      pool = poolId(currency0, currency1, market.fee, market.tickSpacing, hook);
    } else {
      const result = object(value.technicalStatus) ? value.technicalStatus.result : null;
      const artifact = object(result) ? result.artifact : null;
      if (!object(artifact) || artifact.schemaVersion !== "programmable.prepared-custom-graph-launch.v1"
        || !object(artifact.chainBindings) || String(artifact.chainBindings.chainId) !== review.chainId
        || !object(artifact.stampRequest) || !object(artifact.stampRequest.poolKey)
        || !object(request.projectMetadata) || !object(request.projectMetadata.presentation)
        || artifact.projectMetadataHash !== request.projectMetadataHash) return null;
      presentation = request.projectMetadata.presentation;
      token = artifact.stampRequest.token;
      const key = artifact.stampRequest.poolKey;
      hook = key.hooks;
      if (typeof token !== "string" || typeof key.currency0 !== "string" || typeof key.currency1 !== "string"
        || !same(token,key.currency0) && !same(token,key.currency1)) return null;
      pool = poolId(key.currency0, key.currency1, key.fee, key.tickSpacing, hook);
      routerLaunchId = typeof artifact.stampRequest.launchId === "string" && HASH.test(artifact.stampRequest.launchId) ? artifact.stampRequest.launchId : null;
      if (!routerLaunchId) return null;
    }
    if (typeof token !== "string" || !ADDRESS.test(token) || typeof hook !== "string" || !ADDRESS.test(hook) || !pool) return null;
    const links = Array.isArray(presentation.links) ? presentation.links.slice(0,32).flatMap(item => {
      const href = publicLaunchMetadataHttpsUriV1(typeof item === "string" ? item : object(item) ? item.uri : null);
      return href ? [{ label: object(item) && typeof item.kind === "string" ? item.kind : projectLinkLabel(href), url: href }] : [];
    }) : [];
    const image = object(presentation.image) ? presentation.image.uri : presentation.imageUrl;
    return { version: 1, chainId: Number(review.chainId) as 1 | 4663, reviewId: review.reviewId,
      subjectHash: review.subjectHash, approvedAt: review.approvedAt,
      tokenAddress: token.toLowerCase(), hookAddress: hook.toLowerCase(), poolId: pool.toLowerCase(), creator: review.controller.toLowerCase(),
      routerLaunchId: routerLaunchId?.toLowerCase() ?? null,
      imageUrl: imageUrl(image), description: displayText(presentation.description,4096), links };
  } catch { return null; }
}

function identityKey(row: ApprovedPresentationIdentity, chainId = row.chainId) {
  const creator = row.creator ?? row.creatorAddress;
  if (![1,4663].includes(chainId ?? 0) || !ADDRESS.test(row.tokenAddress) || !ADDRESS.test(row.hookAddress ?? "")
    || !HASH.test(row.poolId ?? "") || !ADDRESS.test(creator ?? "")) return null;
  return `${chainId}/${row.tokenAddress.toLowerCase()}-${row.hookAddress!.toLowerCase()}-${row.poolId!.toLowerCase()}-${creator!.toLowerCase()}`;
}
const directoryRoot = "website-index/approved-presentation/v1/";
const path = (key: string) => `${directoryRoot}${key}.json`;
const token = () => process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
const storeKey = (credential: string) => createHash("sha256").update(credential).digest("hex");
const presentationTag = (key: string) => `approved-presentation:${createHash("sha256").update(key).digest("hex")}`;
const directoryTag = (chain: number) => `approved-presentation-directory:${chain}`;
const recordReads = new Map<string, Promise<ApprovedLaunchPresentation | null>>();
const directoryReads = new Map<string, Promise<string[] | null>>();
const displayBudgetMs = 1_500;
const originBudgetMs = 5_000;

function withinPresentationBudget<T>(work: Promise<T>, waitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException("Presentation read expired", "TimeoutError")), waitMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// Next can start simultaneous background refreshes for the same key in different requests.
function shareOriginRead<T>(pending: Map<string, Promise<T>>, id: string, read: () => Promise<T>): Promise<T> {
  const previous = pending.get(id);
  if (previous) return previous;
  const work = withinPresentationBudget(read(), originBudgetMs).finally(() => { if (pending.get(id) === work) pending.delete(id); });
  if (pending.size < 256) pending.set(id, work);
  return work;
}

function loadPublicPresentation(key: string, credential: string, store: string) {
  return unstable_cache(() => shareOriginRead(recordReads, `${store}:${key}`, async () => (await load(key, credential, originBudgetMs)).row),
    ["approved-public-presentation-v2", store, key],
    { revalidate: 300, tags: [presentationTag(key)] })();
}

async function listedPresentations(chain: number, credential: string, store: string): Promise<Set<string> | null> {
  const prefix = `${directoryRoot}${chain}/`;
  const paths = await unstable_cache(() => shareOriginRead(directoryReads, `${store}:${chain}`, async () => {
    const page = await list({ prefix, limit: 256, token: credential, abortSignal: AbortSignal.timeout(displayBudgetMs) });
    if (page.hasMore !== false || !page.blobs.every(blob => blob.pathname.startsWith(prefix))) return null;
    return page.blobs.map(blob => blob.pathname);
  }), ["approved-presentation-directory-v1", store, String(chain)], { revalidate: 300, tags: [directoryTag(chain)] })();
  return paths && new Set(paths);
}

async function load(key: string, credential: string, timeoutMs: number): Promise<{ row: ApprovedLaunchPresentation | null; etag?: string }> {
  const result = await get(path(key), { token: credential, access: "private", useCache: false, headers: { "accept-encoding": "identity" }, abortSignal: AbortSignal.timeout(timeoutMs) });
  if (!result) return { row: null };
  if (result.statusCode !== 200 || !result.stream) throw new Error("Presentation unavailable");
  const reader = result.stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break;
      length += part.value.length; if (length > MAX_BYTES) throw new Error("Presentation too large"); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => undefined); }
  const row = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ApprovedLaunchPresentation;
  if (row.version !== 1 || identityKey(row) !== key || !/^sha256:[0-9a-f]{64}$/.test(row.subjectHash)
    || !Number.isFinite(Date.parse(row.approvedAt)) || !Array.isArray(row.links) || row.links.length > 32
    || row.links.some(link => !displayText(link.label,64) || publicLaunchMetadataHttpsUriV1(link.url) !== link.url)
    || (row.imageUrl !== null && imageUrl(row.imageUrl) !== row.imageUrl)
    || (row.description !== null && displayText(row.description,4096) !== row.description)
    || (row.routerLaunchId !== null && !HASH.test(row.routerLaunchId))) throw new Error("Invalid presentation");
  const etag = result.blob.etag.trim();
  if (!/^"[\da-f]{32}"$/i.test(etag)) throw new Error("Invalid presentation version");
  return { row, etag };
}

/** A private display cache, never a launch, approval, routing or claim record. */
export async function rememberApprovedLaunchPresentation(review: unknown) {
  const row = approvedLaunchPresentationFromReview(review), credential = token();
  if (!row || !credential) return;
  const key = identityKey(row)!;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prior = await load(key, credential, displayBudgetMs);
    if (prior.row && Date.parse(prior.row.approvedAt) >= Date.parse(row.approvedAt)) return;
    try {
      await put(path(key), JSON.stringify(row), { token: credential, access: "private", addRandomSuffix: false,
        contentType: "application/json", allowOverwrite: Boolean(prior.etag), ...(prior.etag ? { ifMatch: prior.etag } : {}), cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(5000) });
      const store = storeKey(credential);
      recordReads.delete(`${store}:${key}`);
      directoryReads.delete(`${store}:${row.chainId}`);
      revalidateTag(presentationTag(key), { expire: 0 });
      revalidateTag(directoryTag(row.chainId), { expire: 0 });
      return;
    } catch (error) { if (attempt === 1) throw error; }
  }
}

/** The owner page can finish caching a V3 image once preparation supplies its exact addresses. */
export async function rememberApprovedLaunchResource(resource: unknown) {
  if (!object(resource) || resource.schemaVersion !== "programmable.custom-launch.v3" || !object(resource.manualReview)
    || typeof resource.ownerWallet !== "string" || typeof resource.manualReview.controller !== "string"
    || !same(resource.ownerWallet,resource.manualReview.controller)) return;
  await rememberApprovedLaunchPresentation({ ...resource.manualReview,
    request: { projectMetadata: resource.projectMetadata, projectMetadataHash: resource.projectMetadataHash },
    technicalStatus: { result: resource.output } });
}

/** Callers must supply a receipt-backed/canonical identity; lookup data cannot add a coin to the index. */
export async function readApprovedLaunchPresentations(rows: readonly ApprovedPresentationIdentity[], chainId?: 1 | 4663): Promise<Map<string, CoinMetadata>> {
  if (rows.length > 50) throw new Error("Too many presentation identities");
  const credential = token();
  if (!credential) return new Map();
  const store = storeKey(credential);
  const requests = rows.flatMap(row => {
    const chain = row.chainId ?? chainId;
    if (chain !== 1 && chain !== 4663) return [];
    const key = identityKey(row, chain);
    return key ? [{ row, chain, key }] : [];
  });
  const directories = new Map<number, Promise<Set<string> | null>>();
  for (const chain of [1, 4663]) {
    // Six is the smallest Explore page. Token detail stays a single exact read.
    if (requests.filter(request => request.chain === chain).length >= 6) {
      directories.set(chain, listedPresentations(chain, credential, store).catch(() => null));
    }
  }
  const entries: Array<readonly [string, CoinMetadata] | undefined> = [];
  const fillBudgetMs = displayBudgetMs + originBudgetMs;
  const fillDeadline = Date.now() + fillBudgetMs;
  const work = Promise.all(requests.map(async ({ row, chain, key }, index) => {
    const directory = await directories.get(chain);
    if (Date.now() >= fillDeadline || (directory && !directory.has(path(key)))) return;
    const metadata = await loadPublicPresentation(key, credential, store).catch(() => null);
    if (!metadata || metadata.routerLaunchId && !same(metadata.routerLaunchId, row.launchStampProvenance?.launchId ?? row.launchId ?? "")) return;
    entries[index] = [row.tokenAddress.toLowerCase(), { imageUrl: metadata.imageUrl, description: metadata.description, links: metadata.links }];
  }));

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const finished = await Promise.race([work.then(() => true), new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), displayBudgetMs);
    })]);
    if (!finished) {
      // The framework cache can stall outside the Blob client's own timeout.
      try {
        after(async () => {
          try { await withinPresentationBudget(work, Math.max(0, fillDeadline - Date.now())); }
          catch { console.warn("Approved presentation cache fill exceeded its deadline", { count: requests.length }); }
        });
      } catch { /* Standalone readers have no request lifecycle. */ }
    }
  } finally { clearTimeout(timer); }
  return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined));
}
