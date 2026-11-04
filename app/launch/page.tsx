import { EVM_CUSTOM_CHAINS } from "@/lib/evm-custom-chains";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";
import { parseViewChainId, VIEW_CHAIN_COOKIE_NAME } from "@/lib/view-chain";
import studioStyles from "@/components/module-studio/studio.module.css";
import styles from "./page.module.css";

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
    return <div className={studioStyles.launchPage}><section className={styles.customEntry}>
      <h1>Launch on {network.name}</h1>
      <p>Describe your hook in AI Chat, or build a Custom Launch with the API.</p>
      <div className={styles.actions}>
        <Link href="/launch/custom-ai">Open AI Chat</Link>
        <Link href={`/developers/api-keys?start=custom&chainId=${network.id}`}>Build with API</Link>
      </div>
      <Link className={styles.moduleLink} href="/launch/modules/foundation?chainId=4663">Module Mode on Robinhood or Ethereum</Link>
    </section></div>;
  }
  return <ModuleFoundationLaunchHost key={initialViewChainId} layout="studio" chainId={initialViewChainId} />;
}
