import {describe,it,expect} from "vitest";
import pattern from "../lib/custom-ai/implementation-patterns/base-fee-flow-v1.json";
import {matchImplementationPattern} from "../lib/custom-ai/implementation-patterns";
import type {GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";

function fixture(){
  const contracts=pattern.contracts.map((entry,index)=>({id:entry.id,source:`generated/C${index}.sol`,contract:`Custom${index}`,role:entry.role,
    arguments:Array(entry.argumentCount).fill("0"),functions:entry.functions,allowReceive:entry.allowReceive,allowFallback:entry.allowFallback,
    ...("parent" in entry?{parent:entry.parent,nonce:entry.nonce}: {})}));
  const blueprint={chainId:8453,entrypoints:contracts.map(({source,contract,role})=>({source,contract,role})),scenarios:{contracts:contracts.filter(x=>!("parent" in x)),constructorChildren:contracts.filter(x=>"parent" in x)}} as unknown as GeneralCheckBlueprint;
  return {blueprint,paths:contracts.map(x=>x.source)};
}
describe("editable fee-flow implementation reference",()=>{
 it("rebinds all source paths and contract references together",()=>{
  const {blueprint,paths}=fixture(),sources=matchImplementationPattern(blueprint,paths)!;
  expect(Object.keys(sources)).toEqual(paths);
  for(const [index,path] of paths.entries())expect(sources[path].content).toContain(`contract Custom${index}`);
  expect(sources[paths[1]].content).toContain('from "generated/C2.sol"');
 });
 it("requires the original constructor graph, complete interfaces and qualified network",()=>{
  const {blueprint,paths}=fixture();
  expect(matchImplementationPattern({...blueprint,chainId:1},paths)).toBeUndefined();
  const moved=structuredClone(blueprint);moved.scenarios.constructorChildren![0].nonce="5";
  expect(matchImplementationPattern(moved,paths)).toBeUndefined();
  const missing=structuredClone(blueprint);missing.scenarios.contracts[0].functions=[];
  expect(matchImplementationPattern(missing,paths)).toBeUndefined();
  const wrongRole=structuredClone(blueprint);wrongRole.entrypoints[0].role="auxiliary";
  expect(matchImplementationPattern(wrongRole,paths)).toBeUndefined();
  const wrongReceive=structuredClone(blueprint);wrongReceive.scenarios.constructorChildren![0].allowReceive=true;
  expect(matchImplementationPattern(wrongReceive,paths)).toBeUndefined();
  const wrongFallback=structuredClone(blueprint);wrongFallback.scenarios.contracts[0].allowFallback=true;
  expect(matchImplementationPattern(wrongFallback,paths)).toBeUndefined();
  const additionalFunction=structuredClone(blueprint);additionalFunction.scenarios.contracts[0].functions.push("function extra() view returns(uint256)");
  expect(matchImplementationPattern(additionalFunction,paths)).toBeUndefined();
 });
 it("matches equivalent ABI spelling while keeping return types and mutability exact",()=>{
  const {blueprint,paths}=fixture();
  for(const target of [...blueprint.scenarios.contracts,...blueprint.scenarios.constructorChildren!])target.functions=target.functions.map(fn=>fn.replaceAll("returns(","returns ("));
  const token=blueprint.scenarios.contracts[0];
  token.functions=token.functions.map(fn=>fn.startsWith("function transfer(")?"function transfer(address to, uint256 amount) returns (bool success)":fn);
  expect(matchImplementationPattern(blueprint,paths)).toBeDefined();
  token.functions=token.functions.map(fn=>fn.startsWith("function transfer(")?"function transfer(address to, uint256 amount) returns (uint256)":fn);
  expect(matchImplementationPattern(blueprint,paths)).toBeUndefined();
  const changed=fixture();changed.blueprint.scenarios.contracts[0].functions=changed.blueprint.scenarios.contracts[0].functions.map(fn=>fn.replace(" view "," pure "));
  expect(matchImplementationPattern(changed.blueprint,changed.paths)).toBeUndefined();
 });
});
