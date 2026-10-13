import "server-only";
import { readConfirmingEthereumLaunches } from "./confirming-launches";
import { liveLaunchObservations } from "@/lib/confirming-launches";

import { readWebsiteRouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { readClassicLaunchCatalogV1 } from "@/lib/market-data/classic-launch-catalog.server";
import { PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1, publicExploreCatalogEntriesV1, publicExplorePresentationEntryV1 } from "@/lib/public-explore-catalog-v1";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { readCodexMarkets } from "./codex-market";
import { readCodexTokenMetadata } from "./codex-token-metadata";
import { mergeCoinMetadata } from "@/lib/coin-metadata";
import { ETHEREUM_EXPLORE_FILTERS } from "@/lib/ethereum-explore";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import type { readEthereumPublicTokenMetadata } from "./ethereum-public-token-metadata";

type SourceStatus = "current" | "last-known-good" | "unavailable";
type SourceEvidence = {
  source: "codex-classic-launches" | "canonical-launch-stamp-router";
  asOfBlock: string;
  asOfBlockHash: string;
  commitment: string;
  generatedAt: string;
  releaseDigest?: string;
  provider?: "codex";
  observedAt?: string;
};
type CatalogSource = { entries: readonly CanonicalTokenExploreEntry[]; status: Exclude<SourceStatus, "unavailable">; generatedAt: string; evidence?: SourceEvidence };
type Dependencies = {
  classic: () => Promise<CatalogSource>;
  custom: () => Promise<CatalogSource>;
  metadata?: typeof readEthereumPublicTokenMetadata;
};
const readers: Dependencies = {
  classic: async () => {
    const catalog = await readClassicLaunchCatalogV1();
    return { ...catalog, entries: catalog.entries.filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"),
      evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock, asOfBlockHash: catalog.asOfBlockHash,
        commitment: catalog.evidence.commitment, generatedAt: catalog.generatedAt, releaseDigest: catalog.evidence.releaseDigest, provider: catalog.evidence.provider, observedAt: catalog.evidence.observedAt } };
  },
  custom: async () => {
    const catalog = await readWebsiteRouterCustomIdentitySnapshotV1();
    return { ...catalog, evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock,
      asOfBlockHash: catalog.asOfBlockHash, commitment: catalog.identityCommitment, generatedAt: catalog.generatedAt } };
  },
};

/** Unified discovery admits only the canonical Ethereum Custom Hook lane. */
export async function readEthereumCustomExploreCatalog(dependencies: Pick<Dependencies, "custom" | "metadata"> = readers) {
  try {
    const catalog = await dependencies.custom();
    let entries = publicExploreCatalogEntriesV1(catalog.entries.map(publicExplorePresentationEntryV1))
      .filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"
        && entry.launchCategoryProvenance.category === "custom" && isPublicExploreIdentityV1(entry));
    const identities = new Set<string>();
    for (const entry of entries) {
      const identity = entry.tokenAddress.toLowerCase();
      if (identities.has(identity)) throw new Error("Conflicting Ethereum launch identities");
      identities.add(identity);
    }
    if (dependencies.metadata && catalog.evidence?.source === "canonical-launch-stamp-router") {
      entries = [...await dependencies.metadata(entries, catalog.evidence).catch(() => entries)];
    }
    return { status: catalog.status === "current" ? "ready" as const : "stale" as const,
      updatedAt: catalog.generatedAt, entries, sourceEvidence: catalog.evidence ?? null };
  } catch {
    return { status: "unavailable" as const, updatedAt: null, entries: [], sourceEvidence: null };
  }
}

// Owner-selected Classic identities still come from the verified launch catalog.
// This controls discovery only and does not create or relabel launch evidence.
const PUBLIC_CLASSIC_TOKENS = new Set(["0x9c355950bd5634ef2b2935d356075c7c19b2386a"]);

