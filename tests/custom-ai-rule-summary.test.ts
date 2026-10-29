import { describe, expect, it } from "vitest";
import { summarizeRules, conditionSummary } from "../lib/custom-ai/rule-summary";
import { normalizeRuleSpec } from "../lib/custom-ai/rule-spec";
import fixture from "./fixtures/custom-ai/london-liquidity-v2.json";
describe("visible combined rules", () => {
  it("shows every phase and the exact additional-fee allocation", () => {
    const result = summarizeRules(normalizeRuleSpec(fixture), "ETH");
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].rule).toContain("10%");
    expect(result.phases[0].rule).toContain("1%");
    expect(result.phases[1].rule).toContain("0.001 mm");
    expect(result.phases[1].rule).toContain("5%");
    expect(result.allocations[0].title).toBe("100% → permanently locked liquidity");
    expect(result.allocations[0].detail).toContain("0.01 ETH");
    expect(result.dataNotice).toContain("0.5%");
  });
  it("preserves AND/OR distinctions and delayed event execution", () => {
    const when = {kind:"all" as const,conditions:[{kind:"feed" as const,feedId:"london-rain-v1",operator:"changed" as const,value:"0"},{kind:"feed" as const,feedId:"volume",operator:"gte" as const,value:"20"}]};
    expect(conditionSummary(when)).toBe("(London rain changes after launch) and (volume is at least 20)");
    const spec=normalizeRuleSpec({...fixture,actions:[{...fixture.actions[0],startsAtSeconds:600,when}]});
    const summary=summarizeRules(spec);
    expect(summary.allocations[0].detail).toContain("Starts after 10 minutes");
    expect(summary.allocations[0].detail).toContain("and (volume");
  });
  it("shows cached market thresholds in dollars instead of encoded source units",()=>{
    expect(conditionSummary({kind:"feed",feedId:"coin-market-cap",operator:"gte",value:"20000000000000"},[{id:"coin-market-cap",sourceVersion:"programmable-market-usd6-v1"}])).toBe("coin market cap is at least 20000000 USD");
  });
});
