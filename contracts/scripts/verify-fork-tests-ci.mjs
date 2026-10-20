import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const contractsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const endpointAttemptTimeoutMs = 90_000;

export const chains = [
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
  {
    name: "Base mainnet",
    environmentKey: "BASE_RPC_URL",
    testGlobs: ["test/base-custom-v1/BaseLaunchLifecycleFork.t.sol"],
    publicEndpoints: ["https://base-rpc.publicnode.com", "https://base.drpc.org"],
  },
];

// A provider timeout must not kill a healthy 30-file batch that is still
// producing successful suites. Keep the same per-process bound and run every
// original source file in smaller complete groups, without lowering test budgets.
export function splitForkTestGlob(glob) {
  const match = /^test\/\{([^{}]+)\}$/u.exec(glob);
  const files = match ? match[1].split(",").map((file) => "test/" + file) : [glob];
  if (files.some((file) => !/^test\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.t\.sol$/u.test(file))
    || new Set(files).size !== files.length) throw new Error("Invalid explicit fork test inventory.");
  if (files.length <= 10) return [glob];
  const groups = Array.from({ length: Math.ceil(files.length / 10) }, () => []);
  // Interleave related deployment suites so the expensive Stock-Paired and
  // liquidity suites do not all land in the last group of a sorted inventory.
  files.forEach((file, index) => groups[index % groups.length].push(file));
  return groups.map((group) => group.length === 1 ? group[0]
    : "test/{" + group.map((file) => file.slice(5)).join(",") + "}");
}

export function runForkTests({ environment = process.env, run = spawnSync, logger = console } = {}) {
  for (const chain of chains) {
    const configuredEndpoint = environment[chain.environmentKey]?.trim();
    const endpoints = configuredEndpoint ? [configuredEndpoint] : chain.publicEndpoints;
    const testGroups = chain.testGlobs.flatMap(splitForkTestGlob);
    let passed = false;

    for (const [index, endpoint] of endpoints.entries()) {
      const endpointLabel = configuredEndpoint ? "configured endpoint" : `public endpoint ${index + 1}`;
      logger.log(`Running ${chain.name} fork tests with ${endpointLabel}`);
      let result = { status: 0 };
      for (const [groupIndex, testGlob] of testGroups.entries()) {
        logger.log(`Running ${chain.name} fork group ${groupIndex + 1}/${testGroups.length}`);
        result = run("forge", ["test", "--match-path", testGlob], {
          cwd: contractsDirectory,
          env: { ...environment, [chain.environmentKey]: endpoint },
          stdio: "inherit",
          timeout: endpointAttemptTimeoutMs,
        });
        if (result.status !== 0) break;
      }
      if (result.status === 0) {
        passed = true;
        break;
      }
      if (configuredEndpoint) break;
      if (result.error?.code === "ETIMEDOUT") {
        logger.warn(`${chain.name} fork group timed out with ${endpointLabel} after ${endpointAttemptTimeoutMs / 1_000} seconds`);
      }
      logger.warn(`${chain.name} fork tests failed with ${endpointLabel}; trying the next endpoint`);
    }
    if (!passed) {
      logger.error(`${chain.name} fork tests failed on every configured endpoint`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runForkTests();
}
