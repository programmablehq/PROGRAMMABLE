export type RuleCondition = { kind: "feed"; feedId: string; operator: "lt" | "gte" | "eq" | "changed"; value: string }
  | { kind: "all" | "any"; conditions: RuleCondition[] };
export type FeeExpression = { kind: "fixed"; buyBps: number; sellBps: number }
  | { kind: "ramp"; fromBuyBps: number; toBuyBps: number; fromSellBps: number; toSellBps: number; durationSeconds: number }
  | { kind: "conditional"; when: RuleCondition; then: FeeExpression; otherwise: FeeExpression };
export type RuleAction = {
  id: string; kind: "liquidity" | "distribution" | "staking" | "buyback"; shareBps: number;
  startsAtSeconds?: number;
  intervalSeconds: number; maximumQuote: string; maximumPriceDeviationBps: number; priceMaxAgeSeconds: number;
  minimumObservations: number; minimumTokensPerQuote?: string; when: RuleCondition | null; recipient: string; requirementIds: string[];
};
export type RuleSpecV2 = { version: 2; requirements: { id: string; text: string }[];
  phases: { id: string; startsAtSeconds: number; endsAtSeconds: number | null; fee: FeeExpression; requirementIds: string[] }[];
  creatorShareBps: number; actions: RuleAction[] };
