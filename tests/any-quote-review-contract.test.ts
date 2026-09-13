import { MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1, MODULE_ENGINE_SHARED_QUOTE_ETH_CHECKS_V1 } from "../lib/module-mode/review-engine-shared-quote-eth";
import { MODULE_ENGINE_POSITION_MANAGER_ENVIRONMENT_V1, MODULE_ENGINE_POSITION_MANAGER_CHECKS_V1 } from "../lib/module-mode/review-engine-position-manager";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { moduleEngineStandardInputV1 } from "../lib/server/module-mode/review-engine-source";
import { keccak256, stringToHex } from "viem";
import frozen from "./fixtures/module-engine-review-build.json";
import { parseReviewSubject } from "../lib/module-mode/review-contract";
import { validateModuleEngineBuildPlanV1, validateModuleEngineTestResultsV1 } from "../lib/module-mode/review-engine-contract";
import { MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1, MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1,
  MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1, MODULE_ENGINE_SHARED_QUOTE_POLICY_V1 } from "../lib/module-mode/review-engine-shared-quote";
import type { ModuleEngineBuildPlanV1, ModuleEngineCompiledCaseV1, ModuleEngineTestResultV1 } from "../lib/module-mode/review-engine-types";

const subject = parseReviewSubject(frozen.subject);
const buy = keccak256(stringToHex("spot.buy.exact-input.v1"));
const sell = keccak256(stringToHex("spot.sell.exact-input.v1"));

/** Synthetic parser vectors only. They do not represent protected execution or approval. */
function planFixture(nativeEth = false): ModuleEngineBuildPlanV1 {
  const plan = structuredClone(frozen.plan) as unknown as ModuleEngineBuildPlanV1;
  return {
    ...plan,
    testEnvironment: nativeEth ? MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1 : MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1,
    configurationAbi: MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1,
    moneyRights: 3,
    testEconomics: { platformBps: 30, buyCreatorBps: 300, sellCreatorBps: 1000 },
    operationPermissions: [
      { operationId: buy, inputRoles: 2, outputRoles: 1, authorization: 0 },
      { operationId: sell, inputRoles: 1, outputRoles: 2, authorization: 0 },
    ],
    cases: plan.cases.map(c => c.expectedDeployment === "revert" ? c : {
      ...c,
      operations: [
        { ...c.operations[0], id: "buy", operationId: buy, inputAsset: c.quoteAsset, outputAsset: c.token },
        { ...c.operations[0], id: "sell", operationId: sell, inputAsset: c.token, outputAsset: c.quoteAsset },
      ],
    }),
  };
}

describe("shared quote protected review policy", () => {
  it("accepts the installed profile with two distinct quotes, exact rights and independent fee vectors", () => {
    expect(validateModuleEngineBuildPlanV1(planFixture(), subject)).toEqual(planFixture());
    const plan = planFixture();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEconomics: { platformBps: 30, buyCreatorBps: 0, sellCreatorBps: 0 } }, subject)).not.toThrow();
  });

  it.each([10, 20, 40])("rejects a substituted base fee of %s bps", platformBps => {
    const plan = planFixture();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEconomics: { ...plan.testEconomics, platformBps } }, subject)).toThrow();
  });

  it.each([-100, 1, 99, 101, 1100])("rejects creator fee %s outside the fixed steps", buyCreatorBps => {
    const plan = planFixture();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEconomics: { ...plan.testEconomics, buyCreatorBps } }, subject)).toThrow("MODULE_ENGINE_TEST_ECONOMICS_INVALID");
  });

  it("rejects a quote allowlist, fixed configuration, extra money rights and changed operation authority", () => {
    const plan = planFixture();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, cases: [plan.cases[0]] }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_ASSET_COVERAGE_MISSING");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, cases: plan.cases.map(c => ({ ...c, fixedConfiguration: true })) }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_DYNAMIC_CONFIGURATION_REQUIRED");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, moneyRights: 7 }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_ECONOMICS_INVALID");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, operationPermissions: plan.operationPermissions.map(p => ({ ...p, authorization: 1 })) }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_PERMISSIONS_INVALID");
  });

  it("rejects unsigned or reordered configuration ABI and caller-supplied environment settings", () => {
    const plan = planFixture();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, configurationAbi: [...plan.configurationAbi].reverse() }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_ABI_MISMATCH");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, configurationAbi: plan.configurationAbi.map(a => a.type === "int24" ? { ...a, type: "uint24" } : a) }, subject)).toThrow();
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEnvironment: { ...plan.testEnvironment, sourceDigest: `0x${"0".repeat(64)}` } }, subject)).toThrow("MODULE_ENGINE_TEST_ENVIRONMENT_INVALID");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEnvironment: { ...plan.testEnvironment, rpcUrl: "https://fixture.invalid" } }, subject)).toThrow("MODULE_ENGINE_SHAPE_INVALID");
  });

  it("keeps historical Engine economics and exact legacy plan bytes unchanged", () => {
    expect(validateModuleEngineBuildPlanV1(frozen.plan, subject)).toEqual(frozen.plan);
  });
});

