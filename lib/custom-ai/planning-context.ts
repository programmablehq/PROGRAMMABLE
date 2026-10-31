import type {ChatRequest,Draft} from "./types";
import type {LaunchIntent} from "./launch-intent";
import type {RuleSpecV2} from "./rule-spec";

/** Source inspection is opt-in for checked drafts. Older drafts without a
 * verified behavior record retain their full source context. This changes
 * model input size; it never chooses a build or authorizes an edit. */
export function plannerNeedsSource(request:ChatRequest,draft?:Draft){
  if(!draft)return false;
  const checked=draft.compiled&&draft.verification?.status==="passed"
    &&draft.verification.sourceHash===draft.sourceHash&&Array.isArray(draft.verification.requirements)&&draft.verification.requirements.length>0
    &&Array.isArray(draft.verification.checks)&&draft.verification.checks.length>0;
  return !checked||/\b(source|code|contract|solidity|bytecode|function|implementation|audit|quellcode|vertrag|funktion|implementierung|zeile)\b|```/i.test(request.messages.at(-1)?.content??"");
}
export function modelDesignContext(input:{memory?:string;ruleSpec?:RuleSpecV2;intent?:LaunchIntent;editTarget?:ChatRequest["editTarget"];draft?:Draft},includeSource:boolean){
  const {draft,intent}=input;
  return {
    memory:input.memory,ruleSpec:input.ruleSpec,editTarget:input.editTarget,
    // Full provenance and change history stay in the server-owned revision.
    // The model needs every stable rule and open choice, not repeated quotes.
    intent:intent?{version:intent.version,id:intent.id,revision:intent.revision,parentRevision:intent.parentRevision,
      requirements:intent.requirements.map(({id,text,kind,open})=>({id,text,kind,open})),unresolved:intent.unresolved}:undefined,
    currentDraft:draft?{sourceHash:draft.sourceHash,...(includeSource?{source:draft.source}:{}),hookSummary:draft.hookSummary,
      requirements:draft.verification?.requirements,feeChecks:draft.verification?.checks,program:draft.program?.spec,eventRule:draft.feed?.rule,
      sourceIncluded:includeSource}:null,
  };
}
