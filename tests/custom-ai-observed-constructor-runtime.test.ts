import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeAbiParameters, encodeDeployData, getAddress, getCreate2Address, keccak256, toHex, type Address, type Hex } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { createGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ProjectEntrypoint } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { resolveGeneralDeploymentValues } from "../lib/custom-ai/deployment-values.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "../lib/custom-ai/runtime-materialization.server";
import { applyCoinSetupPatch, EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { createConstructorDependencyResolver, replayNativeFeedConstructorRead } from "../lib/custom-ai/dependency-witness.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";
import type { ObservedConstructorDependencies } from "../lib/custom-ai/dependency-witness";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
const intent: LaunchIntent = { version: 1, id: "observed-constructor-input", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "observed", text: "Use the source-bound router code and observed feed precision in the constructor", kind: "constraint", open: null, origin: { kind: "legacy" } }] };
const IMPLEMENTATION = `0x${"bb".repeat(20)}` as const;
const BASIC = "0x600760005260206000f3" as Hex, STORAGE = "0x60015460005260206000f3" as Hex;
const PROXY = `0x363d3d373d3d3d363d73${IMPLEMENTATION.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex;
async function fixture() {
  const context = projectLaunchProductionContext(captured.chains["999"], 999, protection);
  context.poolManager.runtimeCodeHash = keccak256(BASIC);
  context.protectionBindings!.swapRouter.runtimeCodeHash = keccak256(BASIC);
  context.protectionBindings!.nativeUsdFeed.runtimeCodeHash = keccak256(PROXY);
  const { id: ignored, ...body } = context; void ignored;
  const production = createLaunchProductionContext(body), controller = getAddress(`0x${"11".repeat(20)}`);
  const entries: ProjectEntrypoint[] = [{ source: "Project.sol", contract: "Token", role: "token" },
    { source: "Project.sol", contract: "Hook", role: "hook" }, { source: "Project.sol", contract: "Liquidity", role: "liquidity" },
    { source: "Project.sol", contract: "Child", role: "auxiliary" }];
  const declared = createGeneralDeploymentBlueprint({ targets: [
    { id: "token", source: "Project.sol", contract: "Token", constructorArguments: [{ binding: "pool-manager" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: null },
    { id: "hook", source: "Project.sol", contract: "Hook", constructorArguments: [{ binding: "swap-router" }, { binding: "swap-router-runtime-hash" }], initializer: null, deploymentValue: "0", initializerValue: "0", hookPermissions: 8192 },
    { id: "liquidity", source: "Project.sol", contract: "Liquidity", constructorArguments: [{ binding: "native-usd-feed" }], initializer: { function: "initialize", arguments: [] }, deploymentValue: "0", initializerValue: { input: "funding" }, hookPermissions: null },
  ], pool: { token: "token", hook: "hook", initializer: "liquidity", platformFeeBinding: "hook", fee: 0, tickSpacing: 60 },
  constructorChildren: [{ id: "child", source: "Project.sol", contract: "Child", parent: "hook", creation: "create", nonce: "1", constructorArguments: [], value: "0" }] }, entries, production, intent);
  // Constructor-context fixtures only, not launchable financial contracts.
  const source = `pragma solidity 0.8.26;