describe("shared quote evidence is mandatory only for its installed environment", () => {
  const cases = frozen.artifact.cases as unknown as readonly ModuleEngineCompiledCaseV1[];
  function resultsFixture(): ModuleEngineTestResultV1 {
    return { ...structuredClone(frozen.artifact.tests) as ModuleEngineTestResultV1,
      sharedQuoteChecks: cases.map(c => ({ id: c.id, ...Object.fromEntries(MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1.map(key => [key, c.expectedDeployment === "success" ? true : null])) })) as unknown as NonNullable<ModuleEngineTestResultV1["sharedQuoteChecks"]> };
  }
  const verify = (results: ModuleEngineTestResultV1) => validateModuleEngineTestResultsV1(results, subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases, MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1);

  it("requires every closed check and preserves null evidence for expected deployment reverts", () => {
    expect(() => verify(resultsFixture())).not.toThrow();
    expect(() => verify(frozen.artifact.tests as ModuleEngineTestResultV1)).toThrow();
    const wrongCase = resultsFixture();
    const changed = wrongCase.sharedQuoteChecks!.map((c, i) => i === 0 ? { ...c, id: cases[1].id } : c);
    expect(() => verify({ ...wrongCase, sharedQuoteChecks: changed })).toThrow("MODULE_ENGINE_SHARED_QUOTE_TESTS_FAILED");
    expect(() => verify({ ...wrongCase, sharedQuoteChecks: wrongCase.sharedQuoteChecks!.map(c => ({ ...c, arbitraryClaim: true })) })).toThrow("MODULE_ENGINE_SHAPE_INVALID");
  });

  it.each(MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1)("rejects missing or false %s evidence", key => {
    const results = resultsFixture();
    const checks = results.sharedQuoteChecks!.map((c, i) => i === 0 ? { ...c, [key]: false } : c);
    expect(() => verify({ ...results, sharedQuoteChecks: checks })).toThrow("MODULE_ENGINE_SHARED_QUOTE_TESTS_FAILED");
  });

  it("does not add shared evidence to a legacy worker result", () => {
    expect(() => validateModuleEngineTestResultsV1(frozen.artifact.tests as ModuleEngineTestResultV1, subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases)).not.toThrow();
    expect(() => validateModuleEngineTestResultsV1(resultsFixture(), subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases)).toThrow("MODULE_ENGINE_SHAPE_INVALID");
  });
});

describe("native ETH protected review cannot reuse quote-fee approval", () => {
  const cases = frozen.artifact.cases as unknown as readonly ModuleEngineCompiledCaseV1[];
  function resultsFixture(): ModuleEngineTestResultV1 {
    return { ...structuredClone(frozen.artifact.tests) as ModuleEngineTestResultV1,
      sharedQuoteEthChecks: cases.map(c => ({ id: c.id, ...Object.fromEntries(MODULE_ENGINE_SHARED_QUOTE_ETH_CHECKS_V1.map(key => [key, c.expectedDeployment === "success" ? true : null])) as Record<typeof MODULE_ENGINE_SHARED_QUOTE_ETH_CHECKS_V1[number], boolean | null> })) };
  }
  const verify = (results: ModuleEngineTestResultV1, environment = MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1) => validateModuleEngineTestResultsV1(results, subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases, environment);
  it("requires the exact native environment and all native checks while preserving the eight-word configuration", () => {
    expect(validateModuleEngineBuildPlanV1(planFixture(true), subject)).toEqual(planFixture(true));
    expect(() => verify(resultsFixture())).not.toThrow();
    expect(() => verify(frozen.artifact.tests as ModuleEngineTestResultV1)).toThrow();
    expect(() => verify(resultsFixture(), { ...MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1, sourceDigest: MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.sourceDigest } as never)).toThrow("MODULE_ENGINE_TEST_ENVIRONMENT_INVALID");
    const old = { ...structuredClone(frozen.artifact.tests), sharedQuoteChecks: cases.map(c => ({ id: c.id, ...Object.fromEntries(MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1.map(key => [key, true])) })) };
    expect(() => verify(old as unknown as ModuleEngineTestResultV1)).toThrow();
    expect(() => validateModuleEngineTestResultsV1(resultsFixture(), subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases, MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1)).toThrow();
  });
  it.each(MODULE_ENGINE_SHARED_QUOTE_ETH_CHECKS_V1)("rejects absent or failed native %s evidence", key => {
    const r = resultsFixture();
    expect(() => verify({ ...r, sharedQuoteEthChecks: r.sharedQuoteEthChecks!.map((c, i) => i === 0 ? { ...c, [key]: false } : c) })).toThrow("MODULE_ENGINE_SHARED_QUOTE_ETH_TESTS_FAILED");
  });
});

