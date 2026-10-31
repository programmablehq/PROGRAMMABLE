import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {runCustomAI} from "../lib/custom-ai/service.server";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import type {Draft} from "../lib/custom-ai/types";
const answer={reply:"The ten minute phase ends before the weather rule starts.",action:"answer",memory:"Existing design is unchanged.",intentRequirements:[],requirements:[],feeChecks:[],setupPatch:{},lookups:[],program:null,eventRule:null,composable:null,ruleEdits:[]};
const checked:Draft={source:"EXACT_PRIVATE_SOURCE_"+"x".repeat(20000),sourceHash:"a".repeat(64),compiled:true,diagnostics:[],hookSummary:"Ten minute fee schedule",verification:{status:"passed",sourceHash:"a".repeat(64),requirements:["Fall from 10% to 1% over ten minutes","No transfer tax"],checks:[{afterSeconds:0,buy:true,totalFeeBps:1000},{afterSeconds:600,buy:true,totalFeeBps:100}],cases:8}};
async function question(text:string,draft:Draft|undefined=checked){
 const call=vi.fn(async(_input:ClaudeInput)=>({text:JSON.stringify(answer),inputTokens:0,outputTokens:0}));const compile=vi.fn();
 const reply=await runCustomAI({id:"context-request-00001",intent:"chat",messages:[{role:"user",content:text}]},undefined,{call,compile},{draft,memory:"The weather rule comes afterwards."});
 return {call,compile,reply,input:call.mock.calls[0][0]};
}
describe("Custom AI context budget",()=>{
 it("bounds a normal checked-draft explanation without sending its full source or repeating provenance",async()=>{
  const {input,call,compile,reply}=await question("Explain the timing without changing any rule");
  expect(call).toHaveBeenCalledTimes(1);expect(compile).not.toHaveBeenCalled();expect(reply.change).toBe("unchanged");
  expect(input.system).not.toContain(checked.source);expect(input.system).toContain("Fall from 10% to 1% over ten minutes");expect(input.system).toContain("No transfer tax");expect(input.system.length).toBeLessThan(30000);
  console.log("CONTEXT_COMPACT",JSON.stringify({systemCharacters:input.system.length,schemaCharacters:JSON.stringify(input.schema).length,messageCharacters:JSON.stringify(input.messages).length}));
 });
 it("retains all canonical decisions and open choices while omitting repeated provenance from model input",async()=>{
  const intent:LaunchIntent={version:1,id:"saved-intent-00001",revision:"b".repeat(64),unresolved:["Choose the trigger"],changes:[],requirements:Array.from({length:64},(_,i)=>({id:`rule-${i}`,text:i===63?"No creator liquidity withdrawal":`Keep behavior ${i}`,kind:i===63?"constraint":"behavior",open:i===60?"Choose the trigger":null,origin:{kind:"message",requestId:"original-request-0001",messageIndex:0,quote:"PRIVATE_OLD_QUOTE_"+"q".repeat(400)}}))};
  const call=vi.fn(async(_input:ClaudeInput)=>({text:JSON.stringify(answer),inputTokens:0,outputTokens:0})),compile=vi.fn();
  const reply=await runCustomAI({id:"context-request-00002",intent:"chat",messages:[{role:"user",content:"Summarize all saved rules"}]},undefined,{call,compile},{draft:checked,intent});
  expect(reply.intent).toEqual(intent);expect(call).toHaveBeenCalledTimes(1);expect(compile).not.toHaveBeenCalled();
  const system=call.mock.calls[0][0].system;
  for(const rule of intent.requirements){expect(system).toContain(rule.id);expect(system).toContain(rule.text);}
  expect(system).toContain("Choose the trigger");expect(system).not.toContain("PRIVATE_OLD_QUOTE_");
 });
 it("includes exact source when code inspection is requested",async()=>{
  const {input,call,compile}=await question("Explain the Solidity code in the saved contract");
  expect(input.system).toContain(checked.source);expect(call).toHaveBeenCalledTimes(1);expect(compile).not.toHaveBeenCalled();
 });
 it("keeps full source for an older draft without checked behavior",async()=>{
  const {input}=await question("Explain the timing",{...checked,verification:undefined});expect(input.system).toContain(checked.source);
 });
});
