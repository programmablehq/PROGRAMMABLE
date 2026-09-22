import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch, RobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { PINNED_ROBINHOOD_TOKEN } from "@/lib/robinhood-explore-policy";
import type { LaunchProjectionSnapshot, ModuleModeSnapshot, RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";

const mocks = vi.hoisted(() => ({ read: vi.fn(), markets: vi.fn(), presentations: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: () => ({ read: mocks.read }) }));
vi.mock("@/lib/server/robinhood-presentation", () => ({ readRobinhoodMarkets: mocks.markets, readRobinhoodPresentations: mocks.presentations }));
import { readRobinhoodLaunches, readRobinhoodToken, readRobinhoodTokenPresentation } from "@/lib/server/robinhood-index/read";

const hex = (value: number, length: number) => `0x${value.toString(16).padStart(length, "0")}`;
function token(id: number): RobinhoodLaunch & { poolId: string } {
  return { routerAddress: hex(1, 40), launchId: hex(id, 64), tokenAddress: hex(id, 40), hookAddress: hex(id + 100, 40),
    creator: hex(2, 40), poolManager: hex(3, 40), poolId: hex(id + 200, 64), stampHash: hex(id + 300, 64),
    transactionHash: hex(id + 400, 64), blockNumber: String(id), blockHash: hex(id + 500, 64), logIndex: 1,
    launchedAt: null, name: `Token ${id}`, symbol: `T${id}`, decimals: 18 };
}
function saved(items: RobinhoodLaunch[]): RobinhoodSnapshot {
  return { version: 1, chainId: 4663, routerAddress: hex(1, 40), binding: hex(1, 64), startBlock: "1",
    cursor: { number: "100", hash: hex(100, 64) }, checkpoints: [], finalizedBlock: "100", updatedAt: new Date().toISOString(), items };
}
function market(row: RobinhoodLaunch & { poolId: string }, value: number): RobinhoodCoinMarket {
  return { poolId: row.poolId, priceUsd: null, marketCapUsd: value, liquidityUsd: null, volume24hUsd: null,
    change24hPercent: null, observedAt: new Date().toISOString(), sourceUrl: "https://dexscreener.com/" };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.presentations.mockImplementation(async (rows: RobinhoodLaunch[], markets: Map<string, RobinhoodCoinMarket>) =>
    rows.map((row) => ({ tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [], market: markets.get(row.tokenAddress) ?? null })));
});