export async function readEthereumUnifiedExploreCatalog(dependencies: Dependencies = readers) {
  const [custom, classic] = await Promise.all([
    readEthereumCustomExploreCatalog(dependencies),
    dependencies.classic().catch(() => null),
  ]);
  const selected = classic ? publicExploreCatalogEntriesV1(classic.entries)
    .filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"
      && entry.launchCategoryProvenance.category === "classic"
      && PUBLIC_CLASSIC_TOKENS.has(entry.tokenAddress.toLowerCase()) && isPublicExploreIdentityV1(entry, 1)) : [];
  const entries = [...custom.entries, ...selected];
  if (new Set(entries.map(entry => entry.tokenAddress.toLowerCase())).size !== entries.length) {
    throw new Error("Conflicting Ethereum launch identities");
  }
  const available = [custom.status !== "unavailable", classic !== null].filter(Boolean).length;
  const status = available === 0 ? "unavailable" as const : available < 2 ? "partial" as const
    : custom.status === "stale" || classic?.status === "last-known-good" ? "stale" as const : "ready" as const;
  const updatedAt = [custom.updatedAt, classic?.generatedAt].filter((time): time is string => Boolean(time))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return { status, updatedAt, entries, sourceEvidence: { custom: custom.sourceEvidence, classic: classic?.evidence ?? null } };
}

/** Each source retains its existing release, provenance and finality checks. */
export async function readEthereumExploreCatalog(dependencies: Dependencies = readers) {
  const [classic, custom] = await Promise.allSettled([dependencies.classic(), dependencies.custom()]);
  const sources: { classic: SourceStatus; custom: SourceStatus } = {
    classic: classic.status === "fulfilled" ? classic.value.status : "unavailable",
    custom: custom.status === "fulfilled" ? custom.value.status : "unavailable",
  };
  const accepted = [classic, custom].flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  let entries = accepted.flatMap(source => source.entries).map(publicExplorePresentationEntryV1);
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = entry.tokenAddress.toLowerCase();
    if (identities.has(identity)) throw new Error("Conflicting Ethereum launch identities");
    identities.add(identity);
  }
  if (dependencies.metadata && custom.status === "fulfilled" && custom.value.evidence?.source === "canonical-launch-stamp-router") {
    entries = [...await dependencies.metadata(entries, custom.value.evidence).catch(() => entries)];
  }
  entries = entries.map(publicExplorePresentationEntryV1);
  const status = accepted.length === 0 ? "unavailable" as const
    : accepted.length !== 2 ? "partial" as const
      : accepted.some(source => source.status !== "current") ? "stale" as const : "ready" as const;
  const updatedAt = accepted.map(source => source.generatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const sourceEvidence = { classic: classic.status === "fulfilled" ? classic.value.evidence ?? null : null,
    custom: custom.status === "fulfilled" ? custom.value.evidence ?? null : null };
  return { chainId: 1 as const, status, sources, sourceEvidence, updatedAt, entries };
}

