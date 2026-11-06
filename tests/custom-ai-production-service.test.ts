import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { runCustomAI, type AIContext } from "../lib/custom-ai/service.server";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { CustomAIError, type ChatRequest } from "../lib/custom-ai/types";
import { GENERAL_PROJECT_COMPILER, type ContractProject } from "../lib/custom-ai/contract-project";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { BuilderChainId } from "../lib/custom-ai/execution-routing";
import type { ClaudeInput } from "../lib/custom-ai/claude.server";

const instruction = "Build a counter anyone can increment with no owner.";
const request: ChatRequest = { id: "production-source-job-001", intent: "build", coin: EMPTY_COIN_SETUP, messages: [{ role: "user", content: instruction }] };
const requirements = [{ id: "counter", text: "Anyone can increment by one, starting at zero", kind: "behavior", instruction, open: null },
  { id: "no-owner", text: "No owner privileges", kind: "constraint", instruction, open: null }];
const declaration = { contracts: [{ id: "main", source: "Counter.sol", contract: "Counter", role: "auxiliary", arguments: [],
  functions: ["function count() view returns (uint256)", "function increment()"], allowReceive: false, allowFallback: false, surfaceRequirements: ["no-owner"] }], allowedCalls: [], steps: [
  { id: "zero", contract: "main", signature: "count()", arguments: [], from: "trader-a", afterSeconds: 0, value: "0", read: true, requirementIds: ["counter"], expect: { status: "success", returns: ["0"] } },
  { id: "increment", contract: "main", signature: "increment()", arguments: [], from: "trader-a", afterSeconds: 0, value: "0", read: false, requirementIds: [], expect: { status: "success" } },
  { id: "one", contract: "main", signature: "count()", arguments: [], from: "trader-b", afterSeconds: 0, value: "0", read: true, requirementIds: ["counter"], expect: { status: "success", returns: ["1"] } },
] };
const response = (value: unknown) => ({ text: JSON.stringify(value), inputTokens: 10, outputTokens: 10 });
const plan = (patch = {}) => response({ reply: "I will preserve the agreed counter.", executionRoute: "custom-contract", intentRequirements: requirements,
  action: "build", memory: "Counter without owner", requirements: requirements.map(rule => rule.text), feeChecks: [], setupPatch: {},
  lookups: [], program: null, eventRule: null, composable: null, ruleEdits: [], generalChecks: JSON.stringify(declaration), ...patch });
const generated = () => response({ reply: "The source is saved.", summary: "Counter without an owner", sourceFiles: [{ path: "Counter.sol", content: "pragma solidity 0.8.26; contract Counter { uint public count; function increment() external { count++; } }" }],
  entrypoints: [{ source: "Counter.sol", contract: "Counter", role: "auxiliary" }], requirementIds: requirements.map(rule => rule.id) });
const production = (chain: BuilderChainId) => projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain, protection);
const compile = async (project: ContractProject) => {
  const body = { version: 1 as const, projectHash: project.hash, compiled: false, compiler: GENERAL_PROJECT_COMPILER, diagnostics: [{ severity: "error" as const, message: "Fixture stops before scenario execution" }],
    contracts: [], verification: "not-run" as const, launchReady: false as const };
  return { ...body, artifactHash: canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) };
};
function context(): AIContext {
  return { loadProductionContext: async chain => production(chain), saveProject: async () => {}, saveBlueprint: async () => {}, saveCompilation: async () => {}, saveScenarios: async () => {} };
}

