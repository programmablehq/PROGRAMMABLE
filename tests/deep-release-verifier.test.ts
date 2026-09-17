import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  DEEP_ORACLE_GROWTH_EVENT_COUNT,
  validateDeepOracleGrowthSequence,
} from "../contracts/scripts/deep-oracle-growth-sequence.mjs";
import { validateDeepLifecycleConfirmationDepth } from "../contracts/scripts/deep-lifecycle-confirmations.mjs";
import { deepReleaseSourceTargets } from "../contracts/scripts/deep-release-source-targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(
  root,
  "contracts",
  "deployments",
  "mainnet-deep-full-range-v1.json",
);
const schemaPath = path.join(
  root,
  "contracts",
  "deployments",
  "schema",
  "deep-full-range-release-v1.schema.json",
);
const verifierPath = path.join(
  root,
  "contracts",
  "scripts",
  "verify-deep-full-range-release-manifest.mjs",
);
const executorArtifactPath = path.join(
  root,
  "contracts",
  "out",
  "DeepKeeperExecutorV1.sol",
  "DeepKeeperExecutorV1.json",
);
const historicalSnapshotFile =
  "dependencies/historical/ethereum-mainnet-25612664.json";
const historicalSnapshotSha256 =
  "fbeee8e6323c28d4fed7f755d3c8f27979e67f42139d8883a20c1c4867d03da2";
const historicalSnapshotPath = path.join(root, "contracts", historicalSnapshotFile);
const currentSnapshotPath = path.join(root, "contracts/dependencies/ethereum-mainnet.json");
const readinessPath = path.join(root, "contracts/scripts/verify-deep-v1-readiness.mjs");

