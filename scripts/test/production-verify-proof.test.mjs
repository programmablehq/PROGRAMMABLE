import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_REF,
  PRODUCTION_REPOSITORY,
  PRODUCTION_REPOSITORY_ID,
  PRODUCTION_VERIFY_CHANGE_MODE,
  PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE,
  PRODUCTION_VERIFY_PROOF_MAX_AGE_MS,
  PRODUCTION_VERIFY_SCOPE_KEYS,
  REQUIRED_PRODUCTION_VERIFY_CHECKS,
  VERIFY_AGGREGATE_JOB_NAME,
  VERIFY_PROOF_JOB_NAME,
  VERIFY_INTERFACE_WORKER_JOB_NAMES,
  VERIFY_CONTRACT_WORKER_JOB_NAMES,
  VERIFY_SCOPE_JOB_NAME,
  VERIFY_WORKFLOW_PATH,
  buildProductionVerifyProofV1,
  canonicalProductionRepository,
  canonicalProductionWorkflowRef,
  encodeProductionVerifyProofV1,
  parseProductionVerifyProofV1,
  resolveProductionVerifyProofFromGitHubV1,
} from "../production-verify-proof.mjs";

const COMMIT = "6d72fda6ccd22d09ebfeddd29962952d3abb79b4";
const TREE = "a2ac6a5c7614d6d4e6bf4f23e4cab1bc425030a2";
const WORKFLOW_SHA256 =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ARTIFACT_DIGEST =
  "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const RUN_ID = 31_519_898_545;
const RUN_ATTEMPT = 1;
const WORKFLOW_ID = 321_772_273;
const REPOSITORY_URL = "https://github.com/programmablehq/programmable";
const NOW_MS = Date.parse("2026-08-11T18:10:00Z");

test("pins the immutable production repository identity", () => {
  assert.equal(PRODUCTION_REPOSITORY_ID, 1_314_365_508);
});

function validProofInput() {
  return {
    repository: PRODUCTION_REPOSITORY,
    repositoryId: PRODUCTION_REPOSITORY_ID,
    ref: PRODUCTION_REF,
    commitSha: COMMIT,
    treeSha: TREE,
    workflowPath: VERIFY_WORKFLOW_PATH,
    workflowRef: `${PRODUCTION_REPOSITORY}/${VERIFY_WORKFLOW_PATH}@${PRODUCTION_REF}`,
    workflowSha: COMMIT,
    workflowFileSha256: WORKFLOW_SHA256,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    eventName: "push",
    verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
    scopeResults: Object.fromEntries(
      PRODUCTION_VERIFY_SCOPE_KEYS.map((key) => [key, true]),
    ),
    checkResults: Object.fromEntries(
      REQUIRED_PRODUCTION_VERIFY_CHECKS.map(({ id }) => [id, "success"]),
    ),
  };
}

