#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalizeJson, parseStrictJson } from "../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8 } from "../packages/launch/src/io.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../packages/launch/src/profile-v41.mjs";
import { directNativeProgrammableTradeFeePolicyHashV36, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3 } from "../packages/launch/src/profile-v36.mjs";
import * as apiRelease from "./programmable-launch-v41-release-binding.mjs";

export const V4_RELEASE_BINDING_SCHEMA = "programmable.launch-cli-v4-client-release-binding.v1";
export const V4_RELEASE_BINDING_PATH = "docs/operations/releases/custom-launch-v4.2.0/cli-release-binding.json";
const PACKAGE = Object.freeze({ name: "@programmable/launch", version: "4.2.0",
  tag: "programmable-launch-v4.2.0", repository: "programmablehq/PROGRAMMABLE" });
const CLIENT_FILES = Object.freeze([
  "packages/launch/package.json",
  "packages/launch/npm-shrinkwrap.json",
  "packages/launch/src/constants.mjs",
  "scripts/verify-base-custom-live.mjs",
  "docs/operations/releases/custom-launch-v4.2.0/base-live-acceptance.json",
  "packages/launch/src/base-profile-v1.json",
  "packages/launch/src/launch-protection-base-v1.mjs",
  "packages/launch/contracts/base-launch-protection-v1/standard-json.json",
  "public/openapi/base-custom-launch-v1.json",
  "public/developers/base-custom-launch-api-v1.md",
  "packages/launch/contracts/base-launch-protection-v1/BaseLaunchProtectionModuleV1.artifact.json",
  "packages/launch/contracts/base-launch-protection-v1/BaseProtectedNative30HookV1.artifact.json",
  "packages/launch/contracts/base-launch-protection-v1/BaseProtectedNativeInitializerV1.artifact.json",
  "packages/launch/contracts/base-launch-protection-v1/EthereumNativeFeeVaultV3.artifact.json",
  "packages/launch/contracts/base-launch-protection-v1/ProtectedLaunchTokenV1.artifact.json",
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
  "packages/launch/scripts/build-ethereum-native30-v3.mjs",
  "packages/launch/contracts/ethereum-native30-v3/EthereumNative30HookV3.artifact.json",
  "packages/launch/contracts/ethereum-native30-v3/EthereumNative30HookV3.sol",
  "packages/launch/contracts/ethereum-native30-v3/EthereumNative30HookV3.standard-json.json",
  "packages/launch/contracts/ethereum-native30-v3/EthereumNativeFeeVaultV3.artifact.json",
  "packages/launch/contracts/ethereum-native30-v3/EthereumNativeFeeVaultV3.sol",
  "packages/launch/src/launch-protection.mjs",
  "packages/launch/src/launch-protection-v1.mjs",
  "packages/launch/src/launch-protection-ethereum-v1.mjs",
  "packages/launch/contracts/launch-protection-v1/standard-json.json",
  "packages/launch/contracts/launch-protection-v1/ProtectedLaunchTokenV1.artifact.json",
  "packages/launch/contracts/launch-protection-v1/LaunchProtectionModuleV1.artifact.json",
  "packages/launch/contracts/launch-protection-v1/ProtectedNative30HookV1.artifact.json",
  "packages/launch/contracts/launch-protection-v1/ProtectedNativeInitializerV1.artifact.json",
  "packages/launch/contracts/launch-protection-v1/EthereumNativeFeeVaultV3.artifact.json",
]);
const COVERAGE_CONTRACTS = Object.freeze([
  ["openapi", "public/openapi/launch-coverage-v1.json", "https://programmable.market/openapi/launch-coverage-v1.json"],
  ["response", "public/schemas/custom-launch/coverage/v1.json", "https://programmable.market/schemas/custom-launch/coverage/v1.json"],
]);

const ETHEREUM_CLIENT = Object.freeze({
  "chainId": "1",
  "requestSchemaVersion": "programmable.custom-launch-create-request.v3",
  "offlineBuilderDefaultProfileVersion": "3.3.0",
  "freshCliDefaultSelection": "current-server-capabilities",
  "candidateProfileVersion": "3.5.0",
  "packConfigSchemaPath": "packages/launch/schemas/programmable-launch-pack-config-v3.5.json",
  "candidateActivation": "requires-server-capabilities",
  "profile36Version": "3.6.0",
  "profile36PackConfigSchemaPath": "packages/launch/schemas/programmable-launch-pack-config-v3.6.json",
  "profile36TradeFeePolicyHash": "sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3",
  "profile36TreasuryV2TradeFeePolicyHash": "sha256:e2025776ad3b12e6277575259cccf11444810365975209083fea534d8e70b4b5",
  "profile36Fee100PolicyHash": directNativeProgrammableTradeFeePolicyHashV36(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3),
  "profile36Fee100RateBps": 100,
  "profile36TreasuryV2Recipient": "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  "activatesWriteProfile": false,
  "requiresCliForDirectHttp": false
});

