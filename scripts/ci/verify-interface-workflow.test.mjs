import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
  "utf8",
));
const jobs = workflow.jobs;
const aggregate = jobs.interface;

function step(job, name) {
  const matches = job.steps.filter((entry) => entry.name === name);
  assert.equal(matches.length, 1, `${name} must run exactly once`);
  return matches[0];
}

test("production proof survives scoped worker skips only after every protected aggregate succeeds", () => {
  const proof = jobs["production-proof"];
  const required = ["scope", "secret-scan", "indexer", "database-pglite",
    "interface", "contracts", "custom-v2", "aggregate"];
  const upstream = new Set();
  function collect(id) {
    for (const dependency of [jobs[id].needs ?? []].flat()) {
      if (upstream.has(dependency)) continue;
      upstream.add(dependency);
      collect(dependency);
    }
  }
  collect("production-proof");
  const results = Object.fromEntries([...upstream].map((id) => [id, "success"]));
  // Reproduce the Custom V2-only run: both protected aggregates pass while
  // all seven Interface/Contracts workers are intentionally untouched.
  const workers = [...jobs.interface.needs, ...jobs.contracts.needs]
    .filter((id) => id !== "scope");
  assert.equal(workers.length, 7);
  for (const id of workers) results[id] = "skipped";

  const condition = proof.if.replaceAll(
    /needs\.([a-z0-9-]+)\.result/gu, 'needs["$1"].result',
  );
  // Actions adds implicit success() when the condition has no status function.
  const expression = /\b(?:always|cancelled|failure|success)\s*\(/u.test(condition)
    ? condition : `success() && (${condition})`;
  function shouldRun({ overrides = {}, cancelled = false,
    ref = "refs/heads/production", event = "workflow_dispatch",
    mode = "custom-v2-release" } = {}) {
    const observed = { ...results, ...overrides };
    return runInNewContext(expression, {
      always: () => true,
      cancelled: () => cancelled,
      success: () => [...upstream].every((id) => observed[id] === "success"),
      github: { ref, event_name: event },
      inputs: { verification_mode: mode },
      needs: Object.fromEntries(required.map((id) => [id, { result: observed[id] }])),
    }, { timeout: 100 });
  }
  assert.equal(shouldRun(), true);
  assert.deepEqual(proof.needs, required);
  assert.equal(shouldRun({ event: "push", mode: "change" }), true);
  assert.equal(shouldRun({ cancelled: true }), false);
  assert.equal(shouldRun({ ref: "refs/heads/main" }), false);
  assert.equal(shouldRun({ event: "pull_request" }), false);
  assert.equal(shouldRun({ mode: "change" }), false);
  for (const id of required) {
    for (const result of ["failure", "cancelled", "skipped", "queued", "unknown", "", undefined]) {
      assert.equal(shouldRun({ overrides: { [id]: result } }), false,
        `${id}=${result} must not produce an attested proof`);
    }
  }
});

function aggregateResult(overrides = {}) {
  const result = spawnSync("bash", ["--noprofile", "--norc", "-c",
    step(aggregate, "Require complete interface verification").run], {
    env: {
      PATH: process.env.PATH,
      SCOPE_RESULT: "success",
      INTERFACE_REQUIRED: "true",
      READ_MODEL_REQUIRED: "false",
      GUIDANCE_ONLY: "false",
      PRESENTATION_ONLY: "false",
      FUNCTIONAL_SCOPES: "false,false,false,false,false,false",
      QUALITY_RESULT: "success",
      BROWSER_BUILD_RESULT: "success",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result.status;
}

test("the real aggregate shell rejects every incomplete, failed, cancelled, or unexpected lane result", () => {
  const results = ["success", "failure", "cancelled", "skipped", "unknown", ""];
  for (const required of ["true", "false"]) {
    for (const qualityResult of results) {
      for (const browserResult of results) {
        const expected = required === "true" ? "success" : "skipped";
        const status = aggregateResult({
          INTERFACE_REQUIRED: required,
          QUALITY_RESULT: qualityResult,
          BROWSER_BUILD_RESULT: browserResult,
        });
        assert.equal(status === 0,
          qualityResult === expected && browserResult === expected,
          JSON.stringify({ required, qualityResult, browserResult }));
      }
    }
  }
});

test("the real aggregate shell rejects missing or failed classification and missing inputs", () => {
  for (const result of ["failure", "cancelled", "skipped", "unknown", ""]) {
    assert.notEqual(aggregateResult({ SCOPE_RESULT: result }), 0, result);
    assert.notEqual(aggregateResult({ SCOPE_RESULT: result, INTERFACE_REQUIRED: "false",
      QUALITY_RESULT: "skipped", BROWSER_BUILD_RESULT: "skipped" }), 0, result);
  }
  for (const required of ["", "unknown", "TRUE", "1"]) {
    assert.notEqual(aggregateResult({ INTERFACE_REQUIRED: required }), 0, required);
  }
  assert.equal(aggregateResult({ READ_MODEL_REQUIRED: "true" }), 0);
  assert.notEqual(aggregateResult({ READ_MODEL_REQUIRED: "true", INTERFACE_REQUIRED: "false",
    QUALITY_RESULT: "skipped", BROWSER_BUILD_RESULT: "skipped" }), 0);
  for (const name of ["SCOPE_RESULT", "INTERFACE_REQUIRED", "READ_MODEL_REQUIRED", "GUIDANCE_ONLY", "PRESENTATION_ONLY", "QUALITY_RESULT", "BROWSER_BUILD_RESULT"]) {
    assert.notEqual(aggregateResult({ [name]: undefined }), 0, name);
  }
});
