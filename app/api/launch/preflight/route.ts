import { legacyLaunchGuardV1 } from "@/lib/launch-protection/legacy-gate.server";
import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import deploymentInputs from "@/contracts/config/deployment-inputs.v1.json";
import mainnetDeployments from "@/contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "@/contracts/dependencies/ethereum-sepolia.json";
import { isClassicDeploymentReady } from "@/lib/launch-deployment";
import {
  classicCtoAuthorityAbi,
  classicInitialBuyVestingWalletFactoryAbi,
  classicLaunchPolicyAbi,
  classicRewardVaultFactoryAbi,
  classicV3HookAbi,
  classicV3HookFactoryAbi,
  classicV3LaunchAbi,
  encodeClassicV3Launch,
  validateClassicV3LaunchDraft,
} from "@/lib/classic-v3";
import {
  classicV4HookAbi,
  classicV4HookFactoryAbi,
  classicV4LaunchAbi,
  classicV4PositionPlannerAbi,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
  encodeClassicV4Launch,
  validateClassicV4LaunchDraft,
} from "@/lib/classic-v4";
import {
  getConfiguredClassicV4PublicRelease,
  isClassicV4PublicActionRelease,
  type ClassicV4PublicRelease,
} from "@/lib/classic-v4-release";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "@/lib/classic-v3-release";
import {
  deepV3LaunchAbi,
  encodeDeepV3Launch,
  validateDeepV3LaunchDraft,
} from "@/lib/deep-v3";
import { quoteDeepV3InitialBuy } from "@/lib/deep-v3-quote";
import {
  getConfiguredDeepV3Release,
  isConfiguredDeepV3ReleaseReady,
  type DeepV3ReleaseManifest,
} from "@/lib/deep-v3-release";
import {
  assertDeepV3RuntimeBinding,
  requireIndependentDeepV3RpcUrls,
  type DeepV3RuntimeBindingClient,
  type DeepV3RuntimeRelease,
} from "@/lib/deep-v3-runtime-binding";
import {
  buildPlanHash,
  adaptiveCurveHookFactoryAbi,
  adaptiveCurveLaunchAbi,
  encodeAdaptiveLaunch,
  encodeMemeLaunch,
  ethCreatorFeeHookAbi,
  ethCreatorFeeHookFactoryAbi,
  LaunchInputError,
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_SYMBOL_BYTES,
  lockedPositionFeeForwarderFactoryAbi,
  memeLaunchAbi,
  type LaunchPreflightCheck,
  type LaunchPreflightResponse,
  type PreparedLaunchTransaction,
  validateMemeLaunchDraft,
  validateAdaptiveLaunchDraft,
} from "@/lib/launch-transaction";
import {
  createEmptyDraft,
  CLASSIC_LIQUIDITY_TICK_LOWER,
  MEME_INITIAL_TICK,
  MEME_MIN_INITIAL_BUY_WEI,
  MEME_TOKEN_SUPPLY_WEI,
  parseOptionalInitialBuyWei,
  parseInitialBuyWei,
  type LaunchDraft,
} from "@/lib/launch";
import {
  deriveStockPairedCurrency0Salt,
  encodeStockPairedEthLaunch,
  getStockPairedEthQuoteAssetsForRelease,
  getStockPairedQuoteAssetsForRelease,
  isStockPairedLaunchedTokenCurrency0,
  stockPairedEthLaunchCoordinatorAbi,
  stockPairedHookAbi,
  stockPairedHookFactoryAbi,
  stockPairedLaunchAbi,
  stockQuoteRegistryAbi,
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS,
  STOCK_PAIRED_MIN_INITIAL_BUY,
  STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
  stockPairedRegistryContainsReleaseAssets,
  validateStockPairedLaunchDraft,
} from "@/lib/stock-paired";
import {
  encodeStockPairedV3Path,
  getStockPairedEthRoute,
  STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS,
  STOCK_PAIRED_V3_QUOTER,
  stockPairedV3QuoterAbi,
} from "@/lib/trade/stock-paired-route";
import {
  getConfiguredStockPairedLaunchRelease,
  type VerifiedStockPairedRelease,
} from "@/lib/stock-paired-release";
import {
  assessStockPairedRuntimeFdv,
  STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI,
} from "@/lib/stock-paired-runtime-fdv";
import {
  resolveImplementedLaunchModel,
  resolveReservedLaunchModel,
  type DeepLaunchModelRelease,
} from "@/lib/launch-model-gating";
import { getWebsiteReadOnchainDeployment } from "@/lib/onchain/config";
import { safeServerErrorSummary } from "@/lib/server/safe-error";
import {
  CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
  ClassicLaunchAuthorizationBridgeErrorV1,
  getProductionClassicLaunchAuthorizationBridgeV1,
} from "@/lib/server/custom-launch/classic-launch-authorization-bridge-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 50_000;
const REQUIRED_FEE_HOOK_FLAGS = 8_396n;
const HOOK_FLAG_MASK = (1n << 14n) - 1n;
const STOCK_PAIRED_CURRENCY0_SEARCH_BATCH_SIZE = 64;
const LAUNCH_RPC_MULTICALL_BATCH_BYTES = 16_384;
const LAUNCH_RPC_BATCH_WAIT_MS = 4;

const launchEnvironment =
  process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const launchChain = launchEnvironment === "rehearsal" ? sepolia : mainnet;
const networkName = launchEnvironment === "rehearsal" ? "Sepolia" : "Ethereum";
const selectedDeployments =
  launchEnvironment === "rehearsal" ? sepoliaDeployments : mainnetDeployments;
const selectedManifest = appDeployments[launchEnvironment] as ReleaseDeployment;
const selectedClassicV3Release =
  getConfiguredClassicV3Release(launchEnvironment).releaseManifest;
const selectedDeepV3Release = getConfiguredDeepV3Release(launchEnvironment);
const selectedStockPairedRelease =
  launchEnvironment === "production"
    ? getConfiguredStockPairedLaunchRelease()
    : null;

function createLaunchRpcClient(rpcUrl: string) {
  return createPublicClient({
    chain: launchChain,
    batch: {
      multicall: {
        batchSize: LAUNCH_RPC_MULTICALL_BATCH_BYTES,
        wait: LAUNCH_RPC_BATCH_WAIT_MS,
      },
    },
    transport: http(rpcUrl, {
      retryCount: 1,
      timeout: 12_000,
    }),
  });
}

type LaunchRpcClient = ReturnType<typeof createLaunchRpcClient>;

function defaultLaunchRpcClient() {
  if (launchEnvironment === "rehearsal") {
    return createLaunchRpcClient(
      process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org",
    );
  }
  const deployment = getWebsiteReadOnchainDeployment("production");
  return createLaunchRpcClient(deployment.rpcUrl);
}

const client = new Proxy({} as LaunchRpcClient, {
  get(_target, property) {
    const selected = defaultLaunchRpcClient();
    const value = Reflect.get(selected, property);
    return typeof value === "function" ? value.bind(selected) : value;
  },
});

async function withClassicLaunchRpcFailover<Output>(
  read: (rpcClient: LaunchRpcClient) => Promise<Output>,
) {
  const { withOperationalRpcFailover } = await import(
    "@/lib/onchain/operational-rpc-failover.server"
  );
  const deployment = getWebsiteReadOnchainDeployment(launchEnvironment);
  return withOperationalRpcFailover(deployment, (selected) =>
    read(createLaunchRpcClient(selected.rpcUrl)),
  );
}

function createDeepV3RuntimeBindingClients(): readonly [
  DeepV3RuntimeBindingClient,
  DeepV3RuntimeBindingClient,
] {
  const [primary, secondary] = requireIndependentDeepV3RpcUrls(
    launchEnvironment === "rehearsal"
      ? process.env.SEPOLIA_RPC_URL
      : process.env.ETHEREUM_RPC_URL,
    launchEnvironment === "rehearsal"
      ? process.env.SEPOLIA_RPC_URL_B
      : process.env.ETHEREUM_RPC_URL_B,
  );
  return [primary, secondary].map((endpoint) => {
    const runtimeClient = createPublicClient({
      chain: launchChain,
      transport: http(endpoint, {
        retryCount: 1,
        timeout: 12_000,
      }),
    });
    return {
      getChainId: () => runtimeClient.getChainId(),
      async getFinalizedBlock() {
        const block = await runtimeClient.getBlock({
          blockTag: "finalized",
        });
        return { number: block.number, hash: block.hash };
      },
      async getBlock({ blockNumber }: { blockNumber: bigint }) {
        const block = await runtimeClient.getBlock({ blockNumber });
        return { number: block.number, hash: block.hash };
      },
      getCode: ({
        address,
        blockNumber,
      }: {
        address: Address;
        blockNumber: bigint;
      }) => runtimeClient.getCode({ address, blockNumber }),
      readContract: (input) =>
        runtimeClient.readContract(input as never) as Promise<unknown>,
    } satisfies DeepV3RuntimeBindingClient;
  }) as [DeepV3RuntimeBindingClient, DeepV3RuntimeBindingClient];
}

function deepV3RuntimeRelease(
  release: DeepV3ReleaseManifest,
): DeepV3RuntimeRelease {
  const addresses = release.addresses as Record<string, unknown>;
  const hashes = release.runtimeCodeHashes as Record<string, unknown>;
  const dependencies = release.officialDependencies as Record<
    string,
    Record<string, unknown>
  >;
  const address = (value: unknown) => getAddress(String(value));
  const hash = (value: unknown) => value as Hex;
  const dependency = (
    key: "poolManager" | "positionManager" | "uerc20Factory",
  ) => ({
    address: address(dependencies[key]?.address),
    runtimeCodeHash: hash(dependencies[key]?.runtimeCodeHash),
  });

  return {
    chainId: 1,
    startBlock: release.startBlock as number,
    addresses: {
      treasury: address(addresses.treasury),
      lockedPositionFactory: address(addresses.lockedPositionFactory),
      zapPlanner: address(addresses.zapPlanner),
      growthVaultFactory: address(addresses.growthVaultFactory),
      growthVaultImplementation: address(addresses.growthVaultImplementation),
      hookFactory: address(addresses.hookFactory),
      feeHook: address(addresses.feeHook),
      launcher: address(addresses.launcher),
      positionPlanner: address(addresses.positionPlanner),
      automation: address(addresses.automation),
      keeperExecutor: address(addresses.keeperExecutor),
    },
    runtimeCodeHashes: {
      lockedPositionFactory: hash(hashes.lockedPositionFactory),
      zapPlanner: hash(hashes.zapPlanner),
      growthVaultFactory: hash(hashes.growthVaultFactory),
      growthVaultImplementation: hash(hashes.growthVaultImplementation),
      hookFactory: hash(hashes.hookFactory),
      feeHook: hash(hashes.feeHook),
      launcher: hash(hashes.launcher),
      positionPlanner: hash(hashes.positionPlanner),
      automation: hash(hashes.automation),
      keeperExecutor: hash(hashes.keeperExecutor),
    },
    officialDependencies: {
      poolManager: dependency("poolManager"),
      positionManager: dependency("positionManager"),
      uerc20Factory: dependency("uerc20Factory"),
    },
  };
}

