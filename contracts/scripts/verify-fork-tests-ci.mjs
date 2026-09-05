import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const contractsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const endpointAttemptTimeoutMs = 90_000;

const chains = [
  {
    name: "Ethereum mainnet",
    environmentKey: "ETHEREUM_RPC_URL",
    testGlobs: [
      "test/{AdaptiveCurveLaunchMainnetFork.t.sol,AdaptiveCurveMainnetFork.t.sol,ClassicV3MainnetFork.t.sol,DeepV3CanaryBatchMainnetFork.t.sol,DeployClassicV3InfrastructureV1Mainnet.t.sol,DeployClassicV4InfrastructureV1Mainnet.t.sol,DeployMainnetAdaptiveInfrastructureV1.t.sol,DeployMainnetDeepFullRangeInfrastructureV1.t.sol,DeployMainnetDeepFullRangeInfrastructureV2.t.sol,DeployMainnetDeepFullRangeInfrastructureV2Security.t.sol,DeployMainnetDeepFullRangeInfrastructureV3.t.sol,DeployMainnetDeepFullRangeInfrastructureV3Security.t.sol,DeployMainnetDeepKeeperExecutorV1.t.sol,DeployMainnetMemeInfrastructureV1.t.sol,DeployMainnetMemeInfrastructureV2.t.sol,DeployMainnetProtocolRevenueV1.t.sol,DeployMainnetStockPairedInfrastructureV1.t.sol,DeployMainnetStockPairedInfrastructureV2.t.sol,DeployMainnetStockPairedInfrastructureV3.t.sol,EthereumDeploymentSnapshot.t.sol,LiquidityGrowthFullRangeMainnetFork.t.sol,LiquidityGrowthFullRangeV2MainnetFork.t.sol,LiquidityGrowthFullRangeV3MainnetFork.t.sol,LiquidityGrowthVaultMainnetFork.t.sol,MainnetMemeLifecycleFork.t.sol,ProtocolRevenueRouterV1MainnetFork.t.sol,StockPairedMainnetFork.t.sol,StockPairedV2DeployedMainnetFork.t.sol,StockPairedV3MainnetFork.t.sol,invariant/ProtocolRevenueRouterV1Invariant.t.sol}",
      "test/CustomRegistryV2SafeAtomicBatchMainnetFork.t.sol",
      "test/CustomRegistryV2SafePublicMigrationMainnetFork.t.sol",
    ],
    publicEndpoints: [
      // The full mainnet suite passed here in both 2026-09-05 release runs;
      // trying it first avoids their five failed public-provider attempts.
      // Keep every fallback and the complete per-provider test sequence.
      "https://mainnet.gateway.tenderly.co",
      "https://eth-mainnet.public.blastapi.io",
      "https://rpc.mevblocker.io",
      "https://rpc.flashbots.net",
      "https://eth.api.onfinality.io/public",
      "https://eth.merkle.io",
      "https://eth.drpc.org",
    ],
  },
  {
    name: "Ethereum Sepolia",
    environmentKey: "SEPOLIA_RPC_URL",
    testGlobs: [
      "test/{DeployClassicV3InfrastructureV1Sepolia.t.sol,DeployClassicV4InfrastructureV1Sepolia.t.sol,DeploySepoliaInfrastructureV1.t.sol,DeploySepoliaMemeInfrastructureV1.t.sol,DeploySepoliaMemeInfrastructureV2.t.sol,EthereumSepoliaDeploymentSnapshot.t.sol}",
    ],
    publicEndpoints: [
      "https://sepolia.gateway.tenderly.co",
      "https://sepolia.drpc.org",
    ],
  },
];

for (const chain of chains) {
  const configuredEndpoint = process.env[chain.environmentKey]?.trim();
  const endpoints = configuredEndpoint
    ? [configuredEndpoint]
    : chain.publicEndpoints;

  let passed = false;

  for (const [index, endpoint] of endpoints.entries()) {
    const endpointLabel = configuredEndpoint
      ? "configured endpoint"
      : `public endpoint ${index + 1}`;

    console.log(`Running ${chain.name} fork tests with ${endpointLabel}`);

    let result = { status: 0 };
    for (const testGlob of chain.testGlobs) {
      result = spawnSync("forge", ["test", "--match-path", testGlob], {
        cwd: contractsDirectory,
        env: {
          ...process.env,
          [chain.environmentKey]: endpoint,
        },
        stdio: "inherit",
        timeout: endpointAttemptTimeoutMs,
      });
      if (result.status !== 0) break;
    }

    if (result.status === 0) {
      passed = true;
      break;
    }

    if (configuredEndpoint) {
      break;
    }

    if (result.error?.code === "ETIMEDOUT") {
      console.warn(
        `${chain.name} fork tests timed out with ${endpointLabel} after ${endpointAttemptTimeoutMs / 1_000} seconds`,
      );
    }

    console.warn(
      `${chain.name} fork tests failed with ${endpointLabel}; trying the next endpoint`,
    );
  }

  if (!passed) {
    console.error(
      `${chain.name} fork tests failed on every configured endpoint`,
    );
    process.exit(1);
  }
}