// Substitute one file read in a separate process without changing repository
// files. Both real verifier entrypoints must reject tampered historical bytes.
function runWithSnapshotOverlay(
  script: string,
  args: string[],
  snapshotPath: string,
  replacement: string | null,
) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "historical-mainnet-snapshot-"));
  const preload = path.join(directory, "overlay.mjs");
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const targets = ${JSON.stringify([snapshotPath, pathToFileURL(snapshotPath).href])};
    const encoded = ${JSON.stringify(replacement === null ? null : Buffer.from(replacement).toString("base64"))};
    function substitute(file, options) {
      if (encoded === null) throw Object.assign(new Error("Missing snapshot: " + file), { code: "ENOENT" });
      const bytes = Buffer.from(encoded, "base64");
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding ? bytes.toString(encoding) : bytes;
    }
    const originalSync = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (targets.includes(String(file))) return substitute(file, args[0]);
      return originalSync.call(this, file, ...args);
    };
    const originalAsync = fs.promises.readFile;
    fs.promises.readFile = async function(file, ...args) {
      if (targets.includes(String(file))) return substitute(file, args[0]);
      return originalAsync.call(this, file, ...args);
    };
    syncBuiltinESMExports();
  `);
  try {
    return spawnSync(process.execPath, ["--import", preload, script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validator() {
  return new Ajv({ allErrors: true, strict: false }).compile(
    readJson(schemaPath),
  );
}

describe("Deep release manifest lifecycle gates", () => {
  it("keeps the reviewed pending manifest schema-compatible", () => {
    const validate = validator();
    expect(validate(readJson(manifestPath))).toBe(true);
  });

  it("does not let legacy keeper evidence satisfy final release status", () => {
    const manifest = readJson(manifestPath);
    manifest.status = "deployment-source-and-lifecycle-verified";
    manifest.releaseEligible = true;
    manifest.lifecycleEvidence.status = "verified-current-release";
    manifest.lifecycleEvidence.releaseEligible = true;

    const validate = validator();
    expect(validate(manifest)).toBe(false);
    expect(
      validate.errors?.some(
        (error) =>
          error.instancePath === "/lifecycleEvidence" &&
          error.keyword === "required",
      ),
    ).toBe(true);
  });

  it("accepts structurally separate oracle and fee-process/compound records", () => {
    const manifest = readJson(manifestPath);
    manifest.status = "deployment-source-and-lifecycle-verified";
    manifest.releaseEligible = true;
    manifest.lifecycleEvidence.status = "verified-current-release";
    manifest.lifecycleEvidence.releaseEligible = true;
    manifest.lifecycleEvidence.oracleTransaction = `0x${"11".repeat(32)}`;
    manifest.lifecycleEvidence.feeProcessCompoundTransaction = `0x${"22".repeat(32)}`;
    manifest.lifecycleEvidence.keeperExecutor =
      "0x1111111111111111111111111111111111111111";
    manifest.lifecycleEvidence.keeperExecutorRuntimeCodeHash = `0x${"33".repeat(32)}`;
    manifest.lifecycleEvidence.keeperExecutorDeploymentTransaction = `0x${"44".repeat(32)}`;
    manifest.lifecycleEvidence.keeperExecutorDeploymentBlock = 25_700_000;

    const validate = validator();
    expect(validate(manifest)).toBe(true);
  });

  it("requires the executor deployment proof in final lifecycle status", () => {
    const manifest = readJson(manifestPath);
    manifest.lifecycleEvidence.status = "verified-current-release";
    manifest.lifecycleEvidence.releaseEligible = true;
    manifest.lifecycleEvidence.oracleTransaction = `0x${"11".repeat(32)}`;
    manifest.lifecycleEvidence.feeProcessCompoundTransaction = `0x${"22".repeat(32)}`;
    manifest.lifecycleEvidence.keeperExecutor =
      "0x1111111111111111111111111111111111111111";
    manifest.lifecycleEvidence.keeperExecutorRuntimeCodeHash = `0x${"33".repeat(32)}`;

    const validate = validator();
    expect(validate(manifest)).toBe(false);
    expect(
      validate.errors?.some(
        (error) =>
          error.instancePath === "/lifecycleEvidence" &&
          error.keyword === "required",
      ),
    ).toBe(true);
  });

  it("requires the complete ordered 2 to 192 oracle growth sequence", () => {
    const vault = "0x1111111111111111111111111111111111111111";
    const executor = "0x2222222222222222222222222222222222222222";
    const poolId = `0x${"33".repeat(32)}`;
    const automationEvents = Array.from(
      { length: DEEP_ORACLE_GROWTH_EVENT_COUNT },
      (_, index) => {
        const previousCardinalityNext = 2 + index * 16;
        return {
          vault,
          executor,
          poolId,
          previousCardinalityNext,
          newCardinalityNext: Math.min(192, previousCardinalityNext + 16),
        };
      },
    );
    const hookEvents = automationEvents.map((event) => ({
      poolId,
      observationCardinalityNextOld: event.previousCardinalityNext,
      observationCardinalityNextNew: event.newCardinalityNext,
    }));

    expect(() =>
      validateDeepOracleGrowthSequence({
        automationEvents,
        hookEvents,
        vault,
        executor,
        poolId,
      }),
    ).not.toThrow();
    expect(() =>
      validateDeepOracleGrowthSequence({
        automationEvents: automationEvents.slice(0, -1),
        hookEvents: hookEvents.slice(0, -1),
        vault,
        executor,
        poolId,
      }),
    ).toThrow("exactly 12 Automation events");
    expect(() =>
      validateDeepOracleGrowthSequence({
        automationEvents: automationEvents.map((event, index) =>
          index === 4
            ? { ...event, newCardinalityNext: event.newCardinalityNext + 1 }
            : event,
        ),
        hookEvents,
        vault,
        executor,
        poolId,
      }),
    ).toThrow("outside the canonical 2 -> 192 sequence");
  });

  it("adds the keeper executor to live source verification only for final releases", () => {
    const release = {
      addresses: { launcher: "0x1111111111111111111111111111111111111111" },
      lifecycleEvidence: {
        status: "verified-current-release",
        keeperExecutor: "0x2222222222222222222222222222222222222222",
      },
    };
    expect(deepReleaseSourceTargets(release, ["launcher"])).toEqual([
      {
        field: "launcher",
        address: release.addresses.launcher,
      },
      {
        field: "keeperExecutor",
        address: release.lifecycleEvidence.keeperExecutor,
      },
    ]);
    expect(
      deepReleaseSourceTargets(
        {
          ...release,
          lifecycleEvidence: {
            ...release.lifecycleEvidence,
            status: "launch-and-oracle-verified",
          },
        },
        ["launcher"],
      ),
    ).toHaveLength(1);
  });

  it("requires both RPC heads to clear the final lifecycle block by 12", () => {
    const transactionBlocks = [100n, 101n, 102n, 103n];

    expect(() =>
      validateDeepLifecycleConfirmationDepth({
        heads: [115n, 115n],
        transactionBlocks,
      }),
    ).not.toThrow();
    expect(() =>
      validateDeepLifecycleConfirmationDepth({
        heads: [115n, 114n],
        transactionBlocks,
      }),
    ).toThrow("RPC 2 is inside the 12-block confirmation window");
  });

  it("validates the pending deployed release offline", () => {
    const output = execFileSync(process.execPath, [verifierPath, "--offline"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain(
      "structurally valid (offline; no chain or source-provider claims)",
    );
  });

  it("retains the exact reviewed snapshot bytes independently of current registry bindings", () => {
    const historicalBytes = fs.readFileSync(historicalSnapshotPath);
    expect(createHash("sha256").update(historicalBytes).digest("hex"))
      .toBe(historicalSnapshotSha256);
    expect(readJson(historicalSnapshotPath).runtimeSnapshot.blockNumber).toBe(25_612_664);
    expect(createHash("sha256").update(fs.readFileSync(currentSnapshotPath)).digest("hex"))
      .not.toBe(historicalSnapshotSha256);
  });

  const alteredBlock = readJson(historicalSnapshotPath);
  alteredBlock.runtimeSnapshot.blockNumber += 1;
  const alteredRuntime = readJson(historicalSnapshotPath);
  alteredRuntime.contracts.poolManager.runtimeCodeHash = `0x${"11".repeat(32)}`;
  const alteredSource = readJson(historicalSnapshotPath);
  alteredSource.source.sourceCommit = "22".repeat(20);
  const snapshotSubstitutions = [
    { label: "current snapshot", bytes: fs.readFileSync(currentSnapshotPath, "utf8") },
    { label: "changed block", bytes: JSON.stringify(alteredBlock) },
    { label: "changed runtime", bytes: JSON.stringify(alteredRuntime) },
    { label: "changed source commit", bytes: JSON.stringify(alteredSource) },
    { label: "whitespace-only drift", bytes: fs.readFileSync(historicalSnapshotPath, "utf8") + "\n" },
    { label: "malformed JSON", bytes: "{" },
    { label: "missing historical file", bytes: null },
  ];
  for (const [label, script, args] of [
    ["release verifier", verifierPath, ["--offline"]],
    ["readiness verifier", readinessPath, []],
  ] as const) {
    it.each(snapshotSubstitutions)(`${label} rejects $label without falling back`, ({ bytes }) => {
      const result = runWithSnapshotOverlay(script, [...args], historicalSnapshotPath, bytes);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(bytes === null
        ? "Missing snapshot:"
        : "Historical Mainnet dependency snapshot SHA-256 mismatch");
    });
  }

  it("verifies historical release provenance without reading the mutable current snapshot", () => {
    const result = runWithSnapshotOverlay(verifierPath, ["--offline"], currentSnapshotPath, null);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("structurally valid (offline; no chain or source-provider claims)");
  });

  it("reports the immutable snapshot identity in readiness provenance", () => {
    const result = runWithSnapshotOverlay(readinessPath, [], currentSnapshotPath, null);
    expect(result.error).toBeUndefined();
    // Readiness can still be blocked by its existing clean-checkout/artifact
    // gates. Reading historical evidence does not grant deployment approval.
    const report = JSON.parse(result.stdout);
    expect(report.officialDependencySnapshot.file).toBe(historicalSnapshotFile);
    expect(report.officialDependencySnapshot.sha256).toBe(historicalSnapshotSha256);
    expect(report.officialDependencySnapshot.runtimeSnapshot.blockNumber).toBe(25_612_664);
  });

  it("binds the reviewed executor source and runtime to Mainnet Automation", () => {
    const artifact = readJson(executorArtifactPath);
    const automation = "856a8e8421e76f55cd1e0d65b4f3c1b474289b2f";
    const immutableWord = automation.padStart(64, "0");
    let runtime = artifact.deployedBytecode.object.slice(2);
    for (const reference of Object.values(
      artifact.deployedBytecode.immutableReferences,
    ).flat() as Array<{ start: number; length: number }>) {
      const start = reference.start * 2;
      runtime =
        runtime.slice(0, start) +
        immutableWord +
        runtime.slice(start + reference.length * 2);
    }
    expect(keccak256(`0x${runtime}`)).toBe(
      "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6",
    );

    const gasPolicy = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "uint256,uint256,uint256,uint256,uint256,uint256,uint256",
        ),
        [8n, 150_000n, 700_000n, 220_000n, 450_000n, 25_000n, 25_000n],
      ),
    );
    const resultPolicy = keccak256(
      stringToHex(
        "one-result-per-candidate:fresh-assessment:skip-none-or-drift:bounded-per-action-call",
      ),
    );
    expect(
      keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32,address,bytes32,bytes32,bytes32"),
          [
            keccak256(artifact.bytecode.object),
            `0x${automation}`,
            "0x1b6cc50912806d27908a5e01abf30af392b909116e0d0f7321f828be52400ad8",
            gasPolicy,
            resultPolicy,
          ],
        ),
      ),
    ).toBe(
      "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175",
    );
  });

  it("requires two explicit RPCs before a --require-live claim", () => {
    const env = { ...process.env };
    delete env.ETHEREUM_RPC_URL;
    delete env.ETHEREUM_RPC_URL_SECONDARY;
    delete env.ETHEREUM_RPC_URL_B;
    delete env.ETHERSCAN_API_KEY;
    const result = spawnSync(
      process.execPath,
      [verifierPath, "--require-live"],
      {
        cwd: root,
        encoding: "utf8",
        env,
      },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "--require-live requires two distinct explicit RPCs",
    );
  });
});
