import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("../lib/onchain/operational-rpc-failover.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain/operational-rpc-failover.server")>();
  return { ...actual, withOperationalRpcFailover: vi.fn(actual.withOperationalRpcFailover) };
});
import { createOperationalRpcFailover, withOperationalRpcFailover } from "../lib/onchain/operational-rpc-failover.server";

import {
  OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
  readOperationalRpcHealth,
  type OperationalRpcHealthDependencies,
} from "../lib/onchain/rpc-health";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const PRIMARY_URL = "https://primary.example/rpc-key";
const SECONDARY_URL = "https://secondary.example/rpc-key";
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const NOW_SECONDS = 1_800_000_000n;
const NOW_MS = Number(NOW_SECONDS) * 1_000;

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: PRIMARY_URL,
  rpcUrlSecondary: SECONDARY_URL,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function httpFailure(status: number, url: string) {
  return new HttpRequestError({
    status,
    url,
    body: { method: "eth_blockNumber" },
  });
}

function client(input?: Readonly<{
  chainId?: number;
  head?: bigint;
  headTimestamp?: bigint | (() => bigint);
  blockHash?: `0x${string}`;
  chainError?: unknown;
  headBlockError?: unknown;
  blockError?: unknown;
}>) {
  const head = input?.head ?? 100n;
  return {
    getChainId: vi.fn(async () => {
      if (input?.chainError) throw input.chainError;
      return input?.chainId ?? 1;
    }),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber === head && input?.headBlockError) {
        throw input.headBlockError;
      }
      if (blockNumber !== head && input?.blockError) {
        throw input.blockError;
      }
      const headTimestamp =
        typeof input?.headTimestamp === "function"
          ? input.headTimestamp()
          : input?.headTimestamp ?? NOW_SECONDS - 12n;
      return {
        number: blockNumber,
        hash: input?.blockHash ?? BLOCK_HASH,
        timestamp: headTimestamp,
      };
    }),
  };
}

function dependencies(
  primary: ReturnType<typeof client>,
  secondary: ReturnType<typeof client>,
) {
  const createClient = vi.fn((rpcUrl: string) => {
    if (rpcUrl === PRIMARY_URL) return primary;
    if (rpcUrl === SECONDARY_URL) return secondary;
    throw new Error("Unexpected RPC role");
  });
  return {
    createClient,
    nowMs: () => NOW_MS,
  } satisfies OperationalRpcHealthDependencies;
}

