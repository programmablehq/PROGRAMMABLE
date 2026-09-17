import { NextResponse } from "next/server";
import type { Address } from "viem";
import { unavailableFoundation } from "@/lib/module-foundation/availability";
import { FoundationAvailabilityInputError, parseFoundationAvailabilityToken, readFoundationAvailabilityResponse } from "@/lib/server/module-foundation/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request?: Request): Promise<NextResponse> {
  // The authority allows 50 seconds for live runtime and finality verification.
  let token: Address | undefined;
  try {
    if (request && request.url.length > 2_048) throw new FoundationAvailabilityInputError("The lookup request is too long.");
    token = request ? parseFoundationAvailabilityToken(new URL(request.url).searchParams) : undefined;
    return NextResponse.json(await readFoundationAvailabilityResponse(fetch, 55_000, token), { headers });
  } catch (error) {
    if (error instanceof FoundationAvailabilityInputError) return NextResponse.json({ ...unavailableFoundation(), reason: error.message }, { status: 400, headers });
    return NextResponse.json({ ...unavailableFoundation(), ...(token ? { token: token.toLowerCase() } : {}) }, { headers });
  }
}
