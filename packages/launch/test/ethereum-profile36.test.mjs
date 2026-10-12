import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import solc from "solc";
import Ajv2020 from "ajv/dist/2020.js";
import { getLaunchCapabilities, validateLaunchRemote } from "../src/api-client.mjs";
import { canonicalizeJson } from "../src/canonical-json.mjs";
import { sha256Digest } from "../src/io.mjs";
import { buildLaunch, packLaunch } from "../src/pack.mjs";
import { packFreshLaunch } from "../src/pack-current-profile.mjs";
import { resolveDirectNativeProfile, validateEmbeddedDirectNativeProfile, hashDirectNativeProfile } from "../src/profile-direct-native-v1.mjs";
import { DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36 as POLICY, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2 as TREASURY_POLICY,
  DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3 as FEE100_POLICY, directNativeProgrammableTradeFeePolicyHashV36 } from "../src/profile-v36.mjs";
import { validateLaunchFile } from "../src/validate.mjs";
import { jsonResponse, validCapabilities, validCapabilities36 as capabilities36 } from "./fixtures/capabilities.mjs";

const POLICY_HASH = "sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3";
const selection = {
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
  profileId: "programmable.direct-native-hook-graph.v1", profileRevision: 3,
  targetRoles: { tokenTargetId: "token", hookTargetId: "hook", initializerTargetId: "initializer", platformFeeBindingTargetId: "hook" },
  liquidityModel: { schemaVersion: "programmable.direct-native-liquidity-model-intent.v1", model: "external-concentrated-liquidity", declaredLaunchState: "liquidity_required" },
  fundingMode: "none", accountingMode: "inclusive-selected-total", assessmentBase: "executed-gross-declared-quote",
  feeCurrency: "declared-quote-currency", claimMode: "claim-authority-selected-recipient",
  applicantSelectedBuyHundredthsOfBip: "30000", applicantSelectedSellHundredthsOfBip: "0",
};

test("3.6 profile has exact backend policy/hash, three targets and the unchanged static admission baseline", () => {
  const prior = resolveDirectNativeProfile(selection, { profileVersion: "3.3.0" });
  const profile = resolveDirectNativeProfile(selection, { profileVersion: "3.6.0" });
  assert.equal(directNativeProgrammableTradeFeePolicyHashV36(), POLICY_HASH);
  assert.equal(profile.graphPolicy.minimumTargets, 3);
  assert.equal(profile.platformFeePolicy.programmableFeeHundredthsOfBip, "3000");
  assert.deepEqual(profile.platformAdmissionPolicy, prior.platformAdmissionPolicy);
  assert.deepEqual(profile.projectMetadataPolicy, prior.projectMetadataPolicy);
  assert.deepEqual(profile.programmableTradeFeePolicy, POLICY);
  assert.deepEqual(validateEmbeddedDirectNativeProfile(profile), profile);
  assert.notEqual(hashDirectNativeProfile(profile), hashDirectNativeProfile(prior));
  assert.equal(resolveDirectNativeProfile(selection).profileVersion, "3.3.0", "offline builder default is retained");
  for (const mutate of [
    value => { delete value.programmableTradeFeePolicy; },
    value => { value.programmableTradeFeePolicy.native30Waiver.applicantAssertionsAccepted = true; },
    value => { value.programmableTradeFeePolicy.defaultCollection.routedRateBps = 0; },
    value => { value.programmableTradeFeePolicy.externalTradeFeeGuaranteed = true; },
    value => { value.graphPolicy.minimumTargets = 4; },
  ]) {
    const changed = structuredClone(profile); mutate(changed);
    assert.throws(() => validateEmbeddedDirectNativeProfile(changed), /closed embedded/);
  }
});

