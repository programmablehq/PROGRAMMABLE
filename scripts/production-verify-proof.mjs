import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_VERIFY_PROOF_SCHEMA_VERSION =
  "programmable.production-verify-proof.v4";
export const PRODUCTION_VERIFY_PROOF_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
export const PRODUCTION_REPOSITORY = "programmablehq/programmable";
export const PRODUCTION_REPOSITORY_ID = 1_314_365_508;
export const PRODUCTION_REF = "refs/heads/production";
export const VERIFY_WORKFLOW_PATH = ".github/workflows/verify.yml";
export const VERIFY_WORKFLOW_NAME = "Verify";
export const VERIFY_SCOPE_JOB_NAME = "Change scope";
export const VERIFY_AGGREGATE_JOB_NAME = "Verify aggregate";
export const VERIFY_PROOF_JOB_NAME = "Bind production Verify proof";
export const VERIFY_INTERFACE_WORKER_JOB_NAMES = Object.freeze([
  "Interface quality and tests",
  "Interface browser and build",
]);
export const VERIFY_CONTRACT_WORKER_JOB_NAMES = Object.freeze([
  "Contracts build",
  "Contracts tests (1/2)",
  "Contracts tests (2/2)",
  "Contracts release and forks",
  "Contracts static analysis",
]);
export const PRODUCTION_VERIFY_CHANGE_MODE = "change";
export const PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE = "custom-v2-release";

export const PRODUCTION_VERIFY_SCOPE_KEYS = Object.freeze([
  "contracts",
  "custom_v2",
  "database",
  "dependencies",
  "indexer",
  "interface",
  "read_model",
]);

export const REQUIRED_PRODUCTION_VERIFY_CHECKS = Object.freeze([
  Object.freeze({ id: "secret-scan", name: "Credential leak gate", scopeKey: null }),
  Object.freeze({ id: "custom-v2", name: "Custom V2", scopeKey: "custom_v2" }),
  Object.freeze({ id: "indexer", name: "Realtime indexer", scopeKey: "indexer" }),
  Object.freeze({ id: "database-pglite", name: "Database (PGlite)", scopeKey: "database" }),
  Object.freeze({ id: "interface", name: "Interface", scopeKey: "interface" }),
  Object.freeze({ id: "contracts", name: "Contracts", scopeKey: "contracts" }),
]);

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_GITHUB_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const EXPECTED_GITHUB_API_URL = "https://api.github.com";

function isProductionRepository(value) {
  return typeof value === "string"
    && value.toLowerCase() === PRODUCTION_REPOSITORY;
}

export function canonicalProductionRepository(value, name = "repository") {
  if (!isProductionRepository(value)) {
    throw new Error(`${name} does not match the closed production binding.`);
  }
  return PRODUCTION_REPOSITORY;
}

export function canonicalProductionWorkflowRef(value) {
  const suffix = `/${VERIFY_WORKFLOW_PATH}@${PRODUCTION_REF}`;
  if (typeof value !== "string" || !value.endsWith(suffix)) {
    throw new Error(
      "Actions workflow ref does not match the closed production binding.",
    );
  }
  canonicalProductionRepository(
    value.slice(0, -suffix.length),
    "Actions workflow repository",
  );
  return `${PRODUCTION_REPOSITORY}${suffix}`;
}

