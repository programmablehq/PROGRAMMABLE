import "server-only";
import { defineTool } from "../definition.server";
import { projectAllocation, type AllocationExampleInput } from "../../product/economics";

export default defineTool("project_allocation", "Project one budget from the user's saved product using exact integer arithmetic. Supply its declared source, asset and allocationGroup and an amountAtoms decimal string in the asset's smallest units. Returns exact recipient amounts, unassigned funds and rounding retained. Never a price estimate, contract simulation or transaction; no network or model request.", async (input, context) => {
  context.signal?.throwIfAborted();
  if (!context.productBlueprint) throw new TypeError("No saved product allocation is available.");
  return { status: "allocation-example", facts: projectAllocation(context.productBlueprint, input as AllocationExampleInput), sources: [] };
}, context => Boolean(context.productBlueprint?.flows.some(flow => flow.allocationGroup)), {
  type: "object", properties: {
    source: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, asset: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
    allocationGroup: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, amountAtoms: { type: "string", pattern: "^(0|[1-9][0-9]{0,77})$" },
  }, required: ["source", "asset", "allocationGroup", "amountAtoms"], additionalProperties: false,
});
