import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";
import { readUnifiedLaunches } from "@/lib/server/unified-explore";

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
  const cacheControl = result.status === "ready"
    ? "public, max-age=0, s-maxage=60, stale-while-revalidate=120"
    : result.status !== "unavailable" && result.items.length > 0
      ? "public, max-age=0, s-maxage=10, stale-while-revalidate=10"
      : "no-store";
  return Response.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": cacheControl,
    "x-programmable-indexing-status": result.status,
    "x-content-type-options": "nosniff",
  } });
}
