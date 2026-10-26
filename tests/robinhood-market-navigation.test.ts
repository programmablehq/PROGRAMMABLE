import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRobinhoodPresentationCache,
  readRememberedRobinhoodPresentation,
  rememberRobinhoodPresentation,
  rememberRobinhoodTokenPresentations,
} from "@/components/robinhood-presentation-cache";
import { mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";

const now = Date.parse("2026-09-05T16:00:00Z");
const token = `0x${"ab".repeat(20)}`;
const otherToken = `0x${"cd".repeat(20)}`;
const poolA = `0x${"1".repeat(64)}`;
const poolB = `0x${"2".repeat(64)}`;
const query = `token=${token}`;
function presentation(): RobinhoodCoinPresentation {
  return {
    tokenAddress: token,
    imageUrl: "https://assets.example.com/token.png",
    description: "A token description.",
    links: [{ label: "Website", url: "https://example.com" }],
    market: {
      poolId: poolA, marketCapUsd: 3_270_000, priceUsd: 0.00327,
      liquidityUsd: 200_000, volume24hUsd: 50_000, change24hPercent: 2,
      observedAt: new Date(now - 60_000).toISOString(),
      sourceUrl: "https://dexscreener.com/robinhood/example",
    },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Robinhood market navigation", () => {
  it("stores both chains separately even when their token addresses match", () => {
    const cache = createRobinhoodPresentationCache();
    const rh = presentation(), eth = { ...presentation(), chainId: 1 as const, market: null };
    cache.write(query, { items: [rh], delayed: false }, now, 4663);
    cache.write(query, { items: [eth], delayed: false }, now, 1);
    expect(cache.read(query, now, 4663)?.items).toEqual([rh]);
    expect(cache.read(query, now, 1)?.items).toEqual([eth]);
  });

  it("hands the list presentation to the exact token detail, including metadata", () => {
    vi.stubGlobal("window", {});
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const value = presentation();
    rememberRobinhoodTokenPresentations([value]);
    expect(readRememberedRobinhoodPresentation(`token=${token.toUpperCase()}`)?.items).toEqual([value]);
    expect(readRememberedRobinhoodPresentation(`token=${otherToken}`)).toBeNull();
  });

  it("never restores a previous pool after rejecting a stale new pool", () => {
    vi.stubGlobal("window", {});
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const freshA = presentation();
    const expiredB = { ...freshA, market: { ...freshA.market!, poolId: poolB,
      observedAt: new Date(now - 900_001).toISOString() } };
    rememberRobinhoodPresentation(query, mergeRobinhoodPresentations([], [freshA], now));
    const next = mergeRobinhoodPresentations([freshA], [expiredB], now);
    expect(next.items[0].market).toBeNull();
    rememberRobinhoodPresentation(query, next);
    expect(readRememberedRobinhoodPresentation(query)?.items[0].market).toBeNull();

    rememberRobinhoodTokenPresentations([freshA]);
    rememberRobinhoodTokenPresentations(next.items);
    expect(readRememberedRobinhoodPresentation(query)?.items[0].market).toBeNull();
  });

  it("keeps a complete recent observation through a temporary missing market", () => {
    const cache = createRobinhoodPresentationCache();
    const saved = presentation();
    cache.write(query, mergeRobinhoodPresentations([], [saved], now), now);
    const incoming = [{ ...saved, market: null }];
    cache.write(query, mergeRobinhoodPresentations(cache.read(query, now)!.items, incoming, now), now);
    expect(cache.read(query, now)?.items[0].market).toEqual(saved.market);
    expect(cache.read(query, now)?.items[0].market?.observedAt).toBe(saved.market?.observedAt);
    expect(cache.read(query, now)?.delayed).toBe(true);
  });

  it("keeps account, page and token result membership separate", () => {
    const cache = createRobinhoodPresentationCache();
    const value = mergeRobinhoodPresentations([], [presentation()], now);
    cache.write(`account=${token}&page=1`, value, now);
    expect(cache.read(`page=1&account=${token.toUpperCase()}`, now)?.items).toEqual(value.items);
    expect(cache.read(`account=${otherToken}&page=1`, now)).toBeNull();
    expect(cache.read(`account=${token}&page=2`, now)).toBeNull();
    expect(cache.read(query, now)).toBeNull();
    cache.write(`account=${token}&page=1`, { items: [], delayed: false }, now + 1);
    expect(cache.read(`account=${token}&page=1`, now + 1)?.items).toEqual([]);
  });

  it("expires market values without discarding fresh metadata or renewing timestamps", () => {
    const cache = createRobinhoodPresentationCache();
    cache.write(query, mergeRobinhoodPresentations([], [presentation()], now), now);
    expect(cache.read(query, now + 840_000)?.items[0].market?.poolId).toBe(poolA);
    const expired = cache.read(query, now + 840_001);
    expect(expired?.items[0].market).toBeNull();
    expect(expired?.items[0].imageUrl).toBe(presentation().imageUrl);
    expect(cache.read(query, now + 900_000)).toBeNull();
  });

  it("bounds retained queries and performs no server-side cache reads", () => {
    const cache = createRobinhoodPresentationCache();
    const value = mergeRobinhoodPresentations([], [presentation()], now);
    for (let page = 1; page <= 65; page++) cache.write(`account=${token}&page=${page}`, value, now);
    expect(cache.read(`account=${token}&page=1`, now)).toBeNull();
    expect(cache.read(`account=${token}&page=2`, now)?.items).toEqual(value.items);
    expect(cache.read(`account=${token}&page=65`, now)?.items).toEqual(value.items);
    expect(readRememberedRobinhoodPresentation(query)).toBeNull();
  });
});