test("active 3.6 capabilities accept only exact collection policy and selected release", async () => {
  const get = value => getLaunchCapabilities({ maxAttempts: 1, fetchImpl: async () => jsonResponse(value) });
  assert.equal((await get(capabilities36())).resource.profile.profileVersion, "3.6.0");
  for (const mutate of [
    value => { value.profile.productionLaunchAuthorized = false; },
    value => { value.profile.profileVersion = "3.7.0"; },
    value => { delete value.programmableTradeFeePolicy; },
    value => { value.programmableTradeFeePolicy.policyHash = `sha256:${"ff".repeat(32)}`; },
    value => { value.programmableTradeFeePolicy.policy.defaultCollection.recipient = "0x0000000000000000000000000000000000000001"; },
    value => { value.programmableTradeFeePolicy.policy.native30Waiver.proof = "getter-only"; },
    value => { value.profile36Release.productionLaunchAuthorized = false; },
    value => { value.profile36Release.mandatoryCanonicalFeeVaultTarget = true; },
    value => { value.requestProfiles.freshSubmissionExactVersions = ["3.3.0"]; },
    value => { value.projectMetadata.strictMetadataProfileVersions = ["3.3.0"]; },
  ]) {
    const changed = capabilities36(); mutate(changed);
    await assert.rejects(get(changed), error => error.details?.code === "CAPABILITIES_CONTRACT_INVALID");
  }
});

test("fresh CLI default follows active capabilities; explicit configurations never query or change versions", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-fresh-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  const calls = [];
  await writeFile(configPath, JSON.stringify({ schemaVersion: "programmable.launch-pack-config.v3" }));
  const packLaunchImpl = async value => { calls.push(value); return value; };
  await packFreshLaunch({ configPath, packLaunchImpl, fetchImpl: async () => jsonResponse(capabilities36()) });
  assert.equal(calls[0].directNativeProfileVersion, "3.6.0");
  for (const profileVersion of ["3.3.0", "3.5.0", "3.6.0"]) {
    await writeFile(configPath, JSON.stringify({ schemaVersion: "programmable.launch-pack-config.v3", profileVersion }));
    await packFreshLaunch({ configPath, packLaunchImpl, fetchImpl: async () => { throw new Error("explicit pack must stay offline"); } });
    assert.equal(Object.hasOwn(calls.at(-1), "directNativeProfileVersion"), false);
  }
  await writeFile(configPath, JSON.stringify({ schemaVersion: "programmable.launch-pack-config.v3" }));
  const inactive = capabilities36(); inactive.profile.productionLaunchAuthorized = false;
  await assert.rejects(packFreshLaunch({ configPath, packLaunchImpl, maxAttempts: 1,
    fetchImpl: async () => jsonResponse(inactive) }), /capabilities/);
  assert.equal(calls.length, 4, "inactive capabilities must not pack or write outputs");
});

test("three-target arbitrary hook pack reproduces exact 3.6 bytes without a fee vault or 3.4/3.5 behavior inputs", async t => {
  const f = await fixture(t);
  const built = await buildLaunch({ configPath: f.configPath });
  const request = JSON.parse(built.requestBytes);
  assert.equal(request.launchProfile.profileVersion, "3.6.0");
  assert.equal(request.graphBundle.targets.length, 3);
  assert.equal(request.launchProfileSelection.targetRoles.platformFeeBindingTargetId, "hook");
  assert.equal(request.launchProfileSelection.platformFeeBinding.programmableFeeHundredthsOfBip, "3000");
  assert.equal(Object.hasOwn(request, "behaviorScenarioInputs"), false, "backend 3.6 uses exact 3.3 request keys");
  const packed = await packLaunch({ configPath: f.configPath });
  const validated = await validateLaunchFile({ launchPath: packed.outputPath, configPath: f.configPath });
  assert.equal(validated.reproducedFromConfig, true);
  assert.equal(validated.requestSha256, built.requestSha256);
  const changed = structuredClone(request); changed.launchProfile.programmableTradeFeePolicy.defaultCollection.routedRateBps = 0;
  await writeFile(packed.outputPath, canonicalizeJson(changed));
  await assert.rejects(validateLaunchFile({ launchPath: packed.outputPath, configPath: f.configPath }), /closed embedded/);
  await writeFile(packed.outputPath, built.requestBytes);
  const schema = JSON.parse(await readFile(new URL("../schemas/programmable-launch-pack-config-v3.6.json", import.meta.url)));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  assert.equal(validate(f.config), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...f.config, behaviorScenarioInputs: {} }), false);
  assert.equal(schema["x-programmable-profile-3-6-contract"].programmableTradeFeePolicyHash, POLICY_HASH);
  // Stored request validation supplies its original version explicitly even with an unversioned config.
  delete f.config.profileVersion;
  await writeFile(f.configPath, JSON.stringify(f.config));
  assert.equal((await validateLaunchFile({ launchPath: packed.outputPath, configPath: f.configPath })).requestSha256, built.requestSha256);
});

