import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import appDeploymentsJson from "../../contracts/config/app-deployments.v1.json";
import mainnetDependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDependencies from "../../contracts/dependencies/ethereum-sepolia.json";
import type {
  DeploymentEnvironment,
  OnchainDeployment,
  ReadyOnchainDeployment,
} from "./types";
import { productionMainnetReadRpcPair } from
  "./website-rpc-providers.server";

type DeploymentEntry = {
  chainId: number;
  releaseVersion: "classic-v1" | "classic-v2";
  status: string;
  memeLaunchStatus: string;
  ethCreatorFeeHook?: string | null;
  memeLaunch?: string | null;
  runtimeCodeHashes?: {
    ethCreatorFeeHook?: string | null;
    memeLaunch?: string | null;
  };
  deploymentBlocks?: {
    memeLaunch?: number | null;
  };
  lifecycleEvidence?: {
    status?: string;
    releaseEligible?: boolean;
    requiredRelease?: string;
    independentRpcCount?: number;
  };
  historicalV1Deployment?: {
    releaseVersion: "classic-v1";
    ethCreatorFeeHook?: string | null;
    memeLaunch?: string | null;
    runtimeCodeHashes?: {
      ethCreatorFeeHook?: string | null;
      memeLaunch?: string | null;
    };
    deploymentBlocks?: {
      memeLaunch?: number | null;
    };
  };
};

type AppDeployments = {
  production: DeploymentEntry;
  rehearsal: DeploymentEntry;
};

function positiveBigInt(
  value: string | undefined,
  fallback: bigint,
  minimum: bigint,
  maximum: bigint,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function asAddress(value: string | null | undefined): Address | null {
  return value && isAddress(value) ? getAddress(value) : null;
}

function asBytes32(value: string | null | undefined): Hex | null {
  return value && isHex(value) && value.length === 66
    ? (value as Hex)
    : null;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function productionPrimaryRpc() {
  return firstNonEmpty(
    process.env.ETHEREUM_RPC_URL,
    process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
  );
}

function productionSecondaryRpc() {
  return firstNonEmpty(
    process.env.ETHEREUM_RPC_URL_B,
    process.env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
  );
}

export function selectedDeploymentEnvironment(
  value = process.env.PROGRAMMABLE_ONCHAIN_NETWORK,
): DeploymentEnvironment {
  return value === "rehearsal" ? "rehearsal" : "production";
}

function getDistinctSecondaryRpc(
  primary: string,
  secondary: string | undefined,
) {
  const normalized = secondary?.trim();
  return normalized && normalized !== primary ? normalized : null;
}

function resolveOnchainDeployment(
  environment: DeploymentEnvironment,
  allowVerifiedLifecyclePending: boolean,
): OnchainDeployment {
  const appDeployments =
    appDeploymentsJson as unknown as AppDeployments;
  const entry = appDeployments[environment];
  const dependencies =
    environment === "production"
      ? mainnetDependencies
      : sepoliaDependencies;
  const expectedChainId = environment === "production" ? 1 : 11_155_111;
  if (entry.chainId !== expectedChainId) {
    throw new Error(
      `Deployment manifest chain mismatch for ${environment}`,
    );
  }
  if (
    entry.releaseVersion !== "classic-v1" &&
    entry.releaseVersion !== "classic-v2"
  ) {
    throw new Error(
      `Deployment manifest release mismatch for ${environment}`,
    );
  }

  const rpcUrl =
    environment === "production"
      ? productionPrimaryRpc() ?? "https://eth.drpc.org"
      : process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org";
  const rpcUrlSecondary = getDistinctSecondaryRpc(
    rpcUrl,
    environment === "production"
      ? productionSecondaryRpc()
      : process.env.SEPOLIA_RPC_URL_B,
  );
  const common = {
    environment,
    releaseVersion: entry.releaseVersion,
    chainId: expectedChainId,
    stateView: getAddress(dependencies.contracts.stateView.address),
    stateViewRuntimeCodeHash: dependencies.contracts.stateView
      .runtimeCodeHash as Hex,
    rpcUrl,
    rpcUrlSecondary,
    confirmations: positiveBigInt(
      process.env.PROGRAMMABLE_CONFIRMATIONS,
      12n,
      12n,
      256n,
    ),
    logBlockRange: positiveBigInt(
      process.env.PROGRAMMABLE_LOG_BLOCK_RANGE,
      5_000n,
      1n,
      100_000n,
    ),
  } as const;

  const verifiedPendingLifecycle =
    allowVerifiedLifecyclePending &&
    entry.memeLaunchStatus === "lifecycle-pending" &&
    entry.lifecycleEvidence?.status === "verified-current-release" &&
    entry.lifecycleEvidence.releaseEligible === true &&
    entry.lifecycleEvidence.requiredRelease === entry.releaseVersion &&
    (entry.lifecycleEvidence.independentRpcCount ?? 0) >= 2;
  if (
    entry.status !== "ready" ||
    (entry.memeLaunchStatus !== "ready" && !verifiedPendingLifecycle)
  ) {
    return {
      ...common,
      status: "not-deployed",
      launcher: null,
      feeHook: null,
      launcherRuntimeCodeHash: null,
      feeHookRuntimeCodeHash: null,
      deploymentBlock: null,
    };
  }

  const launcher = asAddress(entry.memeLaunch);
  const feeHook = asAddress(entry.ethCreatorFeeHook);
  const launcherRuntimeCodeHash = asBytes32(
    entry.runtimeCodeHashes?.memeLaunch,
  );
  const feeHookRuntimeCodeHash = asBytes32(
    entry.runtimeCodeHashes?.ethCreatorFeeHook,
  );
  const deploymentBlockValue = entry.deploymentBlocks?.memeLaunch;
  const deploymentBlock =
    typeof deploymentBlockValue === "number" &&
    Number.isSafeInteger(deploymentBlockValue) &&
    deploymentBlockValue >= 0
      ? BigInt(deploymentBlockValue)
      : null;

  if (
    !launcher ||
    !feeHook ||
    !launcherRuntimeCodeHash ||
    !feeHookRuntimeCodeHash ||
    deploymentBlock === null
  ) {
    throw new Error(
      `Ready ${environment} deployment is missing verified indexing configuration`,
    );
  }

  return {
    ...common,
    status: "ready",
    launcher,
    feeHook,
    launcherRuntimeCodeHash,
    feeHookRuntimeCodeHash,
    deploymentBlock,
  };
}

export function getOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  return resolveOnchainDeployment(environment, false);
}

export function getOperationalOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  const deployment = resolveOnchainDeployment(environment, true);
  if (
    deployment.status === "ready" &&
    deployment.environment === "production" &&
    (!productionPrimaryRpc() ||
      !productionSecondaryRpc() ||
      !deployment.rpcUrlSecondary)
  ) {
    throw new Error(
      "Production operations require two distinct authenticated RPC URLs",
    );
  }
  return deployment;
}

