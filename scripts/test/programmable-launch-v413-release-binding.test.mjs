import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { decodeExactUtf8 } from "../../packages/launch/src/io.mjs";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalizeJson, parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";
import * as client from "../programmable-launch-v413-release-binding.mjs";
import * as previousClient from "../programmable-launch-v412-release-binding.mjs";
import * as api from "../programmable-launch-v41-release-binding.mjs";
import * as legacy from "../programmable-launch-v4-release-binding.mjs";
import { releaseBindingTools, buildReleaseManifest, releaseNames, RELEASE_ASSET_SCHEMA_V2 } from "../programmable-launch-release-assets.mjs";

const checkoutRoot = fileURLToPath(new URL("../../", import.meta.url));
const FROZEN_V413_REVISION = "1d701081656995a28d4449f9c77190e037fdf2df";
const SNAPSHOT_SHA256 = "810d944aea59eb338a96678db3dd0da2076e3ef778c457bf339a7c3bbbd8e666";
const MAXIMUM_SNAPSHOT_BYTES = 1024 * 1024;
const snapshotPath = new URL("./fixtures/programmable-launch-v413-source.json.gz", import.meta.url);
const snapshotStat = lstatSync(snapshotPath);
assert.ok(snapshotStat.isFile() && snapshotStat.size <= MAXIMUM_SNAPSHOT_BYTES, "bounded snapshot file");
const snapshotBytes = readFileSync(snapshotPath);
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function readFrozenSnapshot(compressed) {
  assert.ok(compressed.length > 0 && compressed.length <= MAXIMUM_SNAPSHOT_BYTES, "bounded snapshot bytes");
  assert.equal(digest(compressed), SNAPSHOT_SHA256, "exact frozen source snapshot digest");
  const decoded = gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 });
  const snapshot = parseStrictJson(decodeExactUtf8(decoded, "historical client snapshot"), {
    maximumBytes: 8 * 1024 * 1024, maximumDepth: 8,
  });
  assert.equal(snapshot.schemaVersion, "programmable.launch-cli-v413-test-source.v1");
  assert.equal(snapshot.sourceCommit, FROZEN_V413_REVISION);
  assert.equal(snapshot.files.length, 32);
  const files = new Map();
  for (const entry of snapshot.files) {
    assert.equal(files.has(entry.path), false, "unique snapshot paths");
    const value = Buffer.from(entry.bytesBase64, "base64");
    assert.equal(value.toString("base64"), entry.bytesBase64, "exact snapshot byte encoding");
    assert.equal(`sha256:${digest(value)}`, entry.sha256, "snapshot file digest");
    files.set(entry.path, value);
  }
  return files;
}
// These are exact Git blob bytes captured from 54ce42d, read only as test data.
// The pinned local snapshot makes shallow/squashed checkouts independent of history.
const frozenFiles = readFrozenSnapshot(snapshotBytes);
function frozenBytes(relative) {
  assert.ok(frozenFiles.has(relative), `missing frozen snapshot path: ${relative}`);
  return frozenFiles.get(relative);
}
const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "programmable-v413-frozen-"));
after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
const sourceBinding = parseStrictJson(decodeExactUtf8(frozenBytes(client.V4_RELEASE_BINDING_PATH), "historical binding"));
for (const file of [...sourceBinding.clientFiles, ...sourceBinding.machineContracts, sourceBinding.existingApiReleaseBinding]) {
  assert.equal(`sha256:${digest(frozenBytes(file.path))}`, file.sha256, "frozen binding file digest");
}
for (const relative of [
  ...sourceBinding.clientFiles.map(value => value.path),
  ...sourceBinding.machineContracts.map(value => value.path),
  api.V4_RELEASE_BINDING_PATH,
  client.V4_RELEASE_BINDING_PATH,
  "docs/operations/releases/custom-launch-v4.1.3/cli-release-binding.schema.json",
]) write(repositoryRoot, relative, frozenBytes(relative));
function write(root, relative, value) {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, value);
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "programmable-v413-client-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const { path: relative } of [...sourceBinding.clientFiles, ...sourceBinding.machineContracts]) {
    write(root, relative, readFileSync(path.join(repositoryRoot, relative)));
  }
  for (const relative of ["public/openapi/custom-launch-v4.1.json", ...[
    "pack-config", "create-request", "custom-launch", "source-verification-status",
    "capabilities", "preflight", "onchain-evidence", "exact-wallet-transaction",
  ].map(name => `public/schemas/custom-launch/v4.1/${name}.json`)]) {
    write(root, relative, JSON.stringify({ fixtureOnly: relative }));
  }
  const apiBinding = api.createV4ReleaseCandidate({ repositoryRoot: root });
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  const binding = client.createV413ClientReleaseBinding({ repositoryRoot: root });
  write(root, client.V4_RELEASE_BINDING_PATH, JSON.stringify(binding));
  return { root, binding, apiBinding, audit: value => client.auditV413ClientSource({
    repositoryRoot: root, bindingBytes: Buffer.from(JSON.stringify(value)),
  }) };
}

