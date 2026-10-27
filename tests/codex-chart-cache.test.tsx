import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { acceptsCodexChart, createCodexChartCache } from "@/lib/market/codex-chart-cache";
import { chartForNavigation, CodexPriceChart } from "@/components/codex-price-chart";
import type { CodexChart } from "@/lib/market/codex";

const token = `0x${"ab".repeat(20)}`, time = Date.parse("2026-10-03T09:30:00Z");
const chart = (range: CodexChart["range"] = "1D", now = time): CodexChart => ({ tokenAddress: token, chainId: 4663, range, source: "codex", observedAt: new Date(now).toISOString(), points: [{ time: now - 60_000, price: .001 }, { time: now, price: .002 }] });

describe("Shared chart navigation cache", () => {
  it("keeps the previous period visible until the requested history arrives", () => {
    const previous = chart("1D");
    expect(chartForNavigation(undefined, previous, token, 4663, time)).toBe(previous);
    const requested = { ...chart("1W"), points: [] };
    expect(chartForNavigation(requested, previous, token, 4663, time)).toBe(requested);
  });
  it("never carries history across tokens, chains or an expired observation", () => {
    const previous = chart();
    expect(chartForNavigation(undefined, previous, `0x${"cd".repeat(20)}`, 4663, time)).toBeUndefined();
    expect(chartForNavigation(undefined, previous, token, 1, time)).toBeUndefined();
    expect(chartForNavigation({ ...previous, chainId: 1 }, undefined, token, 4663, time)).toBeUndefined();
    expect(chartForNavigation(undefined, previous, token, 4663, time + 3_600_001)).toBeUndefined();
  });
  it("coalesces requests across mounts and reuses periods during rapid navigation", async () => {
    let now = time;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => Response.json(chart(new URL(String(input), "https://example.com").searchParams.get("range") as CodexChart["range"], now)));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    const values = await Promise.all([cache.load(token, 4663, "1D"), cache.load(token.toUpperCase(), 4663, "1D")]);
    expect(values[0]).toEqual(values[1]); expect(fetcher).toHaveBeenCalledTimes(1);
    await cache.load(token, 4663, "1H"); await cache.load(token, 4663, "1D"); await cache.load(token, 4663, "1H");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 60_001; await cache.load(token, 4663, "1D");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("preserves valid history and throttles failures before recovering", async () => {
    let now = time;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(chart())).mockRejectedValueOnce(new Error("Unavailable"));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    await cache.load(token, 4663, "1D"); now += 60_001;
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    for (let index = 0; index < 3; index++) await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.peek(token, 4663, "1D")).toEqual(chart()); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.waitMs(token, 4663, "1D")).toBe(5_000);
    now += 5_001; fetcher.mockResolvedValueOnce(Response.json(chart("1D", now)));
    await expect(cache.load(token, 4663, "1D")).resolves.toEqual(chart("1D", now));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("honors the server recovery delay and bypasses browser cache on the next read", async () => {
    let now = time;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503, headers: { "Retry-After": "15" } }));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.waitMs(token, 4663, "1D")).toBe(15_000);
    now += 5_001;
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 10_000;
    fetcher.mockResolvedValueOnce(Response.json(chart("1D", now)));
    await expect(cache.load(token, 4663, "1D")).resolves.toMatchObject({ source: "codex" });
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
  });
  it("backs off empty charts and repeated failures without discarding history", async () => {
    let now = time;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...chart(), points: [] }));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    await cache.load(token, 4663, "1D");
    expect(cache.waitMs(token, 4663, "1D")).toBe(120_000);
    now += 119_999;
    await cache.load(token, 4663, "1D");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2;
    fetcher.mockRejectedValue(new Error("Unavailable"));
    for (const delay of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
      expect(cache.waitMs(token, 4663, "1D")).toBe(delay);
      now += delay + 1;
    }
    expect(cache.lastKnown(token, 4663, "1D")?.points).toEqual([]);
  });
  it("isolates tokens, networks and periods and rejects malformed or stale values", async () => {
    for (const invalid of [
      { ...chart(), tokenAddress: `0x${"cd".repeat(20)}` }, { ...chart(), chainId: 1 }, { ...chart(), range: "1W" },
      { ...chart(), observedAt: new Date(time - 180_001).toISOString() }, { ...chart(), points: [{ time, price: 0 }] },
      { ...chart(), points: [chart().points[1], chart().points[0]] },
    ]) expect(acceptsCodexChart(invalid, token, 4663, "1D", time)).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(Response.json(chart("1H")));
    const cache = createCodexChartCache({ fetcher, now: () => time });
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.peek(token, 4663, "1D")).toBeUndefined();
    expect(cache.peek(token, 1, "1H")).toBeUndefined();
  });
  it("retains previously verified history for a delayed display while rejecting stale network responses", async () => {
    let now = time;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(chart()));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    await cache.load(token, 4663, "1D");
    now += 180_001;
    fetcher.mockResolvedValue(Response.json(chart()));
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.peek(token, 4663, "1D")).toBeUndefined();
    expect(cache.lastKnown(token, 4663, "1D")).toEqual(chart());
    expect(cache.lastKnown(token, 1, "1D")).toBeUndefined();
    expect(cache.lastKnown(token, 4663, "1H")).toBeUndefined();
    expect(cache.lastKnown(`0x${"cd".repeat(20)}`, 4663, "1D")).toBeUndefined();
    now = time + 3_600_001;
    expect(cache.lastKnown(token, 4663, "1D")).toBeUndefined();
  });
  it("keeps the chart controls minimal with a minute option", () => {
    const html = renderToStaticMarkup(<CodexPriceChart tokenAddress={token} chainId={4663} name="Coin" />);
    expect(html).toContain('title="One-minute candles over the last 30 minutes"'); expect(html).toContain(">1m</button>");
    expect(html).not.toContain("<footer"); expect(html).not.toContain(">Codex<"); expect(html).not.toContain(">Price <");
  });
});
