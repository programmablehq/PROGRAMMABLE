import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import pattern from "../lib/custom-ai/implementation-patterns/base-fee-flow-v1.json";
import nativeFeeSplit from "../lib/custom-ai/implementation-patterns/native-fee-split-v1.json";
import {matchImplementationPattern} from "../lib/custom-ai/implementation-patterns";
import type {GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {sourceFoundation} from "../lib/custom-ai/source-foundation.server";

function fixture(reference:{chainId:number;contracts:typeof pattern.contracts}=pattern){
  const contracts=reference.contracts.map((entry,index)=>({id:entry.id,source:`generated/C${index}.sol`,contract:`Custom${index}`,role:entry.role,
    arguments:Array(entry.argumentCount).fill("0"),functions:[...entry.functions],allowReceive:entry.allowReceive,allowFallback:entry.allowFallback,
    ...("parent" in entry?{parent:entry.parent,nonce:entry.nonce}: {})}));
  const blueprint={chainId:reference.chainId,entrypoints:contracts.map(({source,contract,role})=>({source,contract,role})),scenarios:{contracts:contracts.filter(x=>!("parent" in x)),constructorChildren:contracts.filter(x=>"parent" in x)}} as unknown as GeneralCheckBlueprint;
  return {blueprint,paths:contracts.map(x=>x.source)};
}
describe("editable fee-flow implementation reference",()=>{
 it("matches the smaller plain-token reference and resolves imports after renaming",()=>{
  const {blueprint,paths}=fixture(nativeFeeSplit);
  const reference=sourceFoundation(blueprint,paths,{},[]);
  expect(reference?.completeReference).toBe(true);
  expect(reference?.sources[paths[0]].content).toContain('from "src/launch-protection/ProtectedLaunchTokenV1.sol"');
  expect(reference?.sources[paths[1]].content).toContain('from "generated/C2.sol"');
  expect(reference?.sources[paths[1]].content).not.toContain('.bindHook(address(this))');
  expect(matchImplementationPattern({...blueprint,chainId:8453},paths)).toBeUndefined();
 });
 it("reuses a fee-flow hook when the token is already a pinned canonical component",()=>{
  const {blueprint,paths}=fixture(nativeFeeSplit),token=blueprint.scenarios.contracts[0];
  const editable=paths.filter(path=>path!==token.source),content="pragma solidity 0.8.26; contract PinnedToken {}";
  const canonical={sources:{[token.source]:{content}},references:[{source:token.source,contract:token.contract}]};
  const result=matchImplementationPattern(blueprint,editable,canonical);
  expect(Object.keys(result!)).toEqual(editable);
  expect(result![editable[0]].content).toContain("function executeBuyback");
  expect(result).not.toHaveProperty(token.source);
  expect(matchImplementationPattern(blueprint,editable,{...canonical,references:[]})).toBeUndefined();
 });
 it("reuses the fee-flow code for a smaller interface only as an unfinished edit foundation",()=>{
  const {blueprint,paths}=fixture();
  blueprint.scenarios.contracts[0].functions=blueprint.scenarios.contracts[0].functions.slice(0,20);
  expect(matchImplementationPattern(blueprint,paths)).toBeUndefined();
  const editable=sourceFoundation(blueprint,paths,{},[]);
  expect(editable?.completeReference).toBe(false);
  expect(editable?.sources[paths[1]].content).toContain("function executeBuyback");
  const original=fixture();expect(sourceFoundation(original.blueprint,original.paths,{},[])?.completeReference).toBe(true);
 });
 it("still rejects unknown functions and changed constructor bindings in partial references",()=>{
  const {blueprint,paths}=fixture();
  blueprint.scenarios.contracts[0].functions.push("function withdrawEverything() external");
  expect(matchImplementationPattern(blueprint,paths,undefined,true)).toBeUndefined();
  const moved=fixture();moved.blueprint.scenarios.constructorChildren![0].nonce="5";
  expect(matchImplementationPattern(moved.blueprint,moved.paths,undefined,true)).toBeUndefined();
 });
 it("uses an exact simple token instead of retaining an unwanted holder registry",()=>{
  const {blueprint,paths}=fixture(),token=blueprint.scenarios.contracts[0];
  token.functions=token.functions.slice(0,20);
  const source="canonical/SimpleToken.sol",content="pragma solidity 0.8.26; contract SimpleToken {}";
  const selected=sourceFoundation(blueprint,paths,{[source]:{content}},[{source,contract:"SimpleToken",functions:[...token.functions]}]);
  expect(selected?.completeReference).toBe(false);
  expect(selected?.sources[paths[0]].content).toBe("pragma solidity 0.8.26; contract Custom0 {}");
  expect(selected?.sources[paths[0]].content).not.toContain("bindHook");
 });
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
