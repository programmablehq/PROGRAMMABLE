import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runtimeHashOverrides = vi.hoisted(() =>
  new Map<string, `0x${string}`>()
);

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    keccak256: (value: `0x${string}` | Uint8Array) => {
      if (typeof value === "string") {
        const override = runtimeHashOverrides.get(value.toLowerCase());
        if (override) return override;
      }
      return actual.keccak256(value);
    },
  };
});

import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiParameters,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";

import {
  createLaunchStampReaderV1,
  advanceLaunchStampRouterSlice,
  createInitialLaunchStampRouterSlice,
  hydrateLaunchStampAnchor,
  LAUNCH_STAMP_DIRECT_CALL_SELECTOR,
  LAUNCH_STAMP_FINALITY_CONFIRMATIONS,
  LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
  LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
  LAUNCH_STAMP_ROUTER_ADDRESS,
  LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
  LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
  LAUNCH_STAMP_ROUTER_START_BLOCK,
  launchStampComponentEvent,
  launchStampLaunchEvent,
  launchStampRouteEvent,
  parseLaunchStampReceipt,
  poolManagerInitializeEvent,
  scanLaunchStampAnchors,
  type LaunchStampAnchor,
  type LaunchStampReaderClient,
} from "../lib/alchemy/launch-stamp.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STATE_VIEW = getAddress("0x3333333333333333333333333333333333333333");
const STATE_VIEW_HASH = hex32(0x33);
const ROUTER_CODE = "0x600001" as Hex;
const POOL_MANAGER_CODE = "0x600002" as Hex;
const STATE_VIEW_CODE = "0x600003" as Hex;

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: getAddress("0x1111111111111111111111111111111111111111"),
  feeHook: getAddress("0x2222222222222222222222222222222222222222"),
  launcherRuntimeCodeHash: hex32(0x11),
  feeHookRuntimeCodeHash: hex32(0x22),
  deploymentBlock: 1n,
  stateView: STATE_VIEW,
  stateViewRuntimeCodeHash: STATE_VIEW_HASH,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/redacted",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function hex32(seed: number): Hex {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

function address(seed: number): Address {
  return getAddress(`0x${seed.toString(16).padStart(40, "0")}`);
}

function marker(seed: number): Hex {
  return `0x60${seed.toString(16).padStart(8, "0")}`;
}

function exactTopics(
  topics: readonly (Hex | readonly Hex[] | null)[],
): readonly Hex[] {
  return topics.map((topic) => {
    if (typeof topic !== "string") {
      throw new Error("Test fixture did not encode an exact event topic");
    }
    return topic;
  });
}

function rawLog(input: Readonly<{
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
}>): Log {
  return {
    ...input,
    topics: input.topics,
    removed: false,
  } as Log;
}

type Fixture = ReturnType<typeof fixture>;

