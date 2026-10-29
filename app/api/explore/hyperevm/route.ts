import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
import { readHyperEvmLaunches } from "@/lib/server/hyperevm-explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = parseEthereumExploreQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const result = await readHyperEvmLaunches(query.page, query.q, query.filters, query.pageSize);
    return Response.json(result, { headers: { "cache-control": "public, max-age=0, s-maxage=15",
      "x-content-type-options": "nosniff", "x-programmable-indexing-status": result.status } });
  } catch {
    return Response.json({ status: "unavailable", error: "Launches are temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}
