/* eslint-disable @next/next/no-img-element -- Raster images are rendered into the server-side social card. */
import { ImageResponse } from "next/og";
import { launchShareIdentity, launchShareText } from "@/lib/launch-share";
import { readLaunchShare } from "@/lib/server/launch-share";
import { readLaunchShareImage } from "@/lib/server/launch-share-image";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const identity = query.getAll("address").length === 1 && query.getAll("chain").length === 1
    && [...query.keys()].every(key => key === "address" || key === "chain")
    ? launchShareIdentity(query.get("address")!, query.get("chain")) : null;
  if (!identity) return new Response("Choose a valid coin and chain.", { status: 400 });
  try {
    const [coin, brand] = await Promise.all([
      readLaunchShare(identity),
      readLaunchShareImage("/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"),
    ]);
    if (!coin) return new Response("Coin not indexed yet.", { status: 404 });
    const name = launchShareText(coin.name, 64);
    return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", background: "#141515", padding: 24, color: "#eeeae2" }}>
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: "#1e2020", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 32 }}>
        {brand ? <img src={brand} width={42} height={56} alt="" style={{ position: "absolute", top: 44, right: 52 }} />
          : <div style={{ position: "absolute", top: 52, right: 52, fontSize: 24 }}>Programmable</div>}
        <div style={{ display: "flex", alignItems: "center", position: "absolute", top: 167, left: 64, right: 64, gap: 40 }}>
          <div style={{ display: "flex", width: 176, height: 176, flexShrink: 0, borderRadius: 30, overflow: "hidden", background: "#343737", alignItems: "center", justifyContent: "center", fontSize: 64 }}>
            {coin.imageDataUrl ? <img src={coin.imageDataUrl} width={176} height={176} alt="" style={{ objectFit: "cover" }} />
              : Array.from(coin.symbol || coin.name).slice(0, 2).join("").toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, width: 760, gap: 14 }}>
            <div style={{ display: "flex", fontSize: name.length > 40 ? 46 : 64, lineHeight: 1.12, letterSpacing: -1.5, overflow: "hidden", maxHeight: 160 }}>{name}</div>
            {coin.symbol ? <div style={{ display: "flex", fontSize: 32, color: "#b3b6b4" }}>{coin.symbol}</div> : null}
          </div>
        </div>
        <div style={{ display: "flex", position: "absolute", left: 64, bottom: 60, fontSize: 23, color: "#b3b6b4" }}>{coin.address}</div>
      </div>
    </div>, { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch { return new Response("Social image temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
