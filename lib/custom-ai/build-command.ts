import type { ChatRequest } from "./types";

/** A narrow fallback for an explicit command to build the unchanged source.
 * It grants no edits, launch, signature or verification and ignores quotations.
 * Other phrasing is still interpreted by the normal planner. */
export function explicitSourceBuild(request: Pick<ChatRequest,"intent"|"messages">): boolean {
  const message=request.messages.at(-1);
  if(message?.role!=="user")return false;
  const text=message.content.normalize("NFKC").replace(/```[\s\S]*?```/g," ")
    .replace(/^\s*>.*$/gm," ").replace(/"[^"\n]*"|„[^“\n]*“|“[^”\n]*”|`[^`\n]*`/g," ").trim().toLowerCase();
  if(!text||/\b(?:no|without|kein(?:e[nmrs]?)?)\s+(?:code|source|quellcode|contracts?)\b/.test(text)
    ||/\b(?:not|never|nicht|keinen|noch nicht)\b[^.!?\n]{0,24}\b(?:build|rebuild|generate|compile|bauen|baue|erstellen|erzeuge|kompilieren)\b/.test(text)
    ||/\b(?:build|rebuild|generate|compile|baue?|erstelle?|erzeuge?|kompiliere?)\s+(?:not|nicht|keinen)\b/.test(text))return false;
  if(request.intent==="build")return true;
  const polite=text.replace(/^(?:(?:ok(?:ay)?|hey|bitte|please|jetzt|now|go|guck mal|schau mal|ja|yes)[\s,!.:]*)+/,"");
  const modal=/^(?:(?:can|could|would) you|(?:kannst|könntest|koenntest|würdest|wuerdest) du)\s+(?:please\s+|bitte\s+)?/;
  const command=polite.replace(modal,"");
  if(/^(?:build|rebuild|generate|compile|implement|baue?|erstelle?|erzeuge?|kompiliere?|implementiere?)\b/.test(command))return true;
  if(modal.test(polite)&&!/(?:erklär|erlauter|erläuter|zeigen|sagen|explain|tell|show)/.test(command)
    &&/\b(?:hook|code|quellcode|entwurf|vertrag|contracts?|coin|token|projekt|ihn|es|das)\b[^.!?\n]{0,140}\b(?:bauen|erstellen|erzeugen|kompilieren)\??$/.test(command))return true;
  return /^mach(?:e)?\b[^.!?\n]{0,160}\bfertig\b/.test(command)
    &&!/^mach(?:e)?\s+(?:die |eine |diese )?(?:antwort|zusammenfassung|anleitung|liste|erklärung)\b/.test(command);
}
