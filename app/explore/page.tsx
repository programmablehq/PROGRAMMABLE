import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { exploreChainPath } from "@/lib/explore-chain";
import { parseViewChainId, tryParseViewChainId, VIEW_CHAIN_COOKIE_NAME } from "@/lib/view-chain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore · Programmable",
  description: "Find tokens launched through Programmable on Robinhood Chain.",
  alternates: {
    canonical: "/explore",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default async function ExplorePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  if (query.chain !== undefined) {
    const chainId = tryParseViewChainId(query.chain);
    if (chainId === null) notFound();
    redirect(exploreChainPath(parseViewChainId(chainId)));
  }
  const requestCookies = await cookies();
  redirect(exploreChainPath(parseViewChainId(
    requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value,
  )));
}
