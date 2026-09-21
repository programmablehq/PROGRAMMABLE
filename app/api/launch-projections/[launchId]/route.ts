import { indexStore } from "@/lib/server/robinhood-index/store";
import { indexedLaunchProjectionV1 } from "@/lib/server/robinhood-index/indexed-launch-projection-v1";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ launchId: string }> }) {
  const { launchId } = await context.params;
  const search = new URL(request.url).searchParams;
  const source = search.get("source");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(launchId)
    || !["custom_launch_plan_v1", "multi_role_v2"].includes(source ?? "")
    || [...search.keys()].some(key => key !== "source") || search.getAll("source").length !== 1) {
    return Response.json({ error: "Invalid launch identity" }, { status: 400, headers });
  }
  try {
    const saved = await indexStore().read();
    const record = indexedLaunchProjectionV1(saved?.snapshot ?? null, launchId, source!);
    return Response.json(record ?? { schemaVersion: "programmable.website-indexed-launch.v1", status: "pending" }, { status: record ? 200 : 202, headers });
  } catch { return Response.json({ error: "The saved website index is temporarily unavailable" }, { status: 503, headers }); }
}
