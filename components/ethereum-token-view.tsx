"use client";

import type { SwapTokenDescriptor } from "@/lib/swap/types";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { fetchFoundationAvailability } from "@/lib/module-foundation/availability";
import { useRobinhoodPresentation } from "./use-robinhood-presentation";
import { SwapPanel } from "@/components/swap-panel";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { type RobinhoodCoinMarket, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { ethereumPairPresentation } from "@/lib/launch-presentation-details";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { ConfirmingLaunch } from "@/lib/confirming-launches";
import { RobinhoodMarketView } from "./robinhood-market-view";
import { mergeCoinMetadata } from "@/lib/coin-metadata";
import styles from "./robinhood-token-view.module.css";

export function EthereumTokenView({ address, token, observedLaunch, status, market: initialMarket, initialPresentation, initialSwapToken }: {
  address: string;
  token: CanonicalTokenExploreEntry | null;
  /** Receipt-backed display identity only; never used as swap authorization. */
  observedLaunch?: ConfirmingLaunch;
  status: "ready" | "stale" | "partial" | "unavailable";
  updatedAt: string | null;
  market?: RobinhoodCoinMarket | null;
  initialPresentation?: Promise<RobinhoodCoinPresentation | null>;
  initialSwapToken?: Promise<SwapTokenDescriptor | null>;
}) {
  const identity = token ?? observedLaunch;
  const seed = useMemo(() => initialPresentation ?? (initialMarket && token ? Promise.resolve({
    chainId: 1 as const, tokenAddress: address, imageUrl: token.imageUrl ?? null, description: token.description ?? null,
    name: token.name, symbol: token.symbol,
    links: (token.links ?? []).map(link => ({ label: link.kind, url: link.url })), market: initialMarket,
  }) : undefined), [address, token, initialMarket, initialPresentation]);
  const presentation = useRobinhoodPresentation(`token=${encodeURIComponent(address)}`, Boolean(identity), seed, 1);
  const display = presentation.items.find(item => item.chainId === 1 && item.tokenAddress.toLowerCase() === address.toLowerCase());
  const name = display?.name || identity?.name || "Unnamed token";
  const symbol = display?.symbol || identity?.symbol;
  const metadata = mergeCoinMetadata(display ?? { imageUrl: null, description: null, links: [] }, {
    imageUrl: token?.imageUrl ?? null, description: token?.description ?? null,
    links: token?.links?.map(link => ({ label: link.kind, url: link.url })) ?? [],
  });
  const [stampCheck, setStampCheck] = useState<{ address: string; missing: boolean } | null>(null);
  const stampMissing = !identity && stampCheck?.address === address && stampCheck.missing;
  useEffect(() => {
    if (identity) return;
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
  }, [address, identity]);
  if (identity) return <RobinhoodMarketView chainId={1} address={address} name={name} symbol={symbol}
    launch={{ tokenAddress: address, poolId: identity.poolId,
      ...(token ? ethereumPairPresentation(token) : { quoteAsset: observedLaunch?.quoteAsset }) }}
    presentation={{ chainId: 1, tokenAddress: address, ...metadata, market: display?.market ?? null }}
    loading={presentation.loading} delayed={presentation.delayed}
    trade={<SwapPanel key={`1:${address.toLowerCase()}`} embedded initialDescriptor={initialSwapToken} initialAddress={address} initialChainId={1} tokenSymbol={symbol} />} />;
  return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore"><ArrowLeft aria-hidden="true" size={16} />Back to Explore</Link>
    <section className={styles.empty}>
      <h1>{stampMissing ? "No Programmable launch stamp" : status === "ready" ? "Launch not found" : "Token details are temporarily unavailable"}</h1>
      <p>{stampMissing ? "This token was deployed without a Programmable launch stamp. Contact the project team." : status === "ready" ? "This address is not in the verified Ethereum launch index." : "The Ethereum launch index could not confirm this address. Try again shortly."}</p>
      <a href={`https://etherscan.io/token/${address}`} target="_blank" rel="noreferrer">View address on Etherscan<ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span></a>
    </section>
  </div>;
}
