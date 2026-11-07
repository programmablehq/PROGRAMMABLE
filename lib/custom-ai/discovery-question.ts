import type { ChatRequest } from "./types";

export function localizedDiscussionBoundary(text:string):boolean {
  return /\b(?:discutons\s+seulement|ne\s+(?:génère|genere|construis)\s+(?:aucun|pas|rien))/u.test(text)
    ||/\b(?:solo\s+(?:quiero\s+)?(?:discutir|hablar|planificar)|no\s+(?:generes|construyas)\s+(?:código|codigo|todav[ií]a))/u.test(text)
    ||/\b(?:solo\s+(?:discutere|parlare|pianificare)|non\s+(?:costruire|generare)\s+(?:ancora|codice))/u.test(text)
    ||/\b(?:só\s+(?:conversar|discutir|planejar)|não\s+(?:gere|construa)\s+(?:código|codigo|ainda))/u.test(text)
    ||/\b(?:alleen\s+(?:het\s+plan\s+)?bespreken|bouw\s+nog\s+(?:niets|niet)|nog\s+niet\s+bouwen)/u.test(text)
    ||/\b(?:sadece\s+(?:planı\s+)?(?:konuşalım|tartışalım)|henüz\s+kod\s+üretme)/u.test(text);
}

/** A concrete proposed behavior needs a durable rule even when the user asks
 * about feasibility in the same sentence. Pure informational questions do not. */
