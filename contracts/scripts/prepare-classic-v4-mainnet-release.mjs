#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER,
  CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
  CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  CLASSIC_V4_SHARED_DEPENDENCIES,
  buildClassicV4PreparationPlan,
  canonicalAddress,
  canonicalNonzeroAddress,
  computeClassicV4BuildCommitments,
  digestJson,
  loadClassicV4ArtifactsFromOutput,
  normalizeHex,
  validateClassicV4PreparationPlan,
} from "../../scripts/classic-v4-release-core.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
const REQUEST_TIMEOUT_MS = 15_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const contractsRoot = path.join(repositoryRoot, "contracts");
const sourcePinsPath = path.join(
  contractsRoot,
  "dependencies/source-pins.json",
);
const EXPECTED_LOCAL_PIN_IDENTITIES = Object.freeze({
  blocknumberish: Object.freeze({
    name: "BlockNumberish",
    repository: "https://github.com/Uniswap/blocknumberish.git",
  }),
  "continuous-clearing-auction": Object.freeze({
    name: "Uniswap Continuous Clearing Auction",
    repository:
      "https://github.com/Uniswap/continuous-clearing-auction.git",
  }),
  "forge-std": Object.freeze({
    name: "Forge Standard Library",
    repository: "https://github.com/foundry-rs/forge-std.git",
  }),
  "liquidity-launcher": Object.freeze({
    name: "Uniswap Liquidity Launcher",
    repository: "https://github.com/Uniswap/liquidity-launcher.git",
  }),
  "openzeppelin-contracts": Object.freeze({
    name: "OpenZeppelin Contracts",
    repository: "https://github.com/OpenZeppelin/openzeppelin-contracts.git",
  }),
  "openzeppelin-uniswap-hooks": Object.freeze({
    name: "OpenZeppelin Uniswap Hooks",
    repository: "https://github.com/OpenZeppelin/uniswap-hooks.git",
  }),
  permit2: Object.freeze({
    name: "Permit2",
    repository: "https://github.com/Uniswap/permit2.git",
  }),
  solady: Object.freeze({
    name: "Solady",
    repository: "https://github.com/Vectorized/solady.git",
  }),
  solmate: Object.freeze({
    name: "Solmate",
    repository: "https://github.com/transmissions11/solmate.git",
  }),
  "uerc20-factory": Object.freeze({
    name: "Uniswap UERC20 Factory",
    repository: "https://github.com/Uniswap/uerc20-factory.git",
  }),
  "universal-router": Object.freeze({
    name: "Uniswap Universal Router 2.1.1",
    repository: "https://github.com/Uniswap/universal-router.git",
  }),
  "v4-core": Object.freeze({
    name: "Uniswap v4 Core",
    repository: "https://github.com/Uniswap/v4-core.git",
  }),
  "v4-periphery": Object.freeze({
    name: "Uniswap v4 Periphery",
    repository: "https://github.com/Uniswap/v4-periphery.git",
  }),
  "v4-periphery-v211": Object.freeze({
    name: "Uniswap v4 Periphery for Universal Router 2.1.1",
    repository: "https://github.com/Uniswap/v4-periphery.git",
  }),
});
const EXPECTED_NONLOCAL_PIN = Object.freeze({
  name: "Uniswap Liquidity Launcher SDK 1.0.1",
  repository: "https://github.com/Uniswap/sdks.git",
});

const ctoAuthorityAbi = parseAbi([
  "function authority() view returns (address)",
  "function pendingAuthority() view returns (address)",
]);
const rewardVaultFactoryAbi = parseAbi([
  "function ctoAuthority() view returns (address)",
]);
const custodyFactoryAbi = parseAbi([
  "function MIN_DURATION_DAYS() view returns (uint16)",
  "function MAX_DURATION_DAYS() view returns (uint16)",
]);
const launchPolicyAbi = parseAbi([
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
]);
const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function OPERATOR() view returns (address)",
  "function TIMELOCK_BLOCK() view returns (uint256)",
]);

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    !actual.every((key, index) => key === wanted[index])
  ) {
    fail(`${label} keys differ`);
  }
}

