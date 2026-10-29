import { describe, expect, it } from "vitest";
import { robinhoodExploreResponsePolicy } from "../lib/server/robinhood-index/response-cache";

const now = Date.parse("2026-10-29T15:00:00.000Z");
const observed = (ageSeconds: number) => new Date(now - ageSeconds * 1_000).toISOString();

describe("Robinhood response cache evidence boundary", () => {
  it("retains the normal cache windows while evidence is fresh", () => {
    expect(robinhoodExploreResponsePolicy("ready", observed(120), now)).toEqual({
      status: "ready", cacheControl: "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    });
  });
  it("bounds the total cache lifetime by the remaining evidence freshness", () => {
    for (let remaining = 3; remaining <= 48; remaining++) {
      const policy = robinhoodExploreResponsePolicy("ready", observed(300 - remaining), now);
      const [, fresh, stale] = /s-maxage=(\d+), stale-while-revalidate=(\d+)/u.exec(policy.cacheControl)!;
      expect(Number(fresh) + Number(stale)).toBeLessThanOrEqual(remaining - 2);
      expect(Number(fresh)).toBeLessThanOrEqual(15);
      expect(Number(stale)).toBeLessThanOrEqual(30);
    }
  });
  it("marks an observation that expired during presentation loading as stale", () => {
    const updatedAt = observed(299);
    expect(robinhoodExploreResponsePolicy("ready", updatedAt, now + 2_000)).toEqual({
      status: "stale", cacheControl: "no-store",
    });
  });
  it.each([null, "invalid", new Date(now + 61_000).toISOString()])("does not cache invalid evidence", updatedAt => {
    expect(robinhoodExploreResponsePolicy("ready", updatedAt, now)).toEqual({ status: "stale", cacheControl: "no-store" });
  });
  it.each(["stale", "syncing", "partial", "unavailable"] as const)("preserves %s without caching", status => {
    expect(robinhoodExploreResponsePolicy(status, observed(1), now)).toEqual({ status, cacheControl: "no-store" });
  });
});
