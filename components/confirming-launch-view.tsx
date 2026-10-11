"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmingLaunch } from "@/lib/confirming-launches";
import styles from "./confirming-launch-view.module.css";

export function ConfirmingLaunchView({ launch }: { launch: ConfirmingLaunch }) {
  const router = useRouter();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => { setNow(Date.now()); if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <section className={`${styles.panel} page-width`}>
    <p className={styles.status}>{now < launch.observationExpiresAt ? "Confirming launch" : "Checking launch confirmation…"}</p>
    <h1>{launch.name || launch.symbol || "New Programmable launch"}</h1>
    {launch.symbol ? <p>{launch.symbol.replace(/^\$+/, "")} · Ethereum</p> : null}
    <p>{now < launch.observationExpiresAt ? "The launch transaction is confirmed. " : ""}This page updates automatically when final verification is complete.</p>
    <a href={`https://etherscan.io/tx/${launch.transactionHash}`} target="_blank" rel="noreferrer">View launch transaction ↗</a>
  </section>;
}
