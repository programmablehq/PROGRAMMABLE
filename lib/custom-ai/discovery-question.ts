import type { ChatRequest } from "./types";

/** Capability questions need an answer, not a saved contract specification.
 * Mixed edit/build commands stay with the planner. This route never mutates. */
export function isDiscoveryQuestion(request: Pick<ChatRequest, "intent" | "messages" | "editTarget">): boolean {
  const last = request.messages.at(-1);
  if (request.intent !== "chat" || request.editTarget || last?.role !== "user") return false;
  const text = last.content.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!text || text.length > 600 || /https?:\/\/|0x[0-9a-f]{10}|[`{}\[\]]/u.test(text)) return false;
  const question = text.replace(/^(?:(?:hey|hi|hello|hallo|moin)[,.!:\s]+)+/u, "");
  const capability = [
    /^(?:what|which)\b.{0,70}\b(?:can|could|should)\b.{0,70}\b(?:build|make|create|do|hooks?)\b/u,
    /^(?:was|welche)\b.{0,70}\b(?:kann\w*|konn\w*|soll\w*)\b.{0,70}\b(?:bauen|machen|erstellen|hooks?)\b/u,
    /^was (?:kannst|konntest) du\b|^was (?:geht|ist moglich) hier\b|^was ist hier moglich\b|^(?:wobei|womit) kannst du\b/u,
    /^(?:give|show|suggest)\b.{0,35}\b(?:ideas|examples)\b|^(?:any ideas|how can you help)\b/u,
    /^(?:gib|zeig|nenn)\w*\b.{0,35}\b(?:ideen|beispiele)\b|^hast du (?:ein paar )?ideen\b/u,
  ].some(pattern => pattern.test(question));
  if (!capability) return false;
  const commands = question
    .replace(/\b(?:please\s+)?(?:do not|don't)\s+(?:build|create|launch|deploy)(?:\s+anything)?(?:\s+yet)?\b/gu, "")
    .replace(/\b(?:bitte\s+)?(?:noch\s+)?nicht(?:s)?\s+(?:bauen|erstellen|launchen|deployen)\b/gu, "");
  return !/(?:[.!?;,]\s*|\b(?:and|then|also|und|dann|danach)\s+)(?:(?:please|now|bitte|jetzt)\s+)?(?:build|create|launch\w*|deploy\w*|change|add|remove|set|send|withdraw|mint|rename|buy|sell|swap|claim|approve|sign|mach\w*|signier\w*|kauf\w*|verkauf\w*|bau\w*|erstell\w*|ander\w*|fug\w*|entfern\w*|setz\w*|sende\w*|zahl\w*)\b/u.test(commands);
}
