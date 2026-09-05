import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL(
  "../../.github/workflows/produce-robinhood-custom-launch-backend-bridge.yml",
  import.meta.url,
), "utf8");
const packageJson = JSON.parse(readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
));
const verifyWorkflow = readFileSync(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
  "utf8",
);
const finalizer = readFileSync(
  new URL(
    "../../contracts/scripts/finalize-robinhood-custom-launch-deployment.mjs",
    import.meta.url,
  ),
  "utf8",
);

const PHASE_A_PATHS = Object.freeze([
  "release/robinhood-chain-4663/programmable-postdeployment-capture.json",
  "release/robinhood-chain-4663/programmable-postdeployment-capture.attestation.json",
  "release/robinhood-chain-4663/programmable-stage-bundle.json",
  "release/robinhood-chain-4663/programmable-stage-bundle.attestation.json",
  "release/robinhood-chain-4663/production-verify-proof.json",
  "release/robinhood-chain-4663/production-verify-proof.attestation.json",
  "release/robinhood-chain-4663/production-verify-coordinates.json",
]);

const BACKEND_PATHS = Object.freeze([
  "release/robinhood-v4-chain-deployment.v1.json",
  "release/robinhood-v4-prepared-root-source-manifest.v1.json",
  "release/assets/robinhood-v4/ProgrammableLaunchStampRouterV1.standard-input.json",
  "release/assets/robinhood-v4/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "release/robinhood-v4-phase-a-production-capture.v3.json",
  "release/robinhood-v4-phase-a-production-capture.v3.attestation.json",
  "release/robinhood-v4-phase-a-stage-bundle.v1.json",
  "release/robinhood-v4-phase-a-stage-bundle.v1.attestation.json",
]);

function flatYamlMap(source, header, indentation) {
  const start = source.indexOf(header);
  if (start < 0) return null;
  const entries = {};
  const prefix = " ".repeat(indentation);
  const lines = source.slice(start + header.length).split("\n");
  for (const line of lines) {
    if (!line.startsWith(prefix) || line.startsWith(`${prefix} `)) break;
    const match = line.match(/^\s*([a-z][a-z-]*): ([a-z]+)$/u);
    if (match === null || Object.hasOwn(entries, match[1])) return null;
    entries[match[1]] = match[2];
  }
  return entries;
}

