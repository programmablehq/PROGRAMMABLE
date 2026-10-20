"use client";

import Link from "next/link";
import { RobinhoodMarketView } from "./robinhood-market-view";
import type { BaseExploreToken } from "@/lib/server/base-explore";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

export function BaseTokenView({ address, token, presentation, status }: {
  address: string;
  token: BaseExploreToken | null;
  presentation: RobinhoodCoinPresentation | null;
  status: "ready" | "stale";
}) {
  if (!token) return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore/base">Back to Explore</Link>
    <section className={styles.empty}>
      <h1>{status === "ready" ? "Launch not found" : "Token details are temporarily unavailable"}</h1>
      <p>This address has not been confirmed in the Base launch index.</p>
      <a href={`https://basescan.org/token/${address}`} target="_blank" rel="noreferrer">View on Basescan</a>
    </section>
  </div>;
  return <RobinhoodMarketView chainId={8453} address={token.tokenAddress} name={token.name} symbol={token.symbol}
    launch={token} presentation={presentation}
    trade={<section aria-label="Trade on Base">
      <h2>Trade {token.symbol}</h2>
      <p>This coin trades on Uniswap v4 on Base.</p>
      <a className={styles.secondaryButton}
        href={`https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${token.tokenAddress}`}
        target="_blank" rel="noreferrer">Open Uniswap<span className="sr-only"> (opens in a new tab)</span></a>
    </section>} />;
}