test("client source record binds 4.1.3 separately from the unchanged 4.1.0 API identity", () => {
  const result = client.auditV413ClientSource({ repositoryRoot });
  assert.equal(result.productionEvidenceVerified, false);
  assert.equal(Object.hasOwn(result, "releaseReady"), false);
  assert.equal(Object.hasOwn(result.binding, "releaseReady"), false);
  assert.equal(result.binding.package.version, "4.1.3");
  assert.deepEqual(result.binding.clientFiles.map(value => value.path), [
    "packages/launch/package.json",
    "packages/launch/npm-shrinkwrap.json",
    "packages/launch/src/constants.mjs",
    "packages/launch/src/cli.mjs",
    "packages/launch/src/index.mjs",
    "packages/launch/src/api-client.mjs",
    "packages/launch/src/api-response.mjs",
    "packages/launch/src/canonical-json.mjs",
    "packages/launch/src/io.mjs",
    "packages/launch/src/launch-coverage-v1.mjs",
    "packages/launch/schemas/robinhood-launch-coverage-v1.json",
    "packages/launch/bin/programmable-launch.mjs",
    "packages/launch/README.md",
    "packages/launch/src/pack.mjs",
    "packages/launch/src/validate.mjs",
    "packages/launch/src/profile-direct-native-v1.mjs",
    "packages/launch/src/canonical-settlement-fee-vault-v1.mjs",
    "packages/launch/src/canonical-settlement-fee-vault-v2.mjs",
    "packages/launch/src/settlement-fee-vault-validation.mjs",
    "packages/launch/schemas/programmable-launch-pack-config-v3.5.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.artifact.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.build.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.standard-json.json",
    "packages/launch/contracts/settlement-fee-vault-v2/release-binding.v2.json",
    "packages/launch/src/pack-current-profile.mjs",
    "packages/launch/src/profile-v36.mjs",
    "packages/launch/schemas/programmable-launch-pack-config-v3.6.json",
  ]);
  assert.deepEqual({ ...result.binding.ethereumClient }, {
    chainId: "1",
    requestSchemaVersion: "programmable.custom-launch-create-request.v3",
    offlineBuilderDefaultProfileVersion: "3.3.0",
    freshCliDefaultSelection: "current-server-capabilities",
    candidateProfileVersion: "3.5.0",
    packConfigSchemaPath: "packages/launch/schemas/programmable-launch-pack-config-v3.5.json",
    candidateActivation: "requires-server-capabilities",
    profile36Version: "3.6.0",
    profile36PackConfigSchemaPath: "packages/launch/schemas/programmable-launch-pack-config-v3.6.json",
    profile36TradeFeePolicyHash: "sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3",
    activatesWriteProfile: false,
    requiresCliForDirectHttp: false,
  });
  assert.equal(result.binding.apiProfile.profileVersion, "4.1.0");
  assert.equal(result.binding.apiProfile.profileRevision, 2);
  assert.equal(result.binding.existingApiReleaseBinding.path, api.V4_RELEASE_BINDING_PATH);
  assert.equal(result.binding.existingApiReleaseBinding.schemaVersion, api.V4_RELEASE_BINDING_SCHEMA);
  assert.equal(result.binding.coverage.authentication, "none");
  assert.equal(result.binding.coverage.requestAuthorization, false);
  assert.equal(result.binding.coverage.activatesWriteProfile, false);
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(new URL(
    "../../docs/operations/releases/custom-launch-v4.1.3/cli-release-binding.schema.json", import.meta.url))));
  assert.equal(validate(result.binding), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...result.binding, releaseReady: true }), false);
});

