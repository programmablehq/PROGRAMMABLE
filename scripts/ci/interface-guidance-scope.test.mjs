import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
  classifyVerifyPaths,
  INTERFACE_GUIDANCE_LITERAL_PATHS,
  INTERFACE_GUIDANCE_MARKDOWN_PATHS,
  isInterfaceGuidanceOnlyChange,
} from "./classify-verify-paths.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const before = Object.fromEntries(INTERFACE_GUIDANCE_LITERAL_PATHS.map((file) => [file,
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
    .replace(/\/developers\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md/u, "/developers/custom-launch-api-v1.md")]));
const after = Object.fromEntries(Object.entries(before).map(([file, content]) => [file,
  content.replace("/developers/custom-launch-api-v1.md", "/developers/custom-launch-v41.md")]));

function classify(paths = INTERFACE_GUIDANCE_LITERAL_PATHS, overrides = {}) {
  return isInterfaceGuidanceOnlyChange(paths, { baseSha, headSha,
    readChange: (file) => [before[file] ?? "# Old guide\n", after[file] ?? "# Updated guide\n"],
    ...overrides });
}

test("only complete existing guide literals and the two fixed accompanying Markdown files qualify", () => {
  for (const file of INTERFACE_GUIDANCE_LITERAL_PATHS) assert.equal(classify([file]), true);
  assert.equal(classify(), true);
  assert.equal(classify([...INTERFACE_GUIDANCE_LITERAL_PATHS, ...INTERFACE_GUIDANCE_MARKDOWN_PATHS]), true);
  assert.equal(classify(INTERFACE_GUIDANCE_MARKDOWN_PATHS), false);
  assert.equal(classify([]), false);
});

test("changing or deleting any non-URL byte forces full Interface coverage", () => {
  for (const file of INTERFACE_GUIDANCE_LITERAL_PATHS) {
    for (const content of [after[file] + "\n", "\uFEFF" + after[file], after[file].slice(1), after[file].replace("  ", " "),
      after[file].replace(".md", ".md?query=1"), after[file].replace(".md", ".md#anchor"),
      after[file].replace("/developers/", "/other/"), after[file].replace("custom-launch-v41", "../escape"),
      after[file].replace("custom-launch-v41", "custom-launch-${injected}"),
      after[file].replace("custom-launch-v41", "custom-launch-\\u0076"),
      after[file].replace("custom-launch-v41", "custom-launch-\\x76"),
      after[file].replace("custom-launch-v41", "custom-launch-%76"),
      after[file].replace("custom-launch-v41", "custom-launch-`injected`"),
      after[file].replace("custom-launch-v41", 'custom-launch-"injected"'),
      after[file].replace("guideUrl:", "differentUrl:"),
      after[file].replace("robinhoodGuide:", "differentGuide:")].filter((content) => content !== after[file])) {
      assert.equal(classify([file], { readChange: () => [before[file], content] }), false, content);
    }
    const firstLineRemoved = after[file].slice(after[file].indexOf("\n") + 1);
    assert.equal(classify([file], { readChange: () => [before[file], firstLineRemoved] }), false);
    assert.equal(classify([file], { readChange: () => [before[file], before[file]] }), false);
    assert.equal(classify([file], { readChange: () => [before[file] + before[file], after[file] + after[file]] }), false);
  }
});

test("unknown or mixed functional paths and manual release scopes never share reduced coverage", () => {
  for (const file of ["README.md", "public/developers/unknown.md", "components/changed.tsx",
    "lib/server/custom-launch/generic-launch-read-v2.ts", "contracts/src/Changed.sol",
    "supabase/migrations/new.sql", "indexer/src/EventHandlers.ts", "package.json",
    "lib/data-pipeline/changed.ts", "scripts/ci/classify-verify-paths.mjs"]) {
    assert.equal(classify([...INTERFACE_GUIDANCE_LITERAL_PATHS, file]), false, file);
  }
  for (const scope of [classifyVerifyPaths([], { forceAll: true }),
    classifyVerifyPaths(INTERFACE_GUIDANCE_LITERAL_PATHS, { customV2Release: true }),
    { ...classifyVerifyPaths(INTERFACE_GUIDANCE_LITERAL_PATHS), unknown_future_scope: true }]) {
    assert.equal(classify(undefined, { scope }), false);
  }
  assert.equal(classify([...INTERFACE_GUIDANCE_LITERAL_PATHS, INTERFACE_GUIDANCE_LITERAL_PATHS[0]]), false);
});

