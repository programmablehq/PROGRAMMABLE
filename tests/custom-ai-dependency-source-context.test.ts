import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { compactDependencyCode, dependencySourceContext } from "../lib/custom-ai/dependency-source-context";
import { buildGeneralContract } from "../lib/custom-ai/general-builder.server";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { createContractProject, type ContractProject } from "../lib/custom-ai/contract-project";
import { createProjectCompiler } from "../lib/custom-ai/compiler-profile";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "protected-source-context", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "source", text: "Keep the complete protected source package.", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const compiler = createProjectCompiler("viair-200-v1", "cancun");
const emptyBuild = (project: ContractProject): CompiledProject => ({ version: 1, projectHash: project.hash, artifactHash: `sha256:${"b".repeat(64)}`,
  compiler: compiler.version, compiled: false, diagnostics: [], contracts: [], verification: "not-run", launchReady: false });
async function kit(name: string) {
  return JSON.parse(await readFile(new URL(`../packages/launch/contracts/${name}/standard-json.json`, import.meta.url), "utf8")) as { sources: ContractProject["sources"] };
}

describe("immutable dependency model context", () => {
  it("preserves quoted comment markers, escapes, URLs and token separation", () => {
    const input = String.raw`/* opening */pragma solidity 0.8.26;
contract /* separation */ C {
  string public url = "https://host/a//b/*literal*/";
  string public escaped = "\\\"//still-string";
  bytes public value = hex"2f2a"; // after literal
  function f(uint x) external pure returns(uint) { return x / /* divider */ 2 + +x; }
}`;
    const result = compactDependencyCode(input);
    expect(result).toContain('"https://host/a//b/*literal*/"');
    expect(result).toContain(String.raw`"\\\"//still-string"`);
    expect(result).toContain("contract C");
    expect(result).toContain("x / 2 + +x");
    expect(result).not.toContain("opening");
    expect(result).not.toContain("after literal");
    expect(compactDependencyCode(result)).toBe(result);
  });
  it("rejects an unfinished literal or block comment", () => {
    for (const source of ['/* unfinished', 'contract C { string x = "unfinished', "'unfinished\\"])
      expect(() => compactDependencyCode(source)).toThrow();
  });
  it("keeps small dependency context complete and snapshots it before awaiting", () => {
    const sources = { "Tiny.sol": { content: "// useful context\ncontract Tiny {}" } };
    const context = dependencySourceContext(sources);
    expect(context.view.format).toBe("complete-source-v1");
    expect(context.modelSources).toEqual(sources);
    sources["Tiny.sol"].content = "contract Replaced {}";
    expect(context.complete["Tiny.sol"].content).toContain("contract Tiny");
  });
  it.each(["launch-protection-v1", "base-launch-protection-v1", "hyperevm-launch-protection-v1"])("fits the complete %s code under the existing context bound", async name => {
    const { sources } = await kit(name), context = dependencySourceContext(sources);
    expect(Object.keys(context.modelSources)).toEqual(Object.keys(sources));
    expect(context.complete).toEqual(sources);
    expect(context.view.format).toBe("code-without-comments-v1");
    expect(JSON.stringify(context.modelSources).length).toBeLessThan(115_000);
    expect(JSON.stringify(sources).length).toBeGreaterThan(240_000);
    const altered = structuredClone(sources); altered[Object.keys(altered)[0]].content += "\n// changed";
    expect(dependencySourceContext(altered).view.originalSourceHash).not.toBe(context.view.originalSourceHash);
  });
  it("sends one compact dependency view while saving and compiling every original byte", async () => {
    const { sources } = await kit("launch-protection-v1");
    const hookPath = "src/launch-protection/ProtectedNative30HookV1.sol";
    const entrypoints = [{ source: hookPath, contract: "ProtectedNative30HookV1", role: "hook" as const }];
    const previous = createContractProject({ compiler, sources, entrypoints }, intent, 1);
    const dependencies = Object.fromEntries(Object.entries(sources).filter(([path]) => path !== hookPath));
    const call = vi.fn(async () => {
      // Mutating the caller's original map during inference must not change
      // the source that was represented by the model's bound context.
      dependencies["lib/v4-core/src/types/PoolKey.sol"].content = "contract Wrong {}";
      return { text: JSON.stringify({ reply: "The source is kept.", summary: "Source preparation", sourceFiles: [{ path: hookPath, content: sources[hookPath].content }],
        entrypoints, requirementIds: ["source"] }), inputTokens: 1, outputTokens: 1 };
    });
    const compile = vi.fn(async (project: ContractProject) => emptyBuild(project));
    const saveProject = vi.fn(async () => undefined);
    const result = await buildGeneralContract({ intent, chainId: 1, evmVersion: "cancun", previous, dependencySources: dependencies,
      messages: [{ role: "user", content: "Keep the complete protected source package." }], saveProject }, undefined, { call, compile });
    const modelInput = (call.mock.calls[0] as unknown as [{ system: string }])[0].system;
    expect(modelInput.length).toBeLessThan(160_000);
    expect(modelInput).toContain("code-without-comments-v1");
    expect(result.project.sources).toEqual(previous.sources);
    expect(result.project.hash).toBe(previous.hash);
    expect(call).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith(result.project, expect.any(AbortSignal));
    expect(saveProject).toHaveBeenCalledWith(result.project);
    expect(result.launchReady).toBe(false);
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("dependency compaction in the pinned real compiler", () => {
  it("preserves executable output with strings, comment boundaries and operators", async () => {
    const content = String.raw`// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
contract /* between tokens */ C {
  function url() public pure returns(string memory) { return "https://host/a//b/*literal*/"; }
  function calculate(uint256 x) public pure returns(uint256) { return x / /* divide */ 2 + x; }
}`;
    const make = (source: string) => createContractProject({ compiler, sources: { "C.sol": { content: source } },
      entrypoints: [{ source: "C.sol", contract: "C", role: "auxiliary" }] }, intent, 1);
    const original = await compileContractProject(make(content));
    const compact = await compileContractProject(make(compactDependencyCode(content)));
    expect(original.compiled).toBe(true); expect(compact.compiled).toBe(true);
    expect(compact.contracts[0].creationBytecode).toBe(original.contracts[0].creationBytecode);
    expect(compact.contracts[0].runtimeBytecode).toBe(original.contracts[0].runtimeBytecode);
    expect(compact.contracts[0].abi).toEqual(original.contracts[0].abi);
  }, 50_000);
});
