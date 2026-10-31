import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bindCandidateIntent, migrateLaunchIntent, parseIntentRequirements, reviseLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import { intentHasOpenParts, intentMatchesCandidate } from "../lib/custom-ai/launch-intent";
import { runCustomAI } from "../lib/custom-ai/service.server";
import type { ChatRequest, Draft } from "../lib/custom-ai/types";

const texts = ["Start at 10%", "Fall over ten minutes", "Then stay at 1%", "No transfer tax", "No later minting", "No creator liquidity withdrawal",
  "Use London rain", "Send fees to liquidity", "Buy back on a trigger", "Cap the initial wallet buy"];
const questions = ["Which weather feed?", "What execution limit?", "Which trigger?", "What wallet cap?"];
const proposed = texts.map((text, index) => ({ id: `rule-${index}`, text, kind: index >= 3 && index <= 5 ? "constraint" as const : "behavior" as const,
  instruction: text, open: index < 6 ? null : questions[index - 6] }));
const request: ChatRequest = { id: "intent-request-00001", intent: "chat", messages: [{ role: "user", content: `Build this: ${texts.join(". ")}` }] };
const initial = () => reviseLaunchIntent({ proposed, unresolved: questions, edits: [], request }).intent;
const response = (value: object) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });
const plan = (extra = {}) => response({ reply: "Four choices remain open.", action: "build", memory: "All ten rules are saved.",
  intentRequirements: proposed, requirements: texts.slice(0, 6), unresolved: questions, feeChecks: [true, false].map(buy => ({ afterSeconds: 0, buy, totalFeeBps: 1000 })), setupPatch: {}, ...extra });

