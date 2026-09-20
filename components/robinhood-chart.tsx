"use client";

import { useEffect, useState } from "react";
import { coinDollars, ROBINHOOD_MARKET_MAX_AGE_MS, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";
import liveStyles from "./robinhood-live-chart.module.css";

type ChartMarket = RobinhoodCoinMarket & Readonly<{ source?: "dexscreener" | "uniswap-v4" }>;
type ChartProps = Readonly<{ poolId: string; name: string; market?: ChartMarket | null }>;
export type RobinhoodLivePrice = Readonly<{ time: number; price: number }>;

const MAX_POINTS = 120;
const CLOCK_SKEW_MS = 30_000;
const chartTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
});

export function appendRobinhoodLivePrice(
  points: readonly RobinhoodLivePrice[], poolId: string, market: ChartMarket | null | undefined, now: number,
): readonly RobinhoodLivePrice[] {
  if (market?.source !== "uniswap-v4" || market.poolId.toLowerCase() !== poolId.toLowerCase()) return points;
  const time = Date.parse(market.observedAt);
  const price = market.priceUsd;
  const age = now - time;
  if (!Number.isFinite(time) || age < -CLOCK_SKEW_MS || age > ROBINHOOD_MARKET_MAX_AGE_MS
    || price === null || !Number.isFinite(price) || price <= 0) return points;
  const last = points.at(-1);
  // A cached, duplicate or out-of-order response cannot manufacture another observation.
  if (last && time <= last.time) return points;
  return [...points.slice(-(MAX_POINTS - 1)), { time, price }];
}

export function robinhoodLivePriceGeometry(points: readonly RobinhoodLivePrice[]) {
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const low = Math.min(...points.map((point) => point.price));
  const high = Math.max(...points.map((point) => point.price));
  // Normalize first so very small or large token prices still produce finite coordinates.
  const relativeLow = low / high;
  const padding = Math.max((1 - relativeLow) * 0.12, 0.025);
  const lower = Math.max(0, relativeLow - padding);
  const upper = 1 + padding;
  const coordinates = points.map((point) => ({
    x: points.length === 1 ? 400 : 24 + (point.time - first.time) / (last.time - first.time) * 752,
    y: 24 + (upper - point.price / high) / (upper - lower) * 272,
  }));
  const path = coordinates.map((point, index) => {
    const disconnected = index === 0 || points[index].time - points[index - 1].time > ROBINHOOD_MARKET_MAX_AGE_MS;
    return `${disconnected ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
  return { path, last: coordinates[coordinates.length - 1], low, high };
}

export function robinhoodLivePriceStatus(last: RobinhoodLivePrice | undefined, now: number, market: ChartMarket | null | undefined) {
  if (!last) return "Waiting for a price update";
  if (now - last.time > ROBINHOOD_MARKET_MAX_AGE_MS) return "Price updates delayed";
  const age = now - Date.parse(market?.observedAt ?? "");
  if (market?.source !== "uniswap-v4" || market.priceUsd === null || !Number.isFinite(market.priceUsd) || market.priceUsd <= 0
    || !Number.isFinite(age) || age < -CLOCK_SKEW_MS || age > ROBINHOOD_MARKET_MAX_AGE_MS) return "Price update unavailable";
  return "Live price";
}

function LivePriceChart({ name, points, now, market }: Readonly<{
  name: string; points: readonly RobinhoodLivePrice[]; now: number; market: ChartMarket | null;
}>) {
  const first = points[0];
  const last = points.at(-1);
  const geometry = robinhoodLivePriceGeometry(points);
  const status = robinhoodLivePriceStatus(last, now, market);
  const summary = last
    ? `${name}: ${coinDollars(last.price, true)}, observed at ${chartTime.format(last.time)} UTC. ${points.length} price ${points.length === 1 ? "observation" : "observations"} collected during this visit. ${status !== "Live price" ? "Updates are currently unavailable." : ""}`
    : `${name}: waiting for a live price. No price history is available yet.`;
  return <figure className={liveStyles.figure} aria-label={`${name} live price`}>
    <header className={liveStyles.header}>
      <div>
        <p className={liveStyles.label}>Live price <span>USD</span></p>
        <p className={liveStyles.price}>{last ? coinDollars(last.price, true) : "—"}</p>
      </div>
      <p className={liveStyles.status} role="status">{status === "Live price" ? "Uniswap v4" : status}</p>
    </header>
    <div className={liveStyles.plot}>
      {geometry && last ? <>
        <svg className={liveStyles.svg} viewBox="0 0 800 320" preserveAspectRatio="none" role="img" aria-label={summary}>
          <g className={liveStyles.grid} aria-hidden="true">
            {[24, 160, 296].map((y) => <line key={y} x1="24" x2="776" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
          </g>
          {points.length > 1 ? <path className={liveStyles.line} d={geometry.path} vectorEffect="non-scaling-stroke" /> : null}
          <circle className={liveStyles.point} cx={geometry.last.x} cy={geometry.last.y} r="4" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.length === 1 ? <p className={liveStyles.firstPoint}>The chart grows with each price update.</p> : null}
      </> : <p className={liveStyles.empty}>Live price is unavailable.</p>}
    </div>
    <figcaption className={liveStyles.caption}>
      <span>Prices observed during this visit</span>
      {last ? <span>{points.length > 1 ? `${chartTime.format(first.time)} – ` : ""}{chartTime.format(last.time)} UTC</span> : null}
    </figcaption>
  </figure>;
}

function PoolChart({ poolId, name, market }: ChartProps) {
  const [loadedPool, setLoadedPool] = useState<string | null>(null);
  const [failedPool, setFailedPool] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const matchingMarket = market?.poolId.toLowerCase() === poolId.toLowerCase() ? market : null;
  const [points, setPoints] = useState<readonly RobinhoodLivePrice[]>([]);
  const [chartSource, setChartSource] = useState<ChartMarket["source"]>();
  const nextPoints = appendRobinhoodLivePrice(points, poolId, matchingMarket, now);
  // Keep observations tied to this mounted pool; a refresh must not invent or reset history.
  if (nextPoints !== points) setPoints(nextPoints);
  if (matchingMarket?.source && matchingMarket.source !== chartSource) setChartSource(matchingMarket.source);
  const showLive = chartSource === "uniswap-v4";

  useEffect(() => {
    if (!showLive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [showLive]);

  if (showLive) return <div className={styles.chart}>
    <LivePriceChart name={name} points={points} now={now} market={matchingMarket} />
  </div>;

  // The embedded chart fetches its own data; metric refreshes must not remove it.
  return <div className={styles.chart}>
    {failedPool === poolId ? <div className={styles.chartState} role="status">Chart unavailable.</div> : <>
      {loadedPool !== poolId ? <div className={styles.chartState} role="status">Loading chart…</div> : null}
      <iframe
        key={poolId}
        title={`${name} price chart on DEX Screener`}
        src={`https://dexscreener.com/robinhood/${poolId}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`}
        onLoad={() => setLoadedPool(poolId)}
        onError={() => setFailedPool(poolId)}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </>}
  </div>;
}

export function RobinhoodChart(props: ChartProps) {
  if (!/^0x[0-9a-f]{64}$/i.test(props.poolId)) return <div className={styles.chart}>
    <div className={styles.chartState} role="status">Chart unavailable.</div>
  </div>;
  return <PoolChart key={props.poolId.toLowerCase()} {...props} />;
}
