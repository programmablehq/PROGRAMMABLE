import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import fixture from "./fixtures/custom-ai/london-liquidity-v2.json";
import { normalizeRuleSpec } from "../lib/custom-ai/rule-spec";
import { parseRuleEdits, reviewRuleEdits, stablePlannedRuleIds } from "../lib/custom-ai/design-edits";
import { migrateLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import { parseChatRequest, type ChatRequest } from "../lib/custom-ai/types";
import { runCustomAI } from "../lib/custom-ai/service.server";

const previous = normalizeRuleSpec(fixture);
const hash = "a".repeat(64);
const instruction = "Change the opening fee to 8%. Keep the weather and liquidity rules.";
const edit = { requirementId: "decay", operation: "replace" as const, instruction };
const request: ChatRequest = { id: "edit-request-00001", intent: "chat", messages: [{ role: "user", content: instruction }] };
const intentData = (spec = previous, open: string[] = []) => [...spec.requirements.map(rule => ({ ...rule, kind: "behavior", instruction, open: null })),
  ...open.map((text, index) => ({ id: `choice-${index}`, text, kind: "decision", instruction, open: text }))];
const revised = () => {
  const next = structuredClone(previous);
  next.phases[0].fee = { ...next.phases[0].fee, fromBuyBps: 800, fromSellBps: 800 } as typeof next.phases[0]["fee"];
  next.requirements[0].text = "8% declines to 1% over ten minutes";
  return next;
};

describe("editing a complete hook design", () => {
  it("keeps identities across a single quoted replacement without accepting ambiguous aliases",()=>{
    const intent=migrateLaunchIntent({ruleSpec:previous})!;
    const quote="make that 12 hours";
    const added={id:"decay-12h",text:"New duration",kind:"behavior",open:null,instruction:quote};
    const plan={intentRequirements:[added,...intent.requirements.slice(1).map(r=>({...r,instruction:""}))],
      ruleEdits:[{requirementId:"decay",operation:"remove",instruction:quote},{requirementId:"decay-12h",operation:"replace",instruction:quote}],
      implementedRequirementIds:["decay-12h","weather","liquidity"],composable:JSON.stringify({requirements:[{id:"decay-12h",text:added.text}],phases:[{requirementIds:["decay-12h","weather"]}]}),
      productPlan:{components:[{requirementIds:["decay-12h"]}]} };
    const fixed=stablePlannedRuleIds(plan,intent,quote);
    expect((fixed.intentRequirements as Array<{id:string}>)[0].id).toBe("decay");
    expect(fixed.ruleEdits).toEqual([{requirementId:"decay",operation:"replace",instruction:quote}]);
    expect(JSON.parse(String(fixed.composable)).phases[0].requirementIds).toEqual(["decay","weather"]);
    expect(fixed.productPlan).toEqual({components:[{requirementIds:["decay"]}]});
    expect(plan.intentRequirements[0].id).toBe("decay-12h");
    expect(stablePlannedRuleIds(plan,intent,"keep everything")).toBe(plan);
    const ambiguous={...plan,intentRequirements:[...plan.intentRequirements,{...added,id:"other-new-rule"}]};
    expect(stablePlannedRuleIds(ambiguous,intent,quote)).toBe(ambiguous);
    const different={...plan,intentRequirements:plan.intentRequirements.map(r=>r.id===added.id?{...r,kind:"constraint"}:r)};
    expect(stablePlannedRuleIds(different,intent,quote)).toBe(different);
  });
  it("keeps untouched configurations, not merely their ids", () => {
    const next = revised();
    expect(reviewRuleEdits(previous, next, [])).toMatchObject({ complete: false, missing: [previous.requirements[0].text] });
    expect(reviewRuleEdits(previous, next, [edit]).complete).toBe(true);
    next.actions[0].maximumQuote = "100";
    expect(reviewRuleEdits(previous, next, [edit]).missing).toContain(previous.requirements[2].text);
  });
  it("blocks a recipient, fee allocation or timing change hidden behind an unrelated edit", () => {
    for (const mutate of [
      (next: typeof previous) => { next.actions[0].shareBps = 9000; next.creatorShareBps = 1000; },
      (next: typeof previous) => { next.actions[0].intervalSeconds = 86400; },
      (next: typeof previous) => { next.phases[1].startsAtSeconds = 1200; },
    ]) {
      const next = revised(); mutate(next);
      expect(reviewRuleEdits(previous, next, [edit]).complete).toBe(false);
    }
  });
  it("allows only timing in an explicitly edited shared phase and keeps its funding and rates fixed", () => {
    const shared=structuredClone(previous);
    shared.phases[0].requirementIds.push("weather");
    const timed=structuredClone(shared);
    timed.phases[0].endsAtSeconds=300;
    if(timed.phases[0].fee.kind!=="ramp")throw Error("Expected saved ramp");
    timed.phases[0].fee.durationSeconds=300;
    expect(reviewRuleEdits(shared,timed,[edit]).complete).toBe(true);
    for(const mutate of [
      (next:typeof timed)=>{if(next.phases[0].fee.kind==="ramp")next.phases[0].fee.fromBuyBps=800;},
      (next:typeof timed)=>{next.creatorShareBps=1000;},
      (next:typeof timed)=>{next.actions[0].recipient="0x1111111111111111111111111111111111111111";},
      (next:typeof timed)=>{next.phases[0].requirementIds=["decay"];},
    ]){
      const next=structuredClone(timed);mutate(next);
      expect(reviewRuleEdits(shared,next,[edit]).complete).toBe(false);
    }
  });
  it("allows an explicit removal while preserving the remaining behavior", () => {
    const next = structuredClone(previous);
    next.requirements = next.requirements.filter(rule => rule.id !== "liquidity");
    next.actions = []; next.creatorShareBps = 10000;
    expect(reviewRuleEdits(previous, normalizeRuleSpec(next), [{ requirementId: "liquidity", operation: "remove", instruction: "Remove liquidity." }]).complete).toBe(true);
    expect(reviewRuleEdits(previous, next, []).complete).toBe(false);
  });
  it("binds a targeted edit to the chosen rule", () => {
    expect(reviewRuleEdits(previous, revised(), [edit], { sourceHash: hash, requirementId: "weather" }).complete).toBe(false);
    expect(reviewRuleEdits(previous, revised(), [edit], { sourceHash: hash, requirementId: "decay" }).complete).toBe(true);
  });
  it("requires change evidence from the current user instruction", () => {
    expect(parseRuleEdits([edit], instruction)).toEqual([edit]);
    expect(() => parseRuleEdits([edit], "Explain how this works.")).toThrow();
    expect(() => parseRuleEdits([edit, edit], instruction)).toThrow();
  });
  it("rejects stale or invalid targets before invoking a model", async () => {
    const call = vi.fn(), compile = vi.fn();
    await expect(runCustomAI({ ...request, editTarget: { sourceHash: hash, requirementId: "decay" } }, undefined,
      { call, compile })).rejects.toMatchObject({ code: "edit", status: 409 });
    expect(call).not.toHaveBeenCalled();
    expect(() => parseChatRequest({ ...request, editTarget: { sourceHash: hash, requirementId: "decay" } })).toThrow();
  });
  it("keeps unresolved composed designs out of compilation", async () => {
    const compile = vi.fn();
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "Which execution limit should this use?", action: "build", memory: "Keep all three rules.",
      intentRequirements: intentData(previous, ["Execution limit"]), requirements: fixture.requirements.map(rule => rule.text), feeChecks: [], unresolved: ["Execution limit"], setupPatch: {}, composable: JSON.stringify(previous) }), inputTokens: 1, outputTokens: 1 }));
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result).toMatchObject({ change: "blocked", unresolved: ["Execution limit"], ruleSpec: previous });
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
  });
  it("cannot turn a saved complete design into a fee-only replacement", async () => {
    const compile = vi.fn();
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "Changed the fee.", action: "build", memory: "Keep all rules.",
      intentRequirements: intentData(), requirements: ["8% fees"], feeChecks: [true, false].map(buy => ({ afterSeconds: 0, buy, totalFeeBps: 800 })), unresolved: [], setupPatch: {} }), inputTokens: 1, outputTokens: 1 }));
    const result = await runCustomAI(request, undefined, { call, compile }, { ruleSpec: previous });
    expect(result).toMatchObject({ change: "blocked", ruleSpec: previous });
    expect(call).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
  });
  it("does not let an incomplete proposal replace the design used by the next turn", async () => {
    const partial = { ...previous, requirements: previous.requirements.slice(0, 2), actions: [], creatorShareBps: 10000 };
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "What limit should I use?", action: "build", memory: "Keep liquidity too.",
      intentRequirements: intentData(partial, ["Limit"]), requirements: partial.requirements.map(rule => rule.text), feeChecks: [], unresolved: ["Limit"], setupPatch: {}, composable: JSON.stringify(partial) }), inputTokens: 1, outputTokens: 1 }));
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn() }, { ruleSpec: previous });
    expect(result.ruleSpec).toEqual(previous);
  });
  it("does not treat an uncompiled proposed recipient as an approved recipient", async () => {
    const proposed = structuredClone(previous);
    proposed.actions[0] = { ...proposed.actions[0], kind: "distribution", when: null, maximumQuote: "0", recipient: `0x${"1".repeat(40)}` };
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "Use that recipient.", action: "build", memory: "Proposed recipient.",
      intentRequirements: intentData(proposed), requirements: proposed.requirements.map(rule => rule.text), feeChecks: [], unresolved: [], setupPatch: {}, composable: JSON.stringify(proposed) }), inputTokens: 1, outputTokens: 1 }));
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn() }, { ruleSpec: proposed });
    expect(result).toMatchObject({ change: "blocked", unresolved: ["Recipient address"] });
    expect(result.draft).toBeUndefined();
  });
  it("carries an unfinished design through ordinary follow-up questions", async () => {
    const call = vi.fn(async () => ({ text: JSON.stringify({ reply: "The timer controls the first phase.", action: "answer", memory: "Keep all rules.",
      requirements: [], feeChecks: [], unresolved: [], setupPatch: {} }), inputTokens: 1, outputTokens: 1 }));
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn() }, { ruleSpec: previous });
    expect(result.ruleSpec).toEqual(previous);
  });
});