describe("PositionManager review requires its own environment and custody evidence", () => {
  const cases = frozen.artifact.cases as unknown as readonly ModuleEngineCompiledCaseV1[];
  // Synthetic parser vectors; no execution, independent review, or publication authority.
  const resultsFixture = (): ModuleEngineTestResultV1 => ({
    ...structuredClone(frozen.artifact.tests) as ModuleEngineTestResultV1,
    sharedQuoteChecks: cases.map(c => ({ id: c.id, ...Object.fromEntries(MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1.map(key => [key, c.expectedDeployment === "success" ? true : null])) })) as NonNullable<ModuleEngineTestResultV1["sharedQuoteChecks"]>,
    positionManagerChecks: cases.map(c => ({ id: c.id, ...Object.fromEntries(MODULE_ENGINE_POSITION_MANAGER_CHECKS_V1.map(key => [key, c.expectedDeployment === "success" ? true : null])) })) as NonNullable<ModuleEngineTestResultV1["positionManagerChecks"]>,
  });
  const verify = (r: ModuleEngineTestResultV1) => validateModuleEngineTestResultsV1(r, subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases, MODULE_ENGINE_POSITION_MANAGER_ENVIRONMENT_V1);

  it("keeps the pair-fee policy and rejects borrowing the historical digest", () => {
    const plan = { ...planFixture(), testEnvironment: MODULE_ENGINE_POSITION_MANAGER_ENVIRONMENT_V1 };
    expect(validateModuleEngineBuildPlanV1(plan, subject)).toEqual(plan);
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, testEnvironment: { ...plan.testEnvironment, sourceDigest: MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.sourceDigest } }, subject)).toThrow("MODULE_ENGINE_TEST_ENVIRONMENT_INVALID");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, moneyRights: 7 }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_ECONOMICS_INVALID");
    expect(() => validateModuleEngineBuildPlanV1({ ...plan, cases: [plan.cases[0]] }, subject)).toThrow("MODULE_ENGINE_SHARED_QUOTE_ASSET_COVERAGE_MISSING");
    expect(() => verify(resultsFixture())).not.toThrow();
  });

  it.each(MODULE_ENGINE_POSITION_MANAGER_CHECKS_V1)("rejects absent, false, null and unearned revert-case %s", key => {
    const results = resultsFixture();
    for (const value of [false, null, undefined]) {
      const changed = results.positionManagerChecks!.map((c, i) => i === 0 ? { ...c, [key]: value } : c);
      expect(() => verify({ ...results, positionManagerChecks: changed } as ModuleEngineTestResultV1)).toThrow();
    }
    const changed = results.positionManagerChecks!.map((c, i) => cases[i].expectedDeployment === "revert" ? { ...c, [key]: true } : c);
    expect(() => verify({ ...results, positionManagerChecks: changed })).toThrow("MODULE_ENGINE_POSITION_MANAGER_TESTS_FAILED");
  });

  it("rejects omitted economics, extra fields and reordered custody case identities", () => {
    const results = resultsFixture();
    const { sharedQuoteChecks: _base, ...withoutBase } = results; void _base;
    const { positionManagerChecks: _pm, ...withoutPM } = results; void _pm;
    expect(() => verify(withoutBase)).toThrow("MODULE_ENGINE_SHAPE_INVALID");
    expect(() => verify(withoutPM)).toThrow("MODULE_ENGINE_SHAPE_INVALID");
    expect(() => verify({ ...results, positionManagerChecks: [] })).toThrow("MODULE_ENGINE_POSITION_MANAGER_EVIDENCE_MISSING");
    expect(() => verify({ ...results, positionManagerChecks: [...results.positionManagerChecks!].reverse() })).toThrow("MODULE_ENGINE_POSITION_MANAGER_TESTS_FAILED");
    expect(() => verify({ ...results, positionManagerChecks: results.positionManagerChecks!.map(c => ({ ...c, approved: true })) })).toThrow("MODULE_ENGINE_SHAPE_INVALID");
  });

  it("cannot inject PositionManager evidence into historical or native-ETH results", () => {
    for (const environment of [undefined, MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1, MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1]) {
      expect(() => validateModuleEngineTestResultsV1(resultsFixture(), subject.requestDigest, frozen.artifact.planDigest as `0x${string}`, cases, environment)).toThrow("MODULE_ENGINE_SHAPE_INVALID");
    }
  });

  it("adds UR/periphery/Permit2 import aliases only to the new profile and rejects collisions", () => {
    const source = structuredClone(frozen.source);
    const fixed = (type: string, value: string, maxLength?: number) => ({ type, ...(maxLength === undefined ? {} : { maxLength }), binding: { mode: "fixed", value } });
    const fields = {
      schemaId: fixed("bytes", MODULE_ENGINE_SHARED_QUOTE_POLICY_V1.configurationSchemaId, 32),
      poolManager: fixed("address", `0x${"11".repeat(20)}`), poolManagerCodeHash: fixed("bytes", `0x${"12".repeat(32)}`, 32),
      sharedHook: fixed("address", `0x${"22".repeat(20)}`), quoteAsset: { type: "address", binding: { mode: "input" } },
      initialTick: { type: "string", maxLength: 8, binding: { mode: "input" } },
      validUntil: { type: "uint", bits: 64, min: "1", binding: { mode: "input" } },
      priceEvidenceHash: { type: "bytes", maxLength: 32, binding: { mode: "input" } },
    };
    source.descriptor.configuration = { type: "record", fields, required: Object.keys(fields) } as never;
    source.descriptor.requiresHost.push(MODULE_ENGINE_SHARED_QUOTE_POLICY_V1.hostRequirement);
    const content = "// Synthetic alias fixture only\npragma solidity 0.8.26;\n";
    const sha256 = createHash("sha256").update(content).digest("hex");
    const append = (path: string) => {
      source.files.push({ path, sha256, encoding: "base64", bytes: Buffer.from(content).toString("base64") });
      source.descriptor.source.files.push({ path, sha256 });
    };
    const aliases = [
      ["dependencies/scoped/uniswap/universal-router/A.sol", "@uniswap/universal-router/A.sol"],
      ["lib/universal-router/B.sol", "@uniswap/universal-router/B.sol"],
      ["dependencies/scoped/uniswap/v4-periphery-v211/A.sol", "@uniswap/v4-periphery-v211/A.sol"],
      ["lib/v4-periphery-v211/B.sol", "@uniswap/v4-periphery-v211/B.sol"],
      ["lib/permit2/A.sol", "permit2/A.sol"],
    ];
    aliases.forEach(([path]) => append(path));
    const standard = (positionManager: boolean) => {
      const checked = validateModuleSubmissionRequest(source);
      if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
      const boundSubject = parseReviewSubject({ ...frozen.subject, requestDigest: checked.requestDigest });
      return moduleEngineStandardInputV1(checked.request, boundSubject, { ...planFixture(), requestDigest: checked.requestDigest,
        testEnvironment: positionManager ? MODULE_ENGINE_POSITION_MANAGER_ENVIRONMENT_V1 : MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1 });
    };
    const legacy = standard(false), current = standard(true);
    for (const [original, mapped] of aliases) {
      expect(legacy.sources[original].content).toBe(content); expect(legacy.sources[mapped]).toBeUndefined();
      expect(current.sources[mapped].content).toBe(content); expect(current.sources[original]).toBeUndefined();
    }
    append("lib/universal-router/A.sol");
    expect(() => standard(true)).toThrow("MODULE_BUILD_SOURCE_ALIAS_COLLISION");
    expect(() => standard(false)).not.toThrow();
  });
});