const officialPoolManager = getAddress(
  selectedDeployments.contracts.poolManager.address,
);
const officialPositionManager = getAddress(
  selectedDeployments.contracts.positionManager.address,
);
const officialTokenFactory = getAddress(
  selectedDeployments.contracts.uerc20Factory.address,
);
const platformTreasury = getAddress(deploymentInputs.platform.treasury);
const classicCtoAuthorityAccount = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
);

type ReleaseDeployment = {
  chainId: number;
  status: "not-deployed" | "ready" | "requires-redeploy";
  memeLaunchStatus:
    "not-deployed" | "ready" | "requires-redeploy" | "lifecycle-pending";
  adaptiveLaunchStatus: "not-deployed" | "ready" | "requires-redeploy";
  classicV3Status?: "not-deployed" | "ready" | "requires-redeploy";
  classicCtoAuthorityV1?: string | null;
  classicRewardVaultFactoryV1?: string | null;
  classicInitialBuyVestingWalletFactoryV1?: string | null;
  classicLaunchPolicyV1?: string | null;
  ethCreatorFeeHookFactory: string | null;
  ethCreatorFeeHook: string | null;
  memeLaunch: string | null;
  adaptiveCurveFeeHookFactory: string | null;
  adaptiveCurveLaunch: string | null;
  ethCreatorFeeHookFactoryV3?: string | null;
  ethCreatorFeeHookV3?: string | null;
  memeLaunchV2?: string | null;
  lockedPositionFeeForwarderFactory: string | null;
  runtimeCodeHashes: {
    ethCreatorFeeHookFactory: string | null;
    ethCreatorFeeHook: string | null;
    memeLaunch: string | null;
    adaptiveCurveFeeHookFactory: string | null;
    adaptiveCurveLaunch: string | null;
    classicCtoAuthorityV1?: string | null;
    classicRewardVaultFactoryV1?: string | null;
    classicInitialBuyVestingWalletFactoryV1?: string | null;
    classicLaunchPolicyV1?: string | null;
    ethCreatorFeeHookFactoryV3?: string | null;
    ethCreatorFeeHookV3?: string | null;
    memeLaunchV2?: string | null;
    lockedPositionFeeForwarderFactory: string | null;
  };
  deploymentBlocks?: {
    memeLaunchV2?: number | null;
  };
  launchModelReleases?: {
    deep?: DeepLaunchModelRelease;
  };
};

function response(body: LaunchPreflightResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function deepLaunchClosedResponse() {
  return NextResponse.json(
    {
      code: "deep_launches_closed",
      error: "New Deep launches are not available",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function requestsClosedDeepLaunch(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const model = (input as Record<string, unknown>).launchModel;
  if (typeof model !== "string") return false;
  const normalized = model.trim().toLowerCase();
  return (
    normalized === "deep" ||
    normalized.startsWith("deep-") ||
    normalized === "liquidity-growth" ||
    normalized.startsWith("liquidity-growth-")
  );
}

function parseDraft(input: unknown): LaunchDraft {
  if (!input || typeof input !== "object") {
    throw new LaunchInputError("The launch setup is missing");
  }

  const raw = input as Record<string, unknown>;
  const draft = createEmptyDraft();
  const stringFields = [
    "tokenName",
    "tokenSymbol",
    "tokenDescription",
    "tokenWebsite",
    "tokenImage",
    "tokenX",
    "tokenTelegram",
    "totalSwapFeePercent",
    "initialBuyEth",
    "stockQuoteAsset",
    "initialBuyQuoteAmount",
    "launchSalt",
    "hookSaltNonce",
    "buySwapFeePercent",
    "sellSwapFeePercent",
    "rewardExternalAddress",
    "initialBuyDurationDays",
    "initialBuyCliffDays",
    "updatedAt",
  ] as const;

  for (const field of stringFields) {
    if (typeof raw[field] === "string") {
      draft[field] = raw[field];
    }
  }
  if (
    raw.classicContractRelease === "classic-v3" ||
    raw.classicContractRelease === "classic-v4"
  ) {
    draft.classicContractRelease = raw.classicContractRelease;
  } else if (raw.classicContractRelease !== undefined) {
    throw new LaunchInputError("Refresh the Classic launch setup");
  }

  const requestedLaunchModel =
    raw.launchModel === undefined ? "classic" : raw.launchModel;
  const implementedLaunchModel =
    resolveImplementedLaunchModel(requestedLaunchModel);
  if (!implementedLaunchModel) {
    const reservedLaunchModel =
      resolveReservedLaunchModel(requestedLaunchModel);
    if (reservedLaunchModel) {
      if (!isConfiguredDeepV3ReleaseReady(launchEnvironment)) {
        throw new LaunchInputError(
          "Deep is not enabled by a verified release manifest",
        );
      }
      throw new LaunchInputError(
        "Deep is not implemented in this application release",
      );
    }
    throw new LaunchInputError("Choose an available launch model");
  }
  if (
    implementedLaunchModel === "deep" &&
    !isConfiguredDeepV3ReleaseReady(launchEnvironment)
  ) {
    throw new LaunchInputError(
      "Deep is not enabled by a verified release manifest",
    );
  }
  draft.launchModel = implementedLaunchModel;
  if (
    raw.rewardDestinationMode === "launcher" ||
    raw.rewardDestinationMode === "external" ||
    raw.rewardDestinationMode === "split"
  ) {
    draft.rewardDestinationMode = raw.rewardDestinationMode;
  }
  if (
    raw.initialBuyCustodyMode === "unlocked" ||
    raw.initialBuyCustodyMode === "fixed-lock" ||
    raw.initialBuyCustodyMode === "linear" ||
    raw.initialBuyCustodyMode === "cliff-linear"
  ) {
    draft.initialBuyCustodyMode = raw.initialBuyCustodyMode;
  }
  if (Array.isArray(raw.rewardSplits)) {
    draft.rewardSplits = raw.rewardSplits.slice(0, 5).map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new LaunchInputError("The reward split is invalid");
      }
      const row = value as Record<string, unknown>;
      if (
        typeof row.beneficiary !== "string" ||
        typeof row.sharePercent !== "string"
      ) {
        throw new LaunchInputError("The reward split is invalid");
      }
      return {
        beneficiary: row.beneficiary,
        sharePercent: row.sharePercent,
      };
    });
  }
  if (Array.isArray(raw.adaptiveCurvePoints)) {
    draft.adaptiveCurvePoints = raw.adaptiveCurvePoints
      .slice(0, 8)
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new LaunchInputError("The Adaptive curve is invalid");
        }
        const point = value as Record<string, unknown>;
        if (
          typeof point.fdvIndex !== "number" ||
          !Number.isSafeInteger(point.fdvIndex) ||
          typeof point.totalSwapFeeBps !== "number" ||
          !Number.isSafeInteger(point.totalSwapFeeBps)
        ) {
          throw new LaunchInputError("The Adaptive curve is invalid");
        }
        return {
          fdvIndex: point.fdvIndex,
          totalSwapFeeBps: point.totalSwapFeeBps,
        };
      });
  }

  // The API intentionally ignores obsolete client-supplied product switches.
  draft.assetMode = "new";
  draft.tokenSupply = "1000000000";
  draft.liquidityMode = "meme";
  draft.selectedBehaviors = ["fixed-fee"];
  draft.lpFeePercent = "0";
  return draft;
}

function walletCheck(
  account: Address,
  walletChainId: unknown,
): LaunchPreflightCheck {
  const decimalChainId = launchChain.id;
  const hexadecimalChainId = `0x${decimalChainId.toString(16)}`;
  const onSelectedNetwork =
    walletChainId === hexadecimalChainId ||
    walletChainId === String(decimalChainId) ||
    walletChainId === `eip155:${decimalChainId}` ||
    walletChainId === decimalChainId;
  return {
    id: "wallet",
    label: "Wallet",
    status: onSelectedNetwork ? "pass" : "blocked",
    detail: onSelectedNetwork
      ? `${account.slice(0, 6)}…${account.slice(-4)} on ${networkName}`
      : `Switch the connected wallet to ${networkName}`,
  };
}

function validateLaunchSalt(value: string): asserts value is Hex {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new LaunchInputError(
      "Create a fresh launch identifier before checking the transaction",
    );
  }
}

