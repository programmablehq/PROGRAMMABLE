import { describe, expect, it } from "vitest";
import { bindGeneralCheckBlueprint, checkedGeneralCheckBlueprint, createGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent:LaunchIntent={version:1,id:"counter-design",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
  {id:"counter",text:"Anyone increments by exactly one, starting from zero",kind:"behavior",open:null,origin:{kind:"legacy"}},
  {id:"no-admin",text:"No administrator powers",kind:"constraint",open:null,origin:{kind:"legacy"}},
]};
const declared=()=>({contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],
  functions:["function value() view returns (uint256)","function increment()"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-admin"]}],allowedCalls:[],steps:[
  {id:"starts-zero",contract:"main",signature:"value()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["0"]}},
  {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
  {id:"one",contract:"main",signature:"value()",arguments:[],from:"trader-b",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}},
]});
const project=(increment=1)=>createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},
  sources:{"Counter.sol":{content:`pragma solidity 0.8.26; contract Counter { uint public value; function increment() external { value+=${increment}; } }`}},
  entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}]},intent,999);

describe("the source-independent general scenario blueprint",()=>{
  it("is defined without implementation source and binds the same oracle to different implementations",()=>{
    const raw=declared(),blueprint=createGeneralCheckBlueprint(raw,intent,999,"cancun");
    expect(blueprint).not.toHaveProperty("sources");expect(blueprint).not.toHaveProperty("projectHash");expect(blueprint).not.toHaveProperty("launchReady");
    const correct=bindGeneralCheckBlueprint(blueprint,project()),wrong=bindGeneralCheckBlueprint(blueprint,project(2));
    expect(correct.steps).toEqual(wrong.steps);expect(correct.projectHash).not.toBe(wrong.projectHash);expect(correct.id).not.toBe(wrong.id);
    raw.steps[2].expect.returns![0]="2";expect(blueprint.scenarios.steps[2].expect.returns).toEqual(["1"]);
  });
  it("accepts reordered JSON object keys from durable storage while rejecting changed or extra metadata",()=>{
    const blueprint=createGeneralCheckBlueprint(declared(),intent,999,"cancun");
    const reordered=JSON.parse(JSON.stringify(blueprint,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
    expect(checkedGeneralCheckBlueprint(reordered,intent)).toEqual(blueprint);
    expect(bindGeneralCheckBlueprint(reordered,project()).steps).toHaveLength(3);
    for(const changed of [{...blueprint,chainId:1},{...blueprint,compiler:{...blueprint.compiler,evmVersion:"paris"}},{...blueprint,extra:true}]){
      expect(()=>checkedGeneralCheckBlueprint(changed as typeof blueprint,intent)).toThrow();
    }
    expect(()=>checkedGeneralCheckBlueprint(blueprint,{...intent,revision:"b".repeat(64)})).toThrow();
  });
  it("does not let generated sources change the planned role, target, entrypoint or requirement set",()=>{
    const blueprint=createGeneralCheckBlueprint(declared(),intent,999,"cancun"),source=project();
    for(const change of [{chainId:1 as const},{compiler:{...source.compiler,evmVersion:"paris" as const}},{entrypoints:[{...source.entrypoints[0],role:"token" as const}]},
      {intent:{...intent,requirements:intent.requirements.slice(0,1),revision:"b".repeat(64)}}]){
      const altered=createContractProject({compiler:change.compiler??source.compiler,sources:source.sources,entrypoints:change.entrypoints??source.entrypoints},change.intent??intent,change.chainId??999);
      expect(()=>bindGeneralCheckBlueprint(blueprint,altered)).toThrow();
    }
    expect(()=>checkedGeneralCheckBlueprint(blueprint,{...intent,requirements:intent.requirements.map(rule=>({...rule,text:rule.text+" changed"}))})).toThrow();
    expect(()=>createGeneralCheckBlueprint({...declared(),contracts:[{...declared().contracts[0],source:"../../secret.sol"}]},intent,999,"cancun")).toThrow();
    expect(()=>createGeneralCheckBlueprint({...declared(),contracts:[{...declared().contracts[0],role:"admin"}]},intent,999,"cancun")).toThrow();
  });
  it("requires complete observable expectations and resolved intent before code generation",()=>{
    expect(()=>createGeneralCheckBlueprint({...declared(),steps:[]},intent,999,"cancun")).toThrow();
    expect(()=>createGeneralCheckBlueprint({...declared(),contracts:[{...declared().contracts[0],surfaceRequirements:[]}]},intent,999,"cancun")).toThrow();
    expect(()=>createGeneralCheckBlueprint(declared(),{...intent,unresolved:["Choose a recipient"]},999,"cancun")).toThrow();
    expect(()=>createGeneralCheckBlueprint({...declared(),command:"external script"},intent,999,"cancun")).toThrow();
  });
});
