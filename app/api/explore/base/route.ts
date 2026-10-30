import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
import { readBaseLaunches } from "@/lib/server/base-explore";
import { exploreResponsePolicy } from "@/lib/server/explore-response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = parseEthereumExploreQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const result = await readBaseLaunches(query.page, query.q, query.filters, query.pageSize);
    const policy = exploreResponsePolicy(result, { maxAgeSeconds: 15 });
    return Response.json({ ...result, status: policy.status }, { headers: { "cache-control": policy.cacheControl,
      "x-content-type-options": "nosniff", "x-programmable-indexing-status": policy.status } });
  } catch {
    return Response.json({ status: "unavailable", error: "Launches are temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}