async function assertRuntimeCodeHash(
  address: Address,
  expected: Hex,
  label: string,
  rpcClient: LaunchRpcClient = defaultLaunchRpcClient(),
) {
  const code = await rpcClient.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`${label} has no runtime bytecode`);
  }
  const actual = keccak256(code);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${label} runtime bytecode does not match the release manifest`,
    );
  }
}

async function estimatePreparedTransaction(
  account: Address,
  transaction: Omit<PreparedLaunchTransaction, "gasLimit">,
  rpcClient: LaunchRpcClient = defaultLaunchRpcClient(),
) {
  const value = BigInt(transaction.value);
  const balance = await rpcClient.getBalance({ address: account });
  if (balance <= value) {
    throw new LaunchInputError(
      "The wallet does not have enough ETH for this transaction and network fees",
    );
  }

  await rpcClient.call({
    account,
    to: transaction.to,
    data: transaction.data,
    value,
  });
  const [estimatedGas, gasPrice] = await Promise.all([
    rpcClient.estimateGas({
      account,
      to: transaction.to,
      data: transaction.data,
      value,
    }),
    rpcClient.getGasPrice(),
  ]);
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;

  if (balance < value + gasLimit * gasPrice) {
    throw new LaunchInputError(
      "The wallet does not have enough ETH for this transaction and the current network fee",
    );
  }
  return gasLimit;
}

async function assertMemeReleaseInfrastructure(
  launcher: Address,
  feeHook: Address,
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    ethCreatorFeeHookFactory: Hex;
    ethCreatorFeeHook: Hex;
    memeLaunch: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
  rpcClient: LaunchRpcClient = defaultLaunchRpcClient(),
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.ethCreatorFeeHookFactory,
      "ETH creator fee hook factory",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      feeHook,
      codeHashes.ethCreatorFeeHook,
      "ETH creator fee hook",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
      rpcClient,
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.memeLaunch,
      "Classic",
      rpcClient,
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredFeeHook,
    configuredForwarderFactory,
    forwarderPositionManager,
    hookPoolManager,
    hookTreasury,
    launcherFeeBps,
    lpFeePips,
    tickSpacing,
    minimumInitialBuyWei,
    factoryRecognizesHook,
  ] = await Promise.all([
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "poolManager",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "positionManager",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "tokenFactory",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "feeHook",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    rpcClient.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
    rpcClient.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "poolManager",
    }),
    rpcClient.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "launcherFeeRecipient",
    }),
    rpcClient.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    rpcClient.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    rpcClient.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "TICK_SPACING",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    rpcClient.readContract({
      address: hookFactory,
      abi: ethCreatorFeeHookFactoryAbi,
      functionName: "isFactoryHook",
      args: [feeHook],
    }),
  ]);

  const expected = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredFeeHook, feeHook, "fee hook"],
    [configuredForwarderFactory, positionForwarderFactory, "position factory"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
    [hookPoolManager, officialPoolManager, "hook PoolManager"],
    [hookTreasury, platformTreasury, "treasury"],
  ] as const;

  for (const [actual, wanted, label] of expected) {
    if (actual.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(
        `The Classic ${label} does not match the release manifest`,
      );
    }
  }

  if (!factoryRecognizesHook) {
    throw new Error("The fee hook was not deployed by the release factory");
  }
  if (
    launcherFeeBps !== 10 ||
    lpFeePips !== 0 ||
    tickSpacing !== 200 ||
    minimumInitialBuyWei !== MEME_MIN_INITIAL_BUY_WEI
  ) {
    throw new Error("The fee hook economics do not match the release manifest");
  }
  if ((BigInt(feeHook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new Error(
      "The fee hook callback mask does not match the release manifest",
    );
  }
}

async function prepareMemeLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
  rpcClient: LaunchRpcClient = defaultLaunchRpcClient(),
) {
  const totalSwapFeeBps = validateMemeLaunchDraft(draft);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Initial Buy");
  }
  validateLaunchSalt(draft.launchSalt);

  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `Fixed supply, locked one-sided liquidity and ${(
      totalSwapFeeBps / 100
    ).toFixed(2)}% fixed total swap fee are valid`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "meme",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Programmable contracts",
          status: "pending",
          detail: "Verification continues after the network is corrected",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Waiting for the wallet network",
        },
      ],
    });
  }

  const {
    ethCreatorFeeHookFactory,
    ethCreatorFeeHook,
    memeLaunch,
    lockedPositionFeeForwarderFactory,
    runtimeCodeHashes,
  } = deployment;
  if (
    !isClassicDeploymentReady(deployment, launchChain.id) ||
    !ethCreatorFeeHookFactory ||
    !ethCreatorFeeHook ||
    !memeLaunch ||
    !lockedPositionFeeForwarderFactory ||
    !runtimeCodeHashes.ethCreatorFeeHookFactory ||
    !runtimeCodeHashes.ethCreatorFeeHook ||
    !runtimeCodeHashes.memeLaunch ||
    !runtimeCodeHashes.lockedPositionFeeForwarderFactory
  ) {
    return response({
      status: "blocked",
      mode: "meme",
      title: `Classic is not deployed on ${networkName} yet`,
      detail: `Wallet transactions stay disabled until the exact ${networkName} release is deployed and verified`,
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Programmable contracts",
          status: "blocked",
          detail: `No approved ${networkName} deployment is recorded in the release manifest`,
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Runs only against the recorded release deployment",
        },
      ],
    });
  }

  const launcher = getAddress(memeLaunch);
  const hook = getAddress(ethCreatorFeeHook);
  const hookFactory = getAddress(ethCreatorFeeHookFactory);
  const positionForwarderFactory = getAddress(
    lockedPositionFeeForwarderFactory,
  );
  await assertMemeReleaseInfrastructure(
    launcher,
    hook,
    hookFactory,
    positionForwarderFactory,
    {
      ethCreatorFeeHookFactory:
        runtimeCodeHashes.ethCreatorFeeHookFactory as Hex,
      ethCreatorFeeHook: runtimeCodeHashes.ethCreatorFeeHook as Hex,
      memeLaunch: runtimeCodeHashes.memeLaunch as Hex,
      lockedPositionFeeForwarderFactory:
        runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
    rpcClient,
  );

  const [predictedToken] = await rpcClient.readContract({
    address: launcher,
    abi: memeLaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingCode = await rpcClient.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeMemeLaunch(draft, draft.launchSalt),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(
    account,
    launchBase,
    rpcClient,
  );
  return response({
    status: "ready",
    mode: "meme",
    title: "Ready for wallet review",
    detail: `The exact launch and selected Dev Buy succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Programmable contracts",
        status: "pass",
        detail:
          "Runtime bytecode, immutable dependencies, fee split and permanent LP custody match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail:
          "The atomic token, locked-liquidity and Dev Buy transaction succeeds",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: hook,
    planHash: buildPlanHash(account, launchBase),
  });
}

