import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {designOnlyRequest,explicitSourceBuild} from "../lib/custom-ai/build-command";
import {resolvedFeeQuestion} from "../lib/custom-ai/planning-policy";
import {runCustomAI} from "../lib/custom-ai/service.server";
import {normalizeRuleSpec} from "../lib/custom-ai/rule-spec";
import fixture from "./fixtures/custom-ai/london-liquidity-v2.json";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";

describe("explicit discussion boundaries",()=>{
  it.each([
    "Discutons seulement du projet, ne génère aucun code et ne construis rien.",
    "Solo quiero discutir el plan. No generes código todavía.",
    "Voglio solo discutere il piano, non costruire ancora.",
    "Quero só conversar sobre o plano. Não gere código ainda.",
    "Alleen het plan bespreken, bouw nog niets.",
    "Sadece planı konuşalım, henüz kod üretme.",
  ])("does not offer source generation for %s",content=>{
    const request={intent:"chat" as const,messages:[{role:"user" as const,content}]};
    expect(designOnlyRequest(request)).toBe(true);expect(explicitSourceBuild(request)).toBe(false);
  });
  it("does not let selecting a rule remove the user's no-build boundary",async()=>{
    const sourceHash="a".repeat(64),spec=normalizeRuleSpec(fixture);let actions:unknown;
    const call=vi.fn(async (input:ClaudeInput)=>{actions=(input.schema as {properties:{action:{enum:unknown}}}).properties.action.enum;throw Error("schema observed");});
    await expect(runCustomAI({id:"selected-rule-discussion-001",intent:"chat",draftId:"saved-rule-draft-0001",editTarget:{sourceHash,requirementId:spec.requirements[0].id},
      messages:[{role:"user",content:"Nur besprechen, noch nichts bauen: Wie kann ich diese Regel ändern?"}]},undefined,{call,compile:vi.fn()},
      {ruleSpec:spec,draft:{source:"",sourceHash,compiled:false,diagnostics:[]}})).rejects.toThrow("schema observed");
    expect(actions).not.toContain("build");
  });
  it("does not delete a quoted example of a fee question",()=>{
    expect(resolvedFeeQuestion('Example: "Should 2% be total or additional fees?"',"Use a 2% total fee.",3000)).toBe(false);
  });
  it("keeps a genuine component choice when the user did not choose total or project",()=>{
    expect(resolvedFeeQuestion("Should 2% be total or additional fees?","Use a 2% fee.",3000)).toBe(false);
  });
  it("keeps a choice about changing the rate during the ramp",()=>{
    expect(resolvedFeeQuestion("Should the fee remain flat or change during the first hour?","Plan a linear ramp from 2% to 0.3% over 24 hours.",3000)).toBe(false);
  });
  it("does not remove a non-fee choice just because the design also contains a fee ramp",()=>{
    expect(resolvedFeeQuestion("Should the oracle remain or change after the first day?","Plan a linear ramp from 2% to 0.3% over 24 hours.",3000)).toBe(false);
  });
});
