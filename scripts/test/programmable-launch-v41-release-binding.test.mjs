import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import * as successor from "../programmable-launch-v41-release-binding.mjs";
import * as legacy from "../programmable-launch-v4-release-binding.mjs";
import { releaseBindingTools } from "../programmable-launch-release-assets.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "programmable-v41-candidate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = ["public/openapi/custom-launch-v4.1.json", ...[
    "pack-config", "create-request", "custom-launch", "source-verification-status",
    "capabilities", "preflight", "onchain-evidence", "exact-wallet-transaction",
  ].map(name => `public/schemas/custom-launch/v4.1/${name}.json`)];
  for (const relative of paths) {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify({ fixtureOnly: relative }));
  }
  const binding = successor.createV4ReleaseCandidate({ repositoryRoot: root });
  return { root, binding, audit: value => successor.auditV4ReleaseBinding({
    repositoryRoot: root, bindingBytes: Buffer.from(JSON.stringify(value)),
  }) };
}

test("successor candidate binds only its exact profile and new machine paths and stays inactive", t => {
  const { root, binding, audit } = fixture(t);
  assert.equal(binding.releaseReady, false);
  assert.equal(binding.releaseIdentity.package.version, "4.1.0");
  assert.equal(binding.releaseIdentity.profile.profileRevision, 2);
  assert.equal(binding.releaseIdentity.policySource.verifiedMergeCommit, "6e33d64609567f6d1d03c9a9d6bd41ee71fe48f4");
  assert.equal(binding.evidence.backend, null);
  assert.equal(binding.blockers.length, 6);
  assert.equal(audit(binding).releaseReady, false);
  const other = successor.createV4ReleaseCandidate({ repositoryRoot: root });
  other.releaseIdentity.profile.profileDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => audit(other), /releaseIdentity/);
  assert.equal(audit(binding).releaseReady, false);
  assert.throws(() => successor.requireV4ReleaseReady({ repositoryRoot: root,
    bindingBytes: Buffer.from(JSON.stringify(binding)) }), /blocked/);
  const schema = JSON.parse(readFileSync(new URL("../../docs/operations/releases/custom-launch-v4.1/cli-release-binding.schema.json", import.meta.url)));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(binding), true, JSON.stringify(validate.errors));
});

test("old release identity, fabricated ready flags and changed machine bytes cannot become successor proof", t => {
  const { root, binding, audit } = fixture(t);
  for (const mutate of [
    value => { value.releaseIdentity.profile.profileVersion = "4.0.0"; },
    value => { value.releaseIdentity.profile.profileRevision = 1; },
    value => { value.releaseReady = true; value.blockers = []; },
    value => { value.releaseIdentity.policySource.verifiedMergeCommit = "a".repeat(40); },
    value => { value.schemaVersion = legacy.V4_RELEASE_BINDING_SCHEMA; },
  ]) {
    const changed = structuredClone(binding); mutate(changed);
    assert.throws(() => audit(changed));
  }
  writeFileSync(path.join(root, binding.machineContracts[0].path), "changed");
  assert.throws(() => audit(binding), /sha256/);
});

test("release selection is closed and 4.1 uses independent backend promotion evidence", () => {
  assert.equal(releaseBindingTools("4.0.0"), legacy);
  assert.equal(releaseBindingTools("4.1.0"), successor);
  assert.equal(releaseBindingTools("3.0.0"), null);
  assert.throws(() => releaseBindingTools("4.2.1"), /Unsupported/);
  assert.throws(() => releaseBindingTools("4.1.0-preview"), /Unsupported/);
  assert.notEqual(successor.V4_BACKEND_AUTHORIZATION_WORKFLOW, legacy.V4_BACKEND_AUTHORIZATION_WORKFLOW);
  assert.match(successor.V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH, /\/v4\.1\//);
  assert.equal(successor.V4_ROBINHOOD_STAGE_BUNDLE_PATH, legacy.V4_ROBINHOOD_STAGE_BUNDLE_PATH);
});

test("successor profile evidence accepts its exact tuple and rejects recomputed legacy evidence", t => {
  const { binding, audit } = fixture(t);
  const old = JSON.parse(readFileSync(new URL("../../docs/operations/releases/custom-launch-v4/cli-release-binding.json", import.meta.url)));
  const evidence = structuredClone(old.evidence.profile);
  evidence.profile = binding.releaseIdentity.profile;
  evidence.profileEvidenceDigest = successor.computeV4ProfileEvidenceDigest(evidence);
  binding.evidence.profile = evidence;
  binding.blockers = binding.blockers.filter(name => name !== "profileEvidence");
  assert.equal(audit(binding).releaseReady, false);
  evidence.profile = old.releaseIdentity.profile;
  evidence.profileEvidenceDigest = successor.computeV4ProfileEvidenceDigest(evidence);
  assert.throws(() => audit(binding), /profile evidence frozen tuple/);
});

test("successor commit chain preserves shared deployed bytes and rejects changed foundation", t => {
  const { root } = fixture(t);
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Release Test",
    "-c", "user.email=release-test@programmable.invalid", ...args], { cwd: root, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  writeFileSync(path.join(root, "stage-marker"), "source"); git("add", "stage-marker"); git("commit", "-m", "source");
  const stageSourceRevision = git("rev-parse", "HEAD"), stageSourceTree = git("rev-parse", "HEAD^{tree}");
  const relative = successor.V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH;
  const shared = path.join(root, relative);
  mkdirSync(path.dirname(shared), { recursive: true });
  const descriptor = { fixtureOnly: "shared deployed foundation" };
  const bytes = JSON.stringify(descriptor); writeFileSync(shared, bytes);
  git("add", relative); git("commit", "-m", "successor producer");
  const producerRevision = git("rev-parse", "HEAD"), producerTree = git("rev-parse", "HEAD^{tree}");
  writeFileSync(path.join(root, "evidence-marker"), "successor evidence");
  git("add", "evidence-marker"); git("commit", "-m", "successor evidence");
  const chain = { repositoryRoot: root, stageSourceRevision, stageSourceTree, producerRevision, producerTree,
    currentRevision: git("rev-parse", "HEAD"), currentTree: git("rev-parse", "HEAD^{tree}"),
    chainDeploymentDescriptorDigest: successor.computeV4ChainDeploymentDescriptorDigest(descriptor) };
  assert.doesNotThrow(() => successor.auditV4ReleaseCommitChain(chain));
  assert.throws(() => legacy.auditV4ReleaseCommitChain(chain), /Phase B outputs must not already exist/);
  assert.throws(() => successor.auditV4ReleaseCommitChain({ ...chain,
    chainDeploymentDescriptorDigest: `0x${"f".repeat(64)}` }), /successor shared deployment descriptor/);
  writeFileSync(shared, JSON.stringify({ changed: true }));
  assert.throws(() => successor.auditV4ReleaseCommitChain(chain), /preserve the exact shared/);
});
