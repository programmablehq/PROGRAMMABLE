import { describe, expect, it } from "vitest";
import { sourceImplementationContext } from "../lib/custom-ai/source-implementation-context";
import type { GeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";

describe("component source writing context", () => {
  it("retains interfaces and deployment without leaking fixture execution into implementation", () => {
    const blueprint = {
      id: `sha256:${"a".repeat(64)}`, version: 1, intentId: "design", intentRevision: "unchanged",
      compiler: { version: "0.8.26" }, entrypoints: [{ source: "src/Hook.sol", contract: "Hook", role: "hook" }],
      deployment: { targets: [{ id: "hook", constructorArguments: ["exact-controller"] }] },
      scenarios: { contracts: [{ source: "src/Hook.sol", functions: ["function collect()"] }],
        constructorChildren: [{ parent: "hook", nonce: "1" }], steps: [{ id: "independent-expected-payment" }] },
    } as unknown as GeneralCheckBlueprint;
    const dependencies = {
      "HookBase.sol": { content: "pragma solidity 0.8.26; contract Base { function collect() external { revert(); } }" },
      "TokenBase.sol": { content: "pragma solidity 0.8.26; contract Token { function transfer() external { revert(); } }" },
    };
    const before = structuredClone({ blueprint, dependencies });
    const completed = { "src/Token.sol": { content: "contract Token { function snapshot() external {} }" } };
    const value = sourceImplementationContext({ blueprint, dependencies,
      references: [{ source: "HookBase.sol", functions: ["function collect()"] },
        { source: "TokenBase.sol", functions: ["function transfer()"] }],
      construction: [{ source: "Initializer.sol", initializationSources: ["actual-start-call"] }] }, "src/Hook.sol", completed);
    expect(value.fixedChecks.id).toBe(blueprint.id);
    expect(value.fixedChecks.deployment).toEqual(blueprint.deployment);
    expect(value.fixedChecks.interfaces).toEqual(blueprint.scenarios.contracts);
    expect(value.fixedChecks.constructorChildren).toEqual(blueprint.scenarios.constructorChildren);
    expect(value.fixedChecks).not.toHaveProperty("scenarios");
    expect(value.dependencySources["HookBase.sol"].content).toContain("revert()");
    expect(value.dependencySources["TokenBase.sol"]).toBeUndefined();
    expect(value.availableImportPaths).toContain("TokenBase.sol");
    expect(value.completedSources).toEqual(completed);
    value.completedSources["src/Token.sol"].content = "changed";
    expect(completed["src/Token.sol"].content).toContain("snapshot");
    expect({ blueprint, dependencies }).toEqual(before);
    expect(() => sourceImplementationContext({ blueprint, dependencies, references: [], construction: [] }, "unrelated.sol", {})).toThrow();
  });
});
