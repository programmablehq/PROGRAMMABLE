import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeDeployData, getCreate2Address, keccak256, toHex, type Address, type Hex } from "viem";
import ethKit from "../packages/launch/contracts/launch-protection-v1/standard-json.json";
import baseKit from "../packages/launch/contracts/base-launch-protection-v1/standard-json.json";
import hypeKit from "../packages/launch/contracts/hyperevm-launch-protection-v1/standard-json.json";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { createContractProject, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { createProjectCompiler } from "../lib/custom-ai/compiler-profile";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "../lib/custom-ai/runtime-materialization.server";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { replayNativeFeedConstructorRead } from "../lib/custom-ai/dependency-witness.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";
import { ROBINHOOD_PLAN_DEPLOYER } from "../lib/custom-ai/plan-deployer";

// These explicit local dependencies prove original source execution, not live
// provider state, independent financial behavior or permission to launch.
const treasury = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
const intent: LaunchIntent = { version: 1, id: "original-protection-constructor", revision: "a".repeat(64), unresolved: [], changes: [],
  requirements: [{ id: "protection", text: `Keep the complete original protection kit, including its opening tax treasury ${treasury}.`,
    kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const entry = (source: string, contract: string, role: ProjectEntrypoint["role"]) => ({ source, contract, role });
const entriesFor = (chain: 1 | 4663 | 8453 | 999) => {
  const path = chain === 999 ? "src/hyperevm-custom-v1" : chain === 8453 ? "src/base-custom-v1" : "src/launch-protection";
  const prefix = chain === 999 ? "HyperEvm" : chain === 8453 ? "Base" : "";
  return [entry(`${path}/${prefix}ProtectedNativeInitializerV1.sol`, `${prefix}ProtectedNativeInitializerV1`, "liquidity"),
  entry("src/launch-protection/ProtectedLaunchTokenV1.sol", "ProtectedLaunchTokenV1", "token"),
  entry(`${path}/${prefix}ProtectedNative30HookV1.sol`, `${prefix}ProtectedNative30HookV1`, "hook"),
  entry("src/ethereum-native30-v3/EthereumNativeFeeVaultV3.sol", "EthereumNativeFeeVaultV3", "auxiliary"),
  entry(`${path}/${prefix}LaunchProtectionModuleV1.sol`, `${prefix}LaunchProtectionModuleV1`, "auxiliary")];
};

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("complete original protection construction", () => {
  it.each([1, 4663, 8453, 999] as const)("executes the original initializer, token, hook and all three constructor children on chain %s", async chain => {
    const entries = entriesFor(chain), kit = chain === 999 ? hypeKit : chain === 8453 ? baseKit : ethKit;
    const decimals = chain === 999 ? 18 : 8;
    const BASIC = `0x60${decimals.toString(16).padStart(2, "0")}60005260206000f3` as Hex;
    const input = projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain, protection);
    input.poolManager.runtimeCodeHash = keccak256(BASIC);
    input.protectionBindings!.swapRouter.runtimeCodeHash = keccak256(BASIC);
    input.protectionBindings!.nativeUsdFeed.runtimeCodeHash = keccak256(BASIC);
    const { id: ignored, ...productionBody } = input; void ignored;
    const production = createLaunchProductionContext(productionBody);
    const target = (id: string, index: number, constructorArguments: unknown[], extra: Record<string, unknown> = {}) => ({ id,
      source: entries[index].source, contract: entries[index].contract, constructorArguments, initializer: null,
      deploymentValue: "0", initializerValue: "0", hookPermissions: null, ...extra });
    const child = (id: string, index: number, nonce: string, constructorArguments: unknown[]) => ({ id,
      source: entries[index].source, contract: entries[index].contract, parent: "hook", creation: "create", nonce, constructorArguments, value: "0" });
    const zero = { input: "quote" }, controller = { input: "controller" }, manager = { binding: "pool-manager" };
    const router = { binding: "swap-router" }, routerHash = { binding: "swap-router-runtime-hash" }, exemptions = Array.from({ length: 6 }, () => zero);
    const recipe = createGeneralDeploymentBlueprint({ targets: [
      target("initializer", 0, [manager, { binding: chain === 4663 ? "launch-executor" : "graph-factory" }, { binding: "native-usd-feed" }, { binding: "native-usd-feed-runtime-hash" }],
        { initializer: { function: "initialize", arguments: [{ target: "hook" }, { target: "token" }, "0", controller, "1"] }, initializerValue: { input: "funding" } }),
      target("token", 1, [{ input: "name" }, { input: "symbol" }, "1000000000000000000000000000", { target: "initializer" }, manager]),
      target("hook", 2, [manager, [{ target: "token" }, "0", "60", (1n << 96n).toString(), { target: "initializer" }, controller, "70", "70", zero, "0"],
        controller, router, routerHash, exemptions], { hookPermissions: 0x20cc }),
    ], constructorChildren: [child("fee-vault", 3, "1", [manager, controller]),
      child("protection", 4, "2", [{ target: "hook" }, { target: "token" }, controller, router, routerHash, "70", exemptions]),
      child("opening-tax-vault", 3, "3", [manager, treasury])],
    pool: { token: "token", hook: "hook", initializer: "initializer", platformFeeBinding: "hook", fee: 0, tickSpacing: 60 } }, entries, production, intent);
    const project = createContractProject({ compiler: createProjectCompiler("viair-200-v1", "cancun"), sources: kit.sources, entrypoints: entries }, intent, chain, production, recipe);
    const compilation = await compileContractProject(project);
    expect(compilation.diagnostics.filter(value => value.severity === "error")).toEqual([]);
    expect(compilation.compiled).toBe(true);
    const selected = { controller: "0x1111111111111111111111111111111111111111" as Address,
      settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: chain, name: "Original protection", symbol: "ORIG", initialBuy: "0.01" }),
      ...(chain === 4663 ? { planDeployer: ROBINHOOD_PLAN_DEPLOYER } : {}) };
    const values = resolveGeneralDeploymentValues(project, compilation, selected), predictions: GeneralDeploymentPrediction[] = [];
    const factory = chain === 4663 ? ROBINHOOD_PLAN_DEPLOYER.address : production.graphProfile!.graphFactory as Address;
    const addresses = new Map<string, Address>();
    const resolve = (value: unknown): unknown => Array.isArray(value) ? value.map(resolve)
      : value && typeof value === "object" && "target" in value ? addresses.get(String(value.target)) : value;
    for (const definition of values.targets) {
      const artifact = compilation.contracts.find(contract => contract.source === definition.source && contract.contract === definition.contract)!;
      const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: definition.constructorArguments.map(resolve) });
      let salt = toHex(predictions.length + 1, { size: 32 }), address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
      if (definition.role === "hook") for (let index = 0; index < 262144; index++) {
        salt = toHex(index, { size: 32 }); address = getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
        if (Number(BigInt(address) & 16383n) === definition.hookPermissions) break;
      }
      addresses.set(definition.id, address);
      predictions.push({ targetId: definition.id, predictedAddress: address, effectiveSalt: salt, resolvedConstructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` });
    }
    const now = Date.now(), pins = production.protectionBindings!, stamp = String(Math.floor(now / 1000));
    const body: Omit<LaunchDependencyObservation, "id"> = { version: 1, productionId: production.id, chainId: chain, authority: "two-provider-observation", launchReady: false,
      block: { number: "100", hash: `0x${"12".repeat(32)}`, timestamp: stamp }, observedAt: now, expiresAt: now + 10000,
      poolManager: { ...production.poolManager, runtimeCode: BASIC }, swapRouter: { ...pins.swapRouter, runtimeCode: BASIC },
      nativeUsdFeed: { ...pins.nativeUsdFeed, runtimeCode: BASIC, decimals, roundId: "1", answer: (10n ** BigInt(decimals)).toString(), updatedAt: stamp, answeredInRound: "1" },
      sequencer: chain === 8453 ? { address: pins.sequencerUptimeFeed!, runtimeCode: BASIC, runtimeCodeHash: keccak256(BASIC), startedAt: String(Number(stamp) - 3601), graceSeconds: 3600 } : null,
      rpcReads: chain === 8453 ? [11, 11] : [9, 9] };
    const observation = { ...body, id: canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", body) };
    const rpc = () => async (method: string) => method === "debug_traceCall" ? { [pins.nativeUsdFeed.address]: { code: BASIC } }
      : { number: "0x64", hash: body.block.hash, timestamp: toHex(BigInt(stamp)) };
    const read = await replayNativeFeedConstructorRead(observation, addresses.get("initializer")!, { rpcs: [rpc(), rpc()], now: Date.now });
    const result = await materializeGeneralRuntime(project, compilation, { ...selected, observedDependencies: { observation, read } }, predictions);
    expect(result).toMatchObject({ version: 3, status: "materialized", passes: 2, launchReady: false });
    expect(result.contracts.map(contract => contract.id)).toEqual(["initializer", "token", "hook"]);
    expect(result.children?.map(contract => contract.id)).toEqual(["fee-vault", "protection", "opening-tax-vault"]);
    expect(new Set(result.children?.map(contract => contract.address)).size).toBe(3);
  }, 90000);
});
