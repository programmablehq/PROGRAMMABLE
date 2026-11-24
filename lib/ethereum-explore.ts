import type { RobinhoodExploreFilters } from "./robinhood-explore-filters";

export type EthereumExploreFilters = RobinhoodExploreFilters & { view?: "indexed" };
export const ETHEREUM_EXPLORE_FILTERS: EthereumExploreFilters = { sort: "newest", mode: "all" };
export const ETHEREUM_EXPLORE_MODES = [
  { value: "all", label: "All" },
  { value: "classic", label: "Classic" },
  { value: "custom", label: "Custom" },
] as const;

export function parseEthereumExploreQuery(query: URLSearchParams, { ethereumView = false } = {}) {
  const page = query.get("page") ?? "1";
  const pageSize = query.get("pageSize") ?? "10";
  const q = query.get("q") ?? "";
  const sort = query.get("sort") ?? "newest";
  const mode = query.get("mode") ?? "all";
  const view = query.get("view") ?? "live";
  const keys = ["page", "pageSize", "q", "sort", "mode", ...(ethereumView ? ["view"] : [])];
  if ([...query.keys()].some(key => !keys.includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || !["6", "8", "10", "50"].includes(pageSize) || q.length > 128
    || (view !== "live" && view !== "indexed")
    || !["newest", "oldest"].includes(sort) || !ETHEREUM_EXPLORE_MODES.some(option => option.value === mode)) return null;
  return { page: Number(page), pageSize: Number(pageSize) as 6 | 8 | 10 | 50, q,
    filters: { sort, mode, ...(view === "indexed" ? { view } : {}) } as EthereumExploreFilters };
}
