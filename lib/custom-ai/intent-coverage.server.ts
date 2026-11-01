import "server-only";
import type { LaunchIntent } from "./launch-intent";
import { CustomAIError } from "./types";

/** The interpreter identifies its executable subset by stable IDs. Keep the
 * canonical wording in one place; a paraphrase is not a missing capability. */
export function bindIntentImplementation(requirements: readonly { id: string; text: string }[], ids: unknown) {
  const byId = new Map(requirements.map(rule => [rule.id, rule]));
  if (!Array.isArray(ids) || ids.length > requirements.length || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== "string" || !byId.has(id))) {
    throw new CustomAIError("plan", "The proposed implementation could not be matched to your saved rules. Your complete idea is kept.", 502);
  }
  return ids.map(id => ({ id: id as string, text: byId.get(id as string)!.text }));
}

/** Coverage is a mapping to the intended implementation, not an audit verdict.
 * Open requirements are retained even when the executable subset omits them. */
export function intentImplementationGaps(intent: LaunchIntent, implemented: { id?: string; text: string }[]) {
  return intent.requirements.filter(rule => !implemented.some(item => item.text === rule.text && (!item.id || item.id === rule.id))).map(rule => rule.text);
}
