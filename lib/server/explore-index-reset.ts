import { NextResponse } from "next/server";

const INDEX_RESET_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Retry-After": "3600",
  "X-Programmable-Indexing-Status": "reset",
});

export const TOKEN_DATA_INDEX_RESET_BODY = Object.freeze({
  error: "Token data is temporarily unavailable",
  status: "index_rebuilding",
} as const);

export type ResetChartRange = "1h" | "1d" | "1w" | "all";

export function exploreIndexResetJson(body: unknown) {
  return NextResponse.json(body, {
    status: 503,
    headers: INDEX_RESET_HEADERS,
  });
}

export function tokenDataIndexResetResponse(alternate?: string) {
  const response = exploreIndexResetJson(TOKEN_DATA_INDEX_RESET_BODY);
  if (alternate) response.headers.set("Link", `<${alternate}>; rel="alternate"; type="application/json"`);
  return response;
}

export function tokenChartIndexResetResponse(input: Readonly<{
  address: `0x${string}`;
  range: ResetChartRange;
}>) {
  return exploreIndexResetJson({
    schemaVersion: "programmable.market-chart-error.v2",
    source: "programmable",
    status: "unavailable",
    generatedAt: new Date().toISOString(),
    address: input.address,
    range: input.range,
    reason: "identity-unavailable",
    error: "Price history is temporarily unavailable",
  });
}
