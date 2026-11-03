import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {writeSourceParts,SourceProgressPending} from "../lib/custom-ai/source-writer.server";
import {checkedSourceProgress,type SourceProgress} from "../lib/custom-ai/source-progress";
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
 it("continues saved work without regenerating the completed file",async()=>{
  let saved:SourceProgress|undefined;let calls=0;
  await expect(writeSourceParts({request,paths:["A.sol","B.sol"],contextHash:hash,save:async p=>{saved=p;}},async()=>{
   if(calls++)throw new ModelResponseError("output-limit",{inputTokens:1,outputTokens:100});return response("A.sol");
  })).rejects.toBeInstanceOf(SourceProgressPending);
  const resumed=vi.fn(async()=>response("B.sol"));
  const output=await writeSourceParts({request,paths:["A.sol","B.sol"],contextHash:hash,cached:saved,save:async()=>{}},resumed);
  expect(resumed).toHaveBeenCalledOnce();expect(JSON.parse(output.text).sourceFiles.map((f:{path:string})=>f.path)).toEqual(["A.sol","B.sol"]);
 });
 it("fits a large hook and small companion within one shared budget",async()=>{
  let index=0;const paths=["A.sol","B.sol"],costs=[10_000,1_000],saved:SourceProgress[]=[];
  const output=await writeSourceParts({request,paths,contextHash:hash,save:async p=>{saved.push(p);}},async input=>{
   const cost=costs[index];
   if(input.maxTokens<cost)throw new ModelResponseError("output-limit",{inputTokens:1,outputTokens:input.maxTokens});
   return {...response(paths[index++]),outputTokens:cost};
  });
  expect(output.outputTokens).toBe(11_000);expect(Object.keys(saved.at(-1)!.files)).toEqual(paths);
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