async function assertClassicV3Infrastructure(
  launcher: Address,
  hook: Address,
  hookFactory: Address,
  vaultFactory: Address,
  ctoAuthority: Address,
  initialBuyVestingWalletFactory: Address,
  launchPolicy: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    classicCtoAuthorityV1: Hex;
    classicRewardVaultFactoryV1: Hex;
    classicInitialBuyVestingWalletFactoryV1: Hex;
    classicLaunchPolicyV1: Hex;
    ethCreatorFeeHookFactoryV3: Hex;
    ethCreatorFeeHookV3: Hex;
    memeLaunchV2: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
  rpcClient: LaunchRpcClient,
) {
  const client = rpcClient;
  const runtimeCodeBindings = [
    [
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ],
    [
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ],
    [
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ],
    [
      hookFactory,
      codeHashes.ethCreatorFeeHookFactoryV3,
      "Classic hook factory",
    ],
    [
      hook,
      codeHashes.ethCreatorFeeHookV3,
      "Classic hook",
    ],
    [
      vaultFactory,
      codeHashes.classicRewardVaultFactoryV1,
      "Classic reward factory",
    ],
    [
      ctoAuthority,
      codeHashes.classicCtoAuthorityV1,
      "Classic CTO authority",
    ],
    [
      initialBuyVestingWalletFactory,
      codeHashes.classicInitialBuyVestingWalletFactoryV1,
      "Classic Initial Buy custody factory",
    ],
    [
      launchPolicy,
      codeHashes.classicLaunchPolicyV1,
      "Classic launch policy",
    ],
    [
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ],
    [
      launcher,
      codeHashes.memeLaunchV2,
      "Classic launcher",
    ],
  ] as const;
  for (const [address, expected, label] of runtimeCodeBindings) {
    await assertRuntimeCodeHash(
      address,
      expected,
      label,
      rpcClient,
    );
  }

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredHook,
    configuredVaultFactory,
    configuredForwarderFactory,
    hookPoolManager,
    hookTreasury,
    hookVaultFactory,
    launcherFeeBps,
    minimumFeeBps,
    maximumFeeBps,
    feeStepBps,
    transferTaxBps,
    lpFeePips,
    tickSpacing,
    minimumInitialBuyWei,
    factoryRecognizesHook,
    forwarderPositionManager,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "feeHook",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "rewardVaultFactory",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "feeSplitVaultFactory",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "MIN_TOTAL_SWAP_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "MAX_TOTAL_SWAP_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TOTAL_SWAP_FEE_STEP_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TRANSFER_TAX_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TICK_SPACING",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    client.readContract({
      address: hookFactory,
      abi: classicV3HookFactoryAbi,
      functionName: "isFactoryHook",
      args: [hook],
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
  ]);
  const [
    configuredInitialBuyVestingWalletFactory,
    configuredLaunchPolicy,
    configuredCtoAuthority,
    configuredCtoAuthorityAccount,
    minimumCustodyDurationDays,
    maximumCustodyDurationDays,
    maximumTokenNameBytes,
    maximumTokenSymbolBytes,
    maximumTokenDescriptionBytes,
    maximumMetadataUrlBytes,
    maximumSocialExtraDataBytes,
    maximumPolicyRewardBeneficiaries,
    policyRewardShareBasisPoints,
    maximumLauncherRewardBeneficiaries,
    launcherRewardShareBasisPoints,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "initialBuyVestingWalletFactory",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "launchPolicy",
    }),
    client.readContract({
      address: vaultFactory,
      abi: classicRewardVaultFactoryAbi,
      functionName: "ctoAuthority",
    }),
    client.readContract({
      address: ctoAuthority,
      abi: classicCtoAuthorityAbi,
      functionName: "authority",
    }),
    client.readContract({
      address: initialBuyVestingWalletFactory,
      abi: classicInitialBuyVestingWalletFactoryAbi,
      functionName: "MIN_DURATION_DAYS",
    }),
    client.readContract({
      address: initialBuyVestingWalletFactory,
      abi: classicInitialBuyVestingWalletFactoryAbi,
      functionName: "MAX_DURATION_DAYS",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_NAME_BYTES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_SYMBOL_BYTES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_DESCRIPTION_BYTES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_METADATA_URL_BYTES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_SOCIAL_EXTRA_DATA_BYTES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_REWARD_BENEFICIARIES",
    }),
    client.readContract({
      address: launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "REWARD_SHARE_BASIS_POINTS",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "MAX_REWARD_BENEFICIARIES",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "REWARD_SHARE_BASIS_POINTS",
    }),
  ]);

  const expectedAddresses = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredHook, hook, "fee hook"],
    [configuredVaultFactory, vaultFactory, "reward factory"],
    [
      configuredInitialBuyVestingWalletFactory,
      initialBuyVestingWalletFactory,
      "Initial Buy custody factory",
    ],
    [configuredLaunchPolicy, launchPolicy, "launch policy"],
    [configuredCtoAuthority, ctoAuthority, "CTO authority"],
    [
      configuredCtoAuthorityAccount,
      classicCtoAuthorityAccount,
      "CTO authority account",
    ],
    [configuredForwarderFactory, positionForwarderFactory, "position factory"],
    [hookPoolManager, officialPoolManager, "hook PoolManager"],
    [hookTreasury, platformTreasury, "treasury"],
    [hookVaultFactory, vaultFactory, "hook reward factory"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
  ] as const;
  for (const [actual, expected, label] of expectedAddresses) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `The Classic ${label} does not match the release manifest`,
      );
    }
  }
  if (
    !factoryRecognizesHook ||
    launcherFeeBps !== 10 ||
    minimumFeeBps !== 100 ||
    maximumFeeBps !== 1_000 ||
    feeStepBps !== 100 ||
    transferTaxBps !== 0 ||
    lpFeePips !== 0 ||
    tickSpacing !== 200 ||
    minimumInitialBuyWei !== MEME_MIN_INITIAL_BUY_WEI ||
    minimumCustodyDurationDays !== 1 ||
    maximumCustodyDurationDays !== 3_650 ||
    maximumTokenNameBytes !== BigInt(MAX_TOKEN_NAME_BYTES) ||
    maximumTokenSymbolBytes !== BigInt(MAX_TOKEN_SYMBOL_BYTES) ||
    maximumTokenDescriptionBytes !== BigInt(MAX_TOKEN_DESCRIPTION_BYTES) ||
    maximumMetadataUrlBytes !== BigInt(MAX_METADATA_URL_BYTES) ||
    maximumSocialExtraDataBytes !== BigInt(MAX_SOCIAL_EXTRA_DATA_BYTES) ||
    maximumPolicyRewardBeneficiaries !== 5n ||
    policyRewardShareBasisPoints !== 10_000 ||
    maximumLauncherRewardBeneficiaries !== 5n ||
    launcherRewardShareBasisPoints !== 10_000 ||
    (BigInt(hook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS
  ) {
    throw new Error("The Classic economics do not match the release manifest");
  }
}

async function prepareClassicV3Launch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
  rpcClient: LaunchRpcClient,
) {
  const client = rpcClient;
  const configuration = validateClassicV3LaunchDraft(draft, account);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Dev Buy");
  }
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `Immutable ${(configuration.fees.buySwapFeeBps / 100).toFixed(2)}% buy and ${(configuration.fees.sellSwapFeeBps / 100).toFixed(2)}% sell fees with ${configuration.rewards.beneficiaries.length} reward recipient${configuration.rewards.beneficiaries.length === 1 ? "" : "s"} and ${configuration.initialBuyCustody.mode === "unlocked" ? "an unlocked Initial Buy" : "Initial Buy custody"}`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }
  if (
    !isClassicV3ReleaseVerified(
      deployment,
      selectedClassicV3Release,
      launchChain.id,
    )
  ) {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Classic is not deployed on ${networkName} yet`,
      detail:
        "The setup is available for review. Wallet transactions stay disabled until the deployment, source verification and lifecycle evidence are approved",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Classic contracts",
          status: "blocked",
          detail: `No approved ${networkName} Classic deployment is recorded`,
        },
      ],
    });
  }

  const launcher = getAddress(deployment.memeLaunchV2 as string);
  const hook = getAddress(deployment.ethCreatorFeeHookV3 as string);
  const hookFactory = getAddress(
    deployment.ethCreatorFeeHookFactoryV3 as string,
  );
  const vaultFactory = getAddress(
    deployment.classicRewardVaultFactoryV1 as string,
  );
  const ctoAuthority = getAddress(
    deployment.classicCtoAuthorityV1 as string,
  );
  const initialBuyVestingWalletFactory = getAddress(
    deployment.classicInitialBuyVestingWalletFactoryV1 as string,
  );
  const launchPolicy = getAddress(
    deployment.classicLaunchPolicyV1 as string,
  );
  const positionForwarderFactory = getAddress(
    deployment.lockedPositionFeeForwarderFactory as string,
  );
  await assertClassicV3Infrastructure(
    launcher,
    hook,
    hookFactory,
    vaultFactory,
    ctoAuthority,
    initialBuyVestingWalletFactory,
    launchPolicy,
    positionForwarderFactory,
    {
      classicCtoAuthorityV1:
        deployment.runtimeCodeHashes.classicCtoAuthorityV1 as Hex,
      classicRewardVaultFactoryV1:
        deployment.runtimeCodeHashes.classicRewardVaultFactoryV1 as Hex,
      classicInitialBuyVestingWalletFactoryV1:
        deployment.runtimeCodeHashes
          .classicInitialBuyVestingWalletFactoryV1 as Hex,
      classicLaunchPolicyV1:
        deployment.runtimeCodeHashes.classicLaunchPolicyV1 as Hex,
      ethCreatorFeeHookFactoryV3:
        deployment.runtimeCodeHashes.ethCreatorFeeHookFactoryV3 as Hex,
      ethCreatorFeeHookV3:
        deployment.runtimeCodeHashes.ethCreatorFeeHookV3 as Hex,
      memeLaunchV2: deployment.runtimeCodeHashes.memeLaunchV2 as Hex,
      lockedPositionFeeForwarderFactory: deployment.runtimeCodeHashes
        .lockedPositionFeeForwarderFactory as Hex,
    },
    rpcClient,
  );

  const [predictedToken] = await client.readContract({
    address: launcher,
    abi: classicV3LaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const predictedRewardVault = await client.readContract({
    address: launcher,
    abi: classicV3LaunchAbi,
    functionName: "predictRewardVault",
    args: [
      predictedToken,
      account,
      configuration.rewards.beneficiaries,
      configuration.rewards.sharesBps,
    ],
  });
  const existingCode = await client.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeClassicV3Launch(draft, draft.launchSalt, account),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(
    account,
    launchBase,
    rpcClient,
  );
  return response({
    status: "ready",
    mode: "classic-v3",
    title: "Ready for wallet review",
    detail: `The exact Classic launch succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Classic contracts",
        status: "pass",
        detail:
          "Runtime bytecode, immutable directional fees and reward ownership match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: `The token, locked liquidity and reward vault at ${predictedRewardVault.slice(0, 8)}…${predictedRewardVault.slice(-6)} are prepared atomically`,
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: hook,
    planHash: buildPlanHash(account, launchBase),
  });
}

