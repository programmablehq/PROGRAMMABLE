import { describe, expect, it } from "vitest";
import { builderChain, selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { builderCapabilities } from "../lib/custom-ai/builder-capabilities";

const intent: LaunchIntent = { version: 1, id: "routing-fixture", revision: "a".repeat(64), unresolved: [], changes: [], requirements: [
  { id: "fees", text: "Different buy and sell fees", kind: "behavior", open: null, origin: { kind: "legacy" } },
  { id: "no-mint", text: "No later minting", kind: "constraint", open: null, origin: { kind: "legacy" } },
] };
describe("Custom AI execution path selection", () => {
  it("only describes general source generation when its durable job bridge is connected", () => {
    expect(builderCapabilities({ events: false, programs: false }).find(item => item.id === "arbitrary-hooks")?.state).toBe("design-only");
    expect(builderCapabilities({ events: false, programs: false, generalSources: true }).find(item => item.id === "arbitrary-hooks")?.state).toBe("source-draft");
    expect(builderCapabilities({events:false,programs:false,generalSources:true,chainId:999}).find(item=>item.id==="fee-schedules")?.state).toBe("source-draft");
    expect(builderCapabilities({events:false,programs:false,chainId:8453}).find(item=>item.id==="fee-schedules")?.state).toBe("design-only");
  });
  it.each([1, 4663] as const)("retains the complete fee route on %i without claiming preparation", chainId => {
    const result = selectExecutionRoute(intent, chainId, { route: "fee-module", requirementIds: ["fees", "no-mint"], missingCapabilities: [] });
    expect(result).toMatchObject({ chainId, route: "fee-module", state: "selected", launchReady: false });
  });
  it.each([8453, 999] as const)("uses the general route on %i instead of borrowing another chain's fee core", chainId => {
    const result = selectExecutionRoute(intent, chainId, { route: "fee-module", requirementIds: ["fees", "no-mint"], missingCapabilities: [] });
    expect(result).toMatchObject({ chainId, route: "custom-contract", reason: "no-fee-core-on-network", launchReady: false });
    expect(builderChain(chainId).createPath).toContain(`/chains/${chainId}/`);
  });
  it("never drops an uncovered negative constraint into a fee template", () => {
    const result = selectExecutionRoute(intent, 1, { route: "fee-module", requirementIds: ["fees"], missingCapabilities: [] });
    expect(result.route).toBe("custom-contract"); expect(result.requirementIds).toEqual(["fees", "no-mint"]);
  });
  it("keeps weather and LP service gaps with the general design", () => {
    const result = selectExecutionRoute(intent, 4663, { route: "composed-module", requirementIds: ["fees", "no-mint"], missingCapabilities: ["London feed", "LP worker"] });
    expect(result.route).toBe("custom-contract"); expect(result.missingCapabilities).toEqual(["LP worker", "London feed"]);
    expect(result.launchReady).toBe(false);
  });
  it("preserves all open choices and picks the same route after storage reordering", () => {
    const open = { ...intent, requirements: [...intent.requirements, { ...intent.requirements[0], id: "weather", text: "London weather", open: "Which signed source?" }], unresolved: ["Which signed source?"] };
    const first = selectExecutionRoute(open, 999);
    expect(first.openRequirements).toEqual([{ id: "weather", question: "Which signed source?" }]);
    expect(first.state).toBe("needs-input");
    expect(selectExecutionRoute({ ...open, requirements: [...open.requirements].reverse() }, 999).id).toBe(first.id);
  });
  it("binds a choice to the chain and complete intent revision", () => {
    expect(selectExecutionRoute(intent, 1).id).not.toBe(selectExecutionRoute(intent, 999).id);
    expect(selectExecutionRoute(intent, 1).id).not.toBe(selectExecutionRoute({ ...intent, revision: "b".repeat(64) }, 1).id);
  });
  it("keeps the current Robinhood plan API and HyperEVM currency", () => {
    expect(builderChain(4663).preflightPath).toBe("/v4/chains/4663/custom-launch-plans:preflight");
    expect(builderChain(999).currency).toBe("HYPE");
    expect(() => builderChain(56)).toThrow();
  });
  it("rejects invented or duplicated template coverage", () => {
    for (const requirementIds of [["fees", "fees"], ["fees", "invented"]]) expect(() => selectExecutionRoute(intent, 1,
      { route: "fee-module", requirementIds, missingCapabilities: [] })).toThrow();
  });
});
