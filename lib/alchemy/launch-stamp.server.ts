import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { mainnet } from "viem/chains";

import {
  characterLength,
  hasUnsafeDisplayCharacters,
  isValidTokenSymbol,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  utf8ByteLength,
} from "../metadata-policy";
import { stateViewReadAbi, uerc20ReadAbi } from "../onchain/abis";
import {
  buildTokenLinks,
  decodeSocialMetadata,
  sanitizeImageUrl,
  sanitizeWebsiteUrl,
} from "../onchain/metadata";
import type { ReadyOnchainDeployment } from "../onchain/types";
import type {
  LauncherToken,
  LaunchStampProvenanceV1,
} from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";

export const LAUNCH_STAMP_ROUTER_ADDRESS = getAddress(
  "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
);
export const LAUNCH_STAMP_ROUTER_START_BLOCK = 25_717_612n;
export const LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH =
  "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546" as const;
export const LAUNCH_STAMP_POOL_MANAGER_ADDRESS = getAddress(
  "0x000000000004444c5dc75cB358380D2e3dE08A90",
);
export const LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH =
  "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293" as const;
export const LAUNCH_STAMP_FINALITY_CONFIRMATIONS = 64n;
/** Direct-call evidence only. Discovery and hydration never require tx.to/input. */
export const LAUNCH_STAMP_DIRECT_CALL_SELECTOR = "0xe5f6b8cd" as const;
export const LAUNCH_STAMP_ROUTER_INITIAL_CURSOR = Object.freeze({
  blockNumber: (LAUNCH_STAMP_ROUTER_START_BLOCK - 1n).toString(),
  blockHash:
    "0x2d42bd6f5cea0a09b7a76c5ca51569ac69e677cef0498b12730d6f1f7a979a5e" as Hex,
});

export const LAUNCH_STAMP_COMPONENT_TOPIC =
  "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b" as const;
export const LAUNCH_STAMP_ROUTE_TOPIC =
  "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5" as const;
export const LAUNCH_STAMP_LAUNCH_TOPIC =
  "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2" as const;
export const POOL_MANAGER_INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as const;

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const INITIAL_LOG_CHUNK = 5_000n;
const MINIMUM_LOG_CHUNK = 100n;
const MAXIMUM_CATCH_UP_BLOCKS = 50_000n;
const MAXIMUM_ANCHORS_PER_ADVANCE = 512;
const HYDRATION_CONCURRENCY = 3;
const COMPONENT_CONCURRENCY = 4;

export const launchStampComponentEvent = parseAbiItem(
  "event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)",
);
export const launchStampRouteEvent = parseAbiItem(
  "event ProgrammableLaunchRouteStampedV1(bytes32 indexed launchId,uint8 indexed kind,bytes32 indexed routePayloadHash,bytes32 expectedResultHash,bytes32 permitDigest)",
);
export const launchStampLaunchEvent = parseAbiItem(
  "event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)",
);
export const poolManagerInitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
);

export const launchStampRouterReadAbi = parseAbi([
  "function CHAIN_ID() view returns (uint256)",
  "function POOL_MANAGER() view returns (address)",
  "function launchStamp(bytes32 launchId) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash) record)",
  "function launchIdByToken(address token) view returns (bytes32 launchId)",
  "function launchIdByPool(address poolManager,bytes32 poolId) view returns (bytes32 launchId)",
  "function launchIdByComponent(address component) view returns (bytes32 launchId)",
  "function componentRuntimeCodeHash(address component) view returns (bytes32 runtimeCodeHash)",
  "function stampProof(address component) view returns (bytes32 launchId,bytes32 stampHash)",
  "function computePoolKeyHash((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey) pure returns (bytes32)",
]);

export type LaunchStampReaderClient = PublicClient;

export type LaunchStampRouterCursor = Readonly<{
  blockNumber: string;
  blockHash: Hex;
}>;

export type LaunchStampRouterSlice = Readonly<{
  cursor: LaunchStampRouterCursor;
  tokens: readonly LauncherToken[];
}>;

export type LaunchStampAnchor = Readonly<{
  launchId: Hex;
  token: Address;
  hook: Address;
  poolManager: Address;
  poolId: Hex;
  stampHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
}>;

export type LaunchStampPoolKey = Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}>;

export type ParsedLaunchStampComponent = Readonly<{
  launchId: Hex;
  component: Address;
  kind: 0 | 1 | 2;
  runtimeCodeHash: Hex;
  logIndex: number;
}>;

export type ParsedLaunchStampRoute = Readonly<{
  launchId: Hex;
  kind: 1 | 2;
  routePayloadHash: Hex;
  expectedResultHash: Hex;
  permitDigest: Hex;
  logIndex: number;
}>;

export type ParsedLaunchStampReceipt = Readonly<{
  components: readonly ParsedLaunchStampComponent[];
  route: ParsedLaunchStampRoute;
  poolKey: LaunchStampPoolKey;
  initializeLogIndex: number;
}>;

export type HydratedLaunchStamp = Readonly<{
  token: LauncherToken;
  launchStampProvenance: LaunchStampProvenanceV1;
}>;

export type AdvanceLaunchStampRouterResult = Readonly<{
  slice: LaunchStampRouterSlice;
  scannedFromBlock: string | null;
  scannedToBlock: string;
  discovered: number;
  hydrated: number;
  boundedByDensity: boolean;
  rebuiltAfterReorg: boolean;
  highestSafeBlockNumber: string;
  caughtUp: boolean;
}>;

export type LaunchStampReaderOptions = Readonly<{
  client?: LaunchStampReaderClient;
}>;

type StampRecord = Readonly<{
  kind: number;
  launchWallet: Address;
  token: Address;
  hook: Address;
  poolManager: Address;
  poolId: Hex;
  poolKeyHash: Hex;
  componentSetHash: Hex;
  routePayloadHash: Hex;
  routeLauncher: Address;
  routeLauncherRuntimeCodeHash: Hex;
  expectedResultHash: Hex;
  permitDigest: Hex;
  stampHash: Hex;
}>;

