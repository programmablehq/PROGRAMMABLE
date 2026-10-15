import { explorer, summarize, type AnalyticsData } from "@/lib/analytics/model";
import styles from "./analytics-view.module.css";
import { AnalyticsRelativeTime } from "./analytics-relative-time";

const compact = (value: number | null, usd = false) => value === null ? "—" : new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  ...(usd ? { style: "currency", currency: "USD" } : {}),
}).format(value);
const exact = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
}).format(value);

function Metric({ label, icon, value, detail, description, suffix }: { label: string; icon?: string; value: string; detail: string; description: string; suffix?: string | null }) {
  return <article className={styles.metric}><h2>{icon && <span className={styles.metricIcon} aria-hidden="true">{icon}</span>}{label}</h2><p className={styles.value} title={detail}>{value}{suffix && <span className={styles.supplyShare}>/ {suffix}</span>}</p><p className={styles.description}>{description}</p></article>;
}

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const s = summarize(data, "all", "all");
  const renderedAt = data.renderedAt ?? Date.parse(s.updatedAt);
  return <section className={styles.page}>
    <header className={styles.header}>
      <h1>Analytics</h1>
      <p className={styles.intro}>All-time activity across Ethereum and Robinhood. Platform fees are 0.3%. We use 80% of collected fee revenue for V4 buybacks and burns.</p>
      <p className={styles.dataNote}>Buybacks show historical USD spent by our tracked project wallets. Burns also include V4 collected as liquidity fees. <a href="https://dune.com/programmablehq/analytics" target="_blank" rel="noreferrer">Our Dune dashboard</a></p>
    </header>
    <div className={styles.grid}>
      <Metric label="Ecosystem Trading Volume" value={compact(s.volume, true)} detail={`${exact(s.volume)} USD${s.unpricedSwaps ? " · priced subtotal" : ""}`} description="Main coin and all platform launches on both chains." />
      <Metric label="Buybacks" icon="💵" value={compact(s.buybackSpendUsd, true)} detail={`${exact(s.buybackSpendUsd)} USD spent at purchase time`} description="Actual purchase costs across Ethereum and Robinhood." />
      <Metric label="V4 Burned" icon="🔥" value={compact(s.burned)} detail={`${exact(s.burned)} V4 · share of the original 1 billion V4 supply`} description="Current V4 sent to the burn address, including liquidity fees." suffix={s.burnedSupplyPercent === null ? null : `${s.burnedSupplyPercent.toFixed(1)}% supply`} />
    </div>
    <section className={styles.activity} aria-labelledby="activity-title">
      <h2 id="activity-title">Activity</h2>
      {s.activity.length ? <ul>{s.activity.slice(0, 10).map(a => <li key={`${a.kind}:${a.chain}:${a.hash}`}>
        <a href={explorer(a)} target="_blank" rel="noreferrer">
          <span className={styles.kind}><span aria-hidden="true">{a.kind === "Buyback" ? "💵" : "🔥"}</span><span className={styles.srOnly}>{a.kind}</span></span>
          <span className={styles.amount} title={`${exact(a.amount)} V4${a.usd == null ? "" : ` · approximately ${exact(a.usd)} USD at transaction time`}`}>
            {compact(a.amount)} V4 <span className={styles.dollarValue}>/ {a.usd == null ? "USD unavailable" : `≈${compact(a.usd,true)}`}</span>
          </span>
          <span className={styles.network}>{a.chain}<small><AnalyticsRelativeTime at={a.at} renderedAt={renderedAt} /></small></span>
          <span className={styles.srOnly}> View transaction {a.hash}</span>
        </a>
      </li>)}</ul> : <p className={styles.empty}>No recorded transactions.</p>}
    </section>
  </section>;
}
