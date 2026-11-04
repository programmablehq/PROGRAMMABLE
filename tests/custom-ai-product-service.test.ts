import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runCustomAI } from "../lib/custom-ai/service.server";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { ChatRequest } from "../lib/custom-ai/types";
import type { ClaudeInput } from "../lib/custom-ai/claude.server";
import type { ContractProject } from "../lib/custom-ai/contract-project";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

const instruction = "Plan a counter anyone can increment, with a page showing its value. Do not build it yet.";
const request: ChatRequest = { id: "product-plan-request-0001", intent: "chat", coin: { ...EMPTY_COIN_SETUP, chainId: 8453 }, messages: [{ role: "user", content: instruction }] };
const productPlan = {
  components: [
    { id: "counter", kind: "adapter", name: "Counter", purpose: "Keep the counter value", requirementIds: ["counter"], dependsOn: [] },
    { id: "dashboard", kind: "interface", name: "Counter page", purpose: "Show the value", requirementIds: ["page"], dependsOn: ["counter"] },
  ], assets: [], flows: [], services: [], interfaceActions: [{ id: "view-counter", target: "counter", kind: "inspect", requirementIds: ["page"] }],
};
const envelope = (overrides: Record<string, unknown> = {}) => ({
  reply: "The counter and its page are planned.", replyLocale: "en", executionRoute: "custom-contract", intentMode: "revise", action: "answer",
  intentRequirements: [
    { id: "counter", text: "Anyone can increment the counter", kind: "behavior", instruction, open: null },
    { id: "page", text: "Show the counter value on a page", kind: "behavior", instruction, open: null },
  ], productPlan, ruleEdits: [], memory: "Counter and dashboard", implementedRequirementIds: [], setupPatch: {}, feeChecks: [],
  program: null, eventRule: null, composable: null, lookups: [], launchRequested: false, reviseChecks: false, ...overrides,
});
const response = (value: unknown) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });
const compile = vi.fn(async () => { throw Error("No fee compilation expected"); });

