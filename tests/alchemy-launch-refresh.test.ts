import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));
vi.mock("../lib/onchain/operational-rpc-failover.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain/operational-rpc-failover.server")>();
  return { ...actual, withOperationalRpcFailover: vi.fn(actual.withOperationalRpcFailover) };
});

const mocks = vi.hoisted(() => ({
  getOperationalOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  advanceExploreLaunchDiscovery: vi.fn(),
  advanceLaunchStampRouterSlice: vi.fn(),
  readAlchemyLaunchRegistry: vi.fn(),
  writeAlchemyLaunchRegistry: vi.fn(),
}));

vi.mock("../lib/onchain/config", () => ({
  getWebsiteReadOnchainDeployment: mocks.getOperationalOnchainDeployment,
}));
vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));
vi.mock("../lib/onchain/read-model", () => ({
  advanceExploreLaunchDiscovery: mocks.advanceExploreLaunchDiscovery,
}));
vi.mock("../lib/alchemy/launch-stamp.server", () => ({
  advanceLaunchStampRouterSlice: mocks.advanceLaunchStampRouterSlice,
  LAUNCH_STAMP_ROUTER_INITIAL_CURSOR: {
    blockNumber: "25717611",
    blockHash:
      "0x2d42bd6f5cea0a09b7a76c5ca51569ac69e677cef0498b12730d6f1f7a979a5e",
  },
}));
vi.mock("../lib/alchemy/launch-registry.server", () => ({
  readAlchemyLaunchRegistry: mocks.readAlchemyLaunchRegistry,
  writeAlchemyLaunchRegistry: mocks.writeAlchemyLaunchRegistry,
}));

