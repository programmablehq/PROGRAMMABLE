import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAddress } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { checkedLaunchProductionContext, createLaunchProductionContext, type LaunchProductionContext } from "../lib/custom-ai/launch-production";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
const chains = [1, 4663, 8453, 999] as const;
type Chain = typeof chains[number];
const raw = (chain: Chain) => structuredClone(captured.chains[String(chain) as keyof typeof captured.chains]);
const context = (chain: Chain) => projectLaunchProductionContext(raw(chain), chain, protection);
function legacyV2(current: LaunchProductionContext) {
  const { id: ignored, protectionBindings: removed, ...body } = current; void ignored; void removed;
  return createLaunchProductionContext({ ...body, version: 2 });
}
const intent: LaunchIntent = { version: 1, id: "protection-dependency-arguments", revision: "a".repeat(64), unresolved: [], changes: [],
  requirements: [{ id: "source", text: "Keep the explicit constructor dependency configuration", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const entries = [{ source: "Project.sol", contract: "Token", role: "token" }, { source: "Project.sol", contract: "Hook", role: "hook" }, { source: "Project.sol", contract: "Liquidity", role: "liquidity" }] as const;
const deployment = (sequencer = false) => ({ targets: [
  { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
  { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: ["swap-router", "native-usd-feed", "swap-router-runtime-hash", "native-usd-feed-runtime-hash", ...(sequencer ? ["sequencer-uptime-feed"] : [])].map(binding => ({ binding })), initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 8192 },
  { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [], initializer: { function: "initialize", arguments: [] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 0, tickSpacing: 60 } });

describe("versioned source configuration for protected dependencies", () => {
  it.each(chains)("binds the distinct chain %s swap router and feed without asserting live observations", chain => {
    const current = context(chain), pins = current.protectionBindings!;
    expect(current.version).toBe(3); expect(pins.source).toBe("canonical-protection-kit-v1");
    expect(pins.poolManagerAddress.toLowerCase()).toBe(current.poolManager.address.toLowerCase());
    expect(pins.swapRouter.address.toLowerCase()).not.toBe(current.executor.address.toLowerCase());
    expect(Boolean(pins.sequencerUptimeFeed)).toBe(chain === 8453);
    expect(pins).not.toHaveProperty("decimals"); expect(pins).not.toHaveProperty("observedAt");
    expect(checkedLaunchProductionContext(JSON.parse(JSON.stringify(current)), chain)).toEqual(current);
    const previous = legacyV2(current), { id, ...body } = previous;
    expect(id).toBe(canonicalBrowserSha256V2("programmable.custom-ai-production-context.v2", body));
    expect(checkedLaunchProductionContext(JSON.parse(JSON.stringify(previous)), chain)).toEqual(previous);
    expect(previous).not.toHaveProperty("protectionBindings"); expect(current.id).not.toBe(previous.id);
    expect(() => createGeneralDeploymentBlueprint(deployment(), [...entries], previous, intent)).toThrow();
    if (chain !== 8453) expect(() => createGeneralDeploymentBlueprint(deployment(true), [...entries], current, intent)).toThrow();
  });
  it("rejects incomplete bindings, hidden state assertions and a different manager even after rehashing", () => {
    for (const change of [
      (value: LaunchProductionContext) => { value.protectionBindings!.poolManagerAddress = `0x${"11".repeat(20)}`; },
      (value: LaunchProductionContext) => { value.protectionBindings!.nativeUsdFeed.runtimeCodeHash = `0x${"00".repeat(32)}`; },
      (value: LaunchProductionContext) => { Object.assign(value.protectionBindings!, { decimals: 8 }); },
      (value: LaunchProductionContext) => { value.protectionBindings = null; },
    ]) {
      const current = context(999); change(current); const { id: ignored, ...body } = current; void ignored;
      expect(() => createLaunchProductionContext(body)).toThrow();
    }
  });
  it.each([8453, 999] as const)("rejects chain %s discovery when its UniversalRouter differs from the source kit", chain => {
    const value = raw(chain) as unknown as { policy: { universalRouter: { address: string; runtimeCodeHash: string } } };
    value.policy.universalRouter.runtimeCodeHash = `0x${"11".repeat(32)}`;
    expect(() => projectLaunchProductionContext(value, chain, protection)).toThrow();
  });
});
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual protected dependency constructor ABI binding", { timeout: 60_000 }, () => {
  it.each(chains)("resolves exact address and bytes32 inputs on chain %s with no RPC or invented feed state", async chain => {
    const current = context(chain), seq = chain === 8453;
    const declared = createGeneralDeploymentBlueprint(deployment(seq), [...entries], current, intent);
    // ABI argument fixtures only; these do not implement LP, trading or review.
    const source = `pragma solidity 0.8.26; contract Token {} contract Liquidity {function initialize() external payable {}}
contract Hook {address public immutable router;address public immutable feed;bytes32 public immutable routerHash;bytes32 public immutable feedHash;
${seq ? "address public immutable sequencer;" : ""} constructor(address r,address f,bytes32 rh,bytes32 fh${seq ? ",address s" : ""}){router=r;feed=f;routerHash=rh;feedHash=fh;${seq ? "sequencer=s;" : ""}}}`;
    const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" },
      sources: { "Project.sol": { content: source } }, entrypoints: entries }, intent, chain, current, declared);
    const compiled = await compileContractProject(project); expect(compiled.compiled).toBe(true);
    const controller = `0x${"11".repeat(20)}` as const, settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain, name: "Dependency fixture", symbol: "DEPS", initialBuy: "0.01" });
    const values = resolveGeneralDeploymentValues(project, compiled, { controller, settings }), pins = current.protectionBindings!;
    expect(values.targets[1].constructorArguments).toEqual([getAddress(pins.swapRouter.address), getAddress(pins.nativeUsdFeed.address), pins.swapRouter.runtimeCodeHash, pins.nativeUsdFeed.runtimeCodeHash, ...(seq ? [getAddress(pins.sequencerUptimeFeed!)] : [])]);
    expect(values.nativeValueWei).toBe("10000000000000000"); expect(values.launchReady).toBe(false);
  });
});