export function assertCleanClassicV4FoundryEnvironment(
  environment = process.env,
) {
  const forbidden = Object.keys(environment).find((key) => {
    const normalized = key.toUpperCase();
    return (
      normalized.startsWith("FOUNDRY_") ||
      normalized.startsWith("DAPP_") ||
      normalized === "REMAPPINGS" ||
      normalized === "SOLC_PATH" ||
      normalized === "SOLC_VERSION"
    );
  });
  if (forbidden) {
    fail(`Inherited build override ${forbidden} is forbidden`);
  }
  if (typeof environment.PATH !== "string" || environment.PATH.length === 0) {
    fail("A controlled build PATH is required");
  }
}

function controlledBuildEnvironment(environment) {
  const controlled = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (typeof environment[key] === "string") controlled[key] = environment[key];
  }
  controlled.NO_COLOR = "1";
  return controlled;
}

export function verifyClassicV4SourcePins({
  sourcePins,
  localDirectories,
  dependencyRoots,
  dependencyGitStates,
  contractsDirectory = contractsRoot,
}) {
  assertExactKeys(sourcePins, ["schemaVersion", "dependencies"], "source pins");
  if (sourcePins.schemaVersion !== 1 || !Array.isArray(sourcePins.dependencies)) {
    fail("Source pins schema is invalid");
  }
  const expectedDirectories = Object.keys(EXPECTED_LOCAL_PIN_IDENTITIES).sort();
  const actualDirectories = [...localDirectories].sort();
  if (
    actualDirectories.length !== expectedDirectories.length ||
    !actualDirectories.every(
      (directory, index) => directory === expectedDirectories[index],
    )
  ) {
    fail("Local dependency directories differ from the pinned closure");
  }
  if (sourcePins.dependencies.length !== expectedDirectories.length + 1) {
    fail("Source pin dependency set differs");
  }
  const matchedNames = new Set();
  for (const dependency of sourcePins.dependencies) {
    assertExactKeys(
      dependency,
      ["name", "repository", "commit"],
      "source pin dependency",
    );
    if (
      !/^[0-9a-f]{40}$/.test(dependency.commit) ||
      dependency.commit === "0".repeat(40)
    ) {
      fail(`Invalid source pin commit for ${dependency.name}`);
    }
    const identity = [
      ...Object.values(EXPECTED_LOCAL_PIN_IDENTITIES),
      EXPECTED_NONLOCAL_PIN,
    ].find(
      (expected) =>
        dependency.name === expected.name &&
        dependency.repository === expected.repository,
    );
    if (!identity || matchedNames.has(identity.name)) {
      fail("Source pin identity set differs");
    }
    matchedNames.add(identity.name);
  }
  const roots = [...dependencyRoots].sort();
  if (
    roots.length === 0 ||
    roots.some((root) => !expectedDirectories.includes(root))
  ) {
    fail("Compiled dependency closure is not covered by source pins");
  }
  for (const root of roots) {
    const expectedIdentity = EXPECTED_LOCAL_PIN_IDENTITIES[root];
    const pin = sourcePins.dependencies.find(
      (dependency) =>
        dependency.name === expectedIdentity.name &&
        dependency.repository === expectedIdentity.repository,
    );
    const gitState = dependencyGitStates?.[root];
    if (
      gitState?.topLevel !== path.join(contractsDirectory, "lib", root) ||
      gitState?.head !== pin.commit ||
      gitState?.clean !== true ||
      gitState?.remoteUrl !== pin.repository
    ) {
      fail(`Pinned Git checkout differs for ${root}`);
    }
  }
  return digestJson(sourcePins, CLASSIC_V4_DIGEST_DOMAINS.sourcePins);
}

async function readDependencyGitState(root) {
  const directory = path.join(contractsRoot, "lib", root);
  try {
    const [{ stdout: topLevel }, { stdout: head }, { stdout: statusOutput }, { stdout: remoteUrl }] =
      await Promise.all([
        execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: directory }),
        execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory }),
        execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
          cwd: directory,
        }),
        execFileAsync("git", ["remote", "get-url", "origin"], { cwd: directory }),
      ]);
    return {
      topLevel: topLevel.trim(),
      head: head.trim().toLowerCase(),
      clean: statusOutput.trim() === "",
      remoteUrl: remoteUrl.trim(),
    };
  } catch {
    fail(`Pinned dependency ${root} is not a readable Git checkout`);
  }
}

