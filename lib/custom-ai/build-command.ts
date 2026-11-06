import type { ChatRequest } from "./types";
import { localizedDiscussionBoundary } from "./discovery-question";

export const CONTINUE_SAVED_BUILD = "Build and verify the current saved design. Keep every saved rule unchanged. Do not launch, send a transaction or prepare a wallet request.";

/** An explicit request to discuss first is a no-build boundary, not a change
 * to the saved rules. Quoted examples and code do not establish that boundary. */
export function designOnlyRequest(request:Pick<ChatRequest,"intent"|"messages">):boolean{
  if(request.intent!=="chat"||request.messages.at(-1)?.role!=="user")return false;
  const text=request.messages.at(-1)!.content.normalize("NFKC").replace(/```[\s\S]*?```/g," ")
    .replace(/^\s*>.*$/gm," ").replace(/"[^"\n]*"|„[^“\n]*“|“[^”\n]*”|`[^`\n]*`/g," ").replace(/[’‘]/g,"'").toLowerCase();
  if(/\b(?:do not|don't)\s+(?:just|only)\s+(?:want\s+to\s+)?(?:plan|discuss|design)\b/.test(text))return false;
  return /\b(?:do not|don't|not|no)\s+(?:build|generate|deploy)(?:\s+or\s+launch)?\s*(?:(?:it|this|anything)\b\s*)?(?:yet\b|now\b|[.!?;,:]|$)/.test(text)
    ||/\bnoch\s+(?:nicht(?:s)?|nix)\s+(?:bauen|generieren|deployen|veröffentlichen)\b/.test(text)
    ||/\b(?:only|just)\s+(?:want\s+to\s+)?(?:discuss|plan|explore|brainstorm|shape|design)\b/.test(text)
    ||/\b(?:discuss|plan|explore|brainstorm|design)\s+(?:it\s+)?first\b/.test(text)
    ||/\bfirst[,;:]?\s+(?:let's\s+|let us\s+)?(?:discuss|plan|explore|brainstorm)\b/.test(text)
    ||/\b(?:erst|erstmal|zuerst|nur)\s+(?:besprechen|reden|planen|überlegen|brainstormen)\b/.test(text)
    ||localizedDiscussionBoundary(text);
}

/** Exact continuation commands only. Changes, questions and quoted instructions
 * still need the planner; this helper never grants launch authority. */
export function unchangedBuildCommand(request:Pick<ChatRequest,"intent"|"messages">):boolean {
  const last=request.messages.at(-1);
  if(last?.role!=="user")return false;
  const text=last.content.normalize("NFKC").trim().replace(/\s+/gu," ").toLowerCase();
  return /^(?:continue|weiter|mach weiter)[.!]?$/u.test(text) || text===CONTINUE_SAVED_BUILD.toLowerCase()
    || /^(?:please |bitte )?(?:continue building|build (?:the )?(?:current )?saved (?:design|source)|baue? (?:den )?(?:aktuellen )?gespeicherten entwurf(?: fertig)?|mach (?:den )?gespeicherten entwurf fertig)[.!]?$/u.test(text)
    || /^(?:(?:yes|okay|ok)[, ]+)?(?:(?:go ahead and|let's|let us) )?(?:build|rebuild|compile) it[.!]?$/u.test(text)
    || /^(?:(?:ja|okay|ok)[, ]+)?(?:baue?|erstelle?|kompiliere?) (?:es|ihn|das)[.!]?$/u.test(text);
}

/** A narrow fallback for an explicit command to build the unchanged source.
 * It grants no edits, launch, signature or verification and ignores quotations.
 * Other phrasing is still interpreted by the normal planner. */
export function explicitSourceBuild(request: Pick<ChatRequest,"intent"|"messages">): boolean {
  if(designOnlyRequest(request))return false;
  const message=request.messages.at(-1);
  if(message?.role!=="user")return false;
  const text=message.content.normalize("NFKC").replace(/```[\s\S]*?```/g," ")
    .replace(/^\s*>.*$/gm," ").replace(/"[^"\n]*"|„[^“\n]*“|“[^”\n]*”|`[^`\n]*`/g," ").trim().toLowerCase();
  if(!text||/\b(?:don't|don’t)\s+(?:build|rebuild|generate|compile|make|create)\b/.test(text)
    ||/\b(?:no|without|kein(?:e[nmrs]?)?)\s+(?:code|source|quellcode|contracts?)\b/.test(text)
    ||/\b(?:not|never|nicht|keinen|noch nicht)\b[^.!?\n]{0,24}\b(?:build|rebuild|generate|compile|create|bauen|baue|erstellen|erzeuge|kompilieren)\b/.test(text)
    ||/\b(?:build|rebuild|generate|compile|create|baue?|erstelle?|erzeuge?|kompiliere?)\s+(?:not|nicht|keinen)\b/.test(text))return false;
  if(request.intent==="build")return true;
  const polite=text.replace(/^(?:(?:ok(?:ay)?|hey|bitte|please|jetzt|now|go|guck mal|schau mal|ja|yes)[\s,!.:]*)+/,"");
  const modal=/^(?:(?:can|could|would) you|(?:kannst|könntest|koenntest|würdest|wuerdest) du)\s+(?:please\s+|bitte\s+)?/;
  const command=polite.replace(modal,"");
  if(/^(?:do|make)(?: me)? (?:a|an|the|this|my) (?:hook|coin|token|contract)\s+(?:where|that|which|with)\b/.test(command))return true;
  if(/^(?:build|rebuild|generate|compile|create|implement|baue?|erstelle?|erzeuge?|kompiliere?|implementiere?)\b/.test(command)) {
    const object=command.replace(/^\S+\s*/,""),source=/\b(?:source|code|contracts?|hook|design|coin|token|project|quellcode|entwurf|vertrag|projekt|it|this|ihn|es|das)\b/.exec(object.slice(0,180));
    const other=/\b(?:summary|summaries|explanation|names?|list|ideas?|image|logo|website|page|zusammenfassung|erklärung|erklaerung|namen|liste|ideen|bild|webseite)\b/.exec(object);
    if(!source||other&&other.index<source.index)return false;
    // A hook plus an image is a build; a token logo or website is artwork.
    return !/^(?:hook|coin|token|project|projekt)[ -]+(?:logo|website|page|name|list|image|bild|webseite)\b/.test(object.slice(source.index));
  }
  if(modal.test(polite)&&!/(?:erklär|erlauter|erläuter|zeigen|sagen|explain|tell|show)/.test(command)
    &&/\b(?:hook|code|quellcode|entwurf|vertrag|contracts?|coin|token|projekt|ihn|es|das)\b[^.!?\n]{0,140}\b(?:bauen|erstellen|erzeugen|kompilieren)\??$/.test(command))return true;
  return /^mach(?:e)?\b[^.!?\n]{0,160}\bfertig\b/.test(command)
    &&!/^mach(?:e)?\s+(?:die |eine |diese )?(?:antwort|zusammenfassung|anleitung|liste|erklärung)\b/.test(command);
}
