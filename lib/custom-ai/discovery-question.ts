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
    /^(?:what|which)\b[^.!?;,\n]{0,70}?\b(?:can|could|should)\b[^.!?;,\n]{0,70}?\b(?:build|make|create|do|hooks?)\b/u,
    /^(?:was|welche)\b[^.!?;,\n]{0,70}?\b(?:kann\w*|konn\w*|soll\w*)\b[^.!?;,\n]{0,70}?\b(?:bauen|machen|erstellen|hooks?)\b/u,
    /^was (?:kannst|konntest) du\b|^was (?:geht|ist moglich) hier\b|^was ist hier moglich\b|^(?:wobei|womit) kannst du\b/u,
    /^(?:give|show|suggest)\b.{0,35}\b(?:ideas|examples)\b|^(?:any ideas|how can you help)\b/u,
    /^(?:gib|zeig|nenn)\w*\b.{0,35}\b(?:ideen|beispiele)\b|^hast du (?:ein paar )?ideen\b/u,
  ].map(pattern => pattern.exec(question)).find(Boolean);
  if (!capability) return false;
  const commands = question.slice(capability[0].length)
    .replace(/\b(?:please\s+)?(?:do not|don['’]t)\s+(?:build|create|launch|deploy)(?:\s+anything)?(?:\s+yet)?\b/gu, "")
    .replace(/\b(?:bitte\s+)?(?:noch\s+)?nicht(?:s)?\s+(?:bauen|erstellen|launchen|deployen)\b/gu, "")
    .replace(/\b(?:give me|gib mir|nenne? mir)\s+(?:(?:please|some|more|a few|two|three|bitte|ein paar|noch|mehr|zwei|drei|\d+)\s+)*(?:ideas?|examples?|ideen|beispiele)\b/gu, "");
  const followup = String.raw`(?:^\s*|[.!?;,]\s*|\b(?:and|then|also|und|dann|danach)\s+)`;
  const polite = String.raw`(?:(?:please|now|bitte|jetzt|noch)\s+)*`;
  const modal = String.raw`(?:(?:can|could|would|will)\s+you|(?:kannst|konntest|wurdest|willst)\s+du|(?:konnt|konntet|wurdet|wollt)\s+ihr|(?:konnen|konnten|wollen|sollen)\s+wir)\s+`;
  const action = String.raw`(?:build|make|create|launch\w*|deploy\w*|change|update|add|remove|set|send|transfer|withdraw|deposit|mint|burn|rename|buy|sell|swap|claim|approve|sign|use|switch|give|gib|mach\w*|signier\w*|kauf\w*|verkauf\w*|bau\w*|erstell\w*|ander\w*|fug\w*|entfern\w*|setz\w*|sende\w*|zahl\w*|benenn\w*|nenn\w*|nutze\w*|verwend\w*|wechsel\w*)\b`;
  // A polite question may still request an edit. Keep the complete message
  // with the planner, including German clauses whose action comes last.
  return !new RegExp(`${followup}${polite}(?:${modal}${polite})?${action}`, "u").test(commands)
    && !new RegExp(`${followup}${polite}${modal}[^.!?;]{0,180}\\b${action}`, "u").test(commands);
}
