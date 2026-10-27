vi.mock("@/lib/server/confirming-launches", () => ({ readConfirmingEthereumLaunches: vi.fn().mockResolvedValue([]) }));
import { OWNER_HIDDEN_EXPLORE_IDENTITIES_V1 } from "@/lib/explore-public-visibility";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";

vi.mock("server-only", () => ({}));
const sources = vi.hoisted(() => ({ rh: vi.fn(), eth: vi.fn(), base: vi.fn(), ai: vi.fn(), rhMarkets: vi.fn(), ethMarkets: vi.fn(), presentations: vi.fn() }));
vi.mock("@/lib/custom-ai/index.server", () => ({ readCustomAICatalog: sources.ai }));
const recent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ readRecentFoundationLaunches: recent }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodExploreCatalog: sources.rh }));
vi.mock("@/lib/server/base-explore", () => ({ readBaseExploreCatalog: sources.base }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumUnifiedExploreCatalog: sources.eth }));
vi.mock("@/lib/server/robinhood-presentation", () => ({ readRobinhoodMarkets: sources.rhMarkets, readRobinhoodPresentations: sources.presentations }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexMarkets: sources.ethMarkets }));
const metadata = vi.hoisted(() => vi.fn());
const approved = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/approved-launch-presentation", () => ({ readApprovedLaunchPresentations: approved }));
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
  approved.mockResolvedValue(new Map());
  recent.mockResolvedValue([]);
  sources.ai.mockResolvedValue({ status: "inactive", updatedAt: null, items: [] });
  sources.base.mockResolvedValue({status: "ready", updatedAt: "2026-10-03T10:00:00Z", items: [], presentations: [], sourceEvidence: { verified: "base" }});
  sources.rh.mockResolvedValue({ status: "ready", updatedAt: "2026-10-03T10:00:00Z", items: [rh], sourceEvidence: { verified: "rh" } });
  sources.eth.mockResolvedValue({ status: "ready", updatedAt: "2026-10-03T10:00:00Z", entries: [eth], sourceEvidence: { verified: "eth" } });
  sources.rhMarkets.mockResolvedValue(new Map([[address, market(20)]]));
  sources.ethMarkets.mockResolvedValue(new Map([[address, market(100)], [other, market(10000)]]));
  sources.presentations.mockImplementation(async (rows, markets) => rows.map((row: RobinhoodLaunch) => ({
    tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [], market: markets.get(row.tokenAddress),
  })));
});