export function getWebsiteReadOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  const deployment = resolveOnchainDeployment(environment, true);
  if (deployment.environment !== "production") return deployment;
  const rpc = productionMainnetReadRpcPair();

  return {
    ...deployment,
    rpcUrl: rpc.primary.url,
    rpcUrlSecondary: rpc.secondary.url,
    rpcProviderIds: {
      primary: rpc.primary.provider,
      secondary: rpc.secondary.provider,
    },
  };
}

export function getCreatorClaimOnchainDeployments(
  current: ReadyOnchainDeployment,
): readonly ReadyOnchainDeployment[] {
  if (current.environment !== "production") return [current];
  const production = (appDeploymentsJson as unknown as AppDeployments)
    .production;
  const historical = production.historicalV1Deployment;
  const currentLauncher = asAddress(production.memeLaunch);
  const currentHook = asAddress(production.ethCreatorFeeHook);
  const currentLauncherHash = asBytes32(
    production.runtimeCodeHashes?.memeLaunch,
  );
  const currentHookHash = asBytes32(
    production.runtimeCodeHashes?.ethCreatorFeeHook,
  );
  if (
    current.chainId !== 1 ||
    current.releaseVersion !== "classic-v2" ||
    !currentLauncher ||
    !currentHook ||
    !currentLauncherHash ||
    !currentHookHash ||
    current.launcher !== currentLauncher ||
    current.feeHook !== currentHook ||
    current.launcherRuntimeCodeHash.toLowerCase() !==
      currentLauncherHash.toLowerCase() ||
    current.feeHookRuntimeCodeHash.toLowerCase() !==
      currentHookHash.toLowerCase()
  ) {
    throw new Error(
      "Current creator claim deployment does not match its manifest",
    );
  }

  const launcher = asAddress(historical?.memeLaunch);
  const feeHook = asAddress(historical?.ethCreatorFeeHook);
  const launcherRuntimeCodeHash = asBytes32(
    historical?.runtimeCodeHashes?.memeLaunch,
  );
  const feeHookRuntimeCodeHash = asBytes32(
    historical?.runtimeCodeHashes?.ethCreatorFeeHook,
  );
  const deploymentBlockValue = historical?.deploymentBlocks?.memeLaunch;
  if (
    historical?.releaseVersion !== "classic-v1" ||
    !launcher ||
    !feeHook ||
    !launcherRuntimeCodeHash ||
    !feeHookRuntimeCodeHash ||
    typeof deploymentBlockValue !== "number" ||
    !Number.isSafeInteger(deploymentBlockValue) ||
    deploymentBlockValue < 0
  ) {
    throw new Error(
      "Historical creator claim deployment is not manifest verified",
    );
  }
  return [
    {
      ...current,
      releaseVersion: "classic-v1",
      launcher,
      feeHook,
      launcherRuntimeCodeHash,
      feeHookRuntimeCodeHash,
      deploymentBlock: BigInt(deploymentBlockValue),
    },
    current,
  ];
}

/**
 * Historical reads use the same commitment-bound pair. The shared failover
 * runner permits one complete secondary attempt only after an eligible
 * primary transport, capacity or archive failure.
 */
export function getWebsiteChartOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  return getWebsiteReadOnchainDeployment(environment);
}

export function getPublicOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  try {
    return getOperationalOnchainDeployment(environment);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Production operations require two distinct authenticated RPC URLs"
    ) {
      const deployment = getOnchainDeployment(environment);
      return {
        ...deployment,
        status: "not-deployed",
        launcher: null,
        feeHook: null,
        launcherRuntimeCodeHash: null,
        feeHookRuntimeCodeHash: null,
        deploymentBlock: null,
      };
    }
    throw error;
  }
}
