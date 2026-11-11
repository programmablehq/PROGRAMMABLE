import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {platformContract,platformContractBlueprint,completeCanonicalContractInterfaces} from "../lib/custom-ai/platform/contract-plan.server";
import {canonicalInterfaceContext} from "../lib/custom-ai/canonical-dependencies.server";
import {projectHash} from "../lib/custom-ai/platform/document";
import type {ProjectRevision} from "../lib/custom-ai/platform/types";
import {compileContractProject} from "../lib/custom-ai/contract-project.server";
import {bindGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {checkGeneralScenarios} from "../lib/custom-ai/behavior-checks.server";

const requirements=[{id:"counter",text:"The counter starts at zero and increments by one",kind:"behavior" as const,open:null,origin:{kind:"legacy" as const}}];
const declared={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function value() view returns (uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],steps:[
 {id:"zero",contract:"main",signature:"value()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["0"]}},
 {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
 {id:"one",contract:"main",signature:"value()",arguments:[],from:"trader-b",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
]};
function revision(files:Record<string,string>={},contractChecks:unknown=declared):ProjectRevision{
 const document={title:"Counter",requirements,files,dependencies:{},architecture:JSON.parse(JSON.stringify({kind:"contract",chainId:1,contractChecks}))};
 return {ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111",revisionId:projectHash(document),parentRevisionId:null,ordinal:1,createdAt:new Date(0).toISOString(),requirementsHash:projectHash(requirements),fileTreeHash:projectHash(files),dependencyLockHash:projectHash({}),architectureHash:projectHash(document.architecture),document};
}
describe("platform contract build plan",()=>{
 it("identifies a reused profile id instead of accepting it as two declared contract ids",()=>{
  const canonical=canonicalInterfaceContext(4663).contracts[0];
  const references=[{entryId:"profile-id",source:canonical.source,contract:canonical.contract},{entryId:"profile-id",source:canonical.source,contract:canonical.contract}];
  const plan={contracts:[{id:"hook",source:"CustomHook.sol",contract:"CustomHook",functions:[]},{id:"token",source:"CustomToken.sol",contract:"CustomToken",functions:[]}]};
  expect(()=>completeCanonicalContractInterfaces(plan,4663,references)).toThrow(/Duplicate entryId.*contractChecks/);
  expect(plan.contracts.every(entry=>entry.functions.length===0)).toBe(true);
 });
 it("explains a missing declared contract id and accepts its exact corrected mapping",()=>{
  const canonical=canonicalInterfaceContext(4663).contracts[0],plan={contracts:[{id:"hook",source:"CustomHook.sol",contract:"CustomHook",functions:[]}]};
  const reference={entryId:"profile-id",source:canonical.source,contract:canonical.contract};
  expect(()=>completeCanonicalContractInterfaces(plan,4663,[reference])).toThrow(/entryId.*contractChecks/);
  const completed=completeCanonicalContractInterfaces(plan,4663,[{...reference,entryId:"hook"}]) as typeof plan;
  expect(completed.contracts[0].functions).toEqual(canonical.functions);
  expect(plan.contracts[0].functions).toEqual([]);
 });
 it("completes only pinned canonical interfaces while preserving every declared behavior expectation",()=>{
  const canonical=canonicalInterfaceContext(4663).contracts[0],input={contracts:[{source:canonical.source,contract:canonical.contract,functions:[]},{source:"Custom.sol",contract:"Custom",functions:["function custom()"]}],steps:[{expect:{status:"success",returns:["7"]},requirementIds:["result"]}]};
  const completed=completeCanonicalContractInterfaces(input,4663) as typeof input;
  expect(completed.contracts[0].functions).toEqual(canonical.functions);expect(completed.contracts[1]).toEqual(input.contracts[1]);expect(completed.steps).toEqual(input.steps);expect(input.contracts[0].functions).toEqual([]);
 });
 it("declares the contract interface and expectations before implementation exists",()=>{
  const empty=platformContractBlueprint(revision());expect(empty.entrypoints).toEqual([{source:"Counter.sol",contract:"Counter",role:"auxiliary"}]);
  const source={"Counter.sol":"pragma solidity 0.8.26; contract Counter { uint public value; function increment() external { value++; } }"};
  const project=platformContract(revision(source));expect(project.compiler).toEqual(empty.compiler);expect(project.entrypoints).toEqual(empty.entrypoints);
  expect(platformContractBlueprint(revision(source)).id).toBe(empty.id);
 });
 it.each([1,4663,8453,999,99901])("keeps the selected supported chain through the contract blueprint and source (%i)",chainId=>{
  const current=revision({"Counter.sol":"pragma solidity 0.8.26; contract Counter { uint public value; function increment() external { value++; } }"});
  (current.document.architecture as {chainId:number}).chainId=chainId;
  expect(platformContractBlueprint(current).chainId).toBe(chainId);
  expect(platformContract(current).chainId).toBe(chainId);
 });
 it("rejects an unknown network before accepting a contract plan",()=>{
  const current=revision();(current.document.architecture as {chainId:number}).chainId=12345;
  expect(()=>platformContractBlueprint(current)).toThrow(/Choose the contract chain/);
 });
 it("rejects missing or incomplete checks instead of compiling an unplanned source",()=>{
  expect(()=>platformContractBlueprint(revision({},null))).toThrow();
  expect(()=>platformContractBlueprint(revision({},{...declared,steps:[]}))).toThrow();
 });
 it("returns the independent declaration diagnostic so the planner can correct an invalid call",()=>{
  const checks=structuredClone(declared);checks.steps[0].signature="missing()";
  expect(()=>platformContractBlueprint(revision({},checks))).toThrow(/Invalid declared calls:/);
 });
 it("uses the same predeclared oracle to reject a wrong implementation on the EVM",async()=>{
  const blueprint=platformContractBlueprint(revision());
  for(const increment of [1,2]){
   const source=platformContract(revision({"Counter.sol":`pragma solidity 0.8.26; contract Counter { uint public value; function increment() external { value+=${increment}; } }`}));
   const compilation=await compileContractProject(source);expect(compilation.compiled).toBe(true);
   const report=await checkGeneralScenarios(source,compilation,bindGeneralCheckBlueprint(blueprint,source));expect(report.passed).toBe(increment===1);
  }
 },60000);
});
