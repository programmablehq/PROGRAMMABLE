export type EventRule = { id: string; threshold: string; belowBuyBps: number; belowSellBps: number; aboveBuyBps: number; aboveSellBps: number };
export type FeedBinding = { rule: EventRule; chainId: 1 | 4663; address: `0x${string}`; runtimeHash: `0x${string}`;
  runtimeCode: `0x${string}`; maxAge: number; minimum: string; maximum: string; title: string; sourceUrl: string; unit: string };
export function parseEventRule(value: unknown): EventRule | undefined {
  if (value == null) return undefined;
  const v = value as EventRule;
  if (!/^[a-z0-9-]{1,80}$/.test(v.id) || !/^-?\d{1,30}$/.test(v.threshold)
    || [v.belowBuyBps, v.belowSellBps, v.aboveBuyBps, v.aboveSellBps].some(x => !Number.isInteger(x) || x < 50 || x > 1500)) throw Error("Specify a supported feed, threshold and all four total fees.");
  return { id: v.id, threshold: BigInt(v.threshold).toString(), belowBuyBps: v.belowBuyBps, belowSellBps: v.belowSellBps,
    aboveBuyBps: v.aboveBuyBps, aboveSellBps: v.aboveSellBps };
}
export const eventRuleSchema = { type: ["object", "null"], properties: { id: { type: "string" }, threshold: { type: "string" },
  belowBuyBps: { type: "integer" }, belowSellBps: { type: "integer" }, aboveBuyBps: { type: "integer" }, aboveSellBps: { type: "integer" } },
required: ["id", "threshold", "belowBuyBps", "belowSellBps", "aboveBuyBps", "aboveSellBps"], additionalProperties: false };
export const eventRules = `An event rule can use ONE explicitly listed onchain data feed. Return eventRule=null otherwise.
Choose its exact id and integer threshold in the listed units. Never invent feeds or equate web research to a feed.
Specify total belowBuyBps/belowSellBps and at-or-above aboveBuyBps/aboveSellBps (50..1500).
If a feed is unavailable, explain that the platform integration is missing; do not ask the user for backend API keys.
Data-dependent fees always fall back to 0.5% total when observations are stale, unavailable or invalid.
For event rules, feeChecks includes feedValue as integer string and feedFresh boolean. Cover threshold-1, threshold,
threshold+1 in BOTH directions while fresh, plus BOTH directions while stale with totalFeeBps=50.
Set afterSeconds=0 for those examples. For ordinary time rules set feedValue=null and feedFresh=null.
Time schedules combined with event rules are not yet supported: ask before simplifying. The fixed event template
implements the fees, so no arbitrary generated external calls are accepted. Include source, threshold, freshness
fallback and fees in requirements. A signed observation establishes who reported a value, not that it is true.`;