test("client patch cannot turn an inactive API candidate into release authority", t => {
  const { root, binding } = fixture(t);
  const result = client.auditV4ReleaseBinding({ repositoryRoot: root });
  assert.equal(result.releaseReady, false);
  assert.equal(result.productionEvidenceVerified, false);
  assert.equal(result.blockers.length, 6);
  assert.equal(canonicalizeJson(result.binding), canonicalizeJson(binding));
  let productionCalls = 0;
  let backendCalls = 0;
  assert.throws(() => client.requireV4ReleaseReady({ repositoryRoot: root,
    verifyProductionProof: () => { productionCalls += 1; return {}; },
    verifyBackendAuthorization: () => { backendCalls += 1; return {}; },
  }), /V4 release binding is blocked/);
  assert.equal(productionCalls, 0);
  assert.equal(backendCalls, 0);
});

test("client binding rejects identity substitutions, forged approval fields, hash and source drift", t => {
  const { root, binding, audit } = fixture(t);
  for (const mutate of [
    value => { value.package.version = "4.1.0"; },
    value => { value.package.tag = "programmable-launch-v4.1.0"; },
    value => { value.apiProfile.profileVersion = "4.1.3"; },
    value => { value.existingApiReleaseBinding.sha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.clientFiles[0].sha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.machineContracts[0].path = "public/openapi/custom-launch-v4.1.json"; },
    value => { value.releaseReady = true; },
    value => { value.coverage.requestAuthorization = true; },
    value => { value.coverage.activatesWriteProfile = true; },
    value => { value.ethereumClient.activatesWriteProfile = true; },
    value => { value.ethereumClient.requiresCliForDirectHttp = true; },
    value => { value.ethereumClient.offlineBuilderDefaultProfileVersion = "3.6.0"; },
    value => { value.ethereumClient.freshCliDefaultSelection = "offline-builder"; },
    value => { value.ethereumClient.profile36TradeFeePolicyHash = `sha256:${"f".repeat(64)}`; },
  ]) {
    const changed = structuredClone(binding); mutate(changed);
    assert.throws(() => audit(changed), /exact client source binding/);
  }
  const cli = "packages/launch/src/cli.mjs";
  write(root, cli, `${readFileSync(path.join(root, cli), "utf8")}\n// Changed source\n`);
  assert.throws(() => audit(binding), /exact client source binding/);
});

test("client response decoding and UTF-8 source drift invalidates the exact client binding", t => {
  for (const name of ["api-client", "api-response", "canonical-json", "io", "pack-current-profile", "profile-v36"]) {
    const { root, binding, audit } = fixture(t);
    const relative = `packages/launch/src/${name}.mjs`;
    write(root, relative, `${readFileSync(path.join(root, relative), "utf8")}\n// Changed response contract\n`);
    assert.throws(() => audit(binding), /exact client source binding/, relative);
  }
});

test("client source validation preserves API identity and public report non-authorization", t => {
  const { root, apiBinding } = fixture(t);
  apiBinding.releaseIdentity.package.version = "4.1.3";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  assert.throws(() => client.createV413ClientReleaseBinding({ repositoryRoot: root }), /existing API release identity/);
  apiBinding.releaseIdentity.package.version = "4.1.0";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  const schema = JSON.parse(readFileSync(path.join(root, "public/schemas/custom-launch/coverage/v1.json")));
  schema.properties.requestAuthorization.properties.requestAuthorized.const = true;
  for (const relative of ["public/schemas/custom-launch/coverage/v1.json", "packages/launch/schemas/robinhood-launch-coverage-v1.json"]) {
    write(root, relative, JSON.stringify(schema));
  }
  assert.throws(() => client.createV413ClientReleaseBinding({ repositoryRoot: root }), /true !== false/);
});