const fail = (): never => { throw Error("The complete rule, allocation and timing need to be specified."); };
const object = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : fail();
const integer = (x: unknown, min: number, max: number) => Number.isSafeInteger(x) && Number(x) >= min && Number(x) <= max ? Number(x) : fail();
const text = (x: unknown, re: RegExp, max = 160) => typeof x === "string" && x.length <= max && re.test(x) ? x : fail();
const array = (x: unknown, max: number) => Array.isArray(x) && x.length <= max ? x : fail();
const id = (x: unknown) => text(x, /^[a-z][a-z0-9-]{0,63}$/);
export function normalizeRuleSpec(input: unknown): RuleSpecV2 {
  const v = object(input); if (v.version !== 2) fail();
  let nodes = 0; const feeds = new Set<string>();
  function node(depth: number) { if (++nodes > 32 || depth > 8) fail(); }
  function condition(input: unknown, depth = 0): RuleCondition {
    node(depth); const x = object(input);
    if (x.kind === "all" || x.kind === "any") {
      const conditions = array(x.conditions, 4).map(c => condition(c, depth + 1)); if (!conditions.length) fail();
      return { kind: x.kind, conditions };
    }
    if (x.kind !== "feed" || !["lt", "gte", "eq", "changed"].includes(String(x.operator))) fail();
    const feedId = id(x.feedId); feeds.add(feedId); if (feeds.size > 4) fail();
    return { kind: "feed", feedId, operator: x.operator as "lt" | "gte" | "eq" | "changed", value: text(x.value, /^-?\d{1,30}$/) };
  }
  const bps = (x: unknown) => integer(x, 50, 1500);
  function fee(input: unknown, depth = 0): FeeExpression {
    node(depth); const x = object(input);
    if (x.kind === "fixed") return { kind: "fixed", buyBps: bps(x.buyBps), sellBps: bps(x.sellBps) };
    if (x.kind === "ramp") return { kind: "ramp", fromBuyBps: bps(x.fromBuyBps), toBuyBps: bps(x.toBuyBps),
      fromSellBps: bps(x.fromSellBps), toSellBps: bps(x.toSellBps), durationSeconds: integer(x.durationSeconds, 1, 315360000) };
    if (x.kind === "conditional") return { kind: "conditional", when: condition(x.when, depth + 1), then: fee(x.then, depth + 1), otherwise: fee(x.otherwise, depth + 1) };
    return fail();
  }
  const requirements = array(v.requirements, 24).map(r => { const x = object(r); return { id: id(x.id), text: text(x.text, /\S/, 600) }; });
  if (!requirements.length || new Set(requirements.map(r => r.id)).size !== requirements.length) fail();
  const covered = new Set<string>();
  const refs = (x: unknown) => { const ids = array(x, 24).map(id); if (!ids.length || ids.some(r => !requirements.some(q => q.id === r))) fail(); ids.forEach(r => covered.add(r)); return [...new Set(ids)].sort(); };
  const phases = array(v.phases, 16).map(p => { const x = object(p); return { id: id(x.id), startsAtSeconds: integer(x.startsAtSeconds, 0, 315360000),
    endsAtSeconds: x.endsAtSeconds === null ? null : integer(x.endsAtSeconds, 1, 315360000), fee: fee(x.fee), requirementIds: refs(x.requirementIds) }; });
  if (!phases.length || phases[0].startsAtSeconds !== 0 || phases.at(-1)!.endsAtSeconds !== null) fail();
  phases.forEach((p, index) => { if (index && phases[index - 1].endsAtSeconds !== p.startsAtSeconds || p.endsAtSeconds !== null && p.endsAtSeconds <= p.startsAtSeconds) fail();
    if (p.fee.kind === "ramp" && (p.endsAtSeconds === null || p.fee.durationSeconds > p.endsAtSeconds - p.startsAtSeconds)) fail(); });
  const actions = array(v.actions, 4).map(a => { const x = object(a); if (!["liquidity", "distribution", "staking", "buyback"].includes(String(x.kind))) fail();
    const maximumQuote = text(x.maximumQuote, /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/); if (["liquidity", "buyback"].includes(String(x.kind)) ? Number(maximumQuote) <= 0 : maximumQuote !== "0") fail();
    if (x.kind !== "liquidity" && x.when !== null) throw Error("Event-gated actions currently require the locked liquidity program.");
    const recipient = text(x.recipient, /^(?:creator|0x[0-9a-fA-F]{40}|)$/); if (["liquidity", "staking"].includes(String(x.kind)) && recipient !== "" || ["distribution", "buyback"].includes(String(x.kind)) && recipient === "") fail();
    const minimumTokensPerQuote = x.minimumTokensPerQuote === undefined ? "0" : text(x.minimumTokensPerQuote, /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/);
    if (x.kind === "buyback" && Number(minimumTokensPerQuote) <= 0) fail();
    const priceMaxAgeSeconds = integer(x.priceMaxAgeSeconds, 15, 3600);
    const startsAtSeconds = x.startsAtSeconds === undefined ? 0 : integer(x.startsAtSeconds, 0, 315360000);
    if (x.kind === "liquidity" && priceMaxAgeSeconds < 60) throw Error("Liquidity price data must cover the required 60-second history.");
    if (x.kind !== "liquidity" && startsAtSeconds !== 0) throw Error("Delayed actions currently require the locked liquidity program.");
    return { minimumTokensPerQuote, id: id(x.id), kind: x.kind as RuleAction["kind"], shareBps: integer(x.shareBps, 1, 10000),
      startsAtSeconds, intervalSeconds: integer(x.intervalSeconds, 60, 31536000), maximumQuote,
      maximumPriceDeviationBps: integer(x.maximumPriceDeviationBps, 1, 1000), priceMaxAgeSeconds,
      minimumObservations: integer(x.minimumObservations, 3, 100), when: x.when === null ? null : condition(x.when), recipient, requirementIds: refs(x.requirementIds) }; });
  const creatorShareBps = integer(v.creatorShareBps, 0, 10000);
  if (creatorShareBps + actions.reduce((n, a) => n + a.shareBps, 0) !== 10000 || new Set(actions.map(a => a.id)).size !== actions.length
    || new Set(phases.map(p => p.id)).size !== phases.length || covered.size !== requirements.length) fail();
  return { version: 2, requirements, phases, creatorShareBps, actions };
}
export function ruleFeedIds(spec: RuleSpecV2): string[] {
  const result = new Set<string>();
  const walk = (x: unknown) => { if (!x || typeof x !== "object") return; const o = x as Record<string, unknown>;
    if (o.kind === "feed") result.add(String(o.feedId)); Object.values(o).forEach(v => Array.isArray(v) ? v.forEach(walk) : walk(v)); };
  walk(spec); return [...result].sort();
}
export const composablePlanningRules = `For combined time/event rules or adding fees as locked liquidity, return composable as a JSON string of a complete version-2 rule specification; otherwise null.
The specification has version:2, requirements:[{id,text}], phases:[{id,startsAtSeconds,endsAtSeconds,fee,requirementIds}], creatorShareBps and actions.
Phases start at zero, are contiguous and ordered, and the final endsAtSeconds is null. Rates are TOTAL integer bps (50..1500).
fee is {kind:"fixed",buyBps,sellBps}, {kind:"ramp",fromBuyBps,toBuyBps,fromSellBps,toSellBps,durationSeconds}, or {kind:"conditional",when,then,otherwise}.
when is {kind:"feed",feedId,operator:"lt"|"gte"|"eq"|"changed",value:integer-string}, or {kind:"all"|"any",conditions:[when,...]}.
Missing/stale data in a required condition falls back to 50 total bps. An unused future feed does not affect an earlier time phase.
Each action is {id,kind:"liquidity"|"distribution"|"staking"|"buyback",shareBps,startsAtSeconds,intervalSeconds,maximumQuote:decimal-string,maximumPriceDeviationBps,priceMaxAgeSeconds,minimumObservations,minimumTokensPerQuote:decimal-string,when:null|condition,recipient,requirementIds}.
startsAtSeconds is elapsed time after launch; use it to keep an event-gated liquidity action inactive until the requested countdown ends. Liquidity priceMaxAgeSeconds must be at least 60 to cover its required history.
Liquidity/staking recipient is empty; distribution/buyback recipient is creator or an explicitly supplied address. Creator share plus action shares is 10000. No actions means creatorShareBps=10000. maximumQuote is positive for liquidity/buyback and zero for distribution/staking. Event conditions on actions currently apply only to liquidity.
Preserve the saved requirement ids and unchanged rules on edits. Every requirement must be covered by phase/action requirementIds.
Do not invent financial allocations, price limits or data feeds. Ask one focused question for missing material choices. A desired feed can be described as unconnected; that design is not launch ready.
Use this specification for the COMPLETE requested behavior, including combined phases. Never replace requested liquidity with buyback. Existing simple fee generation remains available.`;
