import type { RuleSpecV2 } from "./rule-spec";
import type { ProductBlueprint } from "./product/blueprint";

export type FeePoint = { seconds: number; buyBps: number; sellBps: number };
export function feeSchedulePoints(spec: RuleSpecV2): FeePoint[] | null {
  if (spec.phases.some(phase => phase.fee.kind === "conditional")) return null;
  const lastChange = Math.max(0, ...spec.phases.map(phase => phase.fee.kind === "ramp"
    ? phase.startsAtSeconds + phase.fee.durationSeconds : phase.startsAtSeconds));
  const horizon = lastChange ? lastChange + Math.max(1, Math.round(lastChange * .12)) : 1;
  const points: FeePoint[] = [];
  for (const phase of spec.phases) {
    const fee = phase.fee;
    if (fee.kind === "conditional") return null;
    const end = Math.min(phase.endsAtSeconds ?? horizon, horizon);
    if (fee.kind === "fixed") points.push({ seconds: phase.startsAtSeconds, buyBps: fee.buyBps, sellBps: fee.sellBps }, { seconds: end, buyBps: fee.buyBps, sellBps: fee.sellBps });
    else {
      points.push({ seconds: phase.startsAtSeconds, buyBps: fee.fromBuyBps, sellBps: fee.fromSellBps });
      const rampEnd = Math.min(end, phase.startsAtSeconds + fee.durationSeconds);
      const elapsed = Math.max(0, rampEnd - phase.startsAtSeconds);
      points.push({ seconds: rampEnd,
        buyBps: fee.fromBuyBps + Math.trunc((fee.toBuyBps - fee.fromBuyBps) * elapsed / fee.durationSeconds),
        sellBps: fee.fromSellBps + Math.trunc((fee.toSellBps - fee.fromSellBps) * elapsed / fee.durationSeconds) });
      if (end > rampEnd) points.push({ seconds: end, buyBps: fee.toBuyBps, sellBps: fee.toSellBps });
    }
  }
  return points;
}

export type AllocationVisual = { id: string; label: string; shares: { label: string; bps: number }[] };
export function productAllocations(product: Pick<ProductBlueprint, "components" | "assets" | "flows">): AllocationVisual[] {
  const names = new Map(product.components.map(component => [component.id, component.name]));
  const assets = new Map(product.assets.map(asset => [asset.id, asset.name]));
  const groups = new Map<string, AllocationVisual>();
  for (const flow of product.flows) {
    if (flow.allocationGroup === null || flow.shareBps === null) continue;
    const key = `${flow.allocationGroup}:${flow.source}:${flow.asset}`;
    const group = groups.get(key) ?? { id: key, label: assets.get(flow.asset) ?? flow.asset, shares: [] };
    group.shares.push({ label: names.get(flow.target) ?? flow.target, bps: flow.shareBps });
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.shares.every(share => share.bps >= 0)
    && group.shares.reduce((sum, share) => sum + share.bps, 0) <= 10000);
}
