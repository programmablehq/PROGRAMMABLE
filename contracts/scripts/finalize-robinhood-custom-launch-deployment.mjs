#!/usr/bin/env node

import { execFile } from "node:child_process";
import { constants as fsConstants, readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertNoSymlinkWritePath,
  atomicCreate,
  decodeExactUtf8,
  resolveInside,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import { parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";
import * as defaultReleaseTools from "../../scripts/programmable-launch-v4-release-binding.mjs";
import { parseProductionVerifyProofV1 } from
  "../../scripts/production-verify-proof.mjs";
import * as defaultPostdeployTools from "./robinhood-custom-launch-postdeploy-core.mjs";
import {
  ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_CAPTURE_PATH,
  ROBINHOOD_CAPTURE_WORKFLOW,
  ROBINHOOD_PRODUCTION_REF,
  ROBINHOOD_PRODUCTION_REPOSITORY,
  ROBINHOOD_PRODUCTION_REPOSITORY_ID,
  ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
  ROBINHOOD_STAGE_ATTESTATION_BUNDLE_PATH,
  buildRobinhoodCaptureAuthorization,
  canonicalRobinhoodFreshObservedAt,
  freshVerifyRobinhoodProviderReadbacks,
  freshVerifyRobinhoodSourcify,
  sha256CaptureBytes,
} from "./robinhood-custom-launch-capture-v2.mjs";
import * as defaultBackendTools from "./robinhood-backend-promotion-v1.mjs";

export function createRobinhoodPostdeploymentCli({
  releaseTools = defaultReleaseTools,
  postdeployTools = defaultPostdeployTools,
  backendTools = defaultBackendTools,
  backendStageContext = ({ stageBundle }) => stageBundle,
  allowedCommands = null,
} = {}) {
const { requireV4ReleaseReady } = releaseTools;
const { ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ROBINHOOD_PREDEPLOYMENT_PATH,
  ROBINHOOD_BACKEND_CHAIN_DEPLOYMENT_PATH,
  ROBINHOOD_BACKEND_SOURCE_MANIFEST_PATH,
  ROBINHOOD_BACKEND_STANDARD_JSON_PATHS,
  ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH,
  ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH,
  ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH,
  ROBINHOOD_STAGE_BUNDLE_PATH,
  ROBINHOOD_PROMOTION_BUNDLE_PATH,
  materializeRobinhoodStageBundle,
  materializeRobinhoodPromotionBundle,
  verifyRobinhoodStageBundle,
  verifyRobinhoodPromotionBundle, } = postdeployTools;
const { ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
  ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
  ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
  ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
  ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
  ROBINHOOD_BACKEND_COSIGN_VERSION,
  ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
  buildRobinhoodBackendAuthorization,
  buildRobinhoodBackendCosignVerifyBlobArgs,
  resolveCaptureWorkflowCommit,
  buildRobinhoodBackendCaptureAuthorization,
  freshVerifyRobinhoodBackendPromotionInput,
  validateRobinhoodBackendAuthorization,
  validateRobinhoodBackendCaptureAuthorization,
  validateRobinhoodBackendPromotionPublicInput,
  validateSigstoreMessageBundleV03,
  SIGSTORE_BUNDLE_V03_MEDIA_TYPE, } = backendTools;
const execFileAsync = promisify(execFile);

const DEFAULT_STAGE_BUNDLE_PATH = ROBINHOOD_STAGE_BUNDLE_PATH;
const DEFAULT_PROMOTION_BUNDLE_PATH = ROBINHOOD_PROMOTION_BUNDLE_PATH;

function canonicalRobinhoodVerifierInstant(now = () => new Date(), label = "verifier clock") {
  const instant = now();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new TypeError(`${label} is invalid`);
  }
  return new Date(Math.floor(instant.getTime() / 1_000) * 1_000).toISOString();
}

function canonicalRobinhoodBackendVerifierInstant(
  now = () => new Date(),
  label = "backend verifier clock",
) {
  return canonicalRobinhoodVerifierInstant(now, label).replace(/\.000Z$/u, "Z");
}

function usage() {
  return [
    "Usage:",
    "  finalize-robinhood-custom-launch-deployment.mjs assemble-stage --input <path> [--output <path>] [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs verify-stage --stage <path> --capture <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs stage-backend-assets --stage <path> --capture <path> --capture-attestation-bundle <path> --stage-attestation-bundle <path> --backend-service-root <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs verify-backend-import --stage <path> --backend-input <path> --backend-attestation-bundle <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs authorize-backend --stage <path> --capture <path> --backend-input <path> --backend-attestation-bundle <path> [--output <path>] [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs promote --stage <path> --capture <path> --backend-input <path> --backend-attestation-bundle <path> --backend-authorization <path> --backend-authorization-attestation-bundle <path> [--output <path>] [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs verify-promotion --bundle <path> --stage <path> --capture <path> --backend-input <path> --backend-attestation-bundle <path> --backend-authorization <path> --backend-authorization-attestation-bundle <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs materialize-release-assets --bundle <path> --stage <path> --capture <path> --backend-input <path> --backend-attestation-bundle <path> --backend-authorization <path> --backend-authorization-attestation-bundle <path> --asset-output-root <path> [--repository-root <path>]",
    "  finalize-robinhood-custom-launch-deployment.mjs apply --bundle <path> --stage <path> --capture <path> --backend-input <path> --backend-attestation-bundle <path> --backend-authorization <path> --backend-authorization-attestation-bundle <path> [--repository-root <path>]",
    "",
    "assemble-stage exclusively creates the closed phase-A asset handoff.",
    "verify-backend-import performs a fresh, read-only validation of the exact public input, stage binding and protected-main Sigstore identity.",
    "promote requires the public-safe backend/Fly evidence, its portable attestation and the separately attested backend authorization.",
    "materialize-release-assets exclusively emits exact live/binding bytes to an empty external tree.",
    "apply is read-only: it fresh-rechecks L2/L1, Sourcify and backend state against landed evidence.",
  ].join("\n");
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!new Set([
    "assemble-stage", "verify-stage", "stage-backend-assets", "verify-backend-import",
    "authorize-backend", "promote",
    "verify-promotion", "materialize-release-assets", "apply",
  ]).has(command)
    || rest.length % 2 !== 0) {
    throw new TypeError(usage());
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!new Set([
      "--input", "--capture", "--output", "--bundle", "--stage", "--repository-root",
      "--backend-service-root", "--backend-input", "--backend-authorization",
      "--backend-attestation-bundle",
      "--backend-authorization-attestation-bundle",
      "--capture-attestation-bundle", "--stage-attestation-bundle",
      "--source-verify-proof", "--source-verify-attestation-bundle",
      "--source-verify-run-id", "--source-verify-run-attempt",
      "--source-verify-artifact-id", "--source-verify-artifact-digest",
      "--asset-output-root",
    ]).has(flag)
      || values.has(flag) || typeof value !== "string" || value.length === 0) {
      throw new TypeError(usage());
    }
    values.set(flag, value);
  }
  const repositoryRoot = path.resolve(values.get("--repository-root") ?? ".");
  const expected = {
    "assemble-stage": ["--input"],
    "verify-stage": ["--stage", "--capture"],
    "stage-backend-assets": [
      "--stage", "--capture", "--capture-attestation-bundle",
      "--stage-attestation-bundle", "--backend-service-root",
    ],
    "verify-backend-import": ["--stage", "--backend-input", "--backend-attestation-bundle"],
    "authorize-backend": ["--stage", "--capture", "--backend-input",
      "--backend-attestation-bundle"],
    promote: ["--stage", "--capture", "--backend-input", "--backend-attestation-bundle",
      "--backend-authorization", "--backend-authorization-attestation-bundle"],
    "verify-promotion": ["--bundle", "--stage", "--capture", "--backend-input",
      "--backend-attestation-bundle", "--backend-authorization",
      "--backend-authorization-attestation-bundle"],
    "materialize-release-assets": ["--bundle", "--stage", "--capture", "--backend-input",
      "--backend-attestation-bundle", "--backend-authorization",
      "--backend-authorization-attestation-bundle", "--asset-output-root"],
    apply: ["--bundle", "--stage", "--capture", "--backend-input",
      "--backend-attestation-bundle", "--backend-authorization",
      "--backend-authorization-attestation-bundle"],
  }[command];
  const portableEvidenceFlags = [
    "--capture-attestation-bundle", "--stage-attestation-bundle",
    "--source-verify-proof", "--source-verify-attestation-bundle",
    "--source-verify-run-id", "--source-verify-run-attempt",
    "--source-verify-artifact-id", "--source-verify-artifact-digest",
  ];
  const permitted = new Set([...expected, ...portableEvidenceFlags, "--repository-root",
    ...(new Set(["assemble-stage", "authorize-backend", "promote"]).has(command)
      ? ["--output"] : [])]);
  if (expected.some((flag) => !values.has(flag))
    || [...values.keys()].some((flag) => !permitted.has(flag))) throw new TypeError(usage());
  if ((command === "stage-backend-assets") !== values.has("--backend-service-root")) {
    throw new TypeError(usage());
  }
  return {
    command,
    repositoryRoot,
    inputPath: values.get("--input") ?? null,
    outputPath: values.get("--output") ?? null,
    bundlePath: values.get("--bundle") ?? null,
    stagePath: values.get("--stage") ?? null,
    capturePath: values.get("--capture") ?? null,
    backendInputPath: values.get("--backend-input") ?? null,
    backendAttestationBundlePath: values.get("--backend-attestation-bundle") ?? null,
    backendAuthorizationPath: values.get("--backend-authorization") ?? null,
    backendAuthorizationAttestationBundlePath:
      values.get("--backend-authorization-attestation-bundle") ?? null,
    captureAttestationBundlePath: values.get("--capture-attestation-bundle") ?? null,
    stageAttestationBundlePath: values.get("--stage-attestation-bundle") ?? null,
    sourceVerifyProofPath: values.get("--source-verify-proof") ?? null,
    sourceVerifyAttestationBundlePath:
      values.get("--source-verify-attestation-bundle") ?? null,
    sourceVerifyRunId: values.get("--source-verify-run-id") ?? null,
    sourceVerifyRunAttempt: values.get("--source-verify-run-attempt") ?? null,
    sourceVerifyArtifactId: values.get("--source-verify-artifact-id") ?? null,
    sourceVerifyArtifactDigest: values.get("--source-verify-artifact-digest") ?? null,
    backendServiceRoot: values.get("--backend-service-root") ?? null,
    assetOutputRoot: values.get("--asset-output-root") ?? null,
  };
}

