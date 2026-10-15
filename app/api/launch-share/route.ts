import { launchShareIdentity } from "@/lib/launch-share";
import { readLaunchShare } from "@/lib/server/launch-share";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const identity = query.getAll("address").length === 1 && query.getAll("chain").length === 1
    && [...query.keys()].every(key => key === "address" || key === "chain")
    ? launchShareIdentity(query.get("address")!, query.get("chain")) : null;
  if (!identity) return Response.json({ error: "Choose a coin and its chain." }, { status: 400 });
  try {
    const data = await readLaunchShare(identity);
    return data ? Response.json(data, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } })
      : Response.json({ error: "This coin is not in the launch index yet. Open its coin page and try again shortly." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "The launch index is temporarily unavailable. Please try again." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