import { readAlchemyRouterCustomIdentitySourceV1, refreshAlchemyExploreRegistry } from "../lib/alchemy/explore.server";
import { canonicalTokenExploreEntryV1 } from "../lib/explore-entry-v1";
import { createOperationalRpcFailover, withOperationalRpcFailover } from "../lib/onchain/operational-rpc-failover.server";
import type { LauncherToken } from "../lib/tokens";
import {
  customGraphToken,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

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
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test-key-1234",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} as const;

function token(address: `0x${string}`, blockNumber: string, logIndex: number) {
  return {
    id: `1:${address.toLowerCase()}`,
    name: `Token ${logIndex}`,
    symbol: `T${logIndex}`,
    tokenAddress: address,
    hookAddress: "0x4444444444444444444444444444444444444444",
    poolId: `0x${String(logIndex).padStart(64, "0")}`,
    launchBlockNumber: blockNumber,
    launchTransactionHash: `0x${String(logIndex + 10).padStart(64, "0")}`,
    launchLogIndex: logIndex,
    launchedAt: "2026-08-04T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "classic" as const,
    launchModelVersion: "classic-v3" as const,
    liquidityPath: "meme" as const,
  };
}

function snapshot(blockNumber: string) {
  return {
    chainId: 1,
    blockNumber,
    blockHash: `0x${BigInt(blockNumber).toString(16).padStart(64, "0")}`,
    confirmations: 12,
  } as const;
}

const baseToken = token(
  "0x5555555555555555555555555555555555555555",
  "90",
  1,
);
const newestToken = token(
  "0x6666666666666666666666666666666666666666",
  "109",
  2,
);
const baseModel = {
  status: "ready" as const,
  tokens: [baseToken],
  snapshot: snapshot("100"),
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

describe("Alchemy launch overlay refresh", () => {
  beforeEach(() => {
    vi.mocked(withOperationalRpcFailover).mockImplementation(createOperationalRpcFailover());
    process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL = deployment.rpcUrl;
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getOperationalOnchainDeployment.mockReturnValue(deployment);
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      envelope: { payload: { model: baseModel } },
    });
    mocks.readAlchemyLaunchRegistry.mockResolvedValue({
      registry: {
        generatedAt: "2026-08-04T00:00:00.000Z",
        repositoryCommit: "a".repeat(40),
        chainId: 1,
        cursor: snapshot("100"),
        tokens: [],
        launchStampRouter: {
          schemaVersion: "programmable-launch-stamp-router-registry-v1",
          binding: {
            chainId: 1,
            routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
            routerRuntimeCodeHash:
              "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
            startBlock: "25717612",
            finalityConfirmations: 64,
          },
          cursor: {
            blockNumber: "25717611",
            blockHash:
              "0x2d42bd6f5cea0a09b7a76c5ca51569ac69e677cef0498b12730d6f1f7a979a5e",
          },
          tokens: [],
        },
      },
      etag: "registry-etag",
    });
    mocks.writeAlchemyLaunchRegistry.mockResolvedValue({ etag: "next-etag" });
    mocks.advanceLaunchStampRouterSlice.mockImplementation(
      async (_deployment, slice) => ({
        slice,
        scannedFromBlock: null,
        scannedToBlock: null,
        discovered: 0,
        hydrated: 0,
        highestSafeBlockNumber: slice.cursor.blockNumber,
        caughtUp: true,
        rebuiltAfterReorg: false,
      }),
    );
  });

  afterEach(() => {
    delete process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("keeps market-state and launch-discovery snapshots explicit", async () => {
    const confirmed = {
      ...baseModel,
      tokens: [baseToken, newestToken],
      snapshot: snapshot("110"),
    };
    const latest = { ...confirmed, snapshot: snapshot("111") };
    mocks.advanceExploreLaunchDiscovery
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce(latest);

    const result = await refreshAlchemyExploreRegistry({ persist: false });

    expect(result.model.snapshot.blockNumber).toBe("100");
    expect(result.model.launchDiscoverySnapshot?.blockNumber).toBe("111");
    expect(result.model.tokens.map(({ tokenAddress }) => tokenAddress)).toEqual([
      baseToken.tokenAddress,
      newestToken.tokenAddress,
    ]);
    expect(result.model.tokens[1]).toMatchObject({
      launchDiscoverySource: "operational-launch-overlay",
    });
    expect(result).toMatchObject({
      baseBlockNumber: "100",
      confirmedBlockNumber: "110",
      servedBlockNumber: "111",
      persisted: false,
    });
    expect(mocks.writeAlchemyLaunchRegistry).not.toHaveBeenCalled();
  });

  it("keeps a healthy operational primary and does not rotate providers", async () => {
    const dualDeployment = {
      ...deployment,
      rpcUrlSecondary: "https://secondary.example/rpc-key",
    } as const;
    mocks.getOperationalOnchainDeployment.mockReturnValue(dualDeployment);
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("100"),
    });

    await refreshAlchemyExploreRegistry({
      includeLatest: false,
      persist: false,
    });

    expect(mocks.readDurableExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.readDurableExploreModel).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: dualDeployment.rpcUrl,
        rpcUrlSecondary: null,
      }),
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("indexes Router Custom launches without waiting for unrelated Classic discovery", async () => {
    mocks.advanceExploreLaunchDiscovery.mockRejectedValue(new Error("Retired Classic discovery is unavailable"));
    const result = await readAlchemyRouterCustomIdentitySourceV1();
    expect(result.status).toBe("current");
    expect(result.slice.cursor.blockNumber).toBe("25717611");
    expect(mocks.advanceLaunchStampRouterSlice).toHaveBeenCalledOnce();
    expect(mocks.advanceExploreLaunchDiscovery).not.toHaveBeenCalled();
    expect(mocks.readAlchemyLaunchRegistry).toHaveBeenCalledWith(deployment, expect.any(Object), { scope: "router" });
  });

  it("replays the complete refresh on the fixed secondary after primary capacity", async () => {
    const secondary = "https://secondary.example/rpc-key";
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      ...deployment,
      rpcUrlSecondary: secondary,
    });
    mocks.readDurableExploreModel
      .mockRejectedValueOnce(new HttpRequestError({
        status: 429,
        url: deployment.rpcUrl,
      }))
      .mockResolvedValue({
        status: "ready",
        envelope: { payload: { model: baseModel } },
      });
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("100"),
    });

    await refreshAlchemyExploreRegistry({
      includeLatest: false,
      persist: false,
    });

    expect(mocks.readDurableExploreModel).toHaveBeenCalledTimes(2);
    expect(mocks.readDurableExploreModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rpcUrl: secondary,
        rpcUrlSecondary: null,
      }),
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("periodically persists cursor progress even when no token launched", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("164"),
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    expect(result.registryChanged).toBe(true);
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        cursor: expect.objectContaining({ blockNumber: "164" }),
        tokens: [],
      }),
      "registry-etag",
    );
  });

  it("persists only confirmed overlay tokens and tags only the served copy", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      tokens: [baseToken, newestToken],
      snapshot: snapshot("110"),
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    const persisted = mocks.writeAlchemyLaunchRegistry.mock.calls[0]?.[1];
    expect(persisted.tokens).toHaveLength(1);
    expect(persisted.tokens[0]).not.toHaveProperty("launchDiscoverySource");
    expect(result.model.tokens[1]).toMatchObject({
      launchDiscoverySource: "operational-launch-overlay",
    });
  });

  it("advances and persists the independent finalized Router cursor exactly once", async () => {
    mocks.advanceExploreLaunchDiscovery
      .mockResolvedValueOnce({ ...baseModel, snapshot: snapshot("110") })
      .mockResolvedValueOnce({ ...baseModel, snapshot: snapshot("111") });
    mocks.advanceLaunchStampRouterSlice.mockImplementationOnce(
      async (_deployment, slice) => ({
        slice: {
          ...slice,
          cursor: {
            blockNumber: "25717680",
            blockHash: `0x${"ab".repeat(32)}`,
          },
        },
        scannedFromBlock: "25717612",
        scannedToBlock: "25717680",
        discovered: 0,
        hydrated: 0,
        rebuiltAfterReorg: false,
      }),
    );

    const result = await refreshAlchemyExploreRegistry();

    expect(mocks.advanceLaunchStampRouterSlice).toHaveBeenCalledTimes(1);
    expect(mocks.advanceLaunchStampRouterSlice).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        cursor: expect.objectContaining({ blockNumber: "25717611" }),
      }),
    );
    expect(mocks.advanceExploreLaunchDiscovery).toHaveBeenCalledTimes(2);
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        launchStampRouter: expect.objectContaining({
          cursor: expect.objectContaining({ blockNumber: "25717680" }),
        }),
      }),
      "registry-etag",
    );
    expect(result.launchStampRouterBlockNumber).toBe("25717680");
  });

  it("bootstraps the Router slice without the retired Classic snapshot", async () => {
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "unavailable",
      reason: "missing",
      detail: "No durable index snapshot exists",
    });
    mocks.advanceLaunchStampRouterSlice.mockResolvedValueOnce({
      slice: {
        cursor: {
          blockNumber: "25718017",
          blockHash: `0x${"cd".repeat(32)}`,
        },
        tokens: [customGraphToken],
      },
      scannedFromBlock: "25717612",
      scannedToBlock: "25718017",
      discovered: 1,
      hydrated: 1,
      rebuiltAfterReorg: false,
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: true,
    });

    expect(mocks.readAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({ blockNumber: "25717611" }),
    );
    expect(mocks.advanceExploreLaunchDiscovery).not.toHaveBeenCalled();
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        cursor: expect.objectContaining({ blockNumber: "25717611" }),
        tokens: [],
        launchStampRouter: expect.objectContaining({
          cursor: expect.objectContaining({ blockNumber: "25718017" }),
          tokens: [customGraphToken],
        }),
      }),
      "registry-etag",
    );
    expect(result).toMatchObject({
      baseBlockNumber: "25717611",
      confirmedBlockNumber: "25717611",
      servedBlockNumber: "25717611",
      launchStampRouterBlockNumber: "25718017",
    });
    expect(result.model.tokens).toEqual([
      expect.objectContaining({
        tokenAddress: customGraphToken.tokenAddress,
        launchDiscoverySource: "operational-launch-overlay",
      }),
    ]);
  });

  it("persists a Router cursor hash replacement even without block progress", async () => {
    const stored = await mocks.readAlchemyLaunchRegistry();
    mocks.readAlchemyLaunchRegistry.mockResolvedValue({
      ...stored,
      registry: {
        ...stored.registry,
        launchStampRouter: {
          ...stored.registry.launchStampRouter,
          cursor: {
            blockNumber: "25717680",
            blockHash: `0x${"aa".repeat(32)}`,
          },
        },
      },
    });
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("100"),
    });
    mocks.advanceLaunchStampRouterSlice.mockImplementationOnce(
      async (_deployment, slice) => ({
        slice: {
          ...slice,
          cursor: {
            ...slice.cursor,
            blockHash: `0x${"bb".repeat(32)}`,
          },
        },
        scannedFromBlock: "25717612",
        scannedToBlock: "25717680",
        discovered: 0,
        hydrated: 0,
        rebuiltAfterReorg: false,
      }),
    );

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    expect(result.registryChanged).toBe(true);
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        launchStampRouter: expect.objectContaining({
          cursor: expect.objectContaining({
            blockNumber: "25717680",
            blockHash: `0x${"bb".repeat(32)}`,
          }),
        }),
      }),
      "registry-etag",
    );
  });

  it("persists a Router-only reorg rebuild even below the cursor interval", async () => {
    const stored = await mocks.readAlchemyLaunchRegistry();
    mocks.readAlchemyLaunchRegistry.mockResolvedValue({
      ...stored,
      registry: {
        ...stored.registry,
        launchStampRouter: {
          ...stored.registry.launchStampRouter,
          cursor: {
            blockNumber: "25717680",
            blockHash: `0x${"aa".repeat(32)}`,
          },
        },
      },
    });
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("100"),
    });
    mocks.advanceLaunchStampRouterSlice.mockImplementationOnce(
      async (_deployment, slice) => ({
        slice: {
          ...slice,
          cursor: {
            blockNumber: "25717690",
            blockHash: `0x${"bb".repeat(32)}`,
          },
        },
        scannedFromBlock: "25717612",
        scannedToBlock: "25717690",
        discovered: 0,
        hydrated: 0,
        rebuiltAfterReorg: true,
      }),
    );

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    expect(result.registryChanged).toBe(true);
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        launchStampRouter: expect.objectContaining({
          cursor: expect.objectContaining({ blockNumber: "25717690" }),
        }),
      }),
      "registry-etag",
    );
  });

  it("keeps a stamped Classic authoritative over the legacy Classic overlay", async () => {
    const unstampedClassic: LauncherToken = { ...stampedClassicToken };
    delete unstampedClassic.launchStampProvenance;
    const legacyClassic = {
      ...unstampedClassic,
      launchModelVersion: "classic-v3",
      liquidityPath: "meme",
      totalSwapFeeBps: 100,
      buyHookFeeBps: 100,
      sellHookFeeBps: 100,
      creatorFeeBps: 90,
      launcherFeeBps: 10,
      positionRecipient:
        "0x7777777777777777777777777777777777777777",
      positionTokenId: "42",
    } as const;
    const classicModel = {
      ...baseModel,
      tokens: [baseToken, legacyClassic],
      snapshot: snapshot("110"),
    };
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue(classicModel);
    mocks.advanceLaunchStampRouterSlice.mockResolvedValueOnce({
      slice: {
        cursor: {
          blockNumber: "25718017",
          blockHash: `0x${"cd".repeat(32)}`,
        },
        tokens: [stampedClassicToken],
      },
      scannedFromBlock: "25717612",
      scannedToBlock: "25718017",
      discovered: 1,
      hydrated: 1,
      rebuiltAfterReorg: false,
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
      persist: false,
    });
    const stamped = result.model.tokens.find(
      ({ tokenAddress }) =>
        tokenAddress.toLowerCase() ===
        stampedClassicToken.tokenAddress.toLowerCase(),
    );

    expect(stamped).toMatchObject({
      launchModel: "classic",
      launchModelVersion: "programmable-launch-stamp-router-v1",
      liquidityPath: "programmable-v4",
      totalSwapFeeBps: null,
    });
    expect(stamped).not.toHaveProperty("buyHookFeeBps");
    expect(stamped).not.toHaveProperty("positionRecipient");
    expect(() => canonicalTokenExploreEntryV1(stamped!)).not.toThrow();
  });

  it("retries an ETag conflict once but does not retry an RPC failure", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("164"),
    });
    const conflict = new Error("conflict");
    conflict.name = "BlobPreconditionFailedError";
    mocks.writeAlchemyLaunchRegistry
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ etag: "winner-etag" });

    await refreshAlchemyExploreRegistry({
      includeLatest: false,
      requirePersistence: true,
    });
    expect(mocks.readAlchemyLaunchRegistry).toHaveBeenCalledTimes(2);

    mocks.readDurableExploreModel.mockReset();
    mocks.readDurableExploreModel.mockRejectedValue(new Error("RPC failed"));
    await expect(
      refreshAlchemyExploreRegistry({ includeLatest: false }),
    ).rejects.toThrow("RPC failed");
    expect(mocks.readDurableExploreModel).toHaveBeenCalledTimes(1);
  });
});