export type LaunchStampCanonicalBlock = Readonly<{
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}>;

export class LaunchStampReaderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LaunchStampReaderError";
  }
}

function fail(message: string): never {
  throw new LaunchStampReaderError(message);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function requireHex(value: Hex | null | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-f]{64}$/iu.test(value)) {
    fail(`${label} is unavailable`);
  }
  return value;
}

function requireLogIndex(value: number | null | undefined, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${label} is unavailable`);
  }
  return value as number;
}

function requireCanonicalDeployment(deployment: ReadyOnchainDeployment) {
  if (deployment.chainId !== 1) {
    fail("Launch Stamp Router discovery is restricted to Ethereum mainnet");
  }
}

function createReaderClient(deployment: ReadyOnchainDeployment) {
  requireCanonicalDeployment(deployment);
  return createPublicClient({
    chain: mainnet,
    transport: http(deployment.rpcUrl, {
      retryCount: 2,
      timeout: 12_000,
    }),
  });
}

async function canonicalBlock(
  client: LaunchStampReaderClient,
  blockNumber: bigint,
): Promise<LaunchStampCanonicalBlock> {
  const block = await client.getBlock({ blockNumber });
  if (block.number !== blockNumber) fail("RPC returned the wrong block number");
  return {
    number: blockNumber,
    hash: requireHex(block.hash, `Block ${blockNumber} hash`),
    timestamp: block.timestamp,
  };
}

async function assertRuntimeCodeHash(
  client: LaunchStampReaderClient,
  address: Address,
  expected: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x" || !sameHex(keccak256(code), expected)) {
    fail(`${label} runtime code hash mismatch`);
  }
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
) {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index] as Input, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Isolate each immutable Router deployment while keeping historical readers intact. */
export function createLaunchStampReaderV1(binding: Readonly<{
  routerAddress: Address;
  routerRuntimeCodeHash: Hex;
  routerStartBlock: bigint;
  initialCursor: LaunchStampRouterCursor;
}>) {
  const LAUNCH_STAMP_ROUTER_ADDRESS = getAddress(binding.routerAddress);
  const LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH = binding.routerRuntimeCodeHash;
  const LAUNCH_STAMP_ROUTER_START_BLOCK = binding.routerStartBlock;
  const LAUNCH_STAMP_ROUTER_INITIAL_CURSOR = Object.freeze({ ...binding.initialCursor });
  if (BigInt(binding.initialCursor.blockNumber) !== binding.routerStartBlock - 1n) {
    throw new TypeError("Router discovery cursor must precede its deployment");
  }

  function anchorFromLog(log: Log): LaunchStampAnchor {
    if (
      !log.blockNumber ||
      !log.blockHash ||
      !log.transactionHash ||
      !isAddressEqual(log.address, LAUNCH_STAMP_ROUTER_ADDRESS)
    ) {
      fail("Launch Stamp discovery returned incomplete provenance");
    }
    const decoded = decodeEventLog({
      abi: [launchStampLaunchEvent],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    const args = decoded.args;
    if (!isAddressEqual(args.poolManager, LAUNCH_STAMP_POOL_MANAGER_ADDRESS)) {
      fail("Launch Stamp event used a non-canonical PoolManager");
    }
    return {
      launchId: args.launchId,
      token: getAddress(args.token),
      hook: getAddress(args.hook),
      poolManager: getAddress(args.poolManager),
      poolId: args.poolId,
      stampHash: args.stampHash,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: requireLogIndex(
        log.transactionIndex,
        "Launch Stamp transaction index",
      ),
      logIndex: requireLogIndex(log.logIndex, "Launch Stamp log index"),
    };
  }

  async function scanLaunchStampAnchors(
    client: LaunchStampReaderClient,
    input: Readonly<{
      fromBlock: bigint;
      toBlock: bigint;
      latestBlock?: bigint;
    }>,
  ) {
    if (input.fromBlock < LAUNCH_STAMP_ROUTER_START_BLOCK) {
      fail("Launch Stamp scan begins before the canonical Router deployment");
    }
    const latestBlock = input.latestBlock ?? (await client.getBlockNumber());
    const highestFinalized = latestBlock - LAUNCH_STAMP_FINALITY_CONFIRMATIONS;
    if (input.toBlock > highestFinalized) {
      fail("Launch Stamp scan includes a block without 64 confirmations");
    }
    if (input.fromBlock > input.toBlock) return [] as LaunchStampAnchor[];

    const anchors: LaunchStampAnchor[] = [];
    let cursor = input.fromBlock;
    let chunkSize = INITIAL_LOG_CHUNK;
    while (cursor <= input.toBlock) {
      const end = cursor + chunkSize - 1n < input.toBlock
        ? cursor + chunkSize - 1n
        : input.toBlock;
      try {
        const logs = await client.getLogs({
          address: LAUNCH_STAMP_ROUTER_ADDRESS,
          event: launchStampLaunchEvent,
          fromBlock: cursor,
          toBlock: end,
          strict: true,
        });
        anchors.push(...logs.map((log) => anchorFromLog(log)));
        cursor = end + 1n;
      } catch (error) {
        const attempted = end - cursor + 1n;
        if (attempted <= MINIMUM_LOG_CHUNK) {
          throw new LaunchStampReaderError(
            `Launch Stamp log scan failed at the minimum ${MINIMUM_LOG_CHUNK}-block window`,
            { cause: error },
          );
        }
        chunkSize = attempted / 2n;
        if (chunkSize < MINIMUM_LOG_CHUNK) chunkSize = MINIMUM_LOG_CHUNK;
      }
    }

    anchors.sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.transactionIndex === right.transactionIndex
          ? left.logIndex - right.logIndex
          : left.transactionIndex - right.transactionIndex
        : left.blockNumber < right.blockNumber ? -1 : 1
    );
    const identities = new Set<string>();
    for (const anchor of anchors) {
      const identity = `${anchor.transactionHash.toLowerCase()}:${anchor.logIndex}`;
      if (identities.has(identity)) fail("Duplicate Launch Stamp discovery anchor");
      identities.add(identity);
    }
    return anchors;
  }

  function componentFromLog(log: Log): ParsedLaunchStampComponent {
    const decoded = decodeEventLog({
      abi: [launchStampComponentEvent],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    const kind = Number(decoded.args.kind);
    if (kind !== 0 && kind !== 1 && kind !== 2) {
      fail("Launch Stamp component kind is invalid");
    }
    return {
      launchId: decoded.args.launchId,
      component: getAddress(decoded.args.component),
      kind,
      runtimeCodeHash: decoded.args.runtimeCodeHash,
      logIndex: requireLogIndex(log.logIndex, "Component log index"),
    };
  }

  function routeFromLog(log: Log): ParsedLaunchStampRoute {
    const decoded = decodeEventLog({
      abi: [launchStampRouteEvent],
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    const kind = Number(decoded.args.kind);
    if (kind !== 1 && kind !== 2) fail("Launch Stamp route kind is invalid");
    return {
      launchId: decoded.args.launchId,
      kind,
      routePayloadHash: decoded.args.routePayloadHash,
      expectedResultHash: decoded.args.expectedResultHash,
      permitDigest: decoded.args.permitDigest,
      logIndex: requireLogIndex(log.logIndex, "Route log index"),
    };
  }

  function parseRouterRun(run: readonly Log[]) {
    if (
      run.length < 4 ||
      run.length > 18 ||
      !sameHex(run.at(-2)?.topics[0] ?? "", LAUNCH_STAMP_ROUTE_TOPIC) ||
      !sameHex(run.at(-1)?.topics[0] ?? "", LAUNCH_STAMP_LAUNCH_TOPIC) ||
      run.slice(0, -2).some((log) =>
        !sameHex(log.topics[0] ?? "", LAUNCH_STAMP_COMPONENT_TOPIC)
      )
    ) {
      fail("Router logs are not a contiguous Component -> Route -> Launch group");
    }
    for (let index = 1; index < run.length; index += 1) {
      if (
        requireLogIndex(run[index]?.logIndex, "Router log index") !==
        requireLogIndex(run[index - 1]?.logIndex, "Router log index") + 1
      ) {
        fail("Router stamp logs are not contiguous");
      }
    }
    const components = run.slice(0, -2).map(componentFromLog);
    if (components.length < 2 || components.length > 16) {
      fail("Launch Stamp component count is outside the Router bound");
    }
    const route = routeFromLog(run.at(-2) as Log);
    const launchLog = run.at(-1) as Log;
    const launch = anchorFromLog(launchLog);
    if (
      !sameHex(route.launchId, launch.launchId) ||
      components.some((component) => !sameHex(component.launchId, launch.launchId))
    ) {
      fail("Router stamp group contains mixed launch identities");
    }
    return { components, route, launch, launchLog };
  }

  function parseLaunchStampReceipt(
    anchor: LaunchStampAnchor,
    receipt: TransactionReceipt,
  ): ParsedLaunchStampReceipt {
    if (
      receipt.status !== "success" ||
      !sameHex(receipt.transactionHash, anchor.transactionHash) ||
      receipt.blockNumber !== anchor.blockNumber ||
      receipt.transactionIndex !== anchor.transactionIndex ||
      !sameHex(requireHex(receipt.blockHash, "Receipt block hash"), anchor.blockHash)
    ) {
      fail("Launch Stamp receipt provenance mismatch");
    }

    const ordered = [...receipt.logs].sort(
      (left, right) =>
        requireLogIndex(left.logIndex, "Receipt log index") -
        requireLogIndex(right.logIndex, "Receipt log index"),
    );
    const runs: Log[][] = [];
    let current: Log[] = [];
    for (const log of ordered) {
      if (isAddressEqual(log.address, LAUNCH_STAMP_ROUTER_ADDRESS)) {
        const previous = current.at(-1);
        if (
          previous &&
          requireLogIndex(log.logIndex, "Router log index") !==
            requireLogIndex(previous.logIndex, "Router log index") + 1
        ) {
          runs.push(current);
          current = [];
        }
        current.push(log);
      } else if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    const groups = runs.map(parseRouterRun);
    const matches = groups.filter(({ launch }) =>
      launch.logIndex === anchor.logIndex &&
      sameHex(launch.launchId, anchor.launchId)
    );
    if (matches.length !== 1) fail("Launch Stamp anchor has no unique receipt group");
    const group = matches[0];
    if (
      !sameHex(group.launch.token, anchor.token) ||
      !sameHex(group.launch.hook, anchor.hook) ||
      !sameHex(group.launch.poolManager, anchor.poolManager) ||
      !sameHex(group.launch.poolId, anchor.poolId) ||
      !sameHex(group.launch.stampHash, anchor.stampHash) ||
      group.launch.transactionIndex !== anchor.transactionIndex
    ) {
      fail("Launch Stamp anchor arguments differ from its receipt");
    }

    const matchingInitializes = ordered.filter((log) =>
      isAddressEqual(log.address, LAUNCH_STAMP_POOL_MANAGER_ADDRESS) &&
      sameHex(log.topics[0] ?? "", POOL_MANAGER_INITIALIZE_TOPIC) &&
      requireLogIndex(log.logIndex, "Initialize log index") <
        (group.components[0]?.logIndex ?? 0) &&
      sameHex(log.topics[1] ?? "", anchor.poolId)
    );
    if (matchingInitializes.length !== 1) {
      fail("Launch Stamp receipt must contain exactly one prior pool initialization");
    }
    const initialize = matchingInitializes[0] as Log;
    const decoded = decodeEventLog({
      abi: [poolManagerInitializeEvent],
      data: initialize.data,
      topics: initialize.topics,
      strict: true,
    });
    const poolKey = {
      currency0: getAddress(decoded.args.currency0),
      currency1: getAddress(decoded.args.currency1),
      fee: Number(decoded.args.fee),
      tickSpacing: Number(decoded.args.tickSpacing),
      hooks: getAddress(decoded.args.hooks),
    } satisfies LaunchStampPoolKey;
    if (
      !sameHex(decoded.args.id, anchor.poolId) ||
      !isAddressEqual(poolKey.hooks, anchor.hook) ||
      !sameHex(computeOfficialV4PoolId(poolKey), anchor.poolId)
    ) {
      fail("Pool initialization does not reconstruct the stamped PoolKey");
    }
    return {
      components: group.components,
      route: group.route,
      poolKey,
      initializeLogIndex: requireLogIndex(
        initialize.logIndex,
        "Initialize log index",
      ),
    };
  }

  async function readRouterState(
    client: LaunchStampReaderClient,
    anchor: LaunchStampAnchor,
    poolKey: LaunchStampPoolKey,
  ) {
    const blockNumber = anchor.blockNumber;
    const [chainId, poolManager, record, tokenLaunchId, poolLaunchId, tokenProof,
      computedPoolKeyHash] = await Promise.all([
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "CHAIN_ID",
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "POOL_MANAGER",
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "launchStamp",
        args: [anchor.launchId],
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "launchIdByToken",
        args: [anchor.token],
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "launchIdByPool",
        args: [LAUNCH_STAMP_POOL_MANAGER_ADDRESS, anchor.poolId],
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "stampProof",
        args: [anchor.token],
        blockNumber,
      }),
      client.readContract({
        address: LAUNCH_STAMP_ROUTER_ADDRESS,
        abi: launchStampRouterReadAbi,
        functionName: "computePoolKeyHash",
        args: [poolKey],
        blockNumber,
      }),
    ]);
    return {
      chainId,
      poolManager,
      record: record as StampRecord,
      tokenLaunchId,
      poolLaunchId,
      tokenProof,
      computedPoolKeyHash,
    };
  }

  function validateRouterState(
    anchor: LaunchStampAnchor,
    parsed: ParsedLaunchStampReceipt,
    state: Awaited<ReturnType<typeof readRouterState>>,
  ) {
    const record = state.record;
    if (
      state.chainId !== 1n ||
      !isAddressEqual(state.poolManager, LAUNCH_STAMP_POOL_MANAGER_ADDRESS) ||
      !sameHex(state.tokenLaunchId, anchor.launchId) ||
      !sameHex(state.poolLaunchId, anchor.launchId) ||
      !sameHex(state.tokenProof[0], anchor.launchId) ||
      !sameHex(state.tokenProof[1], anchor.stampHash) ||
      !sameHex(state.computedPoolKeyHash, record.poolKeyHash) ||
      record.kind !== parsed.route.kind ||
      !isAddressEqual(record.token, anchor.token) ||
      !isAddressEqual(record.hook, anchor.hook) ||
      !isAddressEqual(record.poolManager, LAUNCH_STAMP_POOL_MANAGER_ADDRESS) ||
      !sameHex(record.poolId, anchor.poolId) ||
      !sameHex(record.routePayloadHash, parsed.route.routePayloadHash) ||
      !sameHex(record.expectedResultHash, parsed.route.expectedResultHash) ||
      !sameHex(record.permitDigest, parsed.route.permitDigest) ||
      !sameHex(record.stampHash, anchor.stampHash) ||
      record.componentSetHash === ZERO_HASH ||
      record.poolKeyHash === ZERO_HASH ||
      record.routeLauncherRuntimeCodeHash === ZERO_HASH ||
      record.launchWallet === "0x0000000000000000000000000000000000000000" ||
      record.routeLauncher === "0x0000000000000000000000000000000000000000"
    ) {
      fail("Launch Stamp Router getter bundle does not match the receipt");
    }
    return record;
  }

  async function verifyComponents(
    client: LaunchStampReaderClient,
    anchor: LaunchStampAnchor,
    parsed: ParsedLaunchStampReceipt,
    kind: "custom-graph" | "classic",
  ) {
    const addresses = new Set<string>();
    let tokenSeen = false;
    let hookSeen = false;
    const components = await mapWithConcurrency(
      parsed.components,
      COMPONENT_CONCURRENCY,
      async (component): Promise<LaunchStampProvenanceV1["components"][number]> => {
        const key = component.component.toLowerCase();
        if (addresses.has(key)) fail("Launch Stamp contains duplicate components");
        addresses.add(key);
        const componentKind = component.kind === 1
          ? "token"
          : component.kind === 2 ? "hook" : "other";
        const sharedHook = kind === "classic" &&
          componentKind === "hook" &&
          isAddressEqual(component.component, anchor.hook);
        const scope = sharedHook ? "shared-infrastructure" : "exclusive";
        if (componentKind === "token" && isAddressEqual(component.component, anchor.token)) {
          tokenSeen = true;
        }
        if (componentKind === "hook" && isAddressEqual(component.component, anchor.hook)) {
          hookSeen = true;
        }
        await assertRuntimeCodeHash(
          client,
          component.component,
          component.runtimeCodeHash,
          anchor.blockNumber,
          `Component ${component.component}`,
        );
        if (sharedHook) {
          const priorExclusiveLaunchId = await client.readContract({
            address: LAUNCH_STAMP_ROUTER_ADDRESS,
            abi: launchStampRouterReadAbi,
            functionName: "launchIdByComponent",
            args: [component.component],
            blockNumber: anchor.blockNumber,
          });
          if (!sameHex(priorExclusiveLaunchId, ZERO_HASH)) {
            fail("Classic shared hook is already bound as an exclusive component");
          }
          return {
            address: component.component,
            kind: componentKind,
            scope,
            runtimeCodeHash: component.runtimeCodeHash,
            logIndex: component.logIndex,
            exclusiveProof: null,
          };
        }
        const [launchId, runtimeCodeHash, proof] = await Promise.all([
          client.readContract({
            address: LAUNCH_STAMP_ROUTER_ADDRESS,
            abi: launchStampRouterReadAbi,
            functionName: "launchIdByComponent",
            args: [component.component],
            blockNumber: anchor.blockNumber,
          }),
          client.readContract({
            address: LAUNCH_STAMP_ROUTER_ADDRESS,
            abi: launchStampRouterReadAbi,
            functionName: "componentRuntimeCodeHash",
            args: [component.component],
            blockNumber: anchor.blockNumber,
          }),
          client.readContract({
            address: LAUNCH_STAMP_ROUTER_ADDRESS,
            abi: launchStampRouterReadAbi,
            functionName: "stampProof",
            args: [component.component],
            blockNumber: anchor.blockNumber,
          }),
        ]);
        if (
          !sameHex(launchId, anchor.launchId) ||
          !sameHex(runtimeCodeHash, component.runtimeCodeHash) ||
          !sameHex(proof[0], anchor.launchId) ||
          !sameHex(proof[1], anchor.stampHash)
        ) {
          fail(`Exclusive component proof mismatch for ${component.component}`);
        }
        return {
          address: component.component,
          kind: componentKind,
          scope,
          runtimeCodeHash: component.runtimeCodeHash,
          logIndex: component.logIndex,
          exclusiveProof: {
            launchId: proof[0],
            stampHash: proof[1],
          },
        };
      },
    );
    if (!tokenSeen || !hookSeen) {
      fail("Launch Stamp is missing its canonical token or hook component");
    }
    return components;
  }

  async function optionalRead<T>(reader: () => Promise<T>): Promise<T | null> {
    try {
      return await reader();
    } catch {
      return null;
    }
  }

  function normalizedDisplayText(value: unknown) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && !hasUnsafeDisplayCharacters(normalized)
      ? normalized
      : null;
  }

  function normalizedTokenName(value: unknown) {
    const normalized = normalizedDisplayText(value);
    return normalized &&
        characterLength(normalized) <= MAX_TOKEN_NAME_CHARACTERS &&
        utf8ByteLength(normalized) <= MAX_TOKEN_NAME_BYTES
      ? normalized
      : null;
  }

  function normalizedTokenSymbol(value: unknown) {
    const normalized = normalizedDisplayText(value);
    return normalized &&
        utf8ByteLength(normalized) <= MAX_TOKEN_SYMBOL_BYTES &&
        isValidTokenSymbol(normalized)
      ? normalized
      : null;
  }

  function normalizedDescription(value: unknown) {
    const normalized = normalizedDisplayText(value);
    return normalized && utf8ByteLength(normalized) <= MAX_TOKEN_DESCRIPTION_BYTES
      ? normalized
      : null;
  }

  function metadataField(
    value: unknown,
    index: number,
    key: "description" | "website" | "image" | "extraData",
  ) {
    if (Array.isArray(value)) return value[index];
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }

  function normalizedSocialExtraData(value: unknown): Hex | null {
    if (
      typeof value !== "string" ||
      value.length > 2 + MAX_SOCIAL_EXTRA_DATA_BYTES * 2 ||
      !/^0x(?:[0-9a-f]{2})+$/iu.test(value)
    ) {
      return null;
    }
    const extraData = value as Hex;
    return decodeSocialMetadata(extraData) ? extraData : null;
  }

  function addressSymbolFallback(address: Address) {
    return `A${address.slice(-9)}`.toUpperCase();
  }

  function optionalBigInt(value: unknown) {
    try {
      const normalized = BigInt(value as bigint);
      return normalized >= 0n ? normalized : null;
    } catch {
      return null;
    }
  }

  async function readTokenAndPoolState(
    client: LaunchStampReaderClient,
    deployment: ReadyOnchainDeployment,
    anchor: LaunchStampAnchor,
    blockNumber: bigint,
  ) {
    const [name, symbol, decimals, totalSupply, metadata, slot0, liquidity] =
      await Promise.all([
        optionalRead(() => client.readContract({
          address: anchor.token,
          abi: uerc20ReadAbi,
          functionName: "name",
          blockNumber,
        })),
        optionalRead(() => client.readContract({
          address: anchor.token,
          abi: uerc20ReadAbi,
          functionName: "symbol",
          blockNumber,
        })),
        optionalRead(() => client.readContract({
          address: anchor.token,
          abi: uerc20ReadAbi,
          functionName: "decimals",
          blockNumber,
        })),
        optionalRead(() => client.readContract({
          address: anchor.token,
          abi: uerc20ReadAbi,
          functionName: "totalSupply",
          blockNumber,
        })),
        optionalRead(() => client.readContract({
          address: anchor.token,
          abi: uerc20ReadAbi,
          functionName: "metadata",
          blockNumber,
        })),
        client.readContract({
          address: deployment.stateView,
          abi: stateViewReadAbi,
          functionName: "getSlot0",
          args: [anchor.poolId],
          blockNumber,
        }),
        client.readContract({
          address: deployment.stateView,
          abi: stateViewReadAbi,
          functionName: "getLiquidity",
          args: [anchor.poolId],
          blockNumber,
        }),
    ]);
    if (slot0[0] === 0n) fail("Stamped pool is not initialized in StateView");
    const normalizedName = normalizedTokenName(name) ??
      `Token ${anchor.token.slice(0, 8)}…${anchor.token.slice(-4)}`;
    const normalizedSymbol = normalizedTokenSymbol(symbol) ??
      addressSymbolFallback(anchor.token);
    const parsedDecimals = decimals === null ? null : Number(decimals);
    const normalizedDecimals = parsedDecimals !== null &&
        Number.isSafeInteger(parsedDecimals) &&
        parsedDecimals >= 0 &&
        parsedDecimals <= 255
      ? parsedDecimals
      : null;
    const normalizedSupply = totalSupply === null ? null : optionalBigInt(totalSupply);
    const description = normalizedDescription(
      metadataField(metadata, 0, "description"),
    );
    const website = sanitizeWebsiteUrl(metadataField(metadata, 1, "website"));
    const imageUrl = sanitizeImageUrl(metadataField(metadata, 2, "image"));
    const metadataExtraData = normalizedSocialExtraData(
      metadataField(metadata, 3, "extraData"),
    );
    const links = buildTokenLinks(website, metadataExtraData ?? "0x");
    return {
      name: normalizedName,
      symbol: normalizedSymbol,
      description,
      imageUrl,
      links: links.length > 0 ? links : undefined,
      metadataExtraData,
      decimals: normalizedDecimals,
      totalSupplyRaw: normalizedSupply?.toString(),
      totalSupply: normalizedSupply === null || normalizedDecimals === null
        ? undefined
        : formatUnits(normalizedSupply, normalizedDecimals),
      currentTick: Number(slot0[1]),
      protocolFeePips: Number(slot0[2]),
      lpFeePips: Number(slot0[3]),
      activeLiquidity: liquidity.toString(),
    };
  }

  async function hydrateLaunchStampAnchor(
    deployment: ReadyOnchainDeployment,
    anchor: LaunchStampAnchor,
    options: LaunchStampReaderOptions & Readonly<{
      latestBlock?: LaunchStampCanonicalBlock;
      stateBlock?: LaunchStampCanonicalBlock;
      receipt?: TransactionReceipt;
    }> = {},
  ): Promise<HydratedLaunchStamp> {
    requireCanonicalDeployment(deployment);
    if (
      anchor.blockNumber < LAUNCH_STAMP_ROUTER_START_BLOCK ||
      !isAddressEqual(anchor.poolManager, LAUNCH_STAMP_POOL_MANAGER_ADDRESS)
    ) {
      fail("Launch Stamp anchor is outside the canonical Router binding");
    }
    const client = options.client ?? createReaderClient(deployment);
    const chainId = await client.getChainId();
    if (chainId !== 1) fail("Launch Stamp RPC is not Ethereum mainnet");
    const latestNumber = options.latestBlock?.number ?? (await client.getBlockNumber());
    if (latestNumber < anchor.blockNumber + LAUNCH_STAMP_FINALITY_CONFIRMATIONS) {
      fail("Launch Stamp anchor does not have 64 confirmations");
    }
    const latestBlock = options.latestBlock ?? await canonicalBlock(client, latestNumber);
    if (latestBlock.number !== latestNumber) fail("Latest block proof mismatch");
    const stateBlock = options.stateBlock ?? await canonicalBlock(
      client,
      latestNumber - LAUNCH_STAMP_FINALITY_CONFIRMATIONS,
    );
    if (
      stateBlock.number > latestNumber - LAUNCH_STAMP_FINALITY_CONFIRMATIONS ||
      stateBlock.number < anchor.blockNumber
    ) {
      fail("Launch Stamp state block is outside the finalized scan boundary");
    }
    const receipt = options.receipt ?? await client.getTransactionReceipt({
      hash: anchor.transactionHash,
    });
    const parsed = parseLaunchStampReceipt(anchor, receipt);
    const launchBlock = await canonicalBlock(client, anchor.blockNumber);
    if (!sameHex(launchBlock.hash, anchor.blockHash)) {
      fail("Launch Stamp anchor block is no longer canonical");
    }
    await Promise.all([
      assertRuntimeCodeHash(
        client,
        LAUNCH_STAMP_ROUTER_ADDRESS,
        LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
        anchor.blockNumber,
        "Launch Stamp Router",
      ),
      assertRuntimeCodeHash(
        client,
        LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
        LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
        anchor.blockNumber,
        "PoolManager",
      ),
      assertRuntimeCodeHash(
        client,
        deployment.stateView,
        deployment.stateViewRuntimeCodeHash,
        stateBlock.number,
        "StateView",
      ),
    ]);
    const state = await readRouterState(client, anchor, parsed.poolKey);
    const record = validateRouterState(anchor, parsed, state);
    const kind = parsed.route.kind === 1 ? "custom-graph" : "classic";
    const components = await verifyComponents(client, anchor, parsed, kind);
    await assertRuntimeCodeHash(
      client,
      record.routeLauncher,
      record.routeLauncherRuntimeCodeHash,
      anchor.blockNumber,
      "Launch route launcher",
    );
    const tokenAndPool = await readTokenAndPoolState(
      client,
      deployment,
      anchor,
      stateBlock.number,
    );
    const provenance: LaunchStampProvenanceV1 = {
      schemaVersion: "programmable.launch-stamp-provenance.v1",
      chainId: 1,
      routerAddress: LAUNCH_STAMP_ROUTER_ADDRESS,
      routerRuntimeCodeHash: LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
      routerStartBlock: LAUNCH_STAMP_ROUTER_START_BLOCK.toString(),
      finalityConfirmations: Number(LAUNCH_STAMP_FINALITY_CONFIRMATIONS),
      kind,
      launchId: anchor.launchId,
      stampHash: anchor.stampHash,
      launchWallet: record.launchWallet,
      transactionHash: anchor.transactionHash,
      blockNumber: anchor.blockNumber.toString(),
      blockHash: anchor.blockHash,
      transactionIndex: anchor.transactionIndex,
      routeLogIndex: parsed.route.logIndex,
      launchLogIndex: anchor.logIndex,
      finalizedAtBlockNumber: latestBlock.number.toString(),
      finalizedAtBlockHash: latestBlock.hash,
      poolManagerAddress: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
      poolId: anchor.poolId,
      poolKey: parsed.poolKey,
      poolKeyHash: record.poolKeyHash,
      componentSetHash: record.componentSetHash,
      routePayloadHash: record.routePayloadHash,
      routeLauncherAddress: record.routeLauncher,
      routeLauncherRuntimeCodeHash: record.routeLauncherRuntimeCodeHash,
      expectedResultHash: record.expectedResultHash,
      permitDigest: record.permitDigest,
      components,
      tokenProof: {
        tokenAddress: anchor.token,
        launchId: anchor.launchId,
        stampHash: anchor.stampHash,
      },
      poolProof: {
        poolManagerAddress: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
        poolId: anchor.poolId,
        launchId: anchor.launchId,
        stampHash: anchor.stampHash,
      },
    };
    const token: LauncherToken = {
      id: `1:${anchor.token.toLowerCase()}`,
      name: tokenAndPool.name,
      symbol: tokenAndPool.symbol,
      ...(tokenAndPool.description ? { description: tokenAndPool.description } : {}),
      ...(tokenAndPool.imageUrl ? { imageUrl: tokenAndPool.imageUrl } : {}),
      ...(tokenAndPool.links ? { links: tokenAndPool.links } : {}),
      tokenAddress: anchor.token,
      hookAddress: anchor.hook,
      poolId: anchor.poolId,
      creatorAddress: record.launchWallet,
      launchBlockNumber: anchor.blockNumber.toString(),
      launchTransactionHash: anchor.transactionHash,
      launchTransactionIndex: anchor.transactionIndex,
      launchLogIndex: anchor.logIndex,
      launchedAt: new Date(Number(launchBlock.timestamp) * 1_000).toISOString(),
      ...(tokenAndPool.totalSupply ? { totalSupply: tokenAndPool.totalSupply } : {}),
      ...(tokenAndPool.totalSupplyRaw
        ? { totalSupplyRaw: tokenAndPool.totalSupplyRaw }
        : {}),
      ...(tokenAndPool.decimals === null
        ? {}
        : { tokenDecimals: tokenAndPool.decimals }),
      activeLiquidity: tokenAndPool.activeLiquidity,
      currentTick: tokenAndPool.currentTick,
      protocolFeePips: tokenAndPool.protocolFeePips,
      lpFeePips: tokenAndPool.lpFeePips,
      totalSwapFeeBps: null,
      launchModel: kind === "custom-graph" ? "custom-graph" : "classic",
      launchModelVersion: "programmable-launch-stamp-router-v1",
      liquidityPath: "programmable-v4",
      ...(tokenAndPool.metadataExtraData
        ? { metadataExtraData: tokenAndPool.metadataExtraData }
        : {}),
      launchStampProvenance: provenance,
    };
    return { token, launchStampProvenance: provenance };
  }

  function validateSliceCursor(cursor: LaunchStampRouterCursor) {
    if (!/^(?:0|[1-9]\d*)$/u.test(cursor.blockNumber)) {
      fail("Launch Stamp Router cursor block is invalid");
    }
    const number = BigInt(cursor.blockNumber);
    if (number < LAUNCH_STAMP_ROUTER_START_BLOCK - 1n) {
      fail("Launch Stamp Router cursor predates its canonical anchor");
    }
    if (
      number === LAUNCH_STAMP_ROUTER_START_BLOCK - 1n &&
      !sameHex(cursor.blockHash, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockHash)
    ) {
      fail("Launch Stamp Router initial cursor hash mismatch");
    }
    return number;
  }

  function createInitialLaunchStampRouterSlice(): LaunchStampRouterSlice {
    return {
      cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
      tokens: [],
    };
  }

  async function advanceLaunchStampRouterSlice(
    deployment: ReadyOnchainDeployment,
    slice: LaunchStampRouterSlice,
    options: LaunchStampReaderOptions = {},
  ): Promise<AdvanceLaunchStampRouterResult> {
    requireCanonicalDeployment(deployment);
    const client = options.client ?? createReaderClient(deployment);
    if ((await client.getChainId()) !== 1) {
      fail("Launch Stamp RPC is not Ethereum mainnet");
    }
    let workingSlice = slice;
    let cursorNumber = validateSliceCursor(workingSlice.cursor);
    let cursorBlock = await canonicalBlock(client, cursorNumber);
    let rebuiltAfterReorg = false;
    if (!sameHex(cursorBlock.hash, slice.cursor.blockHash)) {
      if (cursorNumber === LAUNCH_STAMP_ROUTER_START_BLOCK - 1n) {
        fail("Launch Stamp Router initial cursor is no longer canonical");
      }
      workingSlice = createInitialLaunchStampRouterSlice();
      cursorNumber = LAUNCH_STAMP_ROUTER_START_BLOCK - 1n;
      cursorBlock = await canonicalBlock(client, cursorNumber);
      if (!sameHex(cursorBlock.hash, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockHash)) {
        fail("Launch Stamp Router canonical rebuild anchor mismatch");
      }
      rebuiltAfterReorg = true;
    }
    const latestNumber = await client.getBlockNumber();
    if (latestNumber < LAUNCH_STAMP_FINALITY_CONFIRMATIONS) {
      fail("Ethereum head is below the Launch Stamp finality depth");
    }
    const latestBlock = await canonicalBlock(client, latestNumber);
    const highestSafeNumber = latestNumber - LAUNCH_STAMP_FINALITY_CONFIRMATIONS;
    if (highestSafeNumber < LAUNCH_STAMP_ROUTER_START_BLOCK - 1n) {
      fail("Ethereum head does not finalize the canonical Router deployment");
    }
    if (cursorNumber > highestSafeNumber) {
      fail("Launch Stamp Router cursor is ahead of the 64-confirmation boundary");
    }
    let targetNumber = cursorNumber + MAXIMUM_CATCH_UP_BLOCKS < highestSafeNumber
      ? cursorNumber + MAXIMUM_CATCH_UP_BLOCKS
      : highestSafeNumber;
    let targetBlock = await canonicalBlock(client, targetNumber);
    await Promise.all([
      assertRuntimeCodeHash(
        client,
        LAUNCH_STAMP_ROUTER_ADDRESS,
        LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
        targetNumber,
        "Launch Stamp Router",
      ),
      assertRuntimeCodeHash(
        client,
        LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
        LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
        targetNumber,
        "PoolManager",
      ),
    ]);
    const fromBlock = cursorNumber + 1n;
    if (fromBlock > targetNumber) {
      return {
        slice: workingSlice,
        scannedFromBlock: null,
        scannedToBlock: targetNumber.toString(),
        discovered: 0,
        hydrated: 0,
        boundedByDensity: false,
        rebuiltAfterReorg,
        highestSafeBlockNumber: highestSafeNumber.toString(),
        caughtUp: true,
      };
    }
    let anchors = await scanLaunchStampAnchors(client, {
      fromBlock,
      toBlock: targetNumber,
      latestBlock: latestNumber,
    });
    let boundedByDensity = false;
    if (anchors.length > MAXIMUM_ANCHORS_PER_ADVANCE) {
      const firstDeferredBlock = anchors[MAXIMUM_ANCHORS_PER_ADVANCE]?.blockNumber;
      if (firstDeferredBlock === undefined || firstDeferredBlock <= fromBlock) {
        fail("A single block exceeds the bounded Launch Stamp hydration limit");
      }
      targetNumber = firstDeferredBlock - 1n;
      targetBlock = await canonicalBlock(client, targetNumber);
      anchors = anchors.filter((anchor) => anchor.blockNumber <= targetNumber);
      if (anchors.length > MAXIMUM_ANCHORS_PER_ADVANCE) {
        fail("Launch Stamp density could not be reduced at a block boundary");
      }
      boundedByDensity = true;
    }
    const receiptHashes = [...new Set(
      anchors.map((anchor) => anchor.transactionHash.toLowerCase()),
    )] as Hex[];
    const receipts = new Map<string, TransactionReceipt>();
    await mapWithConcurrency(
      receiptHashes,
      COMPONENT_CONCURRENCY,
      async (hash) => {
        const receipt = await client.getTransactionReceipt({ hash });
        receipts.set(hash.toLowerCase(), receipt);
      },
    );
    const hydrated = await mapWithConcurrency(
      anchors,
      HYDRATION_CONCURRENCY,
      (anchor) => hydrateLaunchStampAnchor(deployment, anchor, {
        client,
        latestBlock,
        stateBlock: targetBlock,
        receipt: receipts.get(anchor.transactionHash.toLowerCase()),
      }),
    );
    const tokenAddresses = new Set<string>();
    const launchIds = new Set<string>();
    const poolIds = new Set<string>();
    const eventIds = new Set<string>();
    for (const token of workingSlice.tokens) {
      const provenance = token.launchStampProvenance;
      if (!provenance) fail("Launch Stamp Router slice contains an unstamped token");
      const tokenKey = token.tokenAddress.toLowerCase();
      const launchKey = provenance.launchId.toLowerCase();
      const poolKey = `${provenance.poolManagerAddress.toLowerCase()}:${provenance.poolId.toLowerCase()}`;
      const eventKey = `${provenance.transactionHash.toLowerCase()}:${provenance.launchLogIndex}`;
      if (
        tokenAddresses.has(tokenKey) ||
        launchIds.has(launchKey) ||
        poolIds.has(poolKey) ||
        eventIds.has(eventKey)
      ) {
        fail("Launch Stamp Router slice contains duplicate provenance");
      }
      tokenAddresses.add(tokenKey);
      launchIds.add(launchKey);
      poolIds.add(poolKey);
      eventIds.add(eventKey);
    }
    const newTokens: LauncherToken[] = [];
    for (const result of hydrated) {
      const tokenKey = result.token.tokenAddress.toLowerCase();
      const launchKey = result.launchStampProvenance.launchId.toLowerCase();
      const poolKey = `${result.launchStampProvenance.poolManagerAddress.toLowerCase()}:${result.launchStampProvenance.poolId.toLowerCase()}`;
      const eventKey = `${result.launchStampProvenance.transactionHash.toLowerCase()}:${result.launchStampProvenance.launchLogIndex}`;
      if (
        tokenAddresses.has(tokenKey) ||
        launchIds.has(launchKey) ||
        poolIds.has(poolKey) ||
        eventIds.has(eventKey)
      ) {
        fail("Launch Stamp Router advancement conflicts with persisted provenance");
      }
      tokenAddresses.add(tokenKey);
      launchIds.add(launchKey);
      poolIds.add(poolKey);
      eventIds.add(eventKey);
      newTokens.push(result.token);
    }
    return {
      slice: {
        cursor: {
          blockNumber: targetNumber.toString(),
          blockHash: targetBlock.hash,
        },
        tokens: [...workingSlice.tokens, ...newTokens],
      },
      scannedFromBlock: fromBlock.toString(),
      scannedToBlock: targetNumber.toString(),
      discovered: anchors.length,
      hydrated: hydrated.length,
      boundedByDensity,
      rebuiltAfterReorg,
      highestSafeBlockNumber: highestSafeNumber.toString(),
      caughtUp: targetNumber === highestSafeNumber,
    };
  }
  // Parsing an observation does not establish finality. Only the scanner and
  // hydrator above may produce canonical launch identities.
  return Object.freeze({ anchorFromLog, scanLaunchStampAnchors, parseLaunchStampReceipt, hydrateLaunchStampAnchor, createInitialLaunchStampRouterSlice, advanceLaunchStampRouterSlice });
}

export const { scanLaunchStampAnchors, parseLaunchStampReceipt, hydrateLaunchStampAnchor, createInitialLaunchStampRouterSlice, advanceLaunchStampRouterSlice } = createLaunchStampReaderV1({
  routerAddress: LAUNCH_STAMP_ROUTER_ADDRESS,
  routerRuntimeCodeHash: LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
  routerStartBlock: LAUNCH_STAMP_ROUTER_START_BLOCK,
  initialCursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
});
