import "server-only";
import type { RuleSpecV2 } from "./rule-spec";
export function verifyIntentCoverage(previous: RuleSpecV2 | undefined, next: RuleSpecV2) {
  const retained = new Set(next.requirements.map(r => r.id));
  const missing = (previous?.requirements ?? []).filter(r => !retained.has(r.id));
  return { complete: missing.length === 0, missing: missing.map(r => r.text),
    requirements: next.requirements.map(r => ({ id: r.id, status: "covered" as const })) };
}
