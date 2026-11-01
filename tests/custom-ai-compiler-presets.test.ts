import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContractProject, projectCompilerInput, type ContractProject } from "../lib/custom-ai/contract-project";
import { approvedProjectCompiler, createProjectCompiler, VIAIR_200_REMAPPINGS } from "../lib/custom-ai/compiler-profile";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { createGeneralCheckBlueprint, checkedGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { buildGeneralContract } from "../lib/custom-ai/general-builder.server";
import { cachedProjectOverview, projectOverview } from "../lib/custom-ai/project-overview";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "compiler-profile-fixture", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "marker", text: "Return the agreed marker", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "surface", text: "Only the agreed public interface exists", kind: "constraint", open: null, origin: { kind: "legacy" } },
] };
const source = "pragma solidity 0.8.26; contract Marker { function marker() external pure returns(uint){return 42;} }";
const checks = () => ({ contracts: [{ id: "marker", source: "Project.sol", contract: "Marker", role: "hook", arguments: [],
  functions: ["function marker() pure returns(uint256)"], allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] }], allowedCalls: [],
  steps: [{ id: "marker", contract: "marker", signature: "marker()", arguments: [], from: "creator", afterSeconds: 0, value: "0", read: true, requirementIds: ["marker"], expect: { status: "success", returns: ["42"] } }] });
const project = (profile: "standard-v1" | "viair-200-v1") => createContractProject({ compiler: createProjectCompiler(profile, "cancun"),
  sources: { "Project.sol": { content: source } }, entrypoints: [{ source: "Project.sol", contract: "Marker", role: "hook" }] }, intent, 999);
const unavailable = async (saved: ContractProject): Promise<CompiledProject> => ({ version: 1, projectHash: saved.hash, artifactHash: `sha256:${"b".repeat(64)}`,
  compiler: saved.compiler.version, compiled: false, contracts: [], diagnostics: [{ severity: "error", message: "Synthetic compiler outage" }], verification: "not-run", launchReady: false });

describe("source-bound approved compiler profiles", () => {
  it("keeps the original default input and binds a different preset into the source and independent checks", () => {
    const standard = project("standard-v1"), ir = project("viair-200-v1");
    expect(projectCompilerInput(standard).settings).not.toHaveProperty("remappings");
    expect(ir.hash).not.toBe(standard.hash); expect(projectCompilerInput(ir).settings).toMatchObject({ optimizer: { enabled: true, runs: 200 }, viaIR: true, remappings: VIAIR_200_REMAPPINGS });
    const declared = createGeneralCheckBlueprint({ ...checks(), compilerProfile: "viair-200-v1" }, intent, 999, "cancun");
    expect(checkedGeneralCheckBlueprint(declared, intent)).toEqual(declared);
    expect(() => bindGeneralCheckBlueprint(declared, standard)).toThrow(); expect(bindGeneralCheckBlueprint(declared, ir).projectHash).toBe(ir.hash);
    expect(cachedProjectOverview(projectOverview("compiler-profile-request-0001", ir))?.compiler).toEqual(ir.compiler);
  });
  it("preserves the saved profile when a later planning declaration omits the hint", () => {
    const ir = project("viair-200-v1"), declared = createGeneralCheckBlueprint(checks(), intent, 999, "cancun", undefined, ir.compiler);
    expect(declared.compiler).toEqual(ir.compiler);
    expect(createGeneralCheckBlueprint(checks(), intent, 999, "cancun").compiler).toEqual(project("standard-v1").compiler);
  });
  it.each([null, "latest", 200, { optimizerRuns: 200 }, "viair-1000-v1"])("rejects an unsupported planning profile %j", profile => {
    expect(() => createGeneralCheckBlueprint({ ...checks(), compilerProfile: profile }, intent, 999, "cancun")).toThrow();
  });
  it("rejects mixed optimizer/IR pairs, unknown compiler options and post-save profile replacement", () => {
    const ir = project("viair-200-v1");
    for (const compiler of [{ ...ir.compiler, optimizerRuns: 1000 }, { ...ir.compiler, viaIR: false }, { ...ir.compiler, optimizerRuns: 201 },
      { ...ir.compiler, version: "latest" }, { ...ir.compiler, remappings: ["a=/tmp/"] }]) {
      if (!Object.hasOwn(compiler, "remappings")) expect(approvedProjectCompiler(compiler)).toBe(false);
      expect(() => createContractProject({ compiler, sources: ir.sources, entrypoints: ir.entrypoints }, intent, 999)).toThrow();
    }
    ir.compiler = createProjectCompiler("standard-v1", "cancun"); expect(() => projectCompilerInput(ir)).toThrow("changed");
  });
  it("passes the predeclared profile to generation once and preserves it on later source changes", async () => {
    const ir = project("viair-200-v1"), blueprint = createGeneralCheckBlueprint({ ...checks(), compilerProfile: "viair-200-v1" }, intent, 999, "cancun");
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "Source saved", summary: "Marker", sourceFiles: [{ path: "Project.sol", content: source }], entrypoints: ir.entrypoints, requirementIds: intent.requirements.map(rule => rule.id) }), inputTokens: 1, outputTokens: 1 }));
    const saveProject = vi.fn(async () => undefined), compile = vi.fn(unavailable);
    const input = { intent, chainId: 999 as const, evmVersion: "cancun" as const, messages: [{ role: "user" as const, content: "Build the saved marker." }], saveProject };
    const first = await buildGeneralContract({ ...input, blueprint }, undefined, { call, compile });
    expect(first.project.compiler).toEqual(ir.compiler); expect(call).toHaveBeenCalledTimes(1); expect(compile).toHaveBeenCalledTimes(1);
    const later = await buildGeneralContract({ ...input, previous: first.project }, undefined, { call, compile });
    expect(later.project.compiler).toEqual(ir.compiler); expect(later.launchReady).toBe(false);
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual canonical protection source compilation", { timeout: 50_000 }, () => {
  it("reproduces all five original artifact templates inside the unchanged isolated compiler bounds", async () => {
    const root = join(process.cwd(), "packages/launch/contracts/launch-protection-v1");
    const standard = JSON.parse(await readFile(join(root, "standard-json.json"), "utf8"));
    const names = ["ProtectedLaunchTokenV1", "ProtectedNative30HookV1", "ProtectedNativeInitializerV1", "EthereumNativeFeeVaultV3", "LaunchProtectionModuleV1"];
    const originals = await Promise.all(names.map(async name => JSON.parse(await readFile(join(root, `${name}.artifact.json`), "utf8"))));
    const entries = originals.map((artifact, index) => ({ source: artifact.sourcePath, contract: artifact.contractName, role: ["token", "hook", "liquidity", "auxiliary", "auxiliary"][index] }));
    expect(standard.settings.remappings).toEqual(VIAIR_200_REMAPPINGS);
    const saved = createContractProject({ compiler: createProjectCompiler("viair-200-v1", "cancun"), sources: standard.sources, entrypoints: entries }, intent, 4663);
    const result = await compileContractProject(saved); expect(result.compiled).toBe(true); expect(result.contracts).toHaveLength(5);
    for (const original of originals) {
      const actual = result.contracts.find(contract => contract.source === original.sourcePath && contract.contract === original.contractName)!;
      expect(actual.creationBytecode).toBe(original.creationBytecode);
      expect(actual.runtimeBytecode).toBe(original.runtimeTemplateHex);
      expect(actual.immutableReferences).toEqual(original.deployedBytecode.immutableReferences);
    }
    expect(result.verification).toBe("not-run"); expect(result.launchReady).toBe(false);
  });
});
