import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {modelDesignContext} from "../lib/custom-ai/planning-context";
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
