import type { CSSProperties } from "react";
import type { RuleSpecV2 } from "@/lib/custom-ai/rule-spec";
import type { ProductBlueprint } from "@/lib/custom-ai/product/blueprint";
import { feeSchedulePoints, productAllocations, type AllocationVisual } from "@/lib/custom-ai/rule-visuals";
import { feePercent, ruleDuration } from "@/lib/custom-ai/rule-summary";
import styles from "./workspace.module.css";

function Allocation({ label, shares }: AllocationVisual) {
  const allocated = shares.reduce((sum, share) => sum + share.bps, 0);
  return <figure className={styles.allocationFigure}>
    <figcaption>{label}</figcaption>
    <div className={styles.allocationBar} aria-hidden="true">{shares.map((share, index) => <span key={`${share.label}:${index}`} style={{ width: `${share.bps / 100}%`, "--share-tone": .95 - Math.min(index, 4) * .16 } as CSSProperties} />)}</div>
    <ul>{shares.map((share, index) => <li key={`${share.label}:${index}`}><span>{share.label}</span><strong>{feePercent(share.bps)}</strong></li>)}
      {allocated < 10000 && <li><span>Not assigned</span><strong>{feePercent(10000 - allocated)}</strong></li>}</ul>
  </figure>;
}

export function MechanismSummary({ spec, product }: { spec?: RuleSpecV2; product?: ProductBlueprint }) {
  const points = spec ? feeSchedulePoints(spec) : null;
  const first = points?.[0], last = points?.at(-1);
  const different = points?.some(point => point.buyBps !== point.sellBps);
  const changing = points?.some(point => point.buyBps !== first?.buyBps || point.sellBps !== first?.sellBps);
  const maximum = points ? Math.max(1, ...points.flatMap(point => [point.buyBps, point.sellBps])) : 1;
  const horizon = last?.seconds ?? 1;
  const path = (side: "buyBps" | "sellBps") => points!.map(point => `${8 + point.seconds / horizon * 284},${84 - point[side] / maximum * 68}`).join(" ");
  const changeAt = points?.findLast(point => point.seconds < horizon)?.seconds ?? 0;
  const shares = spec ? [
    ...(spec.creatorShareBps ? [{ label: "Creator", bps: spec.creatorShareBps }] : []),
    ...spec.actions.map(action => ({ label: { liquidity: "Locked liquidity", buyback: "Buyback", staking: "Staking rewards", distribution: "Distribution" }[action.kind], bps: action.shareBps })),
  ] : [];
  return <div className={styles.mechanismSummary}>
    {first && last && <figure className={styles.feeFigure}>
      <figcaption>Total swap fee{different ? " · buy / sell" : ""}</figcaption>
      <div className={styles.feeNumbers}><strong>{feePercent(first.buyBps)}{different ? ` / ${feePercent(first.sellBps)}` : ""}</strong>
        {changing && <><span aria-hidden="true">→</span><strong>{feePercent(last.buyBps)}{different ? ` / ${feePercent(last.sellBps)}` : ""}</strong></>}</div>
      {changing && <svg viewBox="0 0 300 96" preserveAspectRatio="none" role="img" aria-label={`Planned swap fees. Buys: ${feePercent(first.buyBps)} to ${feePercent(last.buyBps)}. Sells: ${feePercent(first.sellBps)} to ${feePercent(last.sellBps)}. Last change after ${ruleDuration(changeAt)}.`}>
        <path d="M8 84H292" className={styles.chartAxis} />
        <polyline points={path("buyBps")} className={styles.buyLine} />
        {different && <polyline points={path("sellBps")} className={styles.sellLine} />}
      </svg>}
      <div className={styles.chartTimes}><span>{changing ? "At launch" : "Fixed rate"}</span>{changing && <span>After {ruleDuration(changeAt)}</span>}</div>
    </figure>}
    {shares.length > 1 && <Allocation id="project-fees" label="Project fees · after the platform fee" shares={shares} />}
    {!spec && product && productAllocations(product).map(group => <Allocation key={group.id} {...group} />)}
  </div>;
}
