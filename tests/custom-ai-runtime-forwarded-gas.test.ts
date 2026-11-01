import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeDeployData, getAddress, getCreate2Address, keccak256, toHex, type Address } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "../lib/custom-ai/runtime-materialization.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "known-constructor-calls", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "observed", text: "Keep exact source-call results without gas-dependent runtime or hidden destruction", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
async function materialize(children: boolean, mode: "read" | "write" | "root-gas" | "callee-gas" | "destroy") {
  const context = projectLaunchProductionContext(captured.chains["999"], 999, protection), controller = getAddress(`0x${"11".repeat(20)}`);
  const entries: ProjectEntrypoint[] = [{ source: "Project.sol", contract: "Token", role: "token" }, { source: "Project.sol", contract: "Hook", role: "hook" }, { source: "Project.sol", contract: "Liquidity", role: "liquidity" },
    ...(children ? [{ source: "Project.sol", contract: "Child", role: "auxiliary" as const }] : [])];
  const declared = createGeneralDeploymentBlueprint({ targets: [
    { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
    { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ target: "token" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 8192 },
    { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [], initializer: { function: "initialize", arguments: [] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
  ], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 0, tickSpacing: 60 },
    ...(children ? { constructorChildren: [{ id: "child", source: "Project.sol", contract: "Child", parent: "hook", creation: "create", nonce: "1", constructorArguments: [], value: "0" }] } : {}) }, entries, context, intent);
  // Constructor identity fixtures only, not v4 pool or production admission.
  const source = `pragma solidity 0.8.26;
contract Token { uint private value=42; function marker() external view returns(uint){return ${mode === "callee-gas" ? "gasleft()" : "value"};}
function bump() external {value++;} function destroy() external {selfdestruct(payable(msg.sender));} }
contract Child { uint public immutable marker;constructor(){marker=1;} }
contract Hook {uint public immutable observed;${children ? "Child public immutable child;" : ""}
constructor(Token token){${mode === "write" ? "token.bump();" : mode === "destroy" ? "token.destroy();" : ""}
observed=${mode === "root-gas" ? "gasleft()" : "token.marker()"};${children ? "child=new Child();" : ""}}}
contract Liquidity {function initialize() external payable {}}`;
  const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" }, sources: { "Project.sol": { content: source } }, entrypoints: entries }, intent, 999, context, declared);
  const compiled = await compileContractProject(project); expect(compiled.compiled).toBe(true);
  const selected = { controller, settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: 999, name: "Source calls", symbol: "CALL", initialBuy: "0.01" }) };
  const values = resolveGeneralDeploymentValues(project, compiled, selected), predictions: GeneralDeploymentPrediction[] = [];
  const factory = getAddress(context.graphProfile!.graphFactory as Address);
  const resolve = (value: unknown): unknown => Array.isArray(value) ? value.map(resolve) : value && typeof value === "object" && "target" in value ? predictions.find(target => target.targetId === value.target)!.predictedAddress : value;
  for (const target of values.targets) {
    const artifact = compiled.contracts.find(contract => contract.source === target.source && contract.contract === target.contract)!;
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: target.constructorArguments.map(resolve) });
    let salt = toHex(predictions.length + 1, { size: 32 }), address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
    if (target.role === "hook") {
      for (let index = 0; index < 262144; index++) {
        salt = toHex(index, { size: 32 }); address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
        if (Number(BigInt(address) & 16383n) === target.hookPermissions) break;
      }
      expect(Number(BigInt(address) & 16383n)).toBe(target.hookPermissions);
    }
    predictions.push({ targetId: target.id, predictedAddress: address, effectiveSalt: salt, resolvedConstructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` });
  }
  return materializeGeneralRuntime(project, compiled, selected, predictions);
}
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR).each([false, true])("Constructor children=%s gas forwarding", children => {
  it.each(["read", "write"] as const)("executes a normal known-source %s without treating forwarded gas as a runtime value", async mode => {
    const actual = await materialize(children, mode);
    expect(actual.status).toBe("materialized"); expect(actual.passes).toBe(2); expect(actual.launchReady).toBe(false);
    const words = actual.contracts.find(contract => contract.id === "hook")!.runtimeImmutables;
    expect(words.map(word => word.literal)).toContain(toHex(mode === "write" ? 43 : 42, { size: 32 }));
  }, 90_000);
  it.each(["root-gas", "callee-gas", "destroy"] as const)("still refuses %s rather than returning an apparently stable receipt", async mode => {
    await expect(materialize(children, mode)).rejects.toMatchObject({ code: "runtime-dependency", status: 422 });
  }, 90_000);
});