function fixture(input: Readonly<{
  seed: number;
  kind?: 1 | 2;
  blockNumber?: bigint;
  blockHash?: Hex;
  transactionHash?: Hex;
  transactionIndex?: number;
  firstLogIndex?: number;
  hook?: Address;
  hookRuntimeCodeHash?: Hex;
  hookCode?: Hex;
}> ) {
  const seed = input.seed;
  const token = address(0x1000 + seed * 10);
  const hook = input.hook ?? address(0x1001 + seed * 10);
  const routeLauncher = address(0x1002 + seed * 10);
  const poolKey = {
    currency0: getAddress(ZERO_ADDRESS),
    currency1: token,
    fee: 3_000,
    tickSpacing: 60,
    hooks: hook,
  } as const;
  const poolId = computeOfficialV4PoolId(poolKey);
  const blockNumber = input.blockNumber ??
    LAUNCH_STAMP_ROUTER_START_BLOCK + BigInt(seed);
  const blockHash = input.blockHash ?? hex32(0x100 + seed);
  const transactionHash = input.transactionHash ?? hex32(0x200 + seed);
  const transactionIndex = input.transactionIndex ?? 1;
  const first = input.firstLogIndex ?? 1;
  const launchId = hex32(0x300 + seed);
  const stampHash = hex32(0x400 + seed);
  const tokenRuntimeCodeHash = hex32(0x500 + seed);
  const hookRuntimeCodeHash = input.hookRuntimeCodeHash ?? hex32(0x600 + seed);
  const routeRuntimeCodeHash = hex32(0x700 + seed);
  const routePayloadHash = hex32(0x800 + seed);
  const expectedResultHash = hex32(0x900 + seed);
  const permitDigest = hex32(0xa00 + seed);
  const poolKeyHash = hex32(0xb00 + seed);
  const componentSetHash = hex32(0xc00 + seed);
  const kind = input.kind ?? 1;

  const initialize = rawLog({
    address: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
    topics: exactTopics(encodeEventTopics({
      abi: [poolManagerInitializeEvent],
      eventName: "Initialize",
      args: { id: poolId, currency0: poolKey.currency0, currency1: token },
    })),
    data: encodeAbiParameters(
      parseAbiParameters("uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick"),
      [poolKey.fee, poolKey.tickSpacing, hook, 2n ** 96n, 0],
    ),
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex: first,
  });
  const component = (
    componentAddress: Address,
    componentKind: 1 | 2,
    runtimeCodeHash: Hex,
    logIndex: number,
  ) => rawLog({
    address: LAUNCH_STAMP_ROUTER_ADDRESS,
    topics: exactTopics(encodeEventTopics({
      abi: [launchStampComponentEvent],
      eventName: "ProgrammableComponentStampedV1",
      args: { launchId, component: componentAddress, kind: componentKind },
    })),
    data: encodeAbiParameters(
      parseAbiParameters("bytes32 runtimeCodeHash"),
      [runtimeCodeHash],
    ),
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex,
  });
  const route = rawLog({
    address: LAUNCH_STAMP_ROUTER_ADDRESS,
    topics: exactTopics(encodeEventTopics({
      abi: [launchStampRouteEvent],
      eventName: "ProgrammableLaunchRouteStampedV1",
      args: { launchId, kind, routePayloadHash },
    })),
    data: encodeAbiParameters(
      parseAbiParameters("bytes32 expectedResultHash,bytes32 permitDigest"),
      [expectedResultHash, permitDigest],
    ),
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex: first + 3,
  });
  const launch = rawLog({
    address: LAUNCH_STAMP_ROUTER_ADDRESS,
    topics: exactTopics(encodeEventTopics({
      abi: [launchStampLaunchEvent],
      eventName: "ProgrammableLaunchStampedV1",
      args: { launchId, token, hook },
    })),
    data: encodeAbiParameters(
      parseAbiParameters("address poolManager,bytes32 poolId,bytes32 stampHash"),
      [LAUNCH_STAMP_POOL_MANAGER_ADDRESS, poolId, stampHash],
    ),
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex: first + 4,
  });
  const logs = [
    initialize,
    component(token, 1, tokenRuntimeCodeHash, first + 1),
    component(hook, 2, hookRuntimeCodeHash, first + 2),
    route,
    launch,
  ];
  const anchor: LaunchStampAnchor = {
    launchId,
    token,
    hook,
    poolManager: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
    poolId,
    stampHash,
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    logIndex: first + 4,
  };
  return {
    anchor,
    logs,
    kind,
    poolKey,
    routeLauncher,
    routeRuntimeCodeHash,
    routePayloadHash,
    expectedResultHash,
    permitDigest,
    poolKeyHash,
    componentSetHash,
    tokenRuntimeCodeHash,
    hookRuntimeCodeHash,
    tokenCode: marker(0x100 + seed),
    hookCode: input.hookCode ?? marker(0x200 + seed),
    routeCode: marker(0x300 + seed),
    record: {
      kind,
      launchWallet: address(0x9000 + seed),
      token,
      hook,
      poolManager: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
      poolId,
      poolKeyHash,
      componentSetHash,
      routePayloadHash,
      routeLauncher,
      routeLauncherRuntimeCodeHash: routeRuntimeCodeHash,
      expectedResultHash,
      permitDigest,
      stampHash,
    },
  };
}

function receiptFor(fixtures: readonly Fixture[]): TransactionReceipt {
  const first = fixtures[0] as Fixture;
  return {
    blockHash: first.anchor.blockHash,
    blockNumber: first.anchor.blockNumber,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: address(0xf001),
    gasUsed: 1n,
    logs: fixtures.flatMap(({ logs }) => logs),
    logsBloom: `0x${"00".repeat(256)}`,
    status: "success",
    to: address(0xf002),
    transactionHash: first.anchor.transactionHash,
    transactionIndex: first.anchor.transactionIndex,
    type: "eip1559",
  } as unknown as TransactionReceipt;
}