test("3.6 preflight against historical capabilities refuses before reading credentials", async () => {
  const request = { schemaVersion: "programmable.custom-launch-create-request.v3", launchProfile: resolveDirectNativeProfile(selection, { profileVersion: "3.6.0" }) };
  const bytes = Buffer.from(canonicalizeJson(request));
  let keyReads = 0, posts = 0;
  await assert.rejects(validateLaunchRemote({ launchPath: "unused-launch.json", configPath: "unused-config.json",
    validateLaunchFileImpl: async () => ({ schemaVersion: request.schemaVersion, requestSha256: sha256Digest(bytes) }),
    readLaunchBytesImpl: async () => bytes,
    loadApiKeyImpl: async () => { keyReads++; return "fixture-only"; },
    fetchImpl: async (_url, init) => { if (init.method !== "GET") posts++; return jsonResponse(validCapabilities()); },
  }), error => error.details?.code === "CAPABILITIES_CONTRACT_INVALID");
  assert.equal(keyReads, 0); assert.equal(posts, 0);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-profile36-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  const source = 'pragma solidity 0.8.26; contract Token { string public name; string public symbol; constructor(string memory name_, string memory symbol_) { name = name_; symbol = symbol_; } } contract Hook { struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; } function beforeInitialize(address, PoolKey calldata, uint160) external view returns(bytes4) { require(msg.sender == address(0x000000000004444c5dc75cB358380D2e3dE08A90)); return this.beforeInitialize.selector; } function arbitraryProjectMethod() external pure returns(uint256) { return 42; } } contract Initializer { function initialize() external {} }';
  await writeFile(path.join(root, "src/Test.sol"), source);
  const input = { language: "Solidity", sources: { "src/Test.sol": { content: source } }, settings: {
    evmVersion: "paris", optimizer: { enabled: true, runs: 1000 }, viaIR: false,
    metadata: { bytecodeHash: "none", appendCBOR: false },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } },
  } };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal(compiled.errors?.filter(value => value.severity === "error").length ?? 0, 0);
  await writeFile(path.join(root, "input.json"), JSON.stringify(input));
  const targets = [];
  for (const [index, name] of ["Token", "Hook", "Initializer"].entries()) {
    const contract = compiled.contracts["src/Test.sol"][name];
    await writeFile(path.join(root, `${name}.json`), JSON.stringify({ abi: contract.abi, metadata: contract.metadata,
      bytecode: contract.evm.bytecode, deployedBytecode: contract.evm.deployedBytecode }));
    targets.push({ targetId: ["token", "hook", "initializer"][index], compilationUnitId: "unit", artifact: `${name}.json`,
      applicantSalt: index === 1 ? { mode: "deterministic-hook-permission-grind-v1", start: "0", maxAttempts: "262144" } : `0x${String(index + 1).padStart(2, "0").repeat(32)}`, constructorArguments: index === 0 ? ["Profile Test", "P36"] : [],
      initializer: null, deploymentValueWei: "0", initializerValueWei: "0", componentKind: index === 0 ? "token" : index === 1 ? "hook" : "other",
      declaredHookPermissions: index === 1 ? ["beforeInitialize"] : null, runtimeImmutables: [] });
  }
  await writeFile(path.join(root, "src/image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await writeFile(path.join(root, "evidence.txt"), "Local synthetic compiler fixture; no execution or launch authority.");
  const now = Math.floor(Date.now() / 1000);
  const config = { schemaVersion: "programmable.launch-pack-config.v3", profileVersion: "3.6.0",
    launchWallet: "0x1111111111111111111111111111111111111111", chainId: "1", nonce: `0x${"22".repeat(32)}`,
    source: { root: ".", paths: ["src"], sourceLineageNonce: "1", publicOrigin: { url: "https://example.com/source", revision: "11".repeat(20) } },
    compilationUnits: [{ compilationUnitId: "unit", standardJson: "input.json" }], targets,
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 0, tickSpacing: 60, quoteCurrency: "0x0000000000000000000000000000000000000000" },
    projectMetadata: { schemaVersion: "programmable.project-metadata-input.v1", token: { name: "Profile Test", symbol: "P36" },
      presentation: { description: "A complete synthetic exact-source arbitrary hook fixture.", image: { sourcePath: "src/image.png", uri: "https://example.com/image.png" },
        links: [{ kind: "website", uri: "https://example.com/" }, { kind: "x", uri: "https://x.com/profiletest" }] } },
    launchProfile: selection, permitWindow: { deadline: String(now + 600), validAfter: String(now) },
    agentAttestation: { agentId: "synthetic-test", checkedAt: new Date().toISOString(), checks: [{ checkId: "compiler", evidence: "evidence.txt" }] },
  };
  const configPath = path.join(root, "config.json"); await writeFile(configPath, JSON.stringify(config));
  return { root, configPath, config };
}


