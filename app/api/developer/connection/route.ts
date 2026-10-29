import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
/** Public availability only. Wallet/key authorization is checked separately by the existing authenticated key route. */
export async function GET(request: Request) {
  const chainId = new URL(request.url).searchParams.get("chainId");
  if (chainId !== "1" && chainId !== "4663" && chainId !== "8453" && chainId !== "999") return NextResponse.json({ error: { code: "CHAIN_INVALID" } }, { status: 400 });
  try {
    const response = await fetch(`https://api.programmable.market/${chainId === "8453" || chainId === "999" ? `v4/chains/${chainId}/capabilities` : chainId === "1" ? "v3/capabilities" : "v4/chains/4663/custom-launch-capabilities"}`,
      { cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    const matches = chainId === "8453" || chainId === "999" ? data.chain?.id === chainId : chainId === "1" ? data.chain?.id === "1" : data.chainId === "4663";
    if (!matches || data.schemaVersion !== "programmable.custom-launch-capabilities.v1") throw new Error("invalid");
    const createState = chainId === "8453" || chainId === "999" ? data.publicLaunchAuthorized === true ? "active" : data.mode : chainId === "1" ? data.profile?.productionLaunchAuthorized === true ? "active" : "unavailable" : data.availability?.operations?.create?.state;
    return NextResponse.json({ chainId, reachable: true, createState: ["active", "canary", "disabled", "degraded"].includes(createState) ? createState : "unavailable",
      checkedAt: new Date().toISOString(), authorizesKey: false }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "API_CONNECTION_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } });
  }
}
