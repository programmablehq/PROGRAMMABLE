"use client";

import { EVM_CUSTOM_CHAINS, type EvmCustomChainId } from "@/lib/evm-custom-chains";
import type { HyperEvmExploreToken } from "@/lib/server/hyperevm-explore";
import Link from "next/link";
import { EvmCustomSwap } from "./evm-custom-swap";
import { RobinhoodMarketView } from "./robinhood-market-view";
import type { BaseExploreToken } from "@/lib/server/base-explore";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

export function BaseTokenView({ address, token, presentation, status, chainId = token?.chainId ?? 8453 }: {
  address: string;
  token: BaseExploreToken | HyperEvmExploreToken | null;
  chainId?: EvmCustomChainId;
  presentation: RobinhoodCoinPresentation | null;
  status: "ready" | "stale";
}) {
  const network=EVM_CUSTOM_CHAINS[chainId];
  if (!token) return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href={`/explore/${network.slug}`}>Back to Explore</Link>
    <section className={styles.empty}>
      <h1>{status === "ready" ? "Launch not found" : "Token details are temporarily unavailable"}</h1>
      <p>This address has not been confirmed in the {network.name} launch index.</p>
      <a href={`${network.explorer}/token/${address}`} target="_blank" rel="noreferrer">View on {network.explorerName}</a>
    </section>
  </div>;
  return <RobinhoodMarketView chainId={chainId} address={token.tokenAddress} name={token.name} symbol={token.symbol}
    launch={token} presentation={presentation}
    trade={chainId===999?<EvmCustomSwap key={token.tokenAddress} token={token.tokenAddress as `0x${string}`} symbol={token.symbol}/>:<section aria-label={`Trade on ${network.name}`}>
      <h2>Trade {token.symbol}</h2>
      <p>This coin trades on Uniswap v4 on {network.name}.</p>
      <a className={styles.secondaryButton}
        href={`https://app.uniswap.org/swap?chain=${network.uniswapChain}&inputCurrency=NATIVE&outputCurrency=${token.tokenAddress}`}
        target="_blank" rel="noreferrer">Open Uniswap<span className="sr-only"> (opens in a new tab)</span></a>
    </section>} />;
}