/** Computes candidate source metadata only. This does not validate production evidence. */
export function createV420ClientReleaseBinding({ repositoryRoot }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const packageJson = json(bytes(root, CLIENT_FILES[0]));
  const shrinkwrap = json(bytes(root, CLIENT_FILES[1]));
  assert.equal(packageJson.name, PACKAGE.name, "client package name");
  assert.equal(packageJson.version, PACKAGE.version, "client package version");
  assert.equal(shrinkwrap.name, PACKAGE.name, "client shrinkwrap name");
  assert.equal(shrinkwrap.version, PACKAGE.version, "client shrinkwrap version");
  assert.equal(shrinkwrap.packages?.[""]?.version, PACKAGE.version, "client shrinkwrap root version");
  assert.equal(packageJson.packageManager, "npm@11.16.0", "client package manager");
  const constants = decodeExactUtf8(bytes(root, CLIENT_FILES[2]), "client constants");
  for (const line of [
    'export const PACKAGE_VERSION = "4.2.0";',
    'export const RELEASE_TAG = "programmable-launch-v4.2.0";',
    'export const RELEASE_TARBALL = "programmable-launch-4.2.0.tgz";',
  ]) assert.ok(constants.includes(line), `client constant missing: ${line}`);
  for (const line of [
    'export const DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY = "3.3.0";',
    'export const DIRECT_NATIVE_PROFILE_VERSION_V35 = "3.5.0";',
    'export const DIRECT_NATIVE_PROFILE_VERSION_V36 = "3.6.0";',
    "export const DIRECT_NATIVE_PROFILE_VERSION =\n  DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY;",
  ]) assert.ok(constants.includes(line), `Ethereum client profile constant missing: ${line}`);
  const ethereumSchema = json(bytes(root, ETHEREUM_CLIENT.packConfigSchemaPath));
  assert.equal(ethereumSchema.properties?.profileVersion?.const, "3.5.0", "explicit Ethereum candidate profile");
  const profile36Schema = json(bytes(root, ETHEREUM_CLIENT.profile36PackConfigSchemaPath));
  assert.equal(profile36Schema.properties?.profileVersion?.const, "3.6.0", "explicit Ethereum 3.6 profile");
  assert.equal(profile36Schema.properties?.targets?.minItems, 3, "Ethereum 3.6 free three-target graph");
  assert.equal(profile36Schema["x-programmable-profile-3-6-contract"]?.programmableTradeFeePolicyHash,
    ETHEREUM_CLIENT.profile36TradeFeePolicyHash, "Ethereum 3.6 schema policy hash");
  assert.equal(directNativeProgrammableTradeFeePolicyHashV36(), ETHEREUM_CLIENT.profile36TradeFeePolicyHash,
    "Ethereum 3.6 complete policy hash");
  assert.equal(directNativeProgrammableTradeFeePolicyHashV36(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2),
    ETHEREUM_CLIENT.profile36TreasuryV2TradeFeePolicyHash, "Ethereum treasury revision policy hash");
  assert.equal(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2.defaultCollection.recipient,
    ETHEREUM_CLIENT.profile36TreasuryV2Recipient, "Ethereum treasury revision recipient");
  const apiBytes = bytes(root, apiRelease.V4_RELEASE_BINDING_PATH);
  const apiBinding = json(apiBytes);
  assert.equal(apiBinding.schemaVersion, apiRelease.V4_RELEASE_BINDING_SCHEMA, "existing API binding schema");
  assert.equal(apiBinding.releaseIdentity?.package?.version, "4.1.0", "existing API release identity");
  assert.equal(canonicalizeJson(apiBinding.releaseIdentity?.profile), canonicalizeJson(ROBINHOOD_PROFILE_V41),
    "client patch must retain the exact API profile");
  const packagedSchema = bytes(root, "packages/launch/schemas/robinhood-launch-coverage-v1.json");
  const publicSchema = bytes(root, COVERAGE_CONTRACTS[1][1]);
  assert.deepEqual(packagedSchema, publicSchema, "packaged and public coverage response schemas");
  const responseSchema = json(publicSchema);
  assert.equal(responseSchema.properties?.schemaVersion?.const, "programmable.robinhood-launch-coverage.v1");
  assert.equal(responseSchema.properties?.requestAuthorization?.properties?.requestAuthorized?.const, false);
  assert.equal(responseSchema.properties?.structuralFormat?.properties?.roleAssignments?.properties?.tokenAndHookMayShareAddress?.const, false);
  const openapi = json(bytes(root, COVERAGE_CONTRACTS[0][1]));
  assert.deepEqual(openapi.security, []);
  assert.deepEqual(Object.keys(openapi.paths), ["/v4/chains/4663/launch-coverage"]);
  assert.deepEqual(Object.keys(openapi.paths["/v4/chains/4663/launch-coverage"]), ["get"]);
  assert.deepEqual(openapi.paths["/v4/chains/4663/launch-coverage"].get.security, []);
  const shape = Object.fromEntries(Object.entries(responseSchema)
    .filter(([key]) => !["$schema", "$id", "title", "description"].includes(key)));
  assert.equal(canonicalizeJson(openapi.components?.schemas?.RobinhoodLaunchCoverageV1), canonicalizeJson(shape));
  return {
    $schema: "./cli-release-binding.schema.json",
    schemaVersion: V4_RELEASE_BINDING_SCHEMA,
    package: { ...PACKAGE },
    apiProfile: { ...ROBINHOOD_PROFILE_V41 },
    ethereumClient: { ...ETHEREUM_CLIENT },
    baseClient: { chainId: "8453", requestSchemaVersion: "programmable.custom-launch-create-request.v3",
      profile: json(bytes(root, "packages/launch/src/base-profile-v1.json")),
      capabilities: "https://api.programmable.market/v4/chains/8453/capabilities",
      readiness: "https://api.programmable.market/v4/chains/8453/readiness", moduleMode: false },
    existingApiReleaseBinding: {
      schemaVersion: apiRelease.V4_RELEASE_BINDING_SCHEMA,
      path: apiRelease.V4_RELEASE_BINDING_PATH,
      sha256: digest(apiBytes),
    },
    coverage: {
      path: "/v4/chains/4663/launch-coverage",
      schemaVersion: "programmable.robinhood-launch-coverage.v1",
      authentication: "none", requestAuthorization: false, activatesWriteProfile: false,
    },
    clientFiles: CLIENT_FILES.map(relative => ({ path: relative, sha256: digest(bytes(root, relative)) })),
    machineContracts: COVERAGE_CONTRACTS.map(([name, relative, url]) => ({
      name, path: relative, url, sha256: digest(bytes(root, relative)),
    })),
  };
}

