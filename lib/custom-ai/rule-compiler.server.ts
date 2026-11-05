import "server-only";
import type { FeeExpression, RuleSpecV2 } from "./rule-spec";
import { normalizeRuleSpec } from "./rule-spec";
import { composableModuleSource, ruleSpecHash } from "../../scripts/custom-ai/composable-module.mjs";
import { evaluateRuleSpec, type FeedSnapshot } from "./rule-evaluator";
import { compileLaunchDraft } from "./lifecycle.server";
import type { FeeExpectation } from "./types";
export type RuleFeedBinding = { id: string; address: `0x${string}`; runtimeHash: `0x${string}`; runtimeCode: `0x${string}`;
  maxAge: number; minimum: string; maximum: string; sourceVersion: string };
export type BoundRuleSpec = { spec: RuleSpecV2; specHash: string; chainId: 1 | 4663; feeds: RuleFeedBinding[] };
export function ruleExpectations(spec: RuleSpecV2, feeds: RuleFeedBinding[], independent: FeeExpectation[] = []): FeeExpectation[] {
  if(independent.length>64)throw Error("Too many independent fee samples.");
  const times = new Set([0]);
  const boundary = (time: number) => { if (time > 0) times.add(time - 1); times.add(time); times.add(time + 1); };
  for (const phase of spec.phases) {
    if (phase.startsAtSeconds) boundary(phase.startsAtSeconds);
    if (phase.endsAtSeconds !== null) boundary(phase.endsAtSeconds);
    const ramp = (fee: FeeExpression) => {
      if (fee.kind === "conditional") { ramp(fee.then); ramp(fee.otherwise); }
      if (fee.kind !== "ramp") return;
      const end = phase.startsAtSeconds + fee.durationSeconds;
      const midpoint = phase.startsAtSeconds + Math.floor(fee.durationSeconds / 2);
      if (phase.endsAtSeconds === null || midpoint < phase.endsAtSeconds) times.add(midpoint);
      if (phase.endsAtSeconds === null || end <= phase.endsAtSeconds) boundary(end);
    };
    ramp(phase.fee);
  }
  for (const action of spec.actions) if (action.startsAtSeconds) boundary(action.startsAtSeconds);
  const rows: FeeExpectation[] = [];
  // Without an external feed all three variants are the same execution.
  const variants = feeds.length ? [0, 1, 2] : [0];
  for (const time of [...times].sort((a,b)=>a-b)) for (const buy of [true, false]) for (const variant of variants) {
    const now = 1_800_000_000 + time;
    const snapshots: FeedSnapshot[] = feeds.map(f => ({ feedId: f.id, sequence: "1", transitionSequence: "1", value: variant === 0 ? f.minimum : f.maximum,
      previousValue: f.minimum, changedAt: now, observedAt: now, validUntil: now + f.maxAge, fresh: variant !== 2, sourceVersion: f.sourceVersion }));
    rows.push({ afterSeconds: time, buy, totalFeeBps: evaluateRuleSpec(spec, { elapsedSeconds: time, now, buy, feeds: snapshots }).totalFeeBps, feeds: snapshots });
  }
  if(independent.length&&feeds.length)throw Error("Independent time-only samples cannot replace feed scenarios.");
  for(const check of independent){
    if(!Number.isSafeInteger(check.afterSeconds)||check.afterSeconds<0||check.afterSeconds>315360000
      ||typeof check.buy!=="boolean"||!Number.isSafeInteger(check.totalFeeBps)||check.totalFeeBps<50||check.totalFeeBps>1500
      ||check.feedValue!=null||check.feedFresh!=null||check.feeds?.length)throw Error("Invalid independent fee sample.");
    const expected=evaluateRuleSpec(spec,{elapsedSeconds:check.afterSeconds,now:1_800_000_000+check.afterSeconds,buy:check.buy,feeds:[]}).totalFeeBps;
    if(expected!==check.totalFeeBps)throw Error("The fee schedule conflicts with the requested fee examples.");
    if(!rows.some(row=>row.afterSeconds===check.afterSeconds&&row.buy===check.buy))rows.push({afterSeconds:check.afterSeconds,buy:check.buy,totalFeeBps:check.totalFeeBps,feeds:[]});
  }
  rows.sort((a,b)=>a.afterSeconds-b.afterSeconds||Number(b.buy)-Number(a.buy));
  if (rows.length > 64) throw Error("This combination needs more verification cases than the supported bound");
  return rows;
}
export async function compileRuleSpec(spec: RuleSpecV2, chainId: 1 | 4663, feeds: RuleFeedBinding[], signal?: AbortSignal, independent: FeeExpectation[] = []) {
  const normalized = normalizeRuleSpec(spec);
  const binding: BoundRuleSpec = { spec: normalized, specHash: ruleSpecHash(normalized), chainId, feeds };
  const expectations = ruleExpectations(normalized, feeds, independent);
  const draft = await compileLaunchDraft(composableModuleSource(normalized, feeds), signal, expectations, undefined, binding);
  if (!draft.compiled || draft.validation?.status !== "passed" || draft.lifecycle?.status !== "passed" || draft.validation.expectationCases !== expectations.length * 4) {
    return { ...draft, diagnostics: draft.diagnostics.length ? draft.diagnostics : ["The complete rule could not be verified."] };
  }
  return { ...draft, verification: { status: "passed" as const, sourceHash: draft.sourceHash,
    requirements: normalized.requirements.map(r => r.text), checks: expectations, cases: draft.validation.expectationCases } };
}
