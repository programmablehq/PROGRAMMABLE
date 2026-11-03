import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../lib/custom-ai/source-foundation.server",()=>({sourceFoundation:vi.fn()}));
import {buildGeneralContract} from "../lib/custom-ai/general-builder.server";
import {sourceFoundation} from "../lib/custom-ai/source-foundation.server";
import {createGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {GENERAL_PROJECT_COMPILER,type ContractProject} from "../lib/custom-ai/contract-project";
import type {CompiledProject} from "../lib/custom-ai/contract-project.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import {auditGeneralSource,type SourceAuditFinding} from "../lib/custom-ai/source-audit.server";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";

const intent:LaunchIntent={version:1,id:"qualified-foundation",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"counter",text:"Anyone can increment the counter, starting at zero.",kind:"behavior",open:null,origin:{kind:"legacy"}},
]};
const code="pragma solidity 0.8.26; contract Counter { uint public counter = 0; function increment() external { counter++; } }";
const blueprint=createGeneralCheckBlueprint({contracts:[{id:"counter",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function counter() view returns(uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],steps:[
  {id:"increment",contract:"counter",signature:"increment()",arguments:[],from:"creator",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"read",contract:"counter",signature:"counter()",arguments:[],from:"creator",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
]},intent,999,"paris");
const reply=(value:unknown)=>({text:JSON.stringify(value),inputTokens:1,outputTokens:100});
const compiled=async(project:ContractProject):Promise<CompiledProject>=>({version:1,projectHash:project.hash,artifactHash:`sha256:${"b".repeat(64)}`,compiler:GENERAL_PROJECT_COMPILER,compiled:!project.sources["Counter.sol"].content.includes("missing"),diagnostics:project.sources["Counter.sol"].content.includes("missing")?[{severity:"error",message:"DeclarationError: undeclared identifier\n --> Counter.sol:1:71"}]:[],contracts:[],verification:"not-run",launchReady:false});
const audit=(project:ContractProject,findings:SourceAuditFinding[]=[])=>auditGeneralSource(project,undefined,{call:async()=>reply({reviewedRequirementIds:["counter"],findings})});
function input(events:string[]=[]){
  let saved:ContractProject|undefined;
  return {intent,chainId:999 as const,evmVersion:"paris" as const,blueprint,messages:[{role:"user" as const,content:"Build the exact saved counter."}],
    saveSourceProgress:vi.fn(async()=>{}),
    saveProject:vi.fn(async(project:ContractProject)=>{expect(saved).toBeUndefined();saved=structuredClone(project);events.push("project");}),
    saveAudit:vi.fn(async()=>{expect(saved).toBeDefined();events.push("saved-audit");})};
}
beforeEach(()=>vi.mocked(sourceFoundation).mockReturnValue({sources:{"Counter.sol":{content:code}},completeReference:true}));

describe("qualified foundations inside the immutable project job",()=>{
  it("keeps a matching implementation unchanged with one compile and one audit, then persists in order",async()=>{
    const events:string[]=[],request=input(events),call=vi.fn(),compile=vi.fn(async(project:ContractProject)=>{events.push("compile");return compiled(project);});
    const auditSource=vi.fn(async(project:ContractProject)=>{events.push("audit");return audit(project);});
    const result=await buildGeneralContract({...request,auditSource},undefined,{call,compile});
    expect(call).not.toHaveBeenCalled();expect(compile).toHaveBeenCalledOnce();expect(auditSource).toHaveBeenCalledOnce();
    expect(request.saveProject).toHaveBeenCalledOnce();expect(request.saveAudit).toHaveBeenCalledWith(result.sourceAudit);
    expect(events).toEqual(["compile","audit","project","saved-audit"]);
    expect(result.project.sources["Counter.sol"].content).toBe(code);expect(result.launchReady).toBe(false);
  });
  it("corrects a concrete reference finding before the single immutable project save",async()=>{
    vi.mocked(sourceFoundation).mockReturnValue({sources:{"Counter.sol":{content:code.replace("= 0","= 2")}},completeReference:true});
    const events:string[]=[],request=input(events);let audits=0;
    const auditSource=vi.fn(async(project:ContractProject)=>{events.push("audit");return audit(project,audits++?[]:[{code:"COUNTER_START",requirementId:"counter",message:"Counter starts at two; the first increment returns three instead of one."}]);});
    const call=vi.fn(async(request:ClaudeInput)=>"properties" in request.schema&&Object.hasOwn(request.schema.properties as object,"steps")
      ?reply({steps:[{path:"Counter.sol",instruction:"Set the counter initial value to zero."}]})
      :reply({reply:"Counter starts at zero.",summary:"Corrected counter",changes:[{path:"Counter.sol",before:"= 2",after:"= 0"}]}));
    const result=await buildGeneralContract({...request,auditSource},undefined,{call,compile:compiled});
    expect(call).toHaveBeenCalledTimes(2);for(const [callInput] of call.mock.calls)expect(callInput.system).toContain("COUNTER_START");
    expect(auditSource).toHaveBeenCalledTimes(2);expect(request.saveProject).toHaveBeenCalledOnce();
    expect(events).toEqual(["audit","project","audit","saved-audit"]);expect(result.sourceAudit?.status).toBe("passed");
    expect(result.project.sources["Counter.sol"].content).toBe(code);
  });
  it("saves only the corrected project when a bounded compiler repair changes its hash",async()=>{
    vi.mocked(sourceFoundation).mockReturnValue({sources:{"Counter.sol":{content:code.replace("= 0","= missing")}},completeReference:true});
    const request=input();let calls=0;
    const call=vi.fn(async()=>calls++?reply({reply:"Repaired initializer.",summary:"Counter starts at zero",changes:[{path:"Counter.sol",before:"missing",after:"0"}]}):reply({steps:[]}));
    const compile=vi.fn(compiled);
    const result=await buildGeneralContract({...request,auditSource:(project:ContractProject)=>audit(project)},undefined,{call,compile});
    expect(call).toHaveBeenCalledTimes(2);expect(compile).toHaveBeenCalledTimes(3);
    expect(request.saveProject).toHaveBeenCalledOnce();expect(request.saveProject.mock.calls[0][0].hash).toBe(result.project.hash);
    expect(result.project.sources["Counter.sol"].content).toBe(code);expect(result.compilation.compiled).toBe(true);
  });
  it("never persists or accepts an audit that belongs to another source hash",async()=>{
    const request=input(),call=vi.fn();
    await expect(buildGeneralContract({...request,auditSource:async project=>({...await audit(project),projectHash:`sha256:${"c".repeat(64)}`})},undefined,{call,compile:compiled}))
      .rejects.toMatchObject({code:"source-audit-incomplete"});
    expect(call).not.toHaveBeenCalled();expect(request.saveProject).not.toHaveBeenCalled();expect(request.saveAudit).not.toHaveBeenCalled();
  });
});
