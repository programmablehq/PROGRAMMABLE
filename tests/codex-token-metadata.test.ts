import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const codex = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/server/codex-market", () => ({ codexQuery: codex.query }));
import { readCodexTokenMetadata } from "@/lib/server/codex-token-metadata";
const address = `0x${"ab".repeat(20)}`;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CODEX_API_KEY", "test-only"); });
afterEach(() => vi.unstubAllEnvs());
describe("Codex display metadata", () => {
  it("reads artwork and socials for the exact chain and address without inventing metadata", async () => {
    codex.query.mockResolvedValue({ tokens: [{ address, networkId: 1,
      info: { imageLargeUrl: "javascript:bad", imageSmallUrl: "https://example.com/coin.png", description: "Coin" },
      socialLinks: { website: "https://example.com/", twitter: "https://x.com/coin", telegram: "javascript:bad" } }] });
    expect((await readCodexTokenMetadata([address, address.toUpperCase().replace("0X", "0x")], 1)).get(address)).toEqual({
      imageUrl: "https://example.com/coin.png", description: "Coin",
      links: [{ label: "Website", url: "https://example.com/" }, { label: "X", url: "https://x.com/coin" }],
    });
    expect(codex.query.mock.calls[0][1]).toEqual({ ids: [{ address, networkId: 1 }] });
  });
  it("never uses another chain's artwork and tolerates provider failure", async () => {
    codex.query.mockResolvedValue({ tokens: [{ address, networkId: 4663, info: { imageLargeUrl: "https://example.com/wrong.png" } }] });
    expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
    codex.query.mockRejectedValue(new Error("temporarily unavailable"));
    expect((await readCodexTokenMetadata([address], 1)).size).toBe(0);
  });
});
