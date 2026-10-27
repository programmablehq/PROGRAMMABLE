import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const codex = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/server/codex-market", () => ({ codexQuery: codex.query }));
let readCodexTokenMetadata: typeof import("@/lib/server/codex-token-metadata").readCodexTokenMetadata;
import { mergeCoinMetadata } from "@/lib/coin-metadata";
const address = `0x${"ab".repeat(20)}`;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("CODEX_API_KEY", "test-only");
  ({ readCodexTokenMetadata } = await import("@/lib/server/codex-token-metadata"));
});
afterEach(() => vi.unstubAllEnvs());
describe("Codex display metadata", () => {
  it("reads artwork and socials for the exact chain and address without inventing metadata", async () => {
    codex.query.mockResolvedValue({ tokens: [{ address, networkId: 1, name: "Example", symbol: "EXAMPLE",
      info: { imageLargeUrl: "javascript:bad", imageSmallUrl: "https://example.com/coin.png", description: "Coin" },
      socialLinks: { website: "https://example.com/", twitter: "https://x.com/coin", telegram: "javascript:bad" } }] });
    expect((await readCodexTokenMetadata([address, address.toUpperCase().replace("0X", "0x")], 1)).get(address)).toEqual({
      name: "Example", symbol: "EXAMPLE", imageUrl: "https://example.com/coin.png", description: "Coin",
      links: [{ label: "Website", url: "https://example.com/" }, { label: "X", url: "https://x.com/coin" }],
    });
    expect(codex.query.mock.calls[0][1]).toEqual({ ids: [{ address, networkId: 1 }] });
  });
  it("adds missing Codex links without replacing the project's uploaded artwork or corrected links", () => {
    expect(mergeCoinMetadata({ imageUrl: "/token-images/hive.png", description: null,
      links: [{ label: "x", url: "https://x.com/corrected" }] }, {
      imageUrl: "https://example.com/stale.png", description: "From Codex",
      links: [{ label: "X", url: "https://x.com/old" }, { label: "Website", url: "https://example.com/" }],
    })).toEqual({ imageUrl: "/token-images/hive.png", description: "From Codex",
      links: [{ label: "x", url: "https://x.com/corrected" }, { label: "Website", url: "https://example.com/" }] });
  });
  it("never uses another chain's artwork and tolerates provider failure", async () => {
    codex.query.mockResolvedValue({ tokens: [{ address, networkId: 4663, info: { imageLargeUrl: "https://example.com/wrong.png" } }] });
    expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
    codex.query.mockRejectedValue(new Error("temporarily unavailable"));
    expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
  });
  it("shares both present and absent metadata between Explore and coin pages", async () => {
    const missing = `0x${"cd".repeat(20)}`;
    codex.query.mockResolvedValue({ tokens: [{ address, networkId: 1, name: "Example", symbol: "EXAMPLE" }, null] });
    const [catalog, coin] = await Promise.all([
      readCodexTokenMetadata([address, missing], 1), readCodexTokenMetadata([address], 1),
    ]);
    expect(catalog.get(address)).toEqual(coin.get(address));
    catalog.get(address)!.links.push({ label: "Wrong", url: "https://example.com/" });
    for (let index = 0; index < 10; index++) {
      expect((await readCodexTokenMetadata([address], 1)).get(address)?.links).toEqual([]);
      expect((await readCodexTokenMetadata([missing], 1)).size).toBe(0);
    }
    expect(codex.query).toHaveBeenCalledTimes(1);
    await readCodexTokenMetadata([address], 4663);
    expect(codex.query).toHaveBeenCalledTimes(2);
  });
  it("does not save failed provider calls as absent metadata", async () => {
    codex.query.mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ tokens: [{ address, networkId: 1, name: "Recovered" }] });
    expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
    expect((await readCodexTokenMetadata([address], 1)).get(address)?.name).toBe("Recovered");
  });
  it("rechecks absent metadata before the longer artwork cache expires", async () => {
    vi.useFakeTimers();
    try {
      codex.query.mockResolvedValueOnce({ tokens: [] })
        .mockResolvedValueOnce({ tokens: [{ address, networkId: 1, name: "Now indexed" }] });
      expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
      vi.setSystemTime(Date.now() + 900_001);
      expect((await readCodexTokenMetadata([address], 1)).get(address)?.name).toBe("Now indexed");
      expect(codex.query).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
