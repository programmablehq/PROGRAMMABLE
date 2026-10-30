import type { Draft } from "@/lib/custom-ai/types";
import { summarizeRules } from "@/lib/custom-ai/rule-summary";
import styles from "./workspace.module.css";

const percent = (bps: number) => `${bps / 100}%`;
function timeLabel(seconds: number) {
  if (!seconds) return "At launch";
  const parts = [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]] as const;
  const label: string[] = [];
  for (const [unit, suffix] of parts) {
    const value = Math.floor(seconds / unit);
    if (value) label.push(`${value}${suffix}`);
    seconds %= unit;
  }
  return `After ${label.join(" ")}`;
}

export function RuleReview({ draft, pendingChange, disabled, onKeepRules, quoteLabel, onEditRule }: {
  draft?: Draft; pendingChange?: string; reviewed: boolean; disabled: boolean;
  quoteLabel?: string;
  onReview: (checked: boolean) => void; onKeepRules: () => void;
  onEditRule?: (requirementId: string) => void;
}) {
  const verified = draft?.verification;
  if (!draft && !pendingChange) return null;
  const ready = verified?.status === "passed" && verified.sourceHash === draft?.sourceHash && draft?.validation?.status === "passed";
  const times = [...new Set(verified?.checks.map(check => check.afterSeconds))].sort((a, b) => a - b);
  const summary = ready && draft?.composable ? summarizeRules(draft.composable.spec, quoteLabel,draft.composable.feeds) : null;
  return <section className={styles.ruleReview} aria-label="Rules for this coin">
    <h3>{pendingChange ? "Change not applied" : "Rules for this coin"}</h3>
    {pendingChange && <>
      <p>Your latest request has not been applied. {draft ? "The previous rules are shown below." : "Finish the rules in the chat before creating your coin."}</p>
      <p className={styles.pendingRequest}>{pendingChange}</p>
      {draft && <button type="button" className={styles.textButton} disabled={disabled} onClick={onKeepRules}>Keep previous rules</button>}
    </>}
    {ready ? <>
      {summary && <>
        <ol className={styles.ruleTimeline} aria-label="Fee timeline">
          {summary.phases.map(phase => <li key={phase.id}><strong>{phase.time}</strong><p>{phase.rule}</p><small>{phase.until}</small></li>)}
        </ol>
        <h4>Where fees go</h4>
        <ul className={styles.ruleAllocations}>{summary.allocations.map(action => <li key={action.id}><strong>{action.title}</strong><p>{action.detail}</p></li>)}</ul>
        <p>{summary.dataNotice}</p>
        <p>Automatic execution also depends on a running service and its available budget.</p>
      </>}
      {draft?.feed && <p>Data source: <a href={draft.feed.sourceUrl} target="_blank" rel="noopener noreferrer">{draft.feed.title}</a>. Stale or unavailable observations reduce total fees to 0.5%.</p>}
      {draft?.program && <p>{draft.program.spec.rewardShareBps / 100}% of additional fees fund {draft.program.spec.kind}.
        {" "}Execution is permissionless; its timing is not guaranteed.
        {!draft.program.available && " This program is prepared for testing; public launch is not enabled yet."}</p>}
      {!summary && <ul>{verified.requirements.map((rule, index) => <li key={index}>{rule}</li>)}</ul>}
      {draft?.composable && onEditRule && <details>
        <summary>Edit a rule</summary>
        <ul className={styles.ruleEditList}>{draft.composable.spec.requirements.map(rule => <li key={rule.id}>
          <span>{rule.text}</span><button type="button" disabled={disabled} onClick={() => onEditRule(rule.id)} aria-label={`Edit rule: ${rule.text}`}>Edit</button>
        </li>)}</ul>
      </details>}
      <details><summary>Checked fee examples</summary>
        <p>Total fees include the 0.5% platform fee. These examples were checked for buys and sells on both supported networks.</p>
        <table><caption className={styles.srOnly}>Fees by time after launch</caption>
          <thead><tr><th scope="col">Time / condition</th><th scope="col">Buy</th><th scope="col">Sell</th></tr></thead>
          <tbody>{summary ? verified.checks.map((check, index) => <tr key={index}><th scope="row">{timeLabel(check.afterSeconds)}<br />{check.feeds?.map(f => `${f.feedId}: ${f.fresh ? f.value : "unavailable"}`).join(" · ")}</th><td>{check.buy ? percent(check.totalFeeBps) : "—"}</td><td>{!check.buy ? percent(check.totalFeeBps) : "—"}</td></tr>) : draft?.feed ? verified.checks.map((check, index) => <tr key={index}><th scope="row">{check.feedFresh ? `${check.feedValue} ${draft.feed!.unit}` : "Data unavailable"}</th><td>{check.buy ? percent(check.totalFeeBps) : "—"}</td><td>{!check.buy ? percent(check.totalFeeBps) : "—"}</td></tr>) : times.map(time => <tr key={time}><th scope="row">{timeLabel(time)}</th>{[true, false].map(buy => {
            const check = verified.checks.find(value => value.afterSeconds === time && value.buy === buy);
            return <td key={String(buy)}>{check ? percent(check.totalFeeBps) : "—"}</td>;
          })}</tr>)}</tbody>
        </table>
      </details>
      <p className={styles.note}>Your launch confirms these exact rules.</p>
    </> : draft && <p>Ask the chat to check this saved draft against your intended rules before creating the coin.</p>}
  </section>;
}
