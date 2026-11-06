import { memo } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { LaunchIntent } from "@/lib/custom-ai/launch-intent";
import type { RuleSpecV2 } from "@/lib/custom-ai/rule-spec";
import type { ProductBlueprint } from "@/lib/custom-ai/product/blueprint";
import { Disclosure } from "@/components/disclosure";
import { MechanismSummary } from "./mechanism-summary";
import styles from "./workspace.module.css";

export const BuildOutcome = memo(function BuildOutcome({ name, symbol, network, rules, onLaunch, disabled, actionLabel = "Launch coin", actionVisible = true, detail, spec, product }: {
  name: string; symbol: string; network: string; rules: LaunchIntent["requirements"];
  onLaunch: () => void; disabled: boolean;
  actionLabel?: string; actionVisible?: boolean; detail?: string; spec?: RuleSpecV2; product?: ProductBlueprint;
}) {
  return <section className={styles.buildOutcome} aria-label="Your built hook">
    <div className={styles.outcomeStatus}><Check size={16} aria-hidden="true" />Built<span>{network}</span></div>
    <h2>{name || "Your hook"}{symbol && <span translate="no"> ${symbol}</span>}</h2>
    <MechanismSummary spec={spec} product={product} />
    {!spec && !product?.flows.length && <ul className={styles.outcomeSummary}>{rules.slice(0, 3).map(rule => <li key={rule.id}>{rule.text}</li>)}</ul>}
    <Disclosure className={styles.outcomeRules}>
      <summary>All rules ({rules.length})</summary>
      <ul>{rules.map(rule => <li key={rule.id}>{rule.text}</li>)}</ul>
    </Disclosure>
    {actionVisible && <>
      {detail && <p className={styles.outcomeDetail}>{detail}</p>}
      <button type="button" className={styles.outcomeLaunch} onClick={onLaunch} disabled={disabled}>
        {actionLabel}<ArrowRight size={17} aria-hidden="true" />
      </button>
    </>}
  </section>;
});
