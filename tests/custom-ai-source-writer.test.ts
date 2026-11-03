import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {writeSourceParts,SourceProgressPending} from "../lib/custom-ai/source-writer.server";
import {checkedSourceProgress,sourceProgressExtends,type SourceProgress} from "../lib/custom-ai/source-progress";
import {ModelResponseError} from "../lib/custom-ai/model-response";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";
const hash=`sha256:${"a".repeat(64)}` as const;
const request:ClaudeInput={model:"local-fixture",system:"frozen intent",messages:[{role:"user",content:"build"}],schema:{},maxTokens:16000};
function response(path:string){return {text:JSON.stringify({reply:"Written.",summary:"Complete file",sourceFiles:[{path,content:`pragma solidity 0.8.26; contract ${path[0]} {}`}]}),inputTokens:10,outputTokens:100};}
describe("bounded source parts",()=>{
 it("checkpoints complete files without multiplying the output budget",async()=>{
  const saved:SourceProgress[]=[];let index=0;const paths=["A.sol","B.sol","C.sol"];
  const calls:ClaudeInput[]=[];
  const output=await writeSourceParts({request,paths,contextHash:hash,save:async p=>{saved.push(p);}},async call=>{calls.push(call);return response(paths[index++]);});
  expect(Object.keys(saved.at(-1)!.files)).toEqual(paths);
  expect(JSON.parse(output.text).sourceFiles).toHaveLength(3);
  let budget=16000;for(const c of calls){expect(c.maxTokens).toBeLessThanOrEqual(budget);budget-=100;}
 });
 it("fits two reasoning-enabled contract sections inside one shared build budget",async()=>{
  const paths=["A.sol","B.sol"],calls:ClaudeInput[]=[];let next=0;
  const result=await writeSourceParts({request,paths,contextHash:hash,save:async()=>{}},async input=>{
   calls.push(input);expect(input.maxTokens).toBeGreaterThanOrEqual(7000);
   return {...response(paths[next++]),outputTokens:7000};
  });
  expect(result.outputTokens).toBe(14000);expect(calls).toHaveLength(2);
  expect(JSON.parse(result.text).sourceFiles.map((file:{path:string})=>file.path)).toEqual(paths);
 });
 it("continues saved work without regenerating the completed file",async()=>{
  let saved:SourceProgress|undefined;let calls=0;
  await expect(writeSourceParts({request,paths:["A.sol","B.sol"],contextHash:hash,save:async p=>{saved=p;}},async()=>{
   if(calls++)throw new ModelResponseError("output-limit",{inputTokens:1,outputTokens:100});return response("A.sol");
  })).rejects.toBeInstanceOf(SourceProgressPending);
  const resumed=vi.fn(async()=>response("B.sol"));
  const output=await writeSourceParts({request,paths:["A.sol","B.sol"],contextHash:hash,cached:saved,save:async()=>{}},resumed);
  expect(resumed).toHaveBeenCalledOnce();expect(JSON.parse(output.text).sourceFiles.map((f:{path:string})=>f.path)).toEqual(["A.sol","B.sol"]);
 });
 it("keeps an empty provider interruption at the source stage without inventing saved code or retrying",async()=>{
  const save=vi.fn(),call=vi.fn(async()=>{throw new ModelResponseError("output-limit",{inputTokens:100,outputTokens:16000});});
  await expect(writeSourceParts({request,paths:["A.sol"],contextHash:hash,save},call))
   .rejects.toMatchObject({code:"source-pending",completed:0,total:1,hasProgress:false,reason:"output-limit"});
  expect(call).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
 });
 it("saves a large hook in ordered sections within one shared budget",async()=>{
  let index=0;const paths=["A.sol","B.sol"],costs=[6_000,4_000,1_000],saved:SourceProgress[]=[];
  const output=await writeSourceParts({request,paths,contextHash:hash,save:async p=>{saved.push(p);}},async input=>{
   const cost=costs[index],part=index++;
   if(input.maxTokens<cost)throw new ModelResponseError("output-limit",{inputTokens:1,outputTokens:input.maxTokens});
   return {text:JSON.stringify({reply:"Written",summary:"A and B",sourceFiles:[{path:part<2?"A.sol":"B.sol",content:part===0?"contract A {":part===1?"}":"contract B {}",complete:part!==0}]}),inputTokens:1,outputTokens:cost};
  });
  expect(output.outputTokens).toBe(11_000);expect(Object.keys(saved.at(-1)!.files)).toEqual(paths);
  expect(saved[0].files).toEqual({});expect(saved[0].partial?.content).toBe("contract A {");
  expect(JSON.parse(output.text).sourceFiles[0].content).toBe("contract A {}");
 });
 it("resumes the first large file after interruption without treating the prefix as complete source",async()=>{
  let saved:SourceProgress|undefined;let n=0;
  await expect(writeSourceParts({request,paths:["A.sol"],contextHash:hash,save:async p=>{saved=p;}},async()=>{
   if(n++)throw new ModelResponseError("output-limit",{inputTokens:1,outputTokens:8000});
   return {text:JSON.stringify({reply:"Writing",summary:"A",sourceFiles:[{path:"A.sol",content:"contract A {",complete:false}]}),inputTokens:1,outputTokens:5000};
  })).rejects.toBeInstanceOf(SourceProgressPending);
  expect(saved?.files).toEqual({});
  const call=vi.fn(async(input:ClaudeInput)=>{
   expect(input.system).toContain('contract A {');
   return {text:JSON.stringify({reply:"Written",summary:"A",sourceFiles:[{path:"A.sol",content:"}",complete:true}]}),inputTokens:1,outputTokens:10};
  });
  const value=await writeSourceParts({request,paths:["A.sol"],contextHash:hash,cached:saved,save:async()=>{}},call);
  expect(JSON.parse(value.text).sourceFiles[0].content).toBe("contract A {}");expect(call).toHaveBeenCalledOnce();
 });
 it("does not replace a saved prefix or expose it as a complete file",()=>{
  const before:SourceProgress={version:1,contextHash:hash,files:{},reply:"Writing",summary:"A",partial:{path:"A.sol",content:"contract A {",parts:1}};
  expect(sourceProgressExtends(before,{...before,partial:{path:"A.sol",content:"contract B {",parts:2}})).toBe(false);
  expect(sourceProgressExtends(before,{version:1,contextHash:hash,files:{"A.sol":{content:"contract A {}"}},reply:"Done",summary:"A"})).toBe(true);
  expect(()=>checkedSourceProgress({...before,files:{"A.sol":{content:"contract A {}"}}})).toThrow();
 });
 it("rejects a stale context, extra source path and mutable checkpoint",()=>{
  const p:SourceProgress={version:1,contextHash:hash,files:{"A.sol":{content:"contract A {}"}},reply:"Done",summary:"A"};
  expect(()=>checkedSourceProgress(p,`sha256:${"b".repeat(64)}`)).toThrow();
  expect(()=>checkedSourceProgress(p,hash,["B.sol"])).toThrow();
  expect(()=>checkedSourceProgress({...p,files:{"../A.sol":{content:"x"}}})).toThrow();
 });
 it("does not call the model again when every exact file is already saved",async()=>{
  const call=vi.fn();const saved:SourceProgress={version:1,contextHash:hash,files:{"A.sol":{content:"contract A {}"}},reply:"Done",summary:"A"};
  await writeSourceParts({request,paths:["A.sol"],contextHash:hash,cached:saved,save:async()=>{}},call);
  expect(call).not.toHaveBeenCalled();
 });
});