describe("Robinhood Explore read model", () => {
  it("uses only the selected token's source freshness while retaining its stale and syncing states", async () => {
    const routerRow = token(1);
    const moduleRow: RobinhoodModuleLaunch = {
      ...token(2), sourceKind: "module-foundation-v1", factoryVersion: "v2", routerAddress: null, stampHash: null,
      sourceAddress: hex(10, 40), sourceReleaseDigest: hex(10, 64), hookAddress: hex(102, 40), poolManager: hex(3, 40),
      quoteAsset: hex(0, 40), feeLedgerAddress: hex(11, 40), metadataHash: hex(12, 64), compositionHash: hex(13, 64),
    };
    const projectedRow = { ...token(3), sourceKind: "multi-role-v2" as const };
    const fresh = new Date().toISOString(), stale = new Date(Date.now() - 300_001).toISOString();
    const snapshot = { ...saved([routerRow]), updatedAt: stale };
    const moduleSource: ModuleModeSnapshot = {
      version: 1, chainId: 4663, sourceKind: "module-foundation-v1", factoryVersion: "v2",
      sourceAddress: moduleRow.sourceAddress, releaseDigest: moduleRow.sourceReleaseDigest,
      startBlock: "1", cursor: snapshot.cursor, checkpoints: [], finalizedBlock: "100", updatedAt: stale, items: [moduleRow],
    };
    const projectionSource: LaunchProjectionSnapshot = {
      version: 1, sourceUrl: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections",
      updatedAt: stale, nextCursor: null, items: [projectedRow],
    };
    snapshot.moduleModeSources = [moduleSource];
    snapshot.launchProjections = projectionSource;
    mocks.read.mockResolvedValue({ snapshot });
    mocks.markets.mockResolvedValue(new Map());
    for (const [source, row] of [[snapshot, routerRow], [moduleSource, moduleRow], [projectionSource, projectedRow]] as const) {
      source.updatedAt = fresh;
      expect(await readRobinhoodToken(row.tokenAddress)).toMatchObject({ status: "ready", updatedAt: fresh, token: row });
      expect((await readRobinhoodLaunches()).status).toBe("stale");
      if ("nextCursor" in source) source.nextCursor = "next-page";
      else source.finalizedBlock = "101";
      expect((await readRobinhoodToken(row.tokenAddress)).status).toBe("syncing");
      source.updatedAt = stale;
      expect(await readRobinhoodToken(row.tokenAddress)).toMatchObject({ status: "stale", updatedAt: stale, token: row });
      if ("nextCursor" in source) source.nextCursor = null;
      else source.finalizedBlock = "100";
    }
    expect(await readRobinhoodToken(hex(99, 40))).toMatchObject({ status: "stale", token: null });
  });

  it("filters unpriced launches before pagination and ranks the remaining full catalog using the same prices", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => token(index + 1));
    const canary = { ...token(61), tokenAddress: "0x15fca474b23cafe775120b1fafbcff0e7a827af2" };
    const observations = new Map(rows.map((row, index) => [row.tokenAddress, market(row, 60 - index)]));
    mocks.read.mockResolvedValue({ snapshot: saved([...rows, canary]) });
    mocks.markets.mockResolvedValue(observations);
    const result = await readRobinhoodLaunches(2, "", { sort: "highest" });
    expect(mocks.markets).toHaveBeenCalledWith([...rows, canary]);
    expect(result.items).toEqual(rows.slice(50));
    expect(mocks.presentations).toHaveBeenCalledWith(rows.slice(50), observations);
    expect(result.presentations[0].market).toBe(observations.get(rows[50].tokenAddress));
    expect(result.page.totalItems).toBe(60);
    expect((await readRobinhoodLaunches(1, canary.tokenAddress)).items).toEqual([]);
    expect((await readRobinhoodToken(canary.tokenAddress)).token).toEqual(canary);
  });

  it("orders priced launches by real 24h volume with the same observation on cards", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => token(index + 1));
    const observations = new Map(rows.slice(0, 11).map((row, index) => [row.tokenAddress,
      { ...market(row, index + 1), volume24hUsd: 10 - index }]));
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockResolvedValue(observations);
    const first = await readRobinhoodLaunches(1, "", { sort: "activity" }, 10);
    const second = await readRobinhoodLaunches(2, "", { sort: "activity" }, 10);
    expect(first.items).toEqual(rows.slice(0, 10));
    expect(second.items).toEqual(rows.slice(10, 11));
    expect(first.presentations[0].market?.volume24hUsd).toBe(10);
    expect(second.presentations[0].market?.volume24hUsd).toBe(0);
  });

  it("requires a positive reported market cap and excludes FDV-only pools even for the pinned coin", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => token(index + 1));
    rows[0] = { ...rows[0], tokenAddress: PINNED_ROBINHOOD_TOKEN };
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockResolvedValue(new Map(rows.map((row, index) => [row.tokenAddress.toLowerCase(),
      { ...market(row, [0, -1, NaN, Infinity, 100, 0][index]), ...(index === 5 ? { marketCapUsd: null, fdvUsd: 200 } : {}) }])));
    const result = await readRobinhoodLaunches();
    expect(result.items).toEqual([rows[4]]);
    expect(result.page.totalItems).toBe(1);
  });

  it("shares Explore's full catalog market observation on direct coin visits", async () => {
    const rows = [token(1), token(2)];
    const observations = new Map(rows.map(row => [row.tokenAddress, market(row, 10)]));
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockResolvedValue(observations);
    const detail = await readRobinhoodTokenPresentation(rows[1].tokenAddress);
    expect(mocks.markets).toHaveBeenCalledWith(rows);
    expect(mocks.presentations).toHaveBeenCalledWith([rows[1]], observations);
    expect(detail.token).toEqual(rows[1]);
    expect(detail.presentation?.market).toBe(observations.get(rows[1].tokenAddress));
    mocks.presentations.mockRejectedValueOnce(new Error("metadata unavailable"));
    expect(await readRobinhoodTokenPresentation(rows[1].tokenAddress)).toMatchObject({ status: "ready", token: rows[1], presentation: null });
  });

  it("hides unpriced launches from Explore while keeping direct visits when market data is unavailable", async () => {
    const rows = [token(1), token(2)];
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockRejectedValue(new Error("provider unavailable"));
    const result = await readRobinhoodLaunches();
    expect(result.status).toBe("ready");
    expect(result.items).toEqual([]);
    expect(result.presentations).toEqual([]);
    expect((await readRobinhoodToken(rows[0].tokenAddress)).token).toEqual(rows[0]);
  });

  it("presents the selected six-card page while the legacy default remains fifty", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => token(index + 1));
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    const observations = new Map(rows.map(row => [row.tokenAddress, market(row, 10)]));
    mocks.markets.mockResolvedValue(observations);
    const result = await readRobinhoodLaunches(2, "", { sort: "newest" }, 6);
    expect(result.items).toEqual(rows.slice(0, 6).toReversed());
    expect(result.page).toEqual({ number: 2, size: 6, totalItems: 12, totalPages: 2, hasMore: false });
    expect(mocks.presentations).toHaveBeenCalledWith(result.items, observations);
  });

  it("keeps priced launches and market values if optional image or social enrichment fails", async () => {
    const rows = [token(1), token(2)];
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    const observations = new Map(rows.map(row => [row.tokenAddress, market(row, 10)]));
    mocks.markets.mockResolvedValue(observations);
    mocks.presentations.mockRejectedValue(new Error("metadata unavailable"));
    const result = await readRobinhoodLaunches(1, "", { sort: "newest" }, 10);
    expect(result.status).toBe("ready");
    expect(result.items).toEqual(rows.toReversed());
    expect(result.presentations.map(item => item.market)).toEqual(rows.toReversed().map(row => observations.get(row.tokenAddress)));
  });
});
