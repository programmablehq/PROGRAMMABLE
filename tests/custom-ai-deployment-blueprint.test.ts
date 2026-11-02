import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAddress, zeroAddress } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createGeneralDeploymentBlueprint, checkedGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER, projectCompilerInput, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { BuilderChainId } from "../lib/custom-ai/execution-routing";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent: LaunchIntent = { version: 1, id: "deployment-declaration", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "surface", text: "Keep the declared source interfaces", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const entries: ProjectEntrypoint[] = [{ source: "Token.sol", contract: "Token", role: "token" }, { source: "Hook.sol", contract: "Hook", role: "hook" },
  { source: "Liquidity.sol", contract: "Liquidity", role: "liquidity" }];
const production = (chain: BuilderChainId) => projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain);
const raw = () => ({ targets: [
  { id: "token", source: "Token.sol", contract: "Token", constructorArguments: [{ input: "name" }, { input: "symbol" }, { input: "controller" }], initializer: null,
    deploymentValue: "0", initializerValue: "0", hookPermissions: null },
  { id: "hook", source: "Hook.sol", contract: "Hook", constructorArguments: [{ binding: "pool-manager" }], initializer: null,
    deploymentValue: "0", initializerValue: "0", hookPermissions: 128 },
  { id: "liquidity", source: "Liquidity.sol", contract: "Liquidity", constructorArguments: [],
    initializer: { function: "initialize", arguments: [{ target: "token" }, { input: "controller" }, { input: "funding" }] },
    deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 3000, tickSpacing: 60 } });
function declare(value: unknown = raw(), chain: BuilderChainId = 999) { return createGeneralDeploymentBlueprint(value, entries, production(chain), intent); }
const source = () => ({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" }, entrypoints: entries,
  // These contracts qualify ABI/parameter binding only. They deliberately do
  // not implement a live v4 hook or LP and cannot establish launch admission.
  sources: { "Token.sol": { content: 'pragma solidity 0.8.26; contract Token { string public name; string public symbol; address public controller; constructor(string memory n,string memory s,address c) { name=n;symbol=s;controller=c; } }' },
    "Hook.sol": { content: "pragma solidity 0.8.26; contract Hook { address public manager; constructor(address m) { manager=m; } }" },
    "Liquidity.sol": { content: "pragma solidity 0.8.26; contract Liquidity { address public token; address public controller; uint public amount; function initialize(address t,address c,uint256 a) external payable { token=t;controller=c;amount=a; } }" } } });
const project = (chain: BuilderChainId = 999) => createContractProject(source(), intent, chain, production(chain), declare(raw(), chain));
const selected = (chain: BuilderChainId = 999) => ({ controller: `0x${"11".repeat(20)}` as `0x${string}`,
  settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain, name: "Example", symbol: "EX", initialBuy: "0.01" }) });

