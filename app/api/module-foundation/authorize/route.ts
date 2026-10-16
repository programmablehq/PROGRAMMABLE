import { NextResponse } from "next/server";
import { getProductionEthereumModuleAuthorizationBridgeV1, EthereumModuleAuthorizationBridgeErrorV1 } from "@/lib/server/custom-launch/ethereum-module-authorization-bridge-v1";
import { parseStrictJson } from "@/lib/server/projection-target/canonical-json";
import type { EthereumModuleAuthorizationRequest } from "@/lib/module-foundation/ethereum-authorization";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request) {
  try {
    if (process.env.PROGRAMMABLE_ETHEREUM_MODULE_MODE !== "enabled") return NextResponse.json({ code: "MODULE_LAUNCH_UNAVAILABLE" }, { status: 503, headers });
    if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers });
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 131_072) throw new Error("Body too large"); chunks.push(value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const input = parseStrictJson(Buffer.concat(chunks).toString("utf8"), { maximumBytes: 131_072, maximumDepth: 6 }) as unknown as EthereumModuleAuthorizationRequest;
    const result = await getProductionEthereumModuleAuthorizationBridgeV1().authorize(request, input);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof EthereumModuleAuthorizationBridgeErrorV1) {
      const errorHeaders = new Headers(headers);
      if (error.requestId) errorHeaders.set("X-Request-Id", error.requestId);
      if (error.retryAfter) errorHeaders.set("Retry-After", error.retryAfter);
      if (error.status >= 500) console.warn("Ethereum launch authorization unavailable", {
        code: error.code, requestId: error.requestId, status: error.status,
      });
      return NextResponse.json({ code: error.code, requestId: error.requestId }, { status: error.status, headers: errorHeaders });
    }
    return NextResponse.json({ code: "INVALID_MODULE_REQUEST" }, { status: 400, headers });
  }
}