async function assertClassicV4Infrastructure(
  release: ClassicV4PublicRelease,
  rpcClient: LaunchRpcClient,
) {
  const { addresses, runtimeCodeHashes, officialDependencies } = release;
  const runtimeBindings = [
    [
      CLASSIC_V4_LAUNCH_STAMP_ROUTER,
      CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
      "canonical Launch Stamp Router",
    ] as const,
    ...Object.entries(officialDependencies).map(
      ([, dependency]) =>
        [
          dependency.address,
          dependency.runtimeCodeHash,
          "Uniswap dependency",
        ] as const,
    ),
    ...(
      [
        "ctoAuthority",
        "rewardVaultFactory",
        "initialBuyVestingWalletFactory",
        "launchPolicy",
        "positionForwarderFactory",
        "hookFactory",
        "feeHook",
        "positionPlanner",
        "launcher",
      ] as const
    ).map(
      (name) =>
        [addresses[name], runtimeCodeHashes[name], `Classic V4 ${name}`] as const,
    ),
  ];
  await Promise.all(
    runtimeBindings.map(([address, expected, label]) =>
      assertRuntimeCodeHash(address, expected, label, rpcClient),
    ),
  );

  const launcher = addresses.launcher;
  const hook = addresses.feeHook;
  const planner = addresses.positionPlanner;
  const [
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherVaultFactory,
    launcherVestingFactory,
    launcherPolicy,
    launcherPositionFactory,
    launcherPlanner,
    launcherRouter,
    minimumInitialBuyWei,
    maximumLauncherRewardBeneficiaries,
    launcherRewardShareBasisPoints,
    launcherTokenSupply,
    launcherInitialTick,
    launcherTickSpacing,
    launcherLpFeePips,
    hookPoolManager,
    hookTreasury,
    hookVaultFactory,
    launcherFeeBps,
    minimumFeeBps,
    maximumFeeBps,
    feeStepBps,
    transferTaxBps,
    hookLpFeePips,
    hookTickSpacing,
    factoryRecognizesHook,
    factoryRequiredFlags,
    plannerTokenSupply,
    plannerInitialTick,
    plannerLiquidityTickLower,
    plannerTickSpacing,
    configuredCtoAuthority,
    configuredCtoAuthorityAccount,
    minimumCustodyDurationDays,
    maximumCustodyDurationDays,
    maximumTokenNameBytes,
    maximumTokenSymbolBytes,
    maximumTokenDescriptionBytes,
    maximumMetadataUrlBytes,
    maximumSocialExtraDataBytes,
    maximumPolicyRewardBeneficiaries,
    policyRewardShareBasisPoints,
    forwarderPositionManager,
  ] = await Promise.all([
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "poolManager",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "positionManager",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "tokenFactory",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "feeHook",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "rewardVaultFactory",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "initialBuyVestingWalletFactory",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "launchPolicy",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "positionPlanner",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "ROUTER",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "MAX_REWARD_BENEFICIARIES",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "REWARD_SHARE_BASIS_POINTS",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "TOKEN_SUPPLY",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "INITIAL_TICK",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "TICK_SPACING",
    }),
    rpcClient.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "LP_FEE_PIPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "poolManager",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "launcherFeeRecipient",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "feeSplitVaultFactory",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "MIN_TOTAL_SWAP_FEE_BPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "MAX_TOTAL_SWAP_FEE_BPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "TOTAL_SWAP_FEE_STEP_BPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "TRANSFER_TAX_BPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    rpcClient.readContract({
      address: hook,
      abi: classicV4HookAbi,
      functionName: "TICK_SPACING",
    }),
    rpcClient.readContract({
      address: addresses.hookFactory,
      abi: classicV4HookFactoryAbi,
      functionName: "isFactoryHook",
      args: [hook],
    }),
    rpcClient.readContract({
      address: addresses.hookFactory,
      abi: classicV4HookFactoryAbi,
      functionName: "REQUIRED_HOOK_FLAGS",
    }),
    rpcClient.readContract({
      address: planner,
      abi: classicV4PositionPlannerAbi,
      functionName: "TOKEN_SUPPLY",
    }),
    rpcClient.readContract({
      address: planner,
      abi: classicV4PositionPlannerAbi,
      functionName: "INITIAL_TICK",
    }),
    rpcClient.readContract({
      address: planner,
      abi: classicV4PositionPlannerAbi,
      functionName: "LIQUIDITY_TICK_LOWER",
    }),
    rpcClient.readContract({
      address: planner,
      abi: classicV4PositionPlannerAbi,
      functionName: "TICK_SPACING",
    }),
    rpcClient.readContract({
      address: addresses.rewardVaultFactory,
      abi: classicRewardVaultFactoryAbi,
      functionName: "ctoAuthority",
    }),
    rpcClient.readContract({
      address: addresses.ctoAuthority,
      abi: classicCtoAuthorityAbi,
      functionName: "authority",
    }),
    rpcClient.readContract({
      address: addresses.initialBuyVestingWalletFactory,
      abi: classicInitialBuyVestingWalletFactoryAbi,
      functionName: "MIN_DURATION_DAYS",
    }),
    rpcClient.readContract({
      address: addresses.initialBuyVestingWalletFactory,
      abi: classicInitialBuyVestingWalletFactoryAbi,
      functionName: "MAX_DURATION_DAYS",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_NAME_BYTES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_SYMBOL_BYTES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_TOKEN_DESCRIPTION_BYTES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_METADATA_URL_BYTES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_SOCIAL_EXTRA_DATA_BYTES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "MAX_REWARD_BENEFICIARIES",
    }),
    rpcClient.readContract({
      address: addresses.launchPolicy,
      abi: classicLaunchPolicyAbi,
      functionName: "REWARD_SHARE_BASIS_POINTS",
    }),
    rpcClient.readContract({
      address: addresses.positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
  ]);

  const expectedAddresses = [
    [launcherPoolManager, officialDependencies.poolManager.address, "PoolManager"],
    [
      launcherPositionManager,
      officialDependencies.positionManager.address,
      "PositionManager",
    ],
    [
      launcherTokenFactory,
      officialDependencies.uerc20Factory.address,
      "UERC20Factory",
    ],
    [launcherHook, hook, "fee hook"],
    [launcherVaultFactory, addresses.rewardVaultFactory, "reward factory"],
    [
      launcherVestingFactory,
      addresses.initialBuyVestingWalletFactory,
      "Activation Buy custody factory",
    ],
    [launcherPolicy, addresses.launchPolicy, "launch policy"],
    [
      launcherPositionFactory,
      addresses.positionForwarderFactory,
      "position factory",
    ],
    [launcherPlanner, planner, "position planner"],
    [launcherRouter, CLASSIC_V4_LAUNCH_STAMP_ROUTER, "Launch Stamp Router"],
    [hookPoolManager, officialDependencies.poolManager.address, "hook PoolManager"],
    [hookTreasury, addresses.launcherFeeRecipient, "treasury"],
    [hookVaultFactory, addresses.rewardVaultFactory, "hook reward factory"],
    [configuredCtoAuthority, addresses.ctoAuthority, "CTO authority"],
    [
      configuredCtoAuthorityAccount,
      classicCtoAuthorityAccount,
      "CTO authority account",
    ],
    [
      forwarderPositionManager,
      officialDependencies.positionManager.address,
      "position factory PositionManager",
    ],
  ] as const;
  for (const [actual, expected, label] of expectedAddresses) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `The Classic V4 ${label} does not match the public release manifest`,
      );
    }
  }

  if (
    !factoryRecognizesHook ||
    factoryRequiredFlags !== REQUIRED_FEE_HOOK_FLAGS ||
    (BigInt(hook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS ||
    launcherFeeBps !== 10 ||
    minimumFeeBps !== 10 ||
    maximumFeeBps !== 1_000 ||
    feeStepBps !== 10 ||
    transferTaxBps !== 0 ||
    hookLpFeePips !== 0 ||
    hookTickSpacing !== 200 ||
    minimumInitialBuyWei !== MEME_MIN_INITIAL_BUY_WEI ||
    maximumLauncherRewardBeneficiaries !== 5n ||
    launcherRewardShareBasisPoints !== 10_000 ||
    launcherTokenSupply !== MEME_TOKEN_SUPPLY_WEI ||
    launcherInitialTick !== MEME_INITIAL_TICK ||
    launcherTickSpacing !== 200 ||
    launcherLpFeePips !== 0 ||
    plannerTokenSupply !== MEME_TOKEN_SUPPLY_WEI ||
    plannerInitialTick !== MEME_INITIAL_TICK ||
    plannerLiquidityTickLower !== CLASSIC_LIQUIDITY_TICK_LOWER ||
    plannerTickSpacing !== 200 ||
    minimumCustodyDurationDays !== 1 ||
    maximumCustodyDurationDays !== 3_650 ||
    maximumTokenNameBytes !== BigInt(MAX_TOKEN_NAME_BYTES) ||
    maximumTokenSymbolBytes !== BigInt(MAX_TOKEN_SYMBOL_BYTES) ||
    maximumTokenDescriptionBytes !== BigInt(MAX_TOKEN_DESCRIPTION_BYTES) ||
    maximumMetadataUrlBytes !== BigInt(MAX_METADATA_URL_BYTES) ||
    maximumSocialExtraDataBytes !== BigInt(MAX_SOCIAL_EXTRA_DATA_BYTES) ||
    maximumPolicyRewardBeneficiaries !== 5n ||
    policyRewardShareBasisPoints !== 10_000
  ) {
    throw new Error(
      "The Classic V4 economics do not match the public release manifest",
    );
  }
}

async function prepareClassicV4Launch(
  request: Request,
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  release: ClassicV4PublicRelease | null,
  rpcClient: LaunchRpcClient,
) {
  const configuration = validateClassicV4LaunchDraft(draft, account);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Activation Buy");
  }
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `Immutable ${(configuration.fees.buySwapFeeBps / 100).toFixed(2)}% buy and ${(configuration.fees.sellSwapFeeBps / 100).toFixed(2)}% sell fees, the canonical deeper locked range, and the Activation Buy are valid`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }
  if (!isClassicV4PublicActionRelease(release)) {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Classic V4 is not publicly available on ${networkName} yet`,
      detail:
        "Wallet transactions stay disabled until the verified, indexer-activated release is promoted to public availability",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Classic V4 contracts",
          status: "blocked",
          detail: `No fully verified, publicly available ${networkName} Classic V4 manifest is installed`,
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Waiting for the exact public release manifest",
        },
      ],
    });
  }

  await assertClassicV4Infrastructure(release, rpcClient);
  const launcher = release.addresses.launcher;
  const [predictedToken] = await rpcClient.readContract({
    address: launcher,
    abi: classicV4LaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingCode = await rpcClient.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const launcherCalldata = encodeClassicV4Launch(
    draft,
    draft.launchSalt,
    account,
  );
  let authorization;
  try {
    authorization = await getProductionClassicLaunchAuthorizationBridgeV1()
      .authorize(request, {
        schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
        chainId: "1",
        launchWallet: account,
        releaseManifestDigest: release.manifestDigest,
        launcher: release.addresses.launcher,
        launcherRuntimeCodeHash: release.runtimeCodeHashes.launcher,
        feeHook: release.addresses.feeHook,
        feeHookRuntimeCodeHash: release.runtimeCodeHashes.feeHook,
        valueWei: initialBuyWei.toString(),
        launcherCalldata,
      });
  } catch (error) {
    if (!(error instanceof ClassicLaunchAuthorizationBridgeErrorV1)) {
      throw error;
    }
    if (error.status === 400) {
      throw new LaunchInputError(
        "The Classic setup changed. Review the current values and try again",
      );
    }
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: error.status === 401 || error.status === 403
        ? "Reconnect the launch wallet"
        : "Classic V4 authorization is temporarily unavailable",
      detail: error.status === 401 || error.status === 403
        ? "The connected wallet session could not be verified"
        : "No wallet transaction is returned until the exact Router launch passes again",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Classic V4 contracts",
          status: "pass",
          detail:
            "Release evidence, runtime bytecode, immutable dependencies, fee bounds and the canonical locked liquidity range match",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "blocked",
          detail: "The signed Router authorization could not be completed",
        },
      ],
    });
  }
  if (
    authorization.predictedToken.toLowerCase() !== predictedToken.toLowerCase()
    || authorization.predictedHook.toLowerCase()
      !== release.addresses.feeHook.toLowerCase()
  ) {
    throw new Error("Classic V4 authorization prediction mismatch");
  }
  const launchBase = {
    kind: "launch" as const,
    chainId: 1 as const,
    to: authorization.transaction.to,
    data: authorization.transaction.calldata,
    value: authorization.transaction.valueWei,
  };

  return response({
    status: "ready",
    mode: "classic-v3",
    title: "Ready for wallet review",
    detail: "The exact Classic launch passed the signed Router simulation",
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Classic V4 contracts",
        status: "pass",
        detail:
          "Release evidence, runtime bytecode, immutable dependencies, fee bounds and the canonical locked liquidity range match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: "The permit attached launchAndStampV1 transaction succeeds",
      },
    ],
    transaction: {
      ...launchBase,
      gasLimit: authorization.transaction.gasLimit,
    },
    predictedToken,
    predictedHook: release.addresses.feeHook,
    releaseLauncher: release.addresses.launcher,
    releaseManifestDigest: release.manifestDigest,
    planHash: buildPlanHash(account, launchBase),
  });
}

// Retained as historical release evidence. The public route closes Deep before
// this transaction builder can be reached.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function prepareDeepLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
) {
  validateDeepV3LaunchDraft(draft, account);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Initial Buy");
  }
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Deep setup",
    status: "pass",
    detail:
      "Every swap charges 1.00%: 0.90% deepens the original locked pool and 0.10% goes to Programmable",
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "deep",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }

  if (!selectedDeepV3Release || launchChain.id !== 1) {
    return response({
      status: "blocked",
      mode: "deep",
      title: `Deep is not deployed on ${networkName} yet`,
      detail:
        "Wallet transactions stay disabled until the deployment, source verification and lifecycle evidence are approved",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Deep contracts",
          status: "blocked",
          detail: `No approved ${networkName} Deep deployment is recorded`,
        },
      ],
    });
  }

  const runtimeRelease = deepV3RuntimeRelease(selectedDeepV3Release);
  await assertDeepV3RuntimeBinding({
    clients: createDeepV3RuntimeBindingClients(),
    release: runtimeRelease,
  });

  const [predictedToken] = await client.readContract({
    address: runtimeRelease.addresses.launcher,
    abi: deepV3LaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingCode = await client.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const [quote, latestBlock] = await Promise.all([
    quoteDeepV3InitialBuy(initialBuyWei),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const deadline = latestBlock.timestamp + 1_200n;
  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: runtimeRelease.addresses.launcher,
    data: encodeDeepV3Launch(draft, draft.launchSalt, account, {
      minimumInitialTokenOut: quote.minimumInitialTokenOut,
      initialBuySqrtPriceLimitX96: quote.initialBuySqrtPriceLimitX96,
      deadline,
    }),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "deep",
    title: "Ready for wallet review",
    detail: `The exact Deep launch succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Deep contracts",
        status: "pass",
        detail:
          "Two independent RPCs agree on every reviewed runtime, dependency and immutable policy",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail:
          "The token, original locked position and protected Initial Buy are prepared atomically",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: runtimeRelease.addresses.feeHook,
    planHash: buildPlanHash(account, launchBase),
  });
}