/** Source-only parity check, deliberately separate from release-ready authority. */
export function auditV420ClientSource({ repositoryRoot, bindingBytes = null }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const bindingSource = bindingBytes === null ? bytes(root, V4_RELEASE_BINDING_PATH) : Buffer.from(bindingBytes);
  const binding = json(bindingSource);
  const expected = createV420ClientReleaseBinding({ repositoryRoot: root });
  assert.equal(canonicalizeJson(binding), canonicalizeJson(expected), "exact client source binding");
  return Object.freeze({ binding, bindingPath: V4_RELEASE_BINDING_PATH,
    bindingSha256: digest(bindingSource), productionEvidenceVerified: false });
}

export function auditV4ReleaseBinding(options) {
  const client = auditV420ClientSource(options);
  // The historical identity remains 4.1.0. Never substitute the 4.2.0 package
  // into its signed backend, profile, source or deployment evidence.
  const api = apiRelease.auditV4ReleaseBinding(apiOptions(options));
  assert.equal(api.bindingSha256, client.binding.existingApiReleaseBinding.sha256, "existing API binding digest");
  return Object.freeze({ ...client, releaseReady: api.releaseReady, blockers: api.blockers });
}

export function requireV4ReleaseReady(options) {
  const client = auditV420ClientSource(options);
  const api = apiRelease.requireV4ReleaseReady(apiOptions(options));
  assert.equal(api.bindingSha256, client.binding.existingApiReleaseBinding.sha256, "existing API binding digest");
  return Object.freeze({ ...client, releaseReady: api.releaseReady, blockers: api.blockers,
    productionEvidenceVerified: true, productionProof: api.productionProof,
    backendAuthorization: api.backendAuthorization });
}

function apiOptions(options) {
  return { ...options, bindingPath: apiRelease.V4_RELEASE_BINDING_PATH, bindingBytes: null };
}

function bytes(root, relative) {
  const file = path.join(root, relative);
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), `${relative} must be a regular file`);
  assert.ok(realpathSync(file).startsWith(`${root}${path.sep}`), "source file must remain inside repository");
  const value = readFileSync(file);
  assert.ok(value.length > 0 && value.length <= 16 * 1024 * 1024, "source bytes must be bounded");
  return value;
}
function json(value) {
  return parseStrictJson(decodeExactUtf8(value, "client release binding"), { maximumBytes: 16 * 1024 * 1024, maximumDepth: 96 });
}
function digest(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, flag, repositoryRoot, ...extra] = process.argv.slice(2);
  if (!["create-client-binding", "audit-source", "audit", "verify-release-ready"].includes(command)
    || flag !== "--repository-root" || !repositoryRoot || extra.length !== 0) {
    throw new Error("Usage: programmable-launch-v420-release-binding.mjs <create-client-binding|audit-source|audit|verify-release-ready> --repository-root PATH");
  }
  if (command === "create-client-binding") {
    process.stdout.write(`${JSON.stringify(createV420ClientReleaseBinding({ repositoryRoot }), null, 2)}\n`);
  } else {
    const result = command === "audit-source" ? auditV420ClientSource({ repositoryRoot })
      : command === "audit" ? auditV4ReleaseBinding({ repositoryRoot }) : requireV4ReleaseReady({ repositoryRoot });
    process.stdout.write(`${JSON.stringify({ schemaVersion: V4_RELEASE_BINDING_SCHEMA,
      bindingSha256: result.bindingSha256, productionEvidenceVerified: result.productionEvidenceVerified,
      ...(result.releaseReady === undefined ? {} : { releaseReady: result.releaseReady, blockers: result.blockers }),
    })}\n`);
  }
}
