"use client";

import Link from "next/link";
import { ChainMark } from "./chain-mark";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useWalletAddressCopy } from "@/lib/wallet-address-copy";
import { AnimatedMarketCap } from "./animated-market-cap";
import { RobinhoodChart } from "./robinhood-chart";
import { RobinhoodCoinArtwork } from "./robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "./robinhood-project-links";
import { LaunchPairModules } from "./launch-pair-modules";
import { ResponsiveTradePanel } from "./responsive-trade-panel";
import { launchPresentationDetails, type LaunchPresentationSource } from "@/lib/launch-presentation-details";
import { coinDollars, coinPairTicker, coinValuation, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";

/** Shared market presentation; each launch family supplies its own verified trade adapter. */
export function RobinhoodMarketView({ address, name, symbol, launch, presentation, loading = false,
  chainId = 4663, delayed = false, hasAsset = true, manageHref, fallbackImageUrl, trade, children }: {
  chainId?: 1 | 4663 | 8453 | 999;
  address: string;
  name: string;
  symbol?: string | null;
  creator?: string;
  launch?: LaunchPresentationSource;
  presentation?: RobinhoodCoinPresentation | null;
  loading?: boolean;
  delayed?: boolean;
  hasAsset?: boolean;
  manageHref?: string | null;
  fallbackImageUrl?: string;
  trade: ReactNode;
  children?: ReactNode;
}) {
  const market = presentation?.market;
  const pair = launchPresentationDetails(launch ?? { tokenAddress: address, poolId: market?.poolId }, chainId, market).pair;
  const displaySymbol = symbol?.trim() || presentation?.symbol;
  const valuation = coinValuation(market);
  const change = market?.change24hPercent;
  const description = presentation?.description?.trim();
  const explorerHref = `${chainId === 999 ? "https://hyperevmscan.io" : chainId === 8453 ? "https://basescan.org" : chainId === 1 ? "https://etherscan.io" : EXPLORER}/${launch?.launchProjection ? "address" : "token"}/${address}`;
  const { copied, copyUnavailable, copyAddress } = useWalletAddressCopy(address);

  return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore" prefetch><ArrowLeft aria-hidden="true" size={16} /> Explore</Link>
    <section className={styles.market} aria-label={`${name} ${hasAsset ? "market" : "launch"}`}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <RobinhoodCoinArtwork className={styles.avatar} imageUrl={presentation?.imageUrl} loading={loading} eager fallbackImageUrl={fallbackImageUrl} />
          <div className={styles.identityText}>
            <div className={styles.nameRow}>
              <h1>{name}</h1>
              {hasAsset ? <span className={styles.ticker} aria-label="Token and quote pair" title={pair?.address}>{coinPairTicker(displaySymbol, pair?.label)}</span> : null}
              <ChainMark chainId={chainId} className={styles.chainLogo} />
              {presentation?.links.length ? <RobinhoodProjectLinks links={presentation.links} name={name} /> : null}
            </div>
            {launch ? <LaunchPairModules launch={launch} chainId={chainId} market={market} showPair={false} className={styles.launchProperties} /> : null}
            {description && description.toLowerCase() !== name.trim().toLowerCase() ? <p className={styles.bio}>{description}</p> : null}
            <div className={styles.headerActions}>
              <button className={`${styles.secondaryButton} ${styles.copyButton}`} onClick={copyAddress} type="button" title={address}>
                {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                {copied ? "Copied" : "Copy address"}
              </button>
            </div>
          </div>
        </div>
      </header>
      <p className="sr-only" role="status">{copied ? "Contract address copied" : ""}</p>
      {copyUnavailable ? <p className={styles.notice} role="status">Could not copy. <a href={explorerHref} target="_blank" rel="noreferrer">View the address on Explorer.</a></p> : null}

      {manageHref ? <div className={styles.launchActions}><Link className={styles.secondaryButton} href={manageHref} prefetch={false} aria-label="Manage coin">Manage <ArrowRight aria-hidden="true" size={16} /></Link></div> : null}
      {hasAsset ? <>
        <dl className={styles.metrics}>
          <Metric label="Price" value={coinDollars(market?.priceUsd, true)} />
          <Metric label={valuation.label} title={valuation.title} value={market && valuation.value !== null
            ? <AnimatedMarketCap metric={{ kind: "usd", value: valuation.value }} replayKey={`${chainId}:${address.toLowerCase()}:${market.poolId.toLowerCase()}:${valuation.label}`} /> : "—"} />
          <Metric label="Liquidity" title="Liquidity in this coin’s launch pool" value={coinDollars(market?.liquidityUsd)} />
          <Metric label="24h volume" value={coinDollars(market?.volume24hUsd)} />
          <div><dt>24h change</dt><dd className={styles.change} data-direction={change != null && change < 0 ? "down" : change != null && change > 0 ? "up" : "flat"}>
            {change != null && Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
          </dd></div>
        </dl>
        {delayed && !loading && !market ? <p className={styles.notice} role="status">Market data is temporarily unavailable.</p> : null}
        <div className={styles.tradingLayout}>
          {launch?.poolId ? <RobinhoodChart chainId={chainId} tokenAddress={address} poolId={launch.poolId} name={name} market={market} /> : <div className={styles.chart} aria-busy={loading}><p className={styles.chartState} role="status">{loading ? "Loading chart…" : "No trading market is verified for this coin."}</p></div>}
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
