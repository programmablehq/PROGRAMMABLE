import { NextResponse } from "next/server";
import type { Address } from "viem";
import { type FoundationChainId } from "@/lib/module-foundation/chains";
import { FOUNDATION_AVAILABILITY_SCHEMA_V4, unavailableFoundation } from "@/lib/module-foundation/availability";
import { FoundationAvailabilityInputError, parseFoundationAvailabilityQuery, readFoundationAvailabilityResponse } from "@/lib/server/module-foundation/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request): Promise<NextResponse> {
  // The authority allows 50 seconds for live runtime and finality verification.
  let token: Address | undefined; let chainId: FoundationChainId = 4663;
  const unavailable = () => chainId === 1 ? unavailableFoundation(FOUNDATION_AVAILABILITY_SCHEMA_V4, chainId) : unavailableFoundation();
  try {
    if (request.url.length > 2_048) throw new FoundationAvailabilityInputError("The lookup request is too long.");
    ({ token, chainId } = parseFoundationAvailabilityQuery(new URL(request.url).searchParams));
    return NextResponse.json(await readFoundationAvailabilityResponse(fetch, 55_000, token, chainId), { headers });
  } catch (error) {
    if (error instanceof FoundationAvailabilityInputError) return NextResponse.json({ ...unavailable(), reason: error.message }, { status: 400, headers });
    return NextResponse.json({ ...unavailable(), ...(token ? { token: token.toLowerCase() } : {}) }, { headers });
  }
}
