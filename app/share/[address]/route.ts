import { launchShareIdentity, launchShareIntent } from "@/lib/launch-share";
import { readLaunchShare } from "@/lib/server/launch-share";

export const runtime = "nodejs";
/** The click opens X directly. No intermediate editor, upload or wallet step. */
export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const query = new URL(request.url).searchParams;
  const identity = query.getAll("chain").length === 1 ? launchShareIdentity(address, query.get("chain")) : null;
  if (!identity) return new Response("Choose a valid coin and chain.", { status: 400 });
  try {
    const coin = await readLaunchShare(identity, { image: false });
    if (!coin) return new Response("This coin is not in the launch index yet. Please try again shortly.", { status: 404 });
    return Response.redirect(launchShareIntent(coin), 302);
  } catch { return new Response("The launch index is temporarily unavailable. Please try again shortly.", { status: 503 }); }
}
