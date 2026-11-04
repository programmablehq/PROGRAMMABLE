import { describe, expect, it } from "vitest";
import { cachedExecutionTrace, executionContext, type ExecutionTrace } from "../lib/custom-ai/execution-trace";
import { cachedScenarioOverview, scenarioOverview } from "../lib/custom-ai/scenario-overview";
import { modelDesignContext, plannerNeedsExecution } from "../lib/custom-ai/planning-context";
import type { ChatRequest } from "../lib/custom-ai/types";

function trace():ExecutionTrace{return {version:1,environment:"isolated-declared-fixtures",networkAccess:false,gasFeesCharged:false,
  plannedSteps:1,executedSteps:1,detailsComplete:true,steps:[{id:"read-fee",contract:"main",signature:"fee()",from:"trader-a",afterSeconds:0,value:"0",read:true,status:"success",
    outputs:[{name:"fee",type:"uint256",value:"900",truncated:false}],events:[],nativeChanges:[],detailsComplete:true}]};}
const request=(content:string):ChatRequest=>({id:"test-request",intent:"chat",messages:[{role:"user",content}]});

describe("observed contract execution",()=>{
  it("preserves actual results in owner browser metadata without turning them into a live proof",()=>{
    const original=trace(),report={version:1 as const,scope:"isolated-declared-scenarios-v1" as const,projectHash:`sha256:${"1".repeat(64)}` as const,
      artifactHash:`sha256:${"2".repeat(64)}` as const,planHash:`sha256:${"3".repeat(64)}` as const,hash:`sha256:${"4".repeat(64)}` as const,
      passed:false,cases:3,gasUsed:"1234",failures:[{caseId:"read-fee",code:"return-value",message:"Expected fee differs"}],requirementIds:["fee"],launchReady:false as const,execution:original};
    const restored=cachedScenarioOverview(scenarioOverview(report));
    expect(restored?.execution).toEqual(original);
    expect(restored?.execution?.steps[0].outputs[0].value).toBe("900");
    expect(restored).not.toHaveProperty("launchReady");
    original.steps[0].outputs[0].value="1000";
    expect(restored?.execution?.steps[0].outputs[0].value).toBe("900");
  });
  it("rejects forged live labels, impossible counts, reverted payouts and oversized output",()=>{
    for(const edit of [(t:ExecutionTrace)=>{t.networkAccess=true as false;},(t:ExecutionTrace)=>{t.executedSteps=2;},
      (t:ExecutionTrace)=>{t.steps[0].status="revert";},(t:ExecutionTrace)=>{t.steps[0].outputs[0].value="x".repeat(513);},
      (t:ExecutionTrace)=>{t.steps[0].nativeChanges=[{account:"account/creator",before:"1",after:"2"}];}]){
      const value=trace();edit(value);expect(cachedExecutionTrace(value)).toBeUndefined();
    }
    const bounded=trace();bounded.detailsComplete=false;bounded.steps[0].detailsComplete=false;bounded.steps[0].outputs[0].truncated=true;
    expect(cachedExecutionTrace(bounded)).toEqual(bounded);
  });
  it("keeps the unasked-for execution trace out of ordinary planning context",()=>{
    expect(plannerNeedsExecution(request("What happened in the 900 wei example?"))).toBe(true);
    expect(plannerNeedsExecution(request("Explain the simulation"))).toBe(true);
    expect(plannerNeedsExecution(request("Change the image"))).toBe(false);
    expect(modelDesignContext({},false)).not.toHaveProperty("simulation");
    expect(executionContext(trace())).toMatchObject({environment:"isolated-declared-fixtures",observations:[{outputs:[{value:"900"}]}]});
  });
});
