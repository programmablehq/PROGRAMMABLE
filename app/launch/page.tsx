import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";
import { parseViewChainId, VIEW_CHAIN_COOKIE_NAME } from "@/lib/view-chain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch · Programmable",
  description:
    "Create a coin, add modules or build your own Uniswap v4 hook.",
  alternates: {
    canonical: "/launch",
  },
};

export default async function LaunchPage() {
  const requestCookies = await cookies();
  const initialViewChainId = parseViewChainId(
    requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value,
  );
  return <ModuleFoundationLaunchHost key={initialViewChainId} layout="studio" chainId={initialViewChainId} />;
}
