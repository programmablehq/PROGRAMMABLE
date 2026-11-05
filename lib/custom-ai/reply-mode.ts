import type { ChatRequest } from "./types";
import { isDiscoveryQuestion } from "./discovery-question";

/** Current reply routing and request charging live here, separate from shared types. */
export function isBriefChat(request: ChatRequest): boolean {
  if (isDiscoveryQuestion(request)) return true;
  // In an existing design, "okay" can accept a pending economic decision.
  // Leave those confirmations to the planner; greetings and thanks are inert.
  if ((request.contextId || request.draftId || request.messages.length > 1)
    && /^(ok|okay|cool)[!. ]*$/i.test(request.messages.at(-1)?.content.trim() ?? "")) return false;
  return request.intent === "chat"
    && /^(hi|hello|hey|hallo|moin|guten morgen|guten abend|danke|dankeschön|merci|salut|bonjour|hola|gracias|ciao|grazie|thanks|thank you|ok|okay|cool|good morning|good evening)[!. ]*$/i
      .test(request.messages.at(-1)?.content.trim() ?? "");
}