describe("product blueprint in the existing chat pipeline", () => {
  it("keeps summary requests in the answer lane without generating source",async()=>{
    const initial=await runCustomAI(request,undefined,{call:async()=>response(envelope()),compile});
    const call=vi.fn(async()=>response(envelope({intentMode:"preserve",intentRequirements:[],productPlan:null})));
    const build=vi.fn();
    const result=await runCustomAI({...request,id:"summary-request-0001",messages:[...request.messages,{role:"assistant",content:initial.reply},{role:"user",content:"Generate a short summary of the saved rules."}]},
      undefined,{call,compile:build},{intent:initial.intent,productBlueprint:initial.productBlueprint,saveProject:async()=>{}});
    expect(result.change).toBe("unchanged");expect(result.intent?.revision).toBe(initial.intent?.revision);
    expect(call).toHaveBeenCalledOnce();expect(build).not.toHaveBeenCalled();
  });
  it("blocks a changed product when the missing replacement plan cannot be repaired",async()=>{
    const initial=await runCustomAI(request,undefined,{call:async()=>response(envelope()),compile});
    const call=vi.fn(async(input:ClaudeInput)=>response(input.task==="product-repair"?{productPlan:{...productPlan,components:[]}}:
      envelope({action:"build",intentMode:"preserve",intentRequirements:[],productPlan:null})));
    const build=vi.fn();
    const result=await runCustomAI({...request,id:"changed-product-0001",coin:{...request.coin!,chainId:1},messages:[...request.messages,{role:"assistant",content:initial.reply},{role:"user",content:"Build the saved contracts on Ethereum."}]},
      undefined,{call,compile:build},{intent:initial.intent,productBlueprint:initial.productBlueprint,saveProject:async()=>{}});
    expect(result.buildIssue).toEqual({stage:"product",code:"incomplete-plan"});expect(build).not.toHaveBeenCalled();
    expect(call.mock.calls.some(([input])=>input.task==="product-repair"&&input.system.includes(initial.productBlueprint!.id))).toBe(true);
  });
  it("repairs a malformed architecture once without asking the user to repeat the design", async () => {
    const bad = structuredClone(productPlan); bad.interfaceActions[0].target = "missing";
    const call = vi.fn(async (input:ClaudeInput)=>response(input.task==="product-repair"?{productPlan}:envelope({productPlan:bad})));
    const result = await runCustomAI(request,undefined,{call,compile});
    expect(result.productBlueprint?.interfaceActions[0].target).toBe("counter");
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.buildIssue).toBeUndefined();
  });
  it("saves the complete intent when the single structural repair fails", async () => {
    const bad = {...productPlan,components:[]};
    const call=vi.fn(async(input:ClaudeInput)=>response(input.task==="product-repair"?{productPlan:bad}:envelope({productPlan:bad})));
    const result=await runCustomAI(request,undefined,{call,compile});
    expect(result.intent?.requirements.map(rule=>rule.id)).toEqual(["counter","page"]);
    expect(result.productBlueprint).toBeUndefined();
    expect(result.buildIssue).toEqual({stage:"product",code:"incomplete-plan"});
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("does not turn a structural repair into a new financial allocation",async()=>{
    const original={...productPlan,assets:[{id:"funds",kind:"native",name:"ETH"}],flows:[{id:"fee-share",source:"creator",target:"missing",asset:"funds",trigger:"deposit",purpose:"Fund the counter",requirementIds:["counter"],allocationGroup:"initial-funds",shareBps:5000}]};
    const repaired={...original,flows:[{...original.flows[0],target:"counter",shareBps:10000}]};
    const call=vi.fn(async(input:ClaudeInput)=>response(input.task==="product-repair"?{productPlan:repaired}:envelope({productPlan:original})));
    const result=await runCustomAI(request,undefined,{call,compile});
    expect(result.buildIssue?.stage).toBe("product");
    expect(result.productBlueprint).toBeUndefined();
    expect(result.intent?.requirements).toHaveLength(2);
  });
  it("returns a saved-rule-bound product plan from the ordinary planner call", async () => {
    const call = vi.fn(async () => response(envelope()));
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result.productBlueprint).toMatchObject({ chainId: 8453, intentRevision: result.intent?.revision, state: "defined", execution: "not-certified" });
    expect(result.productBlueprint?.interfaceActions[0].target).toBe("counter");
    expect(call).toHaveBeenCalledTimes(1);
    expect(compile).not.toHaveBeenCalled();
  });

  it("preserves the accepted product while exploring a different idea", async () => {
    const initial = await runCustomAI(request, undefined, { call: async () => response(envelope()), compile });
    const brainstorm: ChatRequest = { ...request, id: "product-plan-request-0002", messages: [...request.messages, { role: "assistant", content: initial.reply }, { role: "user", content: "What other ideas could we build? Keep my saved product." }] };
    const call = vi.fn(async (input: ClaudeInput) => { void input; return response(envelope({ intentMode: "preserve", intentRequirements: [], productPlan: { ...productPlan, components: [] } })); });
    const result = await runCustomAI(brainstorm, undefined, { call, compile }, { intent: initial.intent, productBlueprint: initial.productBlueprint });
    expect(result.intent?.revision).toBe(initial.intent?.revision);
    expect(result.productBlueprint).toEqual(initial.productBlueprint);
    expect(call.mock.calls[0][0].system).toContain(initial.productBlueprint!.id);
  });

  it("keeps the same product through a short acknowledgement without calling the planner", async () => {
    const initial = await runCustomAI(request, undefined, { call: async () => response(envelope()), compile });
    const ack: ChatRequest = { ...request, id: "product-plan-request-0003", messages: [...request.messages, { role: "assistant", content: initial.reply }, { role: "user", content: "Thanks" }] };
    const result = await runCustomAI(ack, undefined, { call: async () => response({ reply: "You're welcome." }), compile }, { intent: initial.intent, productBlueprint: initial.productBlueprint });
    expect(result.productBlueprint).toEqual(initial.productBlueprint);
  });

  it("passes the same canonical product into source generation rather than another free-form specification", async () => {
    const initial = await runCustomAI(request, undefined, { call: async () => response(envelope()), compile });
    const build: ChatRequest = { ...request, id: "product-plan-request-0004", messages: [...request.messages, { role: "assistant", content: initial.reply }, { role: "user", content: "Build the complete saved design now." }] };
    const call = vi.fn(async (input: ClaudeInput) => input.task === "planning"
      ? response(envelope({ action: "build", intentMode: "preserve", intentRequirements: [], productPlan: null }))
      : response({ reply: "Counter source saved.", summary: "Counter with its public value", sourceFiles: [{ path: "Counter.sol", content: "pragma solidity 0.8.26; contract Counter { uint public value; function increment() external { value++; } }" }], entrypoints: [{ source: "Counter.sol", contract: "Counter", role: "auxiliary" }], requirementIds: ["counter", "page"] }));
    const compileProject = vi.fn(async (project: ContractProject) => {
      const body = { version: 1 as const, projectHash: project.hash, compiled: false, compiler: project.compiler.version, diagnostics: [{ severity: "error" as const, message: "Isolated source stage only" }], contracts: [], verification: "not-run" as const, launchReady: false as const };
      return { ...body, artifactHash: canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) };
    });
    const result = await runCustomAI(build, undefined, { call, compile, compileProject }, { intent: initial.intent, productBlueprint: initial.productBlueprint, saveProject: async () => {} });
    expect(result.productBlueprint?.id).toBe(initial.productBlueprint?.id);
    expect(call.mock.calls.find(([input]) => input.task !== "planning")?.[0].system).toContain(initial.productBlueprint!.id);
    expect(compileProject).toHaveBeenCalledTimes(1);
    expect(result.generalProject?.compiled).toBe(false);
    expect(result.generalProject?.productBlueprintId).toBe(initial.productBlueprint?.id);
  });
});