export function buildProductionVerifyProofV1(input) {
  requireExact(input.repository, PRODUCTION_REPOSITORY, "repository");
  requireExactInteger(
    input.repositoryId,
    PRODUCTION_REPOSITORY_ID,
    "repository ID",
  );
  requireExact(input.ref, PRODUCTION_REF, "source ref");
  requirePattern(input.commitSha, COMMIT, "source commit");
  requirePattern(input.treeSha, COMMIT, "source tree");
  requireExact(input.workflowPath, VERIFY_WORKFLOW_PATH, "workflow path");
  requireExact(
    input.workflowRef,
    `${PRODUCTION_REPOSITORY}/${VERIFY_WORKFLOW_PATH}@${PRODUCTION_REF}`,
    "workflow ref",
  );
  requirePattern(input.workflowSha, COMMIT, "workflow commit");
  requireExact(input.workflowSha, input.commitSha, "workflow/source commit");
  requirePattern(input.workflowFileSha256, SHA256, "workflow SHA-256");
  requirePositiveInteger(input.runId, "run ID");
  requirePositiveInteger(input.runAttempt, "run attempt");
  const verificationMode = validateVerificationMode(
    input.verificationMode,
    input.eventName,
  );

  const scope = validateProductionVerifyScope(input.scopeResults);
  validateVerificationModeScope(verificationMode, scope);
  const checks = REQUIRED_PRODUCTION_VERIFY_CHECKS.map((check) => {
    const required = check.scopeKey === null ? true : scope[check.scopeKey];
    const expectedResult = required ? "success" : "skipped";
    requireExact(
      input.checkResults?.[check.id],
      expectedResult,
      `${check.name} result`,
    );
    return Object.freeze({
      id: check.id,
      name: check.name,
      required,
      conclusion: expectedResult,
    });
  });
  assertExactKeys(
    input.checkResults,
    REQUIRED_PRODUCTION_VERIFY_CHECKS.map(({ id }) => id),
    "check results",
  );

  return Object.freeze({
    schemaVersion: PRODUCTION_VERIFY_PROOF_SCHEMA_VERSION,
    repository: Object.freeze({
      id: PRODUCTION_REPOSITORY_ID,
      fullName: PRODUCTION_REPOSITORY,
    }),
    source: Object.freeze({
      ref: PRODUCTION_REF,
      commitSha: input.commitSha,
      treeSha: input.treeSha,
    }),
    scope,
    workflow: Object.freeze({
      path: VERIFY_WORKFLOW_PATH,
      ref: input.workflowRef,
      sourceCommitSha: input.workflowSha,
      fileSha256: input.workflowFileSha256,
    }),
    run: Object.freeze({
      id: input.runId,
      attempt: input.runAttempt,
      event: input.eventName,
      verificationMode,
    }),
    checks: Object.freeze(checks),
  });
}

export function encodeProductionVerifyProofV1(proof) {
  validateProductionVerifyProofV1(proof, {
    commitSha: proof?.source?.commitSha,
    treeSha: proof?.source?.treeSha,
    workflowFileSha256: proof?.workflow?.fileSha256,
    runId: proof?.run?.id,
    runAttempt: proof?.run?.attempt,
    eventName: proof?.run?.event,
    verificationMode: proof?.run?.verificationMode,
  });
  return Buffer.from(`${JSON.stringify(proof, null, 2)}\n`, "utf8");
}

