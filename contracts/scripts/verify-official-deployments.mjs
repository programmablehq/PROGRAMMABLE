import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  OFFICIAL_DEPLOYMENTS_URL,
  REQUIRED_SOURCE_DEPENDENCIES,
  fetchMainnetRuntimeHashesWithFallback,
  verifyDependencyPins,
  verifyMainnetRuntimeHashes,
  verifyOfficialDeploymentSnapshot,
} from "./verify-official-deployments-lib.mjs";

const EXPECTED_DATASET_REPOSITORY = "https://github.com/Uniswap/contracts";
const execFile = promisify(execFileCallback);

const dependencyDirectory = fileURLToPath(
  new URL("../dependencies/", import.meta.url),
);
const libraryDirectory = fileURLToPath(
  new URL("../lib/", import.meta.url),
);
const sourcePinsFile = fileURLToPath(
  new URL("../dependencies/source-pins.json", import.meta.url),
);

const networks = [
  {
    file: "ethereum-mainnet.json",
    requiredKeys: [
      "poolManager",
      "positionManager",
      "stateView",
      "v4Quoter",
      "feeOnTransferDetector",
      "erc7914Detector",
      "permit2",
      "universalRouter",
      "continuousClearingAuctionFactory",
      "liquidityLauncher",
      "lbpStrategy",
      "tokenSplitter",
      "uerc20Factory",
    ],
  },
  {
    file: "ethereum-sepolia.json",
    requiredKeys: [
      "poolManager",
      "positionManager",
      "stateView",
      "v4Quoter",
      "permit2",
      "universalRouter",
      "continuousClearingAuctionFactory",
      "liquidityLauncher",
      "lbpStrategy",
      "tokenSplitter",
      "uerc20Factory",
    ],
  },
];

