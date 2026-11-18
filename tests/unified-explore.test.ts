import { describe, expect, it } from "vitest";
import { exploreIdentityKey, selectUnifiedExplorePage, type UnifiedExploreIdentity } from "@/lib/unified-explore";
import { PINNED_ROBINHOOD_TOKEN } from "@/lib/robinhood-explore-policy";

const row = (n: number, chainId: 1 | 4663 = 4663, mode: "module" | "custom" = "custom"): UnifiedExploreIdentity => ({
  chainId, tokenAddress: `0x${n.toString(16).padStart(40, "0")}`, hookAddress: null,
  name: `Coin ${n}`, symbol: `C${n}`, mode, launchedAt: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`,
});

describe("Unified Explore catalog", () => {
  it("ranks both complete catalogs together before pagination", () => {
    const catalog = Array.from({ length: 18 }, (_, i) => row(i + 1, i % 2 ? 1 : 4663));
    const values = new Map(catalog.map((r, i) => [exploreIdentityKey(r), i * 100]));
    const result = selectUnifiedExplorePage(catalog, 2, "", { sort: "highest" }, values, 6);
    expect(result.items).toEqual(catalog.slice(6, 12).toReversed());
    expect(result.page).toEqual({ number: 2, size: 6, totalItems: 18, matchingItems: 18, totalPages: 3, hasMore: true });
  });

  it("orders launches from different chains by timestamp rather than block height", () => {
    const ethereum = { ...row(2, 1), blockNumber: "26000000" };
    const robinhood = { ...row(3), blockNumber: "1200000" };
    expect(selectUnifiedExplorePage([ethereum, robinhood], 1, "", { sort: "newest" }, new Map(), 10).items)
      .toEqual([robinhood, ethereum]);
  });

  it("keeps the same address on different chains as separate launches and valuations", () => {
    const rh = row(1), eth = row(1, 1);
    const caps = new Map([[exploreIdentityKey(rh), 200], [exploreIdentityKey(eth), 900]]);
    expect(selectUnifiedExplorePage([rh, eth], 1, "", { sort: "highest" }, caps, 10).items).toEqual([eth, rh]);
    expect(() => selectUnifiedExplorePage([rh, { ...rh }], 1, "", { sort: "highest" }, caps, 10))
      .toThrow("Conflicting launch identities");
  });

  it("shares search and Custom/Module filters across chains, keeping the existing Programmable pin", () => {
    const pinned = { ...row(1), tokenAddress: PINNED_ROBINHOOD_TOKEN };
    const catalog = [pinned, row(2, 4663, "module"), row(3, 1)];
    expect(selectUnifiedExplorePage(catalog, 1, "$C3", { sort: "highest", mode: "custom" }, new Map(), 10).items)
      .toEqual([pinned, catalog[2]]);
    expect(selectUnifiedExplorePage(catalog, 1, "", { sort: "highest", mode: "module" }, new Map(), 10).items)
      .toEqual([pinned, catalog[1]]);
    expect(selectUnifiedExplorePage(catalog, 1, "no match", { sort: "newest" }, new Map(), 10).page.matchingItems).toBe(0);
  });

  it("returns only matching identities for catalog searches, including a matching pinned token", () => {
    const pinned = { ...row(1), symbol: "V4", tokenAddress: PINNED_ROBINHOOD_TOKEN };
    const heist = { ...row(2), name: "HEIST", symbol: "HEIST" };
    const search = (query: string) => selectUnifiedExplorePage([pinned, heist], 1, query,
      { sort: "highest", matchesOnly: true }, new Map(), 6);
    expect(search("HEIST").items).toEqual([heist]);
    expect(search("$V4").items).toEqual([pinned]);
    expect(search("missing")).toMatchObject({ items: [], page: { totalItems: 0, matchingItems: 0 } });
  });

  it("puts unknown or invalid market values after measured values without inventing zero", () => {
    const catalog = [row(1), row(2, 1), row(3)];
    const values = new Map([[exploreIdentityKey(catalog[0]), NaN], [exploreIdentityKey(catalog[1]), 10]]);
    expect(selectUnifiedExplorePage(catalog, 100, "", { sort: "lowest" }, values, 10).items[0]).toBe(catalog[1]);
    expect(selectUnifiedExplorePage([], 100, "", { sort: "highest" }, values, 10).page.number).toBe(1);
  });
});
