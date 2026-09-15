import { NextResponse } from "next/server";
import { FoundationLocateInputError, readFoundationLocateResponse } from "@/lib/server/module-foundation/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (request.url.length > 2_048) throw new FoundationLocateInputError("The lookup request is too long.");
    return NextResponse.json(await readFoundationLocateResponse(new URL(request.url).searchParams, request.signal), { headers });
  } catch (error) {
    if (error instanceof FoundationLocateInputError) {
      return NextResponse.json({ transactionHash: null, reason: error.message }, { status: 400, headers });
    }
    return NextResponse.json({ transactionHash: null, reason: "Launch history is temporarily unavailable. Please try again." }, { headers });
  }
}
