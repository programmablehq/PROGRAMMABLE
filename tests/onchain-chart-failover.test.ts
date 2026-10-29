import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/onchain/operational-rpc-failover.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain/operational-rpc-failover.server")>();
  return { ...actual, withOperationalRpcFailover: vi.fn(actual.withOperationalRpcFailover) };
});

const mocks = vi.hoisted(() => ({
  clients: new Map<string, {
    getBlock: ReturnType<typeof vi.fn>;
    getLogs: ReturnType<typeof vi.fn>;
  }>(),
  createPublicClient: vi.fn(),
  http: vi.fn((url: string) => ({ url })),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    http: mocks.http,
  };
});

import { HttpRequestError } from "viem";
import { readTokenChartSeries } from "../lib/onchain/chart";
import {
  createOperationalRpcFailover,
  OperationalRpcUnavailableError,
  withOperationalRpcFailover,
} from "../lib/onchain/operational-rpc-failover.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const primary = "https://primary.example/rpc-key";
const secondary = "https://secondary.example/rpc-key";
const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 100n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: primary,
  rpcUrlSecondary: secondary,
  confirmations: 12n,
  logBlockRange: 10_000n,
} satisfies ReadyOnchainDeployment;
const token = {
  id: "1:chart",
  name: "Chart",
  symbol: "CHART",
  tokenAddress: "0x4444444444444444444444444444444444444444",
  hookAddress: "0x5555555555555555555555555555555555555555",
  poolId: `0x${"66".repeat(32)}`,
  launchBlockNumber: "100",
  launchedAt: "2026-08-10T00:00:00.000Z",
  tokenDecimals: 18,
  totalSwapFeeBps: 100,
  launchModel: "classic",
  liquidityPath: "meme",
} satisfies LauncherToken;

function client(getLogs: ReturnType<typeof vi.fn>) {
  return {
    getBlock: vi.fn(),
    getLogs,
  };
}

describe("token chart operational RPC failover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withOperationalRpcFailover).mockImplementation(createOperationalRpcFailover());
    mocks.clients.clear();
    mocks.createPublicClient.mockImplementation(
      ({ transport }: { transport: { url: string } }) => {
        const selected = mocks.clients.get(transport.url);
        if (!selected) throw new Error("Unexpected chart RPC endpoint");
        return selected;
      },
    );
  });

  it("keeps a healthy primary but marks a missing current price as partial", async () => {
    const primaryClient = client(vi.fn().mockResolvedValue([]));
    mocks.clients.set(primary, primaryClient);

    await expect(readTokenChartSeries({
      deployment,
      token,
      snapshotBlock: 100n,
    })).resolves.toMatchObject({
      status: "partial",
      points: [],
      swapCount: 0,
      volumeWei: "0",
      freshness: {
        history: { status: "current", throughBlock: "100" },
        price: { status: "unavailable" },
        valuation: { status: "unavailable", metric: "fdv" },
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(primaryClient.getLogs).toHaveBeenCalledTimes(2);
  });

  it("restarts the complete chart read on secondary after primary capacity", async () => {
    mocks.clients.set(
      primary,
      client(vi.fn().mockRejectedValue(new HttpRequestError({
        status: 429,
        url: primary,
      }))),
    );
    const secondaryClient = client(vi.fn().mockResolvedValue([]));
    mocks.clients.set(secondary, secondaryClient);

    await expect(readTokenChartSeries({
      deployment,
      token,
      snapshotBlock: 100n,
    })).resolves.toMatchObject({
      status: "partial",
      points: [],
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
    expect(secondaryClient.getLogs).toHaveBeenCalledTimes(2);
  });

  it("reads disjoint chart ranges in bounded parallel batches", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const getLogs = vi.fn().mockImplementation(() =>
      new Promise<readonly []>((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        releases.push(() => {
          inFlight -= 1;
          resolve([]);
        });
      })
    );
    mocks.clients.set(primary, client(getLogs));

    const read = readTokenChartSeries({
      deployment: { ...deployment, logBlockRange: 10n },
      token,
      snapshotBlock: 149n,
    });

    await vi.waitFor(() => expect(getLogs).toHaveBeenCalledTimes(8));
    expect(maxInFlight).toBe(8);
    releases.splice(0).forEach((release) => release());

    await vi.waitFor(() => expect(getLogs).toHaveBeenCalledTimes(10));
    expect(maxInFlight).toBe(8);
    releases.splice(0).forEach((release) => release());

    await expect(read).resolves.toMatchObject({
      status: "partial",
      points: [],
    });
  });

  it("stays honestly unavailable when both configured RPCs fail", async () => {
    mocks.clients.set(
      primary,
      client(vi.fn().mockRejectedValue(new HttpRequestError({
        status: 429,
        url: primary,
      }))),
    );
    mocks.clients.set(
      secondary,
      client(vi.fn().mockRejectedValue(new HttpRequestError({
        status: 503,
        url: secondary,
      }))),
    );

    await expect(readTokenChartSeries({
      deployment,
      token,
      snapshotBlock: 100n,
    })).rejects.toBeInstanceOf(OperationalRpcUnavailableError);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
  });

  it("never relabels an older indexed price as the current snapshot", async () => {
    const primaryClient = client(vi.fn().mockResolvedValue([]));
    mocks.clients.set(primary, primaryClient);

    const series = await readTokenChartSeries({
      deployment,
      token: {
        ...token,
        tokenPriceEthWei: "1000000000000000000",
        marketCapEthWei: "1000000000000000000000",
        marketCapEth: "1000",
        fdvUsdWad: "3000000000000000000000000",
        indexedValuationBlockNumber: "99",
      },
      snapshotBlock: 100n,
    });

    expect(series).toMatchObject({
      status: "partial",
      points: [],
      fdvEthWei: "1000000000000000000000",
      fdvEth: "1000",
      fdvUsdWad: "3000000000000000000000000",
      freshness: {
        price: { status: "unavailable" },
        valuation: {
          status: "stale",
          metric: "fdv",
          asOfBlock: "99",
          lagBlocks: "1",
        },
      },
    });
    expect(series.points).not.toContainEqual(
      expect.objectContaining({ blockNumber: "100" }),
    );
  });

  it("appends a snapshot point only when its live valuation block matches", async () => {
    const primaryClient = client(vi.fn().mockResolvedValue([]));
    mocks.clients.set(primary, primaryClient);

    await expect(readTokenChartSeries({
      deployment,
      token: {
        ...token,
        tokenPriceEthWei: "1000000000000000000",
        marketCapEthWei: "1000000000000000000000",
        marketCapEth: "1000",
        fdvUsdWad: "3000000000000000000000000",
        indexedValuationBlockNumber: "100",
      },
      snapshotBlock: 100n,
    })).resolves.toMatchObject({
      status: "insufficient-history",
      points: [{ blockNumber: "100", priceEth: "1" }],
      fdvEthWei: "1000000000000000000000",
      fdvEth: "1000",
      fdvUsdWad: "3000000000000000000000000",
      freshness: {
        history: { status: "current", throughBlock: "100" },
        price: {
          status: "current",
          asOfBlock: "100",
          lagBlocks: "0",
        },
        valuation: {
          status: "current",
          metric: "fdv",
          asOfBlock: "100",
          lagBlocks: "0",
        },
      },
    });
  });
});