interface Feed {function decimals() external view returns(uint8);}
contract Token {constructor(address manager){require(manager.code.length>0);}}
contract Child {uint public immutable marker;constructor(){marker=1;}}
contract Hook {Child public immutable child;constructor(address router,bytes32 codeHash){require(router.codehash==codeHash);child=new Child();}}
contract Liquidity {uint8 public immutable precision;constructor(Feed feed){precision=feed.decimals();}function initialize() external payable{}}`;
  const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "cancun" },
    sources: { "Project.sol": { content: source } }, entrypoints: entries }, intent, 999, production, declared);
  const compilation = await compileContractProject(project); expect(compilation.compiled).toBe(true);
  const selected = { controller, settings: applyCoinSetupPatch(EMPTY_COIN_SETUP, { chainId: 999, name: "Observed inputs", symbol: "OBS", initialBuy: "0.01" }) };
  const values = resolveGeneralDeploymentValues(project, compilation, selected), predictions: GeneralDeploymentPrediction[] = [];
  for (const target of values.targets) {
    const artifact = compilation.contracts.find(contract => contract.source === target.source && contract.contract === target.contract)!;
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.creationBytecode, args: target.constructorArguments });
    let salt = toHex(predictions.length + 1, { size: 32 }), address = getCreate2Address({ from: production.graphProfile!.graphFactory as Address, salt, bytecodeHash: keccak256(initCode) });
    if (target.role === "hook") for (let index = 0; index < 262144; index++) {
      salt = toHex(index, { size: 32 }); address = getCreate2Address({ from: production.graphProfile!.graphFactory as Address, salt, bytecodeHash: keccak256(initCode) });
      if (Number(BigInt(address) & 16383n) === target.hookPermissions) break;
    }
    predictions.push({ targetId: target.id, predictedAddress: address, effectiveSalt: salt, resolvedConstructorArguments: `0x${initCode.slice(artifact.creationBytecode.length)}` });
  }
  const now = Date.now(), pins = production.protectionBindings!;
  const observationBody: Omit<LaunchDependencyObservation, "id"> = { version: 1, productionId: production.id, chainId: 999,
    authority: "two-provider-observation", launchReady: false, block: { number: "100", hash: `0x${"12".repeat(32)}`, timestamp: String(Math.floor(now / 1000)) },
    observedAt: now, expiresAt: now + 10_000, poolManager: { ...production.poolManager, runtimeCode: BASIC }, swapRouter: { ...pins.swapRouter, runtimeCode: BASIC },
    nativeUsdFeed: { ...pins.nativeUsdFeed, runtimeCode: PROXY, decimals: 7, roundId: "1", answer: "10000000", updatedAt: String(Math.floor(now / 1000)), answeredInRound: "1" }, sequencer: null, rpcReads: [9, 9] };
  const observation = { ...observationBody, id: canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", observationBody) };
  const raw = { [pins.nativeUsdFeed.address]: { code: PROXY, storage: { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }) } }, [IMPLEMENTATION]: { code: STORAGE } };
  const rpc = () => async (method: string) => method === "debug_traceCall" ? raw
    : { number: "0x64", hash: observation.block.hash, timestamp: toHex(BigInt(observation.block.timestamp)) };
  const read = await replayNativeFeedConstructorRead(observation, predictions.find(p => p.targetId === "liquidity")!.predictedAddress, { rpcs: [rpc(), rpc()], now: Date.now });
  return { project, compilation, selected, predictions, dependencies: { observation, read } satisfies ObservedConstructorDependencies };
}
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("source-bound observed constructor dependencies", () => {
  let input: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { input = await fixture(); }, 90_000);
  it("executes the actual supplied proxy and binds its precision into the initializer runtime", async () => {
    const result = await materializeGeneralRuntime(input.project, input.compilation, { ...input.selected, observedDependencies: input.dependencies }, input.predictions);
    expect(result).toMatchObject({ version: 3, scope: "observed-constructor-runtime-v3", status: "materialized", passes: 2, launchReady: false });
    expect(result.contracts.find(c => c.id === "liquidity")?.runtimeImmutables.map(word => word.literal)).toContain(toHex(7, { size: 32 }));
    expect(result.dependencyContext?.read.id).toBe(input.dependencies.read.id);
  });
  it("still refuses the source when no real dependency context is supplied", async () => {
    await expect(materializeGeneralRuntime(input.project, input.compilation, input.selected, input.predictions)).rejects.toMatchObject({ code: "runtime-dependency" });
  });
  it("refuses a context rebound to a different initializer even after hash recomputation", async () => {
    const dependencies = structuredClone(input.dependencies);
    dependencies.read.witness.call.from = `0x${"13".repeat(20)}`;
    const { id: ignored, ...witness } = dependencies.read.witness; void ignored;
    dependencies.read.witness.id = canonicalBrowserSha256V2("programmable.custom-ai-native-feed-witness.v1", witness);
    const { id: ignoredRead, ...read } = dependencies.read; void ignoredRead;
    dependencies.read.id = canonicalBrowserSha256V2("programmable.custom-ai-native-feed-constructor-read.v1", read);
    await expect(materializeGeneralRuntime(input.project, input.compilation, { ...input.selected, observedDependencies: dependencies }, input.predictions)).rejects.toMatchObject({ code: "runtime-context" });
  });
  it("requires the actual observed storage even if a forged replay claims success", async () => {
    const dependencies = structuredClone(input.dependencies);
    dependencies.read.witness.accounts.find(account => account.address === dependencies.read.witness.call.to)!.storage = [];
    const { id: ignored, ...witness } = dependencies.read.witness; void ignored;
    dependencies.read.witness.id = canonicalBrowserSha256V2("programmable.custom-ai-native-feed-witness.v1", witness);
    const { id: ignoredRead, ...read } = dependencies.read; void ignoredRead;
    dependencies.read.id = canonicalBrowserSha256V2("programmable.custom-ai-native-feed-constructor-read.v1", read);
    await expect(materializeGeneralRuntime(input.project, input.compilation, { ...input.selected, observedDependencies: dependencies }, input.predictions)).rejects.toMatchObject({ code: "runtime-dependency" });
  });
  it("keeps one preparation on its selected chain through observation, replay and constructor execution", async () => {
    const production = structuredClone(input.project.production!), now = Date.now(), stamp = BigInt(Math.floor(now / 1000) - 2);
    const feed = production.protectionBindings!.nativeUsdFeed.address;
    const raw = { [feed]: { code: PROXY, storage: { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }) } }, [IMPLEMENTATION]: { code: STORAGE } };
    let calls = 0;
    const rpc = () => async (method: string, params: readonly unknown[]) => {
      calls++;
      if (method === "eth_chainId") return "0x3e7";
      if (method === "eth_getBlockByNumber") return { number: params[0] === "latest" ? "0x64" : params[0], timestamp: toHex(stamp), hash: `0x${"12".repeat(32)}` };
      if (method === "eth_getCode") return params[0] === feed ? PROXY : BASIC;
      if (method === "debug_traceCall") return raw;
      if (method === "eth_call" && (params[0] as { data: string }).data === "0x313ce567") return toHex(7, { size: 32 });
      if (method === "eth_call") return encodeAbiParameters([{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }], [1n, 1n, stamp - 1n, stamp - 1n, 1n]);
      throw Error("Unexpected read");
    };
    const providers = vi.fn(() => [rpc(), rpc()] as const);
    const resolve = createConstructorDependencyResolver({ rpcs: providers, now: () => now });
    const pending = resolve(production, input.predictions.find(p => p.targetId === "liquidity")!.predictedAddress);
    production.chainId = 1;
    const dependencies = await pending;
    expect(providers.mock.calls).toEqual([[999], [999]]); expect(calls).toBe(22);
    const result = await materializeGeneralRuntime(input.project, input.compilation, { ...input.selected, observedDependencies: dependencies }, input.predictions);
    expect(result.version).toBe(3); expect(result.dependencyContext?.observation.chainId).toBe(999);
    const next=await resolve(input.project.production!,input.predictions.find(p=>p.targetId==="liquidity")!.predictedAddress);
    // Reuse only the still-fresh, source-bound block observation. Each caller's
    // feed trace and canonical-block comparison still run on both providers.
    expect(next.observation.id).toBe(dependencies.observation.id);
    expect(calls).toBe(26);expect(providers.mock.calls).toEqual([[999],[999],[999]]);
  });
  it("binds source and predicted addresses before awaiting the dependency resolver", async () => {
    const project = structuredClone(input.project), compilation = structuredClone(input.compilation), predictions = structuredClone(input.predictions);
    const originalHash = project.hash, originalAddress = predictions[0].predictedAddress;
    const resolveObservedDependencies = vi.fn(async () => {
      project.sources["Project.sol"].content = "contract Changed {}";
      predictions[0].predictedAddress = `0x${"21".repeat(20)}`;
      await Promise.resolve();
      return input.dependencies;
    });
    const result = await materializeGeneralRuntime(project, compilation, { ...input.selected, resolveObservedDependencies }, predictions);
    expect(resolveObservedDependencies).toHaveBeenCalledTimes(1);
    expect(result.projectHash).toBe(originalHash); expect(result.targets[0].address).toBe(originalAddress);
  });
});
