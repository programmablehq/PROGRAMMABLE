import { EVM_CUSTOM_CHAINS } from "@/lib/evm-custom-chains";
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
  if (initialViewChainId === 8453 || initialViewChainId === 999) {
    const network = EVM_CUSTOM_CHAINS[initialViewChainId];
    return <main className="page-width"><h1>Launch on {network.name}</h1><p>Create a Custom Launch with your API key.</p><a href={`/developers/api-keys?chainId=${network.id}`}>Create a Custom Launch</a></main>;
  }
  return <ModuleFoundationLaunchHost key={initialViewChainId} layout="studio" chainId={initialViewChainId} />;
}
