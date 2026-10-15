import "server-only";
import { decodeResult, pickColumns, QUERY_IDS, QUERY_COLUMNS, type AnalyticsData, type QueryResult } from "./model";
import snapshot from "./snapshot.json";
import { activityPriceRequests } from "./activity-values";
import { readActivityValues } from "./activity-values.server";
import { fillBuybackCosts } from "./buyback-costs.server";

export async function getAnalytics(): Promise<AnalyticsData> {
  const entries = await Promise.all(Object.entries(QUERY_IDS).map(async ([kind, id]) => {
    const queryKind = kind as keyof typeof QUERY_IDS;
    const fallback = (snapshot as unknown as AnalyticsData)[queryKind];
    if (!process.env.DUNE_API_KEY) return [kind, { ...fallback, stale: true }] as const;
    try {
      const query = new URLSearchParams({ limit:"10000", columns:QUERY_COLUMNS[queryKind].join(",") });
      const response = await fetch(`https://api.dune.com/api/v1/query/${id}/results?${query}`, {
        headers: { "X-Dune-API-Key": process.env.DUNE_API_KEY },
        next: { revalidate: 3600, tags: ["programmable-analytics"] },
        signal: AbortSignal.timeout(12000), redirect: "error",
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Analytics unavailable");
      const raw = await response.text();
      if (raw.length > 4_000_000) throw new Error("Analytics response too large");
      const result = pickColumns(decodeResult(JSON.parse(raw)),queryKind);
      return [kind, queryKind === "buybacks" ? await fillBuybackCosts(result) : result] as const;
    } catch {
      // Keep the last verified result with its original timestamp; never replace an outage with zero.
      return [kind, { ...fallback, stale: true }] as const;
    }
  }));
  const data = Object.fromEntries(entries) as Record<"volume"|"revenue"|"buybacks"|"burns", QueryResult>;
  const fallbackValues = (snapshot as unknown as AnalyticsData).activityValues ?? {};
  try {
    return { ...data, renderedAt:Date.now(), activityValues:{ ...fallbackValues,...await readActivityValues(activityPriceRequests(data)) } };
  } catch {
    return { ...data, renderedAt:Date.now(), activityValues:fallbackValues };
  }
}
