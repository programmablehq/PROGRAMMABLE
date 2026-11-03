import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContractProject, GENERAL_PROJECT_COMPILER, projectCompilerInput } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "project-fixture", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "balance", text: "Keep a mutable balance", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "owner", text: "Only the declared owner may change it", kind: "constraint", open: null, origin: { kind: "legacy" } },
] };
const source = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
contract GeneralHook {
  address public immutable owner;
  uint256 public balance;
  constructor(address owner_) { owner = owner_; }
  function setBalance(uint256 value) external { require(msg.sender == owner); balance = value; }
}`;
const input = () => ({ compiler: { version: GENERAL_PROJECT_COMPILER, evmVersion: "paris", optimizerRuns: 1000, viaIR: false },
  sources: { "GeneralHook.sol": { content: source } } as Record<string, { content: string }>, entrypoints: [{ source: "GeneralHook.sol", contract: "GeneralHook", role: "hook" }] });

describe("bound Custom AI contract projects", () => {
  it("retains every requirement, binds the chain and isolates the saved snapshot", () => {
    const original = structuredClone(intent), project = createContractProject(input(), original, 999);
    expect(project.intent.requirements).toEqual(intent.requirements); expect(project.chainId).toBe(999);
    original.requirements[1].text = "Anyone may change it";
    expect(project.intent.requirements[1].text).toBe(intent.requirements[1].text);
    expect(createContractProject(input(), intent, 8453).hash).not.toBe(project.hash);
  });
  it("produces the same Standard JSON after JSONB object key reordering", () => {
    const original = input(), reversed = { ...original, compiler: Object.fromEntries(Object.entries(original.compiler).reverse()) };
    const first = createContractProject(original, intent, 1), second = createContractProject(reversed, intent, 1);
    expect(first.hash).toBe(second.hash); expect(projectCompilerInput(first)).toEqual(projectCompilerInput(second));
  });
  it("accepts a protocol dependency closure beyond 48 files without relaxing byte limits", () => {
    const value=input();
    for(let i=0;i<127;i++)value.sources[`lib/Dependency${i}.sol`]={content:`pragma solidity 0.8.26; interface Dependency${i} {}`};
    const project=createContractProject(value,intent,8453);
    expect(Object.keys(projectCompilerInput(project).sources)).toHaveLength(128);
    value.sources["lib/Overflow.sol"]={content:"pragma solidity 0.8.26; interface Overflow {}"};
    expect(()=>createContractProject(value,intent,8453)).toThrow();
    const oversized=input();
    for(let i=0;i<5;i++)oversized.sources[`lib/Large${i}.sol`]={content:"x".repeat(80_000)};
    expect(()=>createContractProject(oversized,intent,8453)).toThrow();
  });
  it("rejects a changed source, chain or intent after hashing", () => {
    for (const change of [(p: ReturnType<typeof createContractProject>) => { p.sources["GeneralHook.sol"].content += "\n// changed"; },
      (p: ReturnType<typeof createContractProject>) => { p.chainId = 999; },
      (p: ReturnType<typeof createContractProject>) => { p.intent.requirements[1].text = "Anyone may change it"; }]) {
      const project = createContractProject(input(), intent, 1); change(project);
      expect(() => projectCompilerInput(project)).toThrow("changed");
    }
  });
  it.each(["../Hidden.sol", "/tmp/Hidden.sol", "https://example.org/Hook.sol", "a/../Hidden.sol", "a//Hidden.sol", "a\\Hidden.sol"])("rejects unsafe source identity %s", path => {
    const value = input(); value.sources = { [path]: { content: source } };
    expect(() => createContractProject(value, intent, 1)).toThrow();
  });
  it("rejects remote sources, commands, unpinned compilers and new host options", () => {
    for (const value of [{ ...input(), command: "curl example.org" }, { ...input(), sources: { "GeneralHook.sol": { urls: ["https://example.org/Hook.sol"] } } },
      { ...input(), compiler: { ...input().compiler, version: "latest" } }, { ...input(), compiler: { ...input().compiler, allowPaths: "/" } },
      { ...input(), sources: { "GeneralHook.sol": { content: "x".repeat(96_001) } } }]) expect(() => createContractProject(value, intent, 1)).toThrow();
  });
  it("keeps unresolved choices out of an executable project", () => {
    expect(() => createContractProject(input(), { ...intent, unresolved: ["Which owner?"] }, 1)).toThrow();
    expect(() => createContractProject(input(), { ...intent, requirements: intent.requirements.map(rule => ({ ...rule, open: "Which owner?" })) }, 1)).toThrow();
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("isolated general contract compilation", { timeout: 80_000 }, () => {
  it("keeps Cancun transient-storage source distinct from an incompatible Paris build", async () => {
    const value=input();value.sources["GeneralHook.sol"].content="pragma solidity 0.8.26; contract GeneralHook { function write() external { assembly { tstore(0, 1) } } }";
    const paris=await compileContractProject(createContractProject(value,intent,1));
    expect(paris.compiled).toBe(false);expect(paris.contracts).toEqual([]);
    const cancun=await compileContractProject(createContractProject({...value,compiler:{...value.compiler,evmVersion:"cancun"}},intent,1));
    expect(cancun.compiled).toBe(true);expect(cancun.verification).toBe("not-run");expect(cancun.launchReady).toBe(false);
  });
  it("builds reproducibly while keeping behavior verification and launch unavailable", async () => {
    const project = createContractProject(input(), intent, 999);
    const first = await compileContractProject(project), second = await compileContractProject(project);
    expect(first.compiled).toBe(true); expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.contracts[0].abi.some(item => item.type === "function" && item.name === "setBalance")).toBe(true);
    expect(first.contracts[0].creationBytecode).toMatch(/^0x[0-9a-f]+$/);
    const metadata = JSON.parse(first.contracts[0].compilerMetadata!);
    expect(metadata.compiler.version).toBe(GENERAL_PROJECT_COMPILER);
    expect(metadata.settings.compilationTarget).toEqual({ "GeneralHook.sol": "GeneralHook" });
    expect(metadata.settings.metadata).toEqual({ bytecodeHash: "none", appendCBOR: false });
    expect(first).toMatchObject({ projectHash: project.hash, verification: "not-run", launchReady: false });
  });
  it("cannot read an unsupplied host import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "custom-ai-general-sentinel-"));
    try {
      const file = join(directory, "Hidden.sol");
      await writeFile(file, "pragma solidity 0.8.26; contract Hidden { uint public constant PRIVATE_SENTINEL_NEVER_READ = 1; }");
      const value = input(); value.sources["GeneralHook.sol"].content = `pragma solidity 0.8.26; import "${file}"; contract GeneralHook is Hidden {}`;
      const result = await compileContractProject(createContractProject(value, intent, 1));
      expect(result.compiled).toBe(false); expect(result.contracts).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL_NEVER_READ");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("builds an inline dependency and rejects a missing entrypoint", async () => {
    const value = input(); value.sources = { "GeneralHook.sol": { content: 'pragma solidity 0.8.26; import "dep/Base.sol"; contract GeneralHook is Base {}' },
      "dep/Base.sol": { content: "pragma solidity 0.8.26; contract Base { uint public constant value = 7; }" } };
    const result = await compileContractProject(createContractProject(value, intent, 8453));
    expect(result.compiled).toBe(true);
    value.entrypoints[0].contract = "Missing";
    const missing = await compileContractProject(createContractProject(value, intent, 8453));
    expect(missing.compiled).toBe(false); expect(missing.contracts).toEqual([]);
  });
  it("does not return deployable artifacts with unresolved library addresses", async () => {
    const value = input();
    value.sources["GeneralHook.sol"].content = `pragma solidity 0.8.26;
      library ExternalLibrary { function result(uint x) public pure returns(uint) { return x * 7; } }
      contract GeneralHook { function read(uint x) external pure returns(uint) { return ExternalLibrary.result(x); } }`;
    const result = await compileContractProject(createContractProject(value, intent, 4663));
    expect(result.compiled).toBe(false); expect(result.contracts).toEqual([]);
    expect(result.diagnostics.some(item => item.message.includes("explicitly linked libraries"))).toBe(true);
  });
});
