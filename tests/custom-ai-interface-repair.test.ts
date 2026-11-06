import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {repairMalformedInterfaces} from "../lib/custom-ai/interface-repair.server";
import {declareGeneralChecks,GeneralCheckDeclarationError} from "../lib/custom-ai/check-declaration.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import {parseAbi} from "viem";
import {CustomAIError} from "../lib/custom-ai/types";

const bad="function count() view returns (Amount)";
const good="function count() view returns (uint256)";
const increment="function increment()";
const graph={contracts:[{id:"counter",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],
  functions:[increment,bad],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],deployment:{kept:"unchanged"}};
const response=(value:unknown)=>({text:JSON.stringify(value),inputTokens:1,outputTokens:1});
const options={context:"Original counter starts at zero and increments by one.",model:"test-model"};

describe("bounded malformed ABI repair",()=>{
  it("does not spend a model call on valid interfaces",async()=>{
    const valid={...graph,contracts:[{...graph.contracts[0],functions:[increment,good]}]},call=vi.fn();
    expect(await repairMalformedInterfaces(valid,options,call)).toEqual({proposal:valid,corrected:false});
    expect(call).not.toHaveBeenCalled();
  });
  it("repairs an unknown Solidity type without changing valid methods or deployment",async()=>{
    const call=vi.fn().mockResolvedValue(response({changes:[{id:"counter",before:bad,after:good}]}));
    const result=await repairMalformedInterfaces(graph,options,call);
    expect(result.corrected).toBe(true);expect(result.proposal.contracts).toEqual([{...graph.contracts[0],functions:[increment,good]}]);
    expect(result.proposal.deployment).toEqual(graph.deployment);expect(graph.contracts[0].functions).toEqual([increment,bad]);
    expect(call).toHaveBeenCalledOnce();expect(call.mock.calls[0][0]).toMatchObject({task:"declaration-correction",maxTokens:4000});
  });
  it("also repairs a compact saved declaration without losing its graph identity",async()=>{
    const compact={format:"compact-v1",contracts:[["counter","Counter.sol","Counter","auxiliary",[],[increment,bad],false,false,[]]],allowedCalls:[],steps:[]};
    const call=vi.fn().mockResolvedValue(response({changes:[{id:"counter",before:bad,after:good}]}));
    const result=await repairMalformedInterfaces(compact,options,call);
    expect(result.proposal.contracts).toEqual(graph.contracts.map(contract=>({...contract,functions:[increment,good]})));
    expect(result.proposal.steps).toEqual([]);expect(compact.contracts[0][5]).toEqual([increment,bad]);
  });
  it("never rewrites an invalid pinned catalog declaration",async()=>{
    const compact={format:"compact-v1",contracts:[["counter","Counter.sol","Counter","auxiliary",[],{canonical:"PinnedCounter",additional:[]},false,false,[]]],allowedCalls:[],steps:[]};
    const call=vi.fn();
    await expect(repairMalformedInterfaces(compact,{...options,interfaces:[{contract:"PinnedCounter",functions:[bad]}]},call)).rejects.toThrow("could not be decoded");
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    {id:"counter",before:increment,after:"function withdraw()"},
    {id:"other",before:bad,after:good},
    {id:"counter",before:bad,after:"function steal() view returns (uint256)"},
  ])("rejects a replacement outside the malformed method",async change=>{
    const call=vi.fn().mockResolvedValue(response({changes:[change]}));
    await expect(repairMalformedInterfaces(graph,options,call)).rejects.toThrow("original identity");
    expect(call).toHaveBeenCalledOnce();expect(graph.contracts[0].functions).toEqual([increment,bad]);
  });
  it("stops after one correction that still cannot be decoded",async()=>{
    const call=vi.fn().mockResolvedValue(response({changes:[{id:"counter",before:bad,after:"function count() view returns (OtherUnknown)"}]}));
    await expect(repairMalformedInterfaces(graph,options,call)).rejects.toThrow();expect(call).toHaveBeenCalledOnce();
  });
  it("turns parser-specific exceptions into a saved bounded check failure",async()=>{
    const intent:LaunchIntent={version:1,id:"counter",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
      {id:"counter",kind:"behavior",text:"Increment the counter from zero",open:null,origin:{kind:"legacy"}},
    ]};
    const local={...graph};delete (local as Partial<typeof graph>).deployment;
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(local)}))
      .mockRejectedValueOnce(new Error("Unexpected parser-specific error"));
    const error=await declareGeneralChecks({intent,chainId:1,evmVersion:"paris",model:"test-model"},call).catch(error=>error);
    expect(error).toBeInstanceOf(GeneralCheckDeclarationError);
    expect(error.diagnostic.progress.interface).toContain(bad);
    expect(error.diagnostic.failures[0].message).toContain("Unexpected parser-specific error");
    expect(()=>parseAbi([bad])).toThrow();
  });
  it("keeps provider outages distinct from malformed declarations",async()=>{
    const intent:LaunchIntent={version:1,id:"counter",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
      {id:"counter",kind:"behavior",text:"Increment the counter from zero",open:null,origin:{kind:"legacy"}},
    ]};
    const unavailable=new CustomAIError("provider_overloaded","Provider busy",503);
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify({contracts:graph.contracts,allowedCalls:[]})}))
      .mockRejectedValueOnce(unavailable);
    await expect(declareGeneralChecks({intent,chainId:1,evmVersion:"paris",model:"test-model"},call)).rejects.toBe(unavailable);
  });
  it("continues to the original behavior checks after a successful correction",async()=>{
    const intent:LaunchIntent={version:1,id:"counter",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
      {id:"counter",kind:"behavior",text:"Increment the counter from zero",open:null,origin:{kind:"legacy"}},
    ]};
    const local={contracts:graph.contracts,allowedCalls:[]};
    const steps=[{id:"increment",contract:"counter",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
      {id:"read",contract:"counter",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}}];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(local)}))
      .mockResolvedValueOnce(response({changes:[{id:"counter",before:bad,after:good}]}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps),complete:true}));
    const result=await declareGeneralChecks({intent,chainId:1,evmVersion:"paris",model:"test-model"},call);
    expect(result.scenarios.steps).toEqual(steps);expect(result.scenarios.contracts[0].functions).toEqual([increment,good]);
    expect(call.mock.calls.map(([request])=>request.task)).toEqual(["interface","declaration-correction","scenarios"]);
  });
  it("shares the original correction ceiling with later semantic repairs",async()=>{
    const intent:LaunchIntent={version:1,id:"counter",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
      {id:"counter",kind:"behavior",text:"Increment the counter from zero",open:null,origin:{kind:"legacy"}},
      {id:"public",kind:"constraint",text:"No owner controls",open:null,origin:{kind:"legacy"}},
    ]};
    const local={contracts:graph.contracts,allowedCalls:[]};
    const steps=[{id:"increment",contract:"counter",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"}},
      {id:"read",contract:"counter",signature:"count()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:["1"]}}];
    const corrected={...local,contracts:[{...graph.contracts[0],functions:[increment,good],surfaceRequirements:["public"]}],steps};
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(local)}))
      .mockResolvedValueOnce(response({changes:[{id:"counter",before:bad,after:good}]}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps),complete:true}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify(corrected)}));
    const result=await declareGeneralChecks({intent,chainId:1,evmVersion:"paris",model:"test-model"},call);
    expect(result.scenarios.contracts[0].surfaceRequirements).toEqual(["public"]);
    const repairs=call.mock.calls.map(([request])=>request).filter(request=>request.task==="declaration-correction");
    expect(repairs.map(request=>request.maxTokens)).toEqual([4000,4000]);
  });
});
