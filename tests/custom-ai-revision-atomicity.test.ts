import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runCustomAI, type AIContext } from "../lib/custom-ai/service.server";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { CONTINUE_SAVED_BUILD } from "../lib/custom-ai/build-command";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const previous: LaunchIntent = { version: 1, id: "saved-fee-design-001", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "fee-start", text: "Total swap fee starts at 2% on Ethereum.", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "fee-ramp", text: "Total fee falls to the Ethereum platform minimum over 24 hours.", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "recipient", text: "All project fees go to the linked creator wallet.", kind: "behavior", open: null, origin: { kind: "legacy" } },
] };
const instruction = "Switch the saved design to Base. Keep the 2% total start, 24-hour fall and creator recipient. No build yet.";
const request = { id: "atomic-revision-request-001", intent: "chat" as const, coin: EMPTY_COIN_SETUP, messages: [{ role: "user" as const, content: instruction }] };
function proposal(complete = false) {
  return { reply: "The saved design is now on Base.", replyLocale: "en", action: "answer", intentMode: "revise", executionRoute: "custom-contract",
    memory: "Use Base.", setupPatch: { chainId: 8453 }, lookups: [], productPlan: null,
    intentRequirements: previous.requirements.map(({ id, text, kind, open }) => ({ id, text: text.replaceAll("Ethereum", "Base"), kind, open, instruction: "" })),
    ruleEdits: (complete ? ["fee-start", "fee-ramp"] : ["fee-ramp"]).map(requirementId => ({ requirementId, operation: "replace", instruction })),
  };
}
const response = (value: unknown) => ({ text: JSON.stringify(value), inputTokens: 1, outputTokens: 1 });
const context = (): AIContext => ({ intent: structuredClone(previous), owner: "atomic-test", saveProject: async () => { throw Error("Unexpected source write"); } });