function clientFor(
  fixtures: readonly Fixture[],
  options: Readonly<{
    latestBlock?: bigint;
    metadataFailures?: ReadonlySet<string>;
    unsafeMetadata?: ReadonlySet<string>;
    wrongProofAddress?: Address;
    wrongPoolKeyHash?: boolean;
    wrongRuntimeAddress?: Address;
    cursorCanonicalHash?: Hex;
    sharedHookExclusiveCollision?: boolean;
  }> = {},
) {
  runtimeHashOverrides.clear();
  runtimeHashOverrides.set(ROUTER_CODE, LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH);
  runtimeHashOverrides.set(
    POOL_MANAGER_CODE,
    LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
  );
  runtimeHashOverrides.set(STATE_VIEW_CODE, STATE_VIEW_HASH);
  const codeByAddress = new Map<string, Hex>([
    [LAUNCH_STAMP_ROUTER_ADDRESS.toLowerCase(), ROUTER_CODE],
    [LAUNCH_STAMP_POOL_MANAGER_ADDRESS.toLowerCase(), POOL_MANAGER_CODE],
    [STATE_VIEW.toLowerCase(), STATE_VIEW_CODE],
  ]);
  for (const item of fixtures) {
    codeByAddress.set(item.anchor.token.toLowerCase(), item.tokenCode);
    codeByAddress.set(item.anchor.hook.toLowerCase(), item.hookCode);
    codeByAddress.set(item.routeLauncher.toLowerCase(), item.routeCode);
    runtimeHashOverrides.set(item.tokenCode, item.tokenRuntimeCodeHash);
    runtimeHashOverrides.set(item.hookCode, item.hookRuntimeCodeHash);
    runtimeHashOverrides.set(item.routeCode, item.routeRuntimeCodeHash);
  }
  const latestBlock = options.latestBlock ??
    Math.max(...fixtures.map(({ anchor }) => Number(anchor.blockNumber))) + 100;
  const latest = BigInt(latestBlock);
  const receiptCalls = vi.fn();
  const readCalls: Array<Readonly<{
    address: Address;
    functionName: string;
    blockNumber?: bigint;
    args?: readonly unknown[];
  }>> = [];
  const findByToken = (token: Address) => fixtures.find((item) =>
    item.anchor.token.toLowerCase() === token.toLowerCase()
  );
  const findByPool = (poolId: Hex) => fixtures.find((item) =>
    item.anchor.poolId.toLowerCase() === poolId.toLowerCase()
  );
  const findByLaunch = (launchId: Hex) => fixtures.find((item) =>
    item.anchor.launchId.toLowerCase() === launchId.toLowerCase()
  );
  const findByComponent = (component: Address) => fixtures.find((item) =>
    item.anchor.token.toLowerCase() === component.toLowerCase() ||
    item.anchor.hook.toLowerCase() === component.toLowerCase()
  );
  const client = {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => latest),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      const fixtureAtBlock = fixtures.find((item) =>
        item.anchor.blockNumber === blockNumber
      );
      const hash = blockNumber === LAUNCH_STAMP_ROUTER_START_BLOCK - 1n
        ? LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockHash
        : options.cursorCanonicalHash &&
            blockNumber === LAUNCH_STAMP_ROUTER_START_BLOCK + 5n
          ? options.cursorCanonicalHash
          : fixtureAtBlock?.anchor.blockHash ?? hex32(Number(blockNumber % 10_000n) + 0xd00);
      return { number: blockNumber, hash, timestamp: 1_786_284_000n + blockNumber };
    }),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => fixtures.flatMap((item) =>
      item.anchor.blockNumber >= fromBlock && item.anchor.blockNumber <= toBlock
        ? [item.logs.at(-1) as Log]
        : []
    )),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => {
      receiptCalls(hash);
      const matches = fixtures.filter((item) =>
        item.anchor.transactionHash.toLowerCase() === hash.toLowerCase()
      );
      if (matches.length === 0) throw new Error("receipt unavailable");
      return receiptFor(matches);
    }),
    getCode: vi.fn(async ({ address: account }: { address: Address }) => {
      if (
        options.wrongRuntimeAddress &&
        account.toLowerCase() === options.wrongRuntimeAddress.toLowerCase()
      ) return "0x6000" as Hex;
      return codeByAddress.get(account.toLowerCase()) ?? "0x";
    }),
    readContract: vi.fn(async (input: {
      address: Address;
      functionName: string;
      blockNumber?: bigint;
      args?: readonly unknown[];
    }) => {
      readCalls.push(input);
      const argument = input.args?.[0];
      if (input.address.toLowerCase() === LAUNCH_STAMP_ROUTER_ADDRESS.toLowerCase()) {
        if (input.functionName === "CHAIN_ID") return 1n;
        if (input.functionName === "POOL_MANAGER") return LAUNCH_STAMP_POOL_MANAGER_ADDRESS;
        if (input.functionName === "launchStamp") {
          return findByLaunch(argument as Hex)?.record;
        }
        if (input.functionName === "launchIdByToken") {
          return findByToken(argument as Address)?.anchor.launchId;
        }
        if (input.functionName === "launchIdByPool") {
          return findByPool(input.args?.[1] as Hex)?.anchor.launchId;
        }
        if (input.functionName === "computePoolKeyHash") {
          const key = argument as { currency0: Address; currency1: Address };
          const item = fixtures.find((candidate) =>
            candidate.anchor.token.toLowerCase() === key.currency0.toLowerCase() ||
            candidate.anchor.token.toLowerCase() === key.currency1.toLowerCase()
          );
          return options.wrongPoolKeyHash ? hex32(0xdead) : item?.poolKeyHash;
        }
        if (input.functionName === "launchIdByComponent") {
          const item = findByComponent(argument as Address);
          if (
            item?.kind === 2 &&
            item.anchor.hook.toLowerCase() === String(argument).toLowerCase()
          ) {
            return options.sharedHookExclusiveCollision
              ? hex32(0xeeee)
              : hex32(0);
          }
          return item?.anchor.launchId ?? hex32(0);
        }
        if (input.functionName === "componentRuntimeCodeHash") {
          const item = findByComponent(argument as Address);
          return item?.anchor.token.toLowerCase() === String(argument).toLowerCase()
            ? item.tokenRuntimeCodeHash
            : item?.hookRuntimeCodeHash ?? hex32(0);
        }
        if (input.functionName === "stampProof") {
          const item = findByComponent(argument as Address);
          if (
            options.wrongProofAddress &&
            String(argument).toLowerCase() === options.wrongProofAddress.toLowerCase()
          ) return [hex32(0xdead), hex32(0xbeef)] as const;
          return item
            ? [item.anchor.launchId, item.anchor.stampHash] as const
            : [hex32(0), hex32(0)] as const;
        }
      }
      if (input.address.toLowerCase() === STATE_VIEW.toLowerCase()) {
        if (input.functionName === "getSlot0") return [2n ** 96n, 0, 0, 3_000] as const;
        if (input.functionName === "getLiquidity") return 123n;
      }
      const tokenFixture = findByToken(input.address);
      if (tokenFixture) {
        if (options.metadataFailures?.has(input.address.toLowerCase())) {
          throw new Error("optional metadata unavailable");
        }
        const unsafeMetadata = options.unsafeMetadata?.has(
          input.address.toLowerCase(),
        );
        if (unsafeMetadata && input.functionName === "name") {
          return `Unsafe\u0000${"N".repeat(100)}`;
        }
        if (unsafeMetadata && input.functionName === "symbol") {
          return `bad\u200b${"S".repeat(20)}`;
        }
        if (input.functionName === "name") return `Token ${tokenFixture.anchor.token.slice(-4)}`;
        if (input.functionName === "symbol") return `T${tokenFixture.anchor.token.slice(-3)}`;
        if (input.functionName === "decimals") return 18;
        if (input.functionName === "totalSupply") return 1_000_000n * 10n ** 18n;
        if (input.functionName === "metadata") {
          if (unsafeMetadata) {
            return [
              `Unsafe\u0000${"D".repeat(400)}`,
              `https://example.com/${"w".repeat(2_100)}`,
              "javascript:alert(1)",
              `0x${"61".repeat(1_201)}`,
            ] as const;
          }
          return {
            description: "",
            website: "",
            image: "",
            extraData: "0x",
          };
        }
      }
      throw new Error(`Unexpected read ${input.functionName}`);
    }),
  };
  return {
    client: client as unknown as LaunchStampReaderClient,
    receiptCalls,
    readCalls,
  };
}

