import { memo } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import type { LaunchIntent } from "@/lib/custom-ai/launch-intent";
import styles from "./workspace.module.css";

export const BuildOutcome = memo(function BuildOutcome({ name, symbol, network, rules, onLaunch, disabled }: {
  name: string; symbol: string; network: string; rules: LaunchIntent["requirements"];
  onLaunch: () => void; disabled: boolean;
}) {
  return <section className={styles.buildOutcome} aria-label="Your built hook">
    <div className={styles.outcomeStatus}><Check size={16} aria-hidden="true" />Built and checked</div>
    <h2>{name || "Your hook"}{symbol && <span translate="no"> ${symbol}</span>}</h2>
    <p>{network} · Ready to prepare your launch</p>
    <details className={styles.outcomeRules}>
      <summary>{rules.length} saved {rules.length === 1 ? "rule" : "rules"}</summary>
      <ul>{rules.map(rule => <li key={rule.id}>{rule.text}</li>)}</ul>
    </details>
    <button type="button" className={styles.outcomeLaunch} onClick={onLaunch} disabled={disabled}>
      Launch coin<ArrowUpRight size={17} aria-hidden="true" />
    </button>
    <small>You can keep making changes. Nothing is sent without your wallet confirmation.</small>
  </section>;
});
