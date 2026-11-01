import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/custom-ai/three-phase-planner.json";
import { runCustomAI } from "../lib/custom-ai/service.server";
import { migrateLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import type { ChatRequest, Draft, FeeExpectation } from "../lib/custom-ai/types";

const sourceHash = "a".repeat(64), instruction = "Change only the middle fee to 1.5%.";
const feeChecks = captured.feeChecks.map(({ afterSeconds, buy, totalFeeBps }) => ({ afterSeconds, buy, totalFeeBps }));
const compiled = async (source: string, _signal?: AbortSignal, checks: FeeExpectation[] = []): Promise<Draft> => ({
  source, sourceHash, compiled: true, diagnostics: [],
  validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "b".repeat(64),
    cases: checks.length * 4, samples: [], deployments: [], expectationCases: checks.length * 4 },
});
function fixture(legacy = false) {
  const draft: Draft = { source: "saved-module", sourceHash, compiled: true, diagnostics: [],
    validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "b".repeat(64), cases: 16, samples: [], deployments: [], expectationCases: 16 },
    verification: { status: "passed", sourceHash, requirements: ["Keep 4% until second 299.", "Use 2% from second 300 through 599.", "Keep 0.5% from second 600 onward."],
      checks: feeChecks, cases: 16 } };
  const intent = migrateLaunchIntent({ draft, requestId: "saved-fee-draft-01" })!;
  if (!legacy) {
    draft.intent = intent;
    draft.revision = { id: "b".repeat(64), intentRevision: intent.revision, sourceHash, artifactHash: "b".repeat(64),
      requirementIds: intent.requirements.map(rule => rule.id), executionRoute: "fee-module" };
  }
  const target = intent.requirements[1].id;
  const request: ChatRequest = { id: "focused-fee-edit-01", draftId: "saved-fee-draft-01", intent: "chat",
    editTarget: { sourceHash, requirementId: target }, messages: [{ role: "user", content: instruction }] };
  const plan = { ...captured, setupPatch: {}, requirements: undefined,
    intentRequirements: intent.requirements.map(rule => ({ id: rule.id, text: rule.id === target ? "Use 1.5% from second 300 through 599." : rule.text,
      kind: rule.kind, open: null, instruction: "" })),
    implementedRequirementIds: intent.requirements.map(rule => rule.id), ruleEdits: [{ requirementId: target, operation: "replace", instruction }],
    feeChecks: feeChecks.map(check => ({ ...check, totalFeeBps: check.afterSeconds >= 300 && check.afterSeconds < 600 ? 150 : check.totalFeeBps })) };
  return { draft, intent, target, request, plan };
}
const response = (value: unknown) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });

describe("focused fee-module edits", () => {
  it.each([false, true])("edits an exact checked fee draft and keeps the other saved rules (legacy=%s)", async legacy => {
    const { draft, intent, target, request, plan } = fixture(legacy);
    const call = vi.fn().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ reply: "Updated the middle phase.", source: "new-module" }));
    const compile = vi.fn(compiled);
    const result = await runCustomAI(request, undefined, { call, compile }, { draft });
    expect(result.change).toBe("applied"); expect(call).toHaveBeenCalledTimes(2); expect(compile).toHaveBeenCalledTimes(1);
    expect(result.intent?.requirements.filter(rule => rule.id !== target)).toEqual(intent.requirements.filter(rule => rule.id !== target));
    expect(result.draft?.verification?.checks).toEqual(plan.feeChecks);
    expect(result.draft?.revision?.parentRevision).toBe(draft.revision?.id);
  });
  it("rejects a stale source or unrelated intent before spending a model call", async () => {
    const { draft, request, intent } = fixture();
    const call = vi.fn();
    await expect(runCustomAI({ ...request, editTarget: { ...request.editTarget!, sourceHash: "c".repeat(64) } }, undefined,
      { call, compile: compiled }, { draft })).rejects.toMatchObject({ code: "edit", status: 409 });
    await expect(runCustomAI(request, undefined, { call, compile: compiled }, { draft, intent: { ...intent, revision: "c".repeat(64) } }))
      .rejects.toMatchObject({ code: "edit", status: 409 });
    expect(call).not.toHaveBeenCalled();
  });
  it("blocks an unrelated phase change in the same reply before source generation", async () => {
    const { draft, intent, request, plan } = fixture();
    plan.intentRequirements[0].text = "Change the opening fee to 9%.";
    const call = vi.fn(async () => response(plan)), compile = vi.fn(compiled);
    const result = await runCustomAI(request, undefined, { call, compile }, { draft });
    expect(result.change).toBe("blocked"); expect(result.intent?.requirements[0]).toEqual(intent.requirements[0]);
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
  });
});
