import { readCodexMarkets } from "./codex-market";
import { readCodexTokenMetadata } from "./codex-token-metadata";
import { coinImage, mergeCoinMetadata } from "@/lib/coin-metadata";
import "server-only";

import { unstable_cache } from "next/cache";
import type { RobinhoodMarketIdentity } from "./robinhood-market";
import { isRobinhoodModuleSourceKind, type RobinhoodLaunch } from "@/lib/robinhood-launches";
import { ROBINHOOD_MARKET_MAX_AGE_MS, type RobinhoodCoinMarket, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { PROGRAMMABLE_MAIN_TOKEN_PRESENTATION } from "@/lib/programmable-main-token-presentation";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { MODULE_DEFAULT_TOKEN_IMAGE } from "@/lib/module-mode/token-metadata";
import { readModuleTokenMetadata } from "@/lib/server/module-mode/token-presentation";
import { projectionPublicUrl } from "@/lib/custom-launch/launch-projection-v1";
import { projectLinkLabel } from "@/lib/project-link-label";
import { readApprovedLaunchPresentations } from "./approved-launch-presentation";
// @ts-expect-error -- the canonical launch package is ESM JavaScript.
import { hashProjectMetadata, validateProjectMetadata } from "@/packages/launch/src/project-metadata.mjs";

const FINALIZED_FEED = "https://api.programmable.market/v4/chains/4663/finalized-custom-launches";
const MAIN_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_METADATA_PAGES = 8;
const MAX_TOKENS = 50;
const MAX_MARKET_TOKENS = 10_000;
const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;

type JsonObject = Record<string, unknown>;
type Metadata = Pick<RobinhoodCoinPresentation, "imageUrl" | "description" | "links">;
type MetadataBinding = Readonly<{ launch: JsonObject; metadata: Metadata }>;
type MarketToken = RobinhoodMarketIdentity;
const IRL_DISPLAY_IDENTITY = Object.freeze({
  hook: "0xAb64c6Eb29a6bb8488cb1fcAB1ca11C5e28bC0cc",
  pool: "0x1848c9b63c7733c421b2db31bcb606ad75d505d281f7377dc170b082dbe989cb",
  creator: "0xfABeb55321cc90323cC6207902B2a2936B95ed05",
});
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left: unknown, right: unknown) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Operator-supplied artwork and links apply only to already indexed coin identities.
function displayOverride(token: RobinhoodLaunch): (Pick<Metadata, "imageUrl" | "links"> & Partial<Pick<Metadata, "description">>) | null {
  const address = token.tokenAddress.toLowerCase();
  // Owner-provided replacement for the submitted URL, which serves HTML.
  // Bind display data to the existing finalized launch; never create an identity.
  if (token.sourceKind === "custom-launch-plan-v1"
    && address === "0xf7a2f5554c57c216f1831aa5c8ed3c46727efe2b"
    && token.launchId === "d9c69c22-d242-4e24-97ad-e1d2cdf6c0f9"
    && same(token.hookAddress, IRL_DISPLAY_IDENTITY.hook)
    && same(token.poolId, IRL_DISPLAY_IDENTITY.pool)
    && same(token.creator, IRL_DISPLAY_IDENTITY.creator)) {
    return { imageUrl: "/token-images/irl.png", links: [
      { label: "Website", url: "https://irlprotocol.xyz/" },
      { label: "X", url: "https://x.com/IRL_Protocol" },
      { label: "Telegram", url: "https://t.me/InternetRobinhoodLottery" },
      { label: "GitHub", url: "https://github.com/math-crypt/lottery-robinhood" },
    ] };
  }
  if (token.sourceKind === "custom-launch-plan-v1"
    && address === "0x46d4dc5081c20da0872f387a1d2f10beaaf1be2f"
    && token.launchId === "2a1f2463-32e6-452c-b02e-8036ecbf0196"
    && same(token.hookAddress, "0x4964B2D2113f4Bee43C840118d1d7D6E239B60Cc")
    && same(token.poolId, "0x2bd95e3a43342dc11fda98f38e0c122dc470e9118e942aaa9c2572d0bc2e29b5")
    && same(token.creator, "0xF4b7818912C3480cD1D95010d718a87fdFc1408C")) {
    return {
      imageUrl: "https://eulerian.vercel.app/logo-mark.png",
      description: "Eulerian is the analytics layer for Programmable. It maps every Programmable coin on one live graph, linked by shared holders, with a health signal for each coin and a Wallet X-ray for any address. Buy and sell $EULR on its website or on Programmable.\n\nFixed supply and liquidity locked forever. Normal trades pay 3% in total: 2.7% to the project, which funds development and the upcoming Graph Vault, and 0.3% to Programmable.",
      links: [
        { label: "Website", url: "https://www.eulerianxyz.live" },
        { label: "X", url: "https://x.com/euleri_an" },
      ],
    };
  }
  try {
    const raw = process.env.ROBINHOOD_TOKEN_PRESENTATION_OVERRIDES_JSON;
    if (!raw || Buffer.byteLength(raw) > 65_536) return null;
    const entries: unknown = JSON.parse(raw);
    const value = object(entries) ? entries[address] : null;
    if (!object(value) || !Array.isArray(value.links) || value.links.length > 8) return null;
    const imageUrl = safePublicImageUrl(value.imageUrl);
    if (!imageUrl) return null;
    const links = value.links.flatMap(link => {
      if (!object(link) || typeof link.label !== "string" || !["Website", "X", "Discord", "Telegram", "GitHub", "GitBook"].includes(link.label)) return [];
      const url = projectionPublicUrl(link.url);
      return url ? [{ label: link.label, url }] : [];
    });
    return links.length === value.links.length ? { imageUrl, links } : null;
  } catch { return null; }
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  // Different token selections share the same public metadata pages. Cache
  // those pages together so per-token presentation misses cannot flood the API.
  const response = await fetch(url, {
    signal, redirect: "error", cache: "force-cache", next: { revalidate: 300 },
    credentials: "omit", headers: { accept: "application/json" },
  });
  if (!response.ok || response.redirected
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json"
    || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES
    || !response.body) throw new Error("Presentation source unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Presentation response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function projectImageUrl(value: string): string | null {
  // These are the same public gateways used by the existing finalized feed reader.
  // The canonical metadata validator has already checked the CID or transaction ID.
  const url = new URL(value);
  if (url.protocol === "ipfs:") return `https://ipfs.io/ipfs/${url.hostname}`;
  if (url.protocol === "ar:") return `https://arweave.net/${url.hostname}`;
  return safePublicImageUrl(value) ?? null;
}

function parseMetadata(launch: unknown): MetadataBinding | null {
  if (!object(launch) || launch.schemaVersion !== "programmable.finalized-custom-launch-metadata.v4"
    || launch.apiVersion !== "v4" || launch.chainId !== "4663" || launch.caip2 !== "eip155:4663"
    || launch.platformId !== "programmable" || launch.category !== "custom"
    || launch.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || !object(launch.onchain) || !object(launch.commitments)
    || !object(launch.sourceVerification) || launch.sourceVerification.status !== "exact_match"
    || !Array.isArray(launch.sourceVerification.components)
    || launch.sourceVerification.components.length === 0
    || !launch.sourceVerification.components.every((component) => object(component) && component.status === "exact_match")) return null;
  const onchain = launch.onchain;
  if (onchain.schemaVersion !== "programmable.custom-launch-onchain-evidence.v3"
    || onchain.chainId !== "4663" || onchain.caip2 !== "eip155:4663"
    || onchain.terminal !== true || onchain.checkpointType !== "ethereum_finalized"
    || !object(onchain.commitments) || !object(onchain.l2Inclusion)
    || !same(onchain.commitments.metadata, launch.commitments.metadata)) return null;
  try {
    const metadata = validateProjectMetadata(launch.projectMetadata, { requireComplete: true });
    if (hashProjectMetadata(metadata, { requireComplete: true }) !== launch.commitments.metadata) return null;
    const presentation = metadata.presentation as {
      description: string; image: { uri: string }; links: { kind: string; uri: string }[];
    };
    const labels: Record<string, string> = {
      website: "Website", x: "X", telegram: "Telegram", discord: "Discord",
      github: "GitHub", documentation: "Docs",
    };
    return { launch, metadata: {
      imageUrl: projectImageUrl(presentation.image.uri),
      description: presentation.description || null,
      links: presentation.links.flatMap(({ kind, uri }) => {
        const url = httpsUrl(uri);
        return url ? [{ label: labels[kind] ?? "Project link", url }] : [];
      }),
    } };
  } catch { return null; }
}

function metadataMatches(binding: MetadataBinding, token: RobinhoodLaunch): boolean {
  if (isRobinhoodModuleSourceKind(token.sourceKind)) return false;
  const launch = binding.launch;
  const onchain = launch.onchain as JsonObject;
  const l2 = onchain.l2Inclusion as JsonObject;
  const source = launch.sourceVerification as JsonObject;
  const metadata = launch.projectMetadata as JsonObject;
  const declaredToken = metadata.token as JsonObject;
  const components = source.components as JsonObject[];
  return same(onchain.router, token.routerAddress) && same(onchain.routerLaunchId, token.launchId)
    && same(onchain.transactionHash, token.transactionHash) && same(l2.transactionHash, token.transactionHash)
    && l2.chainId === "4663" && l2.caip2 === "eip155:4663" && l2.receiptStatus === "success"
    && l2.blockNumber === token.blockNumber && same(l2.blockHash, token.blockHash)
    && l2.launchEventLogIndex === token.logIndex
    && (token.name === null || declaredToken.name === token.name)
    && (token.symbol === null || declaredToken.symbol === token.symbol)
    && components.some((component) => same(component.address, token.tokenAddress))
    && components.some((component) => same(component.address, token.hookAddress));
}

async function readMetadata(tokens: readonly RobinhoodLaunch[]): Promise<Map<string, Metadata>> {
  const result = new Map<string, Metadata>();
  const seenLaunches = new Set<string>();
  const seenCursors = new Set<string>();
  const signal = AbortSignal.timeout(6_000);
  let cursor: string | null = null;
  let datasetCount: number | null = null;
  // This is optional artwork lookup, never launch discovery. An unmatched older
  // launch keeps its card when the bounded lookup or either provider fails.
  for (let page = 0; page < MAX_METADATA_PAGES; page++) {
    const url = new URL(FINALIZED_FEED);
    url.searchParams.set("limit", "25");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const value = await readJson(url.href, signal);
    if (!object(value) || value.schemaVersion !== "programmable.custom-launch-list.v4"
      || value.apiVersion !== "v4" || value.chainId !== "4663" || value.caip2 !== "eip155:4663"
      || !object(value.quality) || value.quality.status !== "ready"
      || !count(value.quality.publishedRowCount) || !count(value.quality.sourceRowCount)
      || value.quality.publishedRowCount !== value.quality.sourceRowCount
      || value.quality.quarantinedRowCount !== 0
      || !Array.isArray(value.launches) || value.launches.length > 25
      || value.launches.length > value.quality.publishedRowCount
      || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
      || Date.now() - Date.parse(value.generatedAt) > 300_000
      || Date.parse(value.generatedAt) - Date.now() > 60_000
      || !(value.nextCursor === null || (typeof value.nextCursor === "string"
        && value.nextCursor.length > 0 && value.nextCursor.length <= 2_048))) {
      throw new Error("Invalid finalized metadata feed");
    }
    if (datasetCount !== null && datasetCount !== value.quality.publishedRowCount) {
      throw new Error("Finalized metadata changed during pagination");
    }
    datasetCount = value.quality.publishedRowCount;
    for (const item of value.launches) {
      const binding = parseMetadata(item);
      if (!binding) continue;
      const onchain = binding.launch.onchain as JsonObject;
      const key = `${String(onchain.router).toLowerCase()}:${String(onchain.routerLaunchId).toLowerCase()}`;
      if (seenLaunches.has(key)) throw new Error("Duplicate finalized metadata");
      seenLaunches.add(key);
      const token = tokens.find((candidate) => metadataMatches(binding, candidate));
      if (token) result.set(token.tokenAddress.toLowerCase(), binding.metadata);
    }
    if (value.nextCursor === null || result.size === tokens.length) return result;
    cursor = value.nextCursor as string;
    if (seenCursors.has(cursor) || value.launches.length === 0) throw new Error("Invalid finalized metadata cursor");
    seenCursors.add(cursor);
  }
  return result;
}

// A new launch must not invalidate every older coin's artwork cache. Do not
// cache a transient RPC failure as an empty, verified presentation either.
const cachedModuleTokenMetadata = unstable_cache(async (token: RobinhoodLaunch) =>
  (await readModuleTokenMetadata([token], { failOnProviderError: true }))
    .get(token.tokenAddress.toLowerCase()) ?? null,
  ["robinhood-module-token-metadata-v2"], { revalidate: 3600 });

async function readCachedModuleMetadata(tokens: readonly RobinhoodLaunch[]): Promise<Map<string, Metadata>> {
  const metadata = new Map<string, Metadata>();
  for (let offset = 0; offset < tokens.length; offset += 8) {
    const batch = tokens.slice(offset, offset + 8);
    const results = await Promise.allSettled(batch.map(token => cachedModuleTokenMetadata(token)));
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        metadata.set(batch[index].tokenAddress.toLowerCase(), result.value);
      }
    });
  }
  return metadata;
}

