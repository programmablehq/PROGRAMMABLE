import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertSavedCheckPlan} from "../lib/custom-ai/platform/check-plan-guard";
import {platformContractDocument} from "./fixtures/custom-ai-platform-contract";
import type {JsonValue} from "../lib/custom-ai/platform/types";

it("keeps failed expected values, test calls and coverage immutable after source exists",()=>{
 const document=structuredClone(platformContractDocument),requirements=document.requirements;
 for(const change of ["expected","caller","removed"]){
  const architecture=structuredClone(document.architecture);
  if(change==="expected")architecture.contractChecks.steps[0].expect.returns=["170"];
  if(change==="caller")architecture.contractChecks.steps[0].from="creator";
  if(change==="removed")architecture.contractChecks.steps=[];
  expect(()=>assertSavedCheckPlan({document} as never,requirements as never,architecture as JsonValue)).toThrow(expect.objectContaining({code:"project-check-target"}));
 }
});
it("permits additional coverage and an explicit change to the linked requirement",()=>{
 const document=structuredClone(platformContractDocument),architecture=structuredClone(document.architecture);
 architecture.contractChecks.steps.push({...architecture.contractChecks.steps[0],id:"second-reader",from:"trader-b"});
 expect(()=>assertSavedCheckPlan({document} as never,document.requirements as never,architecture as JsonValue)).not.toThrow();
 architecture.contractChecks.steps[0].expect.returns=["1"];
 expect(()=>assertSavedCheckPlan({document} as never,[{...document.requirements[0],text:"The value starts at one"}] as never,architecture as JsonValue)).not.toThrow();
 expect(()=>assertSavedCheckPlan({document:{...document,files:{}}} as never,document.requirements as never,architecture as JsonValue)).not.toThrow();
});