export function parseProductionVerifyProofV1(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_PROOF_BYTES) {
    throw new Error("Production Verify proof size is invalid.");
  }
  let proof;
  try {
    proof = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Production Verify proof is not valid UTF-8 JSON.", {
      cause: error,
    });
  }
  const canonical = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`, "utf8");
  if (canonical.compare(bytes) !== 0) {
    throw new Error("Production Verify proof is not deterministically encoded.");
  }
  validateProductionVerifyProofV1(proof, expected);
  return Object.freeze(proof);
}

export function validateProductionVerifyProofV1(proof, expected) {
  assertExactKeys(
    proof,
    ["schemaVersion", "repository", "source", "scope", "workflow", "run", "checks"],
    "proof",
  );
  requireExact(
    proof.schemaVersion,
    PRODUCTION_VERIFY_PROOF_SCHEMA_VERSION,
    "proof schema",
  );
  assertExactKeys(proof.repository, ["id", "fullName"], "proof repository");
  requireExactInteger(
    proof.repository.id,
    PRODUCTION_REPOSITORY_ID,
    "proof repository ID",
  );
  requireExact(
    proof.repository.fullName,
    PRODUCTION_REPOSITORY,
    "proof repository",
  );
  assertExactKeys(proof.source, ["ref", "commitSha", "treeSha"], "proof source");
  requireExact(proof.source.ref, PRODUCTION_REF, "proof source ref");
  requirePattern(proof.source.commitSha, COMMIT, "proof commit");
  requirePattern(proof.source.treeSha, COMMIT, "proof tree");
  requireExact(proof.source.commitSha, expected.commitSha, "proof commit");
  requireExact(proof.source.treeSha, expected.treeSha, "proof tree");
  const scope = validateProductionVerifyScope(proof.scope);
  assertExactKeys(
    proof.workflow,
    ["path", "ref", "sourceCommitSha", "fileSha256"],
    "proof workflow",
  );
  requireExact(proof.workflow.path, VERIFY_WORKFLOW_PATH, "proof workflow path");
  requireExact(
    proof.workflow.ref,
    `${PRODUCTION_REPOSITORY}/${VERIFY_WORKFLOW_PATH}@${PRODUCTION_REF}`,
    "proof workflow ref",
  );
  requireExact(
    proof.workflow.sourceCommitSha,
    expected.commitSha,
    "proof workflow commit",
  );
  requirePattern(proof.workflow.fileSha256, SHA256, "proof workflow SHA-256");
  requireExact(
    proof.workflow.fileSha256,
    expected.workflowFileSha256,
    "proof workflow SHA-256",
  );
  assertExactKeys(
    proof.run,
    ["id", "attempt", "event", "verificationMode"],
    "proof run",
  );
  requirePositiveInteger(proof.run.id, "proof run ID");
  requirePositiveInteger(proof.run.attempt, "proof run attempt");
  requireExact(proof.run.id, expected.runId, "proof run ID");
  requireExact(proof.run.attempt, expected.runAttempt, "proof run attempt");
  const verificationMode = validateVerificationMode(
    proof.run.verificationMode,
    proof.run.event,
  );
  requireExact(proof.run.event, expected.eventName, "proof run event");
  requireExact(
    verificationMode,
    expected.verificationMode,
    "proof verification mode",
  );
  validateVerificationModeScope(verificationMode, scope);
  if (
    !Array.isArray(proof.checks)
    || proof.checks.length !== REQUIRED_PRODUCTION_VERIFY_CHECKS.length
  ) {
    throw new Error("Production Verify proof check inventory is invalid.");
  }
  for (const [index, expectedCheck] of REQUIRED_PRODUCTION_VERIFY_CHECKS.entries()) {
    const check = proof.checks[index];
    assertExactKeys(check, ["id", "name", "required", "conclusion"], "proof check");
    requireExact(check.id, expectedCheck.id, "proof check ID");
    requireExact(check.name, expectedCheck.name, "proof check name");
    requireExact(
      check.required,
      expectedCheck.scopeKey === null ? true : scope[expectedCheck.scopeKey],
      `${expectedCheck.name} requirement`,
    );
    const expectedRequired =
      expectedCheck.scopeKey === null ? true : scope[expectedCheck.scopeKey];
    requireExact(
      check.conclusion,
      expectedRequired ? "success" : "skipped",
      `${expectedCheck.name} conclusion`,
    );
  }
  return true;
}

export async function resolveProductionVerifyProofFromGitHubV1(input) {
  requireExact(input.repository, PRODUCTION_REPOSITORY, "repository");
  requireExactInteger(
    input.repositoryId,
    PRODUCTION_REPOSITORY_ID,
    "repository ID",
  );
  requirePattern(input.commitSha, COMMIT, "expected commit");
  requirePattern(input.treeSha, COMMIT, "expected tree");
  requirePattern(input.workflowFileSha256, SHA256, "workflow SHA-256");
  const eventName = verificationEventForMode(input.verificationMode);
  requireExact(input.githubApiUrl, EXPECTED_GITHUB_API_URL, "GitHub API origin");
  if (typeof input.githubToken !== "string" || input.githubToken.length < 1) {
    throw new Error("GitHub Actions read token is unavailable.");
  }
  if (
    !Number.isSafeInteger(input.nowMs)
    || !Number.isSafeInteger(input.maxAgeMs)
    || input.maxAgeMs !== PRODUCTION_VERIFY_PROOF_MAX_AGE_MS
  ) {
    throw new Error("Production Verify proof freshness policy is invalid.");
  }
  const hasExpectedRunId = input.expectedRunId !== undefined;
  const hasExpectedRunAttempt = input.expectedRunAttempt !== undefined;
  if (
    hasExpectedRunId !== hasExpectedRunAttempt
    || (hasExpectedRunId
      && (!Number.isSafeInteger(input.expectedRunId)
        || input.expectedRunId < 1
        || !Number.isSafeInteger(input.expectedRunAttempt)
        || input.expectedRunAttempt < 1))
  ) {
    throw new Error("Bound production Verify run identity is invalid.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const encodedRepository = encodeRepository(PRODUCTION_REPOSITORY);
  const [workflow, branchRef, runs] = await Promise.all([
    fetchGitHubJson(
      `${EXPECTED_GITHUB_API_URL}/repos/${encodedRepository}/actions/workflows/verify.yml`,
      input.githubToken,
      fetchImpl,
    ),
    fetchGitHubJson(
      `${EXPECTED_GITHUB_API_URL}/repos/${encodedRepository}/git/ref/heads/production`,
      input.githubToken,
      fetchImpl,
    ),
    fetchGitHubJson(
      `${EXPECTED_GITHUB_API_URL}/repos/${encodedRepository}/actions/workflows/verify.yml/runs`
        + `?branch=production&event=${eventName}&head_sha=${input.commitSha}&per_page=100`,
      input.githubToken,
      fetchImpl,
    ),
  ]);

  const workflowId = validateVerifyWorkflow(workflow);
  validateProductionBranchRef(branchRef, input.commitSha);
  const run = selectLatestExactVerifyRun(runs, {
    workflowId,
    commitSha: input.commitSha,
    treeSha: input.treeSha,
    eventName,
    expectedRunId: input.expectedRunId,
    expectedRunAttempt: input.expectedRunAttempt,
  });

  const [jobs, artifacts] = await Promise.all([
    fetchGitHubJson(
      `${EXPECTED_GITHUB_API_URL}/repos/${encodedRepository}/actions/runs/${run.id}`
        + `/attempts/${run.run_attempt}/jobs?per_page=100`,
      input.githubToken,
      fetchImpl,
    ),
    fetchGitHubJson(
      `${EXPECTED_GITHUB_API_URL}/repos/${encodedRepository}/actions/runs/${run.id}`
        + "/artifacts?per_page=100",
      input.githubToken,
      fetchImpl,
    ),
  ]);

  const proofCompletedAt = validateVerifyJobs(jobs, run);
  const ageMs = input.nowMs - proofCompletedAt;
  if (ageMs < 0 || ageMs > input.maxAgeMs) {
    throw new Error("Latest production Verify proof is stale.");
  }
  const artifact = validateVerifyArtifact(artifacts, run);

  return Object.freeze({
    verifiedSha: input.commitSha,
    verifiedTree: input.treeSha,
    runId: run.id,
    runAttempt: run.run_attempt,
    runUrl: run.html_url,
    proofCompletedAt: new Date(proofCompletedAt).toISOString(),
    artifactId: artifact.id,
    artifactName: artifact.name,
    artifactDigest: artifact.digest,
    eventName,
    verificationMode: input.verificationMode,
  });
}

function validateVerifyWorkflow(workflow) {
  if (
    !isObject(workflow)
    || !Number.isSafeInteger(workflow.id)
    || workflow.id < 1
    || workflow.name !== VERIFY_WORKFLOW_NAME
    || workflow.path !== VERIFY_WORKFLOW_PATH
    || workflow.state !== "active"
  ) {
    throw new Error("Canonical production Verify workflow identity is invalid.");
  }
  return workflow.id;
}

function validateProductionBranchRef(branchRef, expectedCommitSha) {
  if (
    !isObject(branchRef)
    || branchRef.ref !== PRODUCTION_REF
    || branchRef.object?.type !== "commit"
    || branchRef.object?.sha !== expectedCommitSha
  ) {
    throw new Error("Production advanced or no longer resolves to the dispatch commit.");
  }
}

function selectLatestExactVerifyRun(response, expected) {
  if (
    !isObject(response)
    || !Number.isSafeInteger(response.total_count)
    || !Array.isArray(response.workflow_runs)
    || response.workflow_runs.length < 1
  ) {
    throw new Error("No production Verify run exists for the dispatch commit.");
  }
  const runs = [...response.workflow_runs].sort((left, right) => {
    const timeDifference = parseTimestamp(right.run_started_at, "run start")
      - parseTimestamp(left.run_started_at, "run start");
    return timeDifference || numeric(right.id) - numeric(left.id);
  });
  const run = expected.expectedRunId === undefined
    ? runs[0]
    : runs.find(
      ({ id, run_attempt: runAttempt }) =>
        id === expected.expectedRunId
        && runAttempt === expected.expectedRunAttempt,
    );
  if (
    !Number.isSafeInteger(run?.id)
    || run.id < 1
    || !Number.isSafeInteger(run.run_attempt)
    || run.run_attempt < 1
    || run.workflow_id !== expected.workflowId
    || run.name !== VERIFY_WORKFLOW_NAME
    || run.path !== VERIFY_WORKFLOW_PATH
    || run.event !== expected.eventName
    || run.status !== "completed"
    || run.conclusion !== "success"
    || run.head_branch !== "production"
    || run.head_sha !== expected.commitSha
    || run.head_commit?.id !== expected.commitSha
    || run.head_commit?.tree_id !== expected.treeSha
    || run.repository?.id !== PRODUCTION_REPOSITORY_ID
    || !isProductionRepository(run.repository?.full_name)
    || run.head_repository?.id !== PRODUCTION_REPOSITORY_ID
    || !isProductionRepository(run.head_repository?.full_name)
    || run.html_url !== `${run.repository.html_url}/actions/runs/${run.id}`
  ) {
    throw new Error("Latest production Verify run is canceled, incomplete, or mismatched.");
  }
  parseTimestamp(run.updated_at, "run update");
  return run;
}

function validateVerifyJobs(response, run) {
  const expectedNames = [
    VERIFY_SCOPE_JOB_NAME,
    ...REQUIRED_PRODUCTION_VERIFY_CHECKS.map(({ name }) => name),
    ...VERIFY_INTERFACE_WORKER_JOB_NAMES,
    ...VERIFY_CONTRACT_WORKER_JOB_NAMES,
    VERIFY_PROOF_JOB_NAME,
    VERIFY_AGGREGATE_JOB_NAME,
  ];
  if (
    !isObject(response)
    || response.total_count !== expectedNames.length
    || !Array.isArray(response.jobs)
    || response.jobs.length !== expectedNames.length
  ) {
    throw new Error("Production Verify job inventory is incomplete or unexpected.");
  }
  const jobsByName = new Map();
  for (const job of response.jobs) {
    const skippedWorker = isObject(job)
      && (VERIFY_INTERFACE_WORKER_JOB_NAMES.includes(job.name)
        || VERIFY_CONTRACT_WORKER_JOB_NAMES.includes(job.name))
      && job.conclusion === "skipped";
    if (
      !isObject(job)
      || typeof job.name !== "string"
      || jobsByName.has(job.name)
      || job.run_id !== run.id
      || job.run_attempt !== run.run_attempt
      || job.head_sha !== run.head_sha
      || job.status !== "completed"
      || (!skippedWorker && job.conclusion !== "success")
      || (!skippedWorker && (
        !Number.isSafeInteger(job.runner_id)
        || job.runner_id < 1
        || job.runner_name !== `GitHub Actions ${job.runner_id}`
        || job.runner_group_id !== 0
        || job.runner_group_name !== "GitHub Actions"
      ))
      || (skippedWorker && (
        job.runner_id !== null
        || job.runner_name !== null
        || job.runner_group_id !== null
        || job.runner_group_name !== null
        || !Array.isArray(job.steps)
        || job.steps.length !== 0
      ))
      || !Array.isArray(job.labels)
      || job.labels.length !== 1
      || job.labels[0] !== "ubuntu-latest"
    ) {
      throw new Error("Production Verify contains a failed or mismatched job.");
    }
    parseTimestamp(job.started_at, `${job.name} start`);
    parseTimestamp(job.completed_at, `${job.name} completion`);
    jobsByName.set(job.name, job);
  }
  if (
    expectedNames.some((name) => !jobsByName.has(name))
    || [...jobsByName.keys()].some((name) => !expectedNames.includes(name))
  ) {
    throw new Error("Production Verify job names do not match the closed inventory.");
  }
  // Each source-bound protected aggregate validates its scope and every worker.
  // GitHub assigns no runner to unaffected workers. Only complete named groups
  // may be skipped; all protected contexts, scope, and final gates must succeed.
  for (const [group, names] of [
    ["Interface", VERIFY_INTERFACE_WORKER_JOB_NAMES],
    ["Contracts", VERIFY_CONTRACT_WORKER_JOB_NAMES],
  ]) {
    if (new Set(names.map((name) => jobsByName.get(name).conclusion)).size !== 1) {
      throw new Error(`Production Verify ${group} worker results disagree.`);
    }
  }
  return parseTimestamp(
    jobsByName.get(VERIFY_PROOF_JOB_NAME).completed_at,
    "proof completion",
  );
}

function validateVerifyArtifact(response, run) {
  const expectedName = `production-verify-proof-${run.id}-${run.run_attempt}`;
  if (!isObject(response) || !Array.isArray(response.artifacts)) {
    throw new Error("Production Verify proof artifact response is invalid.");
  }
  const matches = response.artifacts.filter(({ name }) => name === expectedName);
  if (matches.length !== 1) {
    throw new Error("Exactly one immutable production Verify proof artifact is required.");
  }
  const artifact = matches[0];
  if (
    !Number.isSafeInteger(artifact.id)
    || artifact.id < 1
    || artifact.expired !== false
    || !Number.isSafeInteger(artifact.size_in_bytes)
    || artifact.size_in_bytes < 1
    || artifact.size_in_bytes > MAX_PROOF_BYTES
    || !SHA256.test(artifact.digest)
    || artifact.workflow_run?.id !== run.id
    || artifact.workflow_run?.repository_id !== PRODUCTION_REPOSITORY_ID
    || artifact.workflow_run?.head_repository_id !== PRODUCTION_REPOSITORY_ID
    || artifact.workflow_run?.head_branch !== "production"
    || artifact.workflow_run?.head_sha !== run.head_sha
  ) {
    throw new Error("Production Verify proof artifact identity is invalid.");
  }
  parseTimestamp(artifact.created_at, "artifact creation");
  parseTimestamp(artifact.expires_at, "artifact expiry");
  return artifact;
}

async function fetchGitHubJson(url, githubToken, fetchImpl) {
  const parsed = new URL(url);
  if (parsed.origin !== EXPECTED_GITHUB_API_URL) {
    throw new Error("GitHub API request escaped the canonical origin.");
  }
  let response;
  try {
    response = await fetchImpl(parsed, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "user-agent": "programmable-production-verify-proof-v1",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new Error("Production Verify proof could not be read from GitHub.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`Production Verify proof GitHub read failed with status ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("Production Verify proof GitHub response size is invalid.");
  }
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Production Verify proof GitHub response is not valid JSON.", {
      cause: error,
    });
  }
}

