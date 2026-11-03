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
 ])("rejects a non-exact or unsafe edit atomically",changes=>expect(()=>applySourceChanges(previous,changes,new Set())).toThrow());
 it("rejects ambiguous excerpts and immutable dependencies",()=>{
  expect(()=>applySourceChanges({"A.sol":{content:"x x"}},[{path:"A.sol",before:"x",after:"y"}],new Set())).toThrow();
  expect(()=>applySourceChanges(previous,[{path:"Token.sol",before:"Token",after:"Other"}],new Set(["Token.sol"]))).toThrow();
 });
 it("reassembles a large existing source from a small model response",async()=>{
  const big={"Hook.sol":{content:"// original context\n".repeat(3000)+previous["Hook.sol"].content}};
  const call=vi.fn(async()=>({text:JSON.stringify({reply:"Updated the fee.",summary:"Same hook, updated fee",changes:[{path:"Hook.sol",before:"uint fee = 3;",after:"uint fee = 5;"}]}),inputTokens:1,outputTokens:80}));
  const result=await writeSourceEdits({request:{model:"fixture",system:"saved source",messages:[{role:"user",content:"Set fee to five"}],schema:{},maxTokens:16000},previous:big,immutable:new Set()},call);
  expect(call).toHaveBeenCalledOnce();expect(result.outputTokens).toBe(80);
  expect(JSON.parse(result.text).sourceFiles[0].content).toBe(big["Hook.sol"].content.replace("uint fee = 3;","uint fee = 5;"));
 });
});
