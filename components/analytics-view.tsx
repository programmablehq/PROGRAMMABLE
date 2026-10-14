import { explorer, summarize, type AnalyticsData } from "@/lib/analytics/model";
import styles from "./analytics-view.module.css";

const compact = (value: number | null, usd = false) => value === null ? "—" : new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  ...(usd ? { style: "currency", currency: "USD" } : {}),
}).format(value);
const exact = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
}).format(value);

function Metric({ label, value, detail, description, suffix }: { label: string; value: string; detail: string; description: string; suffix?: string | null }) {
  return <article className={styles.metric}><h2>{label}</h2><p className={styles.value} title={detail}>{value}{suffix && <span className={styles.supplyShare}>/ {suffix}</span>}</p><p className={styles.description}>{description}</p></article>;
}

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const s = summarize(data, "all", "all");
  return <section className={styles.page}>
    <header className={styles.header}>
      <h1>Analytics</h1>
      <p className={styles.intro}>All-time activity across Ethereum and Robinhood. We use 100% of collected 0.3% platform fees to buy back V4.</p>
      <p className={styles.dataNote}>Burns also include V4 collected as liquidity fees, so more V4 can be burned than bought back. <a href="https://dune.com/programmablehq/analytics" target="_blank" rel="noreferrer">Our Dune dashboard</a></p>
    </header>
    <div className={styles.grid}>
      <Metric label="Ecosystem Trading Volume" value={compact(s.volume, true)} detail={`${exact(s.volume)} USD${s.unpricedSwaps ? " · priced subtotal" : ""}`} description="Main coin and all platform launches on both chains." />
      <Metric label="V4 Bought Back" value={compact(s.bought)} detail={`${exact(s.bought)} V4`} description="V4 purchased through buybacks." />
      <Metric label="V4 Burned" value={compact(s.burned)} detail={`${exact(s.burned)} V4 · share of the original 1 billion V4 supply`} description="Purchased V4 plus V4 collected as liquidity fees." suffix={s.burnedSupplyPercent === null ? null : `${s.burnedSupplyPercent.toFixed(1)}% supply`} />
    </div>
    {s.launches !== null && <p className={styles.context}><strong>{exact(s.launches)}</strong> launches across both chains</p>}
    <section className={styles.activity} aria-labelledby="activity-title">
      <h2 id="activity-title">Buybacks &amp; burns</h2>
      {s.activity.length ? <ul>{s.activity.slice(0, 10).map(a => <li key={`${a.kind}:${a.chain}:${a.hash}`}>
        <a href={explorer(a)} target="_blank" rel="noreferrer">
          <span className={styles.kind}>{a.kind}</span>
          <span className={styles.network}>{a.chain}<small>{a.at.slice(0, 10)}</small></span>
          <span className={styles.amount} title={`${exact(a.amount)} V4`}>{compact(a.amount)} V4</span>
          <span className={styles.srOnly}> View transaction {a.hash}</span>
        </a>
      </li>)}</ul> : <p className={styles.empty}>No recorded transactions.</p>}
    </section>
  </section>;
}
