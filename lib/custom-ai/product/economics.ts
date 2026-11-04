import type { ProductBlueprint, ProductFlow } from "./blueprint";

export type ProductBudget = {
  source: string; asset: string; allocationGroup: string; flowIds: string[];
  allocatedBps: number; undecided: boolean; remainderBps: number;
};
export type ProductEconomicReview = {
  productId: ProductBlueprint["id"];
  budgets: ProductBudget[];
  fundingToDefine: { component: string; asset: string; flowIds: string[] }[];
  externalActions: { component: string; failurePolicy: string; funded: "unspecified" }[];
  scope: "declared-money-flows";
};

export function productDecisionQuestions(product: ProductBlueprint): string[] {
  const names = new Map(product.components.map(component=>[component.id,component.name]));
  return product.issues.flatMap(issue=>{
    const flow=product.flows.find(flow=>issue.ids.includes(flow.id));
    const budget=flow?(names.get(flow.source)??flow.source):"these funds";
    if(issue.code==="incomplete-allocation")return [`Where should the remaining ${(issue.basisPoints??0)/100}% from ${budget} go?`];
    if(issue.code==="excess-allocation")return [`The shares from ${budget} exceed the available funds by ${(issue.basisPoints??0)/100}%. Which share should change?`];
    if(issue.code==="unresolved-share")return [`What shares of ${budget} should each destination receive?`];
    if(issue.code==="failure-policy")return [`What should ${names.get(issue.ids[0])??"the automated action"} do if its data or service is unavailable?`];
    return [];
  });
}

export function reviewProductEconomics(product: ProductBlueprint): ProductEconomicReview {
  const groups = new Map<string, ProductFlow[]>();
  for (const flow of product.flows) if (flow.allocationGroup !== null) {
    const key = JSON.stringify([flow.source, flow.asset, flow.allocationGroup]);
    groups.set(key, [...(groups.get(key) ?? []), flow]);
  }
  const budgets = [...groups.values()].map(flows => {
    const allocatedBps = flows.reduce((sum, flow) => sum + (flow.shareBps ?? 0), 0);
    return { source: flows[0].source, asset: flows[0].asset, allocationGroup: flows[0].allocationGroup!,
      flowIds: flows.map(flow => flow.id), allocatedBps, undecided: flows.some(flow => flow.shareBps === null), remainderBps: 10000 - allocatedBps };
  });
  const fundingToDefine: ProductEconomicReview["fundingToDefine"] = [];
  // A closed cycle does not create money. Walk only from explicitly declared
  // outside participants, independently for each asset. Unknown initial
  // balances remain a funding question, never a zero-balance live assertion.
  for (const asset of product.assets) {
    const reached = new Set(["creator", "trader", "holders", "community", "protocol"]);
    const flows = product.flows.filter(flow => flow.asset === asset.id && flow.shareBps !== 0);
    for (let pass = 0; pass < product.components.length; pass++) {
      let changed = false;
      for (const flow of flows) if (reached.has(flow.source) && !reached.has(flow.target)) { reached.add(flow.target); changed = true; }
      if (!changed) break;
    }
    for (const component of product.components) {
      const outgoing = flows.filter(flow => flow.source === component.id);
      if (outgoing.length && !reached.has(component.id)) fundingToDefine.push({ component: component.id, asset: asset.id, flowIds: outgoing.map(flow => flow.id) });
    }
  }
  return { productId: product.id, budgets, fundingToDefine,
    externalActions: product.services.map(service => ({ component: service.component, failurePolicy: service.failurePolicy, funded: "unspecified" })),
    scope: "declared-money-flows" };
}

export type AllocationExampleInput = { source: string; asset: string; allocationGroup: string; amountAtoms: string };
/** Exact arithmetic over one declared budget. No model, price estimate,
 * contract execution, token decimal inference or provider request occurs. */
export function projectAllocation(product: ProductBlueprint, input: AllocationExampleInput) {
  if (!input || Object.keys(input).sort().join() !== "allocationGroup,amountAtoms,asset,source"
    || typeof input.amountAtoms !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(input.amountAtoms)) throw new TypeError("Use an explicit nonnegative amount in the asset's smallest units.");
  const flows = product.flows.filter(flow => flow.source === input.source && flow.asset === input.asset && flow.allocationGroup === input.allocationGroup);
  if (!flows.length) throw new TypeError("Choose an allocation budget from this saved product.");
  const sum = flows.reduce((total, flow) => total + (flow.shareBps ?? 0), 0);
  if (flows.some(flow => flow.shareBps === null) || sum > 10000) throw new TypeError("Resolve the undecided or excess allocation before projecting amounts.");
  const amount = BigInt(input.amountAtoms);
  if (amount >= 1n << 256n) throw new TypeError("The amount exceeds the asset integer range.");
  const allocations = flows.map(flow => ({ flowId: flow.id, recipient: flow.target, shareBps: flow.shareBps!, amountAtoms: (amount * BigInt(flow.shareBps!) / 10000n).toString() }));
  const transfers = allocations.filter(allocation => allocation.recipient !== input.source);
  const retainedAllocation = allocations.filter(allocation => allocation.recipient === input.source).reduce((total, allocation) => total + BigInt(allocation.amountAtoms), 0n);
  const sent = transfers.reduce((total, transfer) => total + BigInt(transfer.amountAtoms), 0n);
  const unassigned = amount * BigInt(10000 - sum) / 10000n;
  return { scope: "allocation-arithmetic" as const, productId: product.id, source: input.source, asset: input.asset, allocationGroup: input.allocationGroup,
    inputAtoms: amount.toString(), transfers, retainedAtoms: (amount - sent).toString(), retainedAllocationAtoms: retainedAllocation.toString(), unassignedAtoms: unassigned.toString(),
    roundingAtoms: (amount - sent - retainedAllocation - unassigned).toString(), contractExecution: "not-run" as const };
}

export const PRODUCT_ECONOMIC_RULES = `Think in assets, cash flows, timing and permissions, not only fee percentages. A payment needs a named funding source. A cycle or a later buyer is not guaranteed income. Distinguish a fee allocation from a swap tax, trading return, token price and promised yield. Explain who can claim, what balance or snapshot makes them eligible, when funds become available, and whether the same funds are being promised twice.
For holder rewards consider transfers around the snapshot and repeated claims. For buybacks and liquidity account for quote assets, price impact, slippage and internal fees. External triggers need data freshness, failure behavior and a funded executor; preserve the desired mechanism while identifying the concrete missing part. Do not invent a funding source, administrator power, live service, collateral, price or token-decimal value.
Use the saved product's economic review as declared-plan evidence. fundingToDefine means the plan has not identified an outside funding path, not proof that a live account has no money. A budget projection is exact allocation arithmetic only, never a successful contract simulation, swap, price quote, deployment or income guarantee. Use project_allocation for requested numeric examples when a saved allocation exists. Keep examples separate from the accepted design.`;
