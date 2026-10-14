import { isEthereumModuleLaunchCandidate } from "@/lib/module-foundation/ethereum-release";
import { presentEthereumToken } from "@/lib/server/ethereum-explore";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress, type Hex } from "viem";

import { TokenIndexResetView } from "@/components/token-index-reset-view";
import { RobinhoodTokenView } from "@/components/robinhood-token-view";
import { ModuleFoundationMarketHost } from "@/components/module-foundation-market-host";
import { EthereumTokenView } from "@/components/ethereum-token-view";
import { TokenRouteChainSync } from "@/components/token-route-chain-sync";
import { resolveTokenPage } from "@/lib/server/token-page";
import { readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import { resolveVerifiedLaunchSwapToken } from "@/lib/server/swap/token";
import { genericTokenDetailMetadata } from "@/lib/token-detail-metadata";
import { tokenDetailPageChainId } from "@/lib/token-page-chain";
import { isRobinhoodFoundationLaunch, robinhoodLaunchDescription } from "@/lib/robinhood-launches";
import { ethereumFoundationPresentation } from "@/lib/launch-presentation-details";
import { findRecentFoundationLaunch } from "@/lib/server/module-foundation/recent-launch-store";
import { readConfirmingEthereumLaunches } from "@/lib/server/confirming-launches";
import { liveLaunchObservations } from "@/lib/confirming-launches";
import { ConfirmingLaunchView } from "@/components/confirming-launch-view";

type TokenPageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}): Promise<Metadata> {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (isAddress(address) && tokenDetailPageChainId(resolvedSearchParams.chain) !== null) {
    const resolved = await resolveTokenPage(address, resolvedSearchParams.chain);
    if (resolved?.chainId === 1 && resolved.token) return {
      title: `${resolved.token.name || address} · Programmable`,
      description: resolved.token.description || "Verified Programmable launch on Ethereum.",
      alternates: { canonical: `/token/${resolved.token.tokenAddress}?chain=1` },
    };
    const token = resolved?.chainId === 4663 ? resolved.token : null;
    if (token) return {
      title: `${token.name || address} · Programmable`,
      description: robinhoodLaunchDescription(token),
      alternates: { canonical: `/token/${token.tokenAddress}` },
    };
    const chainId = resolvedSearchParams.chain === "1" ? 1 : 4663;
    const recent = await findRecentFoundationLaunch(chainId, address).catch(() => null);
    if (recent) return {
      title: `${recent.row.name || address} · Programmable`,
      description: `Programmable launch on ${chainId === 1 ? "Ethereum" : "Robinhood Chain"}.`,
      alternates: { canonical: `/token/${recent.row.tokenAddress}${chainId === 1 ? "?chain=1" : ""}` },
    };
  }
  return genericTokenDetailMetadata(address, true, tokenDetailPageChainId(resolvedSearchParams.chain) ?? 1);
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}) {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !isAddress(address) ||
    tokenDetailPageChainId(resolvedSearchParams.chain) === null
  ) {
    notFound();
  }
  const resolved = await resolveTokenPage(address, resolvedSearchParams.chain);
  if (resolved === null) notFound();
  // Explore can display a receipt-confirmed launch before the finalized index
  // catches up. Use the same verified observation for direct links, without
  // changing the finalized resolver used by transaction and claim readers.
  if (resolved.chainId === null || !resolved.token) {
    const chainId = resolvedSearchParams.chain === "1" ? 1 : 4663;
    const recent = await findRecentFoundationLaunch(chainId, address).catch(() => null);
    if (recent) return <TokenRouteChainSync key={chainId} chainId={chainId}>
      <ModuleFoundationMarketHost chainId={chainId} token={getAddress(address)}
        transactionHash={recent.row.transactionHash as Hex} initialLaunch={recent.row}
        initialName={recent.row.name || undefined} initialPresentation={Promise.resolve(recent.presentation)} />
    </TokenRouteChainSync>;
    if (chainId === 1) {
      const observations = await readConfirmingEthereumLaunches().catch(() => []);
      const launch = liveLaunchObservations(observations).find(row => row.tokenAddress.toLowerCase() === address.toLowerCase());
      if (launch) return <TokenRouteChainSync key={1} chainId={1}><ConfirmingLaunchView launch={launch} /></TokenRouteChainSync>;
    }
  }
  if (resolved.chainId === 4663) {
    // Start the optional observation while verified identity and chart render.
    const initialPresentation = resolved.token ? readRobinhoodPresentations([resolved.token]).then(items => items[0] ?? null).catch(() => null) : Promise.resolve(null);
    const initialSwapToken = resolved.token && !isRobinhoodFoundationLaunch(resolved.token)
      ? resolveVerifiedLaunchSwapToken({ chainId: 4663, token: resolved.token }).then(value => structuredClone(value)).catch(() => null) : undefined;
    return <TokenRouteChainSync key={4663} chainId={4663}>
      {isRobinhoodFoundationLaunch(resolved.token)
        ? <ModuleFoundationMarketHost token={getAddress(address)} transactionHash={resolved.token.transactionHash as Hex} initialLaunch={resolved.token} initialPresentation={initialPresentation} initialName={resolved.token.name?.trim() || "Unnamed token"} />
        : <RobinhoodTokenView address={address} token={resolved.token} status={resolved.status} initialPresentation={initialPresentation} initialSwapToken={initialSwapToken} />}
    </TokenRouteChainSync>;
  }
  if (resolved.chainId === 1) {
    const initialPresentation = resolved.token ? presentEthereumToken(resolved.token).catch(() => null) : Promise.resolve(null);
    if (resolved.token && isEthereumModuleLaunchCandidate(resolved.token)) return <TokenRouteChainSync key={1} chainId={1}>
      <ModuleFoundationMarketHost chainId={1} token={getAddress(address)} transactionHash={resolved.token?.launchTransactionHash as Hex}
        initialLaunch={ethereumFoundationPresentation(resolved.token)}
        initialName={resolved.token?.name || undefined} initialPresentation={initialPresentation} />
    </TokenRouteChainSync>;
    const initialSwapToken = resolved.token
      ? resolveVerifiedLaunchSwapToken({ chainId: 1, token: resolved.token }).then(value => structuredClone(value)).catch(() => null) : undefined;
    return <TokenRouteChainSync key={1} chainId={1}><EthereumTokenView address={address} token={resolved.token} status={resolved.status} updatedAt={resolved.updatedAt} initialPresentation={initialPresentation} initialSwapToken={initialSwapToken} /></TokenRouteChainSync>;
  }
  return <TokenIndexResetView unresolved />;
}
