import { CODEX_CHART_RANGES, marketObject, type CodexChart, type CodexChartRange } from "./codex";

export function acceptsCodexChart(value: unknown, token: string, chain: number, range: string, now = Date.now()): value is CodexChart {
  if (!marketObject(value) || value.tokenAddress !== token.toLowerCase() || value.chainId !== chain || value.range !== range || value.source !== "codex"
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || now - Date.parse(value.observedAt) > 180_000
    || Date.parse(value.observedAt) > now + 30_000 || !Array.isArray(value.points) || value.points.length > 1_000) return false;
  const points = value.points;
  return points.every((point, index) => marketObject(point) && typeof point.time === "number" && Number.isSafeInteger(point.time)
    && point.time > 0 && point.time <= now + 30_000 && (!index || point.time > points[index - 1].time)
    && typeof point.price === "number" && Number.isFinite(point.price) && point.price > 0);
}

type Entry = { chart?: CodexChart; nextAttemptAt: number; failed: boolean; failures: number };
export function createCodexChartCache({ fetcher = (input, init) => fetch(input, init), now = Date.now }: {
  fetcher?: typeof fetch; now?: () => number;
} = {}) {
  const saved = new Map<string, Entry>();
  const pending = new Map<string, Promise<CodexChart>>();
  const keyFor = (token: string, chain: number, range: CodexChartRange) => `${chain}:${token.toLowerCase()}:${range}`;
  function remember(key: string, value: Entry) {
    saved.delete(key); saved.set(key, value);
    if (saved.size > 80) saved.delete(saved.keys().next().value!);
  }
  return {
    peek(token: string, chain: number, range: CodexChartRange) {
      const chart = saved.get(keyFor(token, chain, range))?.chart;
      return chart && acceptsCodexChart(chart, token, chain, range, now()) ? chart : undefined;
    },
    lastKnown(token: string, chain: number, range: CodexChartRange) {
      // Only previously validated history is retained for display during an outage.
      // It is never accepted as a fresh response or used for quotes/transactions.
      const chart = saved.get(keyFor(token, chain, range))?.chart;
      const age = chart ? now() - Date.parse(chart.observedAt) : Infinity;
      return chart && age >= -30_000 && age <= 3_600_000 ? chart : undefined;
    },
    waitMs(token: string, chain: number, range: CodexChartRange) {
      return Math.max(0, (saved.get(keyFor(token, chain, range))?.nextAttemptAt ?? 0) - now());
    },
    async load(token: string, chain: number, range: CodexChartRange): Promise<CodexChart> {
      const key = keyFor(token, chain, range), active = pending.get(key), previous = saved.get(key);
      if (active) return active;
      if (previous && previous.nextAttemptAt > now()) {
        if (!previous.failed && previous.chart && acceptsCodexChart(previous.chart, token, chain, range, now())) return previous.chart;
        throw new Error("Price history unavailable");
      }
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
      const request = Promise.resolve().then(async () => {
        try {
          const query = new URLSearchParams({ token: token.toLowerCase(), chain: String(chain), range });
          const response = await fetcher(`/api/market/chart?${query}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Price history unavailable");
          const value: unknown = await response.json();
          if (!acceptsCodexChart(value, token, chain, range, now())) throw new Error("Price history unavailable");
          const refreshMs = value.points.length ? CODEX_CHART_RANGES[range].refreshMs : 10_000;
          remember(key, { chart: value, failed: false, failures: 0, nextAttemptAt: now() + refreshMs });
          return value;
        } catch {
          const failures = (previous?.failures ?? 0) + 1;
          remember(key, { chart: previous?.chart, failed: true, failures,
            nextAttemptAt: now() + Math.min(5_000 * 2 ** Math.min(failures - 1, 3), 30_000) });
          throw new Error("Price history unavailable");
        } finally { clearTimeout(timeout); pending.delete(key); }
      });
      pending.set(key, request);
      return request;
    },
  };
}

export const codexChartCache = createCodexChartCache();
