import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeDeployData, getCreate2Address, keccak256, toHex, type Address } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "../lib/custom-ai/runtime-materialization.server";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ContractProject, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const production = projectLaunchProductionContext(captured.chains["999"], 999), factory = production.graphProfile!.graphFactory as Address;
const intent: LaunchIntent = { version: 1, id: "runtime-word-fixture", revision: "a".repeat(64), requirements: [{ id: "surface", text: "Keep the declared constructor interfaces", kind: "constraint", open: null, origin: { kind: "legacy" } }], changes: [], unresolved: [] };
const entries: ProjectEntrypoint[] = [{ source: "Project.sol", contract: "Token", role: "token" }, { source: "Project.sol", contract: "Hook", role: "hook" }, { source: "Project.sol", contract: "Liquidity", role: "liquidity" }];
const raw = () => ({ targets: [
  { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [{ input: "name" }, { input: "symbol" }, { input: "controller" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
  { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ binding: "pool-manager" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 128 },
  { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [], initializer: { function: "initialize", arguments: [{ target: "token" }] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 3000, tickSpacing: 60 } });
const selected = () => ({ controller: `0x${"11".repeat(20)}` as Address, settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: 999, name: "Runtime", symbol: "RUN", initialBuy: "0.01" }) });
function project(variant: "stable" | "time" | "origin" | "dependency" | "child" = "stable") {
  const content = `pragma solidity 0.8.26;
contract Token { string public name; string public symbol; address public immutable controller; constructor(string memory n,string memory s,address c) { name=n;symbol=s;controller=c; } }
contract Hook { address public immutable manager; ${variant === "dependency" ? "bytes32 public immutable dependencyHash;" : ""} constructor(address m) { manager=m; ${variant === "dependency" ? "dependencyHash=m.codehash;" : ""} } }
contract Child { uint public marker=1; }
contract Liquidity { address public immutable deployer; address public immutable self; uint public immutable chain;
${variant === "origin" ? "address public immutable origin;" : ""}
${variant === "time" ? "uint public immutable start;" : ""}
constructor() { deployer=msg.sender;self=address(this);chain=block.chainid; ${variant === "origin" ? "origin=tx.origin;" : variant === "time" ? "start=block.timestamp;" : variant === "child" ? "new Child();" : ""} }
function initialize(address) external payable {} }
`;
  return createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" },
    sources: { "Project.sol": { content } }, entrypoints: entries }, intent, 999, production, createGeneralDeploymentBlueprint(raw(), entries, production, intent));
}
function predictions(p: ContractProject, compilation: CompiledProject) {
  const values = resolveGeneralDeploymentValues(p, compilation, selected()), result: GeneralDeploymentPrediction[] = [];
  const resolve = (value: unknown): unknown => Array.isArray(value) ? value.map(resolve)
    : value && typeof value === "object" && "target" in value ? result.find(target => target.targetId === value.target)?.predictedAddress : value;
  for (const target of values.targets) {
    const artifact = compilation.contracts.find(contract => contract.source === target.source && contract.contract === target.contract)!;
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: target.constructorArguments.map(resolve) }), bytecodeHash = keccak256(initCode);
    let effectiveSalt = toHex(result.length + 1, { size: 32 }), predictedAddress = getCreate2Address({ from: factory, salt: effectiveSalt, bytecodeHash });
    if (target.role === "hook") {
      let found = false;
      for (let index = 0; index < 262144; index++) {
        effectiveSalt = toHex(index, { size: 32 }); predictedAddress = getCreate2Address({ from: factory, salt: effectiveSalt, bytecodeHash });
        if (Number(BigInt(predictedAddress) & 16383n) === target.hookPermissions) { found = true; break; }
      }
      if (!found) throw Error("Fixture hook salt was not found within its bounded budget");
    }
    result.push({ targetId: target.id, predictedAddress, effectiveSalt, resolvedConstructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` });
  }
  return result;
}

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("exact isolated constructor runtime materialization", { timeout: 60_000 }, () => {
  let original: ContractProject, compilation: CompiledProject, predicted: GeneralDeploymentPrediction[];
  beforeAll(async () => { original = project(); compilation = await compileContractProject(original); expect(compilation.compiled).toBe(true); predicted = predictions(original, compilation); });
  it("derives immutable words at exact CREATE2 addresses, with the declared deployer and chain", async () => {
    const input = selected(), copied = structuredClone(predicted);
    const running = materializeGeneralRuntime(original, compilation, input, copied);
    // Mutation after dispatch cannot change any worker bytes or receipt field.
    input.controller = `0x${"22".repeat(20)}`; input.settings.name = "changed"; copied[0].resolvedConstructorArguments = "0x";
    const result = await running;
    expect(result).toMatchObject({ status: "materialized", passes: 2, scope: "isolated-constructor-runtime-v1", controller: selected().controller, launchReady: false });
    expect(result.contracts).toHaveLength(3); expect(result).not.toHaveProperty("permit");
    const words = result.contracts.find(contract => contract.id === "liquidity")!.runtimeImmutables.map(word => word.literal.toLowerCase());
    for (const address of [factory, predicted.find(target => target.targetId === "liquidity")!.predictedAddress])
      expect(words).toContain(`0x${address.slice(2).toLowerCase().padStart(64, "0")}`);
    expect(result.contracts.find(contract => contract.id === "token")!.runtimeImmutables.map(word => word.literal.toLowerCase())).toContain(`0x${selected().controller.slice(2).padStart(64,"0")}`);
    expect(words).toContain(toHex(999, { size: 32 }));
    for (const contract of result.contracts) expect(contract.runtimeCodeHash).toBe(keccak256(contract.runtimeCode));
  });
  it("rejects changed salts, ABI bytes, permission addresses and missing predictions before execution", async () => {
    for (const change of [
      (values: GeneralDeploymentPrediction[]) => { values[0].effectiveSalt = toHex(9999, { size: 32 }); },
      (values: GeneralDeploymentPrediction[]) => { values[0].resolvedConstructorArguments = "0x"; },
      (values: GeneralDeploymentPrediction[]) => { values[1].predictedAddress = selected().controller; },
      (values: GeneralDeploymentPrediction[]) => { values.pop(); },
    ]) {
      const values = structuredClone(predicted); change(values);
      await expect(materializeGeneralRuntime(original, compilation, selected(), values)).rejects.toMatchObject({ code: "runtime-context", status: 409 });
    }
  });
  it.each(["time", "origin", "dependency", "child"] as const)("leaves %s-dependent construction unresolved instead of inventing runtime words", async variant => {
    const p = project(variant), built = await compileContractProject(p); expect(built.compiled).toBe(true);
    await expect(materializeGeneralRuntime(p, built, selected(), predictions(p, built))).rejects.toMatchObject({ code: "runtime-dependency", status: 422 });
  });
  it("does not start preparation for an already stopped job", async () => {
    const stop = new AbortController(); stop.abort(new Error("stopped"));
    await expect(materializeGeneralRuntime(original, compilation, selected(), predicted, stop.signal)).rejects.toThrow("stopped");
  });
});
