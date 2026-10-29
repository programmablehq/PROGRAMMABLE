import "server-only";

import { get, put } from "@vercel/blob";
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
  chainId?: 1 | 4663 | 8453;
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
const path = (key: string) => `website-index/approved-presentation/v1/${key}.json`;
const token = () => process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
const cache = new Map<string, { expires: number; value: Promise<ApprovedLaunchPresentation | null> }>();

async function load(key: string): Promise<{ row: ApprovedLaunchPresentation | null; etag?: string }> {
  const credential = token();
  if (!credential) return { row: null };
  const result = await get(path(key), { token: credential, access: "private", useCache: false, headers: { "accept-encoding": "identity" }, abortSignal: AbortSignal.timeout(1500) });
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
    const prior = await load(key);
    if (prior.row && Date.parse(prior.row.approvedAt) >= Date.parse(row.approvedAt)) return;
    try {
      await put(path(key), JSON.stringify(row), { token: credential, access: "private", addRandomSuffix: false,
        contentType: "application/json", allowOverwrite: Boolean(prior.etag), ...(prior.etag ? { ifMatch: prior.etag } : {}), cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(5000) });
      cache.delete(key); return;
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
  const entries = await Promise.all(rows.map(async row => {
    const key = identityKey(row, row.chainId ?? chainId); if (!key) return null;
    let current = cache.get(key);
    if (!current || current.expires <= Date.now()) {
      const value = load(key).then(result => result.row).catch(() => null);
      current = { expires: Date.now() + 300_000, value }; cache.set(key,current);
      if (cache.size > 256) cache.delete(cache.keys().next().value!);
    }
    const metadata = await current.value;
    if (!metadata || metadata.routerLaunchId && !same(metadata.routerLaunchId, row.launchStampProvenance?.launchId ?? row.launchId ?? "")) return null;
    return [row.tokenAddress.toLowerCase(), { imageUrl: metadata.imageUrl, description: metadata.description, links: metadata.links }] as const;
  }));
  return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
