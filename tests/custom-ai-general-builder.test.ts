import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildGeneralContract } from "../lib/custom-ai/general-builder.server";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ContractProject } from "../lib/custom-ai/contract-project";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "general-builder-fixture", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "counter", text: "Keep a counter", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "no-admin", text: "No owner or administrator", kind: "constraint", open: null, origin: { kind: "legacy" } },
] };
const source = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; contract GeneralHook { uint public counter; function increment() external { counter++; } }";
const answer = () => ({ reply: "Der Entwurf zählt Aufrufe ohne Administrator.", summary: "counts calls without administrator permissions",
  sourceFiles: [{ path: "GeneralHook.sol", content: source }], entrypoints: [{ source: "GeneralHook.sol", contract: "GeneralHook", role: "hook" }],
  requirementIds: ["counter", "no-admin"] });
const response = (data = answer()) => ({ text: JSON.stringify(data), inputTokens: 1, outputTokens: 1 });
const request = () => ({ intent: structuredClone(intent), chainId: 999 as const, evmVersion: "paris" as const,
  messages: [{ role: "user" as const, content: "Build the counter without an owner." }], saveProject: vi.fn<(project: ContractProject)=>Promise<void>>(async () => undefined) });
const incompleteBuild = async (project: ContractProject): Promise<CompiledProject> => ({ version: 1, projectHash: project.hash, artifactHash: `sha256:${"b".repeat(64)}`,
  compiler: GENERAL_PROJECT_COMPILER, compiled: false, diagnostics: [{ severity: "error", message: "Fixture needs repair" }], contracts: [], verification: "not-run", launchReady: false });

describe("general project generation inside the owned AI job", () => {
  it("uses one model call and saves the entire source before compilation", async () => {
    const input = request(), events: string[] = [];
    input.saveProject.mockImplementation(async () => { events.push("saved"); });
    const call = vi.fn(async () => response()), compile = vi.fn(async (project: ContractProject) => { events.push("compiled"); return incompleteBuild(project); });
    const result = await buildGeneralContract(input, undefined, { call, compile });
    expect(events).toEqual(["saved", "compiled"]); expect(call).toHaveBeenCalledTimes(1); expect(compile).toHaveBeenCalledTimes(1);
    expect(result.project.intent).toEqual(intent); expect(result.project.chainId).toBe(999);
    expect(result.project.sources["GeneralHook.sol"].content).toBe(source);
    expect(result.compilation.compiled).toBe(false); expect(result.requirementCoverage).toBe("proposed"); expect(result.launchReady).toBe(false);
  });
  it("does not compile or repair a proposal missing the negative constraint", async () => {
    const data = answer(); data.requirementIds = ["counter"];
    const call = vi.fn(async () => response(data)), compile = vi.fn(incompleteBuild), input = request();
    await expect(buildGeneralContract(input, undefined, { call, compile })).rejects.toMatchObject({ code: "project-response" });
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled(); expect(input.saveProject).not.toHaveBeenCalled();
  });
  it("keeps fixed dependency source from being replaced by generated source", async () => {
    const input = { ...request(), dependencySources: { "GeneralHook.sol": { content: "pragma solidity 0.8.26; contract Trusted {}" } } };
    const compile = vi.fn(incompleteBuild);
    await expect(buildGeneralContract(input, undefined, { call: async () => response(), compile })).rejects.toMatchObject({ code: "project-source" });
    expect(compile).not.toHaveBeenCalled(); expect(input.saveProject).not.toHaveBeenCalled();
  });
  it("rejects invalid dependencies, compiler settings, choices or old-project scope before charging", async () => {
    const previous = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "paris" },
      sources: { "GeneralHook.sol": { content: source } }, entrypoints: answer().entrypoints }, intent, 1);
    for (const input of [{ ...request(), previous }, { ...request(), evmVersion: "unknown" as "paris" },
      { ...request(), dependencySources: { "../Host.sol": { content: source } } },
      { ...request(), intent: { ...intent, unresolved: ["Which owner?"] } }]) {
      const call = vi.fn(async () => response()), compile = vi.fn(incompleteBuild);
      await expect(buildGeneralContract(input, undefined, { call, compile })).rejects.toThrow();
      expect(call).not.toHaveBeenCalled(); expect(compile).not.toHaveBeenCalled();
    }
  });
  it("does not compile when the durable source save fails", async () => {
    const input = request(); input.saveProject.mockRejectedValueOnce(Error("storage offline"));
    const compile = vi.fn(incompleteBuild), call = vi.fn(async () => response());
    await expect(buildGeneralContract(input, undefined, { call, compile })).rejects.toThrow("storage offline");
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
  });
  it("retains the saved source when the compiler is temporarily unavailable", async () => {
    const input = request(), call = vi.fn(async () => response());
    const compile = vi.fn(async () => { throw Error("compiler unavailable"); });
    await expect(buildGeneralContract(input, undefined, { call, compile })).rejects.toThrow("compiler unavailable");
    expect(input.saveProject).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledTimes(1); expect(compile).toHaveBeenCalledTimes(1);
  });
  it("does not start inference for an already stopped job", async () => {
    const controller = new AbortController(); controller.abort();
    const call = vi.fn(async () => response()), compile = vi.fn(incompleteBuild);
    await expect(buildGeneralContract(request(), controller.signal, { call, compile })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled(); expect(compile).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("generated general source in the isolated real compiler", { timeout: 40_000 }, () => {
  it("preserves the full project through the generation/build boundary without granting launch authority", async () => {
    const call = vi.fn(async () => response()), input = request();
    const result = await buildGeneralContract(input, undefined, { call, compile: compileContractProject });
    expect(result.compilation.compiled).toBe(true); expect(result.compilation.contracts[0].abi.some(item => item.type === "function" && item.name === "increment")).toBe(true);
    expect(result.project.intent.requirements).toEqual(intent.requirements); expect(input.saveProject).toHaveBeenCalledWith(result.project);
    expect(result).toMatchObject({ requirementCoverage: "proposed", launchReady: false });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
