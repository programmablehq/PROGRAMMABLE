import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { RecentFoundationLaunch } from "@/lib/module-foundation/recent-launches";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ body: "", etag: 0, block: vi.fn(), chain: vi.fn() }));
vi.mock("@vercel/blob", () => ({
  get: async () => state.body ? { statusCode: 200, stream: new Response(state.body).body,
    blob: { etag: `"${state.etag.toString(16).padStart(32, "0")}"` } } : null,
  put: async (_path: string, body: string, options: { ifMatch?: string; allowOverwrite: boolean }) => {
    if ((!options.allowOverwrite && state.body)
      || (options.ifMatch && options.ifMatch !== `"${state.etag.toString(16).padStart(32, "0")}"`)) throw new Error("Conflict");
    state.etag++; state.body = body;
  },
}));
vi.mock("@/lib/server/module-foundation/confirmed-launch", () => ({
  confirmedLaunchClients: (chain: number) => [0, 1].map(() => ({
    getBlock: state.block, getChainId: () => state.chain(chain),
  })),
}));
const a = (n: string) => `0x${n.repeat(40)}`, h = (n: string) => `0x${n.repeat(64)}`;
function entry(chainId: 1 | 4663): RecentFoundationLaunch {
  return {
    chainId, observedAt: Date.now(), row: { sourceKind: "module-foundation-v1", factoryVersion: "v3",
      routerAddress: null, stampHash: null, sourceAddress: a("1"), sourceReleaseDigest: h("1"), tokenAddress: a("2"),
      hookAddress: a("3"), creator: a("4"), poolManager: a("5"), poolId: h("2"), launchId: h("2"),
      quoteAsset: a("6"), quoteSymbol: "QUOTE", feeLedgerAddress: a("7"), metadataHash: h("3"), compositionHash: h("4"),
      transactionHash: h("5"), blockNumber: "100", blockHash: h("6"), logIndex: 1, launchedAt: new Date().toISOString(),
      name: "Coin", symbol: "COIN", decimals: 18 },
    presentation: { chainId, tokenAddress: a("2"), imageUrl: null, description: null, links: [], market: null },
  };
}
beforeEach(() => {
  vi.resetModules(); vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "fixture");
  state.body = ""; state.etag = 0;
  state.block.mockReset().mockResolvedValue({ hash: h("6") });
  state.chain.mockReset().mockImplementation(async chain => chain);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("recent launch storage", () => {
  it("preserves concurrent launches with weak read ETags and strong conditional writes", async () => {
    const { saveRecentFoundationLaunch, readRecentFoundationLaunches } = await import("@/lib/server/module-foundation/recent-launch-store");
    await Promise.all([saveRecentFoundationLaunch(entry(1)), saveRecentFoundationLaunch(entry(4663))]);
    const rows = await readRecentFoundationLaunches();
    expect(rows.map(row => row.chainId).sort()).toEqual([1, 4663]);
    expect(rows.every(row => row.presentation.market === null)).toBe(true);
  });
  it("excludes indexed rows before any RPC and removes reorged observations from the response", async () => {
    const { saveRecentFoundationLaunch, readRecentFoundationLaunches } = await import("@/lib/server/module-foundation/recent-launch-store");
    await saveRecentFoundationLaunch(entry(1));
    expect(await readRecentFoundationLaunches(new Set([`1:${a("2")}`]))).toEqual([]);
    expect(state.block).not.toHaveBeenCalled();
    state.block.mockResolvedValue({ hash: h("7") });
    expect(await readRecentFoundationLaunches()).toEqual([]);
  });
  it("rechecks cached confirmations after their short read window", async () => {
    vi.useFakeTimers();
    const { saveRecentFoundationLaunch, readRecentFoundationLaunches } = await import("@/lib/server/module-foundation/recent-launch-store");
    await saveRecentFoundationLaunch(entry(1));
    expect(await readRecentFoundationLaunches()).toHaveLength(1);
    expect(await readRecentFoundationLaunches()).toHaveLength(1);
    expect(state.block).toHaveBeenCalledTimes(2);
    state.block.mockResolvedValue({ hash: h("8") });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await readRecentFoundationLaunches()).toEqual([]);
    expect(state.block).toHaveBeenCalledTimes(4);
  });
});
