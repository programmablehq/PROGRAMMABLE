import { describe, expect, it } from "vitest";
import { checkedProductBlueprint, createProductBlueprint, productPlanSchema, type ProductPlan } from "../lib/custom-ai/product/blueprint";
import Ajv from "ajv";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { projectAllocation, reviewProductEconomics } from "../lib/custom-ai/product/economics";

const intent: LaunchIntent = { version: 1, id: "fee-product", revision: "a".repeat(64), requirements: [
  { id: "fees", text: "Collect project fees", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "liquidity", text: "30% for liquidity", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "burn", text: "20% for buyback and burn", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "holders", text: "20% for holder rewards", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "creator", text: "30% for creator", kind: "decision", open: null, origin: { kind: "legacy" } },
], unresolved: [], changes: [] };
function plan(): ProductPlan {
  return {
    components: [
      { id: "fee-hook", kind: "hook", name: "Fee hook", purpose: "Collect project fees", requirementIds: ["fees"], dependsOn: [] },
      { id: "liquidity-vault", kind: "vault", name: "Liquidity", purpose: "Add the funded liquidity share", requirementIds: ["liquidity"], dependsOn: ["fee-hook"] },
      { id: "buyback", kind: "vault", name: "Buyback and burn", purpose: "Buy and burn using its own funds", requirementIds: ["burn"], dependsOn: ["fee-hook"] },
      { id: "holder-vault", kind: "vault", name: "Holder rewards", purpose: "Keep holder allocations claimable", requirementIds: ["holders"], dependsOn: ["fee-hook"] },
    ],
    assets: [{ id: "quote", kind: "native", name: "ETH" }],
    flows: [
      { id: "lp-share", source: "fee-hook", target: "liquidity-vault", asset: "quote", trigger: "swap", purpose: "Fund liquidity", requirementIds: ["liquidity"], allocationGroup: "project-fees", shareBps: 3000 },
      { id: "burn-share", source: "fee-hook", target: "buyback", asset: "quote", trigger: "swap", purpose: "Fund buyback", requirementIds: ["burn"], allocationGroup: "project-fees", shareBps: 2000 },
      { id: "holder-share", source: "fee-hook", target: "holder-vault", asset: "quote", trigger: "swap", purpose: "Fund claims", requirementIds: ["holders"], allocationGroup: "project-fees", shareBps: 2000 },
      { id: "creator-share", source: "fee-hook", target: "creator", asset: "quote", trigger: "swap", purpose: "Creator allocation", requirementIds: ["creator"], allocationGroup: "project-fees", shareBps: 3000 },
    ], services: [], interfaceActions: [{ id: "claim-rewards", target: "holder-vault", kind: "claim", requirementIds: ["holders"] }],
  };
}

