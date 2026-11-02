import { describe, expect, it } from "vitest";
import { bindCanonicalTokenMetadata } from "../lib/custom-ai/deployment-metadata";

const target = () => ({ source: "src/launch-protection/ProtectedLaunchTokenV1.sol", contract: "ProtectedLaunchTokenV1",
  constructorArguments: ["Fixture", "FIX", "1000000", { target: "initializer" }, { binding: "pool-manager" }] });

describe("selected coin metadata in a new deployment", () => {
  it("replaces only fixture metadata with live coin inputs and keeps all financial values and the original declaration", () => {
    const declaration = { targets: [target()], fees: { buyPpm: 5000, sellPpm: 6000 } }, original = structuredClone(declaration);
    const bound = bindCanonicalTokenMetadata(declaration);
    expect(bound.changed).toBe(true);
    expect(bound.value).toEqual({ ...declaration, targets: [{ ...target(), constructorArguments: [
      { input: "name" }, { input: "symbol" }, "1000000", { target: "initializer" }, { binding: "pool-manager" },
    ] }] });
    expect(declaration).toEqual(original);
  });
  it("does not reinterpret a custom contract or another constructor layout", () => {
    for (const different of [{ ...target(), source: "src/project/CustomToken.sol" },
      { ...target(), contract: "CustomToken" }, { ...target(), constructorArguments: ["label", "policy", "100"] }]) {
      const value = { targets: [different] };
      expect(bindCanonicalTokenMetadata(value)).toEqual({ value, changed: false });
    }
  });
  it("keeps already bound declarations identical and leaves unrelated inputs to the ABI validator", () => {
    const value = { targets: [{ ...target(), constructorArguments: [{ input: "name" }, { input: "symbol" }, "100", false, true] }] };
    expect(bindCanonicalTokenMetadata(value)).toEqual({ value, changed: false });
  });
});
