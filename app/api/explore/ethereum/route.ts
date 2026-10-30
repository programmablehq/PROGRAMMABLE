import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
import { readEthereumLaunches } from "@/lib/server/ethereum-explore";
import { exploreResponsePolicy } from "@/lib/server/explore-response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseEthereumExploreQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const result = await readEthereumLaunches(query.page, query.q, query.filters, query.pageSize);
    const policy = exploreResponsePolicy(result, { maxAgeSeconds: 15 });
    return Response.json({ ...result, status: policy.status }, { status: policy.status === "unavailable" ? 503 : 200, headers: {
      "cache-control": policy.cacheControl,
      "x-programmable-indexing-status": policy.status,
      "x-content-type-options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "Launches are temporarily unavailable", status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