describe("Unified verified source adapter", () => {
  it("skips unselected chain catalogs and market reads", async () => {
    const result = await readUnifiedLaunches(1, "", { sort: "newest", mode: "all", chain: 1 });
    expect(result.items.every(item => item.chainId === 1)).toBe(true);
    expect(sources.eth).toHaveBeenCalledTimes(1);
    expect(sources.ethMarkets).toHaveBeenCalledTimes(1);
    expect(sources.rh).not.toHaveBeenCalled();
    expect(sources.base).not.toHaveBeenCalled();
    expect(sources.rhMarkets).not.toHaveBeenCalled();
    expect(sources.ai).not.toHaveBeenCalled();
  });

  it("does not mix a recent Robinhood receipt into an Ethereum filter", async () => {
    recent.mockResolvedValue([{ chainId: 4663, row: { ...rh, tokenAddress: other, symbol: "RECENT" },
      presentation: { tokenAddress: other, imageUrl: null, description: null, links: [] } }]);
    const result = await readUnifiedLaunches(1, "", { sort: "newest", mode: "all", chain: 1 });
    expect(result.items.every(item => item.chainId === 1)).toBe(true);
    expect(result.items.some(item => item.symbol === "RECENT")).toBe(false);
    expect(sources.rhMarkets).not.toHaveBeenCalled();
  });

  it("skips other networks' recent module store for a Base-only view", async () => {
    await readUnifiedLaunches(1, "", { sort: "newest", mode: "all", chain: 8453 });
    expect(recent).not.toHaveBeenCalled();
    expect(sources.eth).not.toHaveBeenCalled();
    expect(sources.rh).not.toHaveBeenCalled();
  });

  it("defensively removes owner-hidden Robinhood identities from the merged feed", async () => {
    const hidden = OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.find(item => item.chainId === 4663)!;
    sources.rh.mockResolvedValue({ status: "ready", updatedAt: null, items: [rh, { ...rh, tokenAddress: hidden.identity, name: "Agent Live Test", symbol: "AGTEST" }], sourceEvidence: {} });
    const result = await readUnifiedLaunches();
    expect(result.items.some(item => item.chainId === 4663 && item.tokenAddress.toLowerCase() === hidden.identity.toLowerCase())).toBe(false);
  });

  it("keeps existing launches visible and marks a failed Custom AI source as partial", async () => {
    sources.ai.mockRejectedValue(new Error("Custom AI store unavailable"));
    const result = await readUnifiedLaunches();
    expect(result).toMatchObject({ status: "partial", sources: { customAI: "unavailable" } });
    expect(result.items).toHaveLength(2);
  });
  it("includes a finalized Custom AI coin with its saved image and description", async () => {
    const coin = { ...rh, chainId: 4663, tokenAddress: other, sourceKind: "custom-ai-v1", mode: "custom", category: "custom",
      name: "AI coin", symbol: "AI", imageUrl: "https://example.com/ai.png", description: "A fixed fee schedule" };
    sources.ai.mockResolvedValue({ status: "ready", updatedAt: "2026-10-03T10:00:00Z", items: [coin] });
    const result = await readUnifiedLaunches();
    expect(result).toMatchObject({ status: "ready", sources: { customAI: "ready" } });
    expect(result.items).toContainEqual(expect.objectContaining({ chainId: 4663, tokenAddress: other, sourceKind: "custom-ai-v1" }));
    expect(result.presentations).toContainEqual(expect.objectContaining({ chainId: 4663, tokenAddress: other, imageUrl: coin.imageUrl, description: coin.description }));
  });
  it("combines both chains for one creator and filters other wallets before market reads", async () => {
    const owner = `0x${"33".repeat(20)}`;
    sources.rh.mockResolvedValue({ status: "ready", updatedAt: null, items: [
      { ...rh, creator: owner }, { ...rh, creator: other, tokenAddress: other },
    ], sourceEvidence: {} });
    sources.eth.mockResolvedValue({ status: "ready", updatedAt: null, entries: [
      { ...eth, creatorAddress: owner }, { ...eth, creatorAddress: other, tokenAddress: other },
    ], sourceEvidence: {} });
    recent.mockResolvedValue([{ chainId: 1, row: { ...rh, creator: other, tokenAddress: other }, presentation: { links: [] } }]);
    const result = await readUnifiedLaunches(1, "", { sort: "newest", mode: "all" }, 10, undefined, owner.toUpperCase().replace("0X", "0x"));
    expect(result.page.totalItems).toBe(2);
    expect(result.items.map(item => item.chainId).sort()).toEqual([1, 4663]);
    expect(result.items.every(item => item.creator === owner)).toBe(true);
    expect(sources.rhMarkets.mock.calls[0][0]).toEqual([expect.objectContaining({ creator: owner })]);
    expect(sources.ethMarkets.mock.calls[0][0]).toEqual([expect.objectContaining({ creatorAddress: owner })]);
  });
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
  it("shows the approved image and links before Codex has metadata for a new receipt", async () => {
    const row = { chainId: 1 as const, confirmation: "confirming" as const, observationExpiresAt: Date.now()+30_000,
      category:"custom" as const,mode:"custom" as const,tokenAddress:other,name:"New project",symbol:"NEW",hookAddress:address,
      launchId:pool,creator:address,transactionHash:pool,blockHash:pool,blockNumber:"123",poolId:pool,quoteAsset:address,launchedAt:"2026-10-14T20:00:00Z",decimals:18 };
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([row]);
    approved.mockResolvedValueOnce(new Map([[other,{imageUrl:"https://project.example/approved.png",description:"Approved",links:[{label:"x",url:"https://x.com/project"}]}]]));
    const result=await readUnifiedLaunches(1,"NEW");
    expect(result.items).toHaveLength(1);
    expect(result.presentations).toEqual([expect.objectContaining({tokenAddress:other,imageUrl:"https://project.example/approved.png",description:"Approved",links:[{label:"x",url:"https://x.com/project"}]} )]);
    expect(approved).toHaveBeenCalledWith([expect.objectContaining({tokenAddress:other,hookAddress:address,creator:address})],1);
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
    sources.base.mockRejectedValue(new Error("unavailable"));
    expect(await readUnifiedLaunches()).toMatchObject({ status: "unavailable", items: [] });
  });
  it("keeps the Ethereum pool proof's quote when optional quote metadata and markets are absent", async () => {
    sources.eth.mockResolvedValue({ status: "ready", updatedAt: null, entries: [customGraphExploreEntry], sourceEvidence: {} });
    sources.ethMarkets.mockResolvedValue(new Map());
    expect((await readUnifiedLaunches()).items.find(row => row.chainId === 1)).toMatchObject({
      poolId: customGraphExploreEntry.poolId, quoteAsset: "0x0000000000000000000000000000000000000000",
    });
  });
  it.each([1, 4663] as const)("enriches a fresh module on chain %s with Codex before historical indexing", async chainId => {
    const fresh = { ...rh, tokenAddress: other, name: "Fresh", symbol: "FRESH", quoteAsset: address, quoteSymbol: "PAIR",
      transactionHash: pool, blockNumber: "123", launchedAt: "2026-10-04T10:00:00Z" };
    recent.mockResolvedValue([{ chainId, row: fresh, observedAt: Date.now(),
      presentation: { chainId, tokenAddress: other, imageUrl: "/fresh.png", description: null, links: [], market: null } }]);
    sources.rhMarkets.mockResolvedValue(new Map([[address, market(20)], [other, market(10000)]]));
    metadata.mockImplementation(async (_addresses, requestedChain) => new Map(requestedChain === chainId ? [[other, {
      imageUrl: "https://example.com/from-codex.png", description: "New module",
      links: [{ label: "Website", url: "https://example.com/" }],
    }]] : []));
    const result = await readUnifiedLaunches();
    expect(result.items.find(row => row.tokenAddress === other)).toMatchObject({ chainId, mode: "module", confirmation: "confirmed", symbol: "FRESH" });
    expect(result.items[0].tokenAddress).toBe(other);
    expect(result.presentations.filter(row => row.tokenAddress === other)).toEqual([expect.objectContaining({
      chainId, imageUrl: "/fresh.png", description: "New module", market: expect.objectContaining({ marketCapUsd: 10000 }),
      links: [{ label: "Website", url: "https://example.com/" }],
    })]);
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
    expect(result.sourceEvidence).toEqual({ robinhood: { verified: "rh" }, ethereum: { verified: "eth" }, base: { verified: "base" } });
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
    sources.base.mockRejectedValue(new Error("unavailable"));
    expect(await readUnifiedLaunches()).toMatchObject({ status: "unavailable", items: [] });
  });

  it("sorts by the displayed total-supply fallback when a measured circulating cap is unavailable", async () => {
    sources.ethMarkets.mockResolvedValue(new Map([[address, { ...market(100), marketCapUsd: null, fdvUsd: 200 }]]));
    const result = await readUnifiedLaunches();
    expect(result.items[0].chainId).toBe(1);
    expect(result.presentations.find(row => row.chainId === 1)?.market?.marketCapUsd).toBeNull();
  });
});
