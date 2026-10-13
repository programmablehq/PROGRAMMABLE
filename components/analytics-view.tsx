"use client";

import { useState } from "react";
import { explorer, summarize, type AnalyticsData, type Chain, type Period } from "@/lib/analytics/model";
import styles from "./analytics-view.module.css";

const compact = (v: number | null, usd = false) => v === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2, ...(usd ? {style:"currency",currency:"USD"} : {}) }).format(v);
const exact = (v: number | null) => v === null ? "Unavailable" : new Intl.NumberFormat("en-US", {maximumFractionDigits: 2}).format(v);
function Metric({ label, value, caption, detail, partial = false }: { label: string; value: string; caption: string; detail: string; partial?: boolean }) {
  return <article className={styles.metric}><h2>{label}</h2><p className={styles.value} title={detail}>{partial && <span className={styles.valueMark}>≥</span>}{value}</p><p className={styles.caption}>{caption}</p></article>;
}
export function AnalyticsView({ data }: {data: AnalyticsData}) {
  const [chain,setChain] = useState<Chain>("all");
  const [period,setPeriod] = useState<Period>("all");
  const s = summarize(data,chain,period);
  const tokenLabel = chain === "Ethereum" ? "Legacy Ethereum V4" : "Current V4 · Robinhood";
  const stamp = s.updatedAt ? new Date(s.updatedAt).toLocaleString("en-GB",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})+" UTC" : "Unavailable";
  return <section className={styles.page}>
    <header className={styles.header}><p className={styles.eyebrow}>Programmable</p><h1>Analytics</h1><p>Ethereum + Robinhood</p></header>
    <div className={styles.controls}>
      <div className={styles.switcher} role="group" aria-label="Blockchain">{(["all","Ethereum","Robinhood"] as const).map(c=><button type="button" key={c} aria-pressed={chain===c} onClick={()=>setChain(c)}>{c==="all" ? "All chains" : c}</button>)}</div>
      <div className={styles.switcher} role="group" aria-label="Period">{([["all","All time"],["7d","7 days"],["30d","30 days"]] as const).map(([id,label])=><button type="button" key={id} aria-pressed={period===id} onClick={()=>setPeriod(id)}>{label}</button>)}</div>
    </div>
    <div className={styles.grid} aria-live="polite" aria-atomic="true">
      <Metric label="Trading Volume" value={compact(s.volume,true)} partial={s.unpricedSwaps>0} detail={exact(s.volume)+" USD"} caption={s.unpricedSwaps ? `Priced volume · ${exact(s.unpricedSwaps)} swaps without a price` : "Main token and all recognized launches"} />
      <Metric label="Protocol Revenue" value={compact(s.revenue,true)} partial={s.unpricedClaims>0} detail={exact(s.revenue)+" USD"} caption={s.unpricedClaims ? `Collected fees · ${exact(s.unpricedClaims)} unpriced claim${s.unpricedClaims===1 ? "" : "s"}` : "Collected fees · excludes creator rewards"} />
      <Metric label="V4 Bought Back" value={compact(s.bought)} detail={exact(s.bought)+" V4"} caption={tokenLabel} />
      <Metric label="V4 Burned" value={compact(s.burned)} detail={exact(s.burned)+" V4"} caption={s.burned === null ? "Historical burn coverage unavailable" : tokenLabel+" · project wallets"} />
    </div>
    <div className={styles.context}>
      {s.launches !== null && <span><strong>{exact(s.launches)}</strong> launches across both chains</span>}
      {chain==="all" && s.legacyBought!==null && s.legacyBought>0 && <span>Legacy Ethereum buybacks: <strong>{exact(s.legacyBought)} V4</strong></span>}
      {chain==="all" && s.legacyBurned!==null && s.legacyBurned>0 && <span>Legacy Ethereum burns: <strong>{exact(s.legacyBurned)} V4</strong></span>}
    </div>
    <section className={styles.activity} aria-labelledby="activity-title"><div className={styles.activityHeader}><h2 id="activity-title">Buybacks & burns</h2><span>Confirmed transactions</span></div>
      {s.activity.length ? <ul>{s.activity.slice(0,10).map(a=><li key={`${a.kind}:${a.chain}:${a.hash}`}><a href={explorer(a)} target="_blank" rel="noreferrer"><span className={styles.kind}>{a.kind}</span><span className={styles.network}>{a.chain}<small>{a.at.slice(0,10)}</small></span><span className={styles.amount} title={exact(a.amount)+" V4"}>{compact(a.amount)} V4</span><span className={styles.arrow} aria-hidden="true">↗</span><span className={styles.srOnly}> View transaction {a.hash}</span></a></li>)}</ul> : <p className={styles.empty}>No recorded transactions in this period.</p>}
    </section>
    <footer className={styles.footer}><p>Updated {stamp}{s.unavailable ? " · Showing last verified data" : ""}</p><details><summary>How these numbers are counted</summary><div><p>Volume counts each observed swap once. Revenue is collected platform fees and the project’s own liquidity fees, not wallet transfers or creator rewards. A ≥ sign marks a priced subtotal where historical prices are missing.</p><p>Buybacks are confirmed purchases by the three project wallets. Burns count their confirmed transfers to burn addresses. Current Robinhood V4 and the historical Ethereum token are shown separately. Sending tokens to a burn address does not necessarily reduce the contract’s totalSupply.</p><p>7 and 30 day views use UTC calendar days, including today. Data comes from the latest completed queries and can lag chain activity. Missing sources retain their last verified figures and timestamps.</p><p>80% of eligible collected fee revenue is allocated to manual buybacks and burns. This policy is not itself a purchase.</p><a href="https://dune.com/programmablehq/analytics" target="_blank" rel="noreferrer">View source queries ↗</a></div></details></footer>
  </section>;
}
