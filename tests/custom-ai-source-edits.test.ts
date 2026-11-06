import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {applySourceChanges,writeSourceEdits} from "../lib/custom-ai/source-edits.server";
const previous={"Hook.sol":{content:"contract Hook { uint fee = 3; function keep() external {} }"},"Token.sol":{content:"contract Token {}"}};
describe("exact saved-source edits",()=>{
 it("changes only the unique requested excerpt and retains other files in the caller's source",()=>{
  const changed=applySourceChanges(previous,[{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"}],new Set());
  expect(changed).toEqual({"Hook.sol":{content:"contract Hook { uint fee = 5; function keep() external {} }"}});
  expect(previous["Hook.sol"].content).toContain("uint fee = 3;");
 });
 it.each([
  [{path:"Hook.sol",before:"does not exist",after:"x"}],
  [{path:"../Hook.sol",before:null,after:"contract Hook {}"}],
  [{path:"Hook.sol",before:null,after:"contract Hook {}"}],
  [{path:"Hook.sol",before:"",after:"x"}],
  [{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 3;"}],
  [{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"},{path:"Hook.sol",before:"uint fee = 5;",after:"uint fee = 3;"}],
 ].map(changes=>({changes})))("rejects a non-exact or unsafe edit atomically",({changes})=>expect(()=>applySourceChanges(previous,changes,new Set())).toThrow());
 it("rejects ambiguous excerpts and immutable dependencies",()=>{
  expect(()=>applySourceChanges({"A.sol":{content:"x x"}},[{path:"A.sol",before:"x",after:"y"}],new Set())).toThrow();
  expect(()=>applySourceChanges(previous,[{path:"Token.sol",before:"Token",after:"Other"}],new Set(["Token.sol"]))).toThrow();
 });
 it("ignores an unchanged context excerpt when the batch contains a real edit",()=>{
  const changes=[{path:"Hook.sol",before:"function keep() external {}",after:"function keep() external {}"},
   {path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"}];
  expect(applySourceChanges(previous,changes,new Set())["Hook.sol"].content).toContain("uint fee = 5;");
 });
 it("ignores only a redundant formatted suggestion already covered by an exact edit",()=>{
  const code="if(block.timestamp<lastRun+3600)return false;\nuint256 budget=reserve;";
  const before="if (block.timestamp < lastRun + 3600) return false;";
  const after="if (block.timestamp / 86400 <= lastRun / 86400) return false;";
  const replacement="if(block.timestamp/86400<=lastRun/86400)return false;\nuint256 budget=reserve>cap?cap:reserve;";
  const edits=[{path:"Hook.sol",before,after},{path:"Hook.sol",before:code,after:replacement}];
  expect(applySourceChanges({"Hook.sol":{content:code}},edits,new Set())).toEqual({"Hook.sol":{content:replacement}});
  expect(()=>applySourceChanges({"Hook.sol":{content:code}},[{...edits[0],after:"if (block.timestamp < lastRun) return false;"},edits[1]],new Set())).toThrow();
  expect(()=>applySourceChanges({"Hook.sol":{content:code}},[edits[0]],new Set())).toThrow();
 });
 it("does not treat quoted text, comments or different operators as redundant code",()=>{
  for(const [source,before,after,replacement] of [
   ['string x="a b";','string x = "ab";','string x="c";','string x="c";'],
   ['a++;','a + +;','a--;','a--;'],
   ['/* a b */ x();','/* ab */ x();','/* c */ x();','/* c */ x();'],
  ])expect(()=>applySourceChanges({"Hook.sol":{content:source}},[{path:"Hook.sol",before,after},{path:"Hook.sol",before:source,after:replacement}],new Set())).toThrow();
 });
 it("reassembles a large existing source from a small model response",async()=>{
  const big={"Hook.sol":{content:"// original context\n".repeat(3000)+previous["Hook.sol"].content}};
  const call=vi.fn(async()=>({text:JSON.stringify({reply:"Updated the fee.",summary:"Same hook, updated fee",changes:[{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"}]}),inputTokens:1,outputTokens:80}));
  const result=await writeSourceEdits({request:{model:"fixture",system:"saved source",messages:[{role:"user",content:"Set fee to five"}],schema:{},maxTokens:16000},previous:big,immutable:new Set()},call);
  expect(call).toHaveBeenCalledOnce();expect(result.outputTokens).toBe(80);
  expect(JSON.parse(result.text).sourceFiles[0].content).toBe(big["Hook.sol"].content.replace("uint fee = 3;","uint fee = 5;"));
 });
 it("requires an actual edit for a changed intent but reuses an explicitly unchanged design",async()=>{
  const call=vi.fn(async()=>({text:JSON.stringify({reply:"Already current.",summary:"Existing source retained",changes:[]}),inputTokens:1,outputTokens:10}));
  const input={request:{model:"fixture",system:"saved source",messages:[{role:"user" as const,content:"Use the saved design"}],schema:{},maxTokens:16000},previous,immutable:new Set<string>()};
  await expect(writeSourceEdits({...input,requireChange:true},call)).rejects.toMatchObject({code:"project-response"});
  expect(JSON.parse((await writeSourceEdits(input,call)).text).sourceFiles[0].content).toBe(previous["Hook.sol"].content);
 });
 it("corrects one invalid anchor within the original response budget without changing source first",async()=>{
  const request={model:"fixture",system:"saved source",messages:[{role:"user" as const,content:"Set fee to five"}],schema:{},maxTokens:2000};
  const call=vi.fn().mockResolvedValueOnce({text:JSON.stringify({reply:"Updated",summary:"Fee",changes:[{path:"Hook.sol",before:"uint fee=3;",after:"uint fee=5;"}]}),inputTokens:10,outputTokens:200})
    .mockImplementationOnce(async input=>{
      expect(input.maxTokens).toBe(1800);expect(input.system).toContain("was not applied");expect(previous["Hook.sol"].content).toContain("uint fee = 3;");
      return {text:JSON.stringify({reply:"Updated",summary:"Fee",changes:[{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"}]}),inputTokens:20,outputTokens:100};
    });
  const value=await writeSourceEdits({request,previous,immutable:new Set()},call);
  expect(call).toHaveBeenCalledTimes(2);expect(value).toMatchObject({inputTokens:30,outputTokens:300});
  expect(JSON.parse(value.text).sourceFiles[0].content).toContain("uint fee = 5;");
 });
 it("never loops or retries an invalid anchor without known remaining usage",async()=>{
  const input={request:{model:"fixture",system:"source",messages:[{role:"user" as const,content:"Edit"}],schema:{},maxTokens:2000},previous,immutable:new Set<string>()};
  const text=JSON.stringify({reply:"Edited",summary:"Fee",changes:[{path:"Hook.sol",before:"absent",after:"replacement"}]});
  const unknown=vi.fn(async()=>({text,inputTokens:null,outputTokens:null}));
  await expect(writeSourceEdits(input,unknown)).rejects.toMatchObject({code:"project-response"});expect(unknown).toHaveBeenCalledOnce();
  const twice=vi.fn(async()=>({text,inputTokens:10,outputTokens:100}));
  await expect(writeSourceEdits(input,twice)).rejects.toMatchObject({code:"project-response"});expect(twice).toHaveBeenCalledTimes(2);
 });
});
