"use client";
import type { LaunchIntent } from "@/lib/custom-ai/launch-intent";
import styles from "./workspace.module.css";

type Rule = { id: string; text: string; open?: string | null };

/** Shared by fee designs and general source projects. Change labels describe
 * the saved intent revision, never contract verification or launch readiness. */
export function RequestedRules({ rules, changes = [], disabled, onEditRule }: {
  rules: readonly Rule[]; changes?: LaunchIntent["changes"]; disabled: boolean;
  onEditRule?: (id: string) => void;
}) {
  const byId = new Map(changes.map(change => [change.requirementId, change.operation]));
  const removed = changes.filter(change => change.operation === "remove" && !rules.some(rule => rule.id === change.requirementId)).length;
  return <>
    <ul className={styles.ruleEditList} aria-label="Requested rules">
      {rules.map(rule => <li key={rule.id}>
        <div className={styles.ruleBody}>
          <span>{rule.text}</span>
          {(byId.get(rule.id) === "add" || byId.get(rule.id) === "replace" || rule.open) && <div className={styles.ruleLabels}>
            {byId.get(rule.id) === "add" && <small>Added</small>}
            {byId.get(rule.id) === "replace" && <small>Updated</small>}
            {rule.open && <small>Open choice</small>}
          </div>}
          {rule.open && <p className={styles.ruleQuestion}>{rule.open}</p>}
        </div>
        {onEditRule && <button type="button" disabled={disabled} onClick={() => onEditRule(rule.id)} aria-label={`Edit rule: ${rule.text}`}>Edit</button>}
      </li>)}
    </ul>
    {removed > 0 && <p className={styles.note}>{removed === 1 ? "1 rule removed" : `${removed} rules removed`} in this revision.</p>}
  </>;
}
