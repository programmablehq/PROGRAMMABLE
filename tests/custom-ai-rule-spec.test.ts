import { describe, expect, it } from "vitest";
import fixture from "./fixtures/custom-ai/london-liquidity-v2.json";
import { normalizeRuleSpec } from "../lib/custom-ai/rule-spec";
import { evaluateRuleSpec, type FeedSnapshot } from "../lib/custom-ai/rule-evaluator";
const spec = normalizeRuleSpec(fixture);
const rain = (value: string, fresh = true): FeedSnapshot => ({ feedId: "london-rain-v1", sequence: "1", transitionSequence: "1", value, previousValue: "0", changedAt: 900, observedAt: 990, validUntil: 1100, sourceVersion: "v1", fresh });
describe("complete combined rules", () => {
  it.each([[0, 1000], [300, 550], [599, 102]])("keeps the initial time curve at %is without future weather", (elapsedSeconds, expected) => {
    for (const buy of [true, false]) expect(evaluateRuleSpec(spec, { elapsedSeconds, now: 1000, buy, feeds: [] }).totalFeeBps).toBe(expected);
  });
  it.each([["0", true, 100], ["1", true, 500], ["1", false, 50]])("switches after the timer using freshness", (value, fresh, expected) => {
    expect(evaluateRuleSpec(spec, { elapsedSeconds: 600, now: 1000, buy: true, feeds: [rain(value, fresh)] }).totalFeeBps).toBe(expected);
  });
  it("rejects gaps, floating point rates and incomplete allocation", () => {
    expect(() => normalizeRuleSpec({ ...fixture, creatorShareBps: 1 })).toThrow();
    expect(() => normalizeRuleSpec({ ...fixture, phases: [{ ...fixture.phases[0], startsAtSeconds: 1 }, fixture.phases[1]] })).toThrow();
    expect(() => normalizeRuleSpec({ ...fixture, phases: [{ ...fixture.phases[0], fee: { kind: "fixed", buyBps: 99.5, sellBps: 100 } }, fixture.phases[1]] })).toThrow();
  });
  it("keeps a weather-change action id stable across later execution windows", () => {
    const eventSpec = normalizeRuleSpec({ ...fixture, actions: [{ ...fixture.actions[0], when: {kind:"feed",feedId:"london-rain-v1",operator:"changed",value:"0"} }] });
    const observation = { ...rain("1"), changedAt: 900, observedAt: 900, validUntil: 2000 };
    const first = evaluateRuleSpec(eventSpec, {elapsedSeconds:600,now:1000,buy:true,feeds:[observation]});
    const later = evaluateRuleSpec(eventSpec, {elapsedSeconds:1300,now:1700,buy:true,feeds:[observation]});
    expect(first.actions[0].eventId).toBe(later.actions[0].eventId);
  });
});
