export const LAUNCH_SORT_OPTIONS = [
  { value: "activity", label: "24h volume" },
  { value: "highest", label: "Highest market cap" },
  { value: "lowest", label: "Lowest market cap" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
] as const;

export const LAUNCH_MODE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "module", label: "Module" },
  { value: "custom", label: "Custom" },
] as const;

export type ExploreChainFilter = "all" | 1 | 4663 | 8453;
export const LAUNCH_CHAIN_OPTIONS = [
  { value: "all", label: "All chains" },
  { value: 4663, label: "Robinhood" },
  { value: 1, label: "Ethereum" },
  { value: 8453, label: "Base" },
] as const satisfies ReadonlyArray<{ value: ExploreChainFilter; label: string }>;

export const ROBINHOOD_EXPLORE_PAGE_SIZE = 10;

export type RobinhoodExploreFilters = {
  sort: typeof LAUNCH_SORT_OPTIONS[number]["value"];
  mode?: typeof LAUNCH_MODE_OPTIONS[number]["value"] | "classic";
  chain?: ExploreChainFilter;
};

export const DEFAULT_EXPLORE_FILTERS: RobinhoodExploreFilters = { sort: "newest", mode: "all" };

export function exploreChainFilter(filters: RobinhoodExploreFilters): ExploreChainFilter {
  return filters.chain ?? "all";
}

export function activeExploreFilterCount(filters: RobinhoodExploreFilters) {
  return Number((filters.mode ?? "all") !== "all") + Number(exploreChainFilter(filters) !== "all");
}

export type RobinhoodExploreRequest = { page: number; q: string } & RobinhoodExploreFilters;

export function sameRobinhoodExploreRequest(a: RobinhoodExploreRequest | null | undefined, b: RobinhoodExploreRequest) {
  return Boolean(a && a.page === b.page && a.q === b.q && a.sort === b.sort
    && (a.mode ?? "all") === (b.mode ?? "all")
    && exploreChainFilter(a) === exploreChainFilter(b));
}

export function parseRobinhoodExploreQuery(query: URLSearchParams, options: { allowChain?: boolean } = {}) {
  const allowChain = options.allowChain !== false;
  const page = query.get("page") ?? "1";
  const q = query.get("q") ?? "";
  const sort = query.get("sort") ?? DEFAULT_EXPLORE_FILTERS.sort;
  const mode = query.get("mode") ?? "all";
  const chain = query.get("chain") ?? "all";
  const pageSize = query.get("pageSize") ?? "50";
  if ([...query.keys()].some((key) => !["page", "q", "sort", "mode", ...(allowChain ? ["chain"] : []), "pageSize"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || q.length > 128
    || !LAUNCH_SORT_OPTIONS.some((option) => option.value === sort)
    || !LAUNCH_MODE_OPTIONS.some((option) => option.value === mode)
    || !(chain === "all" || ["1", "4663", "8453"].includes(chain))
    || !["6", "8", "10", "50"].includes(pageSize)) return null;
  const filters: RobinhoodExploreFilters = { sort, mode } as RobinhoodExploreFilters;
  if (chain !== "all") filters.chain = Number(chain) as Exclude<ExploreChainFilter, "all">;
  return { page: Number(page), pageSize: Number(pageSize) as 6 | 8 | 10 | 50, q, filters };
}
