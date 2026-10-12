vi.mock("@/lib/server/confirming-launches", () => ({ readConfirmingEthereumLaunches: vi.fn().mockResolvedValue([]) }));
import { OWNER_HIDDEN_EXPLORE_IDENTITIES_V1 } from "@/lib/explore-public-visibility";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";

vi.mock("server-only", () => ({}));
const sources = vi.hoisted(() => ({ rh: vi.fn(), eth: vi.fn(), rhMarkets: vi.fn(), ethMarkets: vi.fn(), presentations: vi.fn() }));
const recent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ readRecentFoundationLaunches: recent }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodExploreCatalog: sources.rh }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumUnifiedExploreCatalog: sources.eth }));
vi.mock("@/lib/server/robinhood-presentation", () => ({ readRobinhoodMarkets: sources.rhMarkets, readRobinhoodPresentations: sources.presentations }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexMarkets: sources.ethMarkets }));
const metadata = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/codex-token-metadata", () => ({ readCodexTokenMetadata: metadata }));
import { readConfirmingEthereumLaunches } from "@/lib/server/confirming-launches";
import { readUnifiedLaunches } from "@/lib/server/unified-explore";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

const address = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`;
const pool = `0x${"aa".repeat(32)}`;
const rh = { tokenAddress: address, name: "RH token", symbol: "RH", sourceKind: undefined, poolId: pool,
  hookAddress: other, launchedAt: "2026-10-02T10:00:00Z" } as RobinhoodLaunch;
const eth = { tokenAddress: address, name: "ETH custom", symbol: "ETHC", poolId: pool, hookAddress: other,
  launchCategoryProvenance: { category: "custom" }, launchedAt: "2026-10-01T10:00:00Z" } as CanonicalTokenExploreEntry;
const market = (cap: number): RobinhoodCoinMarket => ({ poolId: pool, marketCapUsd: cap, priceUsd: 1,
  liquidityUsd: 5, volume24hUsd: 2, change24hPercent: 0, sourceUrl: "https://www.codex.io/", observedAt: new Date().toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  metadata.mockResolvedValue(new Map());
  recent.mockResolvedValue([]);
  sources.rh.mockResolvedValue({ status: "ready", updatedAt: "2026-10-03T10:00:00Z", items: [rh], sourceEvidence: { verified: "rh" } });
  sources.eth.mockResolvedValue({ status: "ready", updatedAt: "2026-10-03T10:00:00Z", entries: [eth], sourceEvidence: { verified: "eth" } });
  sources.rhMarkets.mockResolvedValue(new Map([[address, market(20)]]));
  sources.ethMarkets.mockResolvedValue(new Map([[address, market(100)], [other, market(10000)]]));
  sources.presentations.mockImplementation(async (rows, markets) => rows.map((row: RobinhoodLaunch) => ({
    tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [], market: markets.get(row.tokenAddress),
  })));
});

describe("Unified verified source adapter", () => {
  it("enriches only the visible Ethereum identities and keeps artwork when market data is missing", async () => {
    sources.ethMarkets.mockResolvedValue(new Map());
    metadata.mockResolvedValue(new Map([[address, { imageUrl: "https://example.com/coin.png", description: null, links: [] }]]));
    const result = await readUnifiedLaunches();
    expect(metadata).toHaveBeenCalledWith([address], 1);
    expect(result.presentations.find(row => row.chainId === 1)).toMatchObject({ imageUrl: "https://example.com/coin.png", market: null });
    expect(result.presentations.find(row => row.chainId === 4663)?.imageUrl).toBeNull();
  });
  it("shows a receipt observation before indexing and replaces it by exact chain/token identity", async () => {
    const row = { chainId: 1 as const, confirmation: "confirming" as const, observationExpiresAt: Date.now() + 30_000,
      category: "custom" as const, mode: "custom" as const, tokenAddress: other, name: "Fresh", symbol: "NEW",
      hookAddress: address, launchId: pool, creator: address, transactionHash: pool, blockHash: pool,
      blockNumber: "123", poolId: pool, quoteAsset: address, launchedAt: "2026-10-11T10:00:00Z", decimals: 18 };
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([row]);
    expect((await readUnifiedLaunches(1, "NEW")).items).toEqual([expect.objectContaining({ confirmation: "confirming" })]);
    sources.eth.mockResolvedValue({ status: "ready", entries: [{ ...eth, tokenAddress: other }], sourceEvidence: {}, updatedAt: null });
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([row]);
    const canonical = (await readUnifiedLaunches()).items.filter(item => item.chainId === 1 && item.tokenAddress === other);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).not.toHaveProperty("confirmation");
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([{ ...row, tokenAddress: OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.find(item => item.chainId === 1)!.identity }]);
    expect((await readUnifiedLaunches(1, "NEW")).items).toEqual([]);
  });
  it("preserves the exact pair ticker independently of optional price data", async () => {
    sources.rh.mockResolvedValue({ status: "ready", updatedAt: null, items: [{ ...rh, quoteAsset: other }], sourceEvidence: {} });
    sources.rhMarkets.mockResolvedValue(new Map([[address, { ...market(20), quoteAsset: { address: other, symbol: "QUOTE" } }]]));
    expect((await readUnifiedLaunches()).items.find(row => row.chainId === 4663))
      .toMatchObject({ quoteAsset: other, quoteSymbol: "QUOTE" });
  });
  it("resolves indexed paired tickers without a market provider and never from another chain", async () => {
    sources.rh.mockResolvedValue({ status: "ready", updatedAt: null, items: [{ ...rh, quoteAsset: other }], sourceEvidence: {} });
    sources.rhMarkets.mockResolvedValue(new Map());
    sources.ethMarkets.mockResolvedValue(new Map());
    sources.eth.mockResolvedValue({ status: "ready", updatedAt: null, entries: [{ ...eth, tokenAddress: other, symbol: "WRONG_CHAIN" }], sourceEvidence: {} });
    expect((await readUnifiedLaunches()).items.find(row => row.chainId === 4663)).not.toHaveProperty("quoteSymbol");
    sources.rh.mockResolvedValue({ status: "ready", updatedAt: null, items: [{ ...rh, quoteAsset: other }, { ...rh, tokenAddress: other, symbol: "PAIR" }], sourceEvidence: {} });
    expect((await readUnifiedLaunches()).items.find(row => row.chainId === 4663 && row.tokenAddress === address))
      .toMatchObject({ quoteAsset: other, quoteSymbol: "PAIR" });
  });
  it("keeps the other chain usable when one catalog throws", async () => {
    sources.eth.mockRejectedValue(new Error("unavailable"));
    expect(await readUnifiedLaunches()).toMatchObject({ status: "partial", sources: { ethereum: "unavailable", robinhood: "ready" }, page: { totalItems: 1 } });
    sources.rh.mockRejectedValue(new Error("unavailable"));
    expect(await readUnifiedLaunches()).toMatchObject({ status: "unavailable", items: [] });
  });
  it("keeps the Ethereum pool proof's quote when optional quote metadata and markets are absent", async () => {
    sources.eth.mockResolvedValue({ status: "ready", updatedAt: null, entries: [customGraphExploreEntry], sourceEvidence: {} });
    sources.ethMarkets.mockResolvedValue(new Map());
    expect((await readUnifiedLaunches()).items.find(row => row.chainId === 1)).toMatchObject({
      poolId: customGraphExploreEntry.poolId, quoteAsset: "0x0000000000000000000000000000000000000000",
    });
  });
  it("includes receipt-confirmed launches before the historical index without requesting their market data", async () => {
    const fresh = { ...rh, tokenAddress: other, name: "Fresh", symbol: "FRESH", quoteAsset: address, quoteSymbol: "PAIR",
      transactionHash: pool, blockNumber: "123", launchedAt: "2026-10-04T10:00:00Z" };
    recent.mockResolvedValue([{ chainId: 1, row: fresh, observedAt: Date.now(),
      presentation: { chainId: 1, tokenAddress: other, imageUrl: "/fresh.png", description: null, links: [], market: null } }]);
    const result = await readUnifiedLaunches();
    expect(result.items.find(row => row.tokenAddress === other)).toMatchObject({ chainId: 1, mode: "module", confirmation: "confirmed", symbol: "FRESH" });
    expect(result.presentations.find(row => row.tokenAddress === other)).toMatchObject({ imageUrl: "/fresh.png", market: null });
    expect(recent).toHaveBeenCalledWith(new Set([`1:${address}`, `4663:${address}`]));
    expect(sources.ethMarkets).toHaveBeenCalledWith([eth], 1);
  });
  it("starts a ready network's market batch without waiting for the other catalog", async () => {
    const slowCatalog = Promise.withResolvers<unknown>();
    const marketStarted = Promise.withResolvers<void>();
    sources.eth.mockReturnValue(slowCatalog.promise);
    sources.rhMarkets.mockImplementation(async () => {
      marketStarted.resolve();
      return new Map([[address, market(20)]]);
    });
    const result = readUnifiedLaunches();
    await marketStarted.promise;
    expect(sources.ethMarkets).not.toHaveBeenCalled();
    slowCatalog.resolve({ status: "ready", entries: [eth], updatedAt: null, sourceEvidence: {} });
    expect((await result).items).toHaveLength(2);
    expect(sources.rhMarkets).toHaveBeenCalledTimes(1);
    expect(sources.ethMarkets).toHaveBeenCalledTimes(1);
  });
  it("keeps a selected Classic launch's category and existing artwork and links", async () => {
    const classic = { ...eth, name: "Helix", symbol: "HELIX", imageUrl: "https://helixlev.fun/brand/helix-logo.png",
      links: [{ kind: "website", url: "https://helixlev.fun/" }, { kind: "x", url: "https://x.com/Helixlevdotfun" }],
      launchCategoryProvenance: { category: "classic" } };
    sources.eth.mockResolvedValue({ status: "ready", updatedAt: null, entries: [classic], sourceEvidence: {} });
    const result = await readUnifiedLaunches();
    expect(result.items.find(row => row.chainId === 1)).toMatchObject({ name: "Helix", category: "classic", mode: "classic" });
    expect(result.presentations.find(row => row.chainId === 1)).toMatchObject({ imageUrl: classic.imageUrl,
      links: [{ label: "website", url: "https://helixlev.fun/" }, { label: "x", url: "https://x.com/Helixlevdotfun" }] });
  });
  it("keeps each network identity and valuation separate and does not admit provider-only tokens", async () => {
    const result = await readUnifiedLaunches();
    expect(result.items.map(row => [row.chainId, row.name])).toEqual([[1, "ETH custom"], [4663, "RH token"]]);
    expect(result.presentations.map(row => [row.chainId, row.market?.marketCapUsd])).toEqual([[4663, 20], [1, 100]]);
    expect(result.items).toHaveLength(2);
    expect(result.sourceEvidence).toEqual({ robinhood: { verified: "rh" }, ethereum: { verified: "eth" } });
    expect(sources.rhMarkets).toHaveBeenCalledExactlyOnceWith([rh]);
    expect(sources.ethMarkets).toHaveBeenCalledExactlyOnceWith([eth], 1);
  });

  it("retains verified launches when optional market enrichment fails", async () => {
    sources.rhMarkets.mockRejectedValue(new Error("provider unavailable"));
    sources.ethMarkets.mockRejectedValue(new Error("provider unavailable"));
    const result = await readUnifiedLaunches();
    expect(result.status).toBe("ready");
    expect(result.items).toHaveLength(2);
    expect(result.presentations.every(row => row.market == null)).toBe(true);
  });

  it("reports an unavailable source as partial, and never as a complete empty index", async () => {
    sources.eth.mockResolvedValue({ status: "unavailable", updatedAt: null, entries: [], sourceEvidence: null });
    expect(await readUnifiedLaunches()).toMatchObject({ status: "partial", page: { totalItems: 1 } });
    sources.rh.mockResolvedValue({ status: "unavailable", updatedAt: null, items: [], sourceEvidence: null });
    expect(await readUnifiedLaunches()).toMatchObject({ status: "unavailable", items: [] });
  });

  it("sorts by the displayed total-supply fallback when a measured circulating cap is unavailable", async () => {
    sources.ethMarkets.mockResolvedValue(new Map([[address, { ...market(100), marketCapUsd: null, fdvUsd: 200 }]]));
    const result = await readUnifiedLaunches();
    expect(result.items[0].chainId).toBe(1);
    expect(result.presentations.find(row => row.chainId === 1)?.market?.marketCapUsd).toBeNull();
  });
});