function serialized(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function captureDependenciesFor(options, input, dependencies) {
  if (dependencies.captureDependencies !== undefined) {
    return dependencies.captureDependencies;
  }
  if (options.command === "assemble-stage") return {};
  const observedAt = input?.capture?.observedAt;
  if (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("historical capture replay lacks its authenticated observation time");
  }
  return { now: () => new Date(observedAt) };
}

async function readJsonPath(value, {
  label = "JSON evidence input",
  maximumBytes = 64 * 1024 * 1024,
} = {}) {
  const absolute = path.resolve(value);
  let handle;
  try {
    try {
      handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      throw new TypeError(`${label} must be a bounded regular file`, { cause: error });
    }
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes) {
      throw new TypeError(`${label} must be a bounded regular file`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
      throw new TypeError(`${label} changed or exceeded its bound while being read`);
    }
    const source = decodeExactUtf8(bytes, label);
    return {
      path: absolute,
      bytes,
      value: parseStrictJson(source, { maximumBytes, maximumDepth: 512 }),
    };
  } finally {
    await handle?.close();
  }
}

async function readOpaquePath(value, label) {
  const absolute = path.resolve(value);
  let handle;
  try {
    try {
      handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      throw new TypeError(`${label} must be a bounded regular file`, { cause: error });
    }
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 16 * 1024 * 1024) {
      throw new TypeError(`${label} must be a bounded regular file`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size || bytes.byteLength > 16 * 1024 * 1024) {
      throw new TypeError(`${label} changed or exceeded its bound while being read`);
    }
    return { path: absolute, bytes };
  } finally {
    await handle?.close();
  }
}

async function readEvidenceSet(loaders, maximumBytes = 128 * 1024 * 1024) {
  const values = [];
  let total = 0;
  for (const load of loaders) {
    const value = await load();
    total += value.bytes.byteLength;
    if (total > maximumBytes) {
      throw new TypeError("combined evidence inputs exceed the aggregate 128 MiB limit");
    }
    values.push(value);
  }
  return values;
}

async function freshGithubTrustedRoot() {
  const result = await execFileAsync("gh", ["attestation", "trusted-root"], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (Buffer.from(result.stderr ?? "").length !== 0) {
    throw new TypeError("GitHub trusted-root command returned unexpected diagnostics");
  }
  const bytes = Buffer.from(result.stdout);
  if (bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
    throw new TypeError("GitHub CLI embedded-TUF trusted root is invalid");
  }
  return bytes;
}

async function verifyPortableGithubAttestation({
  subjectBytes,
  bundleBytes,
  trustedRootPath,
  repository,
  workflow,
  sourceRef,
  sourceRevision,
}) {
  if (!Buffer.isBuffer(subjectBytes) || subjectBytes.byteLength < 1
    || subjectBytes.byteLength > 128 * 1024 * 1024
    || !Buffer.isBuffer(bundleBytes) || bundleBytes.byteLength < 1
    || bundleBytes.byteLength > 16 * 1024 * 1024) {
    throw new TypeError("GitHub attestation subject or bundle bytes are invalid");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "programmable-gh-attestation-"));
  const subjectPath = path.join(temporary, "subject");
  const bundlePath = path.join(temporary, "bundle.json");
  try {
    await Promise.all([
      writeFile(subjectPath, subjectBytes, { flag: "wx", mode: 0o600 }),
      writeFile(bundlePath, bundleBytes, { flag: "wx", mode: 0o600 }),
    ]);
    const result = await execFileAsync("gh", [
      "attestation", "verify", subjectPath,
      "--bundle", bundlePath,
      "--custom-trusted-root", trustedRootPath,
      "--repo", repository,
      "--signer-workflow", `${repository}/${workflow}`,
      "--source-ref", sourceRef,
      "--source-digest", sourceRevision,
      "--signer-digest", sourceRevision,
      "--deny-self-hosted-runners",
      "--format", "json",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
    if (result.stderr.length !== 0) {
      throw new TypeError("GitHub offline attestation verification returned diagnostics");
    }
    return sha256Digest(Buffer.from(result.stdout, "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function withFreshGithubTrustedRoot(callback) {
  const trustedRootBytes = await freshGithubTrustedRoot();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "programmable-gh-trusted-root-"));
  const trustedRootPath = path.join(temporary, "trusted-root.jsonl");
  try {
    await writeFile(trustedRootPath, trustedRootBytes, { flag: "wx", mode: 0o600 });
    return await callback({ trustedRootBytes, trustedRootPath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function withPinnedBackendCosign({ subjectBytes, bundleBytes }, callback) {
  const trustOverride = Object.keys(process.env).sort().find((name) =>
    /^(?:COSIGN|FULCIO|REKOR|SIGSTORE|TUF)_/u.test(name));
  if (trustOverride !== undefined) {
    throw new TypeError("backend Sigstore verification rejects trust override environment");
  }
  const configured = process.env.PROGRAMMABLE_COSIGN_BIN;
  if (typeof configured !== "string" || !path.isAbsolute(configured)) {
    throw new TypeError("backend Sigstore verification requires absolute PROGRAMMABLE_COSIGN_BIN");
  }
  let handle;
  let bytes;
  try {
    handle = await open(configured, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 256 * 1024 * 1024) {
      throw new TypeError("configured Cosign verifier must be a bounded physical file");
    }
    bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      throw new TypeError("configured Cosign verifier changed while being read");
    }
  } catch (error) {
    throw new TypeError("configured Cosign verifier must be a bounded physical file", {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
  if (sha256Digest(bytes) !== ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256) {
    throw new TypeError("configured Cosign verifier differs from pinned v3.1.3 bytes");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "programmable-cosign-v3-"));
  const executable = path.join(temporary, "cosign");
  const subjectPath = path.join(temporary, "backend-promotion-input.public.json");
  const bundlePath = path.join(temporary, "backend-promotion-input.attestation.json");
  try {
    await Promise.all([
      writeFile(executable, bytes, { flag: "wx", mode: 0o700 }),
      writeFile(subjectPath, subjectBytes, { flag: "wx", mode: 0o600 }),
      writeFile(bundlePath, bundleBytes, { flag: "wx", mode: 0o600 }),
    ]);
    return await callback({ executable, subjectPath, bundlePath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function requireGithubContext(capture, repositoryRoot) {
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: ROBINHOOD_PRODUCTION_REPOSITORY,
    GITHUB_REPOSITORY_ID: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    GITHUB_REF: ROBINHOOD_PRODUCTION_REF,
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: capture.sourceOrigin.revision,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new TypeError(`production capture requires protected GitHub context ${name}`);
    }
  }
  const checkout = await requireExactProtectedCheckout(repositoryRoot);
  if (checkout.head !== capture.sourceOrigin.revision
    || checkout.tree !== capture.sourceOrigin.tree) {
    throw new TypeError("production capture source differs from the exact protected checkout");
  }
}

async function gitOutput(repositoryRoot, args) {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.stderr.length !== 0) throw new TypeError("protected Git audit returned diagnostics");
  return result.stdout.trim();
}

async function gitBytes(repositoryRoot, args) {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30_000,
  });
  if (Buffer.from(result.stderr ?? "").length !== 0) {
    throw new TypeError("protected Git byte audit returned diagnostics");
  }
  return Buffer.from(result.stdout);
}

async function requireExactProtectedCheckout(repositoryRoot) {
  const [head, tree, origin, status, remote] = await Promise.all([
    gitOutput(repositoryRoot, ["rev-parse", "HEAD^{commit}"]),
    gitOutput(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    gitOutput(repositoryRoot, ["rev-parse", "refs/remotes/origin/production^{commit}"]),
    gitOutput(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    gitOutput(repositoryRoot, ["remote", "get-url", "origin"]),
  ]);
  const symbolic = await execFileAsync("git", [
    "-C", repositoryRoot, "symbolic-ref", "-q", "HEAD",
  ], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 })
    .then((result) => ({ code: 0, result }))
    .catch((error) => ({ code: error?.code, stdout: error?.stdout, stderr: error?.stderr }));
  if (symbolic.code === 0 || symbolic.code !== 1
    || String(symbolic.stdout ?? "").length !== 0
    || String(symbolic.stderr ?? "").length !== 0) {
    throw new TypeError("protected production checkout must be detached HEAD");
  }
  if (origin !== head) throw new TypeError("protected origin/production differs from current HEAD");
  if (status !== "") throw new TypeError("protected production checkout must be clean");
  if (remote !== "https://github.com/programmablehq/PROGRAMMABLE") {
    throw new TypeError("protected production checkout origin is not canonical PROGRAMMABLE");
  }
  return { head, tree };
}

async function requireCurrentProtectedContext(
  repositoryRoot,
  historicalRevision,
  { requireDistinct = true } = {},
) {
  const { head, tree } = await requireExactProtectedCheckout(repositoryRoot);
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: ROBINHOOD_PRODUCTION_REPOSITORY,
    GITHUB_REPOSITORY_ID: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    GITHUB_REF: ROBINHOOD_PRODUCTION_REF,
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: head,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new TypeError(`later promotion phase requires protected current context ${name}`);
    }
  }
  await gitOutput(repositoryRoot, ["merge-base", "--is-ancestor", historicalRevision, head]);
  const historicalTree = await gitOutput(repositoryRoot,
    ["rev-parse", `${historicalRevision}^{tree}`]);
  if (requireDistinct && (head === historicalRevision || tree === historicalTree)) {
    throw new TypeError("later promotion phase must be distinct from staged source");
  }
  return { head, tree };
}

async function sourceVerifyWorkflowSha(repositoryRoot, revision) {
  const result = await execFileAsync("git", [
    "-C", repositoryRoot, "show", `${revision}:.github/workflows/verify.yml`,
  ], { encoding: null, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
  if (Buffer.from(result.stderr ?? "").length !== 0) {
    throw new TypeError("historical Verify workflow Git read returned diagnostics");
  }
  return sha256Digest(Buffer.from(result.stdout));
}

function portableCoordinates(options) {
  const values = {
    runId: options.sourceVerifyRunId,
    runAttempt: options.sourceVerifyRunAttempt,
    artifactId: options.sourceVerifyArtifactId,
    artifactDigest: options.sourceVerifyArtifactDigest,
  };
  if (!/^[1-9][0-9]*$/u.test(values.runId ?? "")
    || !/^[1-9][0-9]*$/u.test(values.runAttempt ?? "")
    || !/^[1-9][0-9]*$/u.test(values.artifactId ?? "")
    || !/^sha256:[0-9a-f]{64}$/u.test(values.artifactDigest ?? "")) {
    throw new TypeError("portable source Verify coordinates are invalid");
  }
  return values;
}

async function loadPortableCaptureSidecars(options, { requireStage = false } = {}) {
  if (options.captureAttestationBundlePath === null
    || options.sourceVerifyProofPath === null
    || options.sourceVerifyAttestationBundlePath === null
    || (requireStage && options.stageAttestationBundlePath === null)) {
    throw new TypeError("protected phase requires portable capture/stage/source attestations");
  }
  const [captureBundle, sourceProof, sourceProofBundle, stageBundle] = await Promise.all([
    readOpaquePath(options.captureAttestationBundlePath, "capture attestation bundle"),
    readOpaquePath(options.sourceVerifyProofPath, "historical production Verify proof"),
    readOpaquePath(options.sourceVerifyAttestationBundlePath,
      "historical production Verify attestation"),
    requireStage
      ? readOpaquePath(options.stageAttestationBundlePath, "stage attestation bundle")
      : Promise.resolve(null),
  ]);
  return {
    captureBundle,
    sourceProof,
    sourceProofBundle,
    stageBundle,
    coordinates: portableCoordinates(options),
  };
}

async function verifyPortableSourceProof({
  repositoryRoot,
  capture,
  portable,
  trustedRootPath,
}) {
  const workflowFileSha256 = await sourceVerifyWorkflowSha(
    repositoryRoot,
    capture.sourceOrigin.revision,
  );
  parseProductionVerifyProofV1(portable.sourceProof.bytes, {
    commitSha: capture.sourceOrigin.revision,
    treeSha: capture.sourceOrigin.tree,
    workflowFileSha256,
    runId: Number(portable.coordinates.runId),
    runAttempt: Number(portable.coordinates.runAttempt),
    eventName: "push",
    verificationMode: "change",
  });
  await verifyPortableGithubAttestation({
    subjectBytes: portable.sourceProof.bytes,
    bundleBytes: portable.sourceProofBundle.bytes,
    trustedRootPath,
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    workflow: ".github/workflows/verify.yml",
    sourceRef: ROBINHOOD_PRODUCTION_REF,
    sourceRevision: capture.sourceOrigin.revision,
  });
}

async function verifyGithubCaptureAttestation({
  captureBytes,
  capture,
  repositoryRoot,
  portable,
  now = () => new Date(),
}) {
  await requireGithubContext(capture, repositoryRoot);
  return withFreshGithubTrustedRoot(async ({ trustedRootBytes, trustedRootPath }) => {
    await verifyPortableGithubAttestation({
      subjectBytes: captureBytes,
      bundleBytes: portable.captureBundle.bytes,
      trustedRootPath,
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      workflow: ROBINHOOD_CAPTURE_WORKFLOW,
      sourceRef: ROBINHOOD_PRODUCTION_REF,
      sourceRevision: capture.sourceOrigin.revision,
    });
    await verifyPortableSourceProof({
      repositoryRoot,
      capture,
      portable,
      trustedRootPath,
    });
    const verifiedAt = canonicalRobinhoodVerifierInstant(now, "capture verifier clock");
    return buildRobinhoodCaptureAuthorization({
      schemaVersion: ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
      trustClass: "github-artifact-attestation",
      subjectPath: ROBINHOOD_CAPTURE_PATH,
      subjectSha256: sha256CaptureBytes(captureBytes),
      attestationBundlePath: ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH,
      attestationBundleSha256: sha256Digest(portable.captureBundle.bytes),
      trustedRootSource: "github-cli-embedded-tuf",
      trustedRootSha256: sha256Digest(trustedRootBytes),
      productionVerifyProofPath: ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
      productionVerifyProofByteLength: String(portable.sourceProof.bytes.byteLength),
      productionVerifyProofSha256: sha256Digest(portable.sourceProof.bytes),
      productionVerifyAttestationBundlePath:
        ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH,
      productionVerifyAttestationBundleByteLength:
        String(portable.sourceProofBundle.bytes.byteLength),
      productionVerifyAttestationBundleSha256:
        sha256Digest(portable.sourceProofBundle.bytes),
      productionVerifyRunId: portable.coordinates.runId,
      productionVerifyRunAttempt: portable.coordinates.runAttempt,
      productionVerifyArtifactId: portable.coordinates.artifactId,
      productionVerifyArtifactDigest: portable.coordinates.artifactDigest,
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
      workflow: ROBINHOOD_CAPTURE_WORKFLOW,
      sourceRef: ROBINHOOD_PRODUCTION_REF,
      sourceRevision: capture.sourceOrigin.revision,
      sourceTree: capture.sourceOrigin.tree,
      sourceClosureDigest: capture.sourceOrigin.sourceClosureDigest,
      verifiedAt,
      verificationDigest: null,
    });
  });
}

async function authorizationFor(inputFile, dependencies, options = null) {
  const authorize = dependencies.authorizeCapture ?? verifyGithubCaptureAttestation;
  const portable = dependencies.authorizeCapture === undefined
    ? await loadPortableCaptureSidecars(options) : null;
  const result = await authorize({
    captureBytes: inputFile.bytes,
    capture: inputFile.value.capture,
    repositoryRoot: options?.repositoryRoot,
    portable,
    now: dependencies.captureVerificationNow,
  });
  if (result?.trustClass === "test-only" && dependencies.allowTestOnly !== true) {
    throw new TypeError("CLI rejects test-only capture authorization");
  }
  return result;
}

async function embeddedStageAuthorization({ options, stageFile, inputFile, dependencies }) {
  if (dependencies.authorizeCapture !== undefined) {
    return {
      authorization: await authorizationFor(inputFile, dependencies, options),
      portable: null,
    };
  }
  const capture = inputFile.value.capture;
  const portable = await loadPortableCaptureSidecars(options, { requireStage: true });
  await requireCurrentProtectedContext(
    options.repositoryRoot,
    capture.sourceOrigin.revision,
    { requireDistinct: options.command !== "verify-stage" },
  );
  await withFreshGithubTrustedRoot(async ({ trustedRootPath }) => {
    await verifyPortableGithubAttestation({
      subjectBytes: inputFile.bytes,
      bundleBytes: portable.captureBundle.bytes,
      trustedRootPath,
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      workflow: ROBINHOOD_CAPTURE_WORKFLOW,
      sourceRef: ROBINHOOD_PRODUCTION_REF,
      sourceRevision: capture.sourceOrigin.revision,
    });
    await verifyPortableSourceProof({
      repositoryRoot: options.repositoryRoot,
      capture,
      portable,
      trustedRootPath,
    });
    await verifyPortableGithubAttestation({
      subjectBytes: stageFile.bytes,
      bundleBytes: portable.stageBundle.bytes,
      trustedRootPath,
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      workflow: ROBINHOOD_CAPTURE_WORKFLOW,
      sourceRef: ROBINHOOD_PRODUCTION_REF,
      sourceRevision: capture.sourceOrigin.revision,
    });
  });
  const authorization = stageFile.value.captureAuthorization;
  const expected = {
    subjectPath: ROBINHOOD_CAPTURE_PATH,
    subjectSha256: sha256CaptureBytes(inputFile.bytes),
    attestationBundlePath: ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH,
    attestationBundleSha256: sha256Digest(portable.captureBundle.bytes),
    productionVerifyProofPath: ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
    productionVerifyProofByteLength: String(portable.sourceProof.bytes.byteLength),
    productionVerifyProofSha256: sha256Digest(portable.sourceProof.bytes),
    productionVerifyAttestationBundlePath:
      ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH,
    productionVerifyAttestationBundleByteLength:
      String(portable.sourceProofBundle.bytes.byteLength),
    productionVerifyAttestationBundleSha256:
      sha256Digest(portable.sourceProofBundle.bytes),
    productionVerifyRunId: portable.coordinates.runId,
    productionVerifyRunAttempt: portable.coordinates.runAttempt,
    productionVerifyArtifactId: portable.coordinates.artifactId,
    productionVerifyArtifactDigest: portable.coordinates.artifactDigest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (authorization?.[key] !== value) {
      throw new TypeError(`embedded capture authorization ${key} differs from portable proof`);
    }
  }
  return { authorization, portable };
}

async function verifySigstoreBackendCaptureAttestation({
  inputFile,
  attestationBundleFile,
  now = () => new Date(),
}) {
  const capture = inputFile.value;
  validateSigstoreMessageBundleV03({
    bundleBytes: attestationBundleFile.bytes,
    subjectBytes: inputFile.bytes,
  });
  return withPinnedBackendCosign({
    subjectBytes: inputFile.bytes,
    bundleBytes: attestationBundleFile.bytes,
  }, async ({ executable, subjectPath, bundlePath }) => {
    const result = await execFileAsync(executable, buildRobinhoodBackendCosignVerifyBlobArgs({
      subjectPath,
      bundlePath,
      sourceCommit: capture.backendSource.sourceCommit,
    }), { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
    if (Buffer.byteLength(result.stdout) > 16 * 1024 * 1024
      || Buffer.byteLength(result.stderr) > 16 * 1024 * 1024) {
      throw new TypeError("Cosign backend verification diagnostics exceeded their bound");
    }
    const verifiedAt = canonicalRobinhoodBackendVerifierInstant(now);
    return {
      authorization: buildRobinhoodBackendCaptureAuthorization({
        schemaVersion: ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
        trustClass: ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
        subjectPath: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
        subjectSha256: sha256Digest(inputFile.bytes),
        attestationBundlePath: ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
        attestationBundleSha256: sha256Digest(attestationBundleFile.bytes),
        bundleMediaType: SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
        verifier: {
          name: "cosign",
          version: ROBINHOOD_BACKEND_COSIGN_VERSION,
          sha256: ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
        },
        certificateIdentity: ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
        certificateOidcIssuer: ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
        certificateGithubWorkflowName: ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
        certificateGithubWorkflowRepository: capture.backendSource.repository,
        certificateGithubWorkflowRef: ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
        certificateGithubWorkflowSha: resolveCaptureWorkflowCommit(capture.backendSource.sourceCommit),
        certificateGithubWorkflowTrigger: ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
        repository: capture.backendSource.repository,
        repositoryId: "1318883798",
        workflow: ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
        sourceRef: ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
        sourceRevision: capture.backendSource.sourceCommit,
        sourceTree: capture.backendSource.sourceTree,
        verifiedAt,
        verificationDigest: null,
      }),
    };
  });
}

async function backendAuthoritiesFor({
  options,
  stageBundle,
  stageBundleBytes,
  backendInputFile,
  backendAttestationBundleFile,
  backendAuthorizationFile,
  backendAuthorizationAttestationBundleFile,
  embeddedBackendCaptureAuthorization = null,
  dependencies,
}) {
  const backendValidationNow = options.command !== "promote"
    ? () => new Date(backendInputFile.value.observedAt)
    : dependencies.backendDependencies?.now;
  const backend = validateRobinhoodBackendPromotionPublicInput({
    input: backendInputFile.value,
    stageBundle: backendStageContext({ repositoryRoot: options.repositoryRoot, stageBundle }),
    now: backendValidationNow,
  });
  const authorizeCapture = dependencies.authorizeBackendCapture
    ?? verifySigstoreBackendCaptureAttestation;
  const captureResult = await authorizeCapture({
    inputFile: backendInputFile,
    attestationBundleFile: backendAttestationBundleFile,
    stageBundle,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    now: embeddedBackendCaptureAuthorization === null
      ? dependencies.backendVerificationNow
      : () => new Date(embeddedBackendCaptureAuthorization.verifiedAt),
  });
  const freshlyVerifiedCaptureAuthorization = captureResult?.authorization ?? captureResult;
  const backendCaptureAuthorization = embeddedBackendCaptureAuthorization
    ?? freshlyVerifiedCaptureAuthorization;
  validateRobinhoodBackendCaptureAuthorization({
    authorization: backendCaptureAuthorization,
    inputBytes: backendInputFile.bytes,
    attestationBundleBytes: backendAttestationBundleFile.bytes,
    input: backendInputFile.value,
    allowTestOnly: dependencies.backendDependencies?.allowTestOnly === true,
  });
  const provisionalBinding = structuredClone(stageBundle.artifacts.cliReleaseBinding.value);
  provisionalBinding.evidence.backend = structuredClone(backend.backendReleaseEvidence);
  const authorizePromotion = dependencies.authorizeBackendPromotion;
  const result = authorizePromotion === undefined
    ? await verifyPortableBackendAuthorization({
      options,
      authorizationFile: backendAuthorizationFile,
      attestationBundleFile: backendAuthorizationAttestationBundleFile,
      stageBundle,
      stageBundleBytes,
      backendInputFile,
      backendReleaseEvidence: backend.backendReleaseEvidence,
    })
    : await authorizePromotion({
    binding: provisionalBinding,
    proofPath: backendAuthorizationFile.path,
    authorizationAttestationBundlePath:
      backendAuthorizationAttestationBundleFile.path,
  });
  const backendAuthorization = result?.authorization ?? result;
  if ((backendCaptureAuthorization?.trustClass === "test-only"
      || backendAuthorization?.trustClass === "test-only")
    && dependencies.backendDependencies?.allowTestOnly !== true) {
    throw new TypeError("CLI rejects test-only backend promotion authorization");
  }
  return {
    backendCaptureAuthorization,
    backendAuthorization,
    backendAttestationBundleBytes: backendAttestationBundleFile.bytes,
  };
}

async function verifyPortableBackendAuthorization({
  options,
  authorizationFile,
  attestationBundleFile,
  stageBundle,
  stageBundleBytes,
  backendInputFile,
  backendReleaseEvidence,
}) {
  const authorization = validateRobinhoodBackendAuthorization({
    authorization: authorizationFile.value,
    stageBundle,
    stageBundleBytes,
    backendPromotionInputBytes: backendInputFile.bytes,
    backendPromotionPublicInput: backendInputFile.value,
    backendReleaseEvidence,
  });
  const checkout = await requireExactProtectedCheckout(options.repositoryRoot);
  await gitOutput(options.repositoryRoot, [
    "merge-base", "--is-ancestor", authorization.stageSourceRevision,
    authorization.producerRevision,
  ]);
  await gitOutput(options.repositoryRoot, [
    "merge-base", "--is-ancestor", authorization.producerRevision, checkout.head,
  ]);
  const producerTree = await gitOutput(options.repositoryRoot, [
    "rev-parse", `${authorization.producerRevision}^{tree}`,
  ]);
  if (producerTree !== authorization.producerTree
    || authorization.producerRevision === authorization.stageSourceRevision
    || authorization.producerTree === authorization.stageSourceTree
    || (options.command !== "promote" && options.command !== "materialize-release-assets"
      && (checkout.head === authorization.stageSourceRevision
        || checkout.tree === authorization.stageSourceTree))) {
    throw new TypeError("backend authorization producer/source identity is invalid");
  }
  if (new Set(["promote", "materialize-release-assets"]).has(options.command)) {
    if (checkout.head !== authorization.producerRevision
      || checkout.tree !== authorization.producerTree) {
      throw new TypeError("Phase B producer must run at the attested authorization commit");
    }
  } else if (checkout.head === authorization.producerRevision
    || checkout.tree === authorization.producerTree) {
    throw new TypeError("Phase B evidence verification requires a distinct later commit");
  }
  const [producerStageBytes, producerBackendBytes] = await Promise.all([
    gitBytes(options.repositoryRoot, [
      "show", `${authorization.producerRevision}:${ROBINHOOD_STAGE_BUNDLE_PATH}`,
    ]),
    gitBytes(options.repositoryRoot, [
      "show", `${authorization.producerRevision}:${ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH}`,
    ]),
  ]);
  if (!producerStageBytes.equals(stageBundleBytes)
    || !producerBackendBytes.equals(backendInputFile.bytes)) {
    throw new TypeError("Phase B producer Git blobs differ from exact promotion inputs");
  }
  await withFreshGithubTrustedRoot(({ trustedRootPath }) =>
    verifyPortableGithubAttestation({
      subjectBytes: authorizationFile.bytes,
      bundleBytes: attestationBundleFile.bytes,
      trustedRootPath,
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      workflow: backendTools.ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
      sourceRef: ROBINHOOD_PRODUCTION_REF,
      sourceRevision: authorization.producerRevision,
    }));
  return { authorization };
}

async function safeBundleOutput(repositoryRoot, outputPath, canonicalPath, label) {
  const root = await realpath(repositoryRoot);
  const chosen = path.resolve(outputPath ?? path.join(root, canonicalPath));
  if (chosen.startsWith(`${root}${path.sep}`)) {
    if (chosen !== path.join(root, canonicalPath)) {
      throw new TypeError(`in-repository ${label} output must use its canonical path`);
    }
    await assertNoSymlinkWritePath(root, chosen, `${label} output`);
    return chosen;
  }
  const parent = path.dirname(chosen);
  const realParent = await realpath(parent);
  if (path.join(realParent, path.basename(chosen)) !== chosen) {
    throw new TypeError("outside-repository bundle output contains a symbolic-link parent");
  }
  try {
    const metadata = await lstat(chosen);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new TypeError(`${label} output is not a regular file target`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return chosen;
}

async function assembleStage(options, dependencies) {
  const { repositoryRoot, inputPath, outputPath } = options;
  const inputFile = await readJsonPath(inputPath, {
    label: "postdeployment capture", maximumBytes: 128 * 1024 * 1024,
  });
  const captureAuthorization = await authorizationFor(inputFile, dependencies, options);
  const bundle = await materializeRobinhoodStageBundle({
    repositoryRoot,
    input: inputFile.value,
    inputBytes: inputFile.bytes,
    captureAuthorization,
    captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
  });
  const verified = await verifyRobinhoodStageBundle({
    repositoryRoot,
    bundle,
    input: inputFile.value,
    inputBytes: inputFile.bytes,
    captureAuthorization,
    captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
  });
  const bytes = serialized(bundle);
  const absoluteOutput = await safeBundleOutput(
    repositoryRoot,
    outputPath,
    DEFAULT_STAGE_BUNDLE_PATH,
    "stage bundle",
  );
  await atomicCreate(absoluteOutput, bytes, 0o644);
  return {
    command: "assemble-stage",
    outputPath: absoluteOutput,
    outputSha256: sha256Digest(bytes),
    chainDeploymentDescriptorDigest: bundle.finalizedBindings.chainDeploymentDescriptorDigest,
    stageBundleDigest: bundle.stageBundleDigest,
    startBlock: bundle.finalizedBindings.startBlock,
    disposition: bundle.state,
    releaseReady: verified.releaseReady,
    wroteLiveArtifacts: false,
  };
}

async function verifyStage(options, dependencies) {
  const { repositoryRoot, stagePath, capturePath } = options;
  const bundleFile = await readJsonPath(stagePath, { label: "stage bundle" });
  const inputFile = await readJsonPath(capturePath, {
    label: "postdeployment capture", maximumBytes: 128 * 1024 * 1024,
  });
  const { authorization: captureAuthorization } = await embeddedStageAuthorization({
    options,
    stageFile: bundleFile,
    inputFile,
    dependencies,
  });
  return {
    command: "verify-stage",
    stagePath: path.resolve(stagePath),
    ...await verifyRobinhoodStageBundle({
      repositoryRoot,
      bundle: bundleFile.value,
      input: inputFile.value,
      inputBytes: inputFile.bytes,
      captureAuthorization,
      captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
    }),
    wroteLiveArtifacts: false,
  };
}

async function stageBackendAssets(options, dependencies) {
  const { repositoryRoot, stagePath, capturePath, backendServiceRoot } = options;
  const bundleFile = await readJsonPath(stagePath, { label: "stage bundle" });
  const inputFile = await readJsonPath(capturePath, {
    label: "postdeployment capture", maximumBytes: 128 * 1024 * 1024,
  });
  const {
    authorization: captureAuthorization,
    portable,
  } = await embeddedStageAuthorization({
    options,
    stageFile: bundleFile,
    inputFile,
    dependencies,
  });
  const verified = await verifyRobinhoodStageBundle({
    repositoryRoot,
    bundle: bundleFile.value,
    input: inputFile.value,
    inputBytes: inputFile.bytes,
    captureAuthorization,
    captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
  });
  if (verified.phase !== "backend-assets" || verified.releaseReady !== false) {
    throw new TypeError("backend assets require the closed phase-A promotion bundle");
  }
  const captureAttestationBytes = portable?.captureBundle.bytes
    ?? (await readOpaquePath(
      options.captureAttestationBundlePath,
      "phase-A production capture attestation bundle",
    )).bytes;
  const stageAttestationBytes = portable?.stageBundle.bytes
    ?? (await readOpaquePath(
      options.stageAttestationBundlePath,
      "phase-A stage attestation bundle",
    )).bytes;
  if (sha256Digest(captureAttestationBytes)
    !== captureAuthorization.attestationBundleSha256) {
    throw new TypeError(
      "phase-A production capture attestation differs from the authenticated closure",
    );
  }
  const bundle = bundleFile.value;
  const artifacts = bundle.artifacts.backendRelease;
  const expectedStandardPaths = [
    ROBINHOOD_BACKEND_STANDARD_JSON_PATHS.router,
    ROBINHOOD_BACKEND_STANDARD_JSON_PATHS.graphFactory,
  ];
  if (artifacts?.chainDeployment?.path !== ROBINHOOD_BACKEND_CHAIN_DEPLOYMENT_PATH
    || artifacts?.preparedRootSourceManifest?.path !== ROBINHOOD_BACKEND_SOURCE_MANIFEST_PATH
    || !Array.isArray(artifacts?.standardJsonInputs)
    || artifacts.standardJsonInputs.length !== expectedStandardPaths.length
    || artifacts.standardJsonInputs.some((entry, index) =>
      entry.path !== expectedStandardPaths[index])) {
    throw new TypeError("phase-A backend artifact paths differ from the fixed image contract");
  }
  const targets = [
    {
      path: artifacts.chainDeployment.path,
      bytes: serialized(artifacts.chainDeployment.value),
      sha256: artifacts.chainDeployment.sha256,
    },
    {
      path: artifacts.preparedRootSourceManifest.path,
      bytes: serialized(artifacts.preparedRootSourceManifest.value),
      sha256: artifacts.preparedRootSourceManifest.sha256,
    },
    ...artifacts.standardJsonInputs.map((entry) => {
      const bytes = Buffer.from(entry.bytesBase64, "base64");
      if (bytes.length === 0 || bytes.toString("base64") !== entry.bytesBase64) {
        throw new TypeError(`backend source asset ${entry.path} has invalid exact bytes`);
      }
      return { path: entry.path, bytes, sha256: entry.sha256 };
    }),
    {
      path: ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH,
      bytes: inputFile.bytes,
      sha256: captureAuthorization.subjectSha256,
    },
    {
      path: ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH,
      bytes: captureAttestationBytes,
      sha256: captureAuthorization.attestationBundleSha256,
    },
    {
      path: ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH,
      bytes: bundleFile.bytes,
      sha256: sha256Digest(bundleFile.bytes),
    },
    {
      path: ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH,
      bytes: stageAttestationBytes,
      sha256: sha256Digest(stageAttestationBytes),
    },
  ];
  const repositoryPhysicalRoot = await realpath(repositoryRoot);
  const repositoryLexicalRoot = path.resolve(repositoryRoot);
  const requestedRoot = path.resolve(backendServiceRoot);
  const rootMetadata = await lstat(requestedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError("backend service root must be a physical directory");
  }
  const root = await realpath(requestedRoot);
  const overlaps = (left, right) => left === right
    || left.startsWith(`${right}${path.sep}`)
    || right.startsWith(`${left}${path.sep}`);
  if (requestedRoot !== root
    || overlaps(requestedRoot, repositoryLexicalRoot)
    || overlaps(root, repositoryPhysicalRoot)) {
    throw new TypeError(
      "backend service root must be a physical directory outside the PROGRAMMABLE repository",
    );
  }
  const resolved = await Promise.all(targets.map(async (target) => {
    if (sha256Digest(target.bytes) !== target.sha256) {
      throw new TypeError(`backend asset ${target.path} digest differs`);
    }
    const output = resolveInside(root, target.path, "backend release asset path");
    await assertNoSymlinkWritePath(root, output, `backend release asset ${target.path}`);
    let existing = null;
    try {
      existing = await readFile(output);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing !== null && sha256Digest(existing) !== target.sha256) {
      throw new TypeError(`existing backend release asset ${target.path} differs`);
    }
    return { ...target, output, exists: existing !== null };
  }));
  for (const target of resolved) {
    if (!target.exists) await atomicCreate(target.output, target.bytes, 0o644);
  }
  for (const target of resolved) {
    if (sha256Digest(await readFile(target.output)) !== target.sha256) {
      throw new TypeError(`staged backend release asset ${target.path} differs after write`);
    }
  }
  return {
    command: "stage-backend-assets",
    stagePath: path.resolve(stagePath),
    backendServiceRoot: root,
    backendReleaseAssetsDigest:
      bundle.backendReleaseAssets.backendReleaseAssetsDigest,
    assets: resolved.map(({ path: relativePath, output, sha256 }) => ({
      path: relativePath,
      output,
      sha256,
    })),
    releaseReady: false,
    wroteLiveArtifacts: false,
  };
}

async function authorizeBackend(options, dependencies) {
  const [stageFile, inputFile, backendInputFile, backendAttestationBundleFile] =
    await readEvidenceSet([
      () => readJsonPath(options.stagePath, { label: "stage bundle" }),
      () => readJsonPath(options.capturePath, {
        label: "postdeployment capture", maximumBytes: 128 * 1024 * 1024,
      }),
      () => readJsonPath(options.backendInputPath, {
        label: "backend promotion public input", maximumBytes: 16 * 1024 * 1024,
      }),
      () => readOpaquePath(options.backendAttestationBundlePath,
        "backend portable attestation bundle"),
    ]);
  const { authorization: captureAuthorization } = await embeddedStageAuthorization({
    options,
    stageFile,
    inputFile,
    dependencies,
  });
  await verifyRobinhoodStageBundle({
    repositoryRoot: options.repositoryRoot,
    bundle: stageFile.value,
    input: inputFile.value,
    inputBytes: inputFile.bytes,
    captureAuthorization,
    captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
  });
  const protectedContextAudit = dependencies.currentProtectedContext
    ?? requireCurrentProtectedContext;
  const protectedContext = await protectedContextAudit(
    options.repositoryRoot,
    inputFile.value.capture.sourceOrigin.revision,
  );
  const backend = validateRobinhoodBackendPromotionPublicInput({
    input: backendInputFile.value,
    stageBundle: backendStageContext({ repositoryRoot: options.repositoryRoot, stageBundle: stageFile.value }),
    now: dependencies.backendDependencies?.now,
  });
  const authorizeCapture = dependencies.authorizeBackendCapture
    ?? verifySigstoreBackendCaptureAttestation;
  const captureResult = await authorizeCapture({
    inputFile: backendInputFile,
    attestationBundleFile: backendAttestationBundleFile,
    stageBundle: stageFile.value,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    now: dependencies.backendVerificationNow,
  });
  const backendCaptureAuthorization = captureResult?.authorization ?? captureResult;
  validateRobinhoodBackendCaptureAuthorization({
    authorization: backendCaptureAuthorization,
    inputBytes: backendInputFile.bytes,
    attestationBundleBytes: backendAttestationBundleFile.bytes,
    input: backendInputFile.value,
    allowTestOnly: dependencies.backendDependencies?.allowTestOnly === true,
  });
  const authorization = buildRobinhoodBackendAuthorization({
    schemaVersion: "programmable.launch-cli-v4-backend-release-authorization.v1",
    trustClass: backendCaptureAuthorization.trustClass === "test-only"
      ? "test-only" : "github-artifact-attestation",
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    workflow: backendTools.ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
    sourceRef: ROBINHOOD_PRODUCTION_REF,
    producerRevision: protectedContext.head,
    producerTree: protectedContext.tree,
    stageSourceRevision: stageFile.value.sourceClosure.revision,
    stageSourceTree: stageFile.value.sourceClosure.tree,
    stageBundlePath: ROBINHOOD_STAGE_BUNDLE_PATH,
    stageBundleSha256: sha256Digest(stageFile.bytes),
    stageBundleDigest: stageFile.value.stageBundleDigest,
    backendPromotionPublicInputPath: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
    backendPromotionPublicInputSha256: sha256Digest(backendInputFile.bytes),
    backendPromotionPublicInputDigest: backendInputFile.value.publicInputDigest,
    backendPromotionInputDigest:
      backend.backendReleaseEvidence.backendPromotionInputDigest,
    chainDeploymentDescriptorDigest:
      backend.backendReleaseEvidence.chainDeploymentDescriptorDigest,
    backendReleaseEvidenceDigest:
      backend.backendReleaseEvidence.backendReleaseEvidenceDigest,
    runtimeReadinessNormalizedResponseSha256:
      backend.backendReleaseEvidence.runtimeReadiness.normalizedResponseSha256,
    flySafeReadbacksDigest:
      backend.backendReleaseEvidence.flyControlPlane.safeReadbacksDigest,
    observedAt: backendInputFile.value.observedAt,
    authorizationDigest: null,
  });
  validateRobinhoodBackendAuthorization({
    authorization,
    stageBundle: stageFile.value,
    stageBundleBytes: stageFile.bytes,
    backendPromotionInputBytes: backendInputFile.bytes,
    backendPromotionPublicInput: backendInputFile.value,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    allowTestOnly: dependencies.backendDependencies?.allowTestOnly === true,
  });
  const bytes = serialized(authorization);
  const absoluteOutput = await safeBundleOutput(
    options.repositoryRoot,
    options.outputPath,
    ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
    "backend authorization",
  );
  await atomicCreate(absoluteOutput, bytes, 0o644);
  return {
    command: "authorize-backend",
    outputPath: absoluteOutput,
    outputSha256: sha256Digest(bytes),
    authorizationDigest: authorization.authorizationDigest,
    producerRevision: authorization.producerRevision,
    producerTree: authorization.producerTree,
    releaseReady: false,
    publicAuthorization: false,
    publicWrites: false,
    wroteLiveArtifacts: false,
  };
}

async function verifyBackendImport(options, dependencies) {
  const [stageFile, backendInputFile, backendAttestationBundleFile] =
    await readEvidenceSet([
      () => readJsonPath(options.stagePath, { label: "stage bundle" }),
      () => readJsonPath(options.backendInputPath, {
        label: "backend promotion public input", maximumBytes: 16 * 1024 * 1024,
      }),
      () => readOpaquePath(options.backendAttestationBundlePath,
        "backend portable attestation bundle"),
    ]);
  const backend = validateRobinhoodBackendPromotionPublicInput({
    input: backendInputFile.value,
    stageBundle: backendStageContext({ repositoryRoot: options.repositoryRoot, stageBundle: stageFile.value }),
    now: dependencies.backendDependencies?.now,
  });
  const authorizeCapture = dependencies.authorizeBackendCapture
    ?? verifySigstoreBackendCaptureAttestation;
  const captureResult = await authorizeCapture({
    inputFile: backendInputFile,
    attestationBundleFile: backendAttestationBundleFile,
    stageBundle: stageFile.value,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    now: dependencies.backendVerificationNow,
  });
  const authorization = captureResult?.authorization ?? captureResult;
  validateRobinhoodBackendCaptureAuthorization({
    authorization,
    inputBytes: backendInputFile.bytes,
    attestationBundleBytes: backendAttestationBundleFile.bytes,
    input: backendInputFile.value,
    allowTestOnly: dependencies.backendDependencies?.allowTestOnly === true,
  });
  return {
    command: "verify-backend-import",
    stagePath: path.resolve(options.stagePath),
    backendInputPath: path.resolve(options.backendInputPath),
    backendAttestationBundlePath: path.resolve(options.backendAttestationBundlePath),
    backendPromotionPublicInputSha256: sha256Digest(backendInputFile.bytes),
    backendPromotionPublicInputDigest: backendInputFile.value.publicInputDigest,
    backendPromotionInputDigest:
      backend.backendReleaseEvidence.backendPromotionInputDigest,
    backendReleaseEvidenceDigest:
      backend.backendReleaseEvidence.backendReleaseEvidenceDigest,
    backendSource: structuredClone(backendInputFile.value.backendSource),
    captureVerificationDigest: authorization.verificationDigest,
    releaseReady: false,
    publicAuthorization: false,
    publicWrites: false,
    wroteLiveArtifacts: false,
  };
}

async function promotionSidecars(
  options,
  dependencies,
  { embeddedBackendCaptureAuthorization = null } = {},
) {
  const [
    stageFile,
    inputFile,
    backendInputFile,
    backendAttestationBundleFile,
    backendAuthorizationFile,
    backendAuthorizationAttestationBundleFile,
  ] = await readEvidenceSet([
    () => readJsonPath(options.stagePath, { label: "stage bundle" }),
    () => readJsonPath(options.capturePath, {
      label: "postdeployment capture", maximumBytes: 128 * 1024 * 1024,
    }),
    () => readJsonPath(options.backendInputPath, {
      label: "backend promotion public input", maximumBytes: 16 * 1024 * 1024,
    }),
    () => readOpaquePath(options.backendAttestationBundlePath,
      "backend portable attestation bundle"),
    () => readJsonPath(options.backendAuthorizationPath, {
      label: "backend authorization", maximumBytes: 1024 * 1024,
    }),
    () => readOpaquePath(
      options.backendAuthorizationAttestationBundlePath,
      "backend authorization portable attestation bundle",
    ),
  ]);
  const { authorization: captureAuthorization } = await embeddedStageAuthorization({
    options,
    stageFile,
    inputFile,
    dependencies,
  });
  const backendAuthorities = await backendAuthoritiesFor({
    options,
    stageBundle: stageFile.value,
    stageBundleBytes: stageFile.bytes,
    backendInputFile,
    backendAttestationBundleFile,
    backendAuthorizationFile,
    backendAuthorizationAttestationBundleFile,
    embeddedBackendCaptureAuthorization,
    dependencies,
  });
  return {
    stageFile,
    inputFile,
    backendInputFile,
    backendAttestationBundleFile,
    captureAuthorization,
    ...backendAuthorities,
  };
}

async function promote(options, dependencies) {
  const sidecars = await promotionSidecars(options, dependencies);
  const bundle = await materializeRobinhoodPromotionBundle({
    repositoryRoot: options.repositoryRoot,
    stageBundle: sidecars.stageFile.value,
    stageBundleBytes: sidecars.stageFile.bytes,
    input: sidecars.inputFile.value,
    inputBytes: sidecars.inputFile.bytes,
    captureAuthorization: sidecars.captureAuthorization,
    captureDependencies: captureDependenciesFor(options, sidecars.inputFile.value, dependencies),
    backendPromotionInput: sidecars.backendInputFile.value,
    backendPromotionInputBytes: sidecars.backendInputFile.bytes,
    backendAttestationBundleBytes: sidecars.backendAttestationBundleBytes,
    backendCaptureAuthorization: sidecars.backendCaptureAuthorization,
    backendAuthorization: sidecars.backendAuthorization,
    backendDependencies: dependencies.backendDependencies,
  });
  await verifyRobinhoodPromotionBundle({
    repositoryRoot: options.repositoryRoot,
    bundle,
    stageBundle: sidecars.stageFile.value,
    stageBundleBytes: sidecars.stageFile.bytes,
    input: sidecars.inputFile.value,
    inputBytes: sidecars.inputFile.bytes,
    captureAuthorization: sidecars.captureAuthorization,
    captureDependencies: captureDependenciesFor(options, sidecars.inputFile.value, dependencies),
    backendPromotionInput: sidecars.backendInputFile.value,
    backendPromotionInputBytes: sidecars.backendInputFile.bytes,
    backendAttestationBundleBytes: sidecars.backendAttestationBundleBytes,
    backendCaptureAuthorization: sidecars.backendCaptureAuthorization,
    backendAuthorization: sidecars.backendAuthorization,
    backendDependencies: dependencies.backendDependencies,
  });
  const bytes = serialized(bundle);
  const absoluteOutput = await safeBundleOutput(
    options.repositoryRoot,
    options.outputPath,
    DEFAULT_PROMOTION_BUNDLE_PATH,
    "promotion bundle",
  );
  await atomicCreate(absoluteOutput, bytes, 0o644);
  return {
    command: "promote",
    outputPath: absoluteOutput,
    outputSha256: sha256Digest(bytes),
    chainDeploymentDescriptorDigest:
      bundle.finalizedBindings.chainDeploymentDescriptorDigest,
    promotionBundleDigest: bundle.promotionBundleDigest,
    disposition: bundle.state,
    releaseReady: bundle.releaseReady,
    publicAuthorization: bundle.publicAuthorization,
    publicWrites: bundle.publicWrites,
    wroteLiveArtifacts: false,
  };
}

async function verifyPromotion(options, dependencies) {
  const bundleFile = await readJsonPath(options.bundlePath, { label: "promotion bundle" });
  const sidecars = await promotionSidecars(options, dependencies, {
    embeddedBackendCaptureAuthorization: bundleFile.value.backendCaptureAuthorization,
  });
  return {
    command: "verify-promotion",
    bundlePath: path.resolve(options.bundlePath),
    ...await verifyRobinhoodPromotionBundle({
      repositoryRoot: options.repositoryRoot,
      bundle: bundleFile.value,
      stageBundle: sidecars.stageFile.value,
      stageBundleBytes: sidecars.stageFile.bytes,
      input: sidecars.inputFile.value,
      inputBytes: sidecars.inputFile.bytes,
      captureAuthorization: sidecars.captureAuthorization,
      captureDependencies: captureDependenciesFor(options, sidecars.inputFile.value, dependencies),
      backendPromotionInput: sidecars.backendInputFile.value,
      backendPromotionInputBytes: sidecars.backendInputFile.bytes,
      backendAttestationBundleBytes: sidecars.backendAttestationBundleBytes,
      backendCaptureAuthorization: sidecars.backendCaptureAuthorization,
      backendAuthorization: sidecars.backendAuthorization,
      backendDependencies: dependencies.backendDependencies,
    }),
    wroteLiveArtifacts: false,
  };
}

async function materializeReleaseAssets(options, dependencies) {
  const bundleFile = await readJsonPath(options.bundlePath, { label: "promotion bundle" });
  const bundle = bundleFile.value;
  const sidecars = await promotionSidecars(options, dependencies, {
    embeddedBackendCaptureAuthorization: bundle.backendCaptureAuthorization,
  });
  const verified = await verifyRobinhoodPromotionBundle({
    repositoryRoot: options.repositoryRoot,
    bundle,
    stageBundle: sidecars.stageFile.value,
    stageBundleBytes: sidecars.stageFile.bytes,
    input: sidecars.inputFile.value,
    inputBytes: sidecars.inputFile.bytes,
    captureAuthorization: sidecars.captureAuthorization,
    captureDependencies: captureDependenciesFor(options, sidecars.inputFile.value, dependencies),
    backendPromotionInput: sidecars.backendInputFile.value,
    backendPromotionInputBytes: sidecars.backendInputFile.bytes,
    backendAttestationBundleBytes: sidecars.backendAttestationBundleBytes,
    backendCaptureAuthorization: sidecars.backendCaptureAuthorization,
    backendAuthorization: sidecars.backendAuthorization,
    backendDependencies: dependencies.backendDependencies,
  });
  if (!verified.releaseReady) {
    throw new TypeError("non-production promotion bundle cannot materialize release assets");
  }
  const repositoryRoot = await realpath(options.repositoryRoot);
  const requestedRoot = path.resolve(options.assetOutputRoot);
  const metadata = await lstat(requestedRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError("release asset output root must be a regular directory");
  }
  const outputRoot = await realpath(requestedRoot);
  if (outputRoot === repositoryRoot || outputRoot.startsWith(`${repositoryRoot}${path.sep}`)
    || requestedRoot !== outputRoot) {
    throw new TypeError("release asset output root must be an outside-repository physical path");
  }
  if ((await readdir(outputRoot)).length !== 0) {
    throw new TypeError("release asset output root must be empty for exclusive materialization");
  }
  const artifacts = [bundle.artifacts.liveDeployment, bundle.artifacts.cliReleaseBinding];
  const materialized = [];
  for (const artifactValue of artifacts) {
    if (artifactValue === null || typeof artifactValue !== "object"
      || typeof artifactValue.path !== "string" || artifactValue.value === undefined) {
      throw new TypeError("promotion release artifact is invalid");
    }
    const bytes = serialized(artifactValue.value);
    if (sha256Digest(bytes) !== artifactValue.sha256) {
      throw new TypeError(`promotion release artifact ${artifactValue.path} digest differs`);
    }
    const target = resolveInside(outputRoot, artifactValue.path, "release asset output path");
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await assertNoSymlinkWritePath(outputRoot, target,
      `release asset ${artifactValue.path}`);
    await atomicCreate(target, bytes, 0o644);
    materialized.push({ path: artifactValue.path, output: target, sha256: artifactValue.sha256 });
  }
  return {
    command: "materialize-release-assets",
    bundlePath: path.resolve(options.bundlePath),
    promotionBundleDigest: bundle.promotionBundleDigest,
    assetOutputRoot: outputRoot,
    assets: materialized,
    releaseReady: true,
    publicAuthorization: true,
    publicWrites: false,
    wroteLiveArtifacts: false,
  };
}

async function apply(options, dependencies) {
  const { repositoryRoot, bundlePath } = options;
  const bundleFile = await readJsonPath(bundlePath, { label: "promotion bundle" });
  const bundle = bundleFile.value;
  const sidecars = await promotionSidecars(options, dependencies, {
    embeddedBackendCaptureAuthorization: bundle.backendCaptureAuthorization,
  });
  const inputFile = sidecars.inputFile;
  const backendReplayDependencies = {
    ...(dependencies.backendDependencies ?? {}),
    now: () => new Date(sidecars.backendInputFile.value.observedAt),
  };
  const verified = await verifyRobinhoodPromotionBundle({
    repositoryRoot,
    bundle,
    stageBundle: sidecars.stageFile.value,
    stageBundleBytes: sidecars.stageFile.bytes,
    input: inputFile.value,
    inputBytes: inputFile.bytes,
    captureAuthorization: sidecars.captureAuthorization,
    captureDependencies: captureDependenciesFor(options, inputFile.value, dependencies),
    backendPromotionInput: sidecars.backendInputFile.value,
    backendPromotionInputBytes: sidecars.backendInputFile.bytes,
    backendAttestationBundleBytes: sidecars.backendAttestationBundleBytes,
    backendCaptureAuthorization: sidecars.backendCaptureAuthorization,
    backendAuthorization: sidecars.backendAuthorization,
    backendDependencies: backendReplayDependencies,
  });
  if (!verified.releaseReady) {
    throw new TypeError("non-production promotion bundle cannot authorize production apply");
  }
  const freshVerificationInstant = dependencies.freshNow?.() ?? new Date();
  const freshObservedAt = canonicalRobinhoodFreshObservedAt(
    () => freshVerificationInstant,
  );
  const freshNow = () => new Date(freshVerificationInstant.getTime());
  const freshProviders = dependencies.freshVerifyProviders
    ?? freshVerifyRobinhoodProviderReadbacks;
  const freshProviderResult = await freshProviders({
    capture: inputFile.value.capture,
    captureClosure: bundle.captureClosure,
    rpcUrls: dependencies.rpcUrls ?? {
      robinhood: [
        process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
        process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
      ],
      ethereum: [
        process.env.ETHEREUM_MAINNET_RPC_URL_PRIMARY,
        process.env.ETHEREUM_MAINNET_RPC_URL_SECONDARY,
      ],
    },
    fetch: dependencies.fetch,
    now: freshNow,
    ...dependencies.freshCaptureDependencies,
  });
  const freshSourcify = dependencies.freshVerifySourcify ?? freshVerifyRobinhoodSourcify;
  const freshSourcifyResult = await freshSourcify({
    repositoryRoot,
    captureClosure: bundle.captureClosure,
    readFile: (root, relativePath) => readFileSync(resolveInside(root, relativePath)),
    fetch: dependencies.fetch,
    now: freshNow,
  });
  const freshBackend = dependencies.freshVerifyBackend
    ?? freshVerifyRobinhoodBackendPromotionInput;
  const freshBackendResult = await freshBackend({
    stageBundle: backendStageContext({ repositoryRoot, stageBundle: sidecars.stageFile.value }),
    capturedInput: sidecars.backendInputFile.value,
    fetch: dependencies.fetch,
    flyApiToken: dependencies.flyApiToken ?? process.env.FLY_API_TOKEN,
    now: freshNow,
  });
  if (freshProviderResult.observedAt !== freshObservedAt
    || freshSourcifyResult.observedAt !== freshObservedAt
    || freshBackendResult.observedAt !== freshObservedAt) {
    throw new TypeError(
      "fresh provider, source, and backend observations do not match the apply verification instant",
    );
  }
  const preparedPath = resolveInside(repositoryRoot, ROBINHOOD_PREDEPLOYMENT_PATH);
  const preparedBefore = sha256Digest(await readFile(preparedPath));
  const live = bundle.artifacts.liveDeployment;
  const binding = bundle.artifacts.cliReleaseBinding;
  if (live.path !== ROBINHOOD_LIVE_DEPLOYMENT_PATH
    || live.path === ROBINHOOD_PREDEPLOYMENT_PATH
    || binding.path === ROBINHOOD_PREDEPLOYMENT_PATH
    || typeof binding.replacesSha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(binding.replacesSha256)) {
    throw new TypeError("promotion artifact targets are invalid");
  }
  const livePath = resolveInside(repositoryRoot, live.path);
  const bindingPath = resolveInside(repositoryRoot, binding.path);
  await assertNoSymlinkWritePath(repositoryRoot, livePath, "landed live descriptor");
  await assertNoSymlinkWritePath(repositoryRoot, bindingPath, "landed CLI release binding");
  const [liveBytes, bindingBytes] = await Promise.all([
    readFile(livePath),
    readFile(bindingPath),
  ]).catch(() => {
    throw new TypeError(
      "apply requires the exact final live descriptor and CLI binding landed by the evidence PR",
    );
  });
  if (!liveBytes.equals(serialized(live.value)) || sha256Digest(liveBytes) !== live.sha256
    || !bindingBytes.equals(serialized(binding.value))
    || sha256Digest(bindingBytes) !== binding.sha256) {
    throw new TypeError("landed release assets differ from the attested Phase B bundle");
  }
  const requireReleaseReady = dependencies.requireReleaseReady ?? requireV4ReleaseReady;
  const ready = requireReleaseReady({ repositoryRoot });
  if (ready.bindingSha256 !== binding.sha256) {
    throw new TypeError("release-ready audit differs from the attested CLI binding");
  }
  const preparedAfter = sha256Digest(await readFile(preparedPath));
  if (preparedAfter !== preparedBefore) {
    throw new Error("prepared no-broadcast artifact changed during promotion");
  }
  return {
    command: "apply",
    bundlePath: path.resolve(bundlePath),
    ...verified,
    bindingSha256: ready.bindingSha256,
    preparedArtifactPreserved: true,
    wroteLiveArtifacts: false,
    replayed: false,
    freshProviderReadbackDigest: freshProviderResult.freshReadbackDigest,
    freshSourceVerificationClosureDigest:
      freshSourcifyResult.sourceVerificationClosureDigest,
    freshBackendReadbackDigest: freshBackendResult.freshBackendReadbackDigest,
    freshObservedAt,
  };
}

async function runRobinhoodPostdeploymentCli(argv, dependencies = {}) {
  const options = parseCli(argv);
  if (allowedCommands !== null && !allowedCommands.includes(options.command)) {
    throw new TypeError("successor finalizer supports Phase B commands only");
  }
  if (options.command === "assemble-stage") return assembleStage(options, dependencies);
  if (options.command === "verify-stage") return verifyStage(options, dependencies);
  if (options.command === "stage-backend-assets") {
    return stageBackendAssets(options, dependencies);
  }
  if (options.command === "verify-backend-import") {
    return verifyBackendImport(options, dependencies);
  }
  if (options.command === "authorize-backend") return authorizeBackend(options, dependencies);
  if (options.command === "promote") return promote(options, dependencies);
  if (options.command === "verify-promotion") return verifyPromotion(options, dependencies);
  if (options.command === "materialize-release-assets") {
    return materializeReleaseAssets(options, dependencies);
  }
  return apply(options, dependencies);
}


return Object.freeze({
  canonicalRobinhoodVerifierInstant,
  canonicalRobinhoodBackendVerifierInstant,
  runRobinhoodPostdeploymentCli,
  DEFAULT_PROMOTION_BUNDLE_PATH,
  DEFAULT_STAGE_BUNDLE_PATH,
});
}

export const {
  canonicalRobinhoodVerifierInstant,
  canonicalRobinhoodBackendVerifierInstant,
  runRobinhoodPostdeploymentCli,
  DEFAULT_PROMOTION_BUNDLE_PATH,
  DEFAULT_STAGE_BUNDLE_PATH,
} = createRobinhoodPostdeploymentCli();

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRobinhoodPostdeploymentCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
