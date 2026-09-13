import type { Metadata } from "next";
import type { Hex } from "viem";
import { ModuleLaunchWorkspace } from "@/components/module-launch-workspace";
import primaryAnyQuoteLaunchRelease from "@/config/module-engine/review-release.any-quote.json";
import { notFound } from "next/navigation";
import { parseModuleModePageSelection } from "@/lib/module-mode/release-selection";
import { createModuleLaunchWorkspaceRequests } from "@/lib/server/module-mode/launch-workspace";

export const metadata: Metadata = {
  title: "Module Mode · Programmable",
  description: "Create a meme coin, choose creator fees and configure optional modules on Robinhood.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/launch/modules" },
};

export default async function ModuleModePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let selection;
  try { selection = parseModuleModePageSelection(await searchParams); } catch { notFound(); }
  // The primary card selects pair-token fees; availability and historical readers remain independent.
  const reviewedAnyQuoteDigest = primaryAnyQuoteLaunchRelease.releaseDigest as Hex;
  return <ModuleLaunchWorkspace initialSelection={selection} reviewedAnyQuoteDigest={reviewedAnyQuoteDigest}
    requests={createModuleLaunchWorkspaceRequests(selection, reviewedAnyQuoteDigest)} />;
}
