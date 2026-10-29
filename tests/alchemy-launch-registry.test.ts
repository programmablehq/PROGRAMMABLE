import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";

vi.mock("server-only", () => ({}));

const blobMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMocks);

import {
  LAUNCH_STAMP_ROUTER_BINDING,
  LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
  readAlchemyLaunchRegistry,
  validateAlchemyLaunchRegistryEnvelope,
  writeAlchemyLaunchRegistry,
  type AlchemyLaunchRegistry,
} from "../lib/alchemy/launch-registry.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

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
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test-key-1234",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function token(input: Readonly<{ address?: `0x${string}`; block?: string; log?: number }> = {}): LauncherToken {
  const address = input.address ??
    "0x4444444444444444444444444444444444444444";
  return {
    id: `1:${address.toLowerCase()}`,
    name: "Newest",
    symbol: "NEW",
    tokenAddress: address,
    hookAddress: "0x5555555555555555555555555555555555555555",
    poolId: `0x${"66".repeat(32)}`,
    launchBlockNumber: input.block ?? "120",
    launchTransactionHash: `0x${"77".repeat(32)}`,
    launchLogIndex: input.log ?? 4,
    launchedAt: "2026-08-04T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
  };
}

function routerToken(
  input: Readonly<{
    address?: `0x${string}`;
    launchId?: `0x${string}`;
    poolId?: `0x${string}`;
    transactionHash?: `0x${string}`;
  }> = {},
): LauncherToken {
  const address = input.address ??
    "0x9444444444444444444444444444444444444444";
  const hookAddress = "0x9555555555555555555555555555555555555555";
  const launchId = input.launchId ?? `0x${"91".repeat(32)}`;
  const stampHash = `0x${"92".repeat(32)}` as const;
  const poolId = input.poolId ?? `0x${"93".repeat(32)}`;
  const transactionHash = input.transactionHash ?? `0x${"94".repeat(32)}`;
  return {
    id: `1:${address.toLowerCase()}`,
    name: "Stamped",
    symbol: "STAMP",
    tokenAddress: address,
    hookAddress,
    poolId,
    creatorAddress: "0x9666666666666666666666666666666666666666",
    launchBlockNumber: "25717620",
    launchTransactionHash: transactionHash,
    launchTransactionIndex: 2,
    launchLogIndex: 9,
    launchedAt: "2026-08-09T00:00:00.000Z",
    totalSwapFeeBps: null,
    launchModel: "custom-graph",
    launchModelVersion: "programmable-launch-stamp-router-v1",
    liquidityPath: "programmable-v4",
    launchStampProvenance: {
      schemaVersion: "programmable.launch-stamp-provenance.v1",
      chainId: LAUNCH_STAMP_ROUTER_BINDING.chainId,
      routerAddress: LAUNCH_STAMP_ROUTER_BINDING.routerAddress,
      routerRuntimeCodeHash:
        LAUNCH_STAMP_ROUTER_BINDING.routerRuntimeCodeHash,
      routerStartBlock: LAUNCH_STAMP_ROUTER_BINDING.startBlock,
      finalityConfirmations:
        LAUNCH_STAMP_ROUTER_BINDING.finalityConfirmations,
      kind: "custom-graph",
      launchId,
      stampHash,
      launchWallet: "0x9666666666666666666666666666666666666666",
      transactionHash,
      blockNumber: "25717620",
      blockHash: `0x${"95".repeat(32)}`,
      transactionIndex: 2,
      routeLogIndex: 8,
      launchLogIndex: 9,
      finalizedAtBlockNumber: "25717684",
      finalizedAtBlockHash: `0x${"96".repeat(32)}`,
      poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      poolId,
      poolKey: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: address,
        fee: 3_000,
        tickSpacing: 60,
        hooks: hookAddress,
      },
      poolKeyHash: `0x${"97".repeat(32)}`,
      componentSetHash: `0x${"98".repeat(32)}`,
      routePayloadHash: `0x${"99".repeat(32)}`,
      routeLauncherAddress: "0x9777777777777777777777777777777777777777",
      routeLauncherRuntimeCodeHash: `0x${"a1".repeat(32)}`,
      expectedResultHash: `0x${"a2".repeat(32)}`,
      permitDigest: `0x${"a3".repeat(32)}`,
      components: [
        {
          address,
          kind: "token",
          scope: "exclusive",
          runtimeCodeHash: `0x${"a4".repeat(32)}`,
          logIndex: 6,
          exclusiveProof: { launchId, stampHash },
        },
        {
          address: hookAddress,
          kind: "hook",
          scope: "exclusive",
          runtimeCodeHash: `0x${"a5".repeat(32)}`,
          logIndex: 7,
          exclusiveProof: { launchId, stampHash },
        },
      ],
      tokenProof: { tokenAddress: address, launchId, stampHash },
      poolProof: {
        poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        poolId,
        launchId,
        stampHash,
      },
    },
  };
}

