import {describe, expect, it} from "vitest";
import {readProductValue} from "../lib/custom-ai/product/action-value";
import type {ProductRuntime} from "../lib/custom-ai/product/runtime";
const runtime = {sourceBinding: "bound-source", chainId: 1, checkedAt: "2026-11-04T15:00:00.000Z",
  block: {number: "100", hash: `0x${"1".repeat(64)}`},
  actions: [{id: "inspect", address: `0x${"2".repeat(40)}`, signature: "claimable(address)", mutability: "view"}]} as ProductRuntime;
const value = {state: "value-observed", actionId: "inspect", callId: `sha256:${"3".repeat(64)}`,
  sourceBinding: runtime.sourceBinding, chainId: 1, caller: `0x${"4".repeat(40)}`, target: runtime.actions[0].address,
  signature: runtime.actions[0].signature, block: runtime.block, snapshotAt: runtime.checkedAt,
  observedAt: "2026-11-04T15:00:02.000Z", outputs: [{name: "amount", type: "uint256", value: "900719925474099312345"}], authorized: false};
describe("contract value display boundary", () => {
  it("preserves exact integer outputs and their snapshot", () => {
    expect(readProductValue(value, runtime, "inspect").outputs[0].value).toBe("900719925474099312345");
  });
  it("rejects a different product, function, chain or snapshot", () => {
    for (const patch of [{sourceBinding: "other"}, {signature: "claim()"}, {chainId: 999}, {block: {...runtime.block, number: "99"}}, {authorized: true}])
      expect(() => readProductValue({...value, ...patch}, runtime, "inspect")).toThrow("does not match");
  });
  it("rejects numeric coercion and excessive decoded data", () => {
    for (const raw of [9007199254740993, "x".repeat(4097), {nested: [1]}])
      expect(() => readProductValue({...value, outputs: [{...value.outputs[0], value: raw}]}, runtime, "inspect")).toThrow();
  });
});
