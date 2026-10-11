import { describe, expect, it, vi } from "vitest";
import { decodeEventLog, type PublicClient, type TransactionReceipt } from "viem";
import raw from "./fixtures/dna-launch-receipt.json";
import { liveLaunchObservations } from "@/lib/confirming-launches";
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/server/module-foundation/rpc", () => ({ foundationMainnetRpcs: vi.fn(), foundationMainnetReadClient: vi.fn() }));
vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual,
  keccak256: (value: string) => value === "0x01"
    ? "0xf2d611fb92718c63cf5767300e79d7c9b49480b2e9001448b96c1385f4edb6f3"
    : value === "0x02" ? "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293" : actual.keccak256(value as `0x${string}`),
}; });
import { launchStampLaunchEvent, launchStampRouteEvent } from "@/lib/alchemy/launch-stamp.server";
import { createLaunchObservationCache, observeEthereumLaunches } from "@/lib/server/confirming-launches";
const receipt = { ...raw, blockNumber: BigInt(raw.blockNumber), logs: raw.logs.map(log => ({ ...log, blockNumber: BigInt(log.blockNumber) })) } as TransactionReceipt;
const anchor = receipt.logs.at(-1)!;
const launch = decodeEventLog({ abi: [launchStampLaunchEvent], data: anchor.data, topics: anchor.topics }).args;
const routeLog = receipt.logs.at(-2)!;
const route = decodeEventLog({ abi: [launchStampRouteEvent], data: routeLog.data, topics: routeLog.topics }).args;
function client() {
  return {
    getChainId: vi.fn(async () => 1), getBlockNumber: vi.fn(async () => receipt.blockNumber + 2n),
    getBlock: vi.fn(async ({ blockNumber }) => ({ number: blockNumber, hash: receipt.blockHash, timestamp: 1791734747n })),
    getLogs: vi.fn(async () => [anchor]), getCode: vi.fn(async ({ address }) => address.toLowerCase() === anchor.address.toLowerCase() ? "0x01" : "0x02"),
    getTransactionReceipt: vi.fn(async () => receipt),
    readContract: vi.fn(async ({ functionName }) => functionName === "launchStamp" ? {
      ...launch, ...route, launchWallet: receipt.from, routeLauncher: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
    } : functionName === "name" ? "DNA" : functionName === "symbol" ? "DNA" : 18),
  };
}
const scan = (a = client(), b = client(), cache?: Map<string, Awaited<ReturnType<typeof observeEthereumLaunches>>[number]>) =>
  observeEthereumLaunches([a, b] as unknown as PublicClient[], 1_000, cache);

describe("receipt observations before canonical finality", () => {
  it("recognizes the real DNA successor-router receipt after two blocks without a finalized API feed", async () => {
    const a = client();
    const [row] = await scan(a);
    expect(row).toMatchObject({ chainId: 1, tokenAddress: raw.logs[0].address,
      confirmation: "confirming", mode: "custom", name: "DNA", blockNumber: "26170294", observationExpiresAt: 31_000 });
    expect(row).not.toHaveProperty("provenance");
    expect(row).not.toHaveProperty("launchStampProvenance");
    expect(a.getLogs).toHaveBeenCalledWith(expect.objectContaining({ toBlock: receipt.blockNumber, fromBlock: receipt.blockNumber - 255n }));
  });
  it("rejects wrong networks, provider disagreement and a reorg", async () => {
    const a = client(), b = client();
    b.getChainId.mockResolvedValueOnce(4663);
    await expect(scan(a, b)).rejects.toThrow("network mismatch");
    b.getLogs.mockResolvedValueOnce([]);
    await expect(scan(a, b)).rejects.toThrow("disagree");
    b.getBlock.mockResolvedValueOnce({ number: receipt.blockNumber, hash: `0x${"00".repeat(32)}`, timestamp: 1791734747n });
    await expect(scan(a, b)).rejects.toThrow("disagree");
  });
  it("does not admit a failed transaction or an incomplete stamp group", async () => {
    const a = client();
    a.getTransactionReceipt.mockResolvedValueOnce({ ...receipt, status: "reverted" });
    await expect(scan(a)).rejects.toThrow("provenance mismatch");
    // Remove the actual Initialize event, not an unrelated ERC-20 transfer.
    a.getTransactionReceipt.mockReset().mockResolvedValue({ ...receipt, logs: receipt.logs.filter(log => log.address.toLowerCase() !== launch.poolManager.toLowerCase()) });
    await expect(scan(a)).rejects.toThrow("pool initialization");
  });
  it("keeps optional metadata failure independent of receipt identity", async () => {
    const a = client(), original = a.readContract.getMockImplementation()!;
    a.readContract.mockImplementation(async input => {
      if (input.functionName !== "launchStamp") throw Error("metadata unavailable");
      return original(input);
    });
    expect((await scan(a))[0]).toMatchObject({ name: null, symbol: null, decimals: null, confirmation: "confirming" });
  });
  it("reuses verified receipts only after rediscovering them on both providers", async () => {
    const cache = new Map(), a = client(), b = client();
    await scan(a, b, cache);
    await scan(a, b, cache);
    expect(a.getTransactionReceipt).toHaveBeenCalledTimes(1);
    b.getLogs.mockResolvedValueOnce([]);
    await expect(scan(a, b, cache)).rejects.toThrow("disagree");
  });
  it("expires browser observations while preserving canonical rows", () => {
    expect(liveLaunchObservations([{ confirmation: "confirming", observationExpiresAt: 100 },
      { confirmation: "confirming", observationExpiresAt: 300 }, { confirmation: undefined }], 200))
      .toEqual([{ confirmation: "confirming", observationExpiresAt: 300 }, { confirmation: undefined }]);
  });
});


describe("nonblocking observation refresh", () => {
  it("shares slow work, returns the page promptly, and discards observations after a failed refresh", async () => {
    vi.useFakeTimers();
    try {
      const first = Promise.withResolvers<Awaited<ReturnType<typeof observeEthereumLaunches>>>();
      const second = Promise.withResolvers<Awaited<ReturnType<typeof observeEthereumLaunches>>>();
      const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const jobs: Promise<void>[] = [];
      const read = createLaunchObservationCache(load, job => jobs.push(job));
      const a = read(), b = read();
      await vi.advanceTimersByTimeAsync(750);
      expect(await a).toEqual([]); expect(await b).toEqual([]); expect(load).toHaveBeenCalledTimes(1);
      const row = { confirmation: "confirming", observationExpiresAt: Date.now() + 30_000 } as Awaited<ReturnType<typeof observeEthereumLaunches>>[number];
      first.resolve([row]); await jobs[0];
      expect(await read()).toEqual([row]);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await read()).toEqual([row]); expect(load).toHaveBeenCalledTimes(2);
      second.reject(Error("provider unavailable")); await jobs[1];
      await expect(read()).rejects.toThrow("provider unavailable");
    } finally { vi.useRealTimers(); }
  });
});