const adaptiveHookSaltParameters = parseAbiParameters(
  "address creator,bytes32 creatorSalt,bytes32 hookSaltNonce",
);

function adaptiveEffectiveHookSalt(
  account: Address,
  launchSalt: Hex,
  hookSaltNonce: Hex,
) {
  return keccak256(
    encodeAbiParameters(adaptiveHookSaltParameters, [
      account,
      launchSalt,
      hookSaltNonce,
    ]),
  );
}

function mineAdaptiveHookSaltNonce(
  account: Address,
  launchSalt: Hex,
  factory: Address,
  initCodeHash: Hex,
) {
  for (let counter = 0; counter < 250_000; counter += 1) {
    const hookSaltNonce = toHex(counter, { size: 32 });
    const effectiveSalt = adaptiveEffectiveHookSalt(
      account,
      launchSalt,
      hookSaltNonce,
    );
    const hook = getCreate2Address({
      from: factory,
      salt: effectiveSalt,
      bytecodeHash: initCodeHash,
    });
    if ((BigInt(hook) & HOOK_FLAG_MASK) === REQUIRED_FEE_HOOK_FLAGS) {
      return { hookSaltNonce, hook };
    }
  }
  throw new Error("A valid deterministic Adaptive hook address was not found");
}

async function assertAdaptiveReleaseInfrastructure(
  launcher: Address,
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    adaptiveCurveFeeHookFactory: Hex;
    adaptiveCurveLaunch: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.adaptiveCurveFeeHookFactory,
      "Adaptive hook factory",
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.adaptiveCurveLaunch,
      "Adaptive launcher",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredHookFactory,
    configuredForwarderFactory,
    configuredTreasury,
    forwarderPositionManager,
    requiredFlags,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "adaptiveHookFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: hookFactory,
      abi: adaptiveCurveHookFactoryAbi,
      functionName: "REQUIRED_HOOK_FLAGS",
    }),
  ]);

  const expected = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredHookFactory, hookFactory, "hook factory"],
    [configuredForwarderFactory, positionForwarderFactory, "position factory"],
    [configuredTreasury, platformTreasury, "treasury"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
  ] as const;
  for (const [actual, wanted, label] of expected) {
    if (actual.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(
        `The Adaptive ${label} does not match the release manifest`,
      );
    }
  }
  if (requiredFlags !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new Error(
      "The Adaptive hook callback mask does not match the release manifest",
    );
  }
}

