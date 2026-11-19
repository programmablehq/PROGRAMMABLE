import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UnifiedLaunchesView } from "@/components/robinhood-launches-view";
import { readExploreSearchEntry } from "@/lib/robinhood-explore-filters";
import { tryParseViewChainId } from "@/lib/view-chain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Explore · Programmable",
  description: "Explore customizable tokens launched through Programmable.",
  alternates: { canonical: "/explore" },
  robots: { index: false, follow: true },
};

export default async function ExplorePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  if (query.chain !== undefined && tryParseViewChainId(query.chain) === null) notFound();
  const entry = readExploreSearchEntry(query.q, query.model);
  return entry ? <UnifiedLaunchesView entry={entry} /> : <UnifiedLaunchesView />;
}
