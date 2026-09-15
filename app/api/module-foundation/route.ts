import { NextResponse } from "next/server";
import { unavailableFoundation } from "@/lib/module-foundation/availability";
import { readFoundationAvailabilityResponse } from "@/lib/server/module-foundation/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(): Promise<NextResponse> {
  // The authority allows 50 seconds for live runtime and finality verification.
  try { return NextResponse.json(await readFoundationAvailabilityResponse(fetch, 55_000), { headers }); }
  catch { return NextResponse.json(unavailableFoundation(), { headers }); }
}