function repositoryContext(repositoryRoot) {
  const root = resolve(repositoryRoot);
  requireExact(
    git(root, "status", "--porcelain=v1", "--untracked-files=all"),
    "",
    "checkout worktree",
  );
  const commitSha = git(root, "rev-parse", "HEAD");
  const treeSha = git(root, "rev-parse", "HEAD^{tree}");
  requirePattern(commitSha, COMMIT, "checkout commit");
  requirePattern(treeSha, COMMIT, "checkout tree");
  requireExact(commitSha, process.env.GITHUB_SHA, "checkout/Actions commit");
  const repository = canonicalProductionRepository(
    process.env.GITHUB_REPOSITORY,
    "Actions repository",
  );
  requireExactInteger(
    parsePositiveInteger(process.env.GITHUB_REPOSITORY_ID, "Actions repository ID"),
    PRODUCTION_REPOSITORY_ID,
    "Actions repository ID",
  );
  requireExact(process.env.GITHUB_REF, PRODUCTION_REF, "Actions ref");
  const workflowFileSha256 = prefixedSha256(
    readFileSync(resolve(root, VERIFY_WORKFLOW_PATH)),
  );
  return Object.freeze({
    root,
    commitSha,
    treeSha,
    workflowFileSha256,
    repository,
  });
}

