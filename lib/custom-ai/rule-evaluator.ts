import type { RuleCondition, FeeExpression, RuleSpecV2 } from "./rule-spec";
export type FeedSnapshot = { feedId: string; sequence: string; transitionSequence: string; value: string; previousValue: string;
  changedAt: number; observedAt: number; validUntil: number; sourceVersion: string; fresh: boolean };
export type RuleContext = { elapsedSeconds: number; now: number; buy: boolean; feeds: FeedSnapshot[] };
export function evaluateRuleSpec(spec: RuleSpecV2, context: RuleContext) {
  if (!Number.isSafeInteger(context.elapsedSeconds) || context.elapsedSeconds < 0 || !Number.isSafeInteger(context.now)) throw Error("Invalid rule clock");
  const used = new Set<string>();
  function condition(c: RuleCondition): { known: boolean; matches: boolean; events: string[] } {
    if (c.kind !== "feed") {
      const values = c.conditions.map(condition);
      // Three-valued short circuit: a known false AND / true OR is independent of missing inputs.
      const decisive = values.find(v => v.known && v.matches === (c.kind === "any"));
      if (decisive) return { known: true, matches: decisive.matches, events: decisive.events };
      return { known: values.every(v => v.known), matches: c.kind === "all", events: values.flatMap(v => v.events) };
    }
    used.add(c.feedId);
    const f = context.feeds.find(f => f.feedId === c.feedId);
    if (!f || !f.fresh || f.observedAt > context.now || f.validUntil < context.now) return { known: false, matches: false, events: [] };
    const value = BigInt(f.value), target = BigInt(c.value);
    const matches = c.operator === "lt" ? value < target : c.operator === "gte" ? value >= target : c.operator === "eq" ? value === target
      : BigInt(f.transitionSequence) > 0n && f.changedAt >= context.now - context.elapsedSeconds;
    return { known: true, matches, events: [`${f.feedId}:${f.sourceVersion}:${f.transitionSequence}`] };
  }
  const phase = spec.phases.find(p => context.elapsedSeconds >= p.startsAtSeconds && (p.endsAtSeconds === null || context.elapsedSeconds < p.endsAtSeconds));
  if (!phase) throw Error("Missing rule phase");
  function fee(f: FeeExpression): number {
    if (f.kind === "fixed") return context.buy ? f.buyBps : f.sellBps;
    if (f.kind === "conditional") { const result = condition(f.when); return result.known ? fee(result.matches ? f.then : f.otherwise) : 50; }
    const from = BigInt(context.buy ? f.fromBuyBps : f.fromSellBps), to = BigInt(context.buy ? f.toBuyBps : f.toSellBps);
    const elapsed = BigInt(Math.min(context.elapsedSeconds - phase!.startsAtSeconds, f.durationSeconds));
    return Number(from + (to - from) * elapsed / BigInt(f.durationSeconds));
  }
  const totalFeeBps = fee(phase.fee);
  const usesChange = (c: RuleCondition): boolean => c.kind === "feed" ? c.operator === "changed" : c.conditions.some(usesChange);
  const actions = spec.actions.flatMap(a => { const state = a.when ? condition(a.when) : { known: true, matches: true, events: [] };
    return state.known && state.matches ? [{ id: a.id, eventId: `${state.events.sort().join("|")}${a.when && usesChange(a.when) ? "" : `:window:${Math.floor(context.now / a.intervalSeconds)}`}` }] : []; });
  return { totalFeeBps, phaseId: phase.id, requiredFeeds: [...used].sort(), actions };
}