const PCAN = {
  transactionHash:
    "0xc07b4e70233534a1d4f435ffc9a636ed5f542f4aedcde35052c58224f378b612" as Hex,
  blockNumber: 25_717_953n,
  blockHash:
    "0x97827b6586f0dca00e44801acc529c3961b4c693988dfc9f4b2bb4c3d94632ba" as Hex,
  launchId:
    "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92" as Hex,
  stampHash:
    "0x06cb71b38d9b8b1dd1ffcdb00f31c774be36f5473979c3831d5fd0c96cdaa579" as Hex,
  token: getAddress("0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE"),
  hook: getAddress("0xEBa46f25DfF528141dE5317109Acb5A989296044"),
  poolId:
    "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229" as Hex,
};

describe("canonical Launch Stamp Router reader", () => {
  it("parses the exact direct PCAN event vector without making direct-call shape a trust requirement", () => {
    const vector = fixture({
      seed: 90,
      blockNumber: PCAN.blockNumber,
      blockHash: PCAN.blockHash,
      transactionHash: PCAN.transactionHash,
      transactionIndex: 0,
      firstLogIndex: 1,
    });
    const poolKey = {
      currency0: getAddress(ZERO_ADDRESS),
      currency1: PCAN.token,
      fee: 3_000,
      tickSpacing: 60,
      hooks: PCAN.hook,
    } as const;
    const components = [
      [getAddress("0x87B108848B444bC44A01734D62C7be4a2fA64983"), 0,
        "0x271793d9c3b904cb1e83b1c6db33be85282bae8ebed554937977826638228a94"],
      [PCAN.token, 1,
        "0xa72b5518fc9ed183450af8b394834fc78c0971b15cab121cfcaf61aa8af2c5e2"],
      [PCAN.hook, 2,
        "0xd59d31add7a3b206972725889dbb726782c0fbd82514710cf2d645749dc3fa25"],
    ] as const;
    const base = 12;
    const componentLogs = components.map(([account, kind, runtime], index) =>
      rawLog({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        topics: exactTopics(encodeEventTopics({
          abi: [launchStampComponentEvent],
          eventName: "ProgrammableComponentStampedV1",
          args: { launchId: PCAN.launchId, component: account, kind },
        })),
        data: encodeAbiParameters(parseAbiParameters("bytes32"), [runtime]),
        blockNumber: PCAN.blockNumber,
        blockHash: PCAN.blockHash,
        transactionHash: PCAN.transactionHash,
        transactionIndex: 0,
        logIndex: base + index,
      })
    );
    const route = rawLog({
      ...vector.logs[3] as Log,
      topics: exactTopics(encodeEventTopics({
        abi: [launchStampRouteEvent],
        eventName: "ProgrammableLaunchRouteStampedV1",
        args: {
          launchId: PCAN.launchId,
          kind: 1,
          routePayloadHash:
            "0x05d20f81020b0fd4a0a5b157e11453210ab73d5615d13bbccef3f023afdb2aa5",
        },
      })),
      data: encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [
        "0xda3fa225b1d597ad76665c0b9e894fe429b5cc89e44de855c567fe361fde0809",
        "0x0f97e3f202181d379805c775db656c36e2cfb77aa0ec56b0daabe0a6c5e84563",
      ]),
      blockNumber: PCAN.blockNumber,
      blockHash: PCAN.blockHash,
      transactionHash: PCAN.transactionHash,
      transactionIndex: 0,
      logIndex: 15,
    });
    const launch = rawLog({
      ...vector.logs[4] as Log,
      topics: exactTopics(encodeEventTopics({
        abi: [launchStampLaunchEvent],
        eventName: "ProgrammableLaunchStampedV1",
        args: { launchId: PCAN.launchId, token: PCAN.token, hook: PCAN.hook },
      })),
      data: encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [
        LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
        PCAN.poolId,
        PCAN.stampHash,
      ]),
      blockNumber: PCAN.blockNumber,
      blockHash: PCAN.blockHash,
      transactionHash: PCAN.transactionHash,
      transactionIndex: 0,
      logIndex: 16,
    });
    const initialize = rawLog({
      address: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
      topics: exactTopics(encodeEventTopics({
        abi: [poolManagerInitializeEvent],
        eventName: "Initialize",
        args: {
          id: PCAN.poolId,
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
        },
      })),
      data: encodeAbiParameters(parseAbiParameters("uint24,int24,address,uint160,int24"), [
        3_000,
        60,
        PCAN.hook,
        0x7b82009f4e993a8fab74db060d9fn,
        207_240,
      ]),
      blockNumber: PCAN.blockNumber,
      blockHash: PCAN.blockHash,
      transactionHash: PCAN.transactionHash,
      transactionIndex: 0,
      logIndex: 1,
    });
    const anchor: LaunchStampAnchor = {
      launchId: PCAN.launchId,
      token: PCAN.token,
      hook: PCAN.hook,
      poolManager: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
      poolId: PCAN.poolId,
      stampHash: PCAN.stampHash,
      blockNumber: PCAN.blockNumber,
      blockHash: PCAN.blockHash,
      transactionHash: PCAN.transactionHash,
      transactionIndex: 0,
      logIndex: 16,
    };
    const parsed = parseLaunchStampReceipt(
      anchor,
      receiptFor([{ ...vector, anchor, logs: [initialize, ...componentLogs, route, launch] }]),
    );
    expect(LAUNCH_STAMP_DIRECT_CALL_SELECTOR).toBe("0xe5f6b8cd");
    expect(parsed).toMatchObject({
      poolKey,
      route: { kind: 1, logIndex: 15 },
      components: [{ logIndex: 12 }, { logIndex: 13 }, { logIndex: 14 }],
    });
  });

  it("hydrates an internally called launch without reading tx.to or top-level calldata, at finalized state only", async () => {
    const item = fixture({ seed: 1 });
    const latest = item.anchor.blockNumber + 100n;
    const { client, readCalls } = clientFor([item], { latestBlock: latest });
    expect("getTransaction" in (client as object)).toBe(false);

    const result = await hydrateLaunchStampAnchor(deployment, item.anchor, { client });

    expect(result.token).toMatchObject({
      tokenAddress: item.anchor.token,
      launchModel: "custom-graph",
      liquidityPath: "programmable-v4",
      activeLiquidity: "123",
      totalSwapFeeBps: null,
    });
    expect(result.launchStampProvenance.finalizedAtBlockNumber).toBe(
      latest.toString(),
    );
    const mutableReads = readCalls.filter((call) =>
      call.address.toLowerCase() === STATE_VIEW.toLowerCase() ||
      call.address.toLowerCase() === item.anchor.token.toLowerCase()
    );
    expect(new Set(mutableReads.map(({ blockNumber }) => blockNumber))).toEqual(
      new Set([latest - LAUNCH_STAMP_FINALITY_CONFIRMATIONS]),
    );
  });

  it("does not require an exclusive hook proof for kind 2 Classic", async () => {
    const item = fixture({ seed: 2, kind: 2 });
    const { client, readCalls } = clientFor([item]);
    const result = await hydrateLaunchStampAnchor(deployment, item.anchor, { client });
    expect(result.token).toMatchObject({
      launchModel: "classic",
      liquidityPath: "programmable-v4",
      totalSwapFeeBps: null,
    });
    expect(result.launchStampProvenance.components.at(-1)).toMatchObject({
      address: item.anchor.hook,
      scope: "shared-infrastructure",
      exclusiveProof: null,
    });
    expect(readCalls.some((call) =>
      call.functionName === "stampProof" &&
      String(call.args?.[0]).toLowerCase() === item.anchor.hook.toLowerCase()
    )).toBe(false);
  });

  it("rejects a prior exclusive hook binding but permits repeated Classic shared-hook use", async () => {
    const sharedHook = address(0x7777);
    const sharedHookHash = hex32(0x7777);
    const sharedHookCode = marker(0x7777);
    const first = fixture({
      seed: 20,
      kind: 2,
      hook: sharedHook,
      hookRuntimeCodeHash: sharedHookHash,
      hookCode: sharedHookCode,
    });
    const second = fixture({
      seed: 21,
      kind: 2,
      hook: sharedHook,
      hookRuntimeCodeHash: sharedHookHash,
      hookCode: sharedHookCode,
    });
    const normal = clientFor([first, second]);
    await expect(hydrateLaunchStampAnchor(deployment, first.anchor, {
      client: normal.client,
    })).resolves.toBeDefined();
    await expect(hydrateLaunchStampAnchor(deployment, second.anchor, {
      client: normal.client,
    })).resolves.toBeDefined();

    const collision = clientFor([first], {
      sharedHookExclusiveCollision: true,
    });
    await expect(hydrateLaunchStampAnchor(deployment, first.anchor, {
      client: collision.client,
    })).rejects.toThrow("already bound as an exclusive component");
  });

  it("rejects reordered stamp logs, missing Initialize, and transaction-index drift", () => {
    const item = fixture({ seed: 3 });
    const receipt = receiptFor([item]);
    const reordered = {
      ...receipt,
      logs: receipt.logs.map((log) =>
        log.logIndex === 3 ? { ...log, logIndex: 4 } :
          log.logIndex === 4 ? { ...log, logIndex: 3 } : log
      ),
    } as TransactionReceipt;
    expect(() => parseLaunchStampReceipt(item.anchor, reordered)).toThrow(
      "Component -> Route -> Launch",
    );
    expect(() => parseLaunchStampReceipt(item.anchor, {
      ...receipt,
      logs: receipt.logs.slice(1),
    } as TransactionReceipt)).toThrow("exactly one prior pool initialization");
    expect(() => parseLaunchStampReceipt(item.anchor, {
      ...receipt,
      transactionIndex: item.anchor.transactionIndex + 1,
    } as TransactionReceipt)).toThrow("receipt provenance mismatch");
    expect(() => parseLaunchStampReceipt(item.anchor, {
      ...receipt,
      status: "reverted",
    } as TransactionReceipt)).toThrow("receipt provenance mismatch");
    expect(() => parseLaunchStampReceipt(item.anchor, {
      ...receipt,
      logs: receipt.logs.map((log) =>
        log.logIndex === item.anchor.logIndex
          ? { ...log, transactionIndex: item.anchor.transactionIndex + 1 }
          : log
      ),
    } as TransactionReceipt)).toThrow("anchor arguments differ");
  });

  it.each([
    ["exclusive proof", (item: Fixture) => ({ wrongProofAddress: item.anchor.hook })],
    ["component runtime", (item: Fixture) => ({ wrongRuntimeAddress: item.anchor.token })],
    ["Router runtime", () => ({ wrongRuntimeAddress: LAUNCH_STAMP_ROUTER_ADDRESS })],
    ["PoolKey hash", () => ({ wrongPoolKeyHash: true })],
  ])("fails closed on a wrong %s", async (_label, option) => {
    const item = fixture({ seed: 4 });
    const { client } = clientFor([item], option(item));
    await expect(
      hydrateLaunchStampAnchor(deployment, item.anchor, { client }),
    ).rejects.toThrow();
  });

  it("excludes anchors below 64 confirmations", async () => {
    const item = fixture({ seed: 5 });
    const { client } = clientFor([item], {
      latestBlock: item.anchor.blockNumber + 63n,
    });
    await expect(
      hydrateLaunchStampAnchor(deployment, item.anchor, { client }),
    ).rejects.toThrow("does not have 64 confirmations");
    await expect(scanLaunchStampAnchors(client, {
      fromBlock: item.anchor.blockNumber,
      toBlock: item.anchor.blockNumber,
      latestBlock: item.anchor.blockNumber + 63n,
    })).rejects.toThrow("without 64 confirmations");
  });

  it("halves 5000-block getLogs windows and retains the reduced successful size", async () => {
    const widths: bigint[] = [];
    const fromBlock = LAUNCH_STAMP_ROUTER_START_BLOCK;
    const toBlock = fromBlock + 5_999n;
    const client = {
      getLogs: vi.fn(async ({ fromBlock: from, toBlock: to }: {
        fromBlock: bigint;
        toBlock: bigint;
      }) => {
        const width = to - from + 1n;
        widths.push(width);
        if (width > 625n) throw new Error("provider range limit");
        return [];
      }),
    } as unknown as LaunchStampReaderClient;
    await scanLaunchStampAnchors(client, {
      fromBlock,
      toBlock,
      latestBlock: toBlock + LAUNCH_STAMP_FINALITY_CONFIRMATIONS,
    });
    expect(widths.slice(0, 5)).toEqual([5_000n, 2_500n, 1_250n, 625n, 625n]);
    expect(widths.filter((width) => width === 5_000n)).toHaveLength(1);
  });

  it("rebuilds only the Router slice from the immutable anchor after a cursor reorg", async () => {
    const canonicalCursorHash = hex32(0xf00);
    const latest = LAUNCH_STAMP_ROUTER_START_BLOCK + 100n;
    const { client } = clientFor([], {
      latestBlock: latest,
      cursorCanonicalHash: canonicalCursorHash,
    });
    const result = await advanceLaunchStampRouterSlice(deployment, {
      cursor: {
        blockNumber: (LAUNCH_STAMP_ROUTER_START_BLOCK + 5n).toString(),
        blockHash: hex32(0xbad),
      },
      tokens: [{ tokenAddress: address(0xdead) } as LauncherToken],
    }, { client });
    expect(result.rebuiltAfterReorg).toBe(true);
    expect(result.slice.tokens).toEqual([]);
    expect(result.scannedFromBlock).toBe(LAUNCH_STAMP_ROUTER_START_BLOCK.toString());
    expect(result.slice.cursor.blockNumber).toBe(
      (latest - LAUNCH_STAMP_FINALITY_CONFIRMATIONS).toString(),
    );
  });

  it("fetches a shared receipt once and lets poisoned optional metadata fall back without pinning later launches", async () => {
    const sharedTx = hex32(0xf10);
    const sharedBlock = LAUNCH_STAMP_ROUTER_START_BLOCK + 20n;
    const sharedHash = hex32(0xf11);
    const first = fixture({
      seed: 6,
      blockNumber: sharedBlock,
      blockHash: sharedHash,
      transactionHash: sharedTx,
      firstLogIndex: 1,
    });
    const second = fixture({
      seed: 7,
      blockNumber: sharedBlock,
      blockHash: sharedHash,
      transactionHash: sharedTx,
      firstLogIndex: 6,
    });
    const { client, receiptCalls } = clientFor([first, second], {
      latestBlock: sharedBlock + 100n,
      metadataFailures: new Set([first.anchor.token.toLowerCase()]),
    });
    const result = await advanceLaunchStampRouterSlice(
      deployment,
      createInitialLaunchStampRouterSlice(),
      { client },
    );
    expect(receiptCalls).toHaveBeenCalledTimes(1);
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.getBlock).mock.calls.filter(([request]) => request?.blockNumber === sharedBlock)).toHaveLength(1);
    const codeReads = vi.mocked(client.getCode).mock.calls.map(([request]) =>
      `${request.address.toLowerCase()}:${request.blockNumber}`,
    );
    expect(codeReads).toHaveLength(new Set(codeReads).size);
    expect(result.slice.tokens).toHaveLength(2);
    expect(result.slice.tokens[0]).toMatchObject({
      name: expect.stringContaining(first.anchor.token.slice(0, 8)),
    });
    expect(result.slice.tokens[0]).not.toHaveProperty("tokenDecimals");
    expect(result.slice.tokens[1]?.tokenAddress).toBe(second.anchor.token);
  });

  it("bounds unsafe and oversized UERC20 metadata without dropping it or later stamps", async () => {
    const first = fixture({ seed: 22 });
    const second = fixture({ seed: 23 });
    const { client } = clientFor([first, second], {
      latestBlock: second.anchor.blockNumber + 100n,
      unsafeMetadata: new Set([first.anchor.token.toLowerCase()]),
    });
    const result = await advanceLaunchStampRouterSlice(
      deployment,
      createInitialLaunchStampRouterSlice(),
      { client },
    );
    const poisoned = result.slice.tokens.find((token) =>
      token.tokenAddress.toLowerCase() === first.anchor.token.toLowerCase()
    );
    expect(result.slice.tokens).toHaveLength(2);
    expect(poisoned).toMatchObject({
      name: expect.stringContaining(first.anchor.token.slice(0, 8)),
      symbol: `A${first.anchor.token.slice(-9)}`.toUpperCase(),
      launchStampProvenance: {
        launchId: first.anchor.launchId,
        stampHash: first.anchor.stampHash,
      },
    });
    expect(poisoned).not.toHaveProperty("description");
    expect(poisoned).not.toHaveProperty("imageUrl");
    expect(poisoned).not.toHaveProperty("links");
    expect(poisoned).not.toHaveProperty("metadataExtraData");
    expect(JSON.stringify(poisoned).length).toBeLessThan(10_000);
    expect(result.slice.tokens.some((token) =>
      token.tokenAddress.toLowerCase() === second.anchor.token.toLowerCase()
    )).toBe(true);
  });

  it("bounds each catch-up invocation to 50,000 blocks", async () => {
    const latest = LAUNCH_STAMP_ROUTER_START_BLOCK + 100_000n;
    const { client } = clientFor([], { latestBlock: latest });
    const result = await advanceLaunchStampRouterSlice(
      deployment,
      createInitialLaunchStampRouterSlice(),
      { client },
    );
    expect(result.slice.cursor.blockNumber).toBe(
      (LAUNCH_STAMP_ROUTER_START_BLOCK - 1n + 50_000n).toString(),
    );
    expect(result.caughtUp).toBe(false);
    expect(result.highestSafeBlockNumber).toBe(
      (latest - LAUNCH_STAMP_FINALITY_CONFIRMATIONS).toString(),
    );
  });

  it("reports current only when the cursor already equals the safe head", async () => {
    const latest = LAUNCH_STAMP_ROUTER_START_BLOCK + 100n;
    const highestSafe = latest - LAUNCH_STAMP_FINALITY_CONFIRMATIONS;
    const { client } = clientFor([], { latestBlock: latest });
    const result = await advanceLaunchStampRouterSlice(deployment, {
      cursor: {
        blockNumber: highestSafe.toString(),
        blockHash: hex32(Number(highestSafe % 10_000n) + 0xd00),
      },
      tokens: [],
    }, { client });

    expect(result.scannedFromBlock).toBeNull();
    expect(result.caughtUp).toBe(true);
    expect(result.highestSafeBlockNumber).toBe(highestSafe.toString());
  });

  it("moves the cursor only to a canonical prefix when launch density exceeds the hydration bound", async () => {
    const denseBlock = LAUNCH_STAMP_ROUTER_START_BLOCK + 1n;
    const item = fixture({ seed: 8, blockNumber: denseBlock });
    const base = item.logs.at(-1) as Log;
    const logs = Array.from({ length: 513 }, (_, index) => ({
      ...base,
      transactionHash: hex32(0x2000 + index),
      logIndex: index,
    }));
    const { client } = clientFor([], {
      latestBlock: LAUNCH_STAMP_ROUTER_START_BLOCK + 100n,
    });
    client.getLogs = vi.fn(async () => logs) as typeof client.getLogs;
    const result = await advanceLaunchStampRouterSlice(
      deployment,
      createInitialLaunchStampRouterSlice(),
      { client },
    );
    expect(result.boundedByDensity).toBe(true);
    expect(result.caughtUp).toBe(false);
    expect(result.slice.cursor.blockNumber).toBe(
      LAUNCH_STAMP_ROUTER_START_BLOCK.toString(),
    );
    expect(result.slice.tokens).toEqual([]);
  });
});

