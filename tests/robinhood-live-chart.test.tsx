import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendRobinhoodLivePrice, RobinhoodChart, robinhoodLivePriceGeometry, robinhoodLivePriceStatus, type RobinhoodLivePrice } from "@/components/robinhood-chart";
import { ROBINHOOD_MARKET_MAX_AGE_MS, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";

const poolId = `0x${"ab".repeat(32)}`;
const now = Date.parse("2026-09-20T10:00:00.000Z");
const market = (overrides: Partial<RobinhoodCoinMarket> = {}) => ({
  poolId, source: "uniswap-v4" as const, priceUsd: 0.00042, marketCapUsd: null,
  liquidityUsd: null, volume24hUsd: null, change24hPercent: null,
  observedAt: new Date(now).toISOString(), sourceUrl: "https://example.com/pool", ...overrides,
});
afterEach(() => vi.useRealTimers());

describe("Robinhood first party live chart", () => {
  it("starts with one observed price and no fabricated line or candles", () => {
    vi.useFakeTimers({ now });
    const html = renderToStaticMarkup(<RobinhoodChart poolId={poolId} name="First coin" market={market()} />);
    expect(html).toContain("Live price");
    expect(html).toContain("$0.00042");
    expect(html).toContain("1 price observation collected during this visit");
    expect(html).not.toContain("Prices observed during this visit");
    expect(html).not.toContain("<figcaption");
    expect(html).toContain("<circle");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("<iframe");
  });

  it("keeps the existing embedded chart for legacy or Dexscreener markets", () => {
    const legacy = renderToStaticMarkup(<RobinhoodChart poolId={poolId} name="First coin" />);
    const dex = renderToStaticMarkup(<RobinhoodChart poolId={poolId} name="First coin" market={{ ...market(), source: "dexscreener" }} />);
    expect(legacy).toContain(`https://dexscreener.com/robinhood/${poolId}?embed=1`);
    expect(dex).toContain("<iframe");
    expect(dex).not.toContain("<svg");
    expect(renderToStaticMarkup(<RobinhoodChart poolId="invalid" name="Coin" market={market()} />)).toContain("Chart unavailable.");
  });

  it("never plots an unpriced, stale, future, malformed or other-pool observation", () => {
    const points: readonly RobinhoodLivePrice[] = [];
    for (const invalid of [
      { priceUsd: null }, { priceUsd: NaN }, { priceUsd: Infinity }, { priceUsd: -1 }, { priceUsd: 0 },
      { observedAt: "not a date" },
      { observedAt: new Date(now - ROBINHOOD_MARKET_MAX_AGE_MS - 1).toISOString() },
      { observedAt: new Date(now + 30_001).toISOString() },
      { poolId: `0x${"cd".repeat(32)}` },
    ]) expect(appendRobinhoodLivePrice(points, poolId, market(invalid), now)).toBe(points);
    vi.useFakeTimers({ now });
    const unavailable = renderToStaticMarkup(<RobinhoodChart poolId={poolId} name="First coin" market={market({ priceUsd: null })} />);
    expect(unavailable).toContain("Live price is unavailable.");
    expect(unavailable).not.toContain("<circle");
    expect(unavailable).not.toContain("<iframe");
  });

  it("adds real observations in order without treating cached responses as new prices", () => {
    const first = appendRobinhoodLivePrice([], poolId, market(), now);
    expect(first).toEqual([{ time: now, price: 0.00042 }]);
    expect(appendRobinhoodLivePrice(first, poolId.toUpperCase(), market(), now)).toBe(first);
    expect(appendRobinhoodLivePrice(first, poolId, market({ observedAt: new Date(now - 10_000).toISOString() }), now)).toBe(first);
    expect(appendRobinhoodLivePrice(first, poolId, null, now)).toBe(first);
    const second = appendRobinhoodLivePrice(first, poolId, market({ priceUsd: 0.0005, observedAt: new Date(now + 10_000).toISOString() }), now + 10_000);
    expect(second).toEqual([...first, { time: now + 10_000, price: 0.0005 }]);
    expect(robinhoodLivePriceGeometry(second)?.path).toMatch(/^M[\d.,]+ L[\d.,]+$/);
  });

  it("bounds this visit to the latest 120 samples and leaves gaps when updates stop", () => {
    let points: readonly RobinhoodLivePrice[] = [];
    for (let index = 0; index < 150; index++) {
      const time = now + index * 10_000;
      points = appendRobinhoodLivePrice(points, poolId, market({ observedAt: new Date(time).toISOString() }), time);
    }
    expect(points).toHaveLength(120);
    expect(points[0].time).toBe(now + 30 * 10_000);
    expect(robinhoodLivePriceGeometry([{ time: now, price: 1 }, { time: now + ROBINHOOD_MARKET_MAX_AGE_MS + 1, price: 2 }])?.path).toMatch(/^M[\d.,]+ M[\d.,]+$/);
  });

  it("marks failed updates immediately and ages the last observation without refreshing it", () => {
    const observation = { time: now, price: 0.00042 };
    expect(robinhoodLivePriceStatus(observation, now, market())).toBe("Live price");
    expect(robinhoodLivePriceStatus(observation, now, null)).toBe("Price update unavailable");
    expect(robinhoodLivePriceStatus(observation, now, market({ priceUsd: NaN }))).toBe("Price update unavailable");
    expect(robinhoodLivePriceStatus(observation, now, market({ observedAt: "invalid" }))).toBe("Price update unavailable");
    expect(robinhoodLivePriceStatus(observation, now + ROBINHOOD_MARKET_MAX_AGE_MS + 1, market())).toBe("Price updates delayed");
    expect(observation.time).toBe(now);
    expect(robinhoodLivePriceStatus(undefined, now, market())).toBe("Waiting for a price update");
  });

  it("keeps tiny, large and unchanged prices finite in the chart", () => {
    for (const prices of [[1e-320], [1e-320, 2e-320], [1e307, 1e308], [0.0004, 0.0004]]) {
      const geometry = robinhoodLivePriceGeometry(prices.map((price, index) => ({ price, time: now + index * 10_000 })));
      expect(geometry?.path).not.toMatch(/NaN|Infinity/);
      expect(geometry?.last.x).toBeGreaterThanOrEqual(24);
      expect(geometry?.last.y).toBeGreaterThanOrEqual(24);
      expect(geometry?.last.y).toBeLessThanOrEqual(296);
    }
  });
});