export async function readRobinhoodMarkets(tokens: readonly MarketToken[], universe?: readonly MarketToken[]): Promise<Map<string, RobinhoodCoinMarket>> {
  if (tokens.length === 0) return new Map();
  if (tokens.length > MAX_MARKET_TOKENS || tokens.some((token) => !ADDRESS.test(token.tokenAddress) || (token.poolId !== null && !HASH.test(token.poolId)))) {
    throw new Error("Invalid market request");
  }
  const identities = tokens.flatMap((token) => token.poolId === null ? [] : [{ tokenAddress: token.tokenAddress.toLowerCase(), poolId: token.poolId.toLowerCase(),
    poolManager: token.poolManager, hookAddress: token.hookAddress, transactionHash: token.transactionHash,
    blockNumber: token.blockNumber, blockHash: token.blockHash }])
    .toSorted((a, b) => a.tokenAddress.localeCompare(b.tokenAddress));
  if (identities.length === 0) return new Map();
  const codex = universe
    ? await readCodexMarkets(identities, 4663, { universe: universe.flatMap(token => token.poolId === null ? [] : [{ tokenAddress: token.tokenAddress, poolId: token.poolId }]) })
    : await readCodexMarkets(identities);
  const now = Date.now();
  return new Map([...codex].filter(([, market]) => {
    const age = now - Date.parse(market.observedAt);
    return age >= 0 && age <= ROBINHOOD_MARKET_MAX_AGE_MS;
  }));
}