describe("atomic saved-design revisions", () => {
  it("keeps the complete old design and coin when a chain change remains incomplete after bounded repair", async () => {
    const call = vi.fn().mockResolvedValue(response(proposal()));
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn() }, context());
    expect(result.change).toBe("blocked");
    expect(result.intent).toEqual(previous);
    expect(result.setupPatch).toBeUndefined();
    expect(result.pendingRevision).toMatchObject({ instruction, issues: [previous.requirements[0].text] });
    expect(call.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("repairs the missing edit once and applies the whole chain revision together", async () => {
    const call = vi.fn().mockResolvedValueOnce(response(proposal())).mockResolvedValue(response(proposal(true)));
    const result = await runCustomAI(request, undefined, { call, compile: vi.fn() }, context());
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.change).toBe("applied");
    expect(result.setupPatch).toEqual({ chainId: 8453 });
    expect(result.intent?.requirements.map(rule => rule.text).join(" ")).not.toContain("Ethereum");
    expect(result.pendingRevision).toBeUndefined();
  });
  it("repairs a paraphrased change quote without weakening provenance validation",async()=>{
    const invalid=proposal(true);invalid.ruleEdits=invalid.ruleEdits.map(edit=>({...edit,instruction:"A paraphrase, not the user's message."}));
    const call=vi.fn().mockResolvedValueOnce(response(invalid)).mockResolvedValue(response(proposal(true)));
    const result=await runCustomAI(request,undefined,{call,compile:vi.fn()},context());
    expect(call).toHaveBeenCalledTimes(2);expect(result.change).toBe("applied");
    expect(result.intent?.changes.every(change=>change.origin.kind==="message"&&change.origin.quote===instruction)).toBe(true);
  });
  it("binds a quote that omitted only the no-build sentence back to the literal user message",async()=>{
    const content="Switch the saved design to Base. Do not build yet. Keep the 2% total start and 24-hour fall.";
    const omitted="Switch the saved design to Base. Keep the 2% total start and 24-hour fall.";
    const value=proposal(true);value.ruleEdits=value.ruleEdits.map(edit=>({...edit,instruction:omitted}));
    const call=vi.fn().mockResolvedValue(response(value));
    const result=await runCustomAI({...request,messages:[{role:"user",content}]},undefined,{call,compile:vi.fn()},context());
    expect(result.change).toBe("applied");expect(call).toHaveBeenCalledOnce();
    expect(result.intent?.changes.every(change=>change.origin.kind==="message"&&change.origin.quote===content)).toBe(true);
  });
  it("keeps a network-only rule's identity for an explicitly quoted chain change",async()=>{
    const intent:LaunchIntent={...previous,requirements:[previous.requirements[2],{id:"network",text:"Der Coin läuft auf Ethereum (Chain 1).",kind:"constraint",open:null,origin:{kind:"legacy"}}]};
    const value={...proposal(),ruleEdits:[],intentRequirements:[
      {...intent.requirements[0],instruction:""},
      {id:"base-network",text:"Der Coin läuft auf Base (Chain 8453).",kind:"constraint",open:null,instruction:"Wechsle den Entwurf auf Base."},
    ]};
    const call=vi.fn().mockResolvedValue(response(value));
    const result=await runCustomAI({...request,messages:[{role:"user",content:"Wechsle den Entwurf auf Base. Noch nichts bauen."}]},undefined,{call,compile:vi.fn()},{...context(),intent});
    expect(result.change).toBe("applied");expect(result.pendingRevision).toBeUndefined();
    expect(result.intent?.requirements.find(rule=>rule.id==="network")?.text).toContain("Base");
    expect(result.intent?.requirements.some(rule=>rule.id==="base-network")).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it("does not start a build from a persisted pending revision", async () => {
    const call = vi.fn().mockResolvedValue(response({ reply: "Please explain the change.", action: "clarify", intentMode: "preserve", intentRequirements: [], ruleEdits: [], setupPatch: {}, lookups: [] }));
    const pendingRevision = { instruction, issues: [previous.requirements[0].text] };
    const result = await runCustomAI({ ...request, messages: [{ role: "user", content: CONTINUE_SAVED_BUILD }] }, undefined,
      { call, compile: vi.fn() }, { ...context(), pendingRevision });
    expect(call).not.toHaveBeenCalled();
    expect(result.change).toBe("blocked");
    expect(result.pendingRevision).toEqual(pendingRevision);
    expect(result.intent).toEqual(previous);
    expect(result.nextAction).toBeUndefined();
  });

  it("also protects an older blocked revision represented only by an unresolved rule", async () => {
    const call = vi.fn().mockResolvedValue(response({ reply: "Please explain the change.", action: "clarify", intentMode: "preserve", intentRequirements: [], ruleEdits: [], setupPatch: {}, lookups: [] }));
    const result = await runCustomAI({ ...request, messages: [{ role: "user", content: CONTINUE_SAVED_BUILD }] }, undefined,
      { call, compile: vi.fn() }, { ...context(), unresolved: [previous.requirements[0].text] });
    expect(call).not.toHaveBeenCalled();
    expect(result.change).toBe("blocked");
    expect(result.intent).toEqual(previous);
  });

  it("preserves a pending revision through a saved-design question", async () => {
    const call = vi.fn().mockResolvedValue(response({ reply: "The saved fee plan is unchanged." }));
    const pendingRevision = { instruction, issues: [previous.requirements[0].text] };
    const result = await runCustomAI({ ...request, messages: [{ role: "user", content: "What are the rules of the saved design?" }] }, undefined,
      { call, compile: vi.fn() }, { ...context(), pendingRevision });
    expect(result.pendingRevision).toEqual(pendingRevision);
    expect(result.unresolved).toContain(previous.requirements[0].text);
  });

  it("also blocks an explicit build request before any model call",async()=>{
    const call=vi.fn().mockResolvedValue(response({reply:"Resolve the change.",action:"clarify",intentMode:"preserve",intentRequirements:[],ruleEdits:[],setupPatch:{},lookups:[]}));
    const pendingRevision={instruction,issues:[previous.requirements[0].text]};
    const result=await runCustomAI({...request,intent:"build",messages:[{role:"user",content:"Create the contract"}]},undefined,
      {call,compile:vi.fn()},{...context(),pendingRevision});
    expect(call).not.toHaveBeenCalled();expect(result.pendingRevision).toEqual(pendingRevision);expect(result.change).toBe("blocked");
  });
  it("does not clear the pending change when an explanation repeats the unchanged rules",async()=>{
    const pendingRevision={instruction,issues:[previous.requirements[0].text]};
    const call=vi.fn().mockResolvedValue(response({...proposal(true),setupPatch:{},ruleEdits:[],
      intentRequirements:previous.requirements.map(({id,text,kind,open})=>({id,text,kind,open,instruction:""}))}));
    const result=await runCustomAI({...request,messages:[{role:"user",content:"Give me a short summary of the timing."}]},undefined,
      {call,compile:vi.fn()},{...context(),pendingRevision});
    expect(result.pendingRevision).toEqual(pendingRevision);expect(result.unresolved).toContain(previous.requirements[0].text);
  });
  it("retains a pending validation error when a conversational build is blocked, including after reload",async()=>{
    const pendingRevision={instruction,issues:["Every changed closed rule needs its original ID."]};
    const call=vi.fn().mockResolvedValue(response({...proposal(true),action:"build",intentMode:"preserve",setupPatch:{},ruleEdits:[],
      intentRequirements:previous.requirements.map(({id,text,kind,open})=>({id,text,kind,open,instruction:""}))}));
    const result=await runCustomAI({...request,messages:[{role:"user",content:"Please turn the current rules into source."}]},undefined,
      {call,compile:vi.fn()},{...context(),pendingRevision});
    expect(result.change).toBe("blocked");expect(result.pendingRevision).toEqual(pendingRevision);
    const reloadCall=vi.fn();
    const reloaded=await runCustomAI({...request,intent:"build"},undefined,{call:reloadCall,compile:vi.fn()},
      {...context(),intent:result.intent,pendingRevision:result.pendingRevision,unresolved:result.unresolved});
    expect(reloadCall).not.toHaveBeenCalled();expect(reloaded.pendingRevision).toEqual(pendingRevision);
  });
});
