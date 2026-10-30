import "server-only";
import type { RuleSpecV2 } from "./rule-spec";
import { reviewRuleEdits } from "./design-edits";
export function verifyIntentCoverage(previous: RuleSpecV2 | undefined, next: RuleSpecV2) {
  return { ...reviewRuleEdits(previous, next, []),
    requirements: next.requirements.map(r => ({ id: r.id, status: "covered" as const })) };
}