describe("production context in the existing owned generation handoff", () => {
  it.each([1, 4663, 8453, 999] as const)("binds chain %i before the separate independent declaration and source", async chain => {
    const expected = production(chain), events: string[] = [], saved: ContractProject[] = [];
    const load = vi.fn(async () => { events.push("discovery"); return expected; });
    const call = vi.fn(async (input: ClaudeInput) => {
      expect(input.system).toContain(expected.id);
      expect(input.system).toContain("recipient cap measures cumulative token inflows");
      expect(input.system).toContain("Selling or transferring tokens out does not restore");
      expect(expected.version).toBe(3); expect(expected.protectionPolicy?.required).toBe(true);
      if (call.mock.calls.length === 1) { events.push("planning"); expect(input.schema).not.toHaveProperty("properties.generalChecks"); return plan(); }
      if (call.mock.calls.length === 2) {
        events.push("declaration");
        expect(input.system).toContain("compact-v1");
        return response({generalChecks:JSON.stringify({format:"compact-v1",allowedCalls:declaration.allowedCalls,
          contracts:declaration.contracts.map(c=>[c.id,c.source,c.contract,c.role,c.arguments,c.functions,c.allowReceive,c.allowFallback,c.surfaceRequirements]),
          steps:declaration.steps.map(s=>[s.id,s.contract,s.signature,s.arguments,s.from,s.afterSeconds,s.value,s.read,s.requirementIds,s.expect])})});
      }
      events.push("generation"); expect(events).toContain("oracle-saved");
      // The complete profile appears once; fixedChecks carries only its ID.
      expect(input.system.split(expected.poolManager.runtimeCodeHash).length).toBeLessThanOrEqual(3);
      return generated();
    });
    const result = await runCustomAI({ ...request, coin: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain }) }, undefined,
      { call, compile: vi.fn(), compileProject: compile }, { ...context(), loadProductionContext: load,
        saveBlueprint: async blueprint => { expect(blueprint.production).toEqual(expected); events.push("oracle-saved"); },
        saveProject: async source => { saved.push(source); events.push("source-saved"); } });
    expect(events).toEqual(["discovery", "planning", "declaration", "oracle-saved", "generation", "source-saved"]);
    expect(saved[0].production).toEqual(expected); expect(saved[0].intent.requirements).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledTimes(3); expect(result.generalProject?.launchReady).toBe(false);
    expect(result.generalProject).not.toHaveProperty("production");
  });
  it("rejects a loader that returns another chain before inference", async () => {
    const call = vi.fn();
    await expect(runCustomAI(request, undefined, { call, compile: vi.fn() }, { ...context(), loadProductionContext: async () => production(999) })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("can still answer an ordinary question during a discovery outage", async () => {
    const call = vi.fn(async () => plan({ action: "answer", intentRequirements: [], requirements: [], generalChecks: null }));
    const result = await runCustomAI({ ...request, intent: "chat", messages: [{ role: "user", content: "Explain how hooks affect swaps in one sentence." }] }, undefined,
      { call, compile: vi.fn() }, { ...context(), loadProductionContext: async () => { throw new CustomAIError("launch-context", "unavailable", 503); } });
    expect(result.change).toBe("unchanged"); expect(call).toHaveBeenCalledTimes(1);
  });
  it("preserves the complete design and stops generation if current configuration is unavailable", async () => {
    const call = vi.fn(async () => plan()), save = vi.fn(), compiler = vi.fn();
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn(), compileProject: compiler },
      { ...context(), saveProject: save, loadProductionContext: async () => { throw new CustomAIError("launch-context", "unavailable", 503); } });
    expect(result.change).toBe("blocked"); expect(result.intent?.requirements).toHaveLength(2); expect(call).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled(); expect(compiler).not.toHaveBeenCalled();
  });
  it("does not discover chain state for a brief greeting", async () => {
    const load = vi.fn(), call = vi.fn(async () => response({ reply: "Hey." }));
    await runCustomAI({ ...request, intent: "chat", messages: [{ role: "user", content: "hi" }] }, undefined, { call, compile: vi.fn() }, { ...context(), loadProductionContext: load });
    expect(load).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(1);
  });
  it("keeps newly interpreted rules when discovery fails after a network change", async () => {
    const load = vi.fn(async (chain: BuilderChainId) => {
      if (chain === 999) throw new CustomAIError("launch-context", "unavailable", 503);
      return production(chain);
    }), call = vi.fn(async () => plan({ setupPatch: { chainId: 999 } })), compiler = vi.fn();
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn(), compileProject: compiler }, { ...context(), loadProductionContext: load });
    expect(result.change).toBe("blocked"); expect(result.intent?.requirements).toHaveLength(2);
    expect(result.setupPatch?.chainId).toBe(999); expect(call).toHaveBeenCalledTimes(2); expect(compiler).not.toHaveBeenCalled();
    expect(load.mock.calls.map(([chain])=>chain)).toEqual([1,999]);
  });
  it("declares fresh source-blind checks for a network changed in this turn", async () => {
    const load = vi.fn(async (chain: BuilderChainId) => production(chain)), saved: ContractProject[] = [];
    const call = vi.fn(async (input: ClaudeInput) => {
      if (call.mock.calls.length === 1) return plan({ setupPatch: { chainId: 999 } });
      expect(input.system).toContain(production(999).id);
      if (call.mock.calls.length === 2) { expect(input.task).toBe("planning"); return plan({setupPatch:{chainId:999}}); }
      if (call.mock.calls.length === 3) { expect(input.system).not.toContain("pragma solidity"); return response({ generalChecks: JSON.stringify(declaration) }); }
      return generated();
    });
    await runCustomAI(request, undefined, { call, compile: vi.fn(), compileProject: compile }, { ...context(), loadProductionContext: load,
      saveBlueprint: async blueprint => { expect(blueprint.chainId).toBe(999); expect(blueprint.production?.id).toBe(production(999).id); },
      saveProject: async project => { saved.push(project); } });
    expect(load.mock.calls.map(([chain]) => chain)).toEqual([1, 999]); expect(call).toHaveBeenCalledTimes(4);
    expect(saved[0].production?.chainId).toBe(999); expect(saved[0].chainId).toBe(999);
  });
});
