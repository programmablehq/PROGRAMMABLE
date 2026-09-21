"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatedMarketCap } from "./animated-market-cap";
import { RobinhoodChart } from "./robinhood-chart";
import { RobinhoodCoinArtwork } from "./robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "./robinhood-project-links";
import { LaunchPairModules } from "./launch-pair-modules";
import { ResponsiveTradePanel } from "./responsive-trade-panel";
import type { LaunchPresentationSource } from "@/lib/launch-presentation-details";
import { coinDollars, coinTicker, coinValuation, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";

/** Shared market presentation; each launch family supplies its own verified trade adapter. */
export function RobinhoodMarketView({ address, name, symbol, creator, launch, presentation, loading = false,
  delayed = false, status = "ready", hasAsset = true, manageHref, fallbackImageUrl, trade, children }: {
  address: string;
  name: string;
  symbol?: string | null;
  creator?: string;
  launch?: LaunchPresentationSource;
  presentation?: RobinhoodCoinPresentation | null;
  loading?: boolean;
  delayed?: boolean;
  status?: "ready" | "syncing" | "stale" | "unavailable";
  hasAsset?: boolean;
  manageHref?: string | null;
  fallbackImageUrl?: string;
  trade: ReactNode;
  children?: ReactNode;
}) {
  const market = presentation?.market;
  const valuation = coinValuation(market);
  const change = market?.change24hPercent;
  const description = presentation?.description?.trim();
  const explorerHref = `${EXPLORER}/${launch?.launchProjection ? "address" : "token"}/${address}`;
  const [copyResult, setCopyResult] = useState<{ address: string; state: "copied" | "failed" } | null>(null);
  const copyState = copyResult?.address === address ? copyResult.state : "idle";

  useEffect(() => {
    if (!copyResult) return;
    const timer = setTimeout(() => setCopyResult(null), 3_000);
    return () => clearTimeout(timer);
  }, [copyResult]);

  async function copyAddress() {
    try { await navigator.clipboard.writeText(address); setCopyResult({ address, state: "copied" }); }
    catch { setCopyResult({ address, state: "failed" }); }
  }

  return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore/robinhood"><ArrowLeft aria-hidden="true" size={16} /> Explore</Link>
    <section className={styles.market} aria-label={`${name} ${hasAsset ? "market" : "launch"}`}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <RobinhoodCoinArtwork className={styles.avatar} imageUrl={presentation?.imageUrl} loading={loading} eager fallbackImageUrl={fallbackImageUrl} />
          <div className={styles.identityText}>
            <div className={styles.nameRow}>
              <h1>{name}</h1>
              {presentation?.links.length ? <RobinhoodProjectLinks links={presentation.links} name={name} /> : null}
            </div>
            <p className={styles.subtitle}>{hasAsset ? <span>{coinTicker(symbol ?? null)}</span> : null}<span>Robinhood</span></p>
            {launch ? <LaunchPairModules launch={launch} chainId={4663} market={market} className={styles.launchProperties} /> : null}
            {description && description.toLowerCase() !== name.trim().toLowerCase() ? <p className={styles.bio}>{description}</p> : null}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.secondaryButton} ${styles.copyButton}`} onClick={copyAddress} type="button" title={address}>
            {copyState === "copied" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
            {copyState === "copied" ? "Copied" : "Copy address"}
          </button>
          {creator && /^0x(?!0{40}$)[\da-f]{40}$/i.test(creator) ? <Link className={styles.secondaryButton} href={`/profile?account=${creator}&chain=4663`} prefetch={false} title={`Dev wallet: ${creator}`}>Dev wallet</Link> : null}
          <a className={styles.secondaryButton} href={explorerHref} target="_blank" rel="noreferrer">Explorer <ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span></a>
        </div>
      </header>
      <p className="sr-only" role="status">{copyState === "copied" ? "Contract address copied" : ""}</p>
      {copyState === "failed" ? <p className={styles.notice} role="status">Could not copy. <a href={explorerHref} target="_blank" rel="noreferrer">View the address on Explorer.</a></p> : null}

      <section className={styles.launchContext} aria-label="Programmable launch">
        <div><p className={styles.contractAddress}><span>CA</span><code>{address}</code></p></div>
        {manageHref ? <div className={styles.launchActions}><Link className={styles.secondaryButton} href={manageHref} prefetch={false} aria-label="Manage coin">Manage <ArrowRight aria-hidden="true" size={16} /></Link></div> : null}
      </section>
      {status !== "ready" ? <p className={styles.notice} role="status">{status === "syncing"
        ? `New launches are still being checked. This ${hasAsset ? "coin" : "launch"} comes from the verified launch index.`
        : "Showing the last verified launch record. Index updates are temporarily unavailable."}</p> : null}

      {hasAsset ? <>
        <dl className={styles.metrics}>
          <Metric label="Price" value={coinDollars(market?.priceUsd, true)} />
          <Metric label={valuation.label} title={valuation.title} value={market && valuation.value !== null
            ? <AnimatedMarketCap metric={{ kind: "usd", value: valuation.value }} replayKey={`4663:${address.toLowerCase()}:${market.poolId.toLowerCase()}:${valuation.label}`} /> : "—"} />
          <Metric label="Liquidity" value={coinDollars(market?.liquidityUsd)} />
          <Metric label="24h volume" value={coinDollars(market?.volume24hUsd)} />
          <div><dt>24h change</dt><dd className={styles.change} data-direction={change != null && change < 0 ? "down" : change != null && change > 0 ? "up" : "flat"}>
            {change != null && Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
          </dd></div>
        </dl>
        {delayed ? <p className={styles.notice} role="status">{market ? "Price updates are delayed." : "Market data is temporarily unavailable."}</p> : null}
        <div className={styles.tradingLayout}>
          {launch?.poolId ? <RobinhoodChart poolId={launch.poolId} name={name} market={market} /> : <div className={styles.chart}><p className={styles.chartState}>No trading market is verified for this coin.</p></div>}
          <ResponsiveTradePanel symbol={symbol ?? undefined}>{trade}</ResponsiveTradePanel>
        </div>
      </> : <p className={styles.notice}>No primary asset is declared for this launch.</p>}
      {children}
    </section>
  </div>;
}

function Metric({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return <div><dt title={title}>{label}</dt><dd title={typeof value === "string" ? value : undefined}>{value}</dd></div>;
}
