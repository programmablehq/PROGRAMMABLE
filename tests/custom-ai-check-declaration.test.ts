import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {declareGeneralChecks} from "../lib/custom-ai/check-declaration.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";
import {ModelResponseError} from "../lib/custom-ai/model-response";

const intent:LaunchIntent={version:1,id:"counter-design",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"counter",kind:"behavior",text:"Anyone can increment from zero by one",open:null,origin:{kind:"legacy"}},
  {id:"no-owner",kind:"constraint",text:"No owner privileges",open:null,origin:{kind:"legacy"}},
]};
const declaration={format:"compact-v1",contracts:[["main","Counter.sol","Counter","auxiliary",[],
  ["function count() view returns(uint256)","function increment()"],false,false,["no-owner"]]],allowedCalls:[]};
const steps=[
  ["zero","main","count()",[],"trader-a",0,"0",true,["counter"],{status:"success",returns:["0"]}],
  ["increment","main","increment()",[],"trader-a",0,"0",false,[],{status:"success"}],
  ["one","main","count()",[],"trader-b",0,"0",true,["counter"],{status:"success",returns:["1"]}],
];
const response=(body:unknown)=>({text:JSON.stringify(body),inputTokens:1,outputTokens:1});
const input={intent,chainId:1 as const,evmVersion:"paris" as const,model:"test-model"};

describe("bounded independent check declaration",()=>{
  it("splits interface and scenarios while retaining complete semantic validation",async()=>{
    const call=vi.fn(async(request:ClaudeInput)=>call.mock.calls.length===1?
      response({generalChecks:JSON.stringify(declaration)}):response({steps:JSON.stringify(steps)}));
    const checked=await declareGeneralChecks(input,call);
    expect(checked.scenarios.steps).toHaveLength(3);
    expect(checked.scenarios.contracts[0].surfaceRequirements).toEqual(["no-owner"]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][0]).toMatchObject({effort:"low",maxTokens:8000});
    expect(call.mock.calls[1][0]).toMatchObject({effort:"medium",maxTokens:12000});
    expect(call.mock.calls[1][0].system).toContain("Counter.sol");
    expect(call.mock.calls.every(([request])=>!request.system.includes("pragma solidity"))).toBe(true);
  });
  it("reuses a matching validated declaration without another paid call",async()=>{
    const build=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}));
    const cached=await declareGeneralChecks(input,build),call=vi.fn();
    expect(await declareGeneralChecks({...input,cached},call)).toEqual(cached);expect(call).not.toHaveBeenCalled();
  });
  it("does not reuse a declaration for another intent or network",async()=>{
    const complete={...declaration,steps},build=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify(complete)}));
    const cached=await declareGeneralChecks(input,build),call=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify(complete)}));
    const changed={...intent,id:"new-counter-design"};
    const result=await declareGeneralChecks({...input,intent:changed,cached},call);
    expect(result.intentId).toBe(changed.id);expect(call).toHaveBeenCalledTimes(1);
    call.mockClear();expect((await declareGeneralChecks({...input,chainId:8453,cached},call)).chainId).toBe(8453);expect(call).toHaveBeenCalledTimes(1);
  });
  it("does not retry a truncated proposal or generate source from it",async()=>{
    const call=vi.fn().mockRejectedValue(new ModelResponseError("output-limit",{inputTokens:2,outputTokens:8000}));
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({failure:"output-limit"});expect(call).toHaveBeenCalledTimes(1);
  });
  it("rejects a combined plan that loses the negative constraint",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=[];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}));
    await expect(declareGeneralChecks(input,call)).rejects.toThrow();
  });
  it("stops before the second call when the owner cancels",async()=>{
    const controller=new AbortController(),call=vi.fn(async()=>{controller.abort();return response({generalChecks:JSON.stringify(declaration)});});
    await expect(declareGeneralChecks({...input,signal:controller.signal},call)).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
  });
});
