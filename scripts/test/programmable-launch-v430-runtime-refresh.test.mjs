import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256Digest } from "../../packages/launch/src/io.mjs";
import { robinhoodV41BackendPromotionTools as backendTools } from "../../contracts/scripts/robinhood-backend-promotion-v41.mjs";
import { RUNTIME_CAPTURE_PATH, RUNTIME_ATTESTATION_PATH, verifyRuntimePromotionReadiness } from "../programmable-launch-v430-runtime-refresh.mjs";

const DIGEST = `sha256:${"ab".repeat(32)}`;
const WHEN = "2026-10-08T01:00:00.000Z";
function fixture(t, observedAt = WHEN, logTimes = [String(Date.parse(observedAt) / 1000 + 13)]) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "programmable-runtime-refresh-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { backendSource: { repository: "programmablehq/programmable-open-hook-v2-internal",
    sourceCommit: "61".repeat(20), sourceTree: "1c".repeat(20) }, observedAt, fixtureOnly: true };
  const write = (relative, value) => {
    const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value)); return file;
  };
  write("packages/launch/package.json", { name: "@programmable/launch", version: "4.3.0" });
  write(RUNTIME_CAPTURE_PATH, input); write(RUNTIME_ATTESTATION_PATH, {
    fixtureOnly: "attestation",
    verificationMaterial: { tlogEntries: logTimes.map(integratedTime => ({ integratedTime })) },
  });
  const git = args => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git(["init", "--quiet"]); git(["add", "."]);
  git(["-c", "user.name=Runtime Test", "-c", "user.email=runtime-test@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture"]);
  const argv = ["apply", "--repository-root", root, "--stage", path.join(root, "original-stage.json"),
    "--bundle", path.join(root, "original-promotion.json")];
  const imported = () => ({ command: "verify-backend-import", releaseReady: false, publicAuthorization: false,
    publicWrites: false, wroteLiveArtifacts: false, backendSource: input.backendSource,
    backendPromotionPublicInputSha256: sha256Digest(readFileSync(path.join(root, RUNTIME_CAPTURE_PATH))),
    captureVerificationDigest: DIGEST });
  const applied = () => ({ command: "apply", releaseReady: true, publicAuthorization: true,
    publicWrites: true, wroteLiveArtifacts: false, preparedArtifactPreserved: true, replayed: false,
    freshBackendReadbackDigest: DIGEST, freshProviderReadbackDigest: DIGEST,
    freshSourceVerificationClosureDigest: DIGEST, freshObservedAt: WHEN });
  return { root, input, argv, write, imported, applied };
}

function successful(f, events = []) {
  const stageBundle = { fixtureOnly: "original V4.1 backend stage context" };
  const now = () => new Date(WHEN);
  return {
    async runFinalizer(argv, dependencies) {
      events.push(argv[0]);
      if (argv[0] === "verify-backend-import") {
        assert.deepEqual(Object.keys(dependencies), ["backendDependencies", "backendVerificationNow"]);
        assert.deepEqual(Object.keys(dependencies.backendDependencies), ["now"]);
        assert.equal(dependencies.backendDependencies.now().toISOString(), f.input.observedAt);
        assert.equal(dependencies.backendVerificationNow().getTime(), Date.parse(f.input.observedAt) + 13000);
        assert.deepEqual(argv, ["verify-backend-import", "--repository-root", f.root,
          "--stage", f.argv[4], "--backend-input", path.join(f.root, RUNTIME_CAPTURE_PATH),
          "--backend-attestation-bundle", path.join(f.root, RUNTIME_ATTESTATION_PATH)]);
        return f.imported();
      }
      assert.deepEqual(argv, f.argv);
      assert.deepEqual(Object.keys(dependencies), ["freshVerifyBackend"]);
      await dependencies.freshVerifyBackend({ stageBundle, capturedInput: { fixtureOnly: "historical capture" },
        fetch: undefined, flyApiToken: undefined, now });
      return f.applied();
    },
    async freshVerifyBackend(options) {
      events.push("fresh-backend");
      assert.strictEqual(options.stageBundle, stageBundle);
      assert.strictEqual(options.now, now);
      assert.deepEqual(options.capturedInput, f.input);
      return { observedAt: WHEN, freshBackendReadbackDigest: DIGEST };
    },
  };
}

