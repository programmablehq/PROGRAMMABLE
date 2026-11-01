import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../lib/custom-ai/rule-compiler.server", () => ({ compileRuleSpec: vi.fn(async () => { throw Error("isolated-fixture-stop"); }) }));
import captured from "./fixtures/custom-ai/three-phase-planner.json";
import discovery from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { runCustomAI, type AIContext } from "../lib/custom-ai/service.server";
import { bindIntentImplementation } from "../lib/custom-ai/intent-coverage.server";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { ChatRequest, Draft, FeeExpectation } from "../lib/custom-ai/types";
import { compileRuleSpec } from "../lib/custom-ai/rule-compiler.server";

const prompt = "Create a checked draft named Rule Check (RULE) on Ethereum, paired with ETH, with a 0.01 ETH initial buy. Total fees on both buys and sells must be exactly 4% from launch through second 299, exactly 2% from second 300 through second 599, and exactly 0.5% from second 600 onward. Each total includes the platform fee. No oracle, rewards, transfer tax, buybacks, liquidity program or extra owner powers. Keep all three phases. Build and check the draft only; do not launch it.";
const request: ChatRequest = { id: "canonical-requirement-test-01", intent: "chat", coin: EMPTY_COIN_SETUP, messages: [{ role: "user", content: prompt }] };
const response = (value: unknown) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });
function plan() {
  const { requirements: ignored, ...body } = structuredClone(captured); void ignored;
  return { ...body, implementedRequirementIds: body.intentRequirements.map(rule => rule.id) };
}
const context = (): AIContext => ({
  loadProductionContext: async () => projectLaunchProductionContext(discovery.chains["1"], 1, protection),
  saveProject: vi.fn(async () => {}), saveBlueprint: vi.fn(async () => {}), saveCompilation: vi.fn(async () => {}), saveScenarios: vi.fn(async () => {}),
});
const compile = vi.fn(async (source: string, _signal?: AbortSignal, checks?: FeeExpectation[]): Promise<Draft> => ({
  source, sourceHash: "a".repeat(64), compiled: true, diagnostics: [],
  validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "b".repeat(64),
    cases: (checks?.length ?? 0) * 4, samples: [], deployments: [], expectationCases: (checks?.length ?? 0) * 4 },
}));
describe("canonical implementation requirement identities", () => {
  it("builds the captured three-phase fee intent without treating paraphrases as missing capabilities", async () => {
    compile.mockClear(); const saved = context();
    const call = vi.fn().mockResolvedValueOnce(response(plan())).mockResolvedValueOnce(response({
      reply: "The three fee phases are checked.", source: "contract GeneratedFeeModule {}", hookSummary: "Three fee phases", setupPatch: {},
    }));
    const result = await runCustomAI(request, undefined, { call, compile }, saved);
    expect(result.change).toBe("applied"); expect(compile).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledTimes(2);
    expect(saved.saveProject).not.toHaveBeenCalled(); expect(saved.saveBlueprint).not.toHaveBeenCalled();
    expect(result.draft?.verification?.requirements).toEqual(captured.intentRequirements.map(rule => rule.text));
    expect(result.draft?.intent?.requirements.map(rule => rule.id)).toEqual(captured.intentRequirements.map(rule => rule.id));
    expect(result.draft?.verification?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ afterSeconds: 299, totalFeeBps: 400 }),
      expect.objectContaining({ afterSeconds: 300, totalFeeBps: 200 }),
      expect.objectContaining({ afterSeconds: 599, totalFeeBps: 200 }),
      expect.objectContaining({ afterSeconds: 600, totalFeeBps: 50 }),
    ]));
  });
  it("keeps a missing negative constraint unimplemented instead of approving an executable subset", async () => {
    compile.mockClear(); const body = plan(); body.implementedRequirementIds = body.implementedRequirementIds.filter(id => id !== "no-transfer-tax");
    const call = vi.fn(async () => response(body));
    const result = await runCustomAI(request, undefined, { call, compile }, context());
    expect(result.change).toBe("blocked"); expect(result.selection?.missingCapabilities).toContain("No transfer tax.");
    expect(result.intent?.requirements.some(rule => rule.id === "no-transfer-tax")).toBe(true);
    expect(compile).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(2);
  });
  it("does not reinterpret old ambiguous planner envelopes as complete coverage", async () => {
    compile.mockClear();
    const result = await runCustomAI(request, undefined, { call: async () => response(captured), compile }, context());
    expect(result.change).toBe("blocked"); expect(compile).not.toHaveBeenCalled();
  });
  it("keeps the same canonical wording in composed rules without changing their executable phases", async () => {
    vi.mocked(compileRuleSpec).mockClear();
    const body = plan(), selected = body.intentRequirements.filter(rule => rule.id.startsWith("fee-") && rule.kind === "behavior");
    const spec = { version: 2, requirements: selected.map(rule => ({ id: rule.id, text: `Paraphrase of ${rule.text}` })),
      phases: [0, 300, 600].map((start, i) => ({ id: `phase-${i}`, startsAtSeconds: start, endsAtSeconds: [300, 600, null][i],
        fee: { kind: "fixed", buyBps: [400, 200, 50][i], sellBps: [400, 200, 50][i] }, requirementIds: [selected[i].id] })), creatorShareBps: 10000, actions: [] };
    const value = { ...body, executionRoute: "composed-module", intentRequirements: selected, implementedRequirementIds: selected.map(rule => rule.id),
      composable: JSON.stringify(spec), feeChecks: [] };
    const result = await runCustomAI(request, undefined, { call: async () => response(value), compile }, context());
    expect(compileRuleSpec).toHaveBeenCalledTimes(1);
    expect(result.ruleSpec?.requirements).toEqual(selected.map(rule => ({ id: rule.id, text: rule.text })));
    expect(result.ruleSpec?.phases).toEqual(spec.phases);
  });
  it.each([{ ids: ["missing"] }, { ids: ["no-oracle", "no-oracle"] }])("rejects unknown or duplicate coverage IDs: %j", ({ ids }) => {
    expect(() => bindIntentImplementation(captured.intentRequirements, ids)).toThrow(/matched to your saved rules/);
  });
  it("rejects a conflicting second wording list before another model call", async () => {
    compile.mockClear(); const call = vi.fn(async () => response({ ...plan(), requirements: ["A different rule"] }));
    await expect(runCustomAI(request, undefined, { call, compile }, context())).rejects.toMatchObject({ code: "plan" });
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
  });
});
