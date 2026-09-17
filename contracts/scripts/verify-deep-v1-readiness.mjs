#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";
import {
  HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT,
  readHistoricalMainnetDependencySnapshot,
} from "./historical-mainnet-dependency-snapshot.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contractsDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(contractsDirectory, "..");

const EIP_170_RUNTIME_LIMIT = 24_576;
const EIP_3860_INITCODE_LIMIT = 49_152;
const THIN_RUNTIME_MARGIN = 2_048;

const expectedCompiler = {
  version: "0.8.26+commit.8a97fa7a",
  optimizerEnabled: true,
  optimizerRuns: 1_000,
  evmVersion: "cancun",
  viaIR: false,
  bytecodeHash: "none",
  appendCBOR: false,
};

const components = [
  {
    name: "FeeSplitVaultFactoryV1",
    source: "src/FeeSplitVaultFactoryV1.sol",
    constructorTypes: [],
    deployment: "global-create",
  },
  {
    name: "FeeSplitVaultV1",
    source: "src/FeeSplitVaultV1.sol",
    constructorTypes: ["address", "bytes32", "address[]", "uint16[]"],
    deployment: "per-token-create2",
  },
  {
    name: "LiquidityGrowthFeeOracleHookFactoryV1",
    source: "src/LiquidityGrowthFeeOracleHookFactoryV1.sol",
    constructorTypes: [],
    deployment: "global-create",
  },
  {
    name: "LiquidityGrowthFeeOracleHookV1",
    source: "src/LiquidityGrowthFeeOracleHookV1.sol",
    constructorTypes: ["address", "address", "address", "int24"],
    deployment: "global-create2",
  },
  {
    name: "LiquidityGrowthRangeSourceFactoryV1",
    source: "src/LiquidityGrowthRangeSourceFactoryV1.sol",
    constructorTypes: [],
    deployment: "global-create",
  },
  {
    name: "LiquidityGrowthRangeSourceV1",
    source: "src/LiquidityGrowthRangeSourceV1.sol",
    constructorTypes: [
      "address",
      "tuple",
      "address",
      "uint32",
      "int24",
      "int24",
    ],
    deployment: "per-token-create2",
  },
  {
    name: "LiquidityGrowthVaultFactoryV1",
    source: "src/LiquidityGrowthVaultFactoryV1.sol",
    constructorTypes: [],
    deployment: "global-create",
  },
  {
    name: "LiquidityGrowthVaultV1",
    source: "src/LiquidityGrowthVaultV1.sol",
    constructorTypes: ["address", "address", "tuple"],
    deployment: "per-token-create2",
  },
  {
    name: "LiquidityGrowthLaunchV1",
    source: "src/LiquidityGrowthLaunchV1.sol",
    constructorTypes: Array(8).fill("address"),
    deployment: "global-create",
  },
];