describe("operational RPC health", () => {
  beforeEach(() => {
    vi.mocked(withOperationalRpcFailover).mockImplementation(createOperationalRpcFailover());
  });
  it("propagates caller aborts into the active health transport without failover", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const pending = (signal?: AbortSignal) => new Promise<never>(
      (_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      },
    );
    const createClient = vi.fn((_rpcUrl: string, signal?: AbortSignal) => {
      observedSignal = signal;
      return {
        getChainId: () => pending(signal),
        getBlockNumber: () => pending(signal),
        getBlock: () => pending(signal),
      };
    });
    const read = readOperationalRpcHealth(deployment, {
      createClient,
      nowMs: () => NOW_MS,
    }, controller.signal);

    await vi.waitFor(() => expect(observedSignal).toBe(controller.signal));
    controller.abort(new Error("current evidence deadline"));

    await expect(read).rejects.toThrow("current evidence deadline");
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("reports healthy only when both fixed providers agree", async () => {
    const primary = client({
      head: 100n,
      headTimestamp:
        NOW_SECONDS - BigInt(OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS),
    });
    const secondary = client({ head: 101n });

    await expect(
      readOperationalRpcHealth(
        deployment,
        dependencies(primary, secondary),
      ),
    ).resolves.toEqual({
      status: "healthy",
      chainId: 1,
      read: {
        status: "available",
        servedBy: "primary",
        failoverUsed: false,
      },
      providers: {
        primary: {
          status: "available",
          head: "100",
          headAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
        },
        secondary: {
          status: "available",
          head: "101",
          headAgeSeconds: 12,
        },
      },
      freshness: {
        maxHeadAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
      },
      quorum: { status: "verified" },
      confirmedBlock: { number: "88", hash: BLOCK_HASH },
    });
    expect(primary.getBlock).toHaveBeenCalledWith({ blockNumber: 88n });
    expect(secondary.getBlock).toHaveBeenCalledWith({ blockNumber: 88n });
  });

  it("reports the public provider identities without exposing endpoints", async () => {
    const primary = client({ head: 100n });
    const secondary = client({ head: 101n });
    const health = await readOperationalRpcHealth(
      {
        ...deployment,
        rpcProviderIds: { primary: "drpc", secondary: "quicknode" },
      },
      dependencies(primary, secondary),
    );

    expect(health.providers).toMatchObject({
      primary: { provider: "drpc", status: "available" },
      secondary: { provider: "quicknode", status: "available" },
    });
    expect(JSON.stringify(health)).not.toContain("rpc-key");
    expect(JSON.stringify(health)).not.toContain("example");
  });

  it("keeps reads available through the fixed secondary after primary 429", async () => {
    const primary = client({
      chainError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({ head: 105n });
    const deps = dependencies(primary, secondary);

    const health = await readOperationalRpcHealth(deployment, deps);

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "secondary",
        failoverUsed: true,
      },
      providers: {
        primary: { status: "unavailable" },
        secondary: { status: "available", head: "105" },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: { number: "93", hash: BLOCK_HASH },
    });
    expect(deps.createClient.mock.calls.map(([url]) => url)).toEqual([
      PRIMARY_URL,
      SECONDARY_URL,
    ]);
    expect(JSON.stringify(health)).not.toContain("primary.example");
    expect(JSON.stringify(health)).not.toContain("secondary.example");
    expect(JSON.stringify(health)).not.toContain("rpc-key");
  });

  it("stays degraded on primary when only the secondary is unavailable", async () => {
    const primary = client({ head: 100n });
    const secondary = client({
      chainError: httpFailure(503, SECONDARY_URL),
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "primary",
        failoverUsed: false,
      },
      providers: {
        primary: { status: "available", head: "100" },
        secondary: { status: "unavailable" },
      },
      quorum: { status: "unavailable" },
    });
  });

  it("uses the secondary when the primary loses capacity at the confirmed read", async () => {
    const primary = client({
      head: 100n,
      blockError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({ head: 100n });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "secondary",
        failoverUsed: true,
      },
      providers: {
        primary: { status: "unavailable" },
        secondary: { status: "available" },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: { number: "88", hash: BLOCK_HASH },
    });
  });

  it("uses a fresh fixed secondary when the primary head is stale", async () => {
    const primary = client({
      headTimestamp:
        NOW_SECONDS -
        BigInt(OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1),
    });
    const secondary = client({ headTimestamp: NOW_SECONDS - 8n });
    const deps = dependencies(primary, secondary);

    const health = await readOperationalRpcHealth(
      deployment,
      deps,
    );

    expect(health).toMatchObject({
      status: "degraded",
      read: {
        status: "available",
        servedBy: "secondary",
        failoverUsed: true,
      },
      providers: {
        primary: {
          status: "stale",
          head: "100",
          headAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1,
        },
        secondary: {
          status: "available",
          head: "100",
          headAgeSeconds: 8,
        },
      },
      freshness: {
        maxHeadAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
      },
      quorum: { status: "unavailable" },
      confirmedBlock: { number: "88", hash: BLOCK_HASH },
    });
    expect(primary.getBlock).toHaveBeenCalledTimes(1);
    expect(secondary.getBlock).toHaveBeenCalledTimes(2);
    expect(deps.createClient.mock.calls.map(([url]) => url)).toEqual([
      PRIMARY_URL,
      SECONDARY_URL,
    ]);
  });

  it("fails closed when both providers agree only on stale heads", async () => {
    const staleTimestamp =
      NOW_SECONDS -
      BigInt(OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1);
    const primary = client({ headTimestamp: staleTimestamp });
    const secondary = client({ headTimestamp: staleTimestamp });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "unhealthy",
      read: {
        status: "unavailable",
        servedBy: null,
        failoverUsed: false,
      },
      providers: {
        primary: {
          status: "stale",
          headAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1,
        },
        secondary: {
          status: "stale",
          headAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1,
        },
      },
      quorum: { status: "unavailable" },
      confirmedBlock: null,
    });
    expect(primary.getBlock).toHaveBeenCalledTimes(1);
    expect(secondary.getBlock).toHaveBeenCalledTimes(1);
  });

  it("returns to verified current health after the primary recovers", async () => {
    let primaryTimestamp =
      NOW_SECONDS -
      BigInt(OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS + 1);
    const primary = client({
      headTimestamp: () => primaryTimestamp,
    });
    const secondary = client({ headTimestamp: NOW_SECONDS - 8n });
    const deps = dependencies(primary, secondary);

    await expect(
      readOperationalRpcHealth(deployment, deps),
    ).resolves.toMatchObject({
      status: "degraded",
      read: { servedBy: "secondary", failoverUsed: true },
      providers: { primary: { status: "stale" } },
    });

    primaryTimestamp = NOW_SECONDS - 6n;

    await expect(
      readOperationalRpcHealth(deployment, deps),
    ).resolves.toMatchObject({
      status: "healthy",
      read: { servedBy: "primary", failoverUsed: false },
      providers: {
        primary: { status: "available", headAgeSeconds: 6 },
        secondary: { status: "available", headAgeSeconds: 8 },
      },
      quorum: { status: "verified" },
    });
  });

  it("reports unhealthy when both configured providers are down", async () => {
    const primary = client({
      chainError: httpFailure(429, PRIMARY_URL),
    });
    const secondary = client({
      chainError: httpFailure(503, SECONDARY_URL),
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toEqual({
      status: "unhealthy",
      chainId: 1,
      read: {
        status: "unavailable",
        servedBy: null,
        failoverUsed: false,
      },
      providers: {
        primary: {
          status: "unavailable",
          head: null,
          headAgeSeconds: null,
        },
        secondary: {
          status: "unavailable",
          head: null,
          headAgeSeconds: null,
        },
      },
      freshness: {
        maxHeadAgeSeconds: OPERATIONAL_RPC_MAX_HEAD_AGE_SECONDS,
      },
      quorum: { status: "unavailable" },
      confirmedBlock: null,
    });
  });

  it("fails closed when providers disagree on confirmed state", async () => {
    const primary = client();
    const secondary = client({
      blockHash: `0x${"22".repeat(32)}`,
    });

    const health = await readOperationalRpcHealth(
      deployment,
      dependencies(primary, secondary),
    );

    expect(health).toMatchObject({
      status: "unhealthy",
      read: { status: "blocked", servedBy: null },
      providers: {
        primary: { status: "available" },
        secondary: { status: "available" },
      },
      quorum: { status: "mismatch" },
      confirmedBlock: null,
    });
  });

  it("does not rotate after a wrong-chain integrity failure", async () => {
    const primary = client({ chainId: 11_155_111 });
    const secondary = client();
    const deps = dependencies(primary, secondary);

    const health = await readOperationalRpcHealth(deployment, deps);

    expect(health).toMatchObject({
      status: "unhealthy",
      read: { status: "blocked", servedBy: null },
      providers: {
        primary: { status: "invalid", head: "100" },
        secondary: { status: "unknown", head: null },
      },
      quorum: { status: "mismatch" },
    });
    expect(deps.createClient).toHaveBeenCalledTimes(1);
  });
});
