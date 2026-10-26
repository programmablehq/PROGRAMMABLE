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

const cachedMetadata = unstable_cache(async (addresses: string[], chainId: 1 | 4663) => {
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
  return result;
// Metadata is display enrichment, so it follows the same bounded refresh
// window as market observations instead of polling the provider per page load.
}, ["codex-coin-metadata-v2"], { revalidate: 900 });

/** Display-only enrichment of known identities, independent of price refreshes. */
export async function readCodexTokenMetadata(addresses: readonly string[], chainId: 1 | 4663): Promise<Map<string, CodexTokenMetadata>> {
  if (![1, 4663].includes(chainId) || addresses.length > 1000 || addresses.some(address => !marketAddress.test(address))) throw new Error("Invalid token metadata request");
  if (!process.env.CODEX_API_KEY?.trim() || !addresses.length) return new Map();
  const ordered = [...new Set(addresses.map(address => address.toLowerCase()))].sort();
  const batches = await Promise.allSettled(Array.from({ length: Math.ceil(ordered.length / 100) }, (_, index) =>
    cachedMetadata(ordered.slice(index * 100, index * 100 + 100), chainId)));
  return new Map(batches.flatMap(batch => batch.status === "fulfilled" ? batch.value : []));
}
