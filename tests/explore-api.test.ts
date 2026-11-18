import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/explore/route";

const RESET_BODY = {
  error: "Token data is temporarily unavailable",
  status: "index_rebuilding",
} as const;

function request(query = "") {
  const suffix = query === "" ? "" : `?${query}`;
  return new NextRequest(`http://localhost/api/explore${suffix}`);
}

function expectResetHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBe("3600");
  expect(response.headers.get("x-programmable-indexing-status")).toBe("reset");
  for (const header of response.headers.keys()) {
    expect(header).not.toMatch(/(?:provider|read-source|market-source|launch-source|rpc)/iu);
  }
}

describe("Explore index reset API", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "chain=1&limit=9&page=1&sort=newest",
    "chain=4663&limit=9&page=1&sort=newest",
    "chain=1&model=classic&socials=yes&q=%24TOKEN",
    `chain=1&sort=market-cap&page=2&rankingCommitment=sha256:${"ab".repeat(32)}`,
  ])("returns the deterministic reset contract without outbound work: %s", async (query) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Outbound fetch must not run"),
    );

    const response = await GET(request(query));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(RESET_BODY);
    expectResetHeaders(response);
    const alternate = new URL(response.headers.get("link")!.match(/^<([^>]+)>/)![1], "http://localhost");
    const params = new URLSearchParams(query);
    expect(alternate.pathname).toBe(params.get("chain") === "4663" ? "/api/explore/robinhood" : "/api/explore/ethereum");
    expect(alternate.searchParams.get("q")).toBe(params.get("q")?.replace(/^\$/, "") ?? null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["page=0", "Unsupported query parameters"],
    ["limit=1&limit=2", "Unsupported query parameters"],
    ["unknown=1", "Unsupported query parameters"],
    ["socials=maybe", "Unsupported socials filter"],
    ["model=deep", "Unsupported launch model filter"],
    ["q=%00", "Unsupported search query"],
    ["chain=10", "Unsupported chain"],
    ["chain=4663&sort=trending", "Trending discovery is available on Ethereum only"],
    ["chain=4663&sort=oldest", "Robinhood Explore supports newest sort only"],
    ["chain=1&sort=market-cap&page=2", "Market-cap pages after page 1 require rankingCommitment"],
  ])("preserves request validation for %s", async (query, error) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-indexing-status")).toBeNull();
  });

  it("contains no legacy identity, market-provider, RPC, or fetch dependency", () => {
    const source = readFileSync(
      new URL("../app/api/explore/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/gmgn|dexscreener|bitquery|envio/iu);
    expect(source).not.toMatch(/createPublicClient|readFinalized|\bfetch\s*\(/u);
  });
});
