import "server-only";
import { unstable_cache } from "next/cache";
import { codexQuery } from "./codex-market";
import { marketAddress, marketObject } from "@/lib/market/codex";
import { coinImage, type CoinMetadata } from "@/lib/coin-metadata";
import { projectionPublicUrl } from "@/lib/custom-launch/launch-projection-v1";

const query = `query TokenMetadata($ids:[TokenInput!]!) {
  tokens(ids:$ids) { address networkId name symbol info { imageLargeUrl imageSmallUrl imageThumbUrl description }
    socialLinks { website twitter telegram discord github whitepaper } }
}`;

export type CodexTokenMetadata = CoinMetadata & { name: string | null; symbol: string | null };
const tokenText = (value: unknown, limit: number): string | null => typeof value === "string"
  && value.trim().length > 0 && value.length <= limit && !/[\p{Cc}\p{Cf}]/u.test(value) ? value.trim() : null;

const METADATA_TTL_MS = 21_600_000;
const MISSING_METADATA_TTL_MS = 900_000;
type MetadataRead = Promise<CodexTokenMetadata | undefined>;
const observations = new Map<string, { expiresAt: number; metadata?: CodexTokenMetadata }>();
const pending = new Map<string, MetadataRead>();
const identity = (address: string, chainId: number) => `${chainId}:${address}`;
const copy = (value: CodexTokenMetadata): CodexTokenMetadata => ({ ...value, links: value.links.map(link => ({ ...link })) });

async function fetchMetadata(addresses: string[], chainId: 1 | 4663) {
  const data = await codexQuery(query, { ids: addresses.map(address => ({ address, networkId: chainId })) });
  if (!Array.isArray(data.tokens) || data.tokens.length > addresses.length) throw new Error("Token metadata unavailable");
  const result: [string, CodexTokenMetadata][] = [];
  const seen = new Set<string>();
  for (const token of data.tokens) {
    if (token === null) continue;
    if (!marketObject(token) || token.networkId !== chainId || typeof token.address !== "string") throw new Error("Token metadata identity differs");
    const address = token.address.toLowerCase();
    if (!addresses.includes(address) || seen.has(address)) throw new Error("Token metadata identity differs");
    seen.add(address);
    const info = marketObject(token.info) ? token.info : {};
    const social = marketObject(token.socialLinks) ? token.socialLinks : {};
    const imageUrl = [info.imageLargeUrl, info.imageSmallUrl, info.imageThumbUrl]
      .flatMap(value => typeof value === "string" && coinImage(value) ? [coinImage(value)!] : [])[0] ?? null;
    const description = typeof info.description === "string" && info.description.length <= 4096
      && !/[\p{Cc}\p{Cf}]/u.test(info.description.replace(/[\n\r\t]/g, "")) ? info.description.trim() || null : null;
    const links = Object.entries({ website: "Website", twitter: "X", telegram: "Telegram", discord: "Discord", github: "GitHub", whitepaper: "Docs" }).flatMap(([field, label]) => {
      const url = projectionPublicUrl(social[field]);
      return url ? [{ label, url }] : [];
    });
    result.push([address, { name: tokenText(token.name, 128), symbol: tokenText(token.symbol, 32), imageUrl, description, links }]);
  }
  return { entries: result, observedAt: Date.now() };
}

const cachedMetadata = unstable_cache(fetchMetadata,
  ["codex-coin-metadata-v3"], { revalidate: MISSING_METADATA_TTL_MS / 1_000 });

class IncompleteMetadata extends Error {
  constructor(readonly observation: Awaited<ReturnType<typeof fetchMetadata>>) {
    super("Token metadata is not complete yet");
  }
}

// Persist complete artwork/social batches across server instances, not just
// inside the process-local map. Missing tokens still get the short retry window.
const cachedCompleteMetadata = unstable_cache(async (addresses: string[], chainId: 1 | 4663) => {
  let observation = await cachedMetadata(addresses, chainId);
  // A stale-while-revalidate hit from the short cache must not be pinned for
  // another six hours by the outer cache.
  if (Date.now() - observation.observedAt >= MISSING_METADATA_TTL_MS) observation = await fetchMetadata(addresses, chainId);
  if (observation.entries.length !== addresses.length) throw new IncompleteMetadata(observation);
  return observation;
}, ["codex-complete-coin-metadata-v1"], { revalidate: METADATA_TTL_MS / 1_000 });

async function readMetadata(addresses: string[], chainId: 1 | 4663) {
  try { return await cachedCompleteMetadata(addresses, chainId); }
  catch (error) {
    if (error instanceof IncompleteMetadata) return error.observation;
    throw error;
  }
}

/** Display-only enrichment of known identities, independent of price refreshes. */
export async function readCodexTokenMetadata(addresses: readonly string[], chainId: 1 | 4663): Promise<Map<string, CodexTokenMetadata>> {
  if (![1, 4663].includes(chainId) || addresses.length > 1000 || addresses.some(address => !marketAddress.test(address))) throw new Error("Invalid token metadata request");
  if (!process.env.CODEX_API_KEY?.trim() || !addresses.length) return new Map();
  const ordered = [...new Set(addresses.map(address => address.toLowerCase()))].sort();
  const result = new Map<string, CodexTokenMetadata>();
  const reads = new Map<string, MetadataRead>();
  for (const address of ordered) {
    const key = identity(address, chainId), saved = observations.get(key);
    if (saved && saved.expiresAt > Date.now()) {
      if (saved.metadata) result.set(address, copy(saved.metadata));
    } else {
      observations.delete(key);
      const active = pending.get(key);
      if (active) reads.set(address, active);
    }
  }
  // Sequential batches avoid a ten-request burst. Per-token observations are
  // shared by Explore, profiles and coin pages, including missing metadata.
  let previous: Promise<unknown> = Promise.resolve();
  for (let index = 0; index < ordered.length; index += 100) {
    const batch = ordered.slice(index, index + 100);
    const missing = batch.filter(address => !result.has(address) && !reads.has(address)
      && !((observations.get(identity(address, chainId))?.expiresAt ?? 0) > Date.now()));
    if (!missing.length) continue;
    const request = previous.then(() => readMetadata(batch, chainId))
      .then(value => ({ ...value, entries: new Map(value.entries) }));
    previous = request.catch(() => undefined);
    for (const address of missing) {
      const key = identity(address, chainId);
      const read: MetadataRead = request.then(value => {
        const metadata = value.entries.get(address);
        const expiresAt = value.observedAt + (metadata ? METADATA_TTL_MS : MISSING_METADATA_TTL_MS);
        if (expiresAt > Date.now()) {
          observations.delete(key);
          observations.set(key, { metadata, expiresAt });
          while (observations.size > 8_192) observations.delete(observations.keys().next().value!);
        }
        return metadata;
      }).finally(() => { if (pending.get(key) === read) pending.delete(key); });
      pending.set(key, read); reads.set(address, read);
    }
  }
  const entries = await Promise.allSettled([...reads].map(async ([address, read]) => {
    const metadata = await read;
    return metadata ? [address, copy(metadata)] as const : null;
  }));
  for (const entry of entries) if (entry.status === "fulfilled" && entry.value) result.set(...entry.value);
  return result;
}
