"use client";

import type { SwapTokenDescriptor } from "@/lib/swap/types";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useEffect } from "react";
import { MODULE_TOKEN_FALLBACK_IMAGE } from "./robinhood-coin-artwork";
import { RobinhoodMarketView } from "./robinhood-market-view";
import { TokenLaunchModules } from "./token-launch-modules";
import { SwapPanel } from "./swap-panel";
import { useRobinhoodPresentation } from "./use-robinhood-presentation";
import { isRobinhoodFoundationLaunch, isRobinhoodModuleLaunch, robinhoodModuleManageHref, type RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

export function RobinhoodTokenView({ address, token, status, initialPresentation, initialSwapToken }: {
  address: string;
  token: RobinhoodLaunch | null;
  status: "ready" | "syncing" | "stale" | "unavailable";
  initialPresentation?: Promise<RobinhoodCoinPresentation | null>;
  initialSwapToken?: Promise<SwapTokenDescriptor | null>;
}) {
  const presentation = useRobinhoodPresentation(`token=${encodeURIComponent(address)}`, token !== null, initialPresentation);
  const details = presentation.items.find(item => item.tokenAddress.toLowerCase() === address.toLowerCase());
  const hasAsset = !token?.launchProjection || token.launchProjection.primaryComponentId !== null;
  const name = token?.name?.trim() || (token?.launchProjection ? "Unnamed contract" : "Unnamed token");
  const moduleLaunch = isRobinhoodModuleLaunch(token) ? token : null;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [address]);

  if (!token) return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore"><ArrowLeft aria-hidden="true" size={16} /> Explore</Link>
    <section className={styles.empty}>
      <h1>Token details</h1>
      <p>{status === "ready" ? "This token is not in the verified Robinhood launch index." : "Robinhood launch details are temporarily unavailable. Try again in a moment."}</p>
      <a href={`https://robinhoodchain.blockscout.com/token/${address}`} target="_blank" rel="noreferrer">View on explorer <ArrowUpRight aria-hidden="true" size={14} /></a>
    </section>
  </div>;

  return <RobinhoodMarketView address={address} name={name} symbol={token.symbol} creator={token.creator} launch={token}
    presentation={details} loading={presentation.loading} delayed={presentation.delayed} hasAsset={hasAsset}
    manageHref={moduleLaunch ? robinhoodModuleManageHref(moduleLaunch) : null} fallbackImageUrl={moduleLaunch ? MODULE_TOKEN_FALLBACK_IMAGE : undefined}
    trade={<SwapPanel key={`4663:${address.toLowerCase()}`} embedded initialDescriptor={initialSwapToken} initialAddress={address} initialChainId={4663} tokenSymbol={token.symbol ?? undefined} />}>
    {moduleLaunch && !isRobinhoodFoundationLaunch(moduleLaunch) ? <TokenLaunchModules launch={moduleLaunch} /> : null}
  </RobinhoodMarketView>;
}
