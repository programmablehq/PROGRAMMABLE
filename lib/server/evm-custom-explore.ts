import { EVM_CUSTOM_CHAINS, type EvmCustomChainId } from "@/lib/evm-custom-chains";
import "server-only";
import { enrichHyperEvmMarkets } from "./hyperevm-market";
import { createFinalizedCustomLaunchMetadataFeedReaderV1 } from "./custom-launch/finalized-custom-launch-metadata-feed-v1";
import { selectUnifiedExplorePage, exploreIdentityKey } from "@/lib/unified-explore";
import { readCodexMarkets } from "./codex-market";
import { coinValuation } from "@/lib/robinhood-presentation";
import type { RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";
export function createEvmCustomExploreReaders<T extends EvmCustomChainId>(chainId: T) {
  const network = EVM_CUSTOM_CHAINS[chainId];
  const readFeed = createFinalizedCustomLaunchMetadataFeedReaderV1({ chainId: network.apiId, timeoutMs: 5000 });
  /** The public API cursor is exhausted before ranking; no fixed recent window. */
  async function readCatalog() {
    const feed = await readFeed();
    const items = feed.launches.map(launch => {
      if (!launch.creator || !launch.poolKey || !launch.projectMetadata || !launch.routingFeePolicy) {
        throw new Error(`${network.name} launch metadata is incomplete`);
      }
      const quote = launch.poolKey.currency0.toLowerCase() === launch.token.toLowerCase()
        ? launch.poolKey.currency1 : launch.poolKey.currency0;
      return {
        chainId, mode: "custom" as const, category: "custom" as const,
        launchId: launch.routerLaunchId, resourceId: launch.resourceId, tokenAddress: launch.token, hookAddress: launch.hook,
        creator: launch.creator, transactionHash: launch.finality.transactionHash,
        blockNumber: launch.finality.blockNumber, launchedAt: launch.finalizedAt,
        name: launch.tokenMetadataReadback.observed.name ?? launch.projectMetadata.token.name,
        symbol: launch.tokenMetadataReadback.observed.symbol ?? launch.projectMetadata.token.symbol,
        decimals: null, poolId: launch.poolId, poolKey: launch.poolKey, quoteAsset: quote,
        quoteSymbol: quote === "0x0000000000000000000000000000000000000000" ? network.nativeSymbol : null,
      };
    });
    const presentations = feed.launches.map(launch => ({
      chainId, tokenAddress: launch.token,
      imageUrl: launch.projectMetadata?.presentation.image?.uri ?? null,
      description: launch.projectMetadata?.presentation.description ?? null,
      links: (launch.projectMetadata?.presentation.links ?? []).map(link => ({ label: link.kind, url: link.uri })),
      market: null,
    }));
    return { status: feed.status === "current" ? "ready" as const : "stale" as const, updatedAt: feed.generatedAt,
      items, presentations, sourceEvidence: { source: `${network.slug}-finalized-custom-launch-feed-v1` as const,
        generatedAt: feed.generatedAt, chainId: network.apiId, records: items.length } };
  }
  async function readLaunches(page: number, query: string, filters: RobinhoodExploreFilters, size: 6 | 8 | 10 | 50) {
    const catalog = await readCatalog();
    const marketRanked = ["highest", "lowest", "activity"].includes(filters.sort);
    const markets = marketRanked ? await readCodexMarkets(catalog.items, chainId).catch(() => new Map()) : new Map();
    const values = new Map(catalog.items.flatMap(row => {
      const market = markets.get(row.tokenAddress.toLowerCase());
      const value = market ? filters.sort === "activity" ? market.volume24hUsd : coinValuation(market).value : null;
      return value === null || value === undefined ? [] : [[exploreIdentityKey(row), value] as const];
    }));
    const selected = selectUnifiedExplorePage(catalog.items, page, query, filters, values, size);
    if (!marketRanked && selected.items.length) {
      const pageMarkets = await readCodexMarkets(selected.items, chainId).catch(() => new Map());
      for (const [address, market] of pageMarkets)
        markets.set(address, market);
    }
    if (chainId === 999) {
      const enriched = await enrichHyperEvmMarkets(selected.items, markets);
      for (const [address, market] of enriched)
        markets.set(address, market);
    }
    const addresses = new Set(selected.items.map(row => row.tokenAddress.toLowerCase()));
    return { chainId, ...catalog, ...selected, presentations: catalog.presentations
        .filter(row => addresses.has(row.tokenAddress.toLowerCase()))
        .map(row => ({ ...row, market: markets.get(row.tokenAddress.toLowerCase()) ?? null })) };
  }
  async function readToken(address: string) {
    const catalog = await readCatalog();
    const token = catalog.items.find(row => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
    const presentation = catalog.presentations.find(row => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
    let markets = token ? await readCodexMarkets([token], chainId).catch(() => new Map()) : new Map();
    if (chainId === 999 && token)
      markets = await enrichHyperEvmMarkets([token], markets);
    return { chainId, token, status: catalog.status, updatedAt: catalog.updatedAt,
      presentation: presentation ? { ...presentation, market: markets.get(address.toLowerCase()) ?? null } : null };
  }
  async function readLaunchEvidence(address: string) {
    const feed = await readFeed();
    if (feed.status !== "current")
      throw new Error("Launch evidence is temporarily stale");
    return feed.launches.find(row => row.token.toLowerCase() === address.toLowerCase()) ?? null;
  }
  return { readCatalog, readLaunches, readToken, readLaunchEvidence };
}
