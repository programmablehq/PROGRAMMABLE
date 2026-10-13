import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";
import { readUnifiedLaunches } from "@/lib/server/unified-explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account");
  if (!account || !/^0x[0-9a-f]{40}$/i.test(account) || params.getAll("account").length !== 1) {
    return Response.json({ error: "invalid_account" }, { status: 400 });
  }
  params.delete("account");
  if (!params.has("sort")) params.set("sort", "newest");
  if (!params.has("pageSize")) params.set("pageSize", "10");
  const query = parseRobinhoodExploreQuery(params);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400 });
  const result = await readUnifiedLaunches(query.page, query.q, query.filters, query.pageSize, undefined, account);
  return Response.json({ ...result, account: account.toLowerCase() }, {
    status: result.status === "unavailable" ? 503 : 200,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
