"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { fetchFoundationAvailability } from "@/lib/module-foundation/availability";
import { ChainMark } from "./chain-mark";
import { useRobinhoodPresentation } from "./use-robinhood-presentation";
import { SwapPanel } from "@/components/swap-panel";
import { ResponsiveTradePanel } from "@/components/responsive-trade-panel";
import { LaunchPairModules } from "@/components/launch-pair-modules";
import { TokenPoolChart } from "@/components/robinhood-chart";
import { ArrowLeft, ArrowUpRight, Check, Copy } from "lucide-react";
import { RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { coinDollars, coinPairTicker, coinValuation, type RobinhoodCoinMarket, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { ethereumPairPresentation, launchPresentationDetails } from "@/lib/launch-presentation-details";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import styles from "./robinhood-token-view.module.css";

export function EthereumTokenView({ address, token, status, updatedAt, market: initialMarket, initialPresentation }: {
  address: string;
  token: CanonicalTokenExploreEntry | null;
  status: "ready" | "stale" | "partial" | "unavailable";
  updatedAt: string | null;
  market?: RobinhoodCoinMarket | null;
  initialPresentation?: Promise<RobinhoodCoinPresentation | null>;
}) {
  const seed = useMemo(() => initialPresentation ?? (initialMarket && token ? Promise.resolve({
    chainId: 1 as const, tokenAddress: address, imageUrl: token.imageUrl ?? null, description: token.description ?? null,
    name: token.name, symbol: token.symbol,
    links: (token.links ?? []).map(link => ({ label: link.kind, url: link.url })), market: initialMarket,
  }) : undefined), [address, token, initialMarket, initialPresentation]);
  const presentation = useRobinhoodPresentation(`token=${encodeURIComponent(address)}`, token !== null, seed, 1);
  const display = presentation.items.find(item => item.chainId === 1 && item.tokenAddress.toLowerCase() === address.toLowerCase());
  const market = display?.market ?? null;
  const name = display?.name ?? token?.name ?? "Unnamed token";
  const symbol = display?.symbol ?? token?.symbol;
  const launch = { tokenAddress: address, poolId: token?.poolId, ...(token ? ethereumPairPresentation(token) : {}) };
  const pairMarket = market;
  const pair = launchPresentationDetails(launch, 1, pairMarket).pair;
  const imageUrl = display ? display.imageUrl : token?.imageUrl;
  const description = display ? display.description : token?.description;
  const links = display?.links ?? token?.links?.map(link => ({ label: link.kind, url: link.url })) ?? [];
  const [copyResult, setCopyResult] = useState<{ address: string; state: "copied" | "failed" } | null>(null);
  const copyState = copyResult?.address === address ? copyResult.state : null;
  const [stampCheck, setStampCheck] = useState<{ address: string; missing: boolean } | null>(null);
  const stampMissing = !token && stampCheck?.address === address && stampCheck.missing;
  useEffect(() => {
    if (token) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchFoundationAvailability(controller.signal, getAddress(address), 1);
        if (!controller.signal.aborted) setStampCheck({ address, missing: result.stampMissing === true });
      } catch {
        // A failed provider read must never label a coin as unstamped.
      }
    })();
    return () => controller.abort();
  }, [address, token]);
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
    <Link className={styles.back} href="/explore"><ArrowLeft aria-hidden="true" size={16} />Back to Explore</Link>
    {token ? <article className={styles.market}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <RobinhoodCoinArtwork className={styles.avatar} imageUrl={imageUrl} eager />
          <div className={styles.identityText}>
            <div className={styles.nameRow}><h1>{name}</h1>
              <span className={styles.ticker} aria-label="Token and quote pair" title={pair?.address}>{coinPairTicker(symbol, pair?.label)}</span><ChainMark chainId={1} className={styles.chainLogo} />
              {links.length ? <RobinhoodProjectLinks links={links} name={name} /> : null}
            </div>
            <LaunchPairModules launch={launch} chainId={1} market={pairMarket}
              showPair={false} className={styles.launchProperties} />
            {description ? <p className={styles.bio}>{description}</p> : null}
          </div>
        </div>
        <button className={`${styles.secondaryButton} ${styles.copyButton}`} onClick={copyAddress} type="button" title={address}>
          {copyState === "copied" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copyState === "copied" ? "Copied" : "Copy address"}
        </button>
      </header>
      <p className="sr-only" role="status">{copyState === "copied" ? "Contract address copied" : ""}</p>
      {copyState === "failed" ? <p className={styles.notice} role="status">Could not copy. <a href={`https://etherscan.io/token/${address}`} target="_blank" rel="noreferrer">View the address on Explorer.</a></p> : null}
      <section className={styles.launchContext} aria-label="Programmable launch">
        <div><p className={styles.origin}>Programmable · {token.launchCategoryProvenance.category === "classic" ? "Classic" : "Custom"}</p>
          <p className={styles.launchDetails}>
            <span>Launched <time dateTime={token.launchedAt}>{new Date(token.launchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></span>
            {token.launchBlockNumber ? <span>Block {token.launchBlockNumber}</span> : null}
            {token.launchTransactionHash ? <a href={`https://etherscan.io/tx/${token.launchTransactionHash}`} target="_blank" rel="noreferrer">Launch transaction<span className="sr-only"> (opens in a new tab)</span></a> : null}
            {token.creatorAddress ? <a href={`https://etherscan.io/address/${token.creatorAddress}`} target="_blank" rel="noreferrer">Creator wallet<span className="sr-only"> (opens in a new tab)</span></a> : null}
          </p>
        </div>
      </section>
      {status !== "ready" ? <p className={styles.notice} role="status">{status === "partial" ? "This token is verified. Some Ethereum launches are temporarily unavailable." : "Showing this token from the last verified index."}
        {updatedAt ? <> Updated <time dateTime={updatedAt} title={new Date(updatedAt).toUTCString()}>{new Date(updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time>.</> : null}
      </p> : null}
      <dl className={styles.metrics}>
        <div><dt>Price</dt><dd>{coinDollars(market?.priceUsd, true)}</dd></div>
        <div><dt title={coinValuation(market).title}>{coinValuation(market).label}</dt><dd>{coinDollars(coinValuation(market).value)}</dd></div>
        <div><dt>Liquidity</dt><dd>{coinDollars(market?.liquidityUsd)}</dd></div>
        <div><dt>24h volume</dt><dd>{coinDollars(market?.volume24hUsd)}</dd></div>
      </dl>
      <div className={styles.tradingLayout}>
        <TokenPoolChart tokenAddress={address} poolId={token.poolId} name={name} chainId={1} market={market} />
        <ResponsiveTradePanel symbol={symbol}><SwapPanel key={`1:${address.toLowerCase()}`} embedded initialAddress={address} initialChainId={1} tokenSymbol={symbol} /></ResponsiveTradePanel>
      </div>
    </article> : <section className={styles.empty}>
      <h1>{stampMissing ? "No Programmable launch stamp" : status === "ready" ? "Launch not found" : "Token details are temporarily unavailable"}</h1>
      <p>{stampMissing ? "This token was deployed without a Programmable launch stamp. Contact the project team." : status === "ready" ? "This address is not in the verified Ethereum launch index." : "The Ethereum launch index could not confirm this address. Try again shortly."}</p>
      <a href={`https://etherscan.io/token/${address}`} target="_blank" rel="noreferrer">View address on Etherscan<ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span></a>
    </section>}
  </div>;
}
