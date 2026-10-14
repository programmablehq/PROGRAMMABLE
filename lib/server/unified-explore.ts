import { ethereumModuleSourceForStamp, isEthereumModuleLaunchCandidate } from "@/lib/module-foundation/ethereum-release";
import { ethereumPairPresentation, launchPresentationDetails } from "@/lib/launch-presentation-details";
import "server-only";

import { readRobinhoodExploreCatalog } from "./robinhood-index/read";
import { readEthereumUnifiedExploreCatalog } from "./ethereum-explore";
import { readRobinhoodMarkets, readRobinhoodPresentations } from "./robinhood-presentation";
import { readCodexMarkets } from "./codex-market";
import { readCodexTokenMetadata } from "./codex-token-metadata";
import { mergeCoinMetadata } from "@/lib/coin-metadata";
import { marketPool } from "@/lib/market/codex";
import { isRobinhoodModuleSourceKind } from "@/lib/robinhood-launches";
import { coinValuation, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { exploreIdentityKey, selectUnifiedExplorePage } from "@/lib/unified-explore";
import type { RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";
import { readConfirmingEthereumLaunches } from "./confirming-launches";
import { PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1 } from "@/lib/public-explore-catalog-v1";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { liveLaunchObservations } from "@/lib/confirming-launches";
import { readRecentFoundationLaunches } from "./module-foundation/recent-launch-store";
import { readApprovedLaunchPresentations } from "./approved-launch-presentation";

const readers = {
  robinhood: readRobinhoodExploreCatalog,
  ethereum: readEthereumUnifiedExploreCatalog,
  robinhoodMarkets: readRobinhoodMarkets,
  ethereumMarkets: readCodexMarkets,
  robinhoodPresentations: readRobinhoodPresentations,
};

/** Verified launch identities with shared Codex market batches and one global ranking. */
export async function readUnifiedLaunches(page = 1, query = "", filters: RobinhoodExploreFilters = { sort: "highest", mode: "all" },
  size: 6 | 8 | 10 | 50 = 10, dependencies: typeof readers = readers, account?: string) {
  const owner = account?.toLowerCase();
  if (owner && !/^0x[0-9a-f]{40}$/.test(owner)) throw new Error("Invalid profile account");
  const catalogSymbols = new Map<string, string | null>();
  const owned = (creator: string | undefined) => !owner || creator?.toLowerCase() === owner;
  const observations = readConfirmingEthereumLaunches().catch(() => []);
  // Each network can enrich its catalog as soon as it arrives. A slower index
  // must not hold up the other network's independent market request.
  const [[rh, rhMarkets], [eth, ethMarkets]] = await Promise.all([
    dependencies.robinhood().catch(() => ({ status: "unavailable" as const, updatedAt: null, items: [], sourceEvidence: null })).then(catalog => {
      for (const row of catalog.items) catalogSymbols.set(exploreIdentityKey({ chainId: 4663, tokenAddress: row.tokenAddress }), row.symbol);
      return { ...catalog, items: catalog.items.filter(row => owned(row.creator)) };
    }).then(async catalog => [catalog,
      await dependencies.robinhoodMarkets(catalog.items).catch(() => new Map<string, RobinhoodCoinMarket>()),
    ] as const),
    dependencies.ethereum().catch(() => ({ status: "unavailable" as const, updatedAt: null, entries: [], sourceEvidence: null })).then(catalog => {
      for (const entry of catalog.entries) catalogSymbols.set(exploreIdentityKey({ chainId: 1, tokenAddress: entry.tokenAddress }), entry.symbol);
      return { ...catalog, entries: catalog.entries.filter(entry => owned(entry.creatorAddress)) };
    }).then(async catalog => [catalog,
      await dependencies.ethereumMarkets(catalog.entries, 1).catch(() => new Map<string, RobinhoodCoinMarket>()),
    ] as const),
  ]);
  const sources = { robinhood: rh.status, ethereum: eth.status };
  const available = [rh, eth].filter(source => source.status !== "unavailable");
  const status = !available.length ? "unavailable" as const : available.length < 2 || eth.status === "partial" ? "partial" as const
    : available.some(source => source.status === "stale") ? "stale" as const
      : available.some(source => source.status === "syncing") ? "syncing" as const : "ready" as const;
  const updatedAt = available.flatMap(source => source.updatedAt ? [source.updatedAt] : [])
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const rhRows = rh.items.map(row => ({ ...row, chainId: 4663 as const,
    mode: isRobinhoodModuleSourceKind(row.sourceKind) ? "module" as const : "custom" as const }));
  const ethRows = eth.entries.map(entry => {
    const stamp = entry.launchStampProvenance;
    const source = owner ? ethereumModuleSourceForStamp(entry) : null;
    return {
    chainId: 1 as const, mode: entry.launchCategoryProvenance.category === "classic" ? "classic" as const
      : isEthereumModuleLaunchCandidate(entry) ? "module" as const : "custom" as const,
    category: entry.launchCategoryProvenance.category,
    launchId: entry.launchStampProvenance?.launchId ?? entry.id, tokenAddress: entry.tokenAddress,
    hookAddress: entry.hookAddress, creator: entry.creatorAddress, transactionHash: entry.launchTransactionHash,
    blockNumber: entry.launchBlockNumber, launchedAt: entry.launchedAt, name: entry.name, symbol: entry.symbol,
    decimals: entry.tokenDecimals ?? null, provenance: entry.launchCategoryProvenance,
    poolId: entry.poolId,
    ...(source && stamp ? { foundationClaim: {
      tokenAddress: entry.tokenAddress, creator: stamp.launchWallet, hookAddress: stamp.poolKey.hooks,
      poolId: stamp.poolId, sourceReleaseDigest: source.releaseDigest,
      quoteAsset: stamp.poolKey.currency0.toLowerCase() === entry.tokenAddress.toLowerCase() ? stamp.poolKey.currency1 : stamp.poolKey.currency0,
    } } : {}),
    ...ethereumPairPresentation(entry),
  }; });
  const markets = new Map<string, RobinhoodCoinMarket>([
    ...[...rhMarkets].map(([address, market]) => [`4663:${address}`, market] as const),
    ...[...ethMarkets].map(([address, market]) => [`1:${address}`, market] as const),
  ]);
  const indexed = new Set([...rhRows, ...ethRows].map(exploreIdentityKey));
  const recent = (await readRecentFoundationLaunches(indexed).catch(() => [])).filter(item => owned(item.row.creator));
  const recentRows = recent.map(item => ({ ...item.row, chainId: item.chainId, mode: "module" as const,
    category: "custom" as const, confirmation: "confirmed" as const }));
  const known = new Set([...indexed, ...recentRows.map(exploreIdentityKey)]);
  const confirming = liveLaunchObservations(await observations).filter(row => owned(row.creator) && !known.has(exploreIdentityKey(row)) && isPublicExploreIdentityV1(row, 1)
    && !PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1.some(hidden => hidden.tokenAddress.toLowerCase() === row.tokenAddress.toLowerCase() && hidden.launchId.toLowerCase() === row.launchId.toLowerCase()));
  // Receipt-backed launches need Codex data immediately too, not only after
  // the historical catalog catches up. Membership still comes from receipts.
  const fresh = [...recentRows, ...confirming];
  await Promise.all(([1, 4663] as const).map(async chainId => {
    const rows = fresh.filter(row => row.chainId === chainId && typeof row.poolId === "string" && marketPool.test(row.poolId));
    if (!rows.length) return;
    const values = await (chainId === 1
      ? dependencies.ethereumMarkets(rows as { tokenAddress: string; poolId: string }[], 1)
      : dependencies.robinhoodMarkets(rows as (typeof rhRows)[number][])).catch(() => new Map<string, RobinhoodCoinMarket>());
    for (const row of rows) {
      const market = values.get(row.tokenAddress.toLowerCase());
      if (market) markets.set(exploreIdentityKey(row), market);
    }
  }));
  const values = new Map<string, number>();
  for (const [identity, market] of markets) {
    const value = filters.sort === "activity" ? market.volume24hUsd : coinValuation(market).value;
    if (value !== null && Number.isFinite(value) && value >= 0) values.set(identity, value);
  }
  const selection = selectUnifiedExplorePage<(typeof rhRows)[number] | (typeof ethRows)[number] | (typeof recentRows)[number] | (typeof confirming)[number]>(
    [...rhRows, ...ethRows, ...recentRows, ...confirming], page, query, filters, values, size);
  const symbols = new Map([...catalogSymbols, ...[...rhRows, ...ethRows, ...recentRows, ...confirming].map(row => [exploreIdentityKey(row), row.symbol] as const)]);
  // Pair identity belongs to the launch, and survives optional price expiry.
  // Resolve catalog tickers on the same chain before using the exact pool observation.
  const items = selection.items.map(row => {
    const market = markets.get(exploreIdentityKey(row));
    const pair = launchPresentationDetails(row, row.chainId, market).pair;
    if (!pair) return row;
    const quoteSymbol = symbols.get(exploreIdentityKey({ chainId: row.chainId, tokenAddress: pair.address }));
    const resolved = launchPresentationDetails({ ...row, quoteAsset: pair.address,
      quoteSymbol: ("quoteSymbol" in row ? row.quoteSymbol : null) || quoteSymbol }, row.chainId, market).pair;
    return resolved && !resolved.label.startsWith("0x")
      ? { ...row, quoteAsset: resolved.address, quoteSymbol: resolved.label } : row;
  });
  const selectedKeys = new Set(selection.items.map(exploreIdentityKey));
  const selectedRh = rhRows.filter(row => selectedKeys.has(exploreIdentityKey(row)));
  const selectedEth = selection.items.filter(row => row.chainId === 1);
  const selectedRecentRh = recent.filter(item => item.chainId === 4663 && selectedKeys.has(exploreIdentityKey({ chainId: item.chainId, tokenAddress: item.row.tokenAddress })));
  const [ethMetadata, approved, [rhMetadata, rhPresentations]] = await Promise.all([
    readCodexTokenMetadata(selectedEth.map(row => row.tokenAddress), 1),
    readApprovedLaunchPresentations(selectedEth,1),
    readCodexTokenMetadata([...selectedRh, ...selectedRecentRh.map(item => item.row)].map(row => row.tokenAddress), 4663)
      .then(async metadata => [metadata, await dependencies.robinhoodPresentations(selectedRh, rhMarkets, metadata)
        .catch(() => selectedRh.map(row => ({ tokenAddress: row.tokenAddress,
          ...mergeCoinMetadata({ imageUrl: null, description: null, links: [] }, metadata.get(row.tokenAddress.toLowerCase())),
          market: rhMarkets.get(row.tokenAddress.toLowerCase()) ?? null })))] as const),
  ]);
  const metadata = new Map(eth.entries.map(entry => [exploreIdentityKey({ chainId: 1, tokenAddress: entry.tokenAddress }), entry]));
  const recentMetadata = new Map(recent.map(item => [exploreIdentityKey({ chainId: item.chainId, tokenAddress: item.row.tokenAddress }), item.presentation]));
  const presentations = [
    ...rhPresentations.map(presentation => ({ ...presentation, chainId: 4663 as const })),
    ...selectedEth.map(row => {
      const entry = metadata.get(exploreIdentityKey(row));
      const saved = recentMetadata.get(exploreIdentityKey(row));
      return { chainId: 1 as const, tokenAddress: row.tokenAddress,
        ...mergeCoinMetadata(mergeCoinMetadata(saved ?? { imageUrl: entry?.imageUrl ?? null, description: entry?.description ?? null,
          links: (entry?.links ?? []).map(link => ({ label: link.kind, url: link.url })) }, approved.get(row.tokenAddress.toLowerCase())), ethMetadata.get(row.tokenAddress.toLowerCase())),
        market: markets.get(exploreIdentityKey(row)) ?? null };
    }),
    ...selectedRecentRh.map(item => ({ ...item.presentation,
      ...mergeCoinMetadata(item.presentation, rhMetadata.get(item.row.tokenAddress.toLowerCase())),
      market: markets.get(exploreIdentityKey({ chainId: item.chainId, tokenAddress: item.row.tokenAddress })) ?? null,
    })),
  ];
  const enrichedItems = items.map(row => {
    const details = (row.chainId === 1 ? ethMetadata : rhMetadata).get(row.tokenAddress.toLowerCase());
    return { ...row, name: row.name || details?.name || null, symbol: row.symbol || details?.symbol || null };
  });
  return { scope: "all" as const, status: status === "unavailable" && fresh.length ? "partial" as const : status, sources, sourceEvidence: { robinhood: rh.sourceEvidence, ethereum: eth.sourceEvidence },
    updatedAt, ...selection, items: enrichedItems, presentations };
}