function validApiFixtures() {
  const jobs = [
    {
      id: 89_999,
      run_id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      name: VERIFY_SCOPE_JOB_NAME,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-11T17:53:35Z",
      completed_at: "2026-08-11T17:53:36Z",
      runner_id: 999_999,
      runner_name: "GitHub Actions 999999",
      runner_group_id: 0,
      runner_group_name: "GitHub Actions",
      labels: ["ubuntu-latest"],
    },
    ...[
      ...REQUIRED_PRODUCTION_VERIFY_CHECKS.map(({ name }) => name),
      ...VERIFY_INTERFACE_WORKER_JOB_NAMES,
      ...VERIFY_CONTRACT_WORKER_JOB_NAMES,
    ].map((name, index) => ({
      id: 90_000 + index,
      run_id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      name,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-11T17:53:37Z",
      completed_at: "2026-08-11T18:04:33Z",
      runner_id: 1_000_000 + index,
      runner_name: `GitHub Actions ${1_000_000 + index}`,
      runner_group_id: 0,
      runner_group_name: "GitHub Actions",
      labels: ["ubuntu-latest"],
    })),
    {
      id: 90_100,
      run_id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      name: VERIFY_PROOF_JOB_NAME,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-11T18:04:34Z",
      completed_at: "2026-08-11T18:04:40Z",
      runner_id: 1_000_010,
      runner_name: "GitHub Actions 1000010",
      runner_group_id: 0,
      runner_group_name: "GitHub Actions",
      labels: ["ubuntu-latest"],
    },
    {
      id: 90_101,
      run_id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      name: VERIFY_AGGREGATE_JOB_NAME,
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-11T18:04:41Z",
      completed_at: "2026-08-11T18:04:42Z",
      runner_id: 1_000_011,
      runner_name: "GitHub Actions 1000011",
      runner_group_id: 0,
      runner_group_name: "GitHub Actions",
      labels: ["ubuntu-latest"],
    },
  ];
  const run = {
    id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    workflow_id: WORKFLOW_ID,
    name: "Verify",
    path: VERIFY_WORKFLOW_PATH,
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: "production",
    head_sha: COMMIT,
    head_commit: { id: COMMIT, tree_id: TREE },
    repository: {
      id: PRODUCTION_REPOSITORY_ID,
      full_name: PRODUCTION_REPOSITORY,
      html_url: REPOSITORY_URL,
    },
    head_repository: {
      id: PRODUCTION_REPOSITORY_ID,
      full_name: PRODUCTION_REPOSITORY,
    },
    html_url: `${REPOSITORY_URL}/actions/runs/${RUN_ID}`,
    run_started_at: "2026-08-11T17:53:34Z",
    updated_at: "2026-08-11T18:04:41Z",
  };
  return {
    workflow: {
      id: WORKFLOW_ID,
      name: "Verify",
      path: VERIFY_WORKFLOW_PATH,
      state: "active",
    },
    branchRef: {
      ref: PRODUCTION_REF,
      object: { type: "commit", sha: COMMIT },
    },
    runs: { total_count: 1, workflow_runs: [run] },
    jobs: { total_count: jobs.length, jobs },
    artifacts: {
      total_count: 1,
      artifacts: [
        {
          id: 777,
          name: `production-verify-proof-${RUN_ID}-${RUN_ATTEMPT}`,
          size_in_bytes: 2_048,
          expired: false,
          digest: ARTIFACT_DIGEST,
          created_at: "2026-08-11T18:04:39Z",
          expires_at: "2026-08-18T18:04:39Z",
          workflow_run: {
            id: RUN_ID,
            repository_id: PRODUCTION_REPOSITORY_ID,
            head_repository_id: PRODUCTION_REPOSITORY_ID,
            head_branch: "production",
            head_sha: COMMIT,
          },
        },
      ],
    },
  };
}

