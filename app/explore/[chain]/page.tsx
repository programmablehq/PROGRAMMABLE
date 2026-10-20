import { notFound, redirect } from "next/navigation";
import { exploreChainIdFromSlug } from "@/lib/explore-chain";

export const dynamicParams = false;
export function generateStaticParams() {
  return [{ chain: "robinhood" }, { chain: "ethereum" }, { chain: "base" }];
}

/** Existing bookmarks open the same combined catalog. */
export default async function ExploreChainPage({ params }: { params: Promise<{ chain: string }> }) {
  if (exploreChainIdFromSlug((await params).chain) === null) notFound();
  redirect("/explore");
}
