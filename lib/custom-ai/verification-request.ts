import type { ChatRequest } from "./types";

/** Verification requests do not change contract rules or grant launch authority.
 * Keep the exact user's wording for the source-blind declaration stage. */
export function requestedVerification(request:Pick<ChatRequest,"messages">,planned=false):string|undefined {
  const last=request.messages.at(-1);
  if(last?.role!=="user")return undefined;
  const text=last.content.trim();
  const direct=text.replace(/```[\s\S]*?```/g,"").replace(/^\s*>.*$/gm,"")
    .replace(/"[^"\n]*"|„[^“\n]*“|“[^”\n]*”|`[^`\n]*`/g,"").toLowerCase();
  if(!direct||/\b(?:don't|do not|nicht|keine)\b[^.!?\n]{0,45}\b(?:change|add|extend|ändern|ergänz|erweit)/u.test(direct))return undefined;
  const asksChange=/\b(?:add|include|extend|strengthen|missing|successful|ergänz\w*|erweiter\w*|verstärk\w*|fehlen\w*|erfolgreich\w*)\b/u.test(direct)
    &&/\b(?:tests?|checks?|verification|prüf\w*|pruef\w*|verhaltenstest\w*)\b/u.test(direct)
    &&!/^(?:what|which|how|was|welche|wie)\b/u.test(direct);
  return (planned||asksChange)&&text.length<=8000?text:undefined;
}