async function runCli() {
  const [command, ...rawArguments] = process.argv.slice(2);
  const argumentsByName = parseArguments(rawArguments);
  const allowedArguments = {
    create: ["repository-root", "output"],
    resolve: ["repository-root", "verification-mode", "github-output"],
    verify: [
      "repository-root",
      "proof",
      "run-id",
      "run-attempt",
      "artifact-digest",
      "verification-mode",
      "github-output",
    ],
  }[command];
  if (!allowedArguments) {
    throw new Error("Usage: production-verify-proof.mjs <create|resolve|verify> [options]");
  }
  assertExactArgumentNames(argumentsByName, allowedArguments);
  const repositoryRoot = requiredArgument(argumentsByName, "repository-root");
  const context = repositoryContext(repositoryRoot);

  if (command === "create") {
    const output = requiredArgument(argumentsByName, "output");
    const verificationMode = process.env.PRODUCTION_VERIFY_MODE;
    validateVerificationMode(verificationMode, process.env.GITHUB_EVENT_NAME);
    const workflowRef = canonicalProductionWorkflowRef(
      process.env.GITHUB_WORKFLOW_REF,
    );
    requireExact(process.env.GITHUB_WORKFLOW_SHA, context.commitSha, "Actions workflow commit");
    const proof = buildProductionVerifyProofV1({
      repository: context.repository,
      repositoryId: parsePositiveInteger(
        process.env.GITHUB_REPOSITORY_ID,
        "Actions repository ID",
      ),
      ref: process.env.GITHUB_REF,
      commitSha: context.commitSha,
      treeSha: context.treeSha,
      workflowPath: VERIFY_WORKFLOW_PATH,
      workflowRef,
      workflowSha: process.env.GITHUB_WORKFLOW_SHA,
      workflowFileSha256: context.workflowFileSha256,
      runId: parsePositiveInteger(process.env.GITHUB_RUN_ID, "Actions run ID"),
      runAttempt: parsePositiveInteger(
        process.env.GITHUB_RUN_ATTEMPT,
        "Actions run attempt",
      ),
      eventName: process.env.GITHUB_EVENT_NAME,
      verificationMode,
      scopeResults: Object.fromEntries(
        PRODUCTION_VERIFY_SCOPE_KEYS.map((key) => [
          key,
          parseBoolean(
            process.env[`PRODUCTION_VERIFY_SCOPE_${key.toUpperCase()}`],
            `${key} scope`,
          ),
        ]),
      ),
      checkResults: Object.fromEntries(
        REQUIRED_PRODUCTION_VERIFY_CHECKS.map(({ id }) => [
          id,
          process.env[`PRODUCTION_VERIFY_${id.toUpperCase().replaceAll("-", "_")}_RESULT`],
        ]),
      ),
    });
    writeFileSync(output, encodeProductionVerifyProofV1(proof), { flag: "wx", mode: 0o600 });
    return;
  }

  if (command === "resolve") {
    const githubOutput = requiredArgument(argumentsByName, "github-output");
    const verificationMode = requiredArgument(
      argumentsByName,
      "verification-mode",
    );
    const eventName = verificationEventForMode(verificationMode);
    const resolution = await resolveProductionVerifyProofFromGitHubV1({
      repository: context.repository,
      repositoryId: parsePositiveInteger(
        process.env.GITHUB_REPOSITORY_ID,
        "Actions repository ID",
      ),
      commitSha: context.commitSha,
      treeSha: context.treeSha,
      workflowFileSha256: context.workflowFileSha256,
      verificationMode,
      githubApiUrl: process.env.GITHUB_API_URL,
      githubToken: process.env.GITHUB_TOKEN,
      nowMs: Date.now(),
      maxAgeMs: PRODUCTION_VERIFY_PROOF_MAX_AGE_MS,
    });
    appendGitHubOutput(githubOutput, {
      verified_sha: resolution.verifiedSha,
      verified_tree: resolution.verifiedTree,
      verify_run_id: resolution.runId,
      verify_run_attempt: resolution.runAttempt,
      verify_run_url: resolution.runUrl,
      proof_completed_at: resolution.proofCompletedAt,
      artifact_id: resolution.artifactId,
      artifact_name: resolution.artifactName,
      artifact_digest: resolution.artifactDigest,
      verify_event: eventName,
      verification_mode: verificationMode,
    });
    return;
  }

  if (command === "verify") {
    const proofPath = requiredArgument(argumentsByName, "proof");
    const githubOutput = requiredArgument(argumentsByName, "github-output");
    const runId = parsePositiveInteger(
      requiredArgument(argumentsByName, "run-id"),
      "resolved run ID",
    );
    const runAttempt = parsePositiveInteger(
      requiredArgument(argumentsByName, "run-attempt"),
      "resolved run attempt",
    );
    const artifactDigest = requiredArgument(argumentsByName, "artifact-digest");
    requirePattern(artifactDigest, SHA256, "resolved artifact digest");
    const verificationMode = requiredArgument(
      argumentsByName,
      "verification-mode",
    );
    const eventName = verificationEventForMode(verificationMode);
    const proofBytes = readFileSync(proofPath);
    const proof = parseProductionVerifyProofV1(proofBytes, {
      commitSha: context.commitSha,
      treeSha: context.treeSha,
      workflowFileSha256: context.workflowFileSha256,
      runId,
      runAttempt,
      eventName,
      verificationMode,
    });
    appendGitHubOutput(githubOutput, {
      verified_sha: context.commitSha,
      verified_tree: context.treeSha,
      verify_run_id: runId,
      verify_run_attempt: runAttempt,
      proof_sha256: prefixedSha256(proofBytes),
      artifact_digest: artifactDigest,
      verify_event: eventName,
      verification_mode: verificationMode,
      ...Object.fromEntries(
        PRODUCTION_VERIFY_SCOPE_KEYS.map((key) => [
          `verified_${key}`,
          proof.scope[key],
        ]),
      ),
    });
    return;
  }

  throw new Error("Production Verify proof command was not handled.");
}

