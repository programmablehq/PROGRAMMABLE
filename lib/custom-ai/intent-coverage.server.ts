import "server-only";
import type { LaunchIntent } from "./launch-intent";

/** Coverage is a mapping to the intended implementation, not an audit verdict.
 * Open requirements are retained even when the executable subset omits them. */
export function intentImplementationGaps(intent: LaunchIntent, implemented: { id?: string; text: string }[]) {
  return intent.requirements.filter(rule => !implemented.some(item => item.text === rule.text && (!item.id || item.id === rule.id))).map(rule => rule.text);
}