describe("complete launch intent and source revisions", () => {
  it("preserves all ten requirements, four open parts and three negative constraints", () => {
    const intent = initial();
    expect(intent.requirements.map(rule => rule.text)).toEqual(texts);
    expect(intent.requirements.filter(rule => rule.open)).toHaveLength(4);
    expect(intent.requirements.filter(rule => rule.kind === "constraint")).toHaveLength(3);
    expect(intentHasOpenParts(intent)).toBe(true);
    expect(intent.requirements[0].origin).toEqual({ kind: "message", requestId: request.id, messageIndex: 0, quote: texts[0] });
  });
  it("does not compile the six-rule executable subset or spend another model call", async () => {
    const call = vi.fn(async () => plan()), compile = vi.fn();
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result.intent?.requirements).toHaveLength(10);
    expect(result.unresolved).toEqual([...questions, ...texts.slice(6)]);
    expect(result.change).toBe("blocked");
    expect(result.draft).toBeUndefined();
    expect(compile).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(1);
  });
  it("keeps the same complete intent through ordinary follow-up questions", async () => {
    const intent = initial(), compile = vi.fn();
    const result = await runCustomAI({ ...request, id: "intent-question-0001", messages: [{ role: "user", content: "Explain the timer." }] }, undefined,
      { call: async () => plan({ action: "answer", intentRequirements: [], requirements: [], unresolved: [], feeChecks: [] }), compile }, { intent });
    expect(result.intent).toEqual(intent); expect(result.intent?.revision).toBe(intent.revision);
    expect(compile).not.toHaveBeenCalled();
  });
  it("cannot shrink the next turn's authority by omitting its open rules", async () => {
    const intent = initial(), compile = vi.fn();
    const result = await runCustomAI(request, undefined, { call: async () => plan({ intentRequirements: proposed.slice(0, 6), unresolved: [] }), compile }, { intent });
    expect(result.intent?.requirements).toEqual(intent.requirements);
    expect(result.intent?.unresolved).toEqual(questions);
    expect(result.change).toBe("blocked"); expect(compile).not.toHaveBeenCalled();
  });
  it("requires an explicit current edit to change a negative constraint", () => {
    const previous = initial(), changed = proposed.map(rule => rule.id === "rule-4" ? { ...rule, text: "Allow later minting" } : rule);
    const result = reviseLaunchIntent({ previous, proposed: changed, unresolved: questions, edits: [], request });
    expect(result.problems).toContain("No later minting");
    expect(result.intent.requirements[4]).toEqual(previous.requirements[4]);
  });
  it("keeps stable ids and exact origin across a replacement with a parent revision", () => {
    const previous = initial(), instruction = "Change only the starting fee to 8%.";
    const next = reviseLaunchIntent({ previous, proposed: proposed.map(rule => rule.id === "rule-0" ? { ...rule, text: "Start at 8%" } : rule),
      unresolved: questions, edits: [{ requirementId: "rule-0", operation: "replace", instruction }],
      request: { ...request, id: "intent-revision-0001", messages: [{ role: "user", content: instruction }] } });
    expect(next.problems).toEqual([]); expect(next.intent.parentRevision).toBe(previous.revision);
    expect(next.intent.requirements[0].id).toBe(previous.requirements[0].id);
    expect(next.intent.requirements.slice(1)).toEqual(previous.requirements.slice(1));
    expect(next.intent.requirements[0].origin).toMatchObject({ requestId: "intent-revision-0001", quote: instruction });
  });
  it("rejects tool, assistant and stale-message evidence for a new rule", () => {
    for (const messages of [[{ role: "assistant" as const, content: texts[0] }, { role: "user" as const, content: "Explain it." }],
      [{ role: "user" as const, content: texts[0] }, { role: "user" as const, content: "Explain it." }]]) {
      expect(() => reviseLaunchIntent({ previous: initial(), proposed: [...proposed, { ...proposed[0], id: "extra" }], unresolved: questions, edits: [], request: { ...request, messages } })).toThrow();
    }
  });
  it("resolves one open choice only through an explicit replacement of its stable id", () => {
    const previous=initial(),instruction="Use the signed London rain feed for the weather rule.";
    const changed=proposed.map(rule=>rule.id==="rule-6"?{...rule,text:"Use the signed London rain feed",open:null}:rule);
    const nextRequest={...request,id:"intent-choice-0001",messages:[{role:"user" as const,content:instruction}]};
    const unauthorized=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),edits:[],request:nextRequest});
    expect(unauthorized.intent.unresolved).toContain(questions[0]);
    const accepted=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),
      edits:[{requirementId:"rule-6",operation:"replace",instruction}],request:nextRequest});
    expect(accepted.problems).toEqual([]);expect(accepted.intent.unresolved).toEqual(questions.slice(1));
    expect(accepted.intent.requirements[6]).toMatchObject({id:"rule-6",text:"Use the signed London rain feed",open:null});
  });
  it("keeps other requirements and rejects additions during a selected edit", () => {
    const previous=initial(),instruction="Change the opening fee to 8% and add this rule.";
    const next=reviseLaunchIntent({previous,proposed:[...proposed.map(rule=>rule.id==="rule-4"?{...rule,text:"Allow later minting"}:rule),
      {...proposed[0],id:"extra",instruction}],unresolved:questions,edits:[{requirementId:"rule-4",operation:"replace",instruction}],
      request:{...request,messages:[{role:"user",content:instruction}]},target:{sourceHash:"a".repeat(64),requirementId:"rule-0"}});
    expect(next.problems.length).toBeGreaterThan(0);expect(next.intent.requirements).toEqual(previous.requirements);
  });
  it("rejects missing, duplicate, oversized and unbounded requirement data", () => {
    for (const value of [undefined, [{ text: "No id", kind: "behavior", instruction: "x", open: null }], [proposed[0], proposed[0]],
      [{ ...proposed[0], text: "x".repeat(601) }], Array.from({ length: 65 }, (_, index) => ({ ...proposed[0], id: `r-${index}` }))]) {
      expect(() => parseIntentRequirements(value)).toThrow();
    }
  });
  it("migrates old source and open decisions without inventing user quotes", () => {
    const intent = migrateLaunchIntent({ requestId: request.id, draft: { sourceHash: "a".repeat(64), verification: { requirements: texts.slice(0, 2) } } as Draft, unresolved: ["Choose the recipient"] })!;
    expect(intent.requirements.map(rule => rule.text)).toEqual([...texts.slice(0, 2), "Choose the recipient"]);
    expect(intent.requirements.every(rule => rule.origin.kind === "legacy")).toBe(true);
    expect(intent.requirements[2].open).toBe("Choose the recipient");
    const repeated=migrateLaunchIntent({draft:{sourceHash:"a".repeat(64),verification:{requirements:["3% fees","3% fees"]}} as Draft})!;
    expect(repeated.requirements).toHaveLength(2);
    expect(new Set(repeated.requirements.map(rule=>rule.id)).size).toBe(2);
  });
  it("binds the complete intent and parent source revision without promoting launch status", () => {
    const intent = reviseLaunchIntent({ proposed: proposed.slice(0, 2), unresolved: [], edits: [], request }).intent;
    const draft = { source: "fixture", sourceHash: "a".repeat(64), compiled: true, diagnostics: [],
      verification: { status: "passed", sourceHash: "a".repeat(64), requirements: texts.slice(0, 2), checks: [], cases: 8 },
      validation: { status: "passed", artifactHash: "b".repeat(64) } } as Draft;
    const bound = bindCandidateIntent(intent, draft);
    expect(intentMatchesCandidate(intent, bound)).toBe(true);
    expect(intentMatchesCandidate(initial(), bound)).toBe(false);
    expect(intentMatchesCandidate(intent, { ...bound, sourceHash: "c".repeat(64) })).toBe(false);
    expect(intentMatchesCandidate(intent, { ...bound, validation: { ...bound.validation!, artifactHash: "c".repeat(64) } })).toBe(false);
    expect(bindCandidateIntent(intent, { ...draft, sourceHash: "c".repeat(64), verification: { ...draft.verification!, sourceHash: "c".repeat(64) } }, bound).revision?.parentRevision).toBe(bound.revision?.id);
    expect(() => bindCandidateIntent(initial(), draft)).toThrow();
    expect(() => bindCandidateIntent(intent, { ...draft, verification: { ...draft.verification!, requirements: texts.slice(0, 1) } })).toThrow();
    expect(bound.intent?.requirements.every(rule => !("status" in rule))).toBe(true);
  });
});
