import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {settledDesignReply,withoutSaveConfirmation} from "../lib/custom-ai/reply-mode";
import {runCustomAI} from "../lib/custom-ai/service.server";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";

describe("saved design replies",()=>{
  it.each([
    ["Die Gebühren sinken auf 0,3 %. Soll ich das so als Design festhalten?","Die Gebühren sinken auf 0,3 %."],
    ["Die Regeln bleiben gleich. Möchtest du, dass ich den Plan speichere?","Die Regeln bleiben gleich."],
    ["The project fee stays separate. Shall I save this as the plan?","The project fee stays separate."],
    ["The rule is clear. Would you like me to save this design?","The rule is clear."],
    ["Der Plan steht. Sollen wir das so speichern?","Der Plan steht."],
    ["Die Regeln bleiben gleich. Möchtest du den Entwurf so speichern?","Die Regeln bleiben gleich."],
    ["The plan is clear. Shall we save it?","The plan is clear."],
    ["The rule is clear. Do you want this plan saved?","The rule is clear."],
    ["Which recipient gets the rest?\nShould I save the plan?","Which recipient gets the rest?"],
  ])("removes only the redundant save question: %s",(reply,expected)=>{
    expect(withoutSaveConfirmation(reply)).toBe(expected);
  });
  it.each([
    "Soll ich die Gebühr auf 3 % setzen?",
    "Soll ich den Plan speichern oder bauen?",
    "Should I save these rules or deploy the contract?",
    "Shall I add a reserve vault and save the plan?",
    'Die Oberfläche zeigt: "Soll ich das so als Design festhalten?"',
    "The example says `Should I save the plan?`.",
    "Soll ich die restlichen 30 % an dich senden?",
    "Which wallet should receive the project fees?",
    "The draft is saved. Should I save",
    "Can I record you?",
    "Do you want me saved?",
  ])("preserves a real choice, quotation or partial question: %s",reply=>{
    expect(withoutSaveConfirmation(reply)).toBe(reply);
  });
  it("uses an acknowledgement only for the final reply when the question was the entire text",()=>{
    expect(withoutSaveConfirmation("Soll ich das so als Design festhalten?")).toBe("");
    expect(settledDesignReply("Soll ich das so als Design festhalten?","de")).toBe("Der Plan ist gespeichert.");
    expect(settledDesignReply("Should I save this plan?","en")).toBe("The plan is saved.");
  });
  it("returns and streams the saved rules without asking to save them again",async()=>{
    const reply="Die Gesamtgebühr sinkt von 2 % auf 0,5 %. Soll ich das so als Design festhalten?";
    const progress:string[]=[];
    const call=vi.fn(async(input:ClaudeInput)=>{
      input.onText?.(JSON.stringify({reply}));
      return {text:JSON.stringify({reply,replyLocale:"de",action:"answer",executionRoute:"custom-contract",intentMode:"revise",
        intentRequirements:[{id:"fees",text:"Gesamtgebühr sinkt von 2 % auf 0,5 % in 24 Stunden.",kind:"behavior",instruction:"",open:null}],
        productPlan:null,ruleEdits:[],memory:"",launchRequested:false,reviseChecks:false,setupPatch:{},lookups:[]}),inputTokens:1,outputTokens:1};
    });
    const compile=vi.fn();
    const result=await runCustomAI({id:"saved-discussion-question-01",intent:"chat",messages:[{role:"user",content:"Erst besprechen, noch nix bauen: 2 % Gesamtgebühr auf 0,5 % über 24 Stunden."}]},undefined,{call,compile},
      {onProgress:event=>{if(event.type==="reply")progress.push(event.text);}});
    expect(result.reply).toBe("Die Gesamtgebühr sinkt von 2 % auf 0,5 %.");
    expect(result.intent?.requirements.map(rule=>rule.text)).toEqual(["Gesamtgebühr sinkt von 2 % auf 0,5 % in 24 Stunden."]);
    expect(progress).toEqual(["Die Gesamtgebühr sinkt von 2 % auf 0,5 %."]);
    expect(result.nextAction).toBeUndefined();expect(result.draft).toBeUndefined();
    expect(call).toHaveBeenCalledOnce();expect(compile).not.toHaveBeenCalled();
  });
  it("does not claim a plan was saved when the reply contains no canonical design",async()=>{
    const reply="Should I save this plan?";
    const call=vi.fn(async()=>({text:JSON.stringify({reply,action:"answer",executionRoute:"custom-contract",intentMode:"revise",intentRequirements:[],
      productPlan:null,ruleEdits:[],memory:"",launchRequested:false,reviseChecks:false,setupPatch:{},lookups:[]}),inputTokens:1,outputTokens:1}));
    const result=await runCustomAI({id:"no-saved-design-question-01",intent:"chat",messages:[{role:"user",content:"Let's discuss first."}]},undefined,{call,compile:vi.fn()});
    expect(result.intent).toBeUndefined();expect(result.reply).toBe(reply);
  });
  it("keeps a material question and its unresolved requirement",async()=>{
    const question="Which recipient should receive the remaining 30%?";
    const call=vi.fn(async()=>({text:JSON.stringify({reply:question,action:"clarify",executionRoute:"custom-contract",intentMode:"revise",
      intentRequirements:[{id:"remainder",text:"The recipient of the remaining 30% is open.",kind:"decision",instruction:"",open:question}],
      productPlan:null,ruleEdits:[],memory:"",launchRequested:false,reviseChecks:false,setupPatch:{},lookups:[]}),inputTokens:1,outputTokens:1}));
    const result=await runCustomAI({id:"saved-design-material-question-01",intent:"chat",messages:[{role:"user",content:"Discuss first: where should the remaining 30% go?"}]},undefined,{call,compile:vi.fn()});
    expect(result.reply).toBe(question);expect(result.unresolved).toEqual([question]);
    expect(result.intent?.requirements[0].open).toBe(question);
  });
});
