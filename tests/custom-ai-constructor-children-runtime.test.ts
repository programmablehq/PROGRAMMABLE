import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, toHex, type Address } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ContractProject, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "../lib/custom-ai/runtime-materialization.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { ROBINHOOD_PLAN_DEPLOYER } from "../lib/custom-ai/plan-deployer";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
type Chain = 1 | 4663 | 8453 | 999;
const controller = getAddress(`0x${"11".repeat(20)}`), intent: LaunchIntent = { version: 1, id: "constructor-child-runtime", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "children", text: "The hook creates both separately owned vaults and its module in the declared order", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const entries: ProjectEntrypoint[] = [{ source: "Project.sol", contract: "Token", role: "token" }, { source: "Project.sol", contract: "Hook", role: "hook" },
  { source: "Project.sol", contract: "Liquidity", role: "liquidity" }, { source: "Project.sol", contract: "Vault", role: "auxiliary" }, { source: "Project.sol", contract: "Module", role: "auxiliary" }];
function fixture(chain: Chain, variant = "valid") {
  const context = projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain);
  const raw = { targets: [
    { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
    { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ input: "controller" }], initializer: null, deploymentValue: variant === "value" ? { input: "funding" } : "0", initializerValue: "0", hookPermissions: 128 },
    { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [], initializer: { function: "initialize", arguments: [{ target: "token" }, { target: "hook" }] }, deploymentValue: "0", initializerValue: variant === "value" ? "0" : { input: "funding" }, hookPermissions: null },
  ], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 3000, tickSpacing: 60 }, constructorChildren: [
    { id: "fee-vault", source: "Project.sol", contract: "Vault", parent: "hook", creation: "create", nonce: "1", constructorArguments: [{ target: "hook" }, variant === "arguments" ? { target: "token" } : { input: "controller" }], value: variant === "value" ? "1" : "0" },
    { id: "module", source: "Project.sol", contract: "Module", parent: "hook", creation: "create", nonce: "2", constructorArguments: [{ target: "fee-vault" }], value: "0" },
    { id: "opening-vault", source: "Project.sol", contract: "Vault", parent: "hook", creation: "create", nonce: "3", constructorArguments: [{ target: "hook" }, { input: "controller" }], value: "0" },
  ] };
  if (variant === "undeclared") raw.constructorChildren.pop();
  const source = `pragma solidity 0.8.26;
// Constructor identity fixtures only; these do not implement v4 trading or LP.
contract Token { uint public marker = 1; }
contract Vault { address public immutable parent; address public immutable owner; ${variant === "time" ? "uint public immutable at;" : ""}
 constructor(address p,address o) payable { parent=p;owner=o;${variant === "time" ? "at=block.timestamp;" : ""} } }
contract Module { address public immutable vault; constructor(address v){vault=v;} }
contract Hook { Vault public immutable vault; Module public immutable module; Vault public immutable opening;
 constructor(address owner) payable { vault=new Vault(address(this),owner);module=new Module(address(vault));${variant === "missing" ? "" : "opening=new Vault(address(this),owner);"} } }
contract Liquidity { function initialize(address,address) external payable {} }
`;
  const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" },
    sources: { "Project.sol": { content: source } }, entrypoints: entries }, intent, chain, context, createGeneralDeploymentBlueprint(raw, entries, context, intent));
  const selected = { controller, settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain, name: "Declared children", symbol: "CHILD", initialBuy: "0.01" }) };
  const factory = chain === 4663 ? ROBINHOOD_PLAN_DEPLOYER.address : context.graphProfile?.graphFactory;
  if (typeof factory !== "string") throw Error("The selected fixture has no exact deployment factory");
  return { project, selected, factory: getAddress(factory),
    options: { ...selected, ...(chain === 4663 ? { planDeployer: ROBINHOOD_PLAN_DEPLOYER } : {}) } };
}
function predictions(project: ContractProject, compilation: CompiledProject, selected: ReturnType<typeof fixture>["selected"], factory: Address) {
  const values = resolveGeneralDeploymentValues(project, compilation, selected), result: GeneralDeploymentPrediction[] = [];
  const resolve = (value: unknown): unknown => Array.isArray(value) ? value.map(resolve) : value && typeof value === "object" && "target" in value
    ? result.find(target => target.targetId === value.target)?.predictedAddress : value;
  for (const target of values.targets) {
    const artifact = compilation.contracts.find(contract => contract.source === target.source && contract.contract === target.contract)!;
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: target.constructorArguments.map(resolve) });
    let salt = toHex(result.length + 1, { size: 32 }), address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
    if (target.role === "hook") {
      let found = false;
      for (let nonce = 0; nonce < 262144; nonce++) {
        salt = toHex(nonce, { size: 32 }); address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
        if (Number(BigInt(address) & 16383n) === target.hookPermissions) { found = true; break; }
      }
      if (!found) throw Error("Bounded hook salt search exhausted");
    }
    result.push({ targetId: target.id, predictedAddress: address, effectiveSalt: salt, resolvedConstructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` });
  }
  return result;
}
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("exact constructor child runtime observations", { timeout: 90_000 }, () => {
  it.each([1, 4663, 8453, 999] as const)("observes all six chain %s instances at exact addresses in both isolated executions", async chain => {
    const f = fixture(chain), compiled = await compileContractProject(f.project); expect(compiled.compiled).toBe(true);
    const predicted = predictions(f.project, compiled, f.selected, f.factory), result = await materializeGeneralRuntime(f.project, compiled, f.options, predicted);
    expect(result).toMatchObject({ version: 2, scope: "isolated-constructor-runtime-v2", status: "materialized", passes: 2, launchReady: false });
    expect(result.contracts).toHaveLength(3); expect(result.children).toHaveLength(3);
    const parent = predicted.find(target => target.targetId === "hook")!.predictedAddress;
    for (const [index, child] of result.children!.entries()) {
      expect(child.address).toBe(getContractAddress({ from: parent, nonce: BigInt(index + 1) }));
      expect(child.runtimeCodeHash).toBe(keccak256(child.runtimeCode));
    }
    const parentWords = result.contracts.find(contract => contract.id === "hook")!.runtimeImmutables.map(word => word.literal.toLowerCase());
    for (const child of result.children!) expect(parentWords).toContain(toHex(BigInt(child.address), { size: 32 }));
    expect(result).not.toHaveProperty("permit");
  });
  it.each(["undeclared", "arguments", "missing", "time", "value"])("refuses %s constructor behavior instead of echoing the expected child receipts", async variant => {
    const f = fixture(999, variant), compiled = await compileContractProject(f.project); expect(compiled.compiled).toBe(true);
    await expect(materializeGeneralRuntime(f.project, compiled, f.options, predictions(f.project, compiled, f.selected, f.factory))).rejects.toMatchObject({ code: "runtime-dependency", status: 422 });
  });
});
