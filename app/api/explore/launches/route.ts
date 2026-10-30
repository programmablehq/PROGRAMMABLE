import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";
import { readUnifiedLaunches } from "@/lib/server/unified-explore";
import { exploreResponsePolicy } from "@/lib/server/explore-response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!params.has("sort")) params.set("sort", "highest");
  if (!params.has("pageSize")) params.set("pageSize", "10");
  const query = parseRobinhoodExploreQuery(params);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  const result = await readUnifiedLaunches(query.page, query.q, query.filters, query.pageSize);
  // A verified nonempty fallback is still useful for navigation. Share it
  // briefly while the index refreshes, retaining its actual status.
  const policy = exploreResponsePolicy(result, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 120, fallbackSeconds: 10 });
  return Response.json({ ...result, status: policy.status }, { status: policy.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": policy.cacheControl,
    "x-programmable-indexing-status": policy.status,
    "x-content-type-options": "nosniff",
  } });
}
