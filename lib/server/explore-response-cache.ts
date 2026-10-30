import { ROBINHOOD_MARKET_MAX_AGE_MS } from "@/lib/robinhood-presentation";

type IndexStatus = "ready" | "stale" | "syncing" | "partial" | "unavailable";
type ExploreObservation = {
  status: IndexStatus;
  updatedAt?: string | null;
  items?: readonly unknown[];
  presentations?: readonly { market?: { observedAt: string } | null }[];
};
type CacheWindows = {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
  fallbackSeconds?: number;
};

/** Never serve a cached ready index or market beyond its verified display lifetime. */
export function exploreResponsePolicy(result: ExploreObservation, windows: CacheWindows, now = Date.now()) {
  let remaining = Infinity;
  if (result.status === "ready") {
    const observedAt = Date.parse(result.updatedAt ?? "");
    remaining = Math.floor((observedAt + 300_000 - now) / 1_000) - 2;
    if (!Number.isFinite(remaining) || remaining <= 0 || observedAt > now + 60_000) {
      return { status: "stale" as const, cacheControl: "no-store" };
    }
  } else if (result.status === "unavailable" || !windows.fallbackSeconds || !result.items?.length) {
    return { status: result.status, cacheControl: "no-store" };
  }

  for (const presentation of result.presentations ?? []) {
    if (!presentation.market) continue;
    const observedAt = Date.parse(presentation.market.observedAt);
    const lifetime = Math.floor((observedAt + ROBINHOOD_MARKET_MAX_AGE_MS - now) / 1_000) - 2;
    if (!Number.isFinite(lifetime) || observedAt > now || lifetime <= 0) {
      return { status: result.status, cacheControl: "no-store" };
    }
    remaining = Math.min(remaining, lifetime);
  }

  const fallback = result.status !== "ready";
  const maxAge = Math.min(fallback ? windows.fallbackSeconds! : windows.maxAgeSeconds, remaining);
  const staleWindow = fallback ? windows.fallbackSeconds! : windows.staleWhileRevalidateSeconds ?? 0;
  const stale = Math.min(staleWindow, remaining - maxAge);
  return { status: result.status, cacheControl: `public, max-age=0, s-maxage=${maxAge}${
    staleWindow > 0 ? `, stale-while-revalidate=${stale}` : ""
  }` };
}