function routerClassicToken(): LauncherToken {
  const custom = routerToken();
  const provenance = custom.launchStampProvenance!;
  return {
    ...custom,
    launchModel: "classic",
    launchStampProvenance: {
      ...provenance,
      kind: "classic",
      components: provenance.components.map((component) =>
        component.kind === "hook"
          ? {
              ...component,
              scope: "shared-infrastructure" as const,
              exclusiveProof: null,
            }
          : component
      ),
    },
  };
}

function payload(
  tokens: readonly LauncherToken[] = [token()],
  routerTokens: readonly LauncherToken[] = [routerToken()],
): AlchemyLaunchRegistry {
  return {
    generatedAt: "2026-08-04T00:01:00.000Z",
    repositoryCommit: "a".repeat(40),
    chainId: 1,
    cursor: {
      blockNumber: "130",
      blockHash: `0x${"88".repeat(32)}`,
    },
    tokens,
    launchStampRouter: {
      schemaVersion: "programmable-launch-stamp-router-registry-v1",
      binding: LAUNCH_STAMP_ROUTER_BINDING,
      cursor: {
        blockNumber: "25717680",
        blockHash: `0x${"89".repeat(32)}`,
      },
      tokens: routerTokens,
    },
  };
}

function envelope(
  tokens: readonly LauncherToken[] = [token()],
  routerTokens: readonly LauncherToken[] = [routerToken()],
) {
  const registry = payload(tokens, routerTokens);
  return {
    schemaVersion: "programmable-alchemy-launch-registry-v2",
    contentHash: keccak256(toBytes(JSON.stringify(registry))),
    payload: registry,
  };
}

function legacyEnvelope(tokens: readonly LauncherToken[] = [token()]) {
  const registry = {
    generatedAt: "2026-08-04T00:01:00.000Z",
    repositoryCommit: "a".repeat(40),
    chainId: 1,
    cursor: {
      blockNumber: "130",
      blockHash: `0x${"88".repeat(32)}`,
    },
    tokens,
  };
  return {
    schemaVersion: "programmable-alchemy-launch-registry-v1",
    contentHash: keccak256(toBytes(JSON.stringify(registry))),
    payload: registry,
  };
}