async function prepareAdaptiveLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
) {
  validateAdaptiveLaunchDraft(draft);
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Adaptive curve",
    status: "pass",
    detail: "The immutable market-cap curve and its fee bounds are valid",
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "adaptive",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }

  const {
    adaptiveLaunchStatus,
    adaptiveCurveFeeHookFactory,
    adaptiveCurveLaunch,
    lockedPositionFeeForwarderFactory,
    runtimeCodeHashes,
  } = deployment;
  if (
    adaptiveLaunchStatus !== "ready" ||
    !adaptiveCurveFeeHookFactory ||
    !adaptiveCurveLaunch ||
    !lockedPositionFeeForwarderFactory ||
    !runtimeCodeHashes.adaptiveCurveFeeHookFactory ||
    !runtimeCodeHashes.adaptiveCurveLaunch ||
    !runtimeCodeHashes.lockedPositionFeeForwarderFactory
  ) {
    return response({
      status: "blocked",
      mode: "adaptive",
      title: `Adaptive is not deployed on ${networkName} yet`,
      detail:
        "The editor is available for review. Wallet transactions remain disabled until the exact deployment is recorded and verified",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Adaptive contracts",
          status: "blocked",
          detail: `No approved ${networkName} deployment is recorded`,
        },
      ],
    });
  }

  const launcher = getAddress(adaptiveCurveLaunch);
  const hookFactory = getAddress(adaptiveCurveFeeHookFactory);
  const positionForwarderFactory = getAddress(
    lockedPositionFeeForwarderFactory,
  );
  await assertAdaptiveReleaseInfrastructure(
    launcher,
    hookFactory,
    positionForwarderFactory,
    {
      adaptiveCurveFeeHookFactory:
        runtimeCodeHashes.adaptiveCurveFeeHookFactory as Hex,
      adaptiveCurveLaunch: runtimeCodeHashes.adaptiveCurveLaunch as Hex,
      lockedPositionFeeForwarderFactory:
        runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
  );

  const initCodeHash = await client.readContract({
    address: hookFactory,
    abi: adaptiveCurveHookFactoryAbi,
    functionName: "initCodeHash",
    args: [officialPoolManager, platformTreasury],
  });
  if (
    !isHex(draft.hookSaltNonce, { strict: true }) ||
    draft.hookSaltNonce.length !== 66
  ) {
    const mined = mineAdaptiveHookSaltNonce(
      account,
      draft.launchSalt,
      hookFactory,
      initCodeHash,
    );
    return response({
      status: "blocked",
      mode: "adaptive",
      title: "Adaptive address prepared",
      detail: "Checking the deterministic hook and launch transaction",
      checks: [tokenCheck, connectedWalletCheck],
      predictedHook: mined.hook,
      draftPatch: { hookSaltNonce: mined.hookSaltNonce },
    });
  }

  validateAdaptiveLaunchDraft(draft, { requireHookSaltNonce: true });
  const effectiveSalt = adaptiveEffectiveHookSalt(
    account,
    draft.launchSalt,
    draft.hookSaltNonce,
  );
  const locallyPredictedHook = getCreate2Address({
    from: hookFactory,
    salt: effectiveSalt,
    bytecodeHash: initCodeHash,
  });
  const predictedHook = await client.readContract({
    address: launcher,
    abi: adaptiveCurveLaunchAbi,
    functionName: "predictFeeHook",
    args: [account, draft.launchSalt, draft.hookSaltNonce],
  });
  if (predictedHook.toLowerCase() !== locallyPredictedHook.toLowerCase()) {
    throw new Error(
      "The Adaptive hook prediction does not match the deployed launcher",
    );
  }
  if ((BigInt(predictedHook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new LaunchInputError(
      "The deterministic hook address has invalid callback permissions",
    );
  }

  const [predictedToken] = await client.readContract({
    address: launcher,
    abi: adaptiveCurveLaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingTokenCode = await client.getCode({ address: predictedToken });
  if (existingTokenCode && existingTokenCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const initialBuyWei = parseOptionalInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid optional Dev Buy");
  }
  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeAdaptiveLaunch(draft, draft.launchSalt),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "adaptive",
    title: "Ready for wallet review",
    detail: `The Adaptive launch succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Adaptive contracts",
        status: "pass",
        detail:
          "Runtime bytecode, official dependencies and deterministic hook permissions match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: "The complete atomic launch succeeds",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook,
    planHash: buildPlanHash(account, launchBase),
  });
}

async function assertStockPairedInfrastructure(
  release: VerifiedStockPairedRelease,
) {
  const {
    quoteRegistry,
    positionPlanner,
    feeSplitVaultFactory,
    hookFactory,
    feeHook,
    launcher,
    ethLaunchCoordinator,
    positionForwarderFactory,
    treasury,
  } = release.addresses;
  const quoteAssets = getStockPairedQuoteAssetsForRelease(release);
  const ethQuoteAssets = getStockPairedEthQuoteAssetsForRelease(release);
  const routePools = [
    ...new Map(
      ethQuoteAssets.flatMap((asset) =>
        getStockPairedEthRoute(asset.address).buyHops.map(
          (hop) => [hop.pool.toLowerCase(), hop] as const,
        ),
      ),
    ).values(),
  ];

  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    ...(
      [
        ["v3Factory", "Uniswap v3 factory"],
        ["v3SwapRouter", "Uniswap v3 SwapRouter"],
        ["v3Quoter", "Uniswap v3 Quoter"],
        ["weth", "Wrapped Ether"],
        ["usdc", "USD Coin"],
      ] as const
    ).map(([field, label]) =>
      assertRuntimeCodeHash(
        release.officialDependencies[field].address,
        release.officialDependencies[field].runtimeCodeHash,
        label,
      ),
    ),
    ...(
      [
        ["quoteRegistry", quoteRegistry, "Stock quote registry"],
        ["positionPlanner", positionPlanner, "Stock-Paired position planner"],
        [
          "feeSplitVaultFactory",
          feeSplitVaultFactory,
          "Stock-Paired reward factory",
        ],
        ["hookFactory", hookFactory, "Stock-Paired hook factory"],
        ["feeHook", feeHook, "Stock-Paired hook"],
        ["launcher", launcher, "Stock-Paired launcher"],
        [
          "ethLaunchCoordinator",
          ethLaunchCoordinator,
          "Stock-Paired ETH launch coordinator",
        ],
        [
          "positionForwarderFactory",
          positionForwarderFactory,
          "Locked position factory",
        ],
      ] as const
    ).map(([field, address, label]) =>
      assertRuntimeCodeHash(address, release.runtimeCodeHashes[field], label),
    ),
    ...routePools.map((pool) =>
      assertRuntimeCodeHash(
        pool.pool,
        pool.poolRuntimeCodeHash,
        "Stock-Paired ETH route pool",
      ),
    ),
  ]);

  const [
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherRegistry,
    launcherPlanner,
    launcherVaultFactory,
    launcherPositionFactory,
    minimumInitialBuy,
    hookPoolManager,
    hookTreasury,
    hookRegistry,
    hookVaultFactory,
    totalSwapFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    lpFeePips,
    tickSpacing,
    factoryRecognizesHook,
    positionFactoryManager,
    registryAssetCount,
    coordinatorLauncher,
    coordinatorV3Router,
    coordinatorV3Factory,
    coordinatorWeth,
    coordinatorUsdc,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "feeHook",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "quoteRegistry",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "positionPlanner",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "feeSplitVaultFactory",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: launcher,
      abi: stockPairedLaunchAbi,
      functionName: "MIN_INITIAL_BUY_QUOTE_AMOUNT",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "quoteRegistry",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "feeSplitVaultFactory",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "TOTAL_SWAP_FEE_BPS",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "CREATOR_FEE_BPS",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "TRANSFER_TAX_BPS",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    client.readContract({
      address: feeHook,
      abi: stockPairedHookAbi,
      functionName: "TICK_SPACING",
    }),
    client.readContract({
      address: hookFactory,
      abi: stockPairedHookFactoryAbi,
      functionName: "isFactoryHook",
      args: [feeHook],
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: quoteRegistry,
      abi: stockQuoteRegistryAbi,
      functionName: "assetCount",
    }),
    client.readContract({
      address: ethLaunchCoordinator,
      abi: stockPairedEthLaunchCoordinatorAbi,
      functionName: "launcher",
    }),
    client.readContract({
      address: ethLaunchCoordinator,
      abi: stockPairedEthLaunchCoordinatorAbi,
      functionName: "v3SwapRouter",
    }),
    client.readContract({
      address: ethLaunchCoordinator,
      abi: stockPairedEthLaunchCoordinatorAbi,
      functionName: "v3Factory",
    }),
    client.readContract({
      address: ethLaunchCoordinator,
      abi: stockPairedEthLaunchCoordinatorAbi,
      functionName: "weth",
    }),
    client.readContract({
      address: ethLaunchCoordinator,
      abi: stockPairedEthLaunchCoordinatorAbi,
      functionName: "usdc",
    }),
  ]);

  const expectedAddresses = [
    [launcherPoolManager, officialPoolManager, "launcher PoolManager"],
    [
      launcherPositionManager,
      officialPositionManager,
      "launcher PositionManager",
    ],
    [launcherTokenFactory, officialTokenFactory, "launcher UERC20Factory"],
    [launcherHook, feeHook, "launcher hook"],
    [launcherRegistry, quoteRegistry, "launcher registry"],
    [launcherPlanner, positionPlanner, "launcher position planner"],
    [launcherVaultFactory, feeSplitVaultFactory, "launcher reward factory"],
    [
      launcherPositionFactory,
      positionForwarderFactory,
      "launcher position factory",
    ],
    [hookPoolManager, officialPoolManager, "hook PoolManager"],
    [hookTreasury, treasury, "hook treasury"],
    [hookRegistry, quoteRegistry, "hook registry"],
    [hookVaultFactory, feeSplitVaultFactory, "hook reward factory"],
    [
      positionFactoryManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
    [coordinatorLauncher, launcher, "ETH coordinator launcher"],
    [
      coordinatorV3Router,
      release.officialDependencies.v3SwapRouter.address,
      "ETH coordinator v3 router",
    ],
    [
      coordinatorV3Factory,
      release.officialDependencies.v3Factory.address,
      "ETH coordinator v3 factory",
    ],
    [
      coordinatorWeth,
      release.officialDependencies.weth.address,
      "ETH coordinator WETH",
    ],
    [
      coordinatorUsdc,
      release.officialDependencies.usdc.address,
      "ETH coordinator USDC",
    ],
  ] as const;
  for (const [actual, expected, label] of expectedAddresses) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`The Stock-Paired ${label} does not match the release`);
    }
  }
  if (
    minimumInitialBuy !== STOCK_PAIRED_MIN_INITIAL_BUY_RAW ||
    totalSwapFeeBps !== STOCK_PAIRED_TOTAL_SWAP_FEE_BPS ||
    creatorFeeBps !== STOCK_PAIRED_CREATOR_FEE_BPS ||
    launcherFeeBps !== STOCK_PAIRED_PROGRAMMABLE_FEE_BPS ||
    transferTaxBps !== 0 ||
    lpFeePips !== 0 ||
    tickSpacing !== 200 ||
    !factoryRecognizesHook ||
    !stockPairedRegistryContainsReleaseAssets(
      registryAssetCount,
      quoteAssets.length,
    ) ||
    (BigInt(feeHook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS
  ) {
    throw new Error(
      "The Stock-Paired economics or hook permissions do not match the release",
    );
  }

  const registryAssets = await Promise.all(
    quoteAssets.map(async (asset, index) => {
      const [registered, supported, configurationHash] = await Promise.all([
        client.readContract({
          address: quoteRegistry,
          abi: stockQuoteRegistryAbi,
          functionName: "assetAt",
          args: [BigInt(index)],
        }),
        client.readContract({
          address: quoteRegistry,
          abi: stockQuoteRegistryAbi,
          functionName: "isSupported",
          args: [asset.address],
        }),
        client.readContract({
          address: quoteRegistry,
          abi: stockQuoteRegistryAbi,
          functionName: "assertAssetReady",
          args: [asset.address],
        }),
      ]);
      return {
        asset,
        registered,
        supported,
        configurationHash,
      };
    }),
  );
  for (const entry of registryAssets) {
    if (
      entry.registered.toLowerCase() !== entry.asset.address.toLowerCase() ||
      !entry.supported ||
      entry.configurationHash ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      throw new Error(
        `The ${entry.asset.symbol} registry binding is not ready`,
      );
    }
  }

  const coordinatorRoutes = await Promise.all(
    ethQuoteAssets.map(async (asset) => {
      const route = getStockPairedEthRoute(asset.address);
      const [routeFee, routePath] = await Promise.all([
        client.readContract({
          address: ethLaunchCoordinator,
          abi: stockPairedEthLaunchCoordinatorAbi,
          functionName: "stockPoolFee",
          args: [asset.address],
        }),
        client.readContract({
          address: ethLaunchCoordinator,
          abi: stockPairedEthLaunchCoordinatorAbi,
          functionName: "routePath",
          args: [asset.address],
        }),
      ]);
      return {
        asset,
        routeFee,
        routePath,
        expectedRouteFee: route.buyHops[1].fee,
        expectedRoutePath: encodeStockPairedV3Path(route.buyHops),
      };
    }),
  );
  for (const entry of coordinatorRoutes) {
    if (
      entry.routeFee !== entry.expectedRouteFee ||
      entry.routePath.toLowerCase() !== entry.expectedRoutePath.toLowerCase()
    ) {
      throw new Error(`The ${entry.asset.symbol} ETH route is not ready`);
    }
  }
  const routedAddresses = new Set(
    ethQuoteAssets.map((asset) => asset.address.toLowerCase()),
  );
  const unroutedFees = await Promise.all(
    quoteAssets
      .filter((asset) => !routedAddresses.has(asset.address.toLowerCase()))
      .map((asset) =>
        client.readContract({
          address: ethLaunchCoordinator,
          abi: stockPairedEthLaunchCoordinatorAbi,
          functionName: "stockPoolFee",
          args: [asset.address],
        }),
      ),
  );
  if (unroutedFees.some((fee) => fee !== 0)) {
    throw new Error(
      "An unreviewed Stock-Paired ETH route is unexpectedly enabled",
    );
  }
}

async function quoteStockPairedExternalRoute(
  account: Address,
  quoteAsset: Address,
  amountIn: bigint,
  side: "buy" | "sell",
) {
  const route = getStockPairedEthRoute(quoteAsset);
  const hops = side === "buy" ? route.buyHops : route.sellHops;
  let result;
  try {
    result = await client.call({
      account,
      to: STOCK_PAIRED_V3_QUOTER,
      data: encodeFunctionData({
        abi: stockPairedV3QuoterAbi,
        functionName: "quoteExactInput",
        args: [encodeStockPairedV3Path(hops), amountIn],
      }),
    });
  } catch {
    throw new LaunchInputError(
      "The selected stock does not have enough ETH route liquidity for this Initial Buy",
    );
  }
  if (!result.data || result.data === "0x") {
    throw new LaunchInputError(
      "The selected stock does not have a usable ETH route",
    );
  }
  const [amountOut, , , gasEstimate] = decodeFunctionResult({
    abi: stockPairedV3QuoterAbi,
    functionName: "quoteExactInput",
    data: result.data,
  });
  if (amountOut <= 0n) {
    throw new LaunchInputError(
      "The selected stock does not have a usable ETH route",
    );
  }
  return { amountOut, gasEstimate };
}

async function assertStockPairedRuntimeFdv(
  account: Address,
  quoteAsset: Address,
  targetQuoteAmountWad: string,
) {
  const readAssessment = async () => {
    let routeQuoteAmount: bigint;
    try {
      const quote = await quoteStockPairedExternalRoute(
        account,
        quoteAsset,
        STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI,
        "buy",
      );
      routeQuoteAmount = quote.amountOut;
    } catch {
      throw new LaunchInputError(
        "Current Stock-Paired launch pricing could not be verified from the reviewed ETH route",
      );
    }

    return assessStockPairedRuntimeFdv({
      targetQuoteAmountWad,
      routeQuoteAmount,
    });
  };

  const initialAssessment = await readAssessment();
  if (initialAssessment.withinPolicy) {
    return;
  }

  // A stale RPC response or a just-mined route update must not pause a safe
  // launch. After an outlier, require two fresh in-policy quotes in a row.
  const retryAssessment = await readAssessment();
  const confirmationAssessment = await readAssessment();
  if (
    retryAssessment.withinPolicy &&
    confirmationAssessment.withinPolicy
  ) {
    return;
  }

  throw new LaunchInputError(
    "New Stock-Paired launches are paused because the current starting FDV is outside the reviewed range",
  );
}

async function findStockPairedCurrency0Salt({
  account,
  coordinator,
  name,
  symbol,
  quoteAsset,
  baseSalt,
}: {
  account: Address;
  coordinator: Address;
  name: string;
  symbol: string;
  quoteAsset: Address;
  baseSalt: Hex;
}) {
  for (
    let offset = 0;
    offset < STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS;
    offset += STOCK_PAIRED_CURRENCY0_SEARCH_BATCH_SIZE
  ) {
    const salts = Array.from(
      {
        length: Math.min(
          STOCK_PAIRED_CURRENCY0_SEARCH_BATCH_SIZE,
          STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS - offset,
        ),
      },
      (_, index) =>
        deriveStockPairedCurrency0Salt(baseSalt, offset + index),
    );
    const predictions = await client.multicall({
      allowFailure: false,
      contracts: salts.map((creatorSalt) => ({
        address: coordinator,
        abi: stockPairedEthLaunchCoordinatorAbi,
        functionName: "predictTokenAddress",
        args: [name, symbol, account, creatorSalt],
      })),
    });
    const candidateIndex = predictions.findIndex(([token]) =>
      isStockPairedLaunchedTokenCurrency0(getAddress(token), quoteAsset),
    );
    if (candidateIndex !== -1) {
      return {
        creatorSalt: salts[candidateIndex],
        token: getAddress(predictions[candidateIndex][0]),
      };
    }
  }
  throw new LaunchInputError(
    "A compatible Stock-Paired token address could not be prepared. Try the launch again",
  );
}

// Retained as release evidence for historical Stock-Paired deployments. No
// public route calls this transaction builder after new launches were closed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function prepareStockPairedLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
) {
  const configuration = validateStockPairedLaunchDraft(draft, account);
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `${configuration.quoteAsset.symbol} quote · 1.00% total fee · ${configuration.rewards.beneficiaries.length} reward recipient${configuration.rewards.beneficiaries.length === 1 ? "" : "s"}`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "stock-paired",
      title: "Switch the wallet to Ethereum",
      detail: "Stock-Paired launches are fixed to Ethereum Mainnet",
      checks: [tokenCheck, connectedWalletCheck],
    });
  }

  const release = selectedStockPairedRelease;
  if (!release) {
    return response({
      status: "blocked",
      mode: "stock-paired",
      title: "Stock-Paired is being finalized",
      detail:
        "Wallet transactions stay disabled until deployment, source verification and lifecycle evidence are complete",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Stock-Paired contracts",
          status: "blocked",
          detail: "No approved Ethereum release is recorded",
        },
      ],
    });
  }

  await assertStockPairedInfrastructure(release);
  if (
    release.internalContractRelease !== "stock-paired-v3" ||
    !("targetQuoteAmountWad" in configuration.quoteAsset)
  ) {
    throw new LaunchInputError(
      "The current Stock-Paired starting FDV policy is not available",
    );
  }
  await assertStockPairedRuntimeFdv(
    account,
    configuration.quoteAsset.address,
    configuration.quoteAsset.targetQuoteAmountWad,
  );
  const { ethLaunchCoordinator, feeHook } = release.addresses;
  const predicted = await client.readContract({
    address: ethLaunchCoordinator,
    abi: stockPairedEthLaunchCoordinatorAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const [predictedToken] = predicted;
  if (
    !isStockPairedLaunchedTokenCurrency0(
      predictedToken,
      configuration.quoteAsset.address,
    )
  ) {
    const canonical = await findStockPairedCurrency0Salt({
      account,
      coordinator: ethLaunchCoordinator,
      name: draft.tokenName.trim(),
      symbol: draft.tokenSymbol.trim(),
      quoteAsset: configuration.quoteAsset.address,
      baseSalt: draft.launchSalt,
    });
    return response({
      status: "blocked",
      mode: "stock-paired",
      title: "Token address prepared",
      detail:
        "Checking the launch with the canonical Uniswap v4 currency order",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Pool compatibility",
          status: "pass",
          detail:
            "The launched token is currency0 for broad indexer compatibility",
        },
      ],
      predictedToken: canonical.token,
      predictedHook: feeHook,
      draftPatch: { launchSalt: canonical.creatorSalt },
    });
  }

  const [block, forwardQuote] = await Promise.all([
    client.getBlock(),
    quoteStockPairedExternalRoute(
      account,
      configuration.quoteAsset.address,
      configuration.initialBuyEthAmount,
      "buy",
    ),
  ]);
  if (forwardQuote.amountOut < STOCK_PAIRED_MIN_INITIAL_BUY_RAW) {
    throw new LaunchInputError(
      `Increase the Initial Buy so it routes to at least ${STOCK_PAIRED_MIN_INITIAL_BUY} ${configuration.quoteAsset.symbol}`,
    );
  }
  const reverseQuote = await quoteStockPairedExternalRoute(
    account,
    configuration.quoteAsset.address,
    forwardQuote.amountOut,
    "sell",
  );
  if (
    reverseQuote.amountOut * 10_000n <
    configuration.initialBuyEthAmount * STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS
  ) {
    throw new LaunchInputError(
      "The selected stock route is too thin for this Initial Buy",
    );
  }
  const existingCode = await client.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const deadline = block.timestamp + 1_200n;
  const minimumQuoteAmountOut = (forwardQuote.amountOut * 9_900n) / 10_000n;
  const probeData = encodeStockPairedEthLaunch(
    draft,
    draft.launchSalt,
    account,
    {
      minimumQuoteAmountOut,
      minimumInitialTokenOut: 1n,
      deadline,
    },
  );
  const probe = await client.call({
    account,
    to: ethLaunchCoordinator,
    data: probeData,
    value: configuration.initialBuyEthAmount,
  });
  if (!probe.data || probe.data === "0x") {
    throw new LaunchInputError(
      "The atomic ETH launch simulation returned no result",
    );
  }
  const simulated = decodeFunctionResult({
    abi: stockPairedEthLaunchCoordinatorAbi,
    functionName: "launch",
    data: probe.data,
  });
  if (
    simulated.token.toLowerCase() !== predictedToken.toLowerCase() ||
    simulated.quoteAsset.toLowerCase() !==
      configuration.quoteAsset.address.toLowerCase() ||
    simulated.quoteIsCurrency0 ||
    simulated.initialBuyQuoteAmount < minimumQuoteAmountOut ||
    simulated.initialBuyTokenAmount <= 0n
  ) {
    throw new LaunchInputError(
      "The atomic ETH launch simulation does not match the reviewed route",
    );
  }
  const minimumInitialTokenOut =
    (simulated.initialBuyTokenAmount * 9_900n) / 10_000n;
  const launchBase = {
    kind: "launch" as const,
    chainId: 1 as const,
    to: ethLaunchCoordinator,
    data: encodeStockPairedEthLaunch(draft, draft.launchSalt, account, {
      minimumQuoteAmountOut,
      minimumInitialTokenOut:
        minimumInitialTokenOut > 0n ? minimumInitialTokenOut : 1n,
      deadline,
    }),
    value: configuration.initialBuyEthAmount.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "stock-paired",
    title: "Ready for wallet review",
    detail: `ETH routes into ${configuration.quoteAsset.symbol} and launches the token atomically`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Stock-Paired contracts",
        status: "pass",
        detail:
          "Runtime bytecode, ETH route, quote asset, fixed fee split and permanent LP custody match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail:
          "One wallet transaction converts ETH, creates the token and initializes its locked v4 pool",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: feeHook,
    planHash: buildPlanHash(account, launchBase),
  });
}

export async function POST(request: NextRequest) {
  const blocked = legacyLaunchGuardV1();
  if (blocked) return blocked;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("The launch setup is too large", 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("The launch setup is not valid JSON");
    }
    if (!body || typeof body !== "object") {
      return errorResponse("The launch setup is missing");
    }

    const record = body as Record<string, unknown>;
    if (requestsClosedDeepLaunch(record.draft)) {
      return deepLaunchClosedResponse();
    }
    if (typeof record.account !== "string" || !isAddress(record.account)) {
      return errorResponse("Connect a valid Ethereum wallet");
    }

    const account = getAddress(record.account);
    const draft = parseDraft(record.draft);
    const connectedWalletCheck = walletCheck(account, record.walletChainId);
    if (draft.launchModel === "adaptive") {
      return await prepareAdaptiveLaunch(
        account,
        draft,
        connectedWalletCheck,
        selectedManifest,
      );
    }
    if (draft.launchModel === "classic-v3") {
      if (draft.classicContractRelease === "classic-v4") {
        const classicV4Release = getConfiguredClassicV4PublicRelease(
          launchEnvironment,
        );
        if (connectedWalletCheck.status !== "pass") {
          return await prepareClassicV4Launch(
            request,
            account,
            draft,
            connectedWalletCheck,
            classicV4Release,
            client,
          );
        }
        return await withClassicLaunchRpcFailover((rpcClient) =>
          prepareClassicV4Launch(
            request,
            account,
            draft,
            connectedWalletCheck,
            classicV4Release,
            rpcClient,
          ),
        );
      }
      if (connectedWalletCheck.status !== "pass") {
        return await prepareClassicV3Launch(
          account,
          draft,
          connectedWalletCheck,
          selectedManifest,
          client,
        );
      }
      return await withClassicLaunchRpcFailover((rpcClient) =>
        prepareClassicV3Launch(
          account,
          draft,
          connectedWalletCheck,
          selectedManifest,
          rpcClient,
        ),
      );
    }
    if (draft.launchModel === "deep") {
      return deepLaunchClosedResponse();
    }
    if (draft.launchModel === "stock-paired") {
      return NextResponse.json(
        {
          code: "stock_paired_launches_closed",
          error: "New Stock-Paired launches are no longer available",
        },
        {
          status: 410,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (connectedWalletCheck.status !== "pass") {
      return await prepareMemeLaunch(
        account,
        draft,
        connectedWalletCheck,
        selectedManifest,
        client,
      );
    }
    return await withClassicLaunchRpcFailover((rpcClient) =>
      prepareMemeLaunch(
        account,
        draft,
        connectedWalletCheck,
        selectedManifest,
        rpcClient,
      ),
    );
  } catch (caught) {
    if (caught instanceof LaunchInputError) {
      return errorResponse(caught.message);
    }

    console.error("Launch preflight failed", safeServerErrorSummary(caught));
    return errorResponse(
      `The ${networkName} simulation could not be completed safely`,
      502,
    );
  }
}
