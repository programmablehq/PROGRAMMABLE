import { isPinnedRobinhoodToken } from "./robinhood-explore-policy";
import type { RobinhoodExploreFilters } from "./robinhood-explore-filters";
import type { ViewChainId } from "./view-chain";

export type UnifiedExploreIdentity = Readonly<{
  chainId: ViewChainId;
  tokenAddress: string;
  hookAddress: string | null;
  name: string | null;
  symbol: string | null;
  launchedAt: string | null;
  mode: "module" | "custom" | "classic";
}>;

export function exploreIdentityKey(identity: Readonly<{ chainId?: ViewChainId; tokenAddress: string }>) {
  return `${identity.chainId ?? 4663}:${identity.tokenAddress.toLowerCase()}`;
}

/** Rank the complete verified catalog before slicing a page. Block heights are not comparable across chains. */
export function selectUnifiedExplorePage<T extends UnifiedExploreIdentity>(
  catalog: readonly T[], page: number, query: string, filters: RobinhoodExploreFilters,
  values: ReadonlyMap<string, number>, size: 6 | 8 | 10 | 50,
) {
  const identities = new Set<string>();
  for (const row of catalog) {
    const key = exploreIdentityKey(row);
    if (identities.has(key)) throw new Error("Conflicting launch identities");
    identities.add(key);
  }
  const q = query.normalize("NFC").trim().replace(/^\$/, "").toLowerCase();
  const matches = (row: T) => ((filters.mode ?? "all") === "all" || row.mode === filters.mode)
    && (!q || [row.name, row.symbol, row.tokenAddress, row.hookAddress]
      .some(value => value?.normalize("NFC").toLowerCase().includes(q)));
  const matchingItems = catalog.filter(matches).length;
  const pinned = filters.matchesOnly ? undefined : catalog.find(row => isPinnedRobinhoodToken(row.tokenAddress, row.chainId));
  const metric = (row: T) => {
    const value = values.get(exploreIdentityKey(row));
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const timestamp = (row: T) => row.launchedAt ? Date.parse(row.launchedAt) || 0 : 0;
  const rows = catalog.filter(row => row !== pinned && matches(row)).toSorted((a, b) => {
    if (["highest", "lowest", "activity"].includes(filters.sort)) {
      const left = metric(a), right = metric(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return filters.sort === "lowest" ? left - right : right - left;
    }
    const newest = timestamp(b) - timestamp(a);
    return (filters.sort === "oldest" ? -newest : newest) || exploreIdentityKey(a).localeCompare(exploreIdentityKey(b));
  });
  const capacity = size - Number(Boolean(pinned));
  const totalItems = rows.length + Number(Boolean(pinned));
  const totalPages = Math.max(pinned ? 1 : 0, Math.ceil(rows.length / capacity));
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  return {
    items: [...(pinned ? [pinned] : []), ...rows.slice((number - 1) * capacity, number * capacity)],
    page: { number, size, totalItems, matchingItems, totalPages, hasMore: number < totalPages },
  };
}
