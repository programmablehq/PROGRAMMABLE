import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "1" }) }),
}));

import LaunchPage from "../app/launch/page";
import { ViewChainProvider } from "../components/view-chain";
import { POST } from "../app/api/launch/preflight/route";
import { createStockPairedDraft } from "../lib/launch";
import { STOCK_PAIRED_ETH_QUOTE_ASSETS } from "../lib/stock-paired";

const publicAccount = "0x1111111111111111111111111111111111111111";

function publicPreflightRequest() {
  return new NextRequest("http://localhost/api/launch/preflight", {
    method: "POST",
    body: JSON.stringify({
      account: publicAccount,
      walletChainId: "0x1",
      draft: {
        ...createStockPairedDraft(),
        tokenName: "Historical Stock Pair",
        tokenSymbol: "HSP",
        tokenDescription: "Closed launch model regression test",
        initialBuyEth: "0.01",
        stockQuoteAsset: STOCK_PAIRED_ETH_QUOTE_ASSETS[0].address,
        launchSalt: `0x${"42".repeat(32)}`,
      },
    }),
  });
}

describe("Stock-Paired launch closure", () => {
  it("removes Stock-Paired from the public launch picker", async () => {
    const html = renderToStaticMarkup(
      createElement(ViewChainProvider, null, await LaunchPage()),
    );

    expect(html).toContain('data-launch-model-option="modules"');
    expect(html).not.toContain('data-launch-model-option="classic"');
    expect(html).not.toContain('data-launch-model-option="stock-paired"');
    expect(html).not.toContain("<strong>Stock-Paired</strong>");
  });

  it("rejects a valid direct launch request with a stable response", async () => {
    const result = await POST(publicPreflightRequest());

    expect(result.status).toBe(410);
    expect(result.headers.get("cache-control")).toBe("no-store");
    await expect(result.json()).resolves.toEqual({
      code: "stock_paired_launches_closed",
      error: "New Stock-Paired launches are no longer available",
    });
  });
});