const expectedDependencies = {
  poolManager: {
    address: "0x000000000004444c5dc75cb358380d2e3de08a90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
  positionManager: {
    address: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  },
  uerc20Factory: {
    address: "0x000000e200088d55c39a11f609e5f667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  },
};

const expectedPositionForwarderFactory =
  "0x291a9ff1059d225d02b1659430804486404db507";
const expectedPositionForwarderFactoryRuntimeHash =
  "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2";

const expectedDependencyCommits = {
  "lib/v4-core": "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  "lib/v4-periphery": "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
  "lib/openzeppelin-contracts": "21c8312b022f495ebe3621d5daeed20552b43ff9",
  "lib/openzeppelin-uniswap-hooks": "26dc8e53f812a1ca390d470342adb6cd8c3286ad",
  "lib/liquidity-launcher": "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
  "lib/uerc20-factory": "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
};

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeAddress(address) {
  return String(address).toLowerCase();
}

function byteLength(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("artifact bytecode is not a hex string");
  }
  return (hex.length - 2) / 2;
}

function hasLinkReferences(linkReferences) {
  return Object.values(linkReferences ?? {}).some((byLibrary) =>
    Object.values(byLibrary).some((references) => references.length > 0),
  );
}

function currentCommit(path) {
  return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function validateArtifact(component) {
  const artifactPath = join(
    contractsDirectory,
    "out",
    `${component.name}.sol`,
    `${component.name}.json`,
  );
  if (!existsSync(artifactPath)) {
    fail(`${component.name}: artifact is missing; run forge build`);
    return { name: component.name, artifact: "missing" };
  }

  const artifact = readJson(artifactPath);
  const settings = artifact.metadata?.settings ?? {};
  const metadataSettings = settings.metadata ?? {};
  const target = settings.compilationTarget ?? {};
  const targetName = target[component.source];

  if (artifact.metadata?.compiler?.version !== expectedCompiler.version) {
    fail(`${component.name}: compiler version differs from the release pin`);
  }
  if (
    settings.optimizer?.enabled !== expectedCompiler.optimizerEnabled ||
    settings.optimizer?.runs !== expectedCompiler.optimizerRuns
  ) {
    fail(`${component.name}: optimizer settings differ from the release pin`);
  }
  if (settings.evmVersion !== expectedCompiler.evmVersion) {
    fail(`${component.name}: EVM version differs from the release pin`);
  }
  if (Boolean(settings.viaIR) !== expectedCompiler.viaIR) {
    fail(`${component.name}: viaIR differs from the release pin`);
  }
  if (
    metadataSettings.bytecodeHash !== expectedCompiler.bytecodeHash ||
    metadataSettings.appendCBOR !== expectedCompiler.appendCBOR
  ) {
    fail(`${component.name}: metadata settings differ from the release pin`);
  }
  if (targetName !== component.name) {
    fail(`${component.name}: compilation target is not the expected source`);
  }

  const constructor = artifact.abi?.find(
    (entry) => entry.type === "constructor",
  );
  const constructorTypes =
    constructor?.inputs?.map((input) => input.type) ?? [];
  if (
    JSON.stringify(constructorTypes) !==
    JSON.stringify(component.constructorTypes)
  ) {
    fail(
      `${component.name}: constructor ABI differs from the readiness inventory`,
    );
  }
  if (
    hasLinkReferences(artifact.bytecode?.linkReferences) ||
    hasLinkReferences(artifact.deployedBytecode?.linkReferences)
  ) {
    fail(`${component.name}: unresolved library links are not allowed`);
  }

  let checkedSourceInputs = 0;
  for (const [sourceName, sourceRecord] of Object.entries(
    artifact.metadata?.sources ?? {},
  )) {
    const sourcePath = join(contractsDirectory, sourceName);
    if (!existsSync(sourcePath)) {
      fail(`${component.name}: compiler input ${sourceName} is missing`);
      continue;
    }
    const actualHash = keccak256(
      new Uint8Array(readFileSync(sourcePath)),
    ).toLowerCase();
    if (actualHash !== String(sourceRecord.keccak256).toLowerCase()) {
      fail(`${component.name}: artifact is stale for ${sourceName}`);
    }
    checkedSourceInputs += 1;
  }

  const initCode = artifact.bytecode.object;
  const runtimeTemplate = artifact.deployedBytecode.object;
  const initCodeBytes = byteLength(initCode);
  const runtimeBytes = byteLength(runtimeTemplate);
  const initCodeMargin = EIP_3860_INITCODE_LIMIT - initCodeBytes;
  const runtimeMargin = EIP_170_RUNTIME_LIMIT - runtimeBytes;

  if (initCodeMargin < 0) {
    fail(
      `${component.name}: initcode exceeds EIP-3860 by ${-initCodeMargin} bytes`,
    );
  }
  if (runtimeMargin < 0) {
    fail(
      `${component.name}: runtime exceeds EIP-170 by ${-runtimeMargin} bytes`,
    );
  } else if (runtimeMargin < THIN_RUNTIME_MARGIN) {
    warn(
      `${component.name}: only ${runtimeMargin} bytes remain below the EIP-170 limit`,
    );
  }

  return {
    name: component.name,
    source: component.source,
    deployment: component.deployment,
    constructorTypes,
    compilerInputCount: checkedSourceInputs,
    initCodeBytes,
    initCodeMargin,
    runtimeTemplateBytes: runtimeBytes,
    runtimeMargin,
    initCodeHash: keccak256(initCode),
    runtimeTemplateHash: keccak256(runtimeTemplate),
    immutableReferenceGroups: Object.keys(
      artifact.deployedBytecode?.immutableReferences ?? {},
    ).length,
  };
}

const dependencySnapshot = readHistoricalMainnetDependencySnapshot();
if (dependencySnapshot.chainId !== 1) {
  fail("official dependency snapshot is not Ethereum mainnet");
}
for (const [name, expected] of Object.entries(expectedDependencies)) {
  const record = dependencySnapshot.contracts?.[name];
  if (!record) {
    fail(`official dependency snapshot is missing ${name}`);
    continue;
  }
  if (normalizeAddress(record.address) !== expected.address) {
    fail(`${name}: address differs from the approved mainnet dependency`);
  }
  if (
    String(record.runtimeCodeHash).toLowerCase() !== expected.runtimeCodeHash
  ) {
    fail(`${name}: runtime code hash differs from the pinned snapshot`);
  }
}

const classicManifestPath = join(
  contractsDirectory,
  "deployments",
  "mainnet-classic-v2.json",
);
const classicManifest = readJson(classicManifestPath);
if (classicManifest.chainId !== 1) {
  fail("Classic V2 provenance manifest is not Ethereum mainnet");
}
if (classicManifest.status !== "deployment-and-source-verified") {
  fail("Classic V2 provenance manifest is not deployment-and-source-verified");
}
if (
  normalizeAddress(classicManifest.addresses?.positionForwarderFactory) !==
  expectedPositionForwarderFactory
) {
  fail(
    "reused position-forwarder factory address differs from the release pin",
  );
}
if (
  !/^0x[0-9a-fA-F]{64}$/.test(
    classicManifest.runtimeCodeHashes?.positionForwarderFactory ?? "",
  )
) {
  fail("reused position-forwarder factory runtime code hash is missing");
} else if (
  classicManifest.runtimeCodeHashes.positionForwarderFactory.toLowerCase() !==
  expectedPositionForwarderFactoryRuntimeHash
) {
  fail(
    "reused position-forwarder factory runtime hash differs from the release pin",
  );
}

const dependencyCommits = {};
for (const [relativePath, expectedCommit] of Object.entries(
  expectedDependencyCommits,
)) {
  const dependencyPath = join(contractsDirectory, relativePath);
  try {
    const actualCommit = currentCommit(dependencyPath);
    dependencyCommits[relativePath] = actualCommit;
    if (actualCommit !== expectedCommit) {
      fail(`${relativePath}: dependency commit differs from the release pin`);
    }
  } catch {
    fail(`${relativePath}: dependency commit could not be read`);
  }
}

let repositoryCommit = null;
let worktreeChanges = [];
try {
  repositoryCommit = currentCommit(repositoryDirectory);
  worktreeChanges = execFileSync(
    "git",
    ["-C", repositoryDirectory, "status", "--short"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (worktreeChanges.length > 0) {
    fail("release candidate worktree is not clean");
  }
} catch {
  fail("release candidate Git state could not be read");
}

const artifacts = components.map(validateArtifact);
const report = {
  model: "deep",
  internalRelease: "liquidity-growth-v1",
  mode: "read-only-static-validation",
  status: failures.length === 0 ? "static-checks-pass" : "blocked",
  repositoryCommit,
  worktreeChanges,
  compiler: expectedCompiler,
  limits: {
    eip170RuntimeBytes: EIP_170_RUNTIME_LIMIT,
    eip3860InitcodeBytes: EIP_3860_INITCODE_LIMIT,
    thinRuntimeMarginBytes: THIN_RUNTIME_MARGIN,
  },
  officialDependencySnapshot: {
    file: HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT.file,
    sha256: HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT.sha256,
    source: dependencySnapshot.source,
    runtimeSnapshot: dependencySnapshot.runtimeSnapshot,
    constructorDependencies: Object.fromEntries(
      Object.keys(expectedDependencies).map((name) => [
        name,
        dependencySnapshot.contracts[name],
      ]),
    ),
    applicationOnlyDependencies: {
      stateView: dependencySnapshot.contracts.stateView,
      v4Quoter: dependencySnapshot.contracts.v4Quoter,
      permit2: dependencySnapshot.contracts.permit2,
      universalRouter: dependencySnapshot.contracts.universalRouter,
    },
  },
  reusedProgrammableDependencies: {
    positionForwarderFactory: {
      address: classicManifest.addresses?.positionForwarderFactory,
      runtimeCodeHash:
        classicManifest.runtimeCodeHashes?.positionForwarderFactory,
      provenanceManifest: "deployments/mainnet-classic-v2.json",
      provenanceStatus: classicManifest.status,
    },
  },
  dependencyCommits,
  artifacts,
  warnings,
  failures,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