describe("Alchemy incremental launch registry", () => {
  beforeEach(() => {
    process.env.OPS_BLOB_READ_WRITE_TOKEN = "blob-test-token";
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    blobMocks.get.mockReset();
    blobMocks.put.mockReset();
    blobMocks.put.mockResolvedValue({ etag: "next-etag" });
  });

  afterEach(() => {
    delete process.env.OPS_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("accepts a content-addressed registry with exact launch provenance", () => {
    expect(
      validateAlchemyLaunchRegistryEnvelope(envelope(), deployment),
    ).toMatchObject({
      chainId: 1,
      cursor: { blockNumber: "130" },
      tokens: [{ name: "Newest", launchBlockNumber: "120" }],
      launchStampRouter: {
        cursor: { blockNumber: "25717680" },
        tokens: [{ name: "Stamped" }],
      },
    });
  });

  it("migrates a v1 payload to the independent Router start cursor", () => {
    expect(
      validateAlchemyLaunchRegistryEnvelope(legacyEnvelope(), deployment),
    ).toMatchObject({
      cursor: { blockNumber: "130" },
      launchStampRouter: {
        cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
        tokens: [],
      },
    });
  });

  it("never accepts stamped records through the legacy Classic cursor", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        legacyEnvelope([{ ...routerToken(), launchBlockNumber: "120" }]),
        deployment,
      )
    ).toThrow("invalid token");
  });

  it("rejects a token beyond the committed cursor", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([token({ block: "131" })], []),
        deployment,
      )
    ).toThrow("invalid token");
  });

  it("rejects duplicate launch provenance", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([
          token(),
          token({
            address: "0x9999999999999999999999999999999999999999",
          }),
        ], []),
        deployment,
      )
    ).toThrow("duplicate provenance");
  });

  it("rejects duplicate Router launch, pool, token, or event provenance", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([], [
          routerToken(),
          routerToken({
            address: "0x9888888888888888888888888888888888888888",
          }),
        ]),
        deployment,
      )
    ).toThrow("duplicate provenance");
  });

  it("rejects the same token across the Classic and Router slices", () => {
    const classic = token();
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([classic], [
          routerToken({ address: classic.tokenAddress }),
        ]),
        deployment,
      )
    ).toThrow("slices contain duplicate tokens");
  });

  it("rejects Router tokens that drift from the canonical binding", () => {
    const valid = payload([], [routerToken()]);
    const drifted = {
      ...valid,
      launchStampRouter: {
        ...valid.launchStampRouter,
        binding: {
          ...LAUNCH_STAMP_ROUTER_BINDING,
          finalityConfirmations: 12,
        },
      },
    };
    const candidate = {
      schemaVersion: "programmable-alchemy-launch-registry-v2",
      contentHash: keccak256(toBytes(JSON.stringify(drifted))),
      payload: drifted,
    };
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(candidate, deployment)
    ).toThrow("Router registry is malformed");
  });

  it.each([
    ["legacy model version", { launchModelVersion: "classic-v3" }],
    ["invented total fee", { totalSwapFeeBps: 100 }],
    ["invented hook fee", { buyHookFeeBps: 100 }],
    [
      "invented position",
      {
        positionRecipient:
          "0x9777777777777777777777777777777777777777",
        positionTokenId: "42",
      },
    ],
  ] as const)("rejects stamped Classic with %s", (_label, mutation) => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([], [{ ...routerClassicToken(), ...mutation }]),
        deployment,
      )
    ).toThrow("invalid token");
  });

  it("rejects payload mutation after the content commitment", () => {
    const candidate = envelope();
    candidate.payload.tokens[0]!.name = "Mutated";

    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(candidate, deployment)
    ).toThrow("content hash is invalid");
  });

  it("creates atomically, then updates only through an exact ETag", async () => {
    const registry = envelope().payload;

    await writeAlchemyLaunchRegistry(deployment, registry, null);
    expect(blobMocks.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        allowOverwrite: false,
      }),
    );
    expect(blobMocks.put.mock.calls.at(-1)?.[2]).not.toHaveProperty("ifMatch");

    await writeAlchemyLaunchRegistry(deployment, registry, "exact-etag");
    expect(blobMocks.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        allowOverwrite: true,
        ifMatch: "exact-etag",
      }),
    );
  });

  it("continues the exact canonical Router cursor across website commits with conditional writes", async () => {
    const registry = { ...payload([], [routerToken()]), cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR };
    const saved = { schemaVersion: "programmable-alchemy-launch-registry-v2",
      payload: registry, contentHash: keccak256(toBytes(JSON.stringify(registry))) };
    const etag = '"8e8ed5b7c65cfe481ae32dc684e98710"';
    blobMocks.get.mockImplementation(async () => ({ statusCode: 200,
      stream: new Response(JSON.stringify(saved)).body, blob: { etag } }));
    const before = await readAlchemyLaunchRegistry(deployment, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR, { scope: "router" });
    process.env.VERCEL_GIT_COMMIT_SHA = "b".repeat(40);
    const after = await readAlchemyLaunchRegistry(deployment, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR, { scope: "router" });
    expect(after.registry.launchStampRouter).toEqual(before.registry.launchStampRouter);
    expect(after.registry.repositoryCommit).toBe("b".repeat(40));
    expect(blobMocks.get.mock.calls[1]?.[0]).toBe(blobMocks.get.mock.calls[0]?.[0]);
    expect(() => validateAlchemyLaunchRegistryEnvelope(saved, deployment)).toThrow("payload is malformed");
    await writeAlchemyLaunchRegistry(deployment, after.registry, after.etag, { scope: "router" });
    expect(blobMocks.put).toHaveBeenCalledWith(blobMocks.get.mock.calls[0]?.[0], expect.any(String),
      expect.objectContaining({ allowOverwrite: true, ifMatch: etag }));
    const written = JSON.parse(blobMocks.put.mock.calls[0]?.[1] as string);
    expect(validateAlchemyLaunchRegistryEnvelope(written, deployment, { scope: "router" }).launchStampRouter)
      .toEqual(saved.payload.launchStampRouter);
  });

  it("rejects unrelated Classic data and changed Router bindings in the shared namespace", () => {
    expect(() => validateAlchemyLaunchRegistryEnvelope(envelope(), deployment, { scope: "router" }))
      .toThrow("cannot contain a Classic slice");
    const original = payload([], [routerToken()]);
    const registry = { ...original, cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
      launchStampRouter: { ...original.launchStampRouter, binding: { ...LAUNCH_STAMP_ROUTER_BINDING,
        routerRuntimeCodeHash: `0x${"fe".repeat(32)}` } } };
    const saved = { schemaVersion: "programmable-alchemy-launch-registry-v2",
      payload: registry, contentHash: keccak256(toBytes(JSON.stringify(registry))) };
    expect(() => validateAlchemyLaunchRegistryEnvelope(saved, deployment, { scope: "router" }))
      .toThrow("Router registry is malformed");
  });

  it("requests the object representation for a conditional update", async () => {
    blobMocks.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response(JSON.stringify(envelope())).body,
      blob: { etag: '"8e8ed5b7c65cfe481ae32dc684e98710"' },
    });

    await expect(
      readAlchemyLaunchRegistry(deployment, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR),
    ).resolves.toMatchObject({
      etag: '"8e8ed5b7c65cfe481ae32dc684e98710"',
      registry: { launchStampRouter: { tokens: [{ name: "Stamped" }] } },
    });
    expect(blobMocks.get.mock.calls.at(-1)?.[1]).toMatchObject({ headers: { "accept-encoding": "identity" } });
  });

  it("rejects a weak representation ETag as an object version", async () => {
    blobMocks.get.mockResolvedValueOnce({ statusCode: 200,
      stream: new Response(JSON.stringify(envelope())).body,
      blob: { etag: 'W/"8e8ed5b7c65cfe481ae32dc684e98710"' } });
    await expect(readAlchemyLaunchRegistry(deployment, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR)).rejects.toThrow("ETag");
  });

  it("reports a retryable conflict when another writer wins initial creation", async () => {
    blobMocks.put.mockRejectedValueOnce(new Error("pathname already exists"));
    blobMocks.get.mockResolvedValueOnce({ statusCode: 200 });

    await expect(
      writeAlchemyLaunchRegistry(deployment, envelope().payload, null),
    ).rejects.toMatchObject({
      name: "AlchemyLaunchRegistryCreateConflictError",
    });
  });
});
