import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { RobinhoodLaunchesView } from "@/components/robinhood-launches-view";
import { exploreChainIdFromSlug, exploreChainPath } from "@/lib/explore-chain";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ chain: "robinhood" }, { chain: "ethereum" }];
}

export async function generateMetadata({ params }: {
  params: Promise<{ chain: string }>;
}): Promise<Metadata> {
  const { chain } = await params;
  const chainId = exploreChainIdFromSlug(chain);
  if (chainId === null) notFound();
  if (chainId === 1) redirect(exploreChainPath(4663));
  const chainName = chainId === 4663 ? "Robinhood" : "Ethereum";
  return {
    title: `Explore ${chainName} · Programmable`,
    description: `Explore tokens launched through Programmable on ${chainName}.`,
    alternates: { canonical: exploreChainPath(chainId) },
    robots: { index: false, follow: true },
  };
}

export default async function ExploreChainPage({ params }: {
  params: Promise<{ chain: string }>;
}) {
  const chainId = exploreChainIdFromSlug((await params).chain);
  if (chainId === null) notFound();
  if (chainId === 1) redirect(exploreChainPath(4663));
  return <RobinhoodLaunchesView chainId={chainId} />;
}
