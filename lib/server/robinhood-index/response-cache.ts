type IndexStatus = "ready" | "stale" | "syncing" | "partial" | "unavailable";

/** A cached ready response must expire before its oldest source evidence. */
export function robinhoodExploreResponsePolicy(status: IndexStatus, updatedAt: string | null, now = Date.now()) {
  if (status !== "ready") return { status, cacheControl: "no-store" };
  const observedAt = updatedAt === null ? NaN : Date.parse(updatedAt);
  const remaining = Math.floor((observedAt + 300_000 - now) / 1_000);
  if (!Number.isFinite(remaining) || remaining <= 2 || observedAt > now + 60_000) {
    return { status: "stale" as const, cacheControl: "no-store" };
  }
  // Leave two seconds for response transit and integer Age rounding. Neither
  // the fresh nor stale-while-revalidate window can cross the evidence limit.
  const maxAge = Math.min(15, remaining - 2);
  const staleWhileRevalidate = Math.min(30, remaining - 2 - maxAge);
  return { status, cacheControl: `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}` };
}