describe("canonical product blueprint", () => {
  it("rejects unbound model components in the response schema as well as the saved plan",()=>{
    const validate=new Ajv({strict:false}).compile(productPlanSchema),candidate=plan();
    expect(validate(candidate)).toBe(true);
    candidate.components[0].requirementIds=[];
    expect(validate(candidate)).toBe(false);
    expect(()=>createProductBlueprint(candidate,intent,8453)).toThrow();
  });
  it("keeps every atom accounted for without fabricating investment returns", () => {
    const product = createProductBlueprint(plan(), intent, 8453);
    for (const amountAtoms of ["0", "1", "7", "101", "1000000000000000001"]) {
      const result = projectAllocation(product, { source: "fee-hook", asset: "quote", allocationGroup: "project-fees", amountAtoms });
      expect(result.transfers.reduce((sum, flow) => sum + BigInt(flow.amountAtoms), 0n) + BigInt(result.retainedAtoms)).toBe(BigInt(amountAtoms));
      expect(result.contractExecution).toBe("not-run");
      expect(result.productId).toBe(product.id);
    }
    const incomplete = plan(); incomplete.flows.pop();
    expect(projectAllocation(createProductBlueprint(incomplete,intent,8453),{source:"fee-hook",asset:"quote",allocationGroup:"project-fees",amountAtoms:"1000"}))
      .toMatchObject({ retainedAtoms: "300", unassignedAtoms: "300", roundingAtoms: "0" });
  });
  it("detects an unfunded closed cycle and resolves only the declared asset's funding path", () => {
    const candidate = plan();
    candidate.flows.push({ ...candidate.flows[0], id: "cycle", source: "liquidity-vault", target: "fee-hook", allocationGroup: null, shareBps: null });
    expect(reviewProductEconomics(createProductBlueprint(candidate,intent,8453)).fundingToDefine.map(item=>item.component)).toContain("fee-hook");
    candidate.flows.push({ ...candidate.flows[0], id: "funding", source: "trader", target: "fee-hook", allocationGroup: null, shareBps: null });
    expect(reviewProductEconomics(createProductBlueprint(candidate,intent,8453)).fundingToDefine).toEqual([]);
  });
  it("keeps an intentional reserve at its source instead of treating it as an external transfer",()=>{
    const candidate=plan();candidate.flows[3].target="fee-hook";
    const result=projectAllocation(createProductBlueprint(candidate,intent,8453),{source:"fee-hook",asset:"quote",allocationGroup:"project-fees",amountAtoms:"1001"});
    expect(result.transfers).toHaveLength(3);
    expect(result).toMatchObject({retainedAtoms:"301",retainedAllocationAtoms:"300",unassignedAtoms:"0",roundingAtoms:"1"});
    expect(result.transfers.reduce((sum,flow)=>sum+BigInt(flow.amountAtoms),0n)+BigInt(result.retainedAtoms)).toBe(1001n);
  });
  it("rejects projections of undecided budgets, unrelated groups and impossible integer amounts", () => {
    const candidate = plan(); candidate.flows[0].shareBps = null;
    const product = createProductBlueprint(candidate,intent,8453);
    const input = { source:"fee-hook",asset:"quote",allocationGroup:"project-fees",amountAtoms:"1000" };
    expect(()=>projectAllocation(product,input)).toThrow();
    expect(()=>projectAllocation(createProductBlueprint(plan(),intent,8453),{...input,allocationGroup:"other"})).toThrow();
    for(const amountAtoms of ["-1","1.2","01",(1n<<256n).toString()])expect(()=>projectAllocation(createProductBlueprint(plan(),intent,8453),{...input,amountAtoms})).toThrow();
  });
  it("binds the complete product to one intent revision without claiming execution", () => {
    const value = createProductBlueprint(plan(), intent, 8453);
    expect(value).toMatchObject({ intentId: intent.id, intentRevision: intent.revision, chainId: 8453, state: "defined", execution: "not-certified", issues: [] });
    expect(checkedProductBlueprint(value, intent, 8453)).toEqual(value);
  });
  it("keeps the missing 30 percent instead of normalizing the other fee shares", () => {
    const candidate = plan(); candidate.flows.pop();
    const value = createProductBlueprint(candidate, intent, 8453);
    expect(value.flows.map(flow => flow.shareBps)).toEqual([2000, 2000, 3000]);
    expect(value.issues).toContainEqual(expect.objectContaining({ code: "incomplete-allocation", detail: expect.stringContaining("3000 bps") }));
    expect(value.issues).toContainEqual(expect.objectContaining({ code: "unassigned-requirement", ids: ["creator"] }));
  });
  it("finds two actions allocating more than the same available funds", () => {
    const candidate = plan(); candidate.flows[0].shareBps = 6000;
    expect(createProductBlueprint(candidate, intent, 8453).issues).toContainEqual(expect.objectContaining({ code: "excess-allocation" }));
  });
  it("keeps independent assets and funding groups separate", () => {
    const candidate = plan(); candidate.assets.push({ id: "coin", kind: "launch-token", name: "Coin" });
    candidate.flows.push({ ...candidate.flows[0], id: "coin-claim", asset: "coin", allocationGroup: "staking-funds", shareBps: 10000 });
    expect(createProductBlueprint(candidate, intent, 8453).issues).toEqual([]);
  });
  it("requires a real choice for an undecided share", () => {
    const candidate = plan(); candidate.flows[3].shareBps = null;
    expect(createProductBlueprint(candidate, intent, 8453).issues).toContainEqual(expect.objectContaining({ code: "unresolved-share" }));
  });
  it("keeps external service failure behavior explicit without claiming a live integration", () => {
    const candidate = plan(); candidate.components.push({ id: "executor", kind: "automation", name: "Execution", purpose: "Execute funded actions", requirementIds: ["liquidity", "burn"], dependsOn: ["fee-hook"] });
    candidate.services.push({ component: "executor", capability: "fee-actions", trigger: "time", failurePolicy: "undecided", requirementIds: ["liquidity", "burn"] });
    expect(createProductBlueprint(candidate, intent, 8453)).toMatchObject({ execution: "not-certified", state: "needs-decisions", issues: [expect.objectContaining({ code: "failure-policy" })] });
  });
  it.each(["unknown-rule", "unknown-target", "duplicate", "invalid-share", "unbound-share"])("rejects %s instead of silently changing the proposal", fault => {
    const candidate = plan();
    if (fault === "unknown-rule") candidate.components[0].requirementIds = ["not-requested"];
    if (fault === "unknown-target") candidate.flows[0].target = "not-declared";
    if (fault === "duplicate") candidate.components.push(candidate.components[0]);
    if (fault === "invalid-share") candidate.flows[0].shareBps = -1;
    if (fault === "unbound-share") candidate.flows[0].allocationGroup = null;
    expect(() => createProductBlueprint(candidate, intent, 8453)).toThrow();
  });
  it("has a stable identity across ordering and rejects another chain, revision or altered contents", () => {
    const original = createProductBlueprint(plan(), intent, 8453), shuffled = plan();
    shuffled.components.reverse(); shuffled.flows.reverse();
    expect(createProductBlueprint(shuffled, intent, 8453).id).toBe(original.id);
    expect(() => checkedProductBlueprint(original, intent, 1)).toThrow();
    expect(() => checkedProductBlueprint(original, { ...intent, revision: "b".repeat(64) }, 8453)).toThrow();
    const altered = structuredClone(original); altered.flows[0].target = "trader";
    expect(() => checkedProductBlueprint(altered, intent, 8453)).toThrow();
  });
  it("does not let callers add a readiness claim or mutate the source proposal afterward", () => {
    const candidate = plan(), value = createProductBlueprint(candidate, intent, 8453);
    candidate.components[0].name = "Changed later";
    expect(value.components.some(item => item.name === "Changed later")).toBe(false);
    expect(() => checkedProductBlueprint({ ...value, execution: "live" } as never, intent, 8453)).toThrow();
  });
});
