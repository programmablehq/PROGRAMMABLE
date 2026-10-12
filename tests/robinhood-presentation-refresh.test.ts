import { describe, expect, it } from "vitest";
import { mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";

const now = Date.parse("2026-09-05T12:00:00Z");
const saved: RobinhoodCoinPresentation = {
  tokenAddress: `0x${"ab".repeat(20)}`, imageUrl: null, description: null, links: [],
  market: {
    poolId: `0x${"1".repeat(64)}`, marketCapUsd: 3_270_000, priceUsd: .00327,
    liquidityUsd: 200_000, volume24hUsd: 50_000, change24hPercent: 2,
    observedAt: new Date(now - 60_000).toISOString(), sourceUrl: "https://dexscreener.com/robinhood/example",
  },
};

describe("Robinhood market refresh", () => {
  it("keeps real artwork and links through missing/default metadata without carrying them across chains", () => {
    const previous = { ...saved, imageUrl: "https://example.com/coin.png", description: "Coin description",
      links: [{ label: "X", url: "https://x.com/coin" }] };
    for (const imageUrl of [null, "/brand/loop/programmable-module-token-default-dark.png"]) {
      const next = { ...saved, imageUrl };
      const item = mergeRobinhoodPresentations([previous], [next], now).items[0];
      expect(item).toMatchObject({ imageUrl: previous.imageUrl, description: previous.description, links: previous.links });
      expect(mergeRobinhoodPresentations([previous], [{ ...next, chainId: 1 }], now).items[0].imageUrl).toBe(imageUrl);
    }
  });
  it("keeps a recent complete valuation when a newer partial response omits supply data, without refreshing its age", () => {
    const incomplete = { ...saved, market: { ...saved.market!, marketCapUsd: null, fdvUsd: null,
      priceUsd: .004, observedAt: new Date(now).toISOString() } };
    const result = mergeRobinhoodPresentations([saved], [incomplete], now);
    expect(result.items[0].market).toBe(saved.market);
    expect(result.delayed).toBe(true);
    expect(mergeRobinhoodPresentations([saved], [incomplete], now + 120_001).items[0].market).toBe(incomplete.market);
  });

  it("never transfers the same token address's valuation across chains", () => {
    const ethereum = { ...saved, chainId: 1 as const, market: null };
    expect(mergeRobinhoodPresentations([saved], [ethereum], now).items[0].market).toBeNull();
    expect(mergeRobinhoodPresentations([{ ...saved, chainId: 1 }], [ethereum], now).items[0].market).toBe(saved.market);
  });

  it("keeps the entire recent observation when optional market data is unavailable", () => {
    const result = mergeRobinhoodPresentations([saved], [{ ...saved, market: null }], now);
    expect(result.items[0].market).toBe(saved.market);
    expect(result.delayed).toBe(true);
    expect(result.items[0].market?.observedAt).toBe(saved.market?.observedAt);
  });

  it("expires saved values after three minutes, including failed requests", () => {
    for (const incoming of [null, [{ ...saved, market: null }]]) {
      expect(mergeRobinhoodPresentations([saved], incoming, now + 120_000).items[0].market).toBe(saved.market);
      const result = mergeRobinhoodPresentations([saved], incoming, now + 120_001);
      expect(result.items[0].market).toBeNull();
      expect(result.delayed).toBe(true);
    }
  });

  it("accepts new values and zero without combining fields from different observations", () => {
    const next = { ...saved, market: { ...saved.market!, marketCapUsd: 0, liquidityUsd: null, observedAt: new Date(now).toISOString() } };
    const result = mergeRobinhoodPresentations([saved], [next], now);
    expect(result.items[0].market).toBe(next.market);
    expect(result.items[0].market?.liquidityUsd).toBeNull();
    expect(result.delayed).toBe(false);
  });

  it("does not roll back to an older response or animate a fabricated zero", () => {
    const old = { ...saved, market: { ...saved.market!, marketCapUsd: 3_000_000, observedAt: new Date(now - 90_000).toISOString() } };
    expect(mergeRobinhoodPresentations([saved], [old], now).items[0].market).toBe(saved.market);
    expect(mergeRobinhoodPresentations([], [{ ...saved, market: null }], now).items[0].market).toBeNull();
  });

  it("keeps successful list membership and does not transfer another token's values", () => {
    expect(mergeRobinhoodPresentations([saved], [], now).items).toEqual([]);
    const other = { ...saved, tokenAddress: `0x${"cd".repeat(20)}`, market: null };
    expect(mergeRobinhoodPresentations([saved], [other], now).items).toEqual([other]);
    const same = { ...saved, tokenAddress: saved.tokenAddress.toUpperCase(), market: null };
    expect(mergeRobinhoodPresentations([saved], [same], now).items[0].market).toBe(saved.market);
  });

  it("clears expired observations instead of falling back to an even older response", () => {
    const expired = { ...saved, market: { ...saved.market!, observedAt: new Date(now - 181_000).toISOString() } };
    const older = { ...expired, market: { ...expired.market, observedAt: new Date(now - 200_000).toISOString() } };
    for (const incoming of [expired, older]) {
      const result = mergeRobinhoodPresentations([expired], [incoming], now);
      expect(result.items[0].market).toBeNull();
      expect(result.delayed).toBe(true);
    }
  });

  it.each(["invalid", new Date(now + 1).toISOString()])("rejects an invalid or future observation %s", (observedAt) => {
    const incoming = { ...saved, market: { ...saved.market!, observedAt } };
    expect(mergeRobinhoodPresentations([], [incoming], now).items[0].market).toBeNull();
    expect(mergeRobinhoodPresentations([saved], [incoming], now).items[0].market).toBe(saved.market);
  });

  it("does not substitute a previous pool's market for a new pool", () => {
    const otherPool = { ...saved, market: { ...saved.market!, poolId: `0x${"2".repeat(64)}`, observedAt: new Date(now - 90_000).toISOString() } };
    expect(mergeRobinhoodPresentations([saved], [otherPool], now).items[0].market).toBe(otherPool.market);
    const expired = { ...otherPool, market: { ...otherPool.market, observedAt: new Date(now - 200_000).toISOString() } };
    expect(mergeRobinhoodPresentations([saved], [expired], now).items[0].market).toBeNull();
  });
});
