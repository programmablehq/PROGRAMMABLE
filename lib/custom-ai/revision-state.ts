import type { ChatRequest, ChatResult } from "./types";
import type { LaunchIntent } from "./launch-intent";

/** Revision errors are work still to do, not new economic requirements.
 * Keep them separately from canonical rules, including in old saved jobs. */
export function savedPendingRevision(input:{pendingRevision?:ChatResult["pendingRevision"];unresolved?:readonly string[]},intent:LaunchIntent|undefined,request:ChatRequest):ChatResult["pendingRevision"] {
  if(input.pendingRevision)return structuredClone(input.pendingRevision);
  const issues=input.unresolved?.filter(issue=>!intent?.unresolved.includes(issue)
    &&intent?.requirements.some(rule=>rule.open===null&&rule.text===issue))??[];
  if(!issues.length)return undefined;
  const prior=request.messages.slice(0,-1).findLast(message=>message.role==="user");
  return {instruction:prior?.content??"",issues};
}