export function isConcreteDesignRequest(request:Pick<ChatRequest,"messages">):boolean {
  const last=request.messages.at(-1);
  if(last?.role!=="user")return false;
  const text=last.content.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|„[^“\n]*“|“[^”\n]*”/g," ");
  return (/\b(?:plan(?:e)?|entwirf|soll(?:en)?|möchte|moechte|will|want|i['’]d like|we need|je veux|quiero|quero|vorrei|ik wil|istiyorum)\b/iu.test(text)
    ||/(?:^|[:;\n])\s*(?:ein(?:en)?|a|an)\s+(?:coin|token)\b/iu.test(text))
    &&/\b(?:coin|token|fees?|tax|(?:gesamt|projekt|plattform)?geb[uü]hr\w*|liquidit\w*|buyback|rewards?|wetter\w*|weather|oracle|vault|frais|tarif\w*|comisi[oó]n\w*)\b/iu.test(text);
}

/** Blank presentation fields are collected by the launch form. They are not
 * invented economic decisions in a first discussion about contract behavior. */
export function withoutPrematureLaunchQuestions(value:Record<string,unknown>,userText:string):Record<string,unknown> {
  if(!Array.isArray(value.intentRequirements)||/\b(?:name|names|ticker|symbol|image|website|namen|bild)\b/iu.test(userText))return value;
  const allowed=new Set("coin token name names ticker symbol initial buy amount are is not yet chosen needed required before launch please choose add the a an and or what which your for to of still open fehlt fehlen der die das und oder name namen symbol bild startkauf betrag vor dem launch noch offen wähle bitte ist sind".split(" "));
  const kept=value.intentRequirements.filter((item:unknown)=>{
    if(!item||typeof item!=="object")return true;
    const question=(item as {open?:unknown}).open;
    if(typeof question!=="string"||!/\b(?:name|names|ticker|symbol|namen)\b/iu.test(question)||/\d/u.test(question))return true;
    const words=`${(item as {text?:unknown}).text??""} ${question}`.toLowerCase().match(/\p{L}+/gu)??[];
    return words.some(word=>!allowed.has(word));
  });
  return kept.length===value.intentRequirements.length?value:{...value,intentRequirements:kept};
}

/** Capability questions need an answer, not a saved contract specification.
 * Mixed edit/build commands stay with the planner. This route never mutates. */
export function isDiscoveryQuestion(request: Pick<ChatRequest, "intent" | "messages" | "editTarget">): boolean {
  const last = request.messages.at(-1);
  if (request.intent !== "chat" || request.editTarget || last?.role !== "user") return false;
  const text = last.content.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!text || text.length > 600 || /https?:\/\/|0x[0-9a-f]{10}|[`{}\[\]]/u.test(text)) return false;
  // Current-world questions need the planner's evidence tools. An idea-only
  // reply has no lookup stage and must not invent a price, event or observation.
  if (/\b(?:current|latest|today(?:'s)?|right now|live|aktuell\w*|heute|gerade)\b/u.test(text)
    && /\b(?:price\w*|market\w*|weather|news|volume|gas|preis\w*|markt\w*|wetter|nachrichten|volumen)\b/u.test(text)) return false;
  const question = text.replace(/^(?:(?:hey|hi|hello|hallo|moin)[,.!:\s]+)+/u, "");
  const capability = [
    /^(?:what|which)\b[^.!?;,\n]{0,70}?\b(?:can|could|should)\b[^.!?;,\n]{0,70}?\b(?:build|make|create|do|hooks?)\b/u,
    /^(?:was|welche)\b[^.!?;,\n]{0,70}?\b(?:kann\w*|konn\w*|soll\w*)\b[^.!?;,\n]{0,70}?\b(?:bauen|machen|erstellen|hooks?)\b/u,
    /^was (?:kannst|konntest) du\b|^was (?:geht|ist moglich) hier\b|^was ist hier moglich\b|^(?:wobei|womit) kannst du\b/u,
    /^(?:give|show|suggest)\b[^.!?;,\n]{0,35}?\b(?:ideas|examples)\b|^(?:any ideas|how can you help)\b/u,
    /^(?:gib|zeig|nenn)\w*\b[^.!?;,\n]{0,35}?\b(?:ideen|beispiele)\b|^hast du (?:ein paar )?ideen\b/u,
  ].map(pattern => pattern.exec(question)).find(Boolean);
  if (!capability) return false;
  const commands = question.slice(capability[0].length)
    .replace(/\b(?:please\s+)?(?:do not|don['’]t)\s+(?:build|create|launch|deploy)(?:\s+anything)?(?:\s+yet)?\b/gu, "")
    .replace(/\b(?:bitte\s+)?(?:noch\s+)?nicht(?:s)?\s+(?:bauen|erstellen|launchen|deployen)\b/gu, "")
    .replace(/\b(?:give me|gib mir|nenne? mir)\s+(?:(?:please|some|more|a few|two|three|different|concrete|creative|simple|practical|bitte|ein paar|noch|mehr|zwei|drei|verschiedene|konkrete|kreative|einfache|\d+)[\s,]+)*(?:(?:coin|token|hook)[-\s]+)?(?:ideas?|examples?|ideen|beispiele)\b/gu, "");
  const followup = String.raw`(?:^\s*|[.!?;,]\s*|\b(?:and|then|also|und|dann|danach)\s+)`;
  const polite = String.raw`(?:(?:please|now|bitte|jetzt|noch)\s+)*`;
  const modal = String.raw`(?:(?:can|could|would|will)\s+you|(?:kannst|konntest|wurdest|willst)\s+du|(?:konnt|konntet|wurdet|wollt)\s+ihr|(?:konnen|konnten|wollen|sollen)\s+wir)\s+`;
  const action = String.raw`(?:build|make|create|launch\w*|deploy\w*|change|update|adjust|increase|decrease|raise|lower|reduce|add|remove|set|send|transfer|withdraw|deposit|mint|burn|name|rename|buy|sell|swap|claim|approve|sign|use|switch|give|gib|mach\w*|signier\w*|kauf\w*|verkauf\w*|bau\w*|erstell\w*|ander\w*|erho\w*|senk\w*|reduzier\w*|fug\w*|entfern\w*|setz\w*|sende\w*|zahl\w*|benenn\w*|nenn\w*|nutze\w*|verwend\w*|wechsel\w*)\b`;
  // A second substantive question may request work with an unfamiliar verb.
  // Preserve it in the planner instead of guessing that it is read-only.
  return !new RegExp(`${followup}${polite}(?:${modal}${polite})?${action}`, "u").test(commands)
    && !new RegExp(`${followup}${polite}${modal}\\S`, "u").test(commands);
}
