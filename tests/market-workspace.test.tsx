import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chartMarketCap } from "@/lib/market/chart-presentation";
import { isDiscoverableRobinhoodToken, isVisibleRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { CodexPriceChart } from "@/components/codex-price-chart";
import { codexChartCache } from "@/lib/market/codex-chart-cache";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";

const market: RobinhoodCoinMarket = { poolId: `0x${"ef".repeat(32)}`, priceUsd: .01, marketCapUsd: 100_000,
  liquidityUsd: 10_000, volume24hUsd: 0, change24hPercent: 0, observedAt: new Date().toISOString(), sourceUrl: "https://www.codex.io/" };

describe("Explore cleanup", () => {
  it.each([
    "0xc60ba256b44334a0cd2c7242e98b88f031abb006", "0xeeb9137c2b672569ab7a85b167c3e35f49a4b1cc",
    "0xd53f94918372462e8f28eba5073cdff2e6e2cd23", "0x105f6435a4ab3c03c13d4a0db67961344694d0cc",
    "0x5906ecde6e9e1196eaf79ddfdf7abf897e313ca2",
  ])("retains the requested canonical coin %s", address => {
    expect(isDiscoverableRobinhoodToken(address.toUpperCase())).toBe(true);
  });
  it("hides old entries without deleting their direct records or suppressing future launches", () => {
    const old = "0x987de464bde48979ef92592e196cadb926602768";
    expect(isDiscoverableRobinhoodToken(old)).toBe(false);
    expect(isVisibleRobinhoodToken(old)).toBe(true);
    expect(isDiscoverableRobinhoodToken(`0x${"ab".repeat(20)}`)).toBe(true);
  });
});

describe("Market cap chart", () => {
  it("scales historical closes with the reported supply basis", () => {
    expect(chartMarketCap(.02, market)).toBe(200_000);
    expect(chartMarketCap(.01, market)).toBe(100_000);
    expect(chartMarketCap(.02, { ...market, marketCapUsd: null, fdvUsd: 150_000 })).toBe(300_000);
  });
  it("does not invent capitalization from missing or invalid price and supply data", () => {
    for (const price of [undefined, 0, -1, NaN, Infinity]) expect(chartMarketCap(price, market)).toBeNull();
    expect(chartMarketCap(.02, { ...market, priceUsd: 0 })).toBeNull();
    expect(chartMarketCap(.02, { ...market, marketCapUsd: null })).toBeNull();
  });
  it("keeps a last-known-value chart visible when the selected window has no trades", async () => {
    const token = `0x${"ba".repeat(20)}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tokenAddress: token, chainId: 4663,
      range: "1D", source: "codex", observedAt: new Date().toISOString(), points: [] })));
    try {
      await codexChartCache.load(token, 4663, "1D");
      const html = renderToStaticMarkup(<CodexPriceChart tokenAddress={token} chainId={4663} name="Quiet coin" market={market} />);
      expect(html).toContain("last known market capitalization");
      expect(html).toContain('d="M16,160 L784,160"');
      expect(html).toContain("$100K");
      expect(html).not.toContain(">No trades in this period.");
      expect(html).not.toContain("recorded prices");
    } finally { vi.unstubAllGlobals(); }
  });
  it("shows known history with a delay label when returning during a provider outage", async () => {
    const token = `0x${"bc".repeat(20)}`, now = Date.now();
    const chart = { tokenAddress: token, chainId: 4663, range: "1D", source: "codex", observedAt: new Date(now).toISOString(), points: [{ time: now - 60_000, price: .01 }, { time: now, price: .02 }] };
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(chart)).mockRejectedValue(new Error("Provider unavailable")));
    try {
      vi.resetModules();
      const { codexChartCache: freshCache } = await import("@/lib/market/codex-chart-cache");
      const { CodexPriceChart: FreshChart } = await import("@/components/codex-price-chart");
      await freshCache.load(token, 4663, "1D");
      vi.setSystemTime(now + 180_001);
      await expect(freshCache.load(token, 4663, "1D")).rejects.toThrow();
      const html = renderToStaticMarkup(<FreshChart tokenAddress={token} chainId={4663} name="Known coin" market={market} />);
      expect(html).toContain("2 recorded prices");
      expect(html).toContain("Price updates delayed");
      expect(html).not.toContain("Chart is temporarily unavailable");
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
