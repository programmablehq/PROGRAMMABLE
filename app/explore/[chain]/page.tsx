import { notFound, redirect } from "next/navigation";
import { EXPLORE_CHAIN_SLUGS, exploreChainIdFromSlug } from "@/lib/explore-chain";

export const dynamicParams = false;
export function generateStaticParams() {
  return Object.values(EXPLORE_CHAIN_SLUGS).map(chain => ({ chain }));
}

/** Existing bookmarks open the same combined catalog. */
export default async function ExploreChainPage({ params }: { params: Promise<{ chain: string }> }) {
  if (exploreChainIdFromSlug((await params).chain) === null) notFound();
  redirect("/explore");
}
