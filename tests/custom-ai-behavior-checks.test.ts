import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
vi.mock("server-only",()=>({}));
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { createGeneralCheckPlan } from "../lib/custom-ai/behavior-checks";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

afterEach(()=>vi.unstubAllEnvs());
const intent=(rules:{id:string;kind:"behavior"|"constraint";text:string}[]):LaunchIntent=>({version:1,id:"independent-case-fixture",revision:"a".repeat(64),
  requirements:rules.map(rule=>({...rule,open:null,origin:{kind:"legacy"}})),unresolved:[],changes:[]});
const counterIntent=intent([{id:"counter",kind:"behavior",text:"Anyone increments by exactly one, starting from zero"},{id:"no-admin",kind:"constraint",text:"No administrator powers"}]);
function project(body:string,design=counterIntent){return createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},
  sources:{"Fixture.sol":{content:`// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; contract Fixture { ${body} }`}},entrypoints:[{source:"Fixture.sol",contract:"Fixture",role:"auxiliary"}]},design,999);}
const counterBody="uint256 public value; function increment() external { value++; }";
function fixture(functions:string[],surfaceRequirements:string[]=[]){return {id:"main",source:"Fixture.sol",contract:"Fixture",arguments:[],functions,allowReceive:false,allowFallback:false,surfaceRequirements};}
function step(id:string,signature:string,returns:string[],requirementIds:string[],patch:object={}){return {id,contract:"main",signature,arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds,expect:{status:"success",returns},...patch};}
const counterChecks=()=>({contracts:[fixture(["function value() view returns (uint256)","function increment()"],["no-admin"])],allowedCalls:[],steps:[
  step("starts-zero","value()",["0"],["counter"]),
  step("increment-a","increment()",[],[],{read:false,expect:{status:"success"}}),step("read-one","value()",["1"],["counter"]),
  step("increment-creator","increment()",[],[],{from:"creator",read:false,expect:{status:"success"}}),step("read-two","value()",["2"],["counter"],{from:"trader-b"}),
]});
describe("declared general contract checks",()=>{
  it("binds a complete declared oracle to exact saved source without granting launch authority",()=>{
    const source=project(counterBody),plan=createGeneralCheckPlan(counterChecks(),source);
    expect(plan.projectHash).toBe(source.hash);expect(plan.intentRevision).toBe(source.intent.revision);expect(plan).not.toHaveProperty("launchReady");
    expect(createGeneralCheckPlan(counterChecks(),project(counterBody+" // other source")).id).not.toBe(plan.id);
  });
  it("rejects incomplete, command-bearing, unknown-reference and assertion-free plans",()=>{
    const source=project(counterBody);
    for(const mutate of [
      (p:ReturnType<typeof counterChecks>)=>({...p,command:"node anything"}),
      (p:ReturnType<typeof counterChecks>)=>({...p,contracts:[{...p.contracts[0],surfaceRequirements:[]}]}),
      (p:ReturnType<typeof counterChecks>)=>({...p,steps:[step("no-proof","increment()",[],["counter"],{read:false,expect:{status:"success"}})]}),
      (p:ReturnType<typeof counterChecks>)=>({...p,allowedCalls:[{contract:"unknown"}]}),
      (p:ReturnType<typeof counterChecks>)=>({...p,allowedCalls:["0x4000000000000000000000000000000000000004"]}),
    ])expect(()=>createGeneralCheckPlan(mutate(counterChecks()),source)).toThrow();
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("exact general source in the existing networkless EVM",{timeout:60_000},()=>{
  it("executes state changes from different callers and never claims a public launch",async()=>{
    const source=project(counterBody),compiled=await compileContractProject(source),plan=createGeneralCheckPlan(counterChecks(),source);
    const report=await checkGeneralScenarios(source,compiled,plan);
    expect(report).toMatchObject({passed:true,cases:7,scope:"isolated-declared-scenarios-v1",projectHash:source.hash,artifactHash:compiled.artifactHash,planHash:plan.id,launchReady:false});
    expect(report.failures).toEqual([]);expect(BigInt(report.gasUsed)).toBeGreaterThan(0n);
    expect(report.execution).toMatchObject({environment:"isolated-declared-fixtures",networkAccess:false,gasFeesCharged:false,plannedSteps:5,executedSteps:5,detailsComplete:true});
    expect(report.execution?.steps.filter(step=>step.read).map(step=>step.outputs[0].value)).toEqual(["0","1","2"]);
    const changed={...plan,intentRevision:"b".repeat(64)};
    await expect(checkGeneralScenarios(source,compiled,changed)).rejects.toMatchObject({code:"behavior-context"});
    const {artifactHash:discarded,...otherCompiler}={...compiled,compiler:"unbound-compiler"};void discarded;
    const forged={...otherCompiler,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",otherCompiler)};
    await expect(checkGeneralScenarios(source,forged,plan)).rejects.toMatchObject({code:"behavior-context"});
    const stop=new AbortController();stop.abort();await expect(checkGeneralScenarios(source,compiled,plan,stop.signal)).rejects.toThrow();
  });
  it("detects an extra administrator entry point in the actual compiled interface",async()=>{
    const source=project(counterBody+" function seize() external {}"),compiled=await compileContractProject(source);
    const report=await checkGeneralScenarios(source,compiled,createGeneralCheckPlan(counterChecks(),source));
    expect(report.passed).toBe(false);expect(report.failures[0].code).toBe("unexpected-interface");expect(report.launchReady).toBe(false);
  });
  it("detects an administrator-only restriction hidden inside an otherwise matching interface",async()=>{
    const source=project("uint256 public value; function increment() external { require(msg.sender==address(0x1000000000000000000000000000000000000001));value++; }"),compiled=await compileContractProject(source);
    const report=await checkGeneralScenarios(source,compiled,createGeneralCheckPlan(counterChecks(),source));
    expect(report.passed).toBe(false);expect(report.failures[0].code).toBe("execution-status");
  });
  it("detects a wrong fee from a source-independent expected value",async()=>{
    const design=intent([{id:"fees",kind:"behavior",text:"The total fee is exactly ten percent, represented as1000 basis points"}]);
    const declared={contracts:[fixture(["function fee() pure returns (uint256)"])],allowedCalls:[],steps:[step("exact-fee","fee()",["1000"],["fees"])]};
    for(const [rate,passed] of [[1000,true],[900,false]] as const){
      const source=project(`function fee() external pure returns(uint256){return ${rate};}`,design),compiled=await compileContractProject(source);
      const report=await checkGeneralScenarios(source,compiled,createGeneralCheckPlan(declared,source));
      expect(report.passed).toBe(passed);if(!passed)expect(report.failures[0].code).toBe("return-value");
      expect(report.execution?.steps[0].outputs[0].value).toBe(String(rate));
    }
  });
  it("detects a hidden payment recipient even when a public getter tells the expected story",async()=>{
    const design=intent([{id:"recipient",kind:"behavior",text:"Payments go only to the declared creator"}]);
    const declared={contracts:[fixture(["function recipient() pure returns (address)","function pay() payable"])],allowedCalls:[{account:"creator"}],steps:[
      {...step("creator-getter","recipient()",[],["recipient"]),expect:{status:"success",returns:[{account:"creator"}]}},
      step("payment","pay()",[],[],{read:false,value:"1000",expect:{status:"success"}}),
    ]};
    for(const [recipient,passed] of [["0x1000000000000000000000000000000000000001",true],["0x4000000000000000000000000000000000000004",false]] as const){
      const source=project(`function recipient() external pure returns(address){return address(0x1000000000000000000000000000000000000001);} function pay() external payable {(bool ok,)=payable(address(${recipient})).call{value:msg.value}(\"\");require(ok);}`,design),compiled=await compileContractProject(source);
      const report=await checkGeneralScenarios(source,compiled,createGeneralCheckPlan(declared,source));
      expect(report.passed).toBe(passed);if(!passed)expect(report.failures.some(failure=>failure.code==="unexpected-call")).toBe(true);
      if(passed)expect(report.execution?.steps[1].nativeChanges.map(change=>[change.account,BigInt(change.after)-BigInt(change.before)])).toEqual([
        ["account/creator",1000n],["account/trader-a",-1000n],
      ]);
    }
  });
  it("keeps worker outages separate from a failed contract assertion",async()=>{
    const source=project(counterBody),compiled=await compileContractProject(source),plan=createGeneralCheckPlan(counterChecks(),source);
    vi.stubEnv("CUSTOM_AI_COMPILER_DIR",join(process.cwd(),"scripts/custom-ai/toolchain-missing"));
    await expect(checkGeneralScenarios(source,compiled,plan)).rejects.toMatchObject({code:"behavior-worker",status:503});
  });
  it("does not label an unsupported or malformed execution example as a contract defect",async()=>{
    const source=project(counterBody),compiled=await compileContractProject(source),raw=counterChecks();
    const declared=createGeneralCheckPlan({...raw,steps:raw.steps.map((step,index)=>index===1?{...step,arguments:["unexpected argument"]}:step)},source);
    await expect(checkGeneralScenarios(source,compiled,declared)).rejects.toMatchObject({code:"behavior-fixture",status:503});
  });
});
