import "server-only";
import { defineTool } from "../definition.server";
import { FEE_FLOW_VERSION, planFeeFlow, type FeeAllocation } from "../../fee-flow";

export default defineTool("plan_fee_flow", `Fee allocation planner ${FEE_FLOW_VERSION}. Locally check shares of collected project fees for liquidity, buyback/burn, holder rewards or other named actions. Detect the exact undecided remainder or excess without changing user choices. This is allocation arithmetic, not a swap-tax calculator or money action; no network or model request. Use 3000 bps for 30%.`, async (input, context) => {
  context.signal?.throwIfAborted();
  const { allocations } = input as { allocations: FeeAllocation[] };
  return { status: "fee-flow-plan", facts: planFeeFlow(allocations), sources: [] };
}, () => true, { type: "object", properties: { allocations: { type: "array", minItems: 1, maxItems: 12, items: {
  type: "object", properties: { id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$" }, shareBps: { type: "integer", minimum: 0, maximum: 10000 } },
  required: ["id", "shareBps"], additionalProperties: false,
} } }, required: ["allocations"], additionalProperties: false });