function workflowFailures(source = workflow) {
  const failures = [];
  const requireText = (id, text) => {
    if (!source.includes(text)) failures.push(id);
  };
  const requireOrder = (id, earlier, later) => {
    const earlierIndex = source.indexOf(earlier);
    const laterIndex = source.indexOf(later);
    if (earlierIndex < 0 || laterIndex <= earlierIndex) failures.push(id);
  };
  const requireCount = (id, text, expected) => {
    if (source.split(text).length - 1 !== expected) failures.push(id);
  };

  const required = [
    ["name", "name: Produce Robinhood custom-launch backend bridge"],
    ["dispatch-expected-tip", "expected_production_commit:"],
    ["dispatch-import", "phase_a_import_commit:"],
    ["dispatch-confirmation", "PRODUCE ROBINHOOD CUSTOM-LAUNCH BACKEND BRIDGE"],
    ["push-production", "branches:\n      - production"],
    ["authority-guard", "Reject unauthorized producer context"],
    ["repository-id", "test \"$REPOSITORY_ID\" = \"1314365508\""],
    ["protected-ref", "test \"$GITHUB_REF\" = \"refs/heads/production\""],
    ["protected-flag", "test \"$GITHUB_REF_PROTECTED\" = \"true\""],
    ["actor-binding", "test \"$ACTOR\" = \"$TRIGGERING_ACTOR\""],
    ["single-attempt", "test \"$GITHUB_RUN_ATTEMPT\" = \"1\""],
    ["production-environment", "environment: production"],
    ["hosted-runner", "runs-on: ubuntu-24.04"],
    ["hosted-runner-proof", "test \"$RUNNER_ENVIRONMENT\" = \"github-hosted\""],
    ["timeout", "timeout-minutes: 30"],
    ["contents-read", "contents: read"],
    ["non-cancelling", "cancel-in-progress: false"],
    ["checkout-pin", "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09"],
    ["node-pin", "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444"],
    ["upload-pin", "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
    ["no-credentials", "persist-credentials: false"],
    ["complete-history", "fetch-depth: 0"],
    ["node-version", "node-version: 24.14.0"],
    ["npm-version", "npm@11.16.0"],
    ["canonical-fetch", "+refs/heads/production:refs/remotes/origin/production"],
    ["detached-head", "git symbolic-ref -q HEAD"],
    ["canonical-origin", "https://github.com/$GITHUB_REPOSITORY"],
    ["workflow-ref", "produce-robinhood-custom-launch-backend-bridge.yml@$GITHUB_REF"],
    ["first-parent", "git rev-list --parents -n 1 \"$PHASE_A_IMPORT_COMMIT\""],
    ["single-parent-commit", "test \"${#import_line[@]}\" = \"2\""],
    ["first-parent-chain", "git rev-list --first-parent \"$GITHUB_SHA\""],
    ["first-parent-exact", "test \"$first_parent_match\" = \"$PHASE_A_IMPORT_COMMIT\""],
    ["push-after-tip", "test \"$PUSH_AFTER\" = \"$GITHUB_SHA\""],
    ["push-not-created", "test \"$PUSH_CREATED\" = \"false\""],
    ["push-not-deleted", "test \"$PUSH_DELETED\" = \"false\""],
    ["push-not-forced", "test \"$PUSH_FORCED\" = \"false\""],
    ["push-before-parent", "test \"$PUSH_BEFORE\" = \"$PHASE_A_PARENT_COMMIT\""],
    ["push-head-parent", "git rev-parse \"${GITHUB_SHA}^1\""],
    ["exact-diff", "git diff --name-status --no-renames"],
    ["modified-only", "printf 'M\\t%s\\n'"],
    ["regular-mode", "100644 blob"],
    ["parent-regular-mode", "[[ \"$parent_entry\" == \"100644 blob \"*"],
    ["import-regular-mode", "[[ \"$import_entry\" == \"100644 blob \"*"],
    ["current-regular-mode", "[[ \"$current_entry\" == \"100644 blob \"*"],
    ["import-ancestor", "git merge-base --is-ancestor \"$PHASE_A_IMPORT_COMMIT\" \"$GITHUB_SHA\""],
    ["parent-entry", "git ls-tree \"$PHASE_A_PARENT_COMMIT\""],
    ["parent-blob-changed", "test \"$parent_blob\" != \"$import_blob\""],
    ["current-blob-equal", "test \"$import_blob\" = \"$current_blob\""],
    ["blob-rebind", "${PHASE_A_IMPORT_COMMIT}:${relative}"],
    ["physical-blob-rebind", "git hash-object \"$GITHUB_WORKSPACE/$relative\""],
    ["bounded-input", "test \"$file_size\" -le 268435456"],
    ["exact-seven-inventory", "wc -l | tr -d ' ')\" = \"7\""],
    ["phase-a-state", "stage.state !== \"closed-awaiting-backend-readiness\""],
    ["phase-a-release-closed", "stage.releaseReady !== false"],
    ["phase-a-authorization-closed", "stage.publicAuthorization !== false"],
    ["phase-a-writes-closed", "stage.publicWrites !== false"],
    ["capture-source-parent", "test \"$PHASE_A_SOURCE_COMMIT\" = \"$PHASE_A_PARENT_COMMIT\""],
    ["capture-source-tree", "git rev-parse \"${PHASE_A_SOURCE_COMMIT}^{tree}\""],
    ["coordinate-run-id", "--source-verify-run-id \"$VERIFY_RUN_ID\""],
    ["coordinate-attempt", "--source-verify-run-attempt \"$VERIFY_RUN_ATTEMPT\""],
    ["coordinate-artifact-id", "--source-verify-artifact-id \"$VERIFY_ARTIFACT_ID\""],
    ["coordinate-digest", "--source-verify-artifact-digest \"$VERIFY_ARTIFACT_DIGEST\""],
    ["stage-command", "npm run contracts:robinhood:postdeploy:stage-backend-assets --"],
    ["capture-input", "--capture \"$PHASE_A_ROOT/programmable-postdeployment-capture.json\""],
    ["capture-attestation", "--capture-attestation-bundle \"$PHASE_A_ROOT/programmable-postdeployment-capture.attestation.json\""],
    ["stage-input", "--stage \"$PHASE_A_ROOT/programmable-stage-bundle.json\""],
    ["stage-attestation", "--stage-attestation-bundle \"$PHASE_A_ROOT/programmable-stage-bundle.attestation.json\""],
    ["proof-input", "--source-verify-proof \"$PHASE_A_ROOT/production-verify-proof.json\""],
    ["proof-attestation", "--source-verify-attestation-bundle \"$PHASE_A_ROOT/production-verify-proof.attestation.json\""],
    ["external-root", "mktemp -d \"$RUNNER_TEMP/robinhood-backend-bridge.XXXXXX\""],
    ["root-realpath", "realpath \"$OUTPUT_ROOT\""],
    ["root-mode", "stat -c '%a' \"$OUTPUT_ROOT\""],
    ["empty-root", "find \"$OUTPUT_ROOT\" -mindepth 1 -print -quit"],
    ["outside-workspace", "backend bridge output root overlaps the checkout"],
    ["result-command", "result.command !== \"stage-backend-assets\""],
    ["result-assets", "result.assets.length !== expected.length"],
    ["result-release-closed", "result.releaseReady !== false"],
    ["result-no-live-write", "result.wroteLiveArtifacts !== false"],
    ["output-mode", "metadata.mode & 0o777"],
    ["output-symlink", "metadata.isSymbolicLink()"],
    ["output-sha", "createHash(\"sha256\")"],
    ["output-result-digest", "asset.sha256 !== digest"],
    ["output-no-extra", "backend bridge output paths differ"],
    ["checkout-clean", "git status --porcelain=v1 --untracked-files=all"],
    ["pre-generate-rebind", "Rebind protected production immediately before generation"],
    ["post-generate-rebind", "Rebind protected production after generation"],
    ["post-upload-rebind", "Rebind protected production after artifact upload"],
    ["artifact-name", "robinhood-custom-launch-backend-bridge-${{ github.sha }}-${{ steps.validate.outputs.phase_a_import_commit }}-${{ github.run_id }}-${{ github.run_attempt }}"],
    ["artifact-no-missing", "if-no-files-found: error"],
    ["artifact-retention", "retention-days: 90"],
    ["artifact-no-compression", "compression-level: 0"],
    ["artifact-no-overwrite", "overwrite: false"],
    ["artifact-no-hidden", "include-hidden-files: false"],
    ["artifact-digest-normalization", "ARTIFACT_DIGEST=\"sha256:$ARTIFACT_DIGEST_RAW\""],
    ["artifact-not-success", "artifact existence alone is insufficient"],
  ];
  for (const [id, text] of required) requireText(id, text);
  requireCount("minimal-permissions", "contents: read", 2);
  requireCount("all-tip-rebinds", "test \"$api_commit\" = \"$GITHUB_SHA\"", 4);
  requireCount(
    "all-workflow-sha-rebinds",
    "test \"$GITHUB_WORKFLOW_SHA\" = \"$GITHUB_SHA\"",
    4,
  );
  requireCount(
    "all-workflow-ref-rebinds",
    "test \"$GITHUB_WORKFLOW_REF\" = \"$GITHUB_REPOSITORY/.github/workflows/produce-robinhood-custom-launch-backend-bridge.yml@$GITHUB_REF\"",
    4,
  );
  for (const path of PHASE_A_PATHS) {
    const matches = source.match(new RegExp(path.replaceAll(".", "\\."), "gu")) ?? [];
    if (matches.length < 2) failures.push(`phase-a-path-${path}`);
  }
  for (const path of BACKEND_PATHS) requireText(`backend-path-${path}`, path);
  const pushPathsSection = source.slice(
    source.indexOf("    paths:\n"),
    source.indexOf("\npermissions:\n"),
  );
  const pushPaths = [...pushPathsSection.matchAll(/^      - (.+)$/gmu)]
    .map((match) => match[1]);
  if (JSON.stringify(pushPaths) !== JSON.stringify(PHASE_A_PATHS)) {
    failures.push("exact-push-paths");
  }
  const uses = [...source.matchAll(/^\s+uses: ([^\s#]+).*$/gmu)]
    .map((match) => match[1]);
  const expectedUses = [
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ];
  if (JSON.stringify(uses) !== JSON.stringify(expectedUses)) failures.push("exact-action-pins");
  const expectedPermissions = { contents: "read" };
  if (JSON.stringify(flatYamlMap(source, "permissions:\n", 2))
    !== JSON.stringify(expectedPermissions)) failures.push("exact-top-level-permissions");
  if (JSON.stringify(flatYamlMap(source, "    permissions:\n", 6))
    !== JSON.stringify(expectedPermissions)) failures.push("exact-job-permissions");
  if (/^    if:/mu.test(source)) failures.push("security-gate-must-not-skip-job");
  const guardStart = source.indexOf("      - name: Reject unauthorized producer context");
  const guardEnd = source.indexOf(
    "      - name: Check out exact protected production commit",
    guardStart,
  );
  const guard = guardStart >= 0 && guardEnd > guardStart
    ? source.slice(guardStart, guardEnd) : "";
  const guardRequirements = [
    'test "$REPOSITORY_ID" = "1314365508"',
    'case "$GITHUB_EVENT_NAME" in',
    'test "$GITHUB_REF" = "refs/heads/production"',
    'test "$GITHUB_REF_PROTECTED" = "true"',
    'test "$ACTOR" = "$TRIGGERING_ACTOR"',
    'test "$GITHUB_RUN_ATTEMPT" = "1"',
    'test "$RUNNER_ENVIRONMENT" = "github-hosted"',
  ];
  for (const text of guardRequirements) {
    if (!guard.includes(text)) failures.push(`authority-guard-${text}`);
  }

  const forbidden = [
    "contents: write",
    "actions: write",
    "attestations: write",
    "artifact-metadata: write",
    "id-token: write",
    "secrets.",
    "repository_dispatch",
    "pull_request:",
    "git push",
    "gh pr ",
    "gh workflow run",
    "continue-on-error: true",
    "--ignore-registry-errors",
    "programmable-open-hook-v2-internal",
  ];
  for (const text of forbidden) {
    if (source.includes(text)) failures.push(`forbidden-${text}`);
  }

  requireOrder(
    "guard-before-checkout",
    "Reject unauthorized producer context",
    "Check out exact protected production commit",
  );
  requireOrder(
    "validate-before-generate",
    "Validate exact Phase A import and portable coordinates",
    "Rebind protected production immediately before generation",
  );
  requireOrder(
    "rebind-before-generate",
    "Rebind protected production immediately before generation",
    "Generate and verify exact backend bridge",
  );
  requireOrder(
    "generate-before-upload",
    "Generate and verify exact backend bridge",
    "Upload exact public-safe backend bridge",
  );
  requireOrder(
    "upload-before-final-rebind",
    "Upload exact public-safe backend bridge",
    "Rebind protected production after artifact upload",
  );
  return failures;
}

function portableVerifierFailures(source = finalizer) {
  const failures = [];
  const verifierStart = source.indexOf("async function verifyPortableGithubAttestation({");
  const verifierEnd = source.indexOf("async function withFreshGithubTrustedRoot(", verifierStart);
  const callsStart = source.indexOf("async function verifyPortableSourceProof({");
  const callsEnd = source.indexOf(
    "async function verifySigstoreBackendCaptureAttestation({",
    callsStart,
  );
  if (verifierStart < 0 || verifierEnd <= verifierStart || callsStart < 0 || callsEnd <= callsStart) {
    return ["portable-verifier-sections"];
  }
  const verifier = source.slice(verifierStart, verifierEnd);
  const calls = source.slice(callsStart, callsEnd);
  const requiredVerifierText = [
    '"attestation", "verify", subjectPath',
    '"--bundle", bundlePath',
    '"--custom-trusted-root", trustedRootPath',
    '"--repo", repository',
    '"--signer-workflow", `${repository}/${workflow}`',
    '"--source-ref", sourceRef',
    '"--source-digest", sourceRevision',
    '"--signer-digest", sourceRevision',
    '"--deny-self-hosted-runners"',
    '"--format", "json"',
    "result.stderr.length !== 0",
  ];
  for (const text of requiredVerifierText) {
    if (!verifier.includes(text)) failures.push(`portable-verifier-${text}`);
  }
  const attestationCalls = [...calls.matchAll(
    /verifyPortableGithubAttestation\(\{([\s\S]*?)\n\s*\}\);/gu,
  )].map((match) => match[1]);
  const expectedWorkflows = [
    'workflow: ".github/workflows/verify.yml",',
    "workflow: ROBINHOOD_CAPTURE_WORKFLOW,",
    "workflow: ROBINHOOD_CAPTURE_WORKFLOW,",
    "workflow: ROBINHOOD_CAPTURE_WORKFLOW,",
  ];
  if (attestationCalls.length !== expectedWorkflows.length) {
    failures.push("portable-calls-count");
  } else {
    for (const [index, call] of attestationCalls.entries()) {
      if (!call.includes("repository: ROBINHOOD_PRODUCTION_REPOSITORY,")) {
        failures.push(`portable-call-${index}-repository`);
      }
      if (!call.includes(expectedWorkflows[index])) {
        failures.push(`portable-call-${index}-workflow`);
      }
      if (!call.includes("sourceRef: ROBINHOOD_PRODUCTION_REF,")) {
        failures.push(`portable-call-${index}-ref`);
      }
      if (!call.includes("sourceRevision: capture.sourceOrigin.revision,")) {
        failures.push(`portable-call-${index}-revision`);
      }
    }
  }
  return failures;
}

test("Robinhood backend bridge producer is an exact seven-file, read-only hosted lane", () => {
  assert.deepEqual(workflowFailures(), []);
  assert.equal(
    packageJson.scripts["release:custom-launch:v4:backend-bridge:test"],
    "node --test scripts/test/robinhood-custom-launch-backend-bridge-workflow.test.mjs",
  );
  assert.match(
    packageJson.scripts["release:custom-launch:v4:test"],
    /npm run release:custom-launch:v4:backend-bridge:test/u,
  );
  assert.match(
    packageJson.scripts["test:contract-release:ci"],
    /^npm run release:custom-launch:v4:backend-bridge:test &&/u,
  );
  assert.match(
    verifyWorkflow,
    /Verify contract release bindings, forks, and late migration[\s\S]*node scripts\/ci\/contracts-ci\.mjs release/u,
  );
  assert.match(finalizer, /async function verifyPortableGithubAttestation/u);
  assert.match(finalizer, /"--custom-trusted-root", trustedRootPath/u);
  assert.match(
    finalizer,
    /await requireCurrentProtectedContext\([\s\S]*requireDistinct: options\.command !== "verify-stage"/u,
  );
});

test("backend bridge workflow contract mutations fail closed", () => {
  const mutations = [
    ["top-level package write", workflow.replace(
      "permissions:\n  contents: read",
      "permissions:\n  contents: read\n  packages: write",
    )],
    ["job package write", workflow.replace(
      "    permissions:\n      contents: read",
      "    permissions:\n      contents: read\n      packages: write",
    )],
    ["repository identity", workflow.replace('test "$REPOSITORY_ID" = "1314365508"', "true")],
    ["protected ref", workflow.replace('test "$GITHUB_REF_PROTECTED" = "true"', "true")],
    ["rerun", workflow.replace('test "$GITHUB_RUN_ATTEMPT" = "1"', "true")],
    ["persisted credentials", workflow.replace("persist-credentials: false", "persist-credentials: true")],
    ["self-hosted runner", workflow.replace("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest")],
    ["extra input path", workflow.replace(PHASE_A_PATHS[0], "release/unchecked.json")],
    ["unchecked diff", workflow.replace("git diff --name-status --no-renames", "printf trusted")],
    ["non-M import", workflow.replace("printf 'M\\t%s\\n'", "printf 'A\\t%s\\n'")],
    ["non-regular Git mode", workflow.replaceAll("100644 blob", "blob")],
    ["forced push", workflow.replace("test \"$PUSH_FORCED\" = \"false\"", "true")],
    ["created ref", workflow.replace("test \"$PUSH_CREATED\" = \"false\"", "true")],
    ["deleted ref", workflow.replace("test \"$PUSH_DELETED\" = \"false\"", "true")],
    ["before differs from parent", workflow.replace(
      "test \"$PUSH_BEFORE\" = \"$PHASE_A_PARENT_COMMIT\"",
      "true",
    )],
    ["multi-parent import", workflow.replace("test \"${#import_line[@]}\" = \"2\"", "true")],
    ["side-branch import", workflow.replace("git rev-list --first-parent", "git rev-list")],
    ["tip drift", workflow.replaceAll(
      "test \"$api_commit\" = \"$GITHUB_SHA\"",
      "true",
    )],
    ["workflow SHA drift", workflow.replaceAll(
      "test \"$GITHUB_WORKFLOW_SHA\" = \"$GITHUB_SHA\"",
      "true",
    )],
    ["workflow ref drift", workflow.replaceAll(
      "test \"$GITHUB_WORKFLOW_REF\" = \"$GITHUB_REPOSITORY/.github/workflows/produce-robinhood-custom-launch-backend-bridge.yml@$GITHUB_REF\"",
      "true",
    )],
    ["non-physical output root", workflow.replace(
      "mktemp -d \"$RUNNER_TEMP/robinhood-backend-bridge.XXXXXX\"",
      "mkdir output",
    )],
    ["unexpected output path", workflow.replace(BACKEND_PATHS[0], "release/unchecked-output.json")],
    ["extra output", workflow.replace(
      "backend bridge output paths differ",
      "backend bridge output accepted",
    )],
    ["symlink output", workflow.replaceAll("metadata.isSymbolicLink()", "false")],
    ["digest mismatch", workflow.replace("asset.sha256 !== digest", "false")],
    ["missing post-generation rebind", workflow.replace(
      "Rebind protected production after generation",
      "Skip post-generation rebind",
    )],
    ["hidden artifact files", workflow.replace(
      "include-hidden-files: false",
      "include-hidden-files: true",
    )],
    ["artifact overwrite", workflow.replace("overwrite: false", "overwrite: true")],
    ["artifact digest prefix", workflow.replace(
      'ARTIFACT_DIGEST="sha256:$ARTIFACT_DIGEST_RAW"',
      'ARTIFACT_DIGEST="$ARTIFACT_DIGEST_RAW"',
    )],
  ];
  for (const [name, changed] of mutations) {
    assert.notEqual(changed, workflow, `workflow mutation ${name} changed nothing`);
    assert.notDeepEqual(workflowFailures(changed), [], `workflow mutation ${name} escaped`);
  }
});

test("backend bridge locks the portable GitHub attestation verifier policy", () => {
  assert.deepEqual(portableVerifierFailures(), []);
  const mutations = [
    ["bundle", finalizer.replace('"--bundle", bundlePath', '"--bundle", subjectPath')],
    ["trusted root", finalizer.replace(
      '"--custom-trusted-root", trustedRootPath',
      '"--custom-trusted-root", bundlePath',
    )],
    ["repository", finalizer.replace('"--repo", repository', '"--repo", "other/repo"')],
    ["workflow", finalizer.replace(
      '"--signer-workflow", `${repository}/${workflow}`',
      '"--signer-workflow", repository',
    )],
    ["source ref", finalizer.replace('"--source-ref", sourceRef', '"--source-ref", "refs/heads/main"')],
    ["source digest", finalizer.replace(
      '"--source-digest", sourceRevision',
      '"--source-digest", sourceRef',
    )],
    ["signer digest", finalizer.replace(
      '"--signer-digest", sourceRevision',
      '"--signer-digest", sourceRef',
    )],
    ["hosted runner policy", finalizer.replace('"--deny-self-hosted-runners",', "")],
    ["JSON result", finalizer.replace('"--format", "json",', '"--format", "text",')],
    ["capture repository", finalizer.replace(
      "repository: ROBINHOOD_PRODUCTION_REPOSITORY,",
      'repository: "other/repo",',
    )],
    ["capture workflow", finalizer.replace(
      "workflow: ROBINHOOD_CAPTURE_WORKFLOW,",
      'workflow: ".github/workflows/other.yml",',
    )],
    ["production ref", finalizer.replace(
      "sourceRef: ROBINHOOD_PRODUCTION_REF,",
      'sourceRef: "refs/heads/main",',
    )],
    ["Verify workflow", finalizer.replace(
      'workflow: ".github/workflows/verify.yml",',
      'workflow: ".github/workflows/other.yml",',
    )],
  ];
  for (const [name, changed] of mutations) {
    assert.notEqual(changed, finalizer, `portable verifier mutation ${name} changed nothing`);
    assert.notDeepEqual(
      portableVerifierFailures(changed),
      [],
      `portable verifier mutation ${name} escaped`,
    );
  }
});
