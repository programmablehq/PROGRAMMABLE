import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canonicalGeneralLibraries } from "../lib/custom-ai/canonical-dependencies.server";
import { resolveInlineLibraries } from "../lib/custom-ai/inline-libraries";
import { createProjectCompiler } from "../lib/custom-ai/compiler-profile";
import { createContractProject, type ContractProject } from "../lib/custom-ai/contract-project";
import { buildGeneralContract } from "../lib/custom-ai/general-builder.server";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const compiler = createProjectCompiler("viair-200-v1", "cancun");
const intent: LaunchIntent = { version: 1, id: "library-source-test", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "source", text: "Keep the other source files unchanged.", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const root = "pragma solidity 0.8.26; contract C { function value() external pure returns(uint) { return 1; } }";
const make = (sources: ContractProject["sources"]) => createContractProject({ compiler, sources, entrypoints: [{ source: "C.sol", contract: "C", role: "auxiliary" }] }, intent, 1);
const emptyBuild = async (project: ContractProject): Promise<CompiledProject> => ({ version: 1, projectHash: project.hash,
  artifactHash: `sha256:${"b".repeat(64)}`, compiler: compiler.version, compiled: false, diagnostics: [], contracts: [], verification: "not-run", launchReady: false });
const input = () => ({ intent, chainId: 1 as const, evmVersion: "cancun" as const, messages: [{ role: "user" as const, content: "Only update C.sol." }], saveProject: vi.fn(async () => undefined) });
const answer = (content = root) => ({ text: JSON.stringify({ reply: "The source is saved.", summary: "Source change",
  sourceFiles: [{ path: "C.sol", content }], entrypoints: [{ source: "C.sol", contract: "C", role: "auxiliary" }], requirementIds: ["source"] }), inputTokens: 1, outputTokens: 1 });

describe("source retention and inline library resolution", () => {
  it("retains an omitted old helper exactly, including its comments", async () => {
    const helper = "// Keep this note.\npragma solidity 0.8.26; library Helper { function value() internal pure returns(uint) { return 7; } }";
    const previous = make({ "C.sol": { content: root }, "Helper.sol": { content: helper } });
    const result = await buildGeneralContract({ ...input(), previous }, undefined, { call: async () => answer(), compile: emptyBuild });
    expect(result.project.sources["Helper.sol"].content).toBe(helper);
    expect(result.project.hash).toBe(previous.hash);
  });
  it("snapshots old editable source before a model call can change caller data", async () => {
    const previous = make({ "C.sol": { content: root }, "Helper.sol": { content: "pragma solidity 0.8.26; library Helper {}" } });
    const original = previous.sources["Helper.sol"].content;
    const result = await buildGeneralContract({ ...input(), previous }, undefined, {
      call: async () => { previous.sources["Helper.sol"].content = "contract Changed {}"; return answer(); }, compile: emptyBuild,
    });
    expect(result.project.sources["Helper.sol"].content).toBe(original);
  });
  it("rejects a silent fixed-dependency upgrade before inference", async () => {
    const previous = make({ "C.sol": { content: root }, "Lib.sol": { content: "library Lib {}" } });
    const call = vi.fn(async () => answer());
    await expect(buildGeneralContract({ ...input(), previous, dependencySources: { "Lib.sol": { content: "library Lib { uint constant X=1; }" } } },
      undefined, { call, compile: emptyBuild })).rejects.toMatchObject({ code: "project-dependency" });
    expect(call).not.toHaveBeenCalled();
  });
  it("resolves relative and aliased transitive imports, including cycles, without pulling unused libraries", () => {
    const sources = { "src/C.sol": { content: 'import {A} from "../lib/A.sol"; string constant example="import \\\"Unused.sol\\\";"; // import "No.sol";\ncontract C {}' } };
    const libraries = { "lib/A.sol": { content: 'import "./B.sol"; library A {}' }, "lib/B.sol": { content: 'import "./A.sol"; library B {}' }, "Unused.sol": { content: "library Unused {}" } };
    const result = resolveInlineLibraries(sources, libraries, compiler);
    expect(Object.keys(result).sort()).toEqual(["src/C.sol", "lib/A.sol", "lib/B.sol"].sort());
    const canonical = canonicalGeneralLibraries();
    const aliased = resolveInlineLibraries({ "C.sol": { content: 'import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract C {}' } }, canonical, compiler);
    expect(aliased["lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol"]).toEqual(canonical["lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol"]);
    expect(Object.keys(aliased).length).toBeLessThan(Object.keys(canonical).length);
  });
  it("does not read external URLs, path traversal or absent files", () => {
    const sources = { "C.sol": { content: 'import "https://untrusted.invalid/F.sol"; import "../../Outside.sol"; contract C {}' } };
    expect(resolveInlineLibraries(sources, { "Outside.sol": { content: "library Outside {}" } }, compiler)).toEqual(sources);
  });
  it("uses identical shared libraries for every canonical chain package and never replaces an edited copy", async () => {
    const libraries = canonicalGeneralLibraries();
    expect(Object.keys(libraries)).toHaveLength(36);
    for (const name of ["base-launch-protection-v1", "hyperevm-launch-protection-v1"]) {
      const kit = JSON.parse(await readFile(new URL(`../packages/launch/contracts/${name}/standard-json.json`, import.meta.url), "utf8"));
      for (const [path, source] of Object.entries(libraries)) expect(kit.sources[path]).toEqual(source);
    }
    const path = Object.keys(libraries)[0], previous = make({ "C.sol": { content: root }, [path]: { content: "library Edited {}" } });
    expect(canonicalGeneralLibraries(previous)[path]).toBeUndefined();
    const a = canonicalGeneralLibraries(); a[path].content = "changed by caller";
    expect(canonicalGeneralLibraries()[path].content).toBe(libraries[path].content);
  });
  it("does not copy any optional library when the generated source imports none", async () => {
    const result = await buildGeneralContract({ ...input(), availableDependencySources: canonicalGeneralLibraries() }, undefined,
      { call: async () => answer(), compile: emptyBuild });
    expect(Object.keys(result.project.sources)).toEqual(["C.sol"]);
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("canonical library use in the real pinned compiler", () => {
  it("builds a generated token from the exact inline ERC20 closure in one generation", async () => {
    const content = 'pragma solidity 0.8.26; import {ERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol"; contract C is ERC20 { constructor() ERC20("Example", "EX") {} }';
    const call = vi.fn(async () => answer(content));
    const result = await buildGeneralContract({ ...input(), availableDependencySources: canonicalGeneralLibraries() }, undefined, { call, compile: compileContractProject });
    expect(result.compilation.compiled).toBe(true);
    expect(result.compilation.contracts[0].abi.some(item => item.type === "function" && item.name === "transfer")).toBe(true);
    expect(Object.keys(result.project.sources).length).toBeGreaterThan(1);
    expect(Object.keys(result.project.sources).length).toBeLessThan(12);
    expect(result.launchReady).toBe(false); expect(call).toHaveBeenCalledTimes(1);
  }, 50_000);
  it("builds a v4 hook with the selected alias profile and its real transitive sources", async () => {
    const content = 'pragma solidity 0.8.26; import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol"; import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol"; import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol"; contract C is BaseHook { constructor(IPoolManager manager) BaseHook(manager) {} function getHookPermissions() public pure override returns (Hooks.Permissions memory p) { p.beforeSwap = true; } }';
    const result = await buildGeneralContract({ ...input(), previous: make({ "C.sol": { content: root } }), availableDependencySources: canonicalGeneralLibraries() }, undefined,
      { call: async () => answer(content), compile: compileContractProject });
    expect(result.compilation.compiled).toBe(true);
    expect(result.project.compiler).toEqual(compiler);
    expect(result.project.sources["lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol"]).toBeDefined();
    expect(result.compilation.contracts[0].abi.some(item => item.type === "function" && item.name === "getHookPermissions")).toBe(true);
    expect(result.launchReady).toBe(false);
  }, 50_000);
});
