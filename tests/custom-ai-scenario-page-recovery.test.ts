import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {scenarioSchemaForInterface,nativeScenarioRows} from "../lib/custom-ai/check-stage-wire";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
import {declareGeneralChecks} from "../lib/custom-ai/check-declaration.server";
import {checkContextHash,type CheckDiagnostic} from "../lib/custom-ai/check-diagnostic";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";

const intent:LaunchIntent={version:1,id:"counter-design",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"counter",kind:"behavior",text:"Anyone can increment from zero by one",open:null,origin:{kind:"legacy"}},
  {id:"no-owner",kind:"constraint",text:"No owner privileges",open:null,origin:{kind:"legacy"}},
]};
const declaration={format:"compact-v1",contracts:[["main","Counter.sol","Counter","auxiliary",[],["function count() view returns(uint256)","function increment()"],false,false,["no-owner"]]],allowedCalls:[]};
const fixed={contracts:[{id:"main",functions:["function count() view returns(uint256)","function increment()"]}]};
const row={id:"one",call:"main:count()",argumentsJson:"[]",from:"trader-b",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],
  expect:{status:"success",returnsJson:'["1"]',swapFeePpm:null,events:[]}};
const first=[
  ["zero","main","count()",[],"trader-a",0,"0",true,["counter"],{status:"success",returns:["0"]}],
  ["increment","main","increment()",[],"trader-a",0,"0",false,[],{status:"success"}],
];
const input={intent,chainId:1 as const,evmVersion:"paris" as const,model:"test-model"};
const decode=(page:unknown)=>JSON.parse(prepareSurplusSchema(scenarioSchemaForInterface(fixed),true).decode(JSON.stringify(page)));
describe("lossless scenario page transport and recovery",()=>{
  it("validates named and compact rows against the same function and value schema",()=>{
    const compact=[row.id,row.call,row.argumentsJson,row.from,row.afterSeconds,row.value,row.read,row.requirementIds,row.expect];
    const a=decode({steps:[row],complete:true}),b=decode({steps:[compact],complete:true});
    expect(nativeScenarioRows(a.steps)).toEqual(nativeScenarioRows(b.steps));
  });
  it.each([
    {...row,call:"main:steal()"}, {...row,from:"administrator"}, {...row,afterSeconds:"0"}, {...row,extra:"ignored"},
  ])("does not relax semantic input fields while accepting named rows",bad=>{
    expect(()=>decode({steps:[bad],complete:true})).toThrow();
  });
  it("recovers a complete matching page without paying for another model request",async()=>{
    const rejected:CheckDiagnostic={version:1,contextHash:checkContextHash(input),failures:[
      {stage:"scenarios",message:"Response used complete named fields",declaration:null,response:JSON.stringify({steps:[row],complete:true})},
    ],progress:{interface:JSON.stringify(declaration),steps:first}};
    const call=vi.fn(),result=await declareGeneralChecks({...input,rejected},call);
    expect(call).not.toHaveBeenCalled();expect(result.scenarios.steps.map(step=>step.id)).toEqual(["zero","increment","one"]);
    expect(result.scenarios.steps.at(-1)?.expect).toEqual({status:"success",returns:["1"]});
  });
  it("never appends a page already included in a rejected complete declaration",async()=>{
    const all=[...first, ["one","main","count()",[],"trader-b",0,"0",true,["counter"],{status:"success",returns:["1"]}]];
    const rejected:CheckDiagnostic={version:1,contextHash:checkContextHash(input),failures:[
      {stage:"scenarios",message:"Prior semantic rejection",declaration:JSON.stringify({...declaration,steps:all}),response:JSON.stringify({steps:[row],complete:true})},
    ],progress:{interface:JSON.stringify(declaration),steps:all}};
    const call=vi.fn().mockResolvedValue({text:JSON.stringify({steps:[],complete:true}),inputTokens:1,outputTokens:1});
    const result=await declareGeneralChecks({...input,rejected},call);
    expect(call).not.toHaveBeenCalled();expect(result.scenarios.steps.map(step=>step.id)).toEqual(["zero","increment","one"]);
  });
});
