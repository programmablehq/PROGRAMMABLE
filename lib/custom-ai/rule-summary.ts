import type { FeeExpression, RuleAction, RuleCondition, RuleSpecV2 } from "./rule-spec";

export const feePercent = (bps: number) => `${bps / 100}%`;
export function ruleDuration(seconds: number): string {
  const units = [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]] as const;
  const parts: string[] = [];
  for (const [size, name] of units) {
    const value = Math.floor(seconds / size);
    if (value) parts.push(`${value} ${name}${value === 1 ? "" : "s"}`);
    seconds %= size;
  }
  return parts.join(" ") || "0 seconds";
}
export function feedLabel(id: string) {
  return id === "london-rain-v1" ? "London rain" : id.replaceAll("-", " ");
}
type FeedFormat={id:string;sourceVersion:string};
function feedValue(id: string, value: string, feeds:readonly FeedFormat[]=[]) {
  const usd=feeds.some(feed=>feed.id===id&&feed.sourceVersion==="programmable-market-usd6-v1");
  if (id !== "london-rain-v1"&&!usd) return value;
  const scale=usd?1000000n:1000n,decimals=usd?6:3;
  const n = BigInt(value), absolute = n < 0n ? -n : n;
  const fraction = String(absolute % scale).padStart(decimals, "0").replace(/0+$/, "");
  return `${n < 0n ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""} ${usd?"USD":"mm"}`;
}
export function conditionSummary(condition: RuleCondition,feeds:readonly FeedFormat[]=[]): string {
  if (condition.kind !== "feed") {
    return condition.conditions.map(c => `(${conditionSummary(c,feeds)})`).join(condition.kind === "all" ? " and " : " or ");
  }
  const name = feedLabel(condition.feedId);
  if (condition.operator === "changed") return `${name} changes after launch`;
  return `${name} ${condition.operator === "lt" ? "is below" : condition.operator === "gte" ? "is at least" : "equals"} ${feedValue(condition.feedId, condition.value,feeds)}`;
}
const pair = (buy: number, sell: number) => buy === sell ? `${feePercent(buy)} on buys and sells`
  : `${feePercent(buy)} on buys · ${feePercent(sell)} on sells`;
export function feeSummary(fee: FeeExpression,feeds:readonly FeedFormat[]=[]): string {
  if (fee.kind === "fixed") return pair(fee.buyBps, fee.sellBps);
  if (fee.kind === "ramp") {
    const direction = fee.fromBuyBps <= fee.toBuyBps && fee.fromSellBps <= fee.toSellBps ? "rises" : "changes";
    return `${pair(fee.fromBuyBps, fee.fromSellBps)} → ${pair(fee.toBuyBps, fee.toSellBps)} over ${ruleDuration(fee.durationSeconds)} (${direction} linearly)`;
  }
  return `If ${conditionSummary(fee.when,feeds)}: ${feeSummary(fee.then,feeds)}. Otherwise: ${feeSummary(fee.otherwise,feeds)}.`;
}
function actionDestination(action: RuleAction) {
  if (action.kind === "liquidity") return "permanently locked liquidity";
  if (action.kind === "staking") return "staking rewards";
  const recipient = action.recipient === "creator" ? "the creator" : action.recipient;
  return action.kind === "buyback" ? `buybacks sent to ${recipient}` : `distribution to ${recipient}`;
}
export function summarizeRules(spec: RuleSpecV2, quoteLabel = "pair tokens",feeds:readonly FeedFormat[]=[]) {
  return {
    phases: spec.phases.map(phase => ({ id: phase.id,
      time: phase.startsAtSeconds === 0 ? "At launch" : `After ${ruleDuration(phase.startsAtSeconds)}`,
      until: phase.endsAtSeconds === null ? "Continues" : `Until ${ruleDuration(phase.endsAtSeconds)} after launch`,
      rule: feeSummary(phase.fee,feeds) })),
    allocations: [
      ...(spec.creatorShareBps ? [{ id: "creator", title: `${feePercent(spec.creatorShareBps)} → creator`, detail: "Of additional fees after the platform fee." }] : []),
      ...spec.actions.map(action => ({ id: action.id, title: `${feePercent(action.shareBps)} → ${actionDestination(action)}`,
        detail: [
          "Of additional fees after the platform fee.",
          (action.startsAtSeconds ?? 0) > 0 ? `Starts after ${ruleDuration(action.startsAtSeconds!)}.` : "Starts at launch.",
          action.when ? `Runs when ${conditionSummary(action.when,feeds)}.` : `Runs at most once every ${ruleDuration(action.intervalSeconds)}.`,
          action.when ? `Minimum interval: ${ruleDuration(action.intervalSeconds)}.` : "",
          ["liquidity", "buyback"].includes(action.kind) ? `Maximum per execution: ${action.maximumQuote} ${quoteLabel}.` : "",
        ].filter(Boolean).join(" ") })),
    ],
    dataNotice: "If data needed for a fee condition is stale or unavailable, that condition uses the 0.5% platform fee. Automatic actions wait for valid data and execution conditions.",
  };
}
