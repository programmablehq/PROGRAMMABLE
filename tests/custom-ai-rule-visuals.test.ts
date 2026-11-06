import { describe, expect, it } from "vitest";
import { feeSchedulePoints, productAllocations } from "../lib/custom-ai/rule-visuals";
import { feeLaunchDetailIssue } from "../lib/custom-ai/coin-next-detail";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { RuleSpecV2 } from "../lib/custom-ai/rule-spec";
import type { ProductBlueprint } from "../lib/custom-ai/product/blueprint";

const spec: RuleSpecV2 = { version: 2, requirements: [{ id: "fees", text: "2% to 0.5% over 24 hours" }], creatorShareBps: 10000, actions: [], phases: [
  { id: "fade", startsAtSeconds: 0, endsAtSeconds: 86400, fee: { kind: "ramp", fromBuyBps: 200, toBuyBps: 50, fromSellBps: 300, toSellBps: 75, durationSeconds: 86400 }, requirementIds: ["fees"] },
  { id: "after", startsAtSeconds: 86400, endsAtSeconds: null, fee: { kind: "fixed", buyBps: 50, sellBps: 75 }, requirementIds: ["fees"] },
] };

describe("exact rule visuals", () => {
  it("retains separate buy and sell rates, the 24-hour endpoint and the final fixed fee", () => {
    const points = feeSchedulePoints(spec)!;
    expect(points[0]).toEqual({ seconds: 0, buyBps: 200, sellBps: 300 });
    expect(points.filter(point => point.seconds === 86400)).toEqual([
      { seconds: 86400, buyBps: 50, sellBps: 75 }, { seconds: 86400, buyBps: 50, sellBps: 75 },
    ]);
    expect(points.at(-1)).toMatchObject({ buyBps: 50, sellBps: 75 });
    expect(spec.phases[0].fee).toMatchObject({ fromBuyBps: 200, toBuyBps: 50 });
  });
  it("does not turn an external condition into a fabricated time curve", () => {
    expect(feeSchedulePoints({ ...spec, phases: [{ ...spec.phases[0], endsAtSeconds: null, fee: {
      kind: "conditional", when: { kind: "feed", feedId: "rain", operator: "changed", value: "0" },
      then: { kind: "fixed", buyBps: 200, sellBps: 200 }, otherwise: { kind: "fixed", buyBps: 50, sellBps: 50 },
    } }] })).toBeNull();
  });
  it("keeps allocations from different assets and sources separate and retains an unassigned share", () => {
    const flow = { id: "liquidity", source: "fees", target: "pool", asset: "eth", trigger: "swap" as const, purpose: "Liquidity", requirementIds: ["fees"], allocationGroup: "split", shareBps: 3000 };
    const product: Pick<ProductBlueprint, "components" | "assets" | "flows"> = { components: [{ id: "pool", kind: "vault", name: "Liquidity pool", purpose: "Hold liquidity", requirementIds: ["fees"], dependsOn: [] }], assets: [{ id: "eth", kind: "native", name: "ETH" }, { id: "usdc", kind: "external-token", name: "USDC" }], flows: [
      flow, { ...flow, id: "other", asset: "usdc", shareBps: 2000 }, { ...flow, id: "deposit", source: "deposit", shareBps: 5000 },
    ] };
    const groups = productAllocations(product);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ label: "ETH", shares: [{ label: "Liquidity pool", bps: 3000 }] });
    expect(groups[1].label).toBe("USDC");
  });
});

describe("the next coin detail", () => {
  const setup = { ...EMPTY_COIN_SETUP, name: "River", symbol: "RIVER" };
  it("asks for the image before presenting launch as the next action", () => {
    expect(feeLaunchDetailIssue(setup, false)?.field).toBe("image");
    expect(feeLaunchDetailIssue(setup, true)).toBeNull();
  });
  it("does not prepare an invalid or below-minimum native buy", () => {
    for (const initialBuy of ["0", "0.001", "invalid", "0.0000000000000000001"]) {
      expect(feeLaunchDetailIssue({ ...setup, initialBuy }, true)?.field).toBe("initialBuy");
    }
  });
  it("uses the existing name and ticker limits", () => {
    expect(feeLaunchDetailIssue({ ...setup, name: "" }, true)?.field).toBe("name");
    expect(feeLaunchDetailIssue({ ...setup, symbol: "A B" }, true)?.field).toBe("symbol");
  });
});