export async function readRobinhoodPresentations(tokens: readonly RobinhoodLaunch[], knownMarkets?: ReadonlyMap<string, RobinhoodCoinMarket>, knownMetadata?: ReadonlyMap<string, Metadata>): Promise<RobinhoodCoinPresentation[]> {
  if (tokens.length === 0) return [];
  if (tokens.length > MAX_TOKENS || tokens.some((token) => !ADDRESS.test(token.tokenAddress) || (token.poolId !== null && !HASH.test(token.poolId)))) {
    throw new Error("Invalid presentation request");
  }
  const ordered = tokens.toSorted((a, b) => a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase()));
  const marketRequest = knownMarkets ? Promise.resolve(knownMarkets) : readRobinhoodMarkets(tokens).catch(() => new Map<string, RobinhoodCoinMarket>());
  const approvedRequest = readApprovedLaunchPresentations(tokens,4663);
  const codexMetadata = knownMetadata ?? await readCodexTokenMetadata(ordered.map(token => token.tokenAddress), 4663);
  const custom = ordered.filter(token => {
    const details = codexMetadata.get(token.tokenAddress.toLowerCase());
    return !isRobinhoodModuleSourceKind(token.sourceKind) && !token.launchProjection && !displayOverride(token)
      && !(coinImage(details?.imageUrl) && details?.description && details.links.length);
  });
  const native = ordered.filter(token => isRobinhoodModuleSourceKind(token.sourceKind)
    && !coinImage(codexMetadata.get(token.tokenAddress.toLowerCase())?.imageUrl));
  const [metadata, moduleMetadata, markets, approved] = await Promise.allSettled([
    // Keep this outside unstable_cache, which disables the shared fetch cache.
    custom.length ? readMetadata(custom) : Promise.resolve(new Map<string, Metadata>()),
    native.length ? readCachedModuleMetadata(native) : Promise.resolve(new Map<string, Metadata>()),
    marketRequest,
    approvedRequest,
  ]);
  return tokens.map((token): RobinhoodCoinPresentation => {
    const key = token.tokenAddress.toLowerCase();
    const source = isRobinhoodModuleSourceKind(token.sourceKind) ? moduleMetadata : metadata;
    const publication = token.launchProjection?.publication;
    const published = token.launchProjection ? {
      imageUrl: projectionPublicUrl(publication?.imageUrl),
      description: typeof publication?.description === "string" ? publication.description.slice(0, 4096) : null,
      links: Array.isArray(publication?.links) ? publication.links.flatMap(link => { const url = projectionPublicUrl(link); return url ? [{ label: projectLinkLabel(url), url }] : []; }) : [],
    } : source.status === "fulfilled" ? source.value.get(key) : undefined;
    const presentation = mergeCoinMetadata(mergeCoinMetadata(published ?? { imageUrl: null, description: null, links: [] },
      approved.status === "fulfilled" ? approved.value.get(key) : null), codexMetadata.get(key));
    const main = key === MAIN_TOKEN;
    const override = displayOverride(token);
    const links = [...(override?.links ?? presentation?.links ?? [])];
    if (main) {
      const labels = { website: "Website", x: "X", github: "GitHub", discord: "Discord", gitbook: "GitBook" };
      for (const link of [...PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.links, ...PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.supplementalLinks]) {
        if (!links.some(existing => existing.label === labels[link.kind])) links.push({ label: labels[link.kind], url: link.url });
      }
    }
    return {
      tokenAddress: token.tokenAddress,
      imageUrl: override?.imageUrl ?? presentation?.imageUrl ?? (main ? PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.imageUrl : isRobinhoodModuleSourceKind(token.sourceKind) ? MODULE_DEFAULT_TOKEN_IMAGE : null),
      description: main ? PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.description : override?.description ?? presentation?.description ?? null,
      links,
      market: markets.status === "fulfilled" ? markets.value.get(key) ?? null : null,
    };
  });
}