test("new treasury follows current capabilities and reproduces exactly without changing old packs", async t => {
  const f = await fixture(t);
  const before = await buildLaunch({ configPath: f.configPath });
  const current = await buildLaunch({ configPath: f.configPath, directNativeTradeFeePolicy: TREASURY_POLICY });
  const request = JSON.parse(current.requestBytes);
  assert.equal(request.launchProfile.platformFeePolicy.claimAuthority, TREASURY_POLICY.defaultCollection.recipient);
  assert.equal(request.launchProfileSelection.platformFeeBinding.claimAuthority, TREASURY_POLICY.defaultCollection.recipient);
  assert.notEqual(current.requestSha256, before.requestSha256);
  const packed = await packLaunch({ configPath: f.configPath, directNativeTradeFeePolicy: TREASURY_POLICY });
  const validated = await validateLaunchFile({ launchPath: packed.outputPath, configPath: f.configPath });
  assert.equal(validated.reproducedFromConfig, true);
  assert.equal(validated.requestSha256, current.requestSha256);
  const caps = capabilities36();
  caps.programmableTradeFeePolicy.policy = TREASURY_POLICY;
  caps.programmableTradeFeePolicy.policyHash = directNativeProgrammableTradeFeePolicyHashV36(TREASURY_POLICY);
  caps.currentTradeFeePolicy = { ...caps.currentTradeFeePolicy, ...TREASURY_POLICY.defaultCollection, policyVersion: TREASURY_POLICY.policyVersion };
  assert.equal((await getLaunchCapabilities({ maxAttempts: 1, fetchImpl: async () => jsonResponse(caps) })).resource.programmableTradeFeePolicy.policyHash,
    "sha256:e2025776ad3b12e6277575259cccf11444810365975209083fea534d8e70b4b5");
  const config = { ...f.config }; delete config.profileVersion;
  await writeFile(f.configPath, JSON.stringify(config));
  const options = await packFreshLaunch({ configPath: f.configPath, packLaunchImpl: async value => value,
    fetchImpl: async () => jsonResponse(caps) });
  assert.deepEqual(options.directNativeTradeFeePolicy, TREASURY_POLICY);
  assert.equal(JSON.parse(before.requestBytes).launchProfile.platformFeePolicy.claimAuthority, POLICY.defaultCollection.recipient);
});

test("fee100 current capabilities pack and reproduce exactly while legacy policy stays 30bps", async t => {
  const f = await fixture(t);
  const packed = await packLaunch({ configPath: f.configPath, directNativeTradeFeePolicy: FEE100_POLICY });
  const validated = await validateLaunchFile({ launchPath: packed.outputPath, configPath: f.configPath });
  assert.equal(validated.reproducedFromConfig, true);
  const request = JSON.parse(await readFile(packed.outputPath, "utf8"));
  assert.equal(request.launchProfile.platformFeePolicy.programmableFeeHundredthsOfBip, "10000");
  assert.equal(request.launchProfileSelection.platformFeeBinding.programmableFeeHundredthsOfBip, "10000");
  const caps = capabilities36();
  caps.programmableTradeFeePolicy.policy = FEE100_POLICY;
  caps.programmableTradeFeePolicy.policyHash = directNativeProgrammableTradeFeePolicyHashV36(FEE100_POLICY);
  caps.feePolicy.programmableHundredthsOfBip = "10000";
  assert.equal((await getLaunchCapabilities({ maxAttempts: 1, fetchImpl: async () => jsonResponse(caps) }))
    .resource.programmableTradeFeePolicy.policy.rateBps, 100);
  caps.feePolicy.programmableHundredthsOfBip = "3000";
  await assert.rejects(getLaunchCapabilities({ maxAttempts: 1, fetchImpl: async () => jsonResponse(caps) }));
  assert.equal(POLICY.ratePpm, "3000");
});
