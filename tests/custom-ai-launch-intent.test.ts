import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bindCandidateIntent, migrateLaunchIntent, normalizeLaunchIntentQuestions, parseIntentRequirements, reviseLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import { intentHasOpenParts, intentMatchesCandidate, type LaunchIntent } from "../lib/custom-ai/launch-intent";
import { runCustomAI } from "../lib/custom-ai/service.server";
import type { ChatRequest, Draft } from "../lib/custom-ai/types";
import recording from "./fixtures/custom-ai/surplus-intent-v1.json";
import { prepareSurplusSchema } from "../lib/custom-ai/surplus-schema.server";

const texts = ["Start at 10%", "Fall over ten minutes", "Then stay at 1%", "No transfer tax", "No later minting", "No creator liquidity withdrawal",
  "Use London rain", "Send fees to liquidity", "Buy back on a trigger", "Cap the initial wallet buy"];
const questions = ["Which weather feed?", "What execution limit?", "Which trigger?", "What wallet cap?"];
const proposed = texts.map((text, index) => ({ id: `rule-${index}`, text, kind: index >= 3 && index <= 5 ? "constraint" as const : "behavior" as const,
  instruction: text, open: index < 6 ? null : questions[index - 6] }));
const request: ChatRequest = { id: "intent-request-00001", intent: "chat", messages: [{ role: "user", content: `Build this: ${texts.join(". ")}` }] };
const initial = () => reviseLaunchIntent({ proposed, unresolved: questions, edits: [], request }).intent;
const response = (value: object) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });
const checkedDraft = (requirements = texts.slice(0, 2)): Draft => ({ source: "fixture", sourceHash: "a".repeat(64), compiled: true, diagnostics: [],
  verification: { status: "passed", sourceHash: "a".repeat(64), requirements, checks: [], cases: 8 },
  validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "b".repeat(64), cases: 8, samples: [], deployments: [], expectationCases: 8 } });
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
    const call = vi.fn(async () => plan({reply:"The question is closed and the build has started."})), compile = vi.fn();
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result.intent?.requirements).toHaveLength(10);
    expect(result.unresolved).toEqual([...questions, ...texts.slice(6)]);
    expect(result.change).toBe("blocked");
    expect(result.reply).toBe(questions[0]);
    expect(result.reply).not.toContain("build has started");
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
  it("keeps revision hashes stable when JSONB reorders stored object keys", () => {
    const previous=initial(),instruction="Change the starting fee to 8%.";
    const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"
      ?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
    const restored=reorder(previous) as LaunchIntent;
    expect(JSON.stringify(restored)).not.toBe(JSON.stringify(previous));
    const input={proposed:proposed.map(rule=>rule.id==="rule-0"?{...rule,text:"Start at 8%"}:rule),unresolved:questions,
      edits:[{requirementId:"rule-0",operation:"replace" as const,instruction}],request:{...request,messages:[{role:"user" as const,content:instruction}]}};
    expect(reviseLaunchIntent({...input,previous:restored}).intent.revision).toBe(reviseLaunchIntent({...input,previous}).intent.revision);
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
  it("resolves an answered question from its latest-user quote without a duplicate edit envelope",()=>{
    const previous=initial(),instruction="Use the signed London rain feed for this question.";
    const changed=proposed.map(rule=>rule.id==="rule-6"?{...rule,open:null,instruction}:rule);
    const nextRequest={...request,id:"intent-answer-0001",messages:[{role:"user" as const,content:instruction}]};
    const result=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),edits:[],request:nextRequest});
    expect(result.problems).toEqual([]);expect(result.intent.unresolved).toEqual(questions.slice(1));
    expect(result.intent.requirements[6]).toMatchObject({id:"rule-6",text:previous.requirements[6].text,open:null,origin:{kind:"message",quote:instruction}});
    expect(result.intent.changes).toHaveLength(1);expect(result.intent.requirements.slice(0,6)).toEqual(previous.requirements.slice(0,6));
    const scoped=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),edits:[],request:nextRequest,
      target:{sourceHash:"a".repeat(64),requirementId:"rule-0"}});
    expect(scoped.intent.unresolved).toContain(questions[0]);
    const unquoted=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),edits:[],
      request:{...nextRequest,messages:[{role:"assistant",content:instruction},{role:"user",content:"okay"}]}});
    expect(unquoted.intent.unresolved).toContain(questions[0]);
  });
  it("gives legacy unowned questions stable identities so a quoted answer can resolve them",()=>{
    const saved=initial(),legacy={...saved,requirements:saved.requirements.slice(0,6)};
    const normalized=normalizeLaunchIntentQuestions(legacy);
    expect(normalized.requirements.slice(0,6)).toEqual(legacy.requirements);
    expect(normalized.requirements).toHaveLength(10);expect(normalizeLaunchIntentQuestions(normalized)).toEqual(normalized);
    const question=normalized.requirements.find(rule=>rule.open===questions[0])!;
    const instruction="Use the signed London rain feed.";
    const next=normalized.requirements.map(rule=>({...rule,instruction:rule.id===question.id?instruction:"",
      ...(rule.id===question.id?{text:"Use the signed London rain feed",open:null}:{})}));
    const result=reviseLaunchIntent({previous:normalized,proposed:next,unresolved:questions.slice(1),edits:[],
      request:{...request,messages:[{role:"user",content:instruction}]}});
    expect(result.problems).toEqual([]);expect(result.intent.unresolved).toEqual(questions.slice(1));
    expect(result.intent.requirements.find(rule=>rule.id===question.id)?.text).toBe("Use the signed London rain feed");
  });
  it("retains a quoted partial answer while keeping the remaining choice open",()=>{
    const previous=initial(),instruction="Use my creator wallet for the remaining share.";
    const changed=proposed.map(rule=>rule.id==="rule-6"?{...rule,text:"Use the creator wallet; snapshot timing remains open",open:"Choose snapshot timing",instruction}:rule);
    const result=reviseLaunchIntent({previous,proposed:changed,unresolved:["Choose snapshot timing",...questions.slice(1)],edits:[],request:{...request,messages:[{role:"user",content:instruction}]}});
    expect(result.problems).toEqual([]);expect(result.intent.requirements[6]).toMatchObject({text:"Use the creator wallet; snapshot timing remains open",open:"Choose snapshot timing"});
    expect(result.intent.unresolved).toEqual(["Choose snapshot timing",...questions.slice(1)]);
    expect(result.intent.requirements.slice(0,6)).toEqual(previous.requirements.slice(0,6));
  });
  it("keeps the server-owned kind when a confirmed decision is phrased as behavior",()=>{
    const source=initial(),previous={...source,requirements:source.requirements.map((rule,i)=>i===6?{...rule,kind:"decision" as const}:rule)};
    const instruction="Use my creator wallet.",changed=proposed.map(rule=>rule.id==="rule-6"?{...rule,kind:"behavior" as const,text:"The remaining share goes to the creator wallet",open:null,instruction}:rule);
    const result=reviseLaunchIntent({previous,proposed:changed,unresolved:questions.slice(1),edits:[],request:{...request,messages:[{role:"user",content:instruction}]}});
    expect(result.problems).toEqual([]);expect(result.intent.requirements[6]).toMatchObject({kind:"decision",text:"The remaining share goes to the creator wallet",open:null});
    expect(result.intent.unresolved).toEqual(questions.slice(1));
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
    const intent = migrateLaunchIntent({ requestId: request.id, draft: checkedDraft(), unresolved: ["Choose the recipient"] })!;
    expect(intent.requirements.map(rule => rule.text)).toEqual([...texts.slice(0, 2), "Choose the recipient"]);
    expect(intent.requirements.every(rule => rule.origin.kind === "legacy")).toBe(true);
    expect(intent.requirements[2].open).toBe("Choose the recipient");
    const repeated=migrateLaunchIntent({draft:checkedDraft(["3% fees","3% fees"])})!;
    expect(repeated.requirements).toHaveLength(2);
    expect(new Set(repeated.requirements.map(rule=>rule.id)).size).toBe(2);
  });
  it("binds the complete intent and parent source revision without promoting launch status", () => {
    const intent = reviseLaunchIntent({ proposed: proposed.slice(0, 2), unresolved: [], edits: [], request }).intent;
    const draft = checkedDraft();
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
  it("replays the real Surplus design and follow-up through the current server without provider calls", async () => {
    let index=0;
    const call=vi.fn(async(input:{schema:object})=>{
      // Keep the recorded design and reply. Metadata and the product-plan
      // field absent in 2.4 are explicitly null in the current envelope.
      const original=recording.responses[index++];
      const {requirements,...recorded}=original;
      // Translate only exact known old labels into the new identity field;
      // this historical recording must not gain inferred rule coverage.
      const captured={...recorded,productPlan:null,intentMode:"revise",launchRequested:false,reviseChecks:false,replyLocale:"en",implementedRequirementIds:original.intentRequirements.filter(rule=>requirements.includes(rule.text)).map(rule=>rule.id),
        executionRoute:"fee-module",setupPatch:{description:null,website:null,x:null,socialPost:null,...original.setupPatch}};
      const properties=(input.schema as {properties?:Record<string,unknown>}).properties;
      // Short explanatory follow-ups now use the cheaper reply-only contract.
      if(properties&&Object.keys(properties).join() === "reply")return response({reply:original.reply});
      return response(JSON.parse(prepareSurplusSchema(input.schema).decode(JSON.stringify(captured))));
    });
    const compile=vi.fn();
    const first=await runCustomAI({id:"recorded-intent-0001",intent:"chat",messages:[{role:"user",content:recording.prompts[0]}]},undefined,{call,compile});
    expect(first.intent?.requirements).toHaveLength(10);expect(first.intent?.unresolved).toHaveLength(4);
    expect(first.intent?.requirements.filter(rule=>rule.kind==="constraint").map(rule=>rule.id)).toEqual(["no-wallet-transfer-fee","no-minting","no-initial-liquidity-withdrawal"]);
    expect(first.change).toBe("blocked");expect(first.draft).toBeUndefined();
    const second=await runCustomAI({id:"recorded-followup-01",intent:"chat",messages:[{role:"user",content:recording.prompts[1]}]},undefined,{call,compile},{intent:first.intent,memory:first.memory});
    expect(second.intent).toEqual(first.intent);expect(second.change).toBe("unchanged");
    expect(call).toHaveBeenCalledTimes(2);expect(compile).not.toHaveBeenCalled();
  });
});
