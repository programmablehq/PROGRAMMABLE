import { getAddress } from "viem";
import { assessAnyQuoteAssetV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { AnyQuoteErrorV1 } from "@/lib/module-engine/any-quote/types";
import { anyQuoteJsonRequest } from "@/lib/server/module-engine/any-quote-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pool discovery only. The SDK quotes and simulates the complete trade before wallet handoff. */
export async function POST(request: Request) {
  return anyQuoteJsonRequest(request, async (input: { quoteAsset: string; probeEthAmount?: string }) => {
    if (Object.keys(input).some(key => !["quoteAsset", "probeEthAmount"].includes(key))
      || typeof input.quoteAsset !== "string" || !/^0x[0-9a-f]{40}$/i.test(input.quoteAsset)
      || (input.probeEthAmount !== undefined && (typeof input.probeEthAmount !== "string"
        || !/^[1-9][0-9]{0,19}$/.test(input.probeEthAmount)))) throw new AnyQuoteErrorV1("INVALID_ROUTE_REQUEST");
    return assessAnyQuoteAssetV1({ quoteAsset: getAddress(input.quoteAsset),
      ...(input.probeEthAmount === undefined ? {} : { probeEthAmount: BigInt(input.probeEthAmount) }) });
  });
}
