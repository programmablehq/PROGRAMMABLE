"use client";

import { useState } from "react";
import styles from "./robinhood-token-view.module.css";

export function RobinhoodChart({ poolId, name }: { poolId: string; name: string }) {
  const [loadedPool, setLoadedPool] = useState<string | null>(null);
  const safePool = /^0x[0-9a-f]{64}$/i.test(poolId);
  // The embedded chart fetches its own data; metric refreshes must not remove it.
  return <div className={styles.chart}>
    {safePool ? <>
      {loadedPool !== poolId ? <div className={styles.chartState} role="status">Loading chart…</div> : null}
      <iframe
        key={poolId}
        title={`${name} price chart on DEX Screener`}
        src={`https://dexscreener.com/robinhood/${poolId}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`}
        onLoad={() => setLoadedPool(poolId)}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </> : <div className={styles.chartState} role="status">Chart unavailable.</div>}
  </div>;
}

