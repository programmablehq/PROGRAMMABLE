import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import ethKit from "../packages/launch/contracts/launch-protection-v1/standard-json.json";
import baseKit from "../packages/launch/contracts/base-launch-protection-v1/standard-json.json";
import hypeKit from "../packages/launch/contracts/hyperevm-launch-protection-v1/standard-json.json";
import implementationLibraries from "../lib/custom-ai/implementation-libraries.json";
import sourcePins from "../contracts/dependencies/source-pins.json";
import { canonicalGeneralSourceCatalog,canonicalImplementationLibraries } from "../lib/custom-ai/canonical-dependencies.server";
import { dependencySourceContext } from "../lib/custom-ai/dependency-source-context";
import { createContractProject } from "../lib/custom-ai/contract-project";
import { createProjectCompiler } from "../lib/custom-ai/compiler-profile";
import { buildGeneralContract } from "../lib/custom-ai/general-builder.server";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { checkedGeneralCheckBlueprint, createGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
const profiles = [
  { chain: 1, kit: ethKit, path: "src/launch-protection/ProtectedNativeInitializerV1.sol", contract: "ProtectedNativeInitializerV1" },
  { chain: 4663, kit: ethKit, path: "src/launch-protection/ProtectedNativeInitializerV1.sol", contract: "ProtectedNativeInitializerV1" },
  { chain: 8453, kit: baseKit, path: "src/base-custom-v1/BaseProtectedNativeInitializerV1.sol", contract: "BaseProtectedNativeInitializerV1" },
  { chain: 999, kit: hypeKit, path: "src/hyperevm-custom-v1/HyperEvmProtectedNativeInitializerV1.sol", contract: "HyperEvmProtectedNativeInitializerV1" },
] as const;
const intent: LaunchIntent = { version: 1, id: "canonical-source-catalog", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "canonical", text: "Keep the original chain protection initializer in the source project.", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
describe("selected canonical protection source context", () => {
  it.each(profiles)("supplies the complete original chain $chain kit in a bounded model view", ({ chain, kit, path }) => {
    const sources = canonicalGeneralSourceCatalog(undefined, chain);
    expect(sources).toEqual(kit.sources);expect(Object.keys(sources)).toHaveLength(41);
    for(const [name,source] of Object.entries(kit.sources))expect(sources[name]).toEqual(source);
    expect(sources[path]).toEqual(kit.sources[path as keyof typeof kit.sources]);
    const context = dependencySourceContext(sources);
    expect(JSON.stringify(context.modelSources).length).toBeLessThan(120_000);
    expect(context.complete).toEqual(sources);
    sources[path].content = "changed by a caller";
    expect(canonicalGeneralSourceCatalog(undefined, chain)[path]).toEqual(kit.sources[path as keyof typeof kit.sources]);
  });
  it("uses the existing pinned Solady and v4 revisions for implementation helpers",()=>{
    expect(implementationLibraries.pins.solady).toBe(sourcePins.dependencies.find(item=>item.name==="Solady")?.commit);
    expect(implementationLibraries.pins.v4Core).toBe(sourcePins.dependencies.find(item=>item.name==="Uniswap v4 Core")?.commit);
    expect(canonicalImplementationLibraries()).toEqual(implementationLibraries.sources);
  });
  it("keeps an earlier user-edited protection source editable and rejects an unsupported network", () => {
    const path = profiles[0].path;
    const previous = createContractProject({ compiler: createProjectCompiler("viair-200-v1", "cancun"),
      sources: { "C.sol": { content: "pragma solidity 0.8.26; contract C {}" }, [path]: { content: "pragma solidity 0.8.26; contract EarlierUserEdit {}" } },
      entrypoints: [{ source: "C.sol", contract: "C", role: "auxiliary" }] }, intent, 1);
    expect(canonicalGeneralSourceCatalog(previous, 1)[path]).toBeUndefined();
    expect(canonicalGeneralSourceCatalog(previous, 8453)[profiles[2].path]).toBeDefined();
    expect(() => canonicalGeneralSourceCatalog(undefined, 10 as 1)).toThrow();
  });
  it("selects the protection compiler before generation and preserves an earlier or explicitly selected profile", () => {
    const production = projectLaunchProductionContext(captured.chains["1"], 1, protection);
    const raw = { contracts: [{ id: "main", source: "C.sol", contract: "C", role: "auxiliary", arguments: [],
      functions: ["function value() view returns (uint256)"], allowReceive: false, allowFallback: false, surfaceRequirements: ["canonical"] }], allowedCalls: [],
      steps: [{ id: "value", contract: "main", signature: "value()", arguments: [], from: "trader-a", afterSeconds: 0,
        value: "0", read: true, requirementIds: [], expect: { status: "success", returns: ["1"] } }] };
    const next = createGeneralCheckBlueprint(raw, intent, 1, "cancun", production);
    expect(next.compiler.viaIR).toBe(true); expect(checkedGeneralCheckBlueprint(next, intent).id).toBe(next.id);
    expect(createGeneralCheckBlueprint(raw, intent, 1, "cancun", production, createProjectCompiler("standard-v1", "cancun")).compiler.viaIR).toBe(false);
    expect(createGeneralCheckBlueprint({ ...raw, compilerProfile: "standard-v1" }, intent, 1, "cancun", production).compiler.viaIR).toBe(false);
  });
});
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual chain-specific protection source imports", () => {
  it.each(profiles)("compiles the original $chain initializer through a thin generated wrapper", async ({ chain, path, contract, kit }) => {
    const content = `pragma solidity 0.8.26;
import {${contract} as CanonicalInitializer, ILaunchUsdFeedV1} from "${path}";
import {IPoolManager} from "lib/v4-core/src/interfaces/IPoolManager.sol";
contract C is CanonicalInitializer {
constructor(IPoolManager manager, address factory, ILaunchUsdFeedV1 feed, bytes32 expectedHash)
CanonicalInitializer(manager, factory, feed, expectedHash) {}
}`;
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "The original initializer is preserved.", summary: "Canonical initializer import",
      sourceFiles: [{ path: "C.sol", content }], entrypoints: [{ source: "C.sol", contract: "C", role: "auxiliary" }], requirementIds: ["canonical"] }), inputTokens: 1, outputTokens: 1 }));
    const production = projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain, protection);
    const result = await buildGeneralContract({ intent, chainId: chain, evmVersion: "cancun", production,
      availableDependencySources: canonicalGeneralSourceCatalog(undefined, chain), messages: [{ role: "user", content: "Use the original protection initializer." }],
      saveProject: async () => undefined }, undefined, { call, compile: compileContractProject });
    expect(result.compilation.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(result.compilation.compiled).toBe(true); expect(call).toHaveBeenCalledTimes(1);
    expect(result.project.compiler.viaIR).toBe(true);
    expect(result.project.sources[path]).toEqual(kit.sources[path as keyof typeof kit.sources]);
    expect(result.compilation.contracts.find(c => c.contract === "C")?.abi.some(item => item.type === "constructor")).toBe(true);
    expect(result.launchReady).toBe(false);
  }, 60_000);
});
