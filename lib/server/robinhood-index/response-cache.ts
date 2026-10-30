import { exploreResponsePolicy } from "../explore-response-cache";

type IndexStatus = "ready" | "stale" | "syncing" | "partial" | "unavailable";

/** A cached ready response must expire before its oldest source evidence. */
export function robinhoodExploreResponsePolicy(status: IndexStatus, updatedAt: string | null, now = Date.now()) {
  return exploreResponsePolicy({ status, updatedAt }, {
    maxAgeSeconds: 15, staleWhileRevalidateSeconds: 30,
  }, now);
}