async function readDependencyGitStates(roots) {
  return Object.fromEntries(
    await Promise.all(
      roots.map(async (root) => [root, await readDependencyGitState(root)]),
    ),
  );
}

export async function compileClassicV4FreshArtifacts({
  environment = process.env,
  execute = execFileAsync,
  createTemporaryDirectory = mkdtemp,
  removeTemporaryDirectory = rm,
  artifactLoader = loadClassicV4ArtifactsFromOutput,
  contractsDirectory = contractsRoot,
  temporaryParent = tmpdir(),
} = {}) {
  assertCleanClassicV4FoundryEnvironment(environment);
  const temporaryRoot = await createTemporaryDirectory(
    path.join(temporaryParent, "classic-v4-release-build-"),
  );
  const outputDirectory = path.join(temporaryRoot, "out");
  const cacheDirectory = path.join(temporaryRoot, "cache");
  try {
    await execute(
      "forge",
      [
        "build",
        "--force",
        "--offline",
        "--no-auto-detect",
        "--use",
        "0.8.26",
        "--evm-version",
        "cancun",
        "--optimize",
        "true",
        "--optimizer-runs",
        "1000",
        "--no-metadata",
        "--root",
        contractsDirectory,
        "--config-path",
        path.join(contractsDirectory, "foundry.toml"),
        "--out",
        outputDirectory,
        "--cache-path",
        cacheDirectory,
        "src/EthCreatorFeeHookFactoryV4.sol",
        "src/EthCreatorFeeHookV4.sol",
        "src/ClassicPositionPlannerV1.sol",
        "src/MemeLaunchV3.sol",
      ],
      {
        cwd: contractsDirectory,
        env: controlledBuildEnvironment(environment),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return await artifactLoader(outputDirectory);
  } finally {
    await removeTemporaryDirectory(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; this operator never signs or broadcasts`,
    );
  }
  const parsed = {
    deployer: null,
    rpcA: process.env.CLASSIC_V4_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: process.env.CLASSIC_V4_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      parsed.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const takesValue = [
      "--deployer",
      "--rpc-a",
      "--rpc-b",
      "--output",
      "--wallet",
      "--acknowledge-plan-digest",
    ].includes(key);
    if (!takesValue) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--deployer") parsed.deployer = value;
    if (key === "--rpc-a") parsed.rpcA = value;
    if (key === "--rpc-b") parsed.rpcB = value;
    if (key === "--output") parsed.output = value;
    if (key === "--wallet") parsed.wallet = value;
    if (key === "--acknowledge-plan-digest") {
      parsed.acknowledgement = value;
    }
  }
  if (!parsed.deployer) fail("--deployer is required");
  return parsed;
}

function assertHttpsEndpoints(endpoints) {
  const hostnames = new Set();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      fail("RPC endpoints must be valid URLs");
    }
    if (parsed.protocol !== "https:") {
      fail("RPC endpoints must use HTTPS");
    }
    if (parsed.username || parsed.password) {
      fail("RPC endpoint credentials must not be embedded in URLs");
    }
    hostnames.add(parsed.hostname.toLowerCase());
  }
  if (hostnames.size !== endpoints.length) {
    fail("Two independent Mainnet RPC hostnames are required");
  }
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) fail(`RPC ${method} failed: ${payload.error.message}`);
  if (payload?.result === undefined) fail(`RPC ${method} returned no result`);
  return payload.result;
}

function expectedAddressResult(value) {
  return encodeAbiParameters([{ type: "address" }], [value]);
}

function expectedUintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function bindingChecks() {
  return [
    {
      label: "CTO authority owner",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.ctoAuthority.address,
      data: encodeFunctionData({
        abi: ctoAuthorityAbi,
        functionName: "authority",
      }),
      expected: expectedAddressResult(CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER),
    },
    {
      label: "CTO pending authority",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.ctoAuthority.address,
      data: encodeFunctionData({
        abi: ctoAuthorityAbi,
        functionName: "pendingAuthority",
      }),
      expected: expectedAddressResult(ZERO_ADDRESS),
    },
    {
      label: "reward factory CTO binding",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
      data: encodeFunctionData({
        abi: rewardVaultFactoryAbi,
        functionName: "ctoAuthority",
      }),
      expected: expectedAddressResult(
        CLASSIC_V4_SHARED_DEPENDENCIES.ctoAuthority.address,
      ),
    },
    {
      label: "minimum custody days",
      target:
        CLASSIC_V4_SHARED_DEPENDENCIES.initialBuyVestingWalletFactory.address,
      data: encodeFunctionData({
        abi: custodyFactoryAbi,
        functionName: "MIN_DURATION_DAYS",
      }),
      expected: expectedUintResult(1, "uint16"),
    },
    {
      label: "maximum custody days",
      target:
        CLASSIC_V4_SHARED_DEPENDENCIES.initialBuyVestingWalletFactory.address,
      data: encodeFunctionData({
        abi: custodyFactoryAbi,
        functionName: "MAX_DURATION_DAYS",
      }),
      expected: expectedUintResult(3_650, "uint16"),
    },
    {
      label: "maximum reward beneficiaries",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.launchPolicy.address,
      data: encodeFunctionData({
        abi: launchPolicyAbi,
        functionName: "MAX_REWARD_BENEFICIARIES",
      }),
      expected: expectedUintResult(5),
    },
    {
      label: "reward share basis points",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.launchPolicy.address,
      data: encodeFunctionData({
        abi: launchPolicyAbi,
        functionName: "REWARD_SHARE_BASIS_POINTS",
      }),
      expected: expectedUintResult(10_000, "uint16"),
    },
    {
      label: "forwarder PositionManager binding",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
      data: encodeFunctionData({
        abi: forwarderFactoryAbi,
        functionName: "positionManager",
      }),
      expected: expectedAddressResult(
        CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager.address,
      ),
    },
    {
      label: "forwarder immutable operator",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
      data: encodeFunctionData({
        abi: forwarderFactoryAbi,
        functionName: "OPERATOR",
      }),
      expected: expectedAddressResult(ZERO_ADDRESS),
    },
    {
      label: "forwarder permanent timelock",
      target: CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
      data: encodeFunctionData({
        abi: forwarderFactoryAbi,
        functionName: "TIMELOCK_BLOCK",
      }),
      expected: expectedUintResult(UINT256_MAX),
    },
  ];
}

function assertPinnedV3Manifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.chainId !== 1 ||
    manifest?.internalContractRelease !== "classic-v3" ||
    manifest?.status !== "deployment-source-and-lifecycle-verified"
  ) {
    fail("Classic V3 reuse manifest is not fully verified");
  }
  if (
    normalizeHex(manifest?.addresses?.launcherFeeRecipient) !==
    normalizeHex(CLASSIC_V4_LAUNCHER_FEE_RECIPIENT)
  ) {
    fail("Classic V3 treasury binding drifted");
  }
  for (const [name, expected] of Object.entries(
    CLASSIC_V4_SHARED_DEPENDENCIES,
  )) {
    if (
      normalizeHex(manifest?.addresses?.[name]) !==
        normalizeHex(expected.address) ||
      normalizeHex(manifest?.runtimeCodeHashes?.[name]) !==
        normalizeHex(expected.runtimeCodeHash)
    ) {
      fail(`Classic V3 shared dependency drifted at ${name}`);
    }
  }
  for (const [name, expected] of Object.entries(
    CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  )) {
    const actual = manifest?.officialDependencies?.[name];
    if (
      normalizeHex(actual?.address) !== normalizeHex(expected.address) ||
      normalizeHex(actual?.runtimeCodeHash) !==
        normalizeHex(expected.runtimeCodeHash)
    ) {
      fail(`Official dependency drifted at ${name}`);
    }
  }
}

async function gitIdentity() {
  const [
    { stdout: topLevel },
    { stdout: head },
    { stdout: tree },
    { stdout: statusOutput },
  ] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: repositoryRoot,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
      execFileAsync("git", ["rev-parse", "HEAD^{tree}"], {
        cwd: repositoryRoot,
      }),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: repositoryRoot,
      }),
    ]);
  return {
    repositoryTopLevel: topLevel.trim(),
    releaseCommit: head.trim(),
    releaseTree: tree.trim(),
    repositoryClean: statusOutput.trim() === "",
  };
}

export function assertExactClassicV4RepositoryIdentity(plan, identity) {
  if (
    identity?.repositoryTopLevel !== repositoryRoot ||
    identity?.repositoryClean !== true ||
    identity?.releaseCommit?.toLowerCase() !== plan?.releaseCommit ||
    identity?.releaseTree?.toLowerCase() !== plan?.releaseTree
  ) {
    fail("Current clean Git identity differs from the reviewed plan");
  }
}

export async function loadClassicV4SealedBuild(
  plan,
  {
    environment = process.env,
    identityReader = gitIdentity,
    sourcePinsReader = async () =>
      JSON.parse(await readFile(sourcePinsPath, "utf8")),
    localDirectoryReader = async () =>
      (await readdir(path.join(contractsRoot, "lib"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    dependencyGitStatesReader = readDependencyGitStates,
    artifactBuilder = compileClassicV4FreshArtifacts,
  } = {},
) {
  assertCleanClassicV4FoundryEnvironment(environment);
  const dependencyRoots = Object.keys(EXPECTED_LOCAL_PIN_IDENTITIES).sort();
  const readSealState = async () => {
    const [identity, sourcePins, localDirectories, dependencyGitStates] =
      await Promise.all([
        identityReader(),
        sourcePinsReader(),
        localDirectoryReader(),
        dependencyGitStatesReader(dependencyRoots),
      ]);
    return { identity, sourcePins, localDirectories, dependencyGitStates };
  };

  const beforeBuild = await readSealState();
  assertExactClassicV4RepositoryIdentity(plan, beforeBuild.identity);
  const sourcePinsDigestBeforeBuild = verifyClassicV4SourcePins({
    sourcePins: beforeBuild.sourcePins,
    localDirectories: beforeBuild.localDirectories,
    dependencyRoots,
    dependencyGitStates: beforeBuild.dependencyGitStates,
  });
  if (
    typeof plan?.preflight?.sourcePinsDigest !== "string" ||
    normalizeHex(sourcePinsDigestBeforeBuild) !==
      normalizeHex(plan.preflight.sourcePinsDigest)
  ) {
    fail("Reviewed plan source pins differ from the sealed dependency checkout");
  }

  const artifacts = await artifactBuilder({ environment });
  const afterBuild = await readSealState();
  assertExactClassicV4RepositoryIdentity(plan, afterBuild.identity);
  const sourcePinsDigestAfterBuild = verifyClassicV4SourcePins({
    sourcePins: afterBuild.sourcePins,
    localDirectories: afterBuild.localDirectories,
    dependencyRoots,
    dependencyGitStates: afterBuild.dependencyGitStates,
  });
  if (
    normalizeHex(sourcePinsDigestAfterBuild) !==
      normalizeHex(sourcePinsDigestBeforeBuild)
  ) {
    fail("Source pins changed during the sealed deterministic build");
  }
  validateClassicV4PreparationPlan(plan, artifacts);
  return artifacts;
}

async function runFreshDeterministicBuild(identity) {
  if (
    !identity.repositoryClean ||
    identity.repositoryTopLevel !== repositoryRoot
  ) {
    fail("Release preparation requires a clean worktree before compilation");
  }
  const artifacts = await compileClassicV4FreshArtifacts();
  const afterBuild = await gitIdentity();
  if (
    !afterBuild.repositoryClean ||
    afterBuild.repositoryTopLevel !== identity.repositoryTopLevel ||
    afterBuild.releaseCommit !== identity.releaseCommit ||
    afterBuild.releaseTree !== identity.releaseTree
  ) {
    fail("Git identity changed during the deterministic release build");
  }
  return { identity: afterBuild, artifacts };
}

export async function loadClassicV4SharedObservedBlock(
  endpoints,
  observedAtBlock,
  rpcClient = rpc,
) {
  const requestedTag = `0x${observedAtBlock.toString(16)}`;
  const blocks = await Promise.all(
    endpoints.map((endpoint) =>
      rpcClient(endpoint, "eth_getBlockByNumber", [requestedTag, false]),
    ),
  );
  if (
    blocks.some(
      (block) =>
        !block?.number || Number(BigInt(block.number)) !== observedAtBlock,
    ) ||
    !blocks[0]?.hash ||
    !blocks[1]?.hash ||
    normalizeHex(blocks[0].hash) !== normalizeHex(blocks[1].hash)
  ) {
    fail("Mainnet RPCs disagree on the shared observed block");
  }
  return blocks[0].hash;
}

async function verifiedMainnetSnapshot(endpoints, deployer) {
  const dependencyEntries = [
    ...Object.entries(CLASSIC_V4_OFFICIAL_DEPENDENCIES),
    ...Object.entries(CLASSIC_V4_SHARED_DEPENDENCIES),
  ];
  const snapshots = await Promise.all(
    endpoints.map(async (endpoint) => {
      const [chainId, latest, confirmedNonce, pendingNonce, codes, bindings] =
        await Promise.all([
          rpc(endpoint, "eth_chainId"),
          rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
          rpc(endpoint, "eth_getTransactionCount", [deployer, "latest"]),
          rpc(endpoint, "eth_getTransactionCount", [deployer, "pending"]),
          Promise.all(
            dependencyEntries.map(async ([name, expected]) => {
              const code = await rpc(endpoint, "eth_getCode", [
                expected.address,
                "latest",
              ]);
              if (code === "0x") fail(`${name} has no Mainnet runtime code`);
              const runtimeCodeHash = keccak256(code);
              if (
                normalizeHex(runtimeCodeHash) !==
                normalizeHex(expected.runtimeCodeHash)
              ) {
                fail(`${name} Mainnet runtime code hash drifted`);
              }
              return { name, address: expected.address, runtimeCodeHash };
            }),
          ),
          Promise.all(
            bindingChecks().map(async (check) => {
              const actual = await rpc(endpoint, "eth_call", [
                { to: check.target, data: check.data },
                "latest",
              ]);
              if (normalizeHex(actual) !== normalizeHex(check.expected)) {
                fail(`${check.label} drifted`);
              }
              return check.label;
            }),
          ),
        ]);
      if (normalizeHex(chainId) !== "0x1") fail("RPC is not Ethereum Mainnet");
      if (!latest?.number || !latest?.hash) fail("RPC head is incomplete");
      return {
        endpoint,
        headNumber: Number(BigInt(latest.number)),
        headHash: latest.hash,
        confirmedNonce: Number(BigInt(confirmedNonce)),
        pendingNonce: Number(BigInt(pendingNonce)),
        codes,
        bindings,
      };
    }),
  );
  const [left, right] = snapshots;
  if (
    left.confirmedNonce !== right.confirmedNonce ||
    left.pendingNonce !== right.pendingNonce ||
    left.confirmedNonce !== left.pendingNonce
  ) {
    fail("RPCs disagree on nonce or deployer has a pending transaction");
  }
  if (Math.abs(left.headNumber - right.headNumber) > 4) {
    fail("Mainnet RPC heads differ by more than four blocks");
  }
  const observedAtBlock = Math.min(left.headNumber, right.headNumber);
  const observedAtBlockHash = await loadClassicV4SharedObservedBlock(
    endpoints,
    observedAtBlock,
  );
  return {
    startingNonce: left.pendingNonce,
    observedAtBlock,
    observedAtBlockHash,
    independentRpcCount: 2,
  };
}

async function codeAtBoth(endpoints, address) {
  const codes = await Promise.all(
    endpoints.map((endpoint) =>
      rpc(endpoint, "eth_getCode", [address, "latest"]),
    ),
  );
  if (normalizeHex(codes[0]) !== normalizeHex(codes[1])) {
    fail(`RPCs disagree on predicted address ${address}`);
  }
  return codes[0];
}

async function buildVacantPlan({
  artifacts,
  deployer,
  identity,
  snapshot,
  endpoints,
  buildCommitments,
  sourcePinsDigest,
}) {
  const occupiedHooks = [];
  for (;;) {
    const plan = buildClassicV4PreparationPlan({
      artifacts,
      deployer,
      startingNonce: snapshot.startingNonce,
      releaseCommit: identity.releaseCommit,
      releaseTree: identity.releaseTree,
      repositoryClean: identity.repositoryClean,
      observedAtBlock: snapshot.observedAtBlock,
      observedAtBlockHash: snapshot.observedAtBlockHash,
      preflight: {
        independentRpcCount: snapshot.independentRpcCount,
        freshDeterministicBuild: true,
        compilerVersion: "0.8.26+commit.8a97fa7a",
        evmVersion: "cancun",
        optimizerRuns: 1_000,
        metadataBytecodeHash: "none",
        officialDependencyRuntimeVerified: true,
        sharedDependencyRuntimeVerified: true,
        sharedDependencyBindingsVerified: true,
        predictedAddressesVacant: true,
        deployerNonceReconciled: true,
        foundryEnvironmentSanitized: true,
        freshControlledOutput: true,
        sourcePinsVerified: true,
        sourcePinsDigest,
        buildArtifactsDigest: buildCommitments.buildArtifactsDigest,
        dependencyClosureDigest: buildCommitments.dependencyClosureDigest,
        dependencySourceCount: buildCommitments.dependencySourceCount,
        dependencyRoots: buildCommitments.dependencyRoots,
      },
      occupiedAddresses: occupiedHooks,
    });
    for (const name of ["hookFactory", "positionPlanner", "launcher"]) {
      if (
        (await codeAtBoth(endpoints, plan.predictedAddresses[name])) !== "0x"
      ) {
        fail(`Predicted ${name} address is already occupied`);
      }
    }
    const hookCode = await codeAtBoth(
      endpoints,
      plan.predictedAddresses.feeHook,
    );
    if (hookCode === "0x") return plan;
    occupiedHooks.push(plan.predictedAddresses.feeHook);
  }
}

async function writeAcknowledgedPlan(plan, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(plan.deployer, "deployer")
  ) {
    fail("--write requires the explicit human wallet matching the deployer");
  }
  if (normalizeHex(options.acknowledgement) !== normalizeHex(plan.planDigest)) {
    fail("--write requires --acknowledge-plan-digest from a fresh check run");
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    fail("The preparation plan must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("The output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const deployer = canonicalNonzeroAddress(options.deployer, "deployer");
  const endpoints = [options.rpcA, options.rpcB];
  assertHttpsEndpoints(endpoints);
  const initialIdentity = await gitIdentity();
  const allLocalDependencyRoots = Object.keys(
    EXPECTED_LOCAL_PIN_IDENTITIES,
  ).sort();
  const [v3Manifest, sourcePins, localEntries, beforeBuildGitStates] =
    await Promise.all([
    readFile(
      path.join(
        repositoryRoot,
        "contracts/deployments/mainnet-classic-v3.json",
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(sourcePinsPath, "utf8").then(JSON.parse),
    readdir(path.join(contractsRoot, "lib"), { withFileTypes: true }),
    readDependencyGitStates(allLocalDependencyRoots),
  ]);
  const localDirectories = localEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const sourcePinsDigestBeforeBuild = verifyClassicV4SourcePins({
    sourcePins,
    localDirectories,
    dependencyRoots: allLocalDependencyRoots,
    dependencyGitStates: beforeBuildGitStates,
  });
  const { identity, artifacts } =
    await runFreshDeterministicBuild(initialIdentity);
  const buildCommitments = computeClassicV4BuildCommitments(artifacts);
  const afterBuildGitStates = await readDependencyGitStates(
    allLocalDependencyRoots,
  );
  const sourcePinsDigest = verifyClassicV4SourcePins({
    sourcePins,
    localDirectories,
    dependencyRoots: allLocalDependencyRoots,
    dependencyGitStates: afterBuildGitStates,
  });
  if (sourcePinsDigest !== sourcePinsDigestBeforeBuild) {
    fail("Source pins changed during the deterministic release build");
  }
  assertPinnedV3Manifest(v3Manifest);
  const snapshot = await verifiedMainnetSnapshot(endpoints, deployer);
  const plan = await buildVacantPlan({
    artifacts,
    deployer,
    identity,
    snapshot,
    endpoints,
    buildCommitments,
    sourcePinsDigest,
  });
  const finalIdentity = await gitIdentity();
  if (
    !finalIdentity.repositoryClean ||
    finalIdentity.repositoryTopLevel !== identity.repositoryTopLevel ||
    finalIdentity.releaseCommit !== identity.releaseCommit ||
    finalIdentity.releaseTree !== identity.releaseTree
  ) {
    fail("Git identity changed after the deterministic release build");
  }
  validateClassicV4PreparationPlan(plan, artifacts);
  if (options.write) await writeAcknowledgedPlan(plan, options);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 release preparation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