function mockGitHub(fixtures) {
  return async (input, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, "Bearer test-token");
    const url = new URL(input);
    let value;
    if (url.pathname.endsWith("/actions/workflows/verify.yml/runs")) {
      assert.equal(url.searchParams.get("branch"), "production");
      assert.equal(
        url.searchParams.get("event"),
        fixtures.runs.workflow_runs[0].event,
      );
      assert.equal(url.searchParams.get("head_sha"), COMMIT);
      value = fixtures.runs;
    } else if (url.pathname.endsWith("/actions/workflows/verify.yml")) {
      value = fixtures.workflow;
    } else if (url.pathname.endsWith("/git/ref/heads/production")) {
      value = fixtures.branchRef;
    } else if (url.pathname.endsWith(`/attempts/${RUN_ATTEMPT}/jobs`)) {
      value = fixtures.jobs;
    } else if (url.pathname.endsWith(`/actions/runs/${RUN_ID}/artifacts`)) {
      value = fixtures.artifacts;
    } else {
      return new Response("missing", { status: 404 });
    }
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function resolveFixtures(fixtures = validApiFixtures(), overrides = {}) {
  return resolveProductionVerifyProofFromGitHubV1({
    repository: PRODUCTION_REPOSITORY,
    repositoryId: PRODUCTION_REPOSITORY_ID,
    commitSha: COMMIT,
    treeSha: TREE,
    workflowFileSha256: WORKFLOW_SHA256,
    verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
    githubApiUrl: "https://api.github.com",
    githubToken: "test-token",
    nowMs: NOW_MS,
    maxAgeMs: PRODUCTION_VERIFY_PROOF_MAX_AGE_MS,
    fetchImpl: mockGitHub(fixtures),
    ...overrides,
  });
}

test("full production Verify proof is deterministic and exact", () => {
  const proof = buildProductionVerifyProofV1(validProofInput());
  const bytes = encodeProductionVerifyProofV1(proof);
  assert.equal(bytes.at(-1), 10);
  assert.deepEqual(
    parseProductionVerifyProofV1(bytes, {
      commitSha: COMMIT,
      treeSha: TREE,
      workflowFileSha256: WORKFLOW_SHA256,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      eventName: "push",
      verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
    }),
    proof,
  );
});

test("GitHub display-case drift preserves the canonical production identity", () => {
  assert.equal(
    canonicalProductionRepository("programmablehq/PROGRAMMABLE"),
    PRODUCTION_REPOSITORY,
  );
  assert.equal(
    canonicalProductionWorkflowRef(
      "programmablehq/PROGRAMMABLE/.github/workflows/verify.yml@refs/heads/production",
    ),
    `${PRODUCTION_REPOSITORY}/${VERIFY_WORKFLOW_PATH}@${PRODUCTION_REF}`,
  );
  assert.throws(() =>
    canonicalProductionRepository("attacker/PROGRAMMABLE"));
  assert.throws(() =>
    canonicalProductionRepository("programmable-infra/PROGRAMMABLE"));
  assert.throws(() =>
    canonicalProductionRepository("programmablehq/PROGRAMMABLE "));
  assert.throws(() =>
    canonicalProductionWorkflowRef(
      "programmablehq/PROGRAMMABLE/.github/workflows/verify.yml@refs/heads/main",
    ));
});

test("proof binds the path scope and distinguishes skipped lanes", () => {
  const input = validProofInput();
  input.scopeResults = {
    contracts: false,
    custom_v2: false,
    database: false,
    dependencies: false,
    indexer: false,
    interface: true,
    read_model: false,
  };
  input.checkResults = {
    "secret-scan": "success",
    "custom-v2": "skipped",
    indexer: "skipped",
    "database-pglite": "skipped",
    interface: "success",
    contracts: "skipped",
  };
  const proof = buildProductionVerifyProofV1(input);
  assert.deepEqual(proof.scope, input.scopeResults);
  assert.deepEqual(
    Object.fromEntries(proof.checks.map(({ id, required }) => [id, required])),
    {
      "secret-scan": true,
      "custom-v2": false,
      indexer: false,
      "database-pglite": false,
      interface: true,
      contracts: false,
    },
  );
  assert.doesNotThrow(() =>
    parseProductionVerifyProofV1(
      encodeProductionVerifyProofV1(proof),
      {
        commitSha: COMMIT,
        treeSha: TREE,
        workflowFileSha256: WORKFLOW_SHA256,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        eventName: "push",
        verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
      },
    ),
  );
});

test("path-scoped proof rejects a skipped required lane", () => {
  const input = validProofInput();
  input.scopeResults = {
    contracts: false,
    custom_v2: false,
    database: false,
    dependencies: false,
    indexer: false,
    interface: true,
    read_model: false,
  };
  input.checkResults.interface = "skipped";
  input.checkResults["custom-v2"] = "skipped";
  input.checkResults.indexer = "skipped";
  input.checkResults["database-pglite"] = "skipped";
  input.checkResults.contracts = "skipped";
  assert.throws(
    () => buildProductionVerifyProofV1(input),
    /Interface result does not match/,
  );
});

test("proof construction rejects partial, skipped, or substituted checks", () => {
  for (const [id, result] of [
    ["contracts", "failure"],
    ["interface", "skipped"],
    ["indexer", "cancelled"],
  ]) {
    const input = validProofInput();
    input.checkResults[id] = result;
    assert.throws(() => buildProductionVerifyProofV1(input));
  }
  const extra = validProofInput();
  extra.checkResults.untrusted = "success";
  assert.throws(() => buildProductionVerifyProofV1(extra));
});

test("downloaded proof rejects identity, schema, run, and byte drift", () => {
  const proof = buildProductionVerifyProofV1(validProofInput());
  const expected = {
    commitSha: COMMIT,
    treeSha: TREE,
    workflowFileSha256: WORKFLOW_SHA256,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    eventName: "push",
    verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
  };
  const mutations = [
    (value) => { value.schemaVersion = "programmable.production-verify-proof.v0"; },
    (value) => { value.repository.id += 1; },
    (value) => { value.source.commitSha = "0".repeat(40); },
    (value) => { value.source.treeSha = "0".repeat(40); },
    (value) => { value.workflow.path = ".github/workflows/other.yml"; },
    (value) => { value.workflow.fileSha256 = `sha256:${"0".repeat(64)}`; },
    (value) => { value.run.id += 1; },
    (value) => { value.run.attempt += 1; },
    (value) => { value.checks[0].conclusion = "skipped"; },
    (value) => { value.checks.reverse(); },
    (value) => { value.extra = true; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(proof);
    mutate(candidate);
    const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
    assert.throws(() => parseProductionVerifyProofV1(bytes, expected));
  }
  const noncanonical = Buffer.from(JSON.stringify(proof));
  assert.throws(() => parseProductionVerifyProofV1(noncanonical, expected));
});

test("resolver accepts only a fresh exact successful run and immutable artifact", async () => {
  assert.deepEqual(await resolveFixtures(), {
    verifiedSha: COMMIT,
    verifiedTree: TREE,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    runUrl: `${REPOSITORY_URL}/actions/runs/${RUN_ID}`,
    proofCompletedAt: "2026-08-11T18:04:40.000Z",
    artifactId: 777,
    artifactName: `production-verify-proof-${RUN_ID}-${RUN_ATTEMPT}`,
    artifactDigest: ARTIFACT_DIGEST,
    eventName: "push",
    verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
  });
});

test("resolver accepts GitHub repository display-case drift with the exact ID", async () => {
  const fixtures = validApiFixtures();
  const run = fixtures.runs.workflow_runs[0];
  run.repository.full_name = "programmablehq/PROGRAMMABLE";
  run.repository.html_url = "https://github.com/programmablehq/PROGRAMMABLE";
  run.head_repository.full_name = "programmablehq/PROGRAMMABLE";
  run.html_url = `${run.repository.html_url}/actions/runs/${RUN_ID}`;
  assert.equal((await resolveFixtures(fixtures)).runId, RUN_ID);
});

function skipInterfaceWorker(job) {
  Object.assign(job, {
    conclusion: "skipped",
    runner_id: null,
    runner_name: null,
    runner_group_id: null,
    runner_group_name: null,
    steps: [],
  });
}

test("resolver accepts only the two untouched Interface workers as a skipped pair", async () => {
  const fixtures = validApiFixtures();
  for (const job of fixtures.jobs.jobs) {
    if (VERIFY_INTERFACE_WORKER_JOB_NAMES.includes(job.name)) skipInterfaceWorker(job);
  }
  assert.equal((await resolveFixtures(fixtures)).runId, RUN_ID);
  const aggregate = fixtures.jobs.jobs.find(({ name }) => name === "Interface");
  aggregate.conclusion = "skipped";
  await assert.rejects(resolveFixtures(fixtures));
});

test("resolver rejects missing, mismatched, failed or assigned-but-skipped Interface workers", async () => {
  for (const name of VERIFY_INTERFACE_WORKER_JOB_NAMES) {
    for (const mutate of [
      (job) => { job.conclusion = "failure"; },
      (job) => { job.conclusion = "cancelled"; },
      (job) => { job.status = "in_progress"; },
      (job) => { job.head_sha = "a".repeat(40); },
      (job) => { job.runner_name = "self-hosted"; },
      (job) => { job.name = `${name} substitute`; },
      skipInterfaceWorker,
    ]) {
      const fixtures = validApiFixtures();
      mutate(fixtures.jobs.jobs.find((job) => job.name === name));
      await assert.rejects(resolveFixtures(fixtures));
    }
  }
  for (const mutate of [
    (jobs) => { jobs[0].runner_id = 1; },
    (jobs) => { jobs[0].runner_group_name = "Default"; },
    (jobs) => { jobs[0].steps = [{ conclusion: "skipped" }]; },
  ]) {
    const fixtures = validApiFixtures();
    const workers = fixtures.jobs.jobs.filter(({ name }) => VERIFY_INTERFACE_WORKER_JOB_NAMES.includes(name));
    workers.forEach(skipInterfaceWorker);
    mutate(workers);
    await assert.rejects(resolveFixtures(fixtures));
  }
  const legacyInventory = validApiFixtures();
  legacyInventory.jobs.jobs = legacyInventory.jobs.jobs.filter(
    ({ name }) => !VERIFY_INTERFACE_WORKER_JOB_NAMES.includes(name),
  );
  legacyInventory.jobs.total_count = legacyInventory.jobs.jobs.length;
  await assert.rejects(resolveFixtures(legacyInventory), /inventory/u);
});

test("resolver accepts complete untouched Contract workers only with successful protected aggregates", async () => {
  for (const skipInterface of [false, true]) {
    const fixtures = validApiFixtures();
    for (const job of fixtures.jobs.jobs) {
      if (VERIFY_CONTRACT_WORKER_JOB_NAMES.includes(job.name)
        || (skipInterface && VERIFY_INTERFACE_WORKER_JOB_NAMES.includes(job.name))) {
        skipInterfaceWorker(job);
      }
    }
    assert.equal((await resolveFixtures(fixtures)).runId, RUN_ID);
    fixtures.jobs.jobs.find(({ name }) => name === "Contracts").conclusion = "skipped";
    await assert.rejects(resolveFixtures(fixtures));
  }
});

test("resolver rejects incomplete, failed, substituted or partially skipped Contract workers", async () => {
  assert.deepEqual(VERIFY_CONTRACT_WORKER_JOB_NAMES, [
    "Contracts build",
    "Contracts tests (1/2)",
    "Contracts tests (2/2)",
    "Contracts release and forks",
    "Contracts static analysis",
  ]);
  for (const name of VERIFY_CONTRACT_WORKER_JOB_NAMES) {
    for (const mutate of [
      (job) => { job.conclusion = "failure"; },
      (job) => { job.conclusion = "cancelled"; },
      (job) => { job.status = "queued"; },
      (job) => { job.head_sha = "a".repeat(40); },
      (job) => { job.run_id += 1; },
      (job) => { job.run_attempt += 1; },
      (job) => { job.runner_name = "self-hosted"; },
      (job) => { job.name = `${name} substitute`; },
      skipInterfaceWorker,
    ]) {
      const fixtures = validApiFixtures();
      mutate(fixtures.jobs.jobs.find((job) => job.name === name));
      await assert.rejects(resolveFixtures(fixtures));
    }
  }
  for (const mutate of [
    (job) => { job.runner_id = 1; },
    (job) => { job.runner_name = "GitHub Actions 1"; },
    (job) => { job.runner_group_id = 0; },
    (job) => { job.runner_group_name = "GitHub Actions"; },
    (job) => { job.steps = [{ conclusion: "success" }]; },
    (job) => { job.labels = ["self-hosted"]; },
  ]) {
    const fixtures = validApiFixtures();
    const workers = fixtures.jobs.jobs.filter(({ name }) => VERIFY_CONTRACT_WORKER_JOB_NAMES.includes(name));
    workers.forEach(skipInterfaceWorker);
    mutate(workers[0]);
    await assert.rejects(resolveFixtures(fixtures));
  }
  const oldInventory = validApiFixtures();
  oldInventory.jobs.jobs = oldInventory.jobs.jobs.filter(
    ({ name }) => !VERIFY_CONTRACT_WORKER_JOB_NAMES.includes(name),
  );
  oldInventory.jobs.total_count = oldInventory.jobs.jobs.length;
  await assert.rejects(resolveFixtures(oldInventory), /inventory/u);
});

test("manual Custom V2 release proof binds dispatch intent and full-tree lane", async () => {
  const input = validProofInput();
  input.eventName = "workflow_dispatch";
  input.verificationMode = PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE;
  input.scopeResults = {
    contracts: false,
    custom_v2: true,
    database: false,
    dependencies: false,
    indexer: false,
    interface: false,
    read_model: false,
  };
  input.checkResults = {
    "secret-scan": "success",
    "custom-v2": "success",
    indexer: "skipped",
    "database-pglite": "skipped",
    interface: "skipped",
    contracts: "skipped",
  };
  const proof = buildProductionVerifyProofV1(input);
  assert.equal(proof.run.event, "workflow_dispatch");
  assert.equal(
    proof.run.verificationMode,
    PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE,
  );
  assert.equal(proof.scope.custom_v2, true);

  const fixtures = validApiFixtures();
  fixtures.runs.workflow_runs[0].event = "workflow_dispatch";
  assert.equal(
    (await resolveFixtures(fixtures, {
      verificationMode: PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE,
    })).eventName,
    "workflow_dispatch",
  );
});

test("manual Custom V2 release proof rejects event or scope substitution", () => {
  const input = validProofInput();
  input.eventName = "workflow_dispatch";
  input.verificationMode = PRODUCTION_VERIFY_CUSTOM_V2_RELEASE_MODE;
  assert.throws(() => buildProductionVerifyProofV1(input), /release .* scope/u);

  input.eventName = "push";
  assert.throws(() => buildProductionVerifyProofV1(input), /mode\/event/u);
});

test("resolver rejects a newer canceled run instead of falling back to old success", async () => {
  const fixtures = validApiFixtures();
  const canceled = structuredClone(fixtures.runs.workflow_runs[0]);
  canceled.id += 1;
  canceled.status = "completed";
  canceled.conclusion = "cancelled";
  canceled.run_started_at = "2026-08-11T18:05:00Z";
  canceled.html_url = `${REPOSITORY_URL}/actions/runs/${canceled.id}`;
  fixtures.runs.workflow_runs.push(canceled);
  fixtures.runs.total_count += 1;
  await assert.rejects(resolveFixtures(fixtures), /canceled, incomplete, or mismatched/u);
});

test("resolver revalidates an exact persisted run instead of drifting to a newer rerun", async () => {
  const fixtures = validApiFixtures();
  const newerCanceled = structuredClone(fixtures.runs.workflow_runs[0]);
  newerCanceled.id += 1;
  newerCanceled.status = "completed";
  newerCanceled.conclusion = "cancelled";
  newerCanceled.run_started_at = "2026-08-11T18:05:00Z";
  newerCanceled.html_url =
    `${REPOSITORY_URL}/actions/runs/${newerCanceled.id}`;
  fixtures.runs.workflow_runs.push(newerCanceled);
  fixtures.runs.total_count += 1;
  const resolved = await resolveFixtures(fixtures, {
    expectedRunId: RUN_ID,
    expectedRunAttempt: RUN_ATTEMPT,
  });
  assert.equal(resolved.runId, RUN_ID);
  assert.equal(resolved.runAttempt, RUN_ATTEMPT);
  await assert.rejects(
    resolveFixtures(fixtures, { expectedRunId: RUN_ID }),
    /bound production Verify run identity/iu,
  );
});

test("resolver rejects stale proof completion", async () => {
  const fixtures = validApiFixtures();
  const proofJob = fixtures.jobs.jobs.find(({ name }) => name === VERIFY_PROOF_JOB_NAME);
  proofJob.started_at = "2026-08-11T11:00:00Z";
  proofJob.completed_at = new Date(
    NOW_MS - PRODUCTION_VERIFY_PROOF_MAX_AGE_MS - 1,
  ).toISOString();
  await assert.rejects(resolveFixtures(fixtures), /stale/u);
});

test("resolver rejects branch, workflow, and run identity drift", async () => {
  const mutations = [
    (fixtures) => { fixtures.branchRef.object.sha = "0".repeat(40); },
    (fixtures) => { fixtures.workflow.state = "disabled_manually"; },
    (fixtures) => { fixtures.runs.workflow_runs[0].workflow_id += 1; },
    (fixtures) => { fixtures.runs.workflow_runs[0].path = "other.yml"; },
    (fixtures) => { fixtures.runs.workflow_runs[0].event = "workflow_dispatch"; },
    (fixtures) => { fixtures.runs.workflow_runs[0].head_sha = "0".repeat(40); },
    (fixtures) => { fixtures.runs.workflow_runs[0].head_commit.tree_id = "0".repeat(40); },
    (fixtures) => { fixtures.runs.workflow_runs[0].repository.id += 1; },
    (fixtures) => { fixtures.runs.workflow_runs[0].head_repository.id += 1; },
  ];
  for (const mutate of mutations) {
    const fixtures = validApiFixtures();
    mutate(fixtures);
    await assert.rejects(resolveFixtures(fixtures));
  }
});

test("resolver rejects missing, failed, skipped, unexpected, or self-hosted jobs", async () => {
  const mutations = [
    (fixtures) => { fixtures.jobs.jobs.pop(); fixtures.jobs.total_count -= 1; },
    (fixtures) => {
      fixtures.jobs.jobs = fixtures.jobs.jobs.filter(
        ({ name }) => name !== VERIFY_AGGREGATE_JOB_NAME,
      );
      fixtures.jobs.total_count -= 1;
    },
    (fixtures) => { fixtures.jobs.jobs[0].conclusion = "failure"; },
    (fixtures) => { fixtures.jobs.jobs[1].conclusion = "skipped"; },
    (fixtures) => { fixtures.jobs.jobs[2].name = "Unexpected"; },
    (fixtures) => { fixtures.jobs.jobs[3].runner_name = "self-hosted"; },
    (fixtures) => { fixtures.jobs.jobs[4].labels = ["self-hosted"]; },
    (fixtures) => { fixtures.jobs.jobs[5].runner_group_id = 1; },
    (fixtures) => { fixtures.jobs.jobs[5].runner_group_name = "Default"; },
  ];
  for (const mutate of mutations) {
    const fixtures = validApiFixtures();
    mutate(fixtures);
    await assert.rejects(resolveFixtures(fixtures));
  }
});

test("resolver rejects missing, expired, duplicate, or mismatched artifacts", async () => {
  const mutations = [
    (fixtures) => { fixtures.artifacts.artifacts = []; },
    (fixtures) => { fixtures.artifacts.artifacts[0].expired = true; },
    (fixtures) => { fixtures.artifacts.artifacts[0].digest = "missing"; },
    (fixtures) => { fixtures.artifacts.artifacts[0].workflow_run.id += 1; },
    (fixtures) => { fixtures.artifacts.artifacts[0].workflow_run.head_sha = "0".repeat(40); },
    (fixtures) => {
      fixtures.artifacts.artifacts.push(
        structuredClone(fixtures.artifacts.artifacts[0]),
      );
    },
  ];
  for (const mutate of mutations) {
    const fixtures = validApiFixtures();
    mutate(fixtures);
    await assert.rejects(resolveFixtures(fixtures));
  }
});

test("resolver freshness policy cannot be weakened by an input", async () => {
  await assert.rejects(
    resolveFixtures(validApiFixtures(), {
      maxAgeMs: PRODUCTION_VERIFY_PROOF_MAX_AGE_MS + 1,
    }),
    /freshness policy/u,
  );
});