describe("a production deployment declared before source", () => {
  it.each([1, 4663, 8453, 999] as const)("binds the complete graph and source to chain %i without fixture conversion", chain => {
    const blueprint = declare(raw(), chain), saved = project(chain);
    expect(blueprint.productionId).toBe(production(chain).id); expect(saved.deployment?.id).toBe(blueprint.id);
    expect(checkedGeneralDeploymentBlueprint(JSON.parse(JSON.stringify(blueprint)), entries, production(chain), intent)).toEqual(blueprint);
    expect(() => projectCompilerInput(saved)).not.toThrow();
    const altered = raw(); altered.pool.fee = 500;
    expect(declare(altered, chain).id).not.toBe(blueprint.id);
  });
  it("rejects fixtures, invented recipients, unbound references and unknown graph data", () => {
    const cases: unknown[] = [];
    for (const reference of [{ fixture: "v4-router" }, { account: "creator" }, { pool: true }, { input: "password" },
      { binding: "test-router" }, { target: "missing" }, { target: "token", arbitrary: true }, `0x${"22".repeat(20)}`, 1]) {
      const value = raw(); (value.targets[1].constructorArguments as unknown[]) = [reference]; cases.push(value);
    }
    cases.push({ ...raw(), command: "run arbitrary code" });
    const duplicate = raw(); duplicate.targets[1].id = "token"; cases.push(duplicate);
    const foreign = raw(); foreign.targets[1].source = "Other.sol"; cases.push(foreign);
    const cycle = raw(); (cycle.targets[0].constructorArguments as unknown[]) = [{ target: "liquidity" }]; cases.push(cycle);
    for (const value of cases) expect(() => declare(value)).toThrow();
    const rh = raw(); (rh.targets[1].constructorArguments as unknown[]) = [{ binding: "graph-factory" }];
    expect(() => declare(rh, 4663)).toThrow();
  });
  it("allows an explicitly requested external address without turning it into a live-dependency assertion", () => {
    const value = raw(), address = `0x${"22".repeat(20)}`;
    (value.targets[1].constructorArguments as unknown[]) = [address];
    const requested = { ...intent, requirements: [{ ...intent.requirements[0], text: `Use manager ${address}` }] };
    expect(createGeneralDeploymentBlueprint(value, entries, production(999), requested).targets[1].constructorArguments).toEqual([address]);
  });
  it("accepts zero sentinels and pinned protocol recipients without admitting invented wallets",()=>{
    const value=raw(),recipient=production(999).tradeFee.recipient;
    (value.targets[1].constructorArguments as unknown[])=[zeroAddress,recipient];
    expect(declare(value).targets[1].constructorArguments).toEqual([zeroAddress,recipient]);
    (value.targets[1].constructorArguments as unknown[])=[`0x${"22".repeat(20)}`];
    expect(()=>declare(value)).toThrow();
  });
  it("never multiplies native funding and enforces callback permission dependencies", () => {
    const twice = raw(); twice.targets[0].deploymentValue = { input: "funding" } as never;
    expect(() => declare(twice)).toThrow();
    const dangling = raw(); dangling.targets[2].initializer = null;
    expect(() => declare(dangling)).toThrow();
    for (const mask of [-1, 16384, 8, 4, 2, 1]) {
      const value = raw(); value.targets[1].hookPermissions = mask;
      expect(() => declare(value)).toThrow();
    }
    const value = raw(); value.targets[1].hookPermissions = 128 | 8;
    expect(declare(value).targets[1].hookPermissions).toBe(136);
  });
  it("binds explicit selected fees and liquidity without inventing defaults for older declarations", () => {
    const value = { ...raw(), fees: { buyPpm: 100000, sellPpm: 3000 }, liquidityModel: "launch-seeded-concentrated-liquidity" };
    const complete = declare(value);
    expect(complete.fees).toEqual(value.fees); expect(complete.liquidityModel).toBe(value.liquidityModel);
    expect(complete.id).not.toBe(declare().id); expect(declare().fees).toBeUndefined();
    expect(checkedGeneralDeploymentBlueprint(complete, entries, production(999), intent)).toEqual(complete);
    const changed = { ...value, fees: { ...value.fees, sellPpm: 0 } };
    expect(declare(changed).id).not.toBe(complete.id);
  });
  it("rejects incomplete, out-of-profile or unsupported fee/liquidity declarations", () => {
    for (const patch of [{ fees: { buyPpm: 3000, sellPpm: 3000 } }, { liquidityModel: "launch-seeded-concentrated-liquidity" },
      { fees: { buyPpm: -1, sellPpm: 3000 }, liquidityModel: "launch-seeded-concentrated-liquidity" },
      { fees: { buyPpm: 100001, sellPpm: 3000 }, liquidityModel: "launch-seeded-concentrated-liquidity" },
      { fees: { buyPpm: 3000.5, sellPpm: 3000 }, liquidityModel: "launch-seeded-concentrated-liquidity" },
      { fees: { buyPpm: 3000, sellPpm: 3000 }, liquidityModel: "made-up" },
      { fees: { buyPpm: 3000, sellPpm: 3000 }, liquidityModel: "hook-inventory-custom-accounting" }])
      expect(() => declare({ ...raw(), ...patch })).toThrow();
    const value = { ...raw(), fees: { buyPpm: 3000, sellPpm: 3000 }, liquidityModel: "hook-inventory-custom-accounting" };
    value.targets[1].hookPermissions = 128 | 8;
    expect(declare(value).liquidityModel).toBe("hook-inventory-custom-accounting");
  });
  it("keeps the deployment recipe inside the original oracle/source hash and rejects later replacement", () => {
    const p = production(999), recipe = declare();
    const contracts = entries.map((entry, index) => ({ ...entry, id: ["token", "hook", "liquidity"][index], arguments: [], functions: [], allowReceive: false, allowFallback: false, surfaceRequirements: ["surface"] }));
    contracts[1].functions = ["function manager() view returns (address)"] as never;
    contracts[2].functions = ["function initialize(address,address,uint256) payable"] as never;
    const blueprint = createGeneralCheckBlueprint({ contracts, allowedCalls: [], deployment: raw(), steps: [{ id: "manager", contract: "hook", signature: "manager()", arguments: [],
      from: "creator", afterSeconds: 0, value: "0", read: true, requirementIds: [], expect: { status: "success", returns: [p.poolManager.address] } }] }, intent, 999, "cancun", p);
    expect(blueprint.deployment?.id).toBe(recipe.id); expect(() => bindGeneralCheckBlueprint(blueprint, project())).not.toThrow();
    expect(() => bindGeneralCheckBlueprint(blueprint, createContractProject(source(), intent, 999, p))).toThrow();
    expect(() => projectCompilerInput({ ...project(), deployment: { ...recipe, pool: { ...recipe.pool, fee: 1 } } })).toThrow();
    expect(() => createContractProject(source(), intent, 1, production(1), recipe)).toThrow();
  });
});

