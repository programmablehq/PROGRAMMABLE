"use client";
import { useEffect, useState } from "react";
import { CODEX_CHART_RANGES, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import { codexChartCache } from "@/lib/market/codex-chart-cache";
import { coinDollars, coinValuation, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { chartMarketCap } from "@/lib/market/chart-presentation";
import styles from "./robinhood-live-chart.module.css";

const stamp = (time: number) => new Date(time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export function chartForNavigation(requested: CodexChart | undefined, previous: CodexChart | undefined, tokenAddress: string, chainId: number, now = Date.now()) {
  if (requested?.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && requested.chainId === chainId) return requested;
  const age = previous ? now - Date.parse(previous.observedAt) : Infinity;
  return previous?.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && previous.chainId === chainId && age >= -30_000 && age <= 3_600_000 ? previous : undefined;
}
export function CodexPriceChart({ tokenAddress, chainId, name, market }: { tokenAddress: string; chainId: 1 | 4663 | 8453; name: string; market?: RobinhoodCoinMarket | null }) {
  const [range, setRange] = useState<CodexChartRange>("1D");
  const key = `${chainId}:${tokenAddress.toLowerCase()}:${range}`;
  const [state, setState] = useState<{ key: string; chart?: CodexChart; failed: boolean }>(() => ({ key, chart: codexChartCache.peek(tokenAddress, chainId, range) ?? codexChartCache.lastKnown(tokenAddress, chainId, range), failed: false }));
  const [hover, setHover] = useState<number | null>(null);
  const chart = chartForNavigation(state.key === key ? state.chart : codexChartCache.peek(tokenAddress, chainId, range) ?? codexChartCache.lastKnown(tokenAddress, chainId, range), state.chart, tokenAddress, chainId);
  useEffect(() => {
    let disposed = false, active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visibleNow = () => document.visibilityState !== "hidden";
    async function load() {
      if (disposed || active || document.visibilityState === "hidden") return;
      active = true;
      try {
        const value = await codexChartCache.load(tokenAddress, chainId, range);
        if (disposed) return;
        setState({ key, chart: value, failed: false });
      } catch { if (!disposed) setState(current => ({ key, chart: chartForNavigation(codexChartCache.peek(tokenAddress, chainId, range) ?? codexChartCache.lastKnown(tokenAddress, chainId, range), current.chart, tokenAddress, chainId), failed: true })); }
      finally { active = false; if (!disposed && visibleNow()) timer = setTimeout(load, Math.max(1_000, codexChartCache.waitMs(tokenAddress, chainId, range))); }
    }
    const visible = () => { clearTimeout(timer); if (visibleNow()) void load(); };
    void load();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    window.addEventListener("online", visible);
    return () => {
      disposed = true; clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      window.removeEventListener("online", visible);
    };
  }, [key, tokenAddress, chainId, range]);
  const points = chart?.points ?? [];
  const last = points.at(-1);
  const inspected = hover !== null ? points[hover] : undefined;
  const valuation = coinValuation(market);
  const marketCap = inspected ? chartMarketCap(inspected.price, market) : valuation.value;
  const hasLastPrice = market?.priceUsd != null && Number.isFinite(market.priceUsd) && market.priceUsd > 0;
  const high = Math.max(...points.map(point => point.price), 0);
  const low = Math.min(...points.map(point => point.price));
  const relativeLow = high ? low / high : 0;
  const pad = Math.max((1 - relativeLow) * .12, .025);
  const floor = Math.max(0, relativeLow - pad), ceiling = 1 + pad;
  const coordinates = points.map(point => ({ x: points.length === 1 ? 400 : 16 + (point.time - points[0].time) / (last!.time - points[0].time) * 768,
    y: 16 + (ceiling - point.price / high) / (ceiling - floor) * 288 }));
  const gap = CODEX_CHART_RANGES[range].candleSeconds * 1_000 * 1.5;
  // A quiet interval keeps the last observed close until the next real candle.
  const path = coordinates.length === 1 ? `M16,${coordinates[0].y.toFixed(2)} L784,${coordinates[0].y.toFixed(2)}` : coordinates.map((point, index) => {
    const carried = index > 0 && points[index].time - points[index - 1].time > gap;
    return `${index === 0 ? "M" : carried ? `L${point.x.toFixed(2)},${coordinates[index - 1].y.toFixed(2)} L` : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
  const selected = hover !== null ? coordinates[hover] : undefined;
  const failed = state.key === key && state.failed;
  const displayedRange = chart?.range ?? range;
  const changingRange = displayedRange !== range && !failed;
  const warmRange = (value: CodexChartRange) => { if (value !== displayedRange) void codexChartCache.load(tokenAddress, chainId, value).catch(() => {}); };
  return <figure className={styles.figure} aria-label={`${name} market cap chart`} aria-busy={changingRange}>
    <header className={styles.header}><div><p className={styles.price} aria-label="Market capitalization in USD" title={inspected ? "Based on the current token supply" : valuation.title}>{marketCap != null ? coinDollars(marketCap) : "—"}</p>
      {failed && displayedRange !== range ? <p className={styles.status} role="status">Couldn’t load {range}. Showing {displayedRange}.</p> : null}</div>
      <nav className={styles.ranges} aria-label="Chart period">{(Object.keys(CODEX_CHART_RANGES) as CodexChartRange[]).map(value => <button key={value} type="button" title={CODEX_CHART_RANGES[value].label} aria-pressed={displayedRange === value} data-pending={changingRange && range === value || undefined} onPointerEnter={() => warmRange(value)} onFocus={() => warmRange(value)} onPointerDown={() => warmRange(value)} onClick={() => { setHover(null); setRange(value); }}>{value}</button>)}</nav>
    </header>
    <div className={styles.plot} onPointerLeave={() => setHover(null)} onPointerMove={event => {
      if (!points.length) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const time = points[0].time + Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 800 - 16) / 768)) * (last!.time - points[0].time);
      let nearest = 0; for (let index = 1; index < points.length; index++) if (Math.abs(points[index].time - time) < Math.abs(points[nearest].time - time)) nearest = index;
      setHover(nearest);
    }}>
      {points.length ? <svg key={displayedRange} className={styles.svg} viewBox="0 0 800 320" preserveAspectRatio="none" role="img" aria-label={`${name}, ${displayedRange}: ${points.length} recorded prices from ${stamp(points[0].time)} to ${stamp(last!.time)} UTC.`}>

        <path className={styles.line} d={path} vectorEffect="non-scaling-stroke" />
        {selected ? <circle className={styles.point} cx={selected.x} cy={selected.y} r="4" /> : null}
      </svg> : chart && hasLastPrice ? <svg className={styles.svg} viewBox="0 0 800 320" preserveAspectRatio="none" role="img" aria-label={`${name}: last known market capitalization. No trades in this period.`}>
        <path className={styles.line} d="M16,160 L784,160" vectorEffect="non-scaling-stroke" />
      </svg> : <div className={styles.empty} role="status">{!chart && !failed ? <span className={styles.skeleton} aria-label="Loading price history" /> : failed ? "Chart is temporarily unavailable." : "No price has been recorded yet."}</div>}
    </div>
  </figure>;
}
