import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "programmablehq/PROGRAMMABLE";
const repositoryId = 1314365508;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const checkNames = ["Change scope", "Credential leak gate", "Interface quality and tests",
  "Interface browser and build", "Interface", "Contracts", "Custom V2", "Database (PGlite)",
  "Realtime indexer", "Verify aggregate"];

export function eligibleScope(scope) {
  return scope.interface === "true" && ["contracts", "custom_v2", "database", "dependencies", "indexer", "read_model"]
    .every(key => scope[key] === "false");
}

export function validateReuse({ source, run, jobs, expected }) {
  return source?.schema === 1 && source.repositoryId === repositoryId
    && source.event === "pull_request" && source.ref === `refs/pull/${expected.pr}/merge`
    && source.base === expected.base && source.head === expected.head
    && source.tree === expected.tree && source.workflowHash === expected.workflowHash
    && source.runId === run.id && source.attempt === run.run_attempt
    && eligibleScope(source.scope)
    && run.repository?.id === repositoryId && run.head_repository?.id === repositoryId
    && run.event === "pull_request" && run.path === ".github/workflows/verify.yml"
    && run.head_sha === expected.head && run.head_commit?.tree_id === expected.tree
    && run.status === "completed" && run.conclusion === "success"
    && expected.now - Date.parse(run.updated_at) >= 0
    && expected.now - Date.parse(run.updated_at) < 6 * 60 * 60 * 1000
    && checkNames.every(name => {
      const matches = jobs.filter(job => job.name === name);
      return matches.length === 1 && matches[0].conclusion === "success"
        && matches[0].run_id === run.id && matches[0].head_sha === expected.head;
    });
}

async function github(path, binary = false) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`GitHub returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("Oversized verification response");
  return binary ? bytes : JSON.parse(bytes.toString("utf8"));
}

async function main() {
  const env = process.env;
  const scope = Object.fromEntries(readFileSync(env.VERIFY_SCOPE_FILE, "utf8").trim().split("\n")
    .map(line => line.split("=")));
  const source = {
    schema: 1, repositoryId: Number(env.GITHUB_REPOSITORY_ID), event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF, runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
    base: env.BASE_SHA, head: env.HEAD_SHA, tree: git("rev-parse", "HEAD^{tree}"),
    workflowHash: hash(readFileSync(".github/workflows/verify.yml")), scope,
  };
  writeFileSync(join(env.RUNNER_TEMP, "interface-source.json"), JSON.stringify(source) + "\n");
  let reused = "";
  if (env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/production"
    && env.VERIFICATION_MODE === "change" && eligibleScope(scope) && source.repositoryId === repositoryId) {
    try {
      const prs = await github(`commits/${env.GITHUB_SHA}/pulls`);
      const pr = prs.find(pr => pr.merged_at && pr.merge_commit_sha === env.GITHUB_SHA
        && pr.base.ref === "production" && pr.head.repo?.id === repositoryId);
      if (pr) {
        const response = await github(`actions/workflows/verify.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=10`);
        const run = response.workflow_runs.sort((a, b) => b.id - a.id)[0];
        if (run?.status === "completed" && run.conclusion === "success") {
          const [{ jobs }, { artifacts }] = await Promise.all([
            github(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),
            github(`actions/runs/${run.id}/artifacts?per_page=100`),
          ]);
          const matches = artifacts.filter(a => a.name === `interface-source-${run.id}-${run.run_attempt}` && !a.expired);
          if (matches.length === 1) {
            const dir = mkdtempSync(join(tmpdir(), "interface-source-"));
            try {
              const zip = join(dir, "source.zip");
              writeFileSync(zip, await github(`actions/artifacts/${matches[0].id}/zip`, true));
              const bytes = execFileSync("unzip", ["-p", zip, "interface-source.json"], { maxBuffer: 64 * 1024 });
              const original = JSON.parse(bytes.toString("utf8"));
              const expected = { pr: pr.number, base: source.base, head: pr.head.sha, tree: source.tree,
                workflowHash: source.workflowHash, now: Date.now() };
              if (validateReuse({ source: original, run, jobs, expected })) reused = String(run.id);
            } finally { rmSync(dir, { recursive: true, force: true }); }
          }
        }
      }
    } catch {
      console.log("Previous verification is unavailable; running the affected checks normally.");
    }
  }
  appendFileSync(env.GITHUB_OUTPUT, `interface_reuse_run=${reused}\n`);
  if (reused) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `Interface checks reuse [run ${reused}](https://github.com/${repository}/actions/runs/${reused}): identical tested tree, workflow and base.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
