import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { tokenDataIndexResetResponse, withExploreAlternate } from
  "../../../../lib/server/explore-index-reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "address" && key !== "chain",
    ) ||
    search.getAll("address").length !== 1 ||
    search.getAll("chain").length > 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = search.get("address")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const chainValue = search.get("chain");
  if (chainValue !== null && chainValue !== "1" && chainValue !== "4663") {
    return NextResponse.json(
      { error: "Unsupported chain" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const chain = chainValue === "4663" ? "robinhood" : "ethereum";
  return withExploreAlternate(tokenDataIndexResetResponse(), `/api/explore/${chain}/presentation?token=${input.toLowerCase()}`);
}