export async function readEthereumLaunches(page = 1, query = "", filters = ETHEREUM_EXPLORE_FILTERS, pageSize: 6 | 8 | 10 | 50 = 10, dependencies?: Dependencies) {
  const observations = readConfirmingEthereumLaunches().catch(() => []);
  const catalog = await readEthereumExploreCatalog(dependencies);
  const q = query.normalize("NFC").trim().replace(/^\$/, "").toLowerCase();
  const visible = publicExploreCatalogEntriesV1(catalog.entries).filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token" && isPublicExploreIdentityV1(entry));
  const indexed = new Set(catalog.entries.map(entry => entry.tokenAddress.toLowerCase()));
  const confirming = liveLaunchObservations(await observations).filter(row => !indexed.has(row.tokenAddress.toLowerCase()) && isPublicExploreIdentityV1(row, 1)
    && !PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1.some(hidden => hidden.tokenAddress.toLowerCase() === row.tokenAddress.toLowerCase() && hidden.launchId.toLowerCase() === row.launchId.toLowerCase()));
  const rows = [...visible.map(entry => ({
    launchId: entry.launchStampProvenance?.launchId ?? entry.id,
    tokenAddress: entry.tokenAddress, hookAddress: entry.hookAddress, creator: entry.creatorAddress,
    transactionHash: entry.launchTransactionHash, blockNumber: entry.launchBlockNumber,
    launchedAt: entry.launchedAt, name: entry.name, symbol: entry.symbol, decimals: entry.tokenDecimals ?? null,
    category: entry.launchCategoryProvenance.category, provenance: entry.launchCategoryProvenance,
  })), ...confirming];
  const logOrder = new Map(visible.map(entry => [entry.tokenAddress.toLowerCase(), entry.launchLogIndex ?? 0]));
  const filtered = rows.filter(entry => (filters.mode === undefined || filters.mode === "all" || entry.category === filters.mode)
    && (!q || [entry.name, entry.symbol, entry.tokenAddress].some(value => value?.normalize("NFC").toLowerCase().includes(q))));
  filtered.sort((a, b) => {
    const left = BigInt(a.blockNumber ?? "0"), right = BigInt(b.blockNumber ?? "0");
    const difference = left === right ? (logOrder.get(a.tokenAddress.toLowerCase()) ?? 0) - (logOrder.get(b.tokenAddress.toLowerCase()) ?? 0) : left > right ? 1 : -1;
    return (filters.sort === "oldest" ? difference : -difference) || a.tokenAddress.localeCompare(b.tokenAddress);
  });
  const totalPages = Math.ceil(filtered.length / pageSize);
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const selected = filtered.slice((number - 1) * pageSize, number * pageSize);
  const keys = new Set(selected.map(row => row.tokenAddress.toLowerCase()));
  const selectedCanonical = visible.filter(entry => keys.has(entry.tokenAddress.toLowerCase()));
  const [markets, metadata] = await Promise.all([
    readCodexMarkets(selectedCanonical, 1).catch(() => new Map<string, RobinhoodCoinMarket>()),
    readCodexTokenMetadata(selectedCanonical.map(entry => entry.tokenAddress), 1),
  ]);
  return {
    chainId: catalog.chainId, status: catalog.status === "unavailable" && confirming.length ? "partial" as const : catalog.status, sources: catalog.sources, sourceEvidence: catalog.sourceEvidence, updatedAt: catalog.updatedAt,
    items: selected,
    presentations: selectedCanonical.map(entry => ({ tokenAddress: entry.tokenAddress,
      ...mergeCoinMetadata({ imageUrl: entry.imageUrl ?? null, description: entry.description ?? null,
        links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })) }, metadata.get(entry.tokenAddress.toLowerCase())),
      market: markets.get(entry.tokenAddress.toLowerCase()) ?? null })),
    page: { number, size: pageSize, totalItems: filtered.length, totalPages, hasMore: number < totalPages },
  };
}

export async function readEthereumToken(address: string, dependencies?: Dependencies, options: { publicPresentation?: boolean } = {}) {
  try {
    const tokenReaders = options.publicPresentation === false ? { ...(dependencies ?? readers), metadata: undefined } : dependencies;
    let catalog = await readEthereumExploreCatalog(tokenReaders);
    const findToken = () => catalog.entries.find(entry => entry.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
    let token = findToken();
    // A cold page has its own reader cache. Give a temporarily missing source
    // one bounded recovery read before treating its verified token as unavailable.
    if (!token && (catalog.status === "partial" || catalog.status === "unavailable")) {
      catalog = await readEthereumExploreCatalog(tokenReaders);
      token = findToken();
    }
    const metadata = (tokenReaders ?? readers).metadata;
    const boundary = catalog.sourceEvidence.custom;
    if (token && metadata && boundary?.source === "canonical-launch-stamp-router") {
      token = publicExplorePresentationEntryV1((await metadata([token], boundary).catch(() => [token!]))[0] ?? token);
    }
    return { chainId: catalog.chainId, status: catalog.status, sources: catalog.sources, updatedAt: catalog.updatedAt,
      // The verified snapshot uses null-prototype proof records. React requires
      // plain objects at the client boundary; preserve every proof field in a copy.
      token: token ? structuredClone(token) : null };
  } catch {
    return { chainId: 1 as const, status: "unavailable" as const, updatedAt: null, token: null };
  }
}

export async function readEthereumTokenPresentation(address: string) {
  const record = await readEthereumToken(address);
  if (!record.token) return { ...record, presentation: null };
  const entry = record.token;
  const [markets, metadata] = await Promise.all([
    readCodexMarkets([entry], 1).catch(() => new Map<string, RobinhoodCoinMarket>()),
    readCodexTokenMetadata([entry.tokenAddress], 1),
  ]);
  return { ...record, presentation: { chainId: 1 as const, tokenAddress: entry.tokenAddress,
    name: entry.name, symbol: entry.symbol,
    ...mergeCoinMetadata({ imageUrl: entry.imageUrl ?? null, description: entry.description ?? null,
      links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })) }, metadata.get(entry.tokenAddress.toLowerCase())),
    market: markets.get(entry.tokenAddress.toLowerCase()) ?? null } };
}
