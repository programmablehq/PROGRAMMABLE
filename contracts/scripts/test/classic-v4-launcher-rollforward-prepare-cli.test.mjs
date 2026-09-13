import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertClassicV4LauncherRollforwardWriteAcknowledgement,
  deriveClassicV4LauncherRollforwardTransactions,
  main,
  parseClassicV4LauncherRollforwardPrepareArguments,
  prepareClassicV4LauncherRollforward,
  writeClassicV4LauncherRollforwardArtifacts,
} from "../prepare-classic-v4-launcher-rollforward.mjs";
import { verifyClassicV4SourcePins } from "../prepare-classic-v4-mainnet-release.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const DEPLOYER = `0x${"12".repeat(20)}`;
const PIN_DIGEST = hash(90);
const PLAN_DIGEST = hash(91);
const ALL_LOCAL_DEPENDENCIES = Object.freeze([
  "blocknumberish",
  "continuous-clearing-auction",
  "forge-std",
  "liquidity-launcher",
  "openzeppelin-contracts",
  "openzeppelin-uniswap-hooks",
  "permit2",
  "solady",
  "solmate",
  "uerc20-factory",
  "universal-router",
  "v4-core",
  "v4-periphery",
  "v4-periphery-v211",
]);

function hash(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

async function temporaryDirectory(prefix) {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

function argumentFixture(overrides = {}) {
  return {
    help: false,
    write: false,
    releaseRepositoryRoot: "/tmp/classic-v4-release-root",
    basePlan: "/tmp/classic-v4-base-plan.json",
    baseDeploymentEvidence: "/tmp/classic-v4-base-deployment.json",
    baseSourceEvidence: "/tmp/classic-v4-base-source.json",
    upgradePlan: "/tmp/classic-v4-upgrade-plan.json",
    upgradeReceiptEvidence: "/tmp/classic-v4-upgrade-receipt.json",
    upgradeVerificationEvidence: "/tmp/classic-v4-upgrade-verification.json",
    planOutput: null,
    transactionsOutput: null,
    wallet: null,
    acknowledgement: null,
    ...overrides,
  };
}

function argvFixture() {
  const options = argumentFixture();
  return [
    "--release-repository-root",
    options.releaseRepositoryRoot,
    "--base-plan",
    options.basePlan,
    "--base-deployment-evidence",
    options.baseDeploymentEvidence,
    "--base-source-evidence",
    options.baseSourceEvidence,
    "--upgrade-plan",
    options.upgradePlan,
    "--upgrade-receipt-evidence",
    options.upgradeReceiptEvidence,
    "--upgrade-verification-evidence",
    options.upgradeVerificationEvidence,
  ];
}

function parentInputs() {
  return {
    basePlan: { id: "base-plan" },
    baseDeploymentEvidence: {
      id: "base-deployment",
      contracts: {
        hookFactory: { transactionHash: hash(1) },
        feeHook: { transactionHash: hash(2) },
        positionPlanner: { transactionHash: hash(3) },
        launcher: { transactionHash: hash(4) },
      },
    },
    baseSourceEvidence: { id: "base-source" },
    upgradePlan: {
      id: "upgrade-plan",
      releaseCommit: COMMIT,
      releaseTree: TREE,
      sourcePinsDigest: PIN_DIGEST,
    },
    upgradeReceiptEvidence: {
      id: "upgrade-receipt",
      transactionHash: hash(5),
    },
    upgradeVerificationEvidence: { id: "upgrade-verification" },
  };
}

test("prepare argument parser is preview-first and rejects authority-bearing flags", () => {
  assert.deepEqual(
    parseClassicV4LauncherRollforwardPrepareArguments(["--help"]),
    { help: true },
  );
  const parsed =
    parseClassicV4LauncherRollforwardPrepareArguments(argvFixture());
  assert.equal(parsed.write, false);
  assert.equal(parsed.basePlan, "/tmp/classic-v4-base-plan.json");

  for (const forbidden of [
    "--broadcast",
    "--send",
    "--sign",
    "--submit",
    "--private-key=do-not-print-this",
    "--mnemonic=do-not-print-this-either",
  ]) {
    assert.throws(
      () =>
        parseClassicV4LauncherRollforwardPrepareArguments([
          ...argvFixture(),
          forbidden,
        ]),
      (error) => {
        assert.match(error.message, /forbidden/);
        assert.doesNotMatch(error.message, /do-not-print/);
        return true;
      },
    );
  }
  assert.throws(
    () =>
      parseClassicV4LauncherRollforwardPrepareArguments([
        ...argvFixture(),
        "--base-plan",
        "/tmp/duplicate.json",
      ]),
    /Duplicate option/,
  );
  assert.throws(
    () =>
      parseClassicV4LauncherRollforwardPrepareArguments([
        ...argvFixture(),
        "--wallet",
        DEPLOYER,
      ]),
    /requires --write/,
  );
  assert.throws(
    () =>
      parseClassicV4LauncherRollforwardPrepareArguments(
        argvFixture().filter(
          (value) => value !== "/tmp/classic-v4-base-plan.json",
        ),
      ),
    /Missing value for --base-plan/,
  );
});

test("preview composes the exact six parents from the sealed release root", async () => {
  const temporaryRoot = await temporaryDirectory(
    "classic-v4-rollforward-prepare-",
  );
  try {
    const options = argumentFixture({ releaseRepositoryRoot: temporaryRoot });
    const inputs = parentInputs();
    const valuesByPath = new Map(
      Object.keys(inputs).map((key) => [options[key], inputs[key]]),
    );
    const identity = {
      topLevel: temporaryRoot,
      commit: COMMIT,
      tree: TREE,
      clean: true,
    };
    const baseArtifacts = { id: "base-artifacts" };
    const launcherArtifact = { id: "launcher-artifact" };
    let identityReads = 0;
    let pinReads = 0;
    let receivedParents = null;
    let validated = null;
    const prepared = await prepareClassicV4LauncherRollforward(options, {
      privateJsonReader: async (file) => valuesByPath.get(file),
      identityReader: async (root) => {
        assert.equal(root, temporaryRoot);
        identityReads += 1;
        return identity;
      },
      sourcePinReader: async (root) => {
        assert.equal(root, temporaryRoot);
        pinReads += 1;
        return { digest: PIN_DIGEST };
      },
      retainedArtifactBuilder: async ({ contractsDirectory }) => {
        assert.equal(contractsDirectory, path.join(temporaryRoot, "contracts"));
        return baseArtifacts;
      },
      launcherArtifactBuilder: async ({ contractsDirectory }) => {
        assert.equal(contractsDirectory, path.join(temporaryRoot, "contracts"));
        return launcherArtifact;
      },
      parentBundleBuilder: (value) => {
        receivedParents = value;
        return { bundleDigest: hash(92) };
      },
      planBuilder: ({ parentBundle }) => ({
        status: "launcher-rollforward-composite",
        planDigest: PLAN_DIGEST,
        deployer: DEPLOYER,
        parentBundle,
      }),
      planValidator: (plan) => {
        validated = plan;
      },
    });
    assert.equal(identityReads, 2);
    assert.equal(pinReads, 2);
    assert.deepEqual(receivedParents, {
      ...inputs,
      baseArtifacts,
      launcherArtifact,
    });
    assert.equal(validated, prepared.plan);
    assert.deepEqual(prepared.transactions, {
      hookFactory: hash(1),
      feeHook: hash(2),
      positionPlanner: hash(3),
      launcher: hash(5),
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("sealed release source drift blocks composition before or after building", async () => {
  const temporaryRoot = await temporaryDirectory(
    "classic-v4-rollforward-seal-",
  );
  try {
    const options = argumentFixture({ releaseRepositoryRoot: temporaryRoot });
    const inputs = parentInputs();
    const reader = async (file) =>
      inputs[Object.keys(inputs).find((key) => options[key] === file)];
    let builds = 0;
    const build = async () => {
      builds += 1;
      return {};
    };
    await assert.rejects(
      prepareClassicV4LauncherRollforward(options, {
        privateJsonReader: reader,
        identityReader: async () => ({
          topLevel: temporaryRoot,
          commit: "3".repeat(40),
          tree: TREE,
          clean: true,
        }),
        sourcePinReader: async () => ({ digest: PIN_DIGEST }),
        retainedArtifactBuilder: build,
        launcherArtifactBuilder: build,
      }),
      /identity differs/,
    );
    assert.equal(builds, 0);

    let identityReads = 0;
    await assert.rejects(
      prepareClassicV4LauncherRollforward(options, {
        privateJsonReader: reader,
        identityReader: async () => ({
          topLevel: temporaryRoot,
          commit: COMMIT,
          tree: identityReads++ === 0 ? TREE : "4".repeat(40),
          clean: true,
        }),
        sourcePinReader: async () => ({ digest: PIN_DIGEST }),
        retainedArtifactBuilder: build,
        launcherArtifactBuilder: build,
      }),
      /identity differs/,
    );
    assert.equal(builds, 2);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("transaction derivation replaces only the obsolete base launcher hash", () => {
  const inputs = parentInputs();
  const transactions = deriveClassicV4LauncherRollforwardTransactions(inputs);
  assert.deepEqual(Object.keys(transactions), [
    "hookFactory",
    "feeHook",
    "positionPlanner",
    "launcher",
  ]);
  assert.equal(transactions.launcher, hash(5));
  assert.notEqual(
    transactions.launcher,
    inputs.baseDeploymentEvidence.contracts.launcher.transactionHash,
  );
  const duplicate = structuredClone(inputs);
  duplicate.upgradeReceiptEvidence.transactionHash = hash(1).toUpperCase();
  duplicate.upgradeReceiptEvidence.transactionHash = `0x${duplicate.upgradeReceiptEvidence.transactionHash.slice(2)}`;
  assert.throws(
    () => deriveClassicV4LauncherRollforwardTransactions(duplicate),
    /must be unique/,
  );
  const zero = structuredClone(inputs);
  zero.upgradeReceiptEvidence.transactionHash = hash(0);
  assert.throws(
    () => deriveClassicV4LauncherRollforwardTransactions(zero),
    /Invalid launcher transaction hash/,
  );
});

test("writes require the explicit deployer and the fresh composite plan digest", () => {
  const plan = { deployer: DEPLOYER, planDigest: PLAN_DIGEST };
  assert.doesNotThrow(() =>
    assertClassicV4LauncherRollforwardWriteAcknowledgement(plan, {
      wallet: DEPLOYER,
      acknowledgement: PLAN_DIGEST,
    }),
  );
  assert.throws(
    () =>
      assertClassicV4LauncherRollforwardWriteAcknowledgement(plan, {
        wallet: `0x${"34".repeat(20)}`,
        acknowledgement: PLAN_DIGEST,
      }),
    /explicit human wallet/,
  );
  assert.throws(
    () =>
      assertClassicV4LauncherRollforwardWriteAcknowledgement(plan, {
        wallet: DEPLOYER,
        acknowledgement: hash(93),
      }),
    /fresh reviewed preview/,
  );
});

test("main preview prints both artifacts and performs no write", async () => {
  let writes = 0;
  let output = "";
  const prepared = {
    plan: {
      planDigest: PLAN_DIGEST,
      deployer: DEPLOYER,
      parentBundle: { bundleDigest: hash(94) },
    },
    transactions: { launcher: hash(5) },
  };
  const preview = await main(argvFixture(), {
    prepare: async () => prepared,
    writer: async () => {
      writes += 1;
    },
    stdout: (value) => {
      output += value;
    },
  });
  assert.equal(writes, 0);
  assert.equal(preview.mode, "preview");
  assert.deepEqual(JSON.parse(output).transactions, prepared.transactions);
});

test("artifact pair is create-only, private, exact, and outside both repositories", async () => {
  const temporaryRoot = await temporaryDirectory(
    "classic-v4-rollforward-write-",
  );
  const releaseRoot = path.join(temporaryRoot, "release");
  const outputRoot = path.join(temporaryRoot, "owner-only");
  await mkdir(releaseRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(releaseRoot, 0o700);
  await chmod(outputRoot, 0o700);
  const planOutput = path.join(outputRoot, "rollforward-plan.json");
  const transactionsOutput = path.join(outputRoot, "transactions.json");
  const prepared = {
    plan: {
      planDigest: PLAN_DIGEST,
      deployer: DEPLOYER,
      parentBundle: { bundleDigest: hash(94) },
    },
    transactions: {
      hookFactory: hash(1),
      feeHook: hash(2),
      positionPlanner: hash(3),
      launcher: hash(5),
    },
  };
  const options = argumentFixture({
    write: true,
    releaseRepositoryRoot: releaseRoot,
    planOutput,
    transactionsOutput,
    wallet: DEPLOYER,
    acknowledgement: PLAN_DIGEST,
  });
  try {
    await writeClassicV4LauncherRollforwardArtifacts(prepared, options);
    assert.equal(
      await readFile(planOutput, "utf8"),
      `${JSON.stringify(prepared.plan, null, 2)}\n`,
    );
    assert.equal(
      await readFile(transactionsOutput, "utf8"),
      `${JSON.stringify(prepared.transactions, null, 2)}\n`,
    );
    assert.equal((await lstat(planOutput)).mode & 0o777, 0o600);
    assert.equal((await lstat(transactionsOutput)).mode & 0o777, 0o600);
    await assert.rejects(
      writeClassicV4LauncherRollforwardArtifacts(prepared, options),
      (error) => error.code === "EEXIST",
    );
    await assert.rejects(
      writeClassicV4LauncherRollforwardArtifacts(prepared, {
        ...options,
        planOutput: path.join(releaseRoot, "inside.json"),
        transactionsOutput: path.join(releaseRoot, "inside-transactions.json"),
      }),
      /outside both source repositories/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("pair preflight and rollback never overwrite or leave a partial plan", async () => {
  const temporaryRoot = await temporaryDirectory(
    "classic-v4-rollforward-rollback-",
  );
  await chmod(temporaryRoot, 0o700);
  const releaseRoot = path.join(temporaryRoot, "release");
  await mkdir(releaseRoot, { mode: 0o700 });
  const planOutput = path.join(temporaryRoot, "plan.json");
  const transactionsOutput = path.join(temporaryRoot, "transactions.json");
  const prepared = {
    plan: { deployer: DEPLOYER, planDigest: PLAN_DIGEST },
    transactions: { launcher: hash(5) },
  };
  const options = argumentFixture({
    write: true,
    releaseRepositoryRoot: releaseRoot,
    planOutput,
    transactionsOutput,
    wallet: DEPLOYER,
    acknowledgement: PLAN_DIGEST,
  });
  try {
    await writeFile(transactionsOutput, "sentinel", { mode: 0o600 });
    await assert.rejects(
      writeClassicV4LauncherRollforwardArtifacts(prepared, options),
      (error) => error.code === "EEXIST",
    );
    await assert.rejects(lstat(planOutput), (error) => error.code === "ENOENT");
    assert.equal(await readFile(transactionsOutput, "utf8"), "sentinel");
    await unlink(transactionsOutput);

    let writes = 0;
    await assert.rejects(
      writeClassicV4LauncherRollforwardArtifacts(prepared, options, {
        pathValidator: async () => {},
        privateJsonWriter: async (file, value) => {
          writes += 1;
          if (writes === 2) throw new Error("injected second write failure");
          await writeFile(file, `${JSON.stringify(value)}\n`, {
            mode: 0o600,
            flag: "wx",
          });
        },
        ownedPathUnlinker: async (file) => unlink(file),
      }),
      /injected second write failure/,
    );
    await assert.rejects(lstat(planOutput), (error) => error.code === "ENOENT");
    await assert.rejects(
      lstat(transactionsOutput),
      (error) => error.code === "ENOENT",
    );

    writes = 0;
    await assert.rejects(
      writeClassicV4LauncherRollforwardArtifacts(prepared, options, {
        pathValidator: async () => {},
        privateJsonWriter: async (file, value) => {
          writes += 1;
          if (writes === 2) throw new Error("injected second write failure");
          await writeFile(file, `${JSON.stringify(value)}\n`, {
            mode: 0o600,
            flag: "wx",
          });
        },
        ownedPathUnlinker: async () => {
          throw new Error("injected rollback failure");
        },
      }),
      (error) =>
        error instanceof AggregateError &&
        /partial plan could not be removed/.test(error.message),
    );
    assert.equal((await lstat(planOutput)).isFile(), true);
    await unlink(planOutput);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("source-pin verification supports an explicit sealed contracts directory", async () => {
  const sourcePins = JSON.parse(
    await readFile(
      path.resolve("contracts/dependencies/source-pins.json"),
      "utf8",
    ),
  );
  const pin = sourcePins.dependencies.find(
    (dependency) => dependency.name === "Uniswap v4 Core",
  );
  const contractsDirectory = "/sealed/classic-v4/contracts";
  const dependencyGitStates = {
    "v4-core": {
      topLevel: path.join(contractsDirectory, "lib/v4-core"),
      head: pin.commit,
      clean: true,
      remoteUrl: pin.repository,
    },
  };
  assert.doesNotThrow(() =>
    verifyClassicV4SourcePins({
      sourcePins,
      localDirectories: ALL_LOCAL_DEPENDENCIES,
      dependencyRoots: ["v4-core"],
      dependencyGitStates,
      contractsDirectory,
    }),
  );
  assert.throws(
    () =>
      verifyClassicV4SourcePins({
        sourcePins,
        localDirectories: ALL_LOCAL_DEPENDENCIES,
        dependencyRoots: ["v4-core"],
        dependencyGitStates,
        contractsDirectory: "/different/contracts",
      }),
    /Pinned Git checkout differs/,
  );
});
