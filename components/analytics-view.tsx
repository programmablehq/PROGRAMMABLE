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

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className={styles.metric}><h2>{label}</h2><p className={styles.value} title={detail}>{value}</p></article>;
}

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const s = summarize(data, "all", "all");
  return <section className={styles.page}>
    <header className={styles.header}><h1>Analytics</h1></header>
    <div className={styles.grid}>
      <Metric label="Trading Volume" value={compact(s.volume, true)} detail={`${exact(s.volume)} USD${s.unpricedSwaps ? " · priced subtotal" : ""}`} />
      <Metric label="Protocol Revenue" value={compact(s.revenue, true)} detail={`${exact(s.revenue)} USD${s.unpricedClaims ? " · priced subtotal" : ""}`} />
      <Metric label="V4 Bought Back" value={compact(s.bought)} detail={`${exact(s.bought)} V4`} />
      <Metric label="V4 Burned" value={compact(s.burned)} detail={`${exact(s.burned)} V4`} />
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
    <footer className={styles.footer}>
      <p>All-time data from Ethereum and Robinhood. Figures may lag or vary; USD totals exclude activity without price data. V4 totals refer to the current Programmable token.</p>
      <p>We charge a 0.3% platform fee on every launch across both chains. 100% of these collected fees go toward buybacks of our own Programmable (V4) token.</p>
      <a href="https://dune.com/programmablehq/analytics" target="_blank" rel="noreferrer">Our Dune Analytics dashboard</a>
    </footer>
  </section>;
}
