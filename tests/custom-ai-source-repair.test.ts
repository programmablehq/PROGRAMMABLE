import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {repairCompilerSource} from "../lib/custom-ai/source-repair.server";
import type {ContractProject} from "../lib/custom-ai/contract-project";
import type {CompiledProject} from "../lib/custom-ai/contract-project.server";

const project={sources:{"Hook.sol":{content:"contract Hook {uint value = missing;}"},"Fixed.sol":{content:"contract Fixed {}"}}} as unknown as ContractProject;
const compilation={compiled:false,diagnostics:[{severity:"error",message:"DeclarationError: missing identifier\n --> Hook.sol:1:28"}]} as CompiledProject;
const input={project,compilation,request:{model:"fixture",system:"All saved rules",messages:[{role:"user" as const,content:"Build"}],schema:{},maxTokens:16000},remainingTokens:2300,immutable:new Set(["Fixed.sol"])};
describe("compiler-directed source correction",()=>{
 it("uses only remaining generation tokens and retains immutable source",async()=>{
  const call=vi.fn(async request=>{
   expect(request.maxTokens).toBe(2300);
   return {text:JSON.stringify({reply:"Corrected name",summary:"Local compiler fix",changes:[{path:"Hook.sol",before:"missing",after:"1"}]}),inputTokens:1,outputTokens:100};
  });
  const corrected=await repairCompilerSource(input,call);
  expect(corrected?.["Hook.sol"].content).toBe("contract Hook {uint value = 1;}");
  expect(corrected?.["Fixed.sol"]).toEqual(project.sources["Fixed.sol"]);expect(call).toHaveBeenCalledOnce();
 });
 it("does not retry an exhausted budget or a diagnostic in a fixed dependency",async()=>{
  const call=vi.fn();
  expect(await repairCompilerSource({...input,remainingTokens:1000},call)).toBeUndefined();
  expect(await repairCompilerSource({...input,compilation:{...compilation,diagnostics:[{severity:"error",message:"Error\n --> Fixed.sol:1:1"}]}},call)).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
 });
 it("keeps the original files when a proposed repair touches another file",async()=>{
  const call=vi.fn(async()=>({text:JSON.stringify({reply:"Change",summary:"Change",changes:[{path:"Fixed.sol",before:"Fixed",after:"Changed"}]}),inputTokens:1,outputTokens:100}));
  expect(await repairCompilerSource(input,call)).toBeUndefined();
  expect(project.sources["Fixed.sol"].content).toBe("contract Fixed {}");expect(call).toHaveBeenCalledOnce();
 });
});
