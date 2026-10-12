import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { resolveDirectNativeProfile } from "../../packages/launch/src/profile-direct-native-v1.mjs";
import { DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36 as legacy,
  DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2 as treasury,
  DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3 as current } from "../../packages/launch/src/profile-v36.mjs";

const ajv = new Ajv2020({ strict: false, validateFormats: false });
for (const version of ["v1", "v2", "v3", "v3.6"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../../public/openapi/custom-launch-${version}.json`, import.meta.url))),
    `https://programmable.market/openapi/custom-launch-${version}.json`);
}
const schema = name => ajv.getSchema(`https://programmable.market/openapi/custom-launch-v3.6.json#/components/schemas/${name}`);
const selection = {
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
  profileId: "programmable.direct-native-hook-graph.v1", profileRevision: 3,
  targetRoles: { tokenTargetId: "token", hookTargetId: "hook", initializerTargetId: "initializer", platformFeeBindingTargetId: "hook" },
  liquidityModel: { schemaVersion: "programmable.direct-native-liquidity-model-intent.v1", model: "external-concentrated-liquidity", declaredLaunchState: "liquidity_required" },
  fundingMode: "none", accountingMode: "inclusive-selected-total", assessmentBase: "executed-gross-declared-quote",
  feeCurrency: "declared-quote-currency", claimMode: "claim-authority-selected-recipient",
  applicantSelectedBuyHundredthsOfBip: "30000", applicantSelectedSellHundredthsOfBip: "0",
};

test("published schema accepts actual CLI fee policies and rejects mixed rates", () => {
  const validate = schema("DirectNativeHookGraphProfileV1");
  for (const policy of [legacy, treasury, current]) {
    const profile = resolveDirectNativeProfile(selection, { profileVersion: "3.6.0", programmableTradeFeePolicy: policy });
    assert.equal(validate(profile), true, JSON.stringify(validate.errors));
    const changed = structuredClone(profile);
    changed.platformFeePolicy.programmableFeeHundredthsOfBip = policy.rateBps === 100 ? "3000" : "10000";
    assert.equal(validate(changed), false, "declared platform fee must match exact policy");
  }
});

test("current evidence schema understands 100bps without accepting another version's vector", () => {
  const validate = schema("CustomLaunchBehaviorRequirementsV3");
  const vectors = ["swap.zero-for-one.exact-input.multi-size", "swap.zero-for-one.exact-output.multi-size",
    "swap.one-for-zero.exact-input.multi-size", "swap.one-for-zero.exact-output.multi-size", "swap.second-user", "swap.time-advance",
    "liquidity.lifecycle.add-remove-withdraw", "callback.permission-mask-and-declaration", "callback.enabled-entrypoints-and-selectors",
    "callback.canonical-pool-manager-only", "callback.unauthorized-rejected", "callback.wrong-pool-rejected-or-isolated",
    "fee.programmable-hundred-bps", "fee.no-bypass", "fee.no-overcharge", "fee.claim-isolation"].map(vectorId => ({
      vectorId, category: "platform-fee", requirement: "required", claimAxes: ["platform-fee-conformance"],
    }));
  const requirements = { schemaVersion: "programmable.custom-launch-behavior-requirements.v1", vectorSetVersion: "1.3.0",
    riskClass: "standard-swaps", hookPermissionMask: 0, liquidityModel: "external-concentrated-liquidity", vectors,
    requirementsSha256: `sha256:${"ab".repeat(32)}` };
  assert.equal(validate(requirements), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...requirements, vectorSetVersion: "1.2.0" }), false);
  assert.equal(validate({ ...requirements, vectorSetVersion: "1.4.0" }), false);
});