test("authenticated historical capture still requires current observations inside unchanged apply", async t => {
  const f = fixture(t), events = [];
  const result = await verifyRuntimePromotionReadiness(f.argv, successful(f, events));
  assert.deepEqual(events, ["verify-backend-import", "apply", "fresh-backend"]);
  assert.equal(result.command, "apply"); assert.equal(result.publicWrites, true);
  assert.equal(result.runtimeRevalidation.activatesWriteProfile, false);
  assert.equal(result.runtimeRevalidation.historicalAttestedAt, "2026-10-08T01:00:13.000Z");
  assert.deepEqual(result.runtimeRevalidation.backendSource, f.input.backendSource);
  assert.equal(result.runtimeRevalidation.inputSha256, f.imported().backendPromotionPublicInputSha256);
  assert.equal(result.runtimeRevalidation.attestationSha256,
    sha256Digest(readFileSync(path.join(f.root, RUNTIME_ATTESTATION_PATH))));
});

test("a future-dated historical capture cannot enter authentication or live verification", async t => {
  const f = fixture(t, new Date(Date.now() + 86_400_000).toISOString());
  await assert.rejects(verifyRuntimePromotionReadiness(f.argv, {
    runFinalizer: async () => assert.fail("future evidence must not enter the importer"),
    freshVerifyBackend: async () => assert.fail("future evidence must not enter live verification"),
  }), /non-future observation time/u);
});

test("missing, ambiguous, future and out-of-window log times cannot reconstruct historical authorization", async t => {
  const observedSeconds = Date.parse(WHEN) / 1000;
  for (const logTimes of [[], ["invalid"], [String(observedSeconds + 13), String(observedSeconds + 14)],
    [String(observedSeconds - 1)], [String(observedSeconds + 601)], [String(Math.floor(Date.now() / 1000) + 60)]]) {
    const f = fixture(t, WHEN, logTimes);
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, {
      runFinalizer: async () => assert.fail("invalid historical time must not reach authentication"),
      freshVerifyBackend: async () => assert.fail("invalid historical time must not reach live verification"),
    }), /authenticated log inclusion|original authorization window/u);
  }
});

test("recorded inclusion time satisfies the real capture validator without extending its ten-minute window", () => {
  // Structural regression only. Production still authenticates these exact
  // bytes with pinned Cosign before accepting an imported receipt.
  const inputBytes = readFileSync(new URL(`../../${RUNTIME_CAPTURE_PATH}`, import.meta.url));
  const attestationBundleBytes = readFileSync(new URL(`../../${RUNTIME_ATTESTATION_PATH}`, import.meta.url));
  const input = JSON.parse(inputBytes), bundle = JSON.parse(attestationBundleBytes);
  const original = JSON.parse(readFileSync(new URL(
    "../../release/robinhood-chain-4663/v4.1/programmable-promotion-bundle.json", import.meta.url)));
  const verifiedAt = new Date(Number(bundle.verificationMaterial.tlogEntries[0].integratedTime) * 1000).toISOString().replace(".000Z", "Z");
  const fields = {
    ...original.backendCaptureAuthorization,
    subjectSha256: sha256Digest(inputBytes), attestationBundleSha256: sha256Digest(attestationBundleBytes),
    certificateGithubWorkflowSha: input.backendSource.sourceCommit,
    sourceRevision: input.backendSource.sourceCommit, sourceTree: input.backendSource.sourceTree,
    verifiedAt,
  };
  const check = value => backendTools.validateRobinhoodBackendCaptureAuthorization({
    authorization: backendTools.buildRobinhoodBackendCaptureAuthorization(value),
    input, inputBytes, attestationBundleBytes,
  });
  assert.doesNotThrow(() => check(fields));
  assert.throws(() => check({ ...fields,
    verifiedAt: new Date(Date.parse(input.observedAt) + 601000).toISOString().replace(".000Z", "Z"),
  }), /outside the capture window/u);
});

test("failed capture authentication stops before historical apply or live backend reads", async t => {
  const f = fixture(t); let calls = 0;
  await assert.rejects(verifyRuntimePromotionReadiness(f.argv, {
    runFinalizer: async argv => { calls++; assert.equal(argv[0], "verify-backend-import"); throw new Error("signature rejected"); },
    freshVerifyBackend: async () => assert.fail("must not query runtime"),
  }), /signature rejected/u);
  assert.equal(calls, 1);
});

