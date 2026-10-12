import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const codex = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/server/codex-market", () => ({ codexQuery: codex.query }));
import { readCodexTokenMetadata } from "@/lib/server/codex-token-metadata";
import { mergeCoinMetadata } from "@/lib/coin-metadata";
const address = `0x${"ab".repeat(20)}`;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CODEX_API_KEY", "test-only"); });
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
});
