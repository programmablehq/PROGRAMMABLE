import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  AUTOMATIC_NATIVE_TRADE_FEE_POLICIES_V2,
  directNativeProgrammableTradeFeePolicyHashV36,
  withAutomaticNativeProfileV2,
} from "../../packages/launch/src/profile-v36.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.join(root, "public/openapi");
const base = "https://programmable.market/openapi/base-custom-launch-v1.1.json";
const document = JSON.parse(fs.readFileSync(path.join(directory, path.basename(base))));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/base-finalized-custom-launch-metadata-feed-v1.json")));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false,
  loadSchema: async uri => JSON.parse(fs.readFileSync(path.join(directory, path.basename(new URL(uri).pathname)))),
});
ajv.addSchema(document, base);
const schema = document.paths["/v4/chains/8453/finalized-custom-launches"].get.responses["200"].content["application/json"].schema;
const validate = await ajv.compileAsync({ $ref: base + schema.$ref });

test("the Base OpenAPI validates the actual public finalized feed", () => {
  assert.ok(validate(fixture), JSON.stringify(validate.errors));
  execFileSync(process.execPath, ["scripts/generate-base-custom-openapi.mjs", "--check"], { cwd: root });
});

test("each chain documents reason codes in its unavailable readiness response", () => {
  for (const [slug, chainId] of [["base", "8453"], ["hyperevm", "999"], ["elysium", "99901"]]) {
    const doc = JSON.parse(fs.readFileSync(path.join(directory, `${slug}-custom-launch-v1.1.json`)));
    const responses = doc.paths[`/v4/chains/${chainId}/readiness`].get.responses;
    const schema = responses["503"].content["application/json"].schema;
    const checkReadiness = ajv.compile(schema);
    const blocked = {
      schemaVersion: `programmable.${slug}-custom-readiness.v1`,
      chainId,
      releaseId: "sha256:" + "a".repeat(64),
      sourceCommit: "a".repeat(40),
      mode: "active",
      ready: false,
      publicLaunchAuthorized: false,
      reasonCodes: [`${slug.toUpperCase()}_VERIFICATION_UNAVAILABLE`],
    };
    assert.deepEqual(schema, responses["200"].content["application/json"].schema);
    assert.equal(checkReadiness(blocked), true, JSON.stringify(checkReadiness.errors));
    assert.equal(checkReadiness({ ...blocked, chainId: "1" }), false);
    assert.equal(checkReadiness({ ...blocked, reasonCodes: undefined }), false);
  }
});

test("the Base contract rejects substituted chains, checkpoint schemas and fee policies", () => {
  for (const change of [
    row => { row.chainId = "1"; },
    row => { row.finality.finalizedCheckpoint.schemaVersion = "programmable.ethereum-finalized-checkpoint-quorum.v1"; },
    row => { row.routingFeePolicy.policy.rateBps = 100; },
    row => { row.routingFeePolicy.policy.defaultCollection.recipient = "0x" + "11".repeat(20); },
    row => { row.routingFeePolicy.enforcementBoundary.chainId = "1"; },
    row => { row.routingFeePolicy.policyHash = "sha256:" + "11".repeat(32); },
  ]) {
    const page = structuredClone(fixture);
    change(page.launches[0]);
    assert.equal(validate(page), false);
  }
});

test("each chain binds capabilities and finalized policy hashes to the same fee revision as the CLI", async () => {
  for (const slug of ["base", "hyperevm", "elysium"]) {
    const legacy = JSON.parse(fs.readFileSync(path.join(root, `packages/launch/src/${slug}-profile-v1.json`)));
    const chainId = legacy.chainId;
    const policy = AUTOMATIC_NATIVE_TRADE_FEE_POLICIES_V2[chainId];
    const current = withAutomaticNativeProfileV2(legacy, policy);
    const url = `https://programmable.market/openapi/${slug}-custom-launch-v1.1.json`;
    const spec = JSON.parse(fs.readFileSync(path.join(directory, path.basename(url))));
    if (url !== base) ajv.addSchema(spec, url);
    const validateCapabilities = await ajv.compileAsync({ $ref: url + "#/components/schemas/CustomLaunchCapabilitiesV1" });
    const validateCreateProfile = await ajv.compileAsync({ $ref: url + "#/components/schemas/CustomLaunchCreateRequestV3/properties/launchProfile" });
    const validateFee = await ajv.compileAsync({ $ref: url + "#/components/schemas/RoutingFeePolicyBindingV36" });
    const capabilities = { schemaVersion: "programmable.custom-launch-capabilities.v1", apiVersion: "v4",
      chain: { id: chainId, name: { base: "Base", hyperevm: "HyperEVM", elysium: "Elysium" }[slug] },
      serverTime: "2026-11-19T00:00:00Z", releaseId: "sha256:" + "ab".repeat(32), mode: "active",
      publicLaunchAuthorized: true, moduleMode: false, routes: {}, authentication: {}, profile: legacy };
    assert.ok(validateCapabilities(capabilities), JSON.stringify(validateCapabilities.errors));
    const active = { ...capabilities, profile: current, automaticPlatformFees: {
      policyId: "programmable.automatic-platform-fees.v2", status: "active", chainId, teamWallet: policy.defaultCollection.recipient,
      platformFeeBps: 30, buybackBps: 0, nativePayoutBps: 10000, activationTime: capabilities.serverTime, router: null,
    } };
    assert.ok(validateCapabilities(active), JSON.stringify(validateCapabilities.errors));
    assert.equal(validateCapabilities({ ...active, profile: legacy }), false);
    assert.equal(validateCapabilities({ ...active, profile: { ...current, platformFeePolicy: legacy.platformFeePolicy } }), false);
    assert.ok(validateCreateProfile(current));
    assert.ok(validateCreateProfile(legacy));
    assert.equal(validateCreateProfile({ ...legacy, programmableTradeFeePolicy: policy }), false);
    const binding = structuredClone(fixture.launches[0].routingFeePolicy);
    const bindingSchema = spec.components.schemas.RoutingFeePolicyBindingV36;
    const boundary = bindingSchema.properties.enforcementBoundary.properties;
    Object.assign(binding.enforcementBoundary, { chainId, blockNumber: boundary.blockNumber.const, blockHash: boundary.blockHash.const });
    binding.schemaVersion = bindingSchema.properties.schemaVersion.const;
    for (const selected of [legacy.programmableTradeFeePolicy, policy]) {
      binding.policy = selected;
      binding.policyHash = directNativeProgrammableTradeFeePolicyHashV36(selected);
      assert.ok(validateFee(binding), JSON.stringify(validateFee.errors));
    }
    binding.policyHash = directNativeProgrammableTradeFeePolicyHashV36(legacy.programmableTradeFeePolicy);
    assert.equal(validateFee(binding), false);
  }
});
