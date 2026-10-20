import "server-only";
import { createFinalizedCustomLaunchMetadataFeedReaderV1 } from "./custom-launch/finalized-custom-launch-metadata-feed-v1";
import { selectUnifiedExplorePage, exploreIdentityKey } from "@/lib/unified-explore";
import { readCodexMarkets } from "./codex-market";
import { coinValuation } from "@/lib/robinhood-presentation";
import type { RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";

const readFeed = createFinalizedCustomLaunchMetadataFeedReaderV1({ chainId: "8453", timeoutMs: 5000 });

/** The public API cursor is exhausted before ranking; no fixed recent window. */
export async function readBaseExploreCatalog() {
  const feed = await readFeed();
  const items = feed.launches.map(launch => {
    if (!launch.creator || !launch.poolKey || !launch.projectMetadata || !launch.routingFeePolicy) {
      throw new Error("Base launch metadata is incomplete");
    }
    const quote = launch.poolKey.currency0.toLowerCase() === launch.token.toLowerCase()
      ? launch.poolKey.currency1 : launch.poolKey.currency0;
    return {
      chainId: 8453 as const, mode: "custom" as const, category: "custom" as const,
      launchId: launch.routerLaunchId, resourceId: launch.resourceId, tokenAddress: launch.token, hookAddress: launch.hook,
      creator: launch.creator, transactionHash: launch.finality.transactionHash,
      blockNumber: launch.finality.blockNumber, launchedAt: launch.finalizedAt,
      name: launch.tokenMetadataReadback.observed.name ?? launch.projectMetadata.token.name,
      symbol: launch.tokenMetadataReadback.observed.symbol ?? launch.projectMetadata.token.symbol,
      decimals: null, poolId: launch.poolId, poolKey: launch.poolKey, quoteAsset: quote,
      quoteSymbol: quote === "0x0000000000000000000000000000000000000000" ? "ETH" : null,
    };
  });
  const presentations = feed.launches.map(launch => ({
    chainId: 8453 as const, tokenAddress: launch.token,
    imageUrl: launch.projectMetadata?.presentation.image?.uri ?? null,
    description: launch.projectMetadata?.presentation.description ?? null,
    links: (launch.projectMetadata?.presentation.links ?? []).map(link => ({ label: link.kind, url: link.uri })),
    market: null,
  }));
  return { status: feed.status === "current" ? "ready" as const : "stale" as const, updatedAt: feed.generatedAt,
    items, presentations, sourceEvidence: { source: "base-finalized-custom-launch-feed-v1" as const,
      generatedAt: feed.generatedAt, chainId: "8453", records: items.length } };
}

export async function readBaseLaunches(page: number, query: string, filters: RobinhoodExploreFilters, size: 6 | 8 | 10 | 50) {
  const catalog = await readBaseExploreCatalog();
  const markets = await readCodexMarkets(catalog.items, 8453).catch(() => new Map());
  const values = new Map(catalog.items.flatMap(row => {
    const market = markets.get(row.tokenAddress.toLowerCase());
    const value = market ? filters.sort === "activity" ? market.volume24hUsd : coinValuation(market).value : null;
    return value === null || value === undefined ? [] : [[exploreIdentityKey(row), value] as const];
  }));
  const selected = selectUnifiedExplorePage(catalog.items, page, query, filters, values, size);
  const addresses = new Set(selected.items.map(row => row.tokenAddress.toLowerCase()));
  return { chainId: 8453, ...catalog, ...selected, presentations: catalog.presentations
    .filter(row => addresses.has(row.tokenAddress.toLowerCase()))
    .map(row => ({ ...row, market: markets.get(row.tokenAddress.toLowerCase()) ?? null })) };
}

export type BaseExploreToken = Awaited<ReturnType<typeof readBaseExploreCatalog>>["items"][number];
export async function readBaseToken(address: string) {
  const catalog = await readBaseExploreCatalog();
  const token = catalog.items.find(row => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
  const presentation = catalog.presentations.find(row => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
  const markets = token ? await readCodexMarkets([token], 8453).catch(() => new Map()) : new Map();
  return { chainId: 8453 as const, token, status: catalog.status, updatedAt: catalog.updatedAt,
    presentation: presentation ? { ...presentation, market: markets.get(address.toLowerCase()) ?? null } : null };
}