test("client source parser rejects duplicate keys and linked source files", t => {
  const { root, binding } = fixture(t);
  const duplicate = JSON.stringify(binding).replace('"schemaVersion":', '"package":{},"schemaVersion":');
  assert.throws(() => client.auditV413ClientSource({ repositoryRoot: root, bindingBytes: Buffer.from(duplicate) }), /duplicate/i);
  const relative = binding.clientFiles[0].path;
  rmSync(path.join(root, relative));
  symlinkSync(path.join(repositoryRoot, relative), path.join(root, relative));
  assert.throws(() => client.createV413ClientReleaseBinding({ repositoryRoot: root }), /must be a regular file/);
});

test("4.1.3 asset manifest requires its own exact client record and no future release is inferred", () => {
  assert.equal(releaseBindingTools("4.1.3"), client);
  assert.equal(releaseBindingTools("4.1.2"), previousClient);
  assert.equal(releaseBindingTools("4.1.0"), api);
  assert.equal(releaseBindingTools("4.0.0"), legacy);
  for (const version of ["4.999.999", "4.2.0", "4.1.3-preview"]) {
    assert.throws(() => releaseBindingTools(version), /Unsupported/);
  }
  const names = releaseNames("4.1.3");
  const input = { version: "4.1.3", ref: "refs/heads/production", commitSha: "1".repeat(40), treeSha: "2".repeat(40),
    assets: [
      { name: names.tarball, mediaType: "application/gzip", bytes: 10, sha256: "a".repeat(64) },
      { name: names.checksum, mediaType: "text/plain", bytes: 20, sha256: "b".repeat(64) },
      { name: names.sbom, mediaType: "application/vnd.cyclonedx+json", bytes: 30, sha256: "c".repeat(64) },
    ],
    machineContractBinding: { schemaVersion: client.V4_RELEASE_BINDING_SCHEMA,
      path: client.V4_RELEASE_BINDING_PATH, sha256: `sha256:${"d".repeat(64)}` },
  };
  const manifest = buildReleaseManifest(input);
  assert.equal(manifest.schemaVersion, RELEASE_ASSET_SCHEMA_V2);
  assert.equal(manifest.package.version, "4.1.3");
  assert.equal(manifest.package.tag, names.tag);
  assert.deepEqual(manifest.machineContractBinding, input.machineContractBinding);
  for (const historical of [previousClient, api]) {
    assert.throws(() => buildReleaseManifest({ ...input,
      machineContractBinding: { ...input.machineContractBinding,
        schemaVersion: historical.V4_RELEASE_BINDING_SCHEMA, path: historical.V4_RELEASE_BINDING_PATH },
    }), /exact machine-contract binding/);
  }
});


test("Ethereum candidate source, validation and complete V2 module bytes are bound independently", t => {
  for (const relative of [
    "packages/launch/bin/programmable-launch.mjs",
    "packages/launch/README.md",
    "packages/launch/src/pack.mjs",
    "packages/launch/src/validate.mjs",
    "packages/launch/src/profile-direct-native-v1.mjs",
    "packages/launch/src/canonical-settlement-fee-vault-v1.mjs",
    "packages/launch/src/canonical-settlement-fee-vault-v2.mjs",
    "packages/launch/src/settlement-fee-vault-validation.mjs",
    "packages/launch/schemas/programmable-launch-pack-config-v3.5.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.artifact.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.build.json",
    "packages/launch/contracts/settlement-fee-vault-v2/EthereumSettlementFeeVaultV2.standard-json.json",
    "packages/launch/contracts/settlement-fee-vault-v2/release-binding.v2.json"
]) {
    const { root, binding, audit } = fixture(t);
    write(root, relative, Buffer.concat([readFileSync(path.join(root, relative)), Buffer.from("\n")]));
    assert.throws(() => audit(binding), /exact client source binding/, relative);
  }
});

test("Ethereum candidate pack config cannot select a different profile", t => {
  const { root } = fixture(t);
  const relative = "packages/launch/schemas/programmable-launch-pack-config-v3.5.json";
  const changed = JSON.parse(readFileSync(path.join(root, relative)));
  changed.properties.profileVersion.const = "3.6.0";
  write(root, relative, JSON.stringify(changed));
  assert.throws(() => client.createV413ClientReleaseBinding({ repositoryRoot: root }), /explicit Ethereum candidate profile/);
});
