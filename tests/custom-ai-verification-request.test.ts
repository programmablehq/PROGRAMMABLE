import {describe,it,expect} from "vitest";
import {requestedVerification} from "../lib/custom-ai/verification-request";
const request=(content:string)=>({messages:[{role:"user" as const,content}]});
describe("explicit verification changes",()=>{
 it.each([
  "Baue den Hook fertig. Ergänze den Prüfplan um erfolgreiche Liquiditätseinzahlungen und ausgezahlte Holder-Claims.",
  "Please add the missing successful buyback and burn tests before building.",
 ])("retains the complete explicit request: %s",text=>expect(requestedVerification(request(text))).toBe(text));
 it.each(["Build the saved design","Run the current tests","Welche Tests fehlen?","Do not change the tests",'> Add missing tests'])
  ("does not turn a retry, question, negation or quotation into a fresh plan: %s",text=>expect(requestedVerification(request(text))).toBeUndefined());
 it("accepts the planner's explicit intent for other phrasings",()=>expect(requestedVerification(request("Bitte auch den glücklichen Ablauf prüfen."),true)).toBe("Bitte auch den glücklichen Ablauf prüfen."));
});
