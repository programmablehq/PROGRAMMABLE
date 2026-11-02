import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {declareGeneralChecks} from "../lib/custom-ai/check-declaration.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";
import {ModelResponseError} from "../lib/custom-ai/model-response";
import type {CheckDiagnostic} from "../lib/custom-ai/check-diagnostic";

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
    expect(call.mock.calls[1][0]).toMatchObject({effort:"low",maxTokens:4000});
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
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({stage:"interface",reason:"output-limit"});expect(call).toHaveBeenCalledTimes(1);
  });
  it("accepts canonical interface objects and compact steps without losing semantic checks",async()=>{
    const [id,source,contract,role,args,functions,allowReceive,allowFallback,surfaceRequirements]=declaration.contracts[0];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify({contracts:[{id,source,contract,role,arguments:args,functions,allowReceive,allowFallback,surfaceRequirements}],allowedCalls:[]})}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps)}));
    const checked=await declareGeneralChecks(input,call);
    expect(checked.scenarios.steps).toHaveLength(3);expect(checked.scenarios.contracts[0].surfaceRequirements).toEqual(["no-owner"]);
  });
  it("reports which stage rejected an invalid declaration without including model source",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)})).mockResolvedValueOnce(response({steps:'invalid json'}));
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({stage:"scenarios",reason:"invalid-json"});
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("corrects an invalid declaration once without changing the saved intent",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=[];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify({...declaration,steps})}));
    const checked=await declareGeneralChecks(input,call);
    expect(checked.scenarios.contracts[0].surfaceRequirements).toEqual(["no-owner"]);
    expect(checked.intentRevision).toBe(intent.revision);expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2][0]).toMatchObject({maxTokens:16000,responseProfile:"contract"});
    expect(call.mock.calls[2][0].system).toContain("missing-requirements:no-owner");
    expect(call.mock.calls[2][0].system).toContain("There is still no generated implementation");
  });
  it("stops after one rejected correction and never weakens negative-constraint coverage",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=[];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify({...partial,steps})}));
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({stage:"scenarios",reason:"correction-rejected"});
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("identifies a behavior incorrectly used as a surface constraint",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=["counter","no-owner"];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify({...declaration,steps})}));
    await declareGeneralChecks(input,call);
    expect(call.mock.calls[2][0].system).toContain("surface-requirements-only-accept-constraints-use-a-step-for-other-rules");
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("does not retry a provider failure during the bounded correction",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=[];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)})).mockResolvedValueOnce(response({steps:JSON.stringify(steps)}))
      .mockRejectedValueOnce(new ModelResponseError("timeout",{inputTokens:2,outputTokens:8000}));
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({stage:"scenarios",reason:"timeout"});
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("retains exact private validator feedback and repairs the same rejected plan with only one new call",async()=>{
    const invalid=structuredClone(declaration);invalid.contracts[0][8]=[];
    const failed=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(invalid)}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps)}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify({...invalid,steps})}));
    const error=await declareGeneralChecks(input,failed).catch(error=>error);
    expect(error).toMatchObject({reason:"correction-rejected",diagnostic:{version:1}});
    const rejected=error.diagnostic as CheckDiagnostic;
    expect(rejected.failures).toHaveLength(2);
    expect(rejected.failures[1].message).toContain("missing-requirements:no-owner");
    const repair=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify({...declaration,steps})}));
    const result=await declareGeneralChecks({...input,rejected},repair);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][0]).toMatchObject({task:"declaration-correction"});
    expect(result.intentRevision).toBe(intent.revision);
    expect(result.scenarios.contracts[0].surfaceRequirements).toEqual(["no-owner"]);
    const other=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify({...declaration,steps})}));
    await declareGeneralChecks({...input,chainId:999,rejected},other);
    expect(other.mock.calls[0][0]).toMatchObject({task:"interface"});
    const changed=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify({...declaration,steps})}));
    await declareGeneralChecks({...input,intent:{...intent,revision:"b".repeat(64)},rejected},changed);
    expect(changed.mock.calls[0][0]).toMatchObject({task:"interface"});
  });
  it("stops before the second call when the owner cancels",async()=>{
    const controller=new AbortController(),call=vi.fn(async()=>{controller.abort();return response({generalChecks:JSON.stringify(declaration)});});
    await expect(declareGeneralChecks({...input,signal:controller.signal},call)).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
  });
  it("joins bounded pages in order and validates every saved rule only after the final page",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps.slice(0,2)),complete:false}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps.slice(2)),complete:true}));
    const checked=await declareGeneralChecks(input,call);
    expect(checked.scenarios.steps.map(step=>step.id)).toEqual(["zero","increment","one"]);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2][0].system).toContain(JSON.stringify(steps.slice(0,2)));
    expect(call.mock.calls.slice(1).every(([request])=>request.maxTokens===4000)).toBe(true);
    expect(checked.scenarios.contracts[0].surfaceRequirements).toEqual(["no-owner"]);
  });
  it("stops at the original total scenario output ceiling and saves reusable partial work",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)}));
    for(let i=0;i<3;i++)call.mockResolvedValueOnce(response({steps:JSON.stringify([[`read-${i}`,"main","count()",[],"trader-a",i,"0",true,["counter"],{status:"success",returns:["0"]}]]),complete:false}));
    const error=await declareGeneralChecks(input,call).catch(error=>error);
    expect(error).toMatchObject({stage:"scenarios",reason:"scenario-page-budget",diagnostic:{progress:{steps:expect.any(Array)}}});
    expect(error.diagnostic.progress.steps).toHaveLength(3);
    expect(call).toHaveBeenCalledTimes(4);
    expect(call.mock.calls.slice(1).reduce((sum,[request])=>sum+request.maxTokens,0)).toBe(12000);
  });
  it("reuses a completed interface and earlier pages after a provider interruption",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps.slice(0,2)),complete:false}))
      .mockRejectedValueOnce(new ModelResponseError("output-limit",{inputTokens:100,outputTokens:4000}));
    const error=await declareGeneralChecks(input,call).catch(error=>error);
    expect(error).toMatchObject({reason:"output-limit",diagnostic:{progress:{steps:steps.slice(0,2)}}});
    const resume=vi.fn().mockResolvedValue(response({steps:JSON.stringify(steps.slice(2)),complete:true}));
    const checked=await declareGeneralChecks({...input,rejected:error.diagnostic},resume);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume.mock.calls[0][0].task).toBe("scenarios");
    expect(checked.scenarios.steps).toHaveLength(3);
    const changed=vi.fn().mockResolvedValue(response({generalChecks:JSON.stringify({...declaration,steps})}));
    await declareGeneralChecks({...input,chainId:999,rejected:error.diagnostic},changed);
    expect(changed.mock.calls[0][0].task).toBe("interface");
  });
  it("cannot hide missing constraints behind a complete page flag",async()=>{
    const partial=structuredClone(declaration);partial.contracts[0][8]=[];
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(partial)}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps),complete:true}))
      .mockResolvedValueOnce(response({generalChecks:JSON.stringify({...partial,steps})}));
    await expect(declareGeneralChecks(input,call)).rejects.toMatchObject({reason:"correction-rejected"});
    expect(call.mock.calls[2][0].system).toContain("missing-requirements:no-owner");
  });
  it("does not repeat the entire dependency catalog in every scenario page",async()=>{
    const interfaces={id:`sha256:${"a".repeat(64)}`,contracts:[{contract:"UnusedDependency",functions:["function unusedMarker()"]}]} as never;
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(declaration)}))
      .mockResolvedValueOnce(response({steps:JSON.stringify(steps),complete:true}));
    await declareGeneralChecks({...input,interfaces},call);
    expect(call.mock.calls[0][0].system).toContain("UnusedDependency");
    expect(call.mock.calls[1][0].system).not.toContain("UnusedDependency");
    expect(call.mock.calls[1][0].system).toContain("function increment()");
  });
});
