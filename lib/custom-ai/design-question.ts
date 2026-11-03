import type { ChatRequest } from "./types";

/** Only an explanation of the saved design. Any mixed action stays with the
 * full planner; this lane cannot change rules, metadata or launch state. */
export function isSavedDesignQuestion(request: ChatRequest): boolean {
  const text = request.messages.at(-1)?.content.trim() ?? "";
  const match = text.normalize("NFD").replace(/\p{M}/gu, "");
  return request.intent === "chat" && !request.editTarget && text.length > 0 && text.length <= 600
    && /^(?:what|which|how|why|is|are|explain|summari[sz]e|was|welche[rsn]?|wie|warum|ist|sind|erklar\w*|fass\w*)\b/iu.test(match)
    && /\b(?:fees?|gebuhr\w*|verteilung|split|rules?|regeln?|design|entwurf|mechanism\w*|mechanis\w*)\b/iu.test(match)
    && !/(?:https?:\/\/|[{}\[\]`]|\b(?:change|add|remove|delete|replace|set|raise|reduce|make|create|build|fix|update|deploy|launch|mint|send|transfer|withdraw|claim|execute|approve|disable|enable|start|stop|ander\w*|hinzufug\w*|entfern\w*|losch\w*|ersetz\w*|setz\w*|erhoh\w*|reduzier\w*|senk\w*|bau\w*|erstell\w*|starte\w*|aktualisier\w*|sende\w*|uberweis\w*|mach\w*|zahl\w*)\b)/iu.test(match);
}
