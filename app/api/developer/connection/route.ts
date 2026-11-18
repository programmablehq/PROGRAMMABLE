import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** Public availability only. Wallet/key authorization is checked separately by the existing authenticated key route. */
export async function GET(request: Request) {
  const chainId = new URL(request.url).searchParams.get("chainId");
  if (chainId !== "1" && chainId !== "4663" && chainId !== "8453" && chainId !== "999" && chainId !== "99901") return NextResponse.json({ error: { code: "CHAIN_INVALID" } }, { status: 400 });
  const chainScoped = chainId === "8453" || chainId === "999" || chainId === "99901";
  try {
    const path = chainScoped ? `v4/chains/${chainId}/capabilities`
      : chainId === "1" ? "v3/capabilities" : "v4/chains/4663/custom-launch-capabilities";
    const response = await fetch(`https://api.programmable.market/${path}`,
      { cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    const matches = (chainId === "4663" ? data.chainId : data.chain?.id) === chainId;
    if (!matches || data.schemaVersion !== "programmable.custom-launch-capabilities.v1") throw new Error("invalid");
    let createState = data.availability?.operations?.create?.state;
    if (chainScoped) {
      createState = data.mode;
      if (createState === "active" && data.publicLaunchAuthorized !== true) createState = "unavailable";
    } else if (chainId === "1") {
      createState = data.profile?.productionLaunchAuthorized === true ? "active" : "unavailable";
    }
    return NextResponse.json({ chainId, reachable: true, createState: ["active", "canary", "disabled", "degraded"].includes(createState) ? createState : "unavailable",
      checkedAt: new Date().toISOString(), authorizesKey: false }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "API_CONNECTION_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } });
  }
}