test("the authenticated receipt must describe these exact bytes and source without write authority", async t => {
  for (const kind of ["subject", "source", "authorization", "write-authority"]) {
    const f = fixture(t); let calls = 0;
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, {
      runFinalizer: async argv => {
        calls++; assert.equal(argv[0], "verify-backend-import");
        const receipt = f.imported();
        if (kind === "subject") receipt.backendPromotionPublicInputSha256 = DIGEST;
        else if (kind === "source") receipt.backendSource = { ...receipt.backendSource, sourceCommit: "ee".repeat(20) };
        else if (kind === "authorization") receipt.captureVerificationDigest = "unsigned";
        else receipt.publicWrites = true;
        return receipt;
      },
      freshVerifyBackend: async () => assert.fail("invalid receipt must not query runtime"),
    }), /authenticated runtime|verification-only/u);
    assert.equal(calls, 1);
  }
});

test("every existing historical and live verification failure propagates", async t => {
  for (const gate of ["historical signature", "L1/L2 finality", "Sourcify", "landed artifact bytes", "release readiness"]) {
    const f = fixture(t), dependencies = successful(f), run = dependencies.runFinalizer;
    dependencies.runFinalizer = async (argv, options) => {
      if (argv[0] === "apply") throw new Error(gate); return run(argv, options);
    };
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, dependencies), error => error.message === gate);
  }
  for (const gate of ["source/tree", "image", "machine inventory", "profile/policy", "migration/API/OpenAPI", "composition authority"]) {
    const f = fixture(t), dependencies = successful(f);
    dependencies.freshVerifyBackend = async () => { throw new Error(gate); };
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, dependencies), error => error.message === gate);
  }
});

test("uncommitted, missing and symlinked runtime evidence cannot enter the verifier", async t => {
  for (const kind of ["uncommitted", "missing", "symlink"]) {
    const f = fixture(t), file = path.join(f.root, RUNTIME_CAPTURE_PATH);
    if (kind === "uncommitted") writeFileSync(file, "changed");
    else { rmSync(file); if (kind === "symlink") symlinkSync(path.join(f.root, RUNTIME_ATTESTATION_PATH), file); }
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, {
      runFinalizer: async () => assert.fail("must reject source mismatch before importing"),
    }));
  }
});

test("capture changes during import and during live verification fail closed", async t => {
  for (const during of ["import", "live"]) {
    const f = fixture(t), dependencies = successful(f), run = dependencies.runFinalizer;
    if (during === "import") dependencies.runFinalizer = async (argv, options) => {
      const result = await run(argv, options); writeFileSync(path.join(f.root, RUNTIME_ATTESTATION_PATH), "changed"); return result;
    };
    else dependencies.freshVerifyBackend = async () => {
      writeFileSync(path.join(f.root, RUNTIME_ATTESTATION_PATH), "changed"); return { observedAt: WHEN };
    };
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, dependencies), /exact source commit|changed during/u);
  }
});

test("the wrapper rejects other package versions, mutation commands and duplicate arguments", async t => {
  const f = fixture(t);
  const dependencies = { runFinalizer: async () => assert.fail("unsupported route must not execute") };
  await assert.rejects(verifyRuntimePromotionReadiness(["promote", ...f.argv.slice(1)], dependencies), /read-only apply/u);
  await assert.rejects(verifyRuntimePromotionReadiness([...f.argv, "--stage", "other"], dependencies), /duplicate/u);
  f.write("packages/launch/package.json", { name: "@programmable/launch", version: "4.1.2" });
  await assert.rejects(verifyRuntimePromotionReadiness(f.argv, dependencies), /restricted/u);
});

test("an apply result cannot omit the runtime check or claim altered artifacts", async t => {
  for (const kind of ["no-runtime", "changed-artifact", "replayed"]) {
    const f = fixture(t), dependencies = successful(f), run = dependencies.runFinalizer;
    dependencies.runFinalizer = async (argv, options) => {
      if (argv[0] !== "apply") return run(argv, options);
      if (kind === "no-runtime") return f.applied();
      const result = await run(argv, options);
      return { ...result, ...(kind === "changed-artifact" ? { preparedArtifactPreserved: false } : { replayed: true }) };
    };
    await assert.rejects(verifyRuntimePromotionReadiness(f.argv, dependencies), /must perform|every historical/u);
  }
});
