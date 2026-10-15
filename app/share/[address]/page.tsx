import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LaunchShareView } from "@/components/launch-share-view";
import { launchShareIdentity } from "@/lib/launch-share";

export const metadata: Metadata = { title: "Share your launch", robots: { index: false, follow: true } };
export default async function LaunchSharePage({ params, searchParams }: {
  params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ address }, search] = await Promise.all([params, searchParams]);
  const identity = launchShareIdentity(address, typeof search.chain === "string" ? search.chain : null);
  if (!identity) notFound();
  return <LaunchShareView key={`${identity.chainId}:${identity.address}`} identity={identity} />;
}
