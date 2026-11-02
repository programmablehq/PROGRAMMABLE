import assert from "node:assert/strict";
import test from "node:test";
import { eligibleScope, validateReuse } from "./reuse-interface-verification.mjs";

const scope = { interface: "true", contracts: "false", custom_v2: "false", database: "false", dependencies: "false", indexer: "false", read_model: "false" };
function fixture() {
  const expected = { pr: 10, head: "a".repeat(40), base: "b".repeat(40), tree: "c".repeat(40), workflowHash: "d".repeat(64), now: 1791841200000 };
  const source = { schema: 1, repositoryId: 1314365508, event: "pull_request", ref: "refs/pull/10/merge",
    runId: 123, attempt: 1, base: expected.base, head: expected.head, tree: expected.tree, workflowHash: expected.workflowHash, scope };
  const run = { id: 123, run_attempt: 1, repository: { id: 1314365508 }, head_repository: { id: 1314365508 },
    event: "pull_request", path: ".github/workflows/verify.yml", head_sha: expected.head, head_commit: { tree_id: expected.tree },
    status: "completed", conclusion: "success", updated_at: new Date(expected.now - 60000).toISOString() };
  const jobs = ["Change scope", "Credential leak gate", "Interface quality and tests", "Interface browser and build", "Interface",
    "Contracts", "Custom V2", "Database (PGlite)", "Realtime indexer", "Verify aggregate"]
    .map(name => ({ name, conclusion: "success", run_id: run.id, head_sha: expected.head }));
  return { expected, source, run, jobs };
}

test("only ordinary interface work can reuse completed PR verification", () => {
  assert.equal(eligibleScope(scope), true);
  for (const key of ["contracts", "custom_v2", "database", "dependencies", "indexer", "read_model"])
    assert.equal(eligibleScope({ ...scope, [key]: "true" }), false);
  assert.equal(eligibleScope({}), false);
  assert.equal(validateReuse(fixture()), true);
});

test("a different tree, base, workflow, repository or attempt always requires fresh checks", () => {
  for (const [key, value] of Object.entries({ tree: "other", base: "other", head: "other", workflowHash: "other", repositoryId: 1, attempt: 2, ref: "refs/heads/production" })) {
    const input = fixture(); input.source[key] = value;
    assert.equal(validateReuse(input), false, key);
  }
  const input = fixture(); input.run.head_repository.id = 1;
  assert.equal(validateReuse(input), false);
});

test("failed, stale, canceled, missing or duplicated verification cannot be reused", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", null]) {
    const input = fixture(); input.run.conclusion = conclusion;
    assert.equal(validateReuse(input), false);
  }
  for (const index of fixture().jobs.keys()) {
    const input = fixture(); input.jobs[index].conclusion = "failure";
    assert.equal(validateReuse(input), false);
  }
  const stale = fixture(); stale.expected.now += 7 * 60 * 60 * 1000;
  assert.equal(validateReuse(stale), false);
  const missing = fixture(); missing.jobs.pop(); assert.equal(validateReuse(missing), false);
  const duplicate = fixture(); duplicate.jobs.push(duplicate.jobs[0]); assert.equal(validateReuse(duplicate), false);
});

function finalizing() {
  const input = fixture();
  input.run.status = "in_progress"; input.run.conclusion = null;
  for (const job of input.jobs) job.status = "completed";
  for (const name of ["Contracts build", "Contracts tests (1/2)", "Contracts tests (2/2)",
    "Contracts static analysis", "Contracts release and forks", "Bind production Verify proof"])
    input.jobs.push({ name, status: "completed", conclusion: "skipped", run_id: input.run.id, head_sha: input.expected.head });
  return input;
}

test("completed exact-tree jobs remain reusable while GitHub finalizes the run summary", () => {
  assert.equal(validateReuse(finalizing()), true);
});

test("a finalizing run needs every job, including the final aggregate, to have finished", () => {
  for (const name of ["Verify aggregate", "Interface", "Bind production Verify proof"]) {
    const input = finalizing(); input.jobs.find(job => job.name === name).status = "in_progress";
    assert.equal(validateReuse(input), false, name);
  }
  const missing = finalizing(); missing.jobs.pop(); assert.equal(validateReuse(missing), false);
  const extra = finalizing(); extra.jobs.push({ ...extra.jobs[0], name: "Additional unfinished control", status: "queued" });
  assert.equal(validateReuse(extra), false);
});

test("finalization cannot make a failed or foreign job reusable", () => {
  for (const patch of [{ conclusion: "failure" }, { run_id: 456 }, { head_sha: "f".repeat(40) }]) {
    const input = finalizing(); Object.assign(input.jobs.at(-1), patch);
    assert.equal(validateReuse(input), false);
  }
  const changed = finalizing(); changed.source.tree = "e".repeat(40);
  assert.equal(validateReuse(changed), false);
});
