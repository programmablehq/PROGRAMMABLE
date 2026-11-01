import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/custom-ai-launch-discovery.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { checkedGeneralDeploymentBlueprint, createGeneralDeploymentBlueprint, deploymentBlueprintInput } from "../lib/custom-ai/deployment-blueprint";
import type { ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
const intent: LaunchIntent = { version: 1, id: "constructor-child-declaration", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "children", text: "The hook creates two vaults and a separate module with declared owners", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const entries: ProjectEntrypoint[] = [{ source: "Project.sol", contract: "Token", role: "token" }, { source: "Project.sol", contract: "Hook", role: "hook" },
  { source: "Project.sol", contract: "Liquidity", role: "liquidity" }, { source: "Project.sol", contract: "Vault", role: "auxiliary" }, { source: "Project.sol", contract: "Module", role: "auxiliary" }];
const raw = () => ({ targets: [
  { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
  { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ input: "controller" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 128 },
  { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [], initializer: { function: "initialize", arguments: [{ target: "token" }, { target: "hook" }] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 3000, tickSpacing: 60 }, constructorChildren: [
  { id: "fee-vault", source: "Project.sol", contract: "Vault", parent: "hook", creation: "create", nonce: "1", constructorArguments: [{ target: "hook" }, { input: "controller" }], value: "0" },
  { id: "module", source: "Project.sol", contract: "Module", parent: "hook", creation: "create", nonce: "2", constructorArguments: [{ target: "fee-vault" }], value: "0" },
  { id: "opening-vault", source: "Project.sol", contract: "Vault", parent: "hook", creation: "create", nonce: "3", constructorArguments: [{ target: "hook" }, { input: "controller" }], value: "0" },
] });
const production = (chain: 1 | 4663 | 8453 | 999) => projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain);
describe("source-bound constructor children as a versioned deployment declaration", () => {
  it.each([1, 4663, 8453, 999] as const)("binds six instances from five artifacts on chain %s without inventing deployment evidence", chain => {
    const context = production(chain), declared = createGeneralDeploymentBlueprint(raw(), entries, context, intent);
    expect(declared.version).toBe(2); if (declared.version !== 2) throw Error("Wrong declaration version");
    expect(declared.targets).toHaveLength(3); expect(declared.constructorChildren).toHaveLength(3);
    expect(checkedGeneralDeploymentBlueprint(structuredClone(declared), entries, context, intent)).toEqual(declared);
    expect(createGeneralDeploymentBlueprint(deploymentBlueprintInput(declared), entries, context, intent)).toEqual(declared);
    expect(declared).not.toHaveProperty("runtimeCodeHash"); expect(declared).not.toHaveProperty("launchReady");
    const changed = raw(); changed.constructorChildren[0].constructorArguments = [{ target: "token" }];
    expect(createGeneralDeploymentBlueprint(changed, entries, context, intent).id).not.toBe(declared.id);
  });
  it.each(["parent", "nonce", "reuse", "artifact", "forward", "unknown", "create2", "amount", "unused"])("rejects an undeclared or ambiguous %s", field => {
    const value = raw(); let selected = entries;
    if (field === "parent") value.constructorChildren[0].parent = "module";
    if (field === "nonce") value.constructorChildren[1].nonce = "3";
    if (field === "reuse") value.constructorChildren[0].id = "hook";
    if (field === "artifact") value.constructorChildren[0].contract = "Missing";
    if (field === "forward") value.constructorChildren[0].constructorArguments = [{ target: "opening-vault" }];
    if (field === "unknown") Object.assign(value.constructorChildren[0], { runtimeCodeHash: "invented" });
    if (field === "create2") value.constructorChildren[0].creation = "create2";
    if (field === "amount") value.constructorChildren[0].value = (2n ** 256n).toString();
    if (field === "unused") selected = [...entries, { source: "Unused.sol", contract: "Hidden", role: "auxiliary" }];
    expect(() => createGeneralDeploymentBlueprint(value, selected, production(1), intent)).toThrow();
  });
  it("retains V1 hashes and refuses to strip or reinterpret a declared child", () => {
    const { constructorChildren, ...roots } = raw(); expect(constructorChildren).toHaveLength(3);
    const oldEntries = entries.slice(0, 3), context = production(1), old = createGeneralDeploymentBlueprint(roots, oldEntries, context, intent);
    expect(old.version).toBe(1); expect(checkedGeneralDeploymentBlueprint(old, oldEntries, context, intent)).toEqual(old);
    const next = createGeneralDeploymentBlueprint(raw(), entries, context, intent);
    expect(() => checkedGeneralDeploymentBlueprint({ ...next, version: 1 }, entries, context, intent)).toThrow();
    if (next.version !== 2) throw Error("Missing V2"); next.constructorChildren.pop();
    expect(() => checkedGeneralDeploymentBlueprint(next, entries, context, intent)).toThrow();
  });
});
