import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {modelDesignContext,plannerNeedsExecution,planningProductionContext} from "../lib/custom-ai/planning-context";
import {createLaunchProductionContext} from "../lib/custom-ai/launch-production";
import {canonicalGeneralSourceCatalog} from "../lib/custom-ai/canonical-dependencies.server";
import {createContractProject} from "../lib/custom-ai/contract-project";
import {createProjectCompiler} from "../lib/custom-ai/compiler-profile";
import {selectExecutionRoute} from "../lib/custom-ai/execution-routing";
import type {GeneralProjectDraft} from "../lib/custom-ai/general-builder.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
const intent:LaunchIntent={version:1,id:"saved-context",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"counter",text:"Count successful swaps",kind:"behavior",open:null,origin:{kind:"legacy"}},
]};
const path="src/generated/Counter.sol",content="// Keep this developer comment exactly.\npragma solidity 0.8.26; contract Counter { string public label = 'https://example.test/a//b'; }";
function source(edited=false):GeneralProjectDraft{
 const sources=structuredClone(canonicalGeneralSourceCatalog(undefined,8453));sources[path]={content};
 if(edited)sources["lib/v4-core/src/types/PoolKey.sol"].content+="\n// User modification must remain visible.";
 const project=createContractProject({compiler:createProjectCompiler("viair-200-v1","cancun"),sources,entrypoints:[{source:path,contract:"Counter",role:"hook"}]},intent,8453);
 return {version:1,reply:"Saved source",summary:"Saved counter",project,compilation:{version:1,projectHash:project.hash,artifactHash:`sha256:${"b".repeat(64)}`,compiler:project.compiler.version,compiled:true,diagnostics:[],contracts:[],verification:"not-run",launchReady:false},
  selection:selectExecutionRoute(intent,8453,{route:"custom-contract",requirementIds:["counter"],missingCapabilities:[]}),requirementCoverage:"proposed",launchReady:false};
}
describe("saved project context",()=>{
 it("only loads recorded executions for a question about those results",()=>{
  const request=(content:string)=>({intent:"chat" as const,id:"context-size-001",messages:[{role:"user" as const,content}]});
  expect(plannerNeedsExecution(request("Change the project fee to 2% over 24 hours."))).toBe(false);
  expect(plannerNeedsExecution(request("Send 30% to holder rewards."))).toBe(false);
  expect(plannerNeedsExecution(request("Show the recorded simulation results for the holder payouts."))).toBe(true);
 });
 it("keeps policy data in planning without deployment addresses or bytecode bindings",()=>{
  const context=createLaunchProductionContext({version:1,chainId:1,route:"graph-v3",profileVersion:"3.6.0",
   poolManager:{address:`0x${"1".repeat(40)}`,runtimeCodeHash:`0x${"2".repeat(64)}`},executor:{address:`0x${"3".repeat(40)}`,runtimeCodeHash:`0x${"4".repeat(64)}`},
   graphProfile:{},manifestDigest:null,tradeFee:{policyVersion:"test.v1",ratePpm:3000,recipient:`0x${"5".repeat(40)}`,collection:"programmable-routed-native"},protections:null});
  const planning=planningProductionContext(context);
  expect(planning).toMatchObject({chainId:1,tradeFee:{ratePpm:3000}});
  expect(JSON.stringify(planning)).not.toContain("0x");
  expect(context.executor.address).toBe(`0x${"3".repeat(40)}`);
 });
 it("fits canonical code and unchanged custom code without modifying the saved project",()=>{
  const original=source(),before=JSON.stringify(original.project);
  const result=modelDesignContext({generalProject:original,canonicalSources:canonicalGeneralSourceCatalog(original.project,8453)},true);
  expect(result.generalProject?.sources?.[path].content).toBe(content);
  expect(result.generalProject?.dependencyView?.format).toBe("code-without-comments-v1");
  expect(JSON.stringify(result).length).toBeLessThan(120000);
  expect(JSON.stringify(original.project)).toBe(before);
 });
 it("never compacts user changes at a canonical library path",()=>{
  const original=source(true),library="lib/v4-core/src/types/PoolKey.sol";
  const result=modelDesignContext({generalProject:original,canonicalSources:canonicalGeneralSourceCatalog(original.project,8453)},true);
  expect(result.generalProject?.sources?.[library].content).toBe(original.project.sources[library].content);
  expect(result.generalProject?.sources?.[path].content).toBe(content);
 });
 it("keeps ordinary conversation free of source even when canonical libraries are available",()=>{
  const original=source();
  const result=modelDesignContext({generalProject:original,canonicalSources:canonicalGeneralSourceCatalog(original.project,8453)},false);
  expect(result.generalProject?.sourceIncluded).toBe(false);expect(result.generalProject?.sources).toBeUndefined();
 });
});
