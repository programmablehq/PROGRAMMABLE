import type { ChatRequest } from "./types";
import { isDiscoveryQuestion } from "./discovery-question";

/** Conversation-only wording stays separate from contract-generation prompts. */
export const BRIEF_REPLY_RULES = `Answer directly in the user's language, like a helpful builder. A greeting or acknowledgement needs one short sentence. For a question about what we could build, offer two or three distinct ideas, each in one plain sentence about what the coin does. Normally keep the whole answer within 90 words; expand only when the user asks for detail or more examples. Prefer ideas supported by the supplied capabilities. State a missing integration briefly only when it matters to a suggested idea. Do not append an unrelated technical explanation, price disclaimer, repeated status notice or forced follow-up question. Keep these as suggestions: do not create a specification, change saved rules or metadata, claim a connected external API, build source or request a launch. Retain any limitation that changes whether an idea can work.`;

/** Current reply routing and request charging live here, separate from shared types. */
export function isBriefChat(request: ChatRequest): boolean {
  if (isDiscoveryQuestion(request)) return true;
  // In an existing design, "okay" can accept a pending economic decision.
  // Leave those confirmations to the planner; greetings and thanks are inert.
  if ((request.contextId || request.draftId || request.messages.length > 1)
    && /^(ok|okay|cool)[!. ]*$/i.test(request.messages.at(-1)?.content.trim() ?? "")) return false;
  return request.intent === "chat"
    && /^(hi|hello|hey|yo|hallo|moin|guten morgen|guten abend|danke|dankeschön|merci|salut|bonjour|hola|gracias|ciao|grazie|thanks|thank you|ok|okay|cool|good morning|good evening)[!. ]*$/i
      .test(request.messages.at(-1)?.content.trim() ?? "");
}