const officialRecordByKey = {
  poolManager: { protocol: "v4", contract: "PoolManager" },
  positionManager: { protocol: "v4", contract: "PositionManager" },
  stateView: { protocol: "v4", contract: "StateView" },
  v4Quoter: { protocol: "v4", contract: "V4Quoter" },
  feeOnTransferDetector: {
    protocol: "v4",
    contract: "FeeOnTransferDetector",
  },
  erc7914Detector: { protocol: "v4", contract: "ERC7914Detector" },
  permit2: { protocol: "permit2", contract: "Permit2" },
  universalRouter: {
    protocol: "universal-router",
    contract: "UniversalRouter",
  },
  continuousClearingAuctionFactory: {
    protocol: "liquidity-launchpad",
    contract: "ContinuousClearingAuctionFactory",
  },
  liquidityLauncher: {
    protocol: "liquidity-launchpad",
    contract: "LiquidityLauncher",
  },
  lbpStrategy: {
    protocol: "liquidity-launchpad",
    contract: "LBPStrategy",
  },
  tokenSplitter: {
    protocol: "liquidity-launchpad",
    contract: "TokenSplitter",
  },
  uerc20Factory: {
    protocol: "liquidity-launchpad",
    contract: "UERC20Factory",
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeSourceRef(sourceRef) {
  return sourceRef
    .toLowerCase()
    .replace(/^(?:v4-core|v4-periphery)@/, "");
}

function versionMatches(sourceRef, version) {
  const normalizedVersion = version.replace(/^v/, "");
  const normalizedSourceRef = sourceRef.replace(/^v/, "");
  return (
    normalizedSourceRef === normalizedVersion ||
    normalizedSourceRef.startsWith(`${normalizedVersion}.`)
  );
}

function repositoryName(repository) {
  const pathname = new URL(repository).pathname.replace(/\/$/, "");
  return pathname.split("/").at(-1).replace(/\.git$/, "").toLowerCase();
}

async function gitOutput(args, options = {}) {
  const { stdout } = await execFile("git", args, options);
  return stdout.trim();
}

const response = await fetch(OFFICIAL_DEPLOYMENTS_URL, {
  headers: { accept: "application/json" },
});

assert(
  response.ok,
  `Official deployment dataset returned HTTP ${response.status}`,
);

const dataset = await response.json();

assert(dataset.version === "1.0.0", `Unsupported dataset ${dataset.version}`);
assert(
  dataset.source?.repo === EXPECTED_DATASET_REPOSITORY,
  "Unexpected deployment dataset source repository",
);
assert(Array.isArray(dataset.records), "Deployment records are missing");

let verifiedCount = 0;
let mainnetSnapshot;
const reviewWarnings = [];

for (const network of networks) {
  const snapshot = JSON.parse(
    await readFile(`${dependencyDirectory}${network.file}`, "utf8"),
  );

  assert(
    snapshot.source?.deployments === OFFICIAL_DEPLOYMENTS_URL,
    `${network.file} points to an unexpected deployment source`,
  );
  if (network.file === "ethereum-mainnet.json") {
    mainnetSnapshot = snapshot;
    const verification = verifyOfficialDeploymentSnapshot({
      dataset,
      snapshot,
    });
    reviewWarnings.push(...verification.reviewWarnings);
  } else {
    if (snapshot.source?.generatedAt !== dataset.generatedAt) {
      reviewWarnings.push(
        `${network.file} dataset timestamp drift: pinned ${snapshot.source?.generatedAt}, upstream ${dataset.generatedAt}`,
      );
    }
    if (snapshot.source?.sourceCommit !== dataset.source.commit) {
      reviewWarnings.push(
        `${network.file} dataset commit drift: pinned ${snapshot.source?.sourceCommit}, upstream ${dataset.source.commit}`,
      );
    }
  }

  for (const key of network.requiredKeys) {
    const local = snapshot.contracts[key];
    const identity = officialRecordByKey[key];

    assert(local, `${network.file} is missing ${key}`);
    assert(identity, `No official record mapping exists for ${key}`);

    const official = dataset.records.find(
      (record) =>
        record.chainId === snapshot.chainId &&
        record.protocol === identity.protocol &&
        record.contract === identity.contract,
    );

    assert(
      official,
      `No official ${identity.contract} record exists for chain ${snapshot.chainId}`,
    );
    assert(
      official.status === "active",
      `${official.id} is ${official.status}, not active`,
    );
    assert(
      official.address.toLowerCase() === local.address.toLowerCase(),
      `${key} address mismatch on ${network.file}`,
    );
    assert(
      official.sourceRepo?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has an unexpected source repository`,
    );
    assert(
      official.sourceCodeUrl?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has no official source code link`,
    );

    if (local.sourceRef) {
      assert(
        normalizeSourceRef(official.sourceRef) ===
          normalizeSourceRef(local.sourceRef),
        `${key} source reference mismatch on ${network.file}`,
      );
    }

    if (local.version) {
      assert(
        versionMatches(official.sourceRef, local.version),
        `${key} version mismatch on ${network.file}`,
      );
    }

    verifiedCount += 1;
  }
}

assert(mainnetSnapshot, "Mainnet dependency snapshot is missing");
const configuredRpcUrl = process.env.ETHEREUM_MAINNET_RPC_URL;
const rpcUrls = configuredRpcUrl !== undefined
  ? [configuredRpcUrl]
  : [...new Set(["https://mainnet.gateway.tenderly.co", mainnetSnapshot.runtimeSnapshot?.rpc].filter(Boolean))];
assert(rpcUrls.every(Boolean), "ETHEREUM_MAINNET_RPC_URL is required");

const runtimeSnapshot = await fetchMainnetRuntimeHashesWithFallback({
  snapshot: mainnetSnapshot,
  rpcUrls,
});
const runtimeVerification = verifyMainnetRuntimeHashes({
  snapshot: mainnetSnapshot,
  runtimeCodeHashes: runtimeSnapshot.runtimeCodeHashes,
});

const sourcePins = JSON.parse(await readFile(sourcePinsFile, "utf8"));
const dependencyStates = {};
await Promise.all(
  REQUIRED_SOURCE_DEPENDENCIES.map(async (dependency) => {
    const pin = sourcePins.dependencies?.find(
      (candidate) => repositoryName(candidate.repository) === dependency,
    );
    assert(pin, `Missing reviewed source pin for ${dependency}`);

    const checkoutDirectory = `${libraryDirectory}${dependency}`;
    const [localCommit, status, remote] = await Promise.all([
      gitOutput(["rev-parse", "HEAD"], { cwd: checkoutDirectory }),
      gitOutput(
        ["status", "--porcelain", "--untracked-files=all"],
        { cwd: checkoutDirectory },
      ),
      gitOutput(["ls-remote", pin.repository, "HEAD"]),
    ]);
    const upstreamCommit = remote.split(/\s+/)[0];
    dependencyStates[dependency] = {
      localCommit: localCommit.toLowerCase(),
      upstreamCommit: upstreamCommit?.toLowerCase(),
      dirty: status.length > 0,
    };
  }),
);
const dependencyVerification = verifyDependencyPins({
  sourcePins,
  dependencyStates,
});
reviewWarnings.push(...dependencyVerification.reviewWarnings);

console.log(
  `Verified ${verifiedCount} active contracts against Uniswap deployments ${dataset.generatedAt}`,
);
console.log(`Dataset commit ${dataset.source.commit}`);
console.log(
  `Verified ${runtimeVerification.verifiedCount} canonical Mainnet runtime hashes at block ${runtimeSnapshot.blockNumber}`,
);
console.log(
  `Verified ${dependencyVerification.verifiedCount} reviewed dependency pins against clean local checkouts`,
);
for (const [dependency, commit] of Object.entries(
  dependencyVerification.pinnedCommits,
)) {
  console.log(`Pinned ${dependency}@${commit}`);
}
for (const warning of new Set(reviewWarnings)) {
  console.warn(`REVIEW REQUIRED: ${warning}`);
}