let compiled: CompiledProject;
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual compiler ABI with owned deployment values", { timeout: 60_000 }, () => {
  beforeAll(async () => { compiled = await compileContractProject(project()); expect(compiled.compiled).toBe(true); });
  it("resolves actual chain roots, controller and form inputs while retaining symbolic target references", () => {
    const result = resolveGeneralDeploymentValues(project(), compiled, selected());
    expect(result.targets[0].constructorArguments).toEqual(["Example", "EX", getAddress(selected().controller)]);
    expect(result.targets[1].constructorArguments).toEqual([getAddress(production(999).poolManager.address)]);
    expect(result.targets[2].initializer?.arguments).toEqual([{ target: "token" }, getAddress(selected().controller), "10000000000000000"]);
    expect(result.nativeValueWei).toBe("10000000000000000"); expect(result.quoteCurrency).toBe(zeroAddress); expect(result.launchReady).toBe(false);
    expect(result).not.toHaveProperty("transaction"); expect(result).not.toHaveProperty("permit");
  });
  it("rejects stale source/artifacts, another network and sub-wei rounding", () => {
    for (const change of [{ settings: { ...selected().settings, chainId: 1 as const } }, { controller: zeroAddress },
      { settings: { ...selected().settings, initialBuy: "0.1234567890123456789" } }, { nativeFundingWei: "1" }])
      expect(() => resolveGeneralDeploymentValues(project(), compiled, { ...selected(), ...change })).toThrow();
    expect(() => resolveGeneralDeploymentValues(project(), { ...compiled, artifactHash: `sha256:${"b".repeat(64)}` }, selected())).toThrow();
    expect(() => resolveGeneralDeploymentValues({ ...project(), hash: `sha256:${"b".repeat(64)}` }, compiled, selected())).toThrow();
  });
  it("requires explicit native funding for an ERC20 quote instead of spending that token amount as HYPE", () => {
    const quote = `0x${"33".repeat(20)}`, input = { ...selected(), settings: { ...selected().settings, pairToken: quote, initialBuy: "100" } };
    expect(() => resolveGeneralDeploymentValues(project(), compiled, input)).toThrow();
    const result = resolveGeneralDeploymentValues(project(), compiled, { ...input, nativeFundingWei: "20000000000" });
    expect(result.quoteCurrency).toBe(getAddress(quote)); expect(result.nativeValueWei).toBe("20000000000");
    expect(result.targets[2].initializer?.arguments.at(-1)).toBe("20000000000");
  });
  it("uses the actual ABI to reject missing constructors, ambiguous initializers and nonpayable funding", () => {
    const withAbi = (change: (value: CompiledProject) => void) => {
      const candidate = structuredClone(compiled); change(candidate); const { artifactHash: ignored, ...body } = candidate; void ignored;
      return { ...body, artifactHash: canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) };
    };
    for (const candidate of [
      withAbi(value => { value.contracts.find(contract => contract.role === "token")!.abi = []; }),
      withAbi(value => { const abi = value.contracts.find(contract => contract.role === "liquidity")!.abi; value.contracts.find(contract => contract.role === "liquidity")!.abi = [...abi, ...abi.filter(item => item.type === "function" && item.name === "initialize")]; }),
      withAbi(value => { value.contracts.find(contract => contract.role === "liquidity")!.abi = value.contracts.find(contract => contract.role === "liquidity")!.abi.map(item => item.type === "function" && item.name === "initialize" ? { ...item, stateMutability: "nonpayable" } : item); }),
    ]) expect(() => resolveGeneralDeploymentValues(project(), candidate, selected())).toThrow();
  });
});
