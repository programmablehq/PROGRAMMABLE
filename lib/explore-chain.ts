import {
  DEFAULT_VIEW_CHAIN_ID,
  tryParseViewChainId,
  VIEW_CHAIN_OPTIONS,
  type ViewChainId,
} from "@/lib/view-chain";

export const DEFAULT_EXPLORE_CHAIN_ID = DEFAULT_VIEW_CHAIN_ID;

export const EXPLORE_CHAIN_SLUGS = {
  1: "ethereum",
  4663: "robinhood",
  8453: "base",
  999: "hyperevm",
  99901: "elysium",
} as const satisfies Record<ViewChainId, string>;

export function exploreChainPath(chainId: ViewChainId): string {
  return `/explore/${EXPLORE_CHAIN_SLUGS[chainId]}`;
}

export function exploreChainIdFromSlug(slug: string): ViewChainId | null {
  return VIEW_CHAIN_OPTIONS.find(({ id }) => EXPLORE_CHAIN_SLUGS[id] === slug)?.id ?? null;
}

export function resolveExploreChainId(value: unknown): ViewChainId {
  const viewChainId = tryParseViewChainId(value);
  return viewChainId ?? DEFAULT_EXPLORE_CHAIN_ID;
}

export function isRobinhoodExploreAvailableResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const response = value as Record<string, unknown>;
  const catalog = response.catalog;
  return response.status === "ready" &&
    response.chainId === 4663 &&
    typeof response.total === "number" &&
    Number.isSafeInteger(response.total) &&
    response.total > 0 &&
    typeof catalog === "object" && catalog !== null && !Array.isArray(catalog) &&
    (catalog as Record<string, unknown>).source ===
      "robinhood-finalized-custom-launch-feed-v4" &&
    typeof (catalog as Record<string, unknown>).completeness === "object" &&
    (catalog as Record<string, unknown>).completeness !== null &&
    ((catalog as Record<string, unknown>).completeness as Record<string, unknown>)
      .custom === "current";
}
