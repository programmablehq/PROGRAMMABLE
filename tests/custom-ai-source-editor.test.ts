import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {editSourceFoundation} from "../lib/custom-ai/source-editor.server";
import {sourceFoundation} from "../lib/custom-ai/source-foundation.server";
import {sourceProgressExtends,type SourceProgress} from "../lib/custom-ai/source-progress";
import type {GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";

const contextHash=`sha256:${"a".repeat(64)}` as const;
const seeds={"A.sol":{content:"contract A {}"},"B.sol":{content:"contract B {}"}};
const request:ClaudeInput={model:"fixture",system:"All original rules remain fixed.",messages:[{role:"user",content:"Build"}],schema:{},maxTokens:16000};
const patchTask={model:"fixture",task:"source-edit" as const,effort:"low" as const};
const steps=[{path:"A.sol",instruction:"Add the required state."},{path:"B.sol",instruction:"Add the required integration."}];
const reply=(value:unknown,outputTokens=100)=>({text:JSON.stringify(value),inputTokens:1,outputTokens});
const change=(path:string,name:string)=>reply({reply:"Implemented",summary:"Saved rule",changes:[{path,before:`contract ${name} {}`,after:`contract ${name} {uint public value;}`} ]});
const input={request,patchTask,seeds,paths:Object.keys(seeds),contextHash,systemForPath:(path:string)=>`Current file ${path}`};

describe("bounded edits on a complete source foundation",()=>{
 it("can retain an already implemented reference without a cosmetic source change",async()=>{
  const saved:SourceProgress[]=[];const call=vi.fn(async()=>reply({steps:[]}));
  const result=await editSourceFoundation({...input,allowUnchanged:true,save:async p=>{saved.push(p);}},call);
  expect(call).toHaveBeenCalledOnce();expect(saved.at(-1)?.files).toEqual(seeds);
  expect(JSON.parse(result.text).sourceFiles).toHaveLength(2);
 });
 it("persists exact stages and promotes files only after all planned edits",async()=>{
  const saved:SourceProgress[]=[];let n=0;
  const result=await editSourceFoundation({...input,save:async progress=>{if(saved.length)expect(sourceProgressExtends(saved.at(-1)!,progress)).toBe(true);saved.push(progress);}},async call=>{
   expect(call.maxTokens).toBeLessThanOrEqual(n?4000:2000);
   return [reply({steps}),change("A.sol","A"),change("B.sol","B")][n++];
  });
  expect(n).toBe(3);expect(result.outputTokens).toBe(300);
  expect(saved[0].files).toEqual({});expect(saved[1].editing?.next).toBe(1);
  expect(saved.at(-1)?.editing).toBeUndefined();expect(saved.at(-1)?.files["A.sol"].content).toContain("uint public value");
 });
 it("resumes an interrupted stage without repeating the plan or prior edit",async()=>{
  let saved:SourceProgress|undefined,n=0;
  await expect(editSourceFoundation({...input,save:async progress=>{saved=progress;}},async()=>{
   if(n++===0)return reply({steps});if(n===2)return change("A.sol","A");throw new SyntaxError("truncated");
  })).rejects.toMatchObject({code:"source-pending"});
  expect(saved?.editing?.next).toBe(1);
  const call=vi.fn(async()=>change("B.sol","B"));
  const result=await editSourceFoundation({...input,cached:saved,save:async()=>{}},call);
  expect(call).toHaveBeenCalledOnce();expect(JSON.parse(result.text).sourceFiles).toHaveLength(2);
 });
 it("keeps other draft files immutable within a selected stage",async()=>{
  let saved:SourceProgress|undefined,n=0;
  await expect(editSourceFoundation({...input,save:async progress=>{saved=progress;}},async()=>n++?change("B.sol","B"):reply({steps})))
   .rejects.toMatchObject({code:"source-pending"});
  expect(saved?.editing?.next).toBe(0);expect(saved?.editing?.sources).toEqual(seeds);
 });
 it("refuses to rewrite the saved plan or completed stage",()=>{
  const previous:SourceProgress={version:1,contextHash,files:{},reply:"",summary:"",editing:{sources:seeds,steps,next:0}};
  expect(sourceProgressExtends(previous,{...previous,editing:{sources:seeds,steps:[...steps].reverse(),next:1}})).toBe(false);
  expect(sourceProgressExtends(previous,{...previous,editing:{sources:seeds,steps,next:2}})).toBe(false);
 });
});

describe("canonical source foundations",()=>{
 it("retains canonical code and rebases its relative imports without treating it as completed behavior",()=>{
  const functions=Array.from({length:10},(_,i)=>`function f${i}()`);
  const blueprint={scenarios:{contracts:[{source:"new/Custom.sol",contract:"Custom",functions}]}} as unknown as GeneralCheckBlueprint;
  const code='import {Guard} from "../Guard.sol"; contract Original { uint private cap = 2; }';
  const result=sourceFoundation(blueprint,["new/Custom.sol"],{"pinned/core/Original.sol":{content:code}},[{source:"pinned/core/Original.sol",contract:"Original",functions}]);
  expect(result?.sources["new/Custom.sol"].content).toBe('import {Guard} from "pinned/Guard.sol"; contract Custom { uint private cap = 2; }');
 });
 it("does not seed an incompatible public interface",()=>{
  const blueprint={scenarios:{contracts:[{source:"A.sol",contract:"A",functions:[]}]}} as unknown as GeneralCheckBlueprint;
  expect(sourceFoundation(blueprint,["A.sol"],{},[])).toBeNull();
 });
});
