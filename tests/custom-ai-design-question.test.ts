import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {isSavedDesignQuestion} from "../lib/custom-ai/design-question";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
import type {ChatRequest} from "../lib/custom-ai/types";
const request=(content:string)=>({id:"question-00001",intent:"chat",messages:[{role:"user",content}]} as ChatRequest);
const schema={type:"object",properties:{reply:{type:"string"}},required:["reply"],additionalProperties:false};
describe("read-only saved-design questions",()=>{
 it.each(["Wie ist die gespeicherte Fee-Verteilung? Bitte nur kurz antworten.","Welche Gebühren sind im Entwurf?","Erklär mir die Regeln.","What are the saved fees?","Summarize the saved design."])("recognizes an explanation: %s",text=>{
  expect(isSavedDesignQuestion(request(text))).toBe(true);
 });
 it.each(["Welche Gebühren gelten? Ändere sie auf 2%.","What are the fees? Then launch it.","Explain the rules and remove the holder limit.","How do I build this design?","Wie ist die Verteilung? Setz die Fee auf 3%.","What are the rules? Send the ETH.","Was macht der Entwurf? Mach die Gebühren niedriger.","Use these rules: https://example.com","Hallo"])("keeps edits and actions with the full planner: %s",text=>{
  expect(isSavedDesignQuestion(request(text))).toBe(false);
 });
 it("normalizes text replies only for the closed reply-only schema",()=>{
  expect(JSON.parse(prepareSurplusSchema(schema,true).decode("30% Liquidität, 20% Buyback/Burn, 20% Holder, 30% Creator.")))
   .toEqual({reply:"30% Liquidität, 20% Buyback/Burn, 20% Holder, 30% Creator."});
  const planner={...schema,properties:{...schema.properties,action:{type:"string"}},required:["reply","action"]};
  expect(()=>prepareSurplusSchema(planner,true).decode("Launch it now")).toThrow();
 });
 it.each(['{"reply":"cut short"', '<invoke name="launch">go</invoke>', '["reply"]', '{"reply":"ok","action":"launch"}', '```json\n{"reply":"broken"\n```'])("does not treat structured or truncated data as plain prose",text=>{
  expect(()=>prepareSurplusSchema(schema,true).decode(text)).toThrow();
 });
});