function parseArguments(rawArguments) {
  const parsed = new Map();
  for (let index = 0; index < rawArguments.length; index += 2) {
    const flag = rawArguments[index];
    const value = rawArguments[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(flag ?? "") || value === undefined) {
      throw new Error("Production Verify proof arguments are invalid.");
    }
    const name = flag.slice(2);
    if (parsed.has(name)) {
      throw new Error(`Duplicate --${name} argument.`);
    }
    parsed.set(name, value);
  }
  return parsed;
}

function requiredArgument(argumentsByName, name) {
  const value = argumentsByName.get(name);
  if (typeof value !== "string" || value.length < 1) {
    throw new Error(`Missing --${name} argument.`);
  }
  return value;
}

function assertExactArgumentNames(argumentsByName, expectedNames) {
  const actual = [...argumentsByName.keys()].sort();
  const expected = [...expectedNames].sort();
  if (
    actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error("Production Verify proof arguments do not match the closed command contract.");
  }
}

function appendGitHubOutput(path, values) {
  for (const [name, value] of Object.entries(values)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(name) || /[\r\n]/u.test(String(value))) {
      throw new Error("GitHub output value is invalid.");
    }
    appendFileSync(path, `${name}=${value}\n`, { encoding: "utf8" });
  }
}

function git(root, ...arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function prefixedSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function encodeRepository(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function parseTimestamp(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new Error(`${name} timestamp is invalid.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error(`${name} timestamp is invalid.`);
  }
  return timestamp;
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/u.test(String(value ?? ""))) {
    throw new Error(`${name} is invalid.`);
  }
  const parsed = Number(value);
  requirePositiveInteger(parsed, name);
  return parsed;
}

function numeric(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} is invalid.`);
}

function verificationEventForMode(mode) {
  if (mode === PRODUCTION_VERIFY_CHANGE_MODE) return "push";
  if (mode === PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE) {
    return "workflow_dispatch";
  }
  throw new Error("Production verification mode is invalid.");
}

function validateVerificationMode(mode, eventName) {
  requireExact(
    eventName,
    verificationEventForMode(mode),
    "verification mode/event",
  );
  return mode;
}

function validateVerificationModeScope(mode, scope) {
  if (mode !== PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE) return;
  for (const key of PRODUCTION_VERIFY_SCOPE_KEYS) {
    requireExact(
      scope[key],
      key === "custom_v2",
      `Custom V2 release ${key} scope`,
    );
  }
}

function validateProductionVerifyScope(value) {
  assertExactKeys(value, PRODUCTION_VERIFY_SCOPE_KEYS, "verification scope");
  const scope = {};
  for (const key of PRODUCTION_VERIFY_SCOPE_KEYS) {
    if (typeof value[key] !== "boolean") {
      throw new Error(`${key} verification scope is invalid.`);
    }
    scope[key] = value[key];
  }
  return Object.freeze(scope);
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} is invalid.`);
  }
}

function requirePattern(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
}

function requireExact(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} does not match the closed production binding.`);
  }
}

function requireExactInteger(actual, expected, name) {
  if (!Number.isSafeInteger(actual) || actual !== expected) {
    throw new Error(`${name} does not match the closed production binding.`);
  }
}

function assertExactKeys(value, keys, name) {
  if (!isObject(value)) {
    throw new Error(`${name} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${name} fields do not match the closed schema.`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directInvocation) {
  await runCli();
}
