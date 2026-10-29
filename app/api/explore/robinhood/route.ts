import { readRobinhoodLaunches } from "@/lib/server/robinhood-index/read";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";
import { robinhoodExploreResponsePolicy } from "@/lib/server/robinhood-index/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseRobinhoodExploreQuery(new URL(request.url).searchParams, { allowChain: false });
  if (!query) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await readRobinhoodLaunches(query.page, query.q, query.filters, query.pageSize);
  const policy = robinhoodExploreResponsePolicy(result.status, result.updatedAt);
  return Response.json({ ...result, status: policy.status }, { status: policy.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": policy.cacheControl,
    "x-programmable-indexing-status": policy.status,
    "x-content-type-options": "nosniff",
  } });
}
