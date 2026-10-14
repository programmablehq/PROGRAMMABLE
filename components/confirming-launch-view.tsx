"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmingLaunch } from "@/lib/confirming-launches";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { EthereumTokenView } from "./ethereum-token-view";
import styles from "./confirming-launch-view.module.css";

/** Normal public market view while finality is reconciled in the background. */
export function ConfirmingLaunchView({ launch, initialPresentation }: {
  launch: ConfirmingLaunch;
  initialPresentation: Promise<RobinhoodCoinPresentation | null>;
}) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <div className={styles.market}>
    <EthereumTokenView address={launch.tokenAddress} token={null} observedLaunch={launch}
      status="partial" updatedAt={launch.launchedAt} initialPresentation={initialPresentation} />
  </div>;
}