test("missing, unreadable, malformed, or unchanged Git history falls back to full coverage", () => {
  for (const field of ["baseSha", "headSha"]) {
    for (const value of [undefined, "", "HEAD", "0".repeat(40), "not-a-commit"]) {
      assert.equal(classify(undefined, { [field]: value, readChange: () => { throw new Error("Missing object"); } }), false);
    }
  }
  assert.equal(classify(undefined, { headSha: baseSha }), false);
  for (const content of [undefined, null, Buffer.from("invalid")]) {
    assert.equal(classify(undefined, { readChange: () => [content, after[INTERFACE_GUIDANCE_LITERAL_PATHS[0]]] }), false);
  }
});

test("the trusted-base CLI proves actual Git blobs, refuses deletion/rename/mode changes, and defaults missing base to full", () => {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "programmable-guide-scope-")));
  const repository = path.join(directory, "repository");
  mkdirSync(repository);
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const file = INTERFACE_GUIDANCE_LITERAL_PATHS[0];
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci-fixture@example.invalid");
    mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
    writeFileSync(path.join(repository, file), before[file]);
    git("add", "--", file);
    git("commit", "-m", "Base fixture");
    const original = git("rev-parse", "HEAD");
    writeFileSync(path.join(repository, file), after[file]);
    git("add", "--", file);
    git("commit", "-m", "URL-only fixture");
    const updated = git("rev-parse", "HEAD");
    // The workflow copies this module out of the trusted base; it has no
    // imports from candidate-controlled repository code or dependencies.
    const trusted = path.join(directory, "trusted-base-classifier.mjs");
    writeFileSync(trusted, readFileSync(new URL("./classify-verify-paths.mjs", import.meta.url)));
    const pathsFile = path.join(directory, "paths.txt");
    const classifyCli = (head, paths = [file], base = original) => {
      writeFileSync(pathsFile, `${paths.join("\n")}\n`);
      return execFileSync(process.execPath, [trusted, pathsFile], {
        cwd: repository, encoding: "utf8", env: { PATH: process.env.PATH, BASE_SHA: base, HEAD_SHA: head },
      });
    };
    assert.match(classifyCli(updated), /^interface_guidance_only=true$/mu);
    assert.match(classifyCli(updated, [file], ""), /^interface_guidance_only=false$/mu);
    writeFileSync(path.join(repository, file), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(after[file])]));
    git("add", "--", file);
    git("commit", "-m", "Added BOM fixture");
    const withBom = git("rev-parse", "HEAD");
    assert.match(classifyCli(withBom), /^interface_guidance_only=false$/mu);
    assert.match(classifyCli(original, [file], withBom), /^interface_guidance_only=false$/mu);
    git("update-index", "--chmod=+x", "--", file);
    git("commit", "-m", "Mode-change fixture");
    assert.match(classifyCli(git("rev-parse", "HEAD")), /^interface_guidance_only=false$/mu);
    git("mv", file, `${file}.renamed`);
    git("commit", "-m", "Renamed fixture");
    assert.match(classifyCli(git("rev-parse", "HEAD"), [file, `${file}.renamed`]), /^interface_guidance_only=false$/mu);
    assert.match(classifyCli(git("rev-parse", "HEAD")), /^interface_guidance_only=false$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a base classifier predating the narrow output always selects full Interface verification", () => {
  const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8"));
  const scope = workflow.jobs.scope;
  assert.equal(scope.outputs.interface_guidance_only, "${{ steps.scope.outputs.interface_guidance_only }}");
  const command = scope.steps.find((step) => step.name === "Classify changed paths").run;
  assert.match(command, /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs" > "\$RUNNER_TEMP\/classify-verify-paths\.mjs"/u);
  assert.ok(command.includes([
    'if ! grep -Eq \'^interface_guidance_only=(true|false)$\' "$RUNNER_TEMP/verify-scope.txt"; then',
    '  echo \'interface_guidance_only=false\' >> "$RUNNER_TEMP/verify-scope.txt"',
    "fi",
  ].join("\n")));
});
