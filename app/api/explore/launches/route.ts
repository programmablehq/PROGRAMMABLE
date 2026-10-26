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
  return Response.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": result.status === "ready" ? "public, max-age=0, s-maxage=300, stale-while-revalidate=600" : "no-store",
    "x-programmable-indexing-status": result.status,
    "x-content-type-options": "nosniff",
  } });
}