it("keeps successor scans isolated from the historical router", async () => {
  const router = "0xBE4bF6Ac8c6F012E1C8f25747A9fBccB2FDAC4C3";
  const start = 26_152_286n;
  const reader = createLaunchStampReaderV1({
    routerAddress: router,
    routerRuntimeCodeHash: "0xf2d611fb92718c63cf5767300e79d7c9b49480b2e9001448b96c1385f4edb6f3",
    routerStartBlock: start,
    initialCursor: { blockNumber: String(start - 1n), blockHash: hex32(1) },
  });
  const item = fixture({ seed: 1, blockNumber: start + 1n });
  const launchLog = item.logs.at(-1)!;
  const getLogs = vi.fn(async () => [{ ...launchLog, address: router }]);
  const client = { getLogs } as unknown as LaunchStampReaderClient;
  const range = { fromBlock: item.anchor.blockNumber, toBlock: item.anchor.blockNumber, latestBlock: item.anchor.blockNumber + 64n };
  expect(await reader.scanLaunchStampAnchors(client, range)).toEqual([item.anchor]);
  expect(getLogs.mock.calls).toHaveLength(1);
  expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: router }));
  getLogs.mockResolvedValueOnce([launchLog]);
  await expect(reader.scanLaunchStampAnchors(client, range)).rejects.toThrow();
});
