import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { OpenConfigContext } from "@/packages/classic-modules/src/open-config.mjs";
import { FOUNDATION_ABI_ID, FOUNDATION_INFRASTRUCTURE } from "@/lib/module-foundation/constants";
import { foundationPermit2Abi } from "@/lib/module-foundation/abi";
import { prepareFoundationTrade, type FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import { FOUNDATION_CATALOG_SCHEMA_V1, bindFoundationCatalogV1, type FoundationCatalogEntryV1 } from "@/lib/module-foundation/catalog";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_HOST_ADAPTER_ID_V1, FOUNDATION_PACKAGE_EXTENSION_V1,
  FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1, foundationDataDigest, hashFoundationModuleDescriptorV1, hashFoundationModuleManifestV1,
  type FoundationModuleDescriptorV1,
} from "@/lib/module-foundation/manifest";
import { withFoundationModulePackages } from "@/lib/module-foundation/metadata";
import { composeFoundationUiSelectionsV1 } from "@/lib/module-foundation/presentation";
import { buildFoundationExactInput, foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";
import type { FoundationAssetPinV1 } from "@/lib/module-foundation/assets";
import type { FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import {
  bindFoundationWalletStep, foundationWalletRequestNonce, readFoundationPending,
  revalidateFoundationWalletStep, submitFoundationWalletStep,
} from "@/lib/module-foundation/wallet";

// The actual SDK, catalog binder, source compiler, runtime reader and wallet boundary run unmocked.
// This committed capture supplies only preimages of the six code-owned Uniswap pins. Source admission,
// module deployment and all RPC responses below are controlled unit fixtures, not live release evidence.
const captured = JSON.parse(readFileSync(new URL("../release/robinhood-chain-4663/programmable-postdeployment-capture.json", import.meta.url), "utf8")) as {
  capture: { l2ProviderReadbacks: { entries: { result?: unknown }[] }[] };
};
const infrastructureCodes = new Map<Hex, Hex>();
for (const entry of captured.capture.l2ProviderReadbacks[0].entries) {
  if (typeof entry.result === "string" && /^0x[0-9a-f]+$/i.test(entry.result) && entry.result.length > 2_000) {
    const code = entry.result as Hex;
    infrastructureCodes.set(keccak256(code), code);
  }
}
const address = (n: number) => getAddress(toHex(n, { size: 20 }));
const hash = (label: string) => keccak256(toHex(label));
const now = 1_800_000_000, account = address(3), token = address(21), quote = address(22), extra = address(70);
const hook = address(20), ledger = address(23), moduleFactory = address(10), moduleInstance = address(30);
const checkpoint = { blockNumber: 1_000n, blockHash: hash("trade-admission-block"), timestamp: BigInt(now) };
const moduleCode = "0x60016000526001601ff3" as Hex, factoryCode = "0x60026000526001601ff3" as Hex;
const assetCode = "0x60046000526001601ff3" as Hex, hostCode = "0x60036000526001601ff3" as Hex;
const descriptor: FoundationModuleDescriptorV1 = { moduleId: hash("trade-asset-observer"), abiVersion: 1, phases: 2, resources: 0,
  beforeGas: 0, afterGas: 50_000, actionGas: 0, failOpenAfter: false, exclusiveGroup: FOUNDATION_ZERO_HASH };

function catalogEntry(): FoundationCatalogEntryV1 {
  const source: OpenSourcePackage = {
    format: "programmable.classic.source-package.v0.1", name: "Asset observer fixture", version: "1.2.0",
    author: address(1), rewardWallet: address(1), familySalt: hash("trade-source-family"),
    source: { files: [{ path: "src/Observer.sol", sha256: "a".repeat(64) }, { path: "README.md", sha256: "b".repeat(64) }] },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Observer.sol", entrypoint: "Observer" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Observer.sol", entrypoint: "ObserverFactory" }],
    configuration: { type: "record", fields: { asset: { type: "asset" } }, required: ["asset"] },
    ports: { inputs: {}, outputs: {} }, constraints: [], documentation: "README.md",
    requiresHost: [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)],
    management: { summary: "Observe an explicitly bound asset.", reads: [], actions: [] },
    extensions: { [FOUNDATION_PACKAGE_EXTENSION_V1]: { hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor,
      descriptorHash: hashFoundationModuleDescriptorV1(descriptor), configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
      configurationAbi: [{ path: ["asset"], type: "address" }], defaults: { asset: { asset: "quote" } }, actions: [] } },
  };
  const manifest = createFoundationModuleManifestV1(source, hash("trade-source-request")), manifestHash = hashFoundationModuleManifestV1(manifest);
  return { manifest, review: { submissionId: "00000001-1111-4111-8111-111111111111", requestDigest: manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", source), manifestHash,
    artifactDigest: hash("trade-artifact"), decisionDigest: hash("trade-decision"), reviewer: address(2), reviewerPolicyDigest: hash("trade-policy") },
  release: { chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: hash("trade-module-release"), manifestHash,
    deploymentEvidenceDigest: hash("trade-deployment"), runtimeVerificationDigest: hash("trade-runtime"), factory: moduleFactory,
    factoryCodeHash: keccak256(factoryCode), moduleCodeHash: keccak256(moduleCode), descriptorHash: hashFoundationModuleDescriptorV1(descriptor) } };
}
function catalogOf(entry: FoundationCatalogEntryV1, admitted = true) {
  return bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [entry] },
    { admissions: admitted ? [entry.review!] : [], releases: [entry.release!] });
}

interface ContractRead { address: Address; functionName: string; args?: readonly unknown[]; blockNumber: bigint }
interface SimulationCall { to: Address; data: Hex; value?: bigint }
function fixture() {
  const entry = catalogEntry(), catalog = catalogOf(entry);
  const context: OpenConfigContext = { roles: { creator: account }, assets: {
    token: { chainId: 4663, address: token, decimals: 18 }, quote: { chainId: 4663, address: quote, decimals: 6 },
    [`erc20:${extra}`]: { chainId: 4663, address: extra, decimals: 6 },
  } };
  const selections: FoundationModuleSelection[] = [{ id: entry.manifest.packageId, version: "1.2.0",
    digest: hashFoundationModuleManifestV1(entry.manifest), configuration: { "/asset": extra } }];
  const composition = composeFoundationUiSelectionsV1({ catalog, selections, context, creatorFeeBps: 300,
    chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1 });
  if (!composition.ok) throw new Error(JSON.stringify(composition.diagnostics));
  const pins: FoundationAssetPinV1[] = [[extra, 6, keccak256(assetCode)]];
  const binding: FoundationDeploymentBinding = { releaseDigest: hash("trade-foundation-release"), sourceCommit: "a".repeat(40), startBlock: 10n,
    factory: { address: address(40), runtimeCodeHash: keccak256(factoryCode) }, hookDeployer: { address: address(41), runtimeCodeHash: keccak256(hostCode) } };
  const key = foundationPoolKey({ token, quote, hook }), pool = { token, quote, hook, poolId: foundationPoolId(key) };
  const record = { token, hook, ledger, poolId: pool.poolId, baseVault: address(42), basePositionId: 1n, creatorPositionId: 0n, initialBuyTokenAmount: 0n };
  const installed = { instance: moduleInstance, codeHash: keccak256(moduleCode),
    configurationHash: keccak256(composition.modules[0].configuration), descriptor };
  const codes = new Map<string, Hex>([[binding.factory.address, factoryCode], [binding.hookDeployer.address, hostCode],
    [moduleFactory, factoryCode], [moduleInstance, moduleCode], [hook, hostCode], ...[token, quote, extra].map(asset => [asset, assetCode] as const)]
    .map(([address, code]) => [address.toLowerCase(), code]));
  for (const pin of Object.values(FOUNDATION_INFRASTRUCTURE)) {
    const code = infrastructureCodes.get(pin.runtimeCodeHash);
    if (!code) throw new Error(`Missing committed bytecode preimage for ${pin.address}`);
    codes.set(pin.address.toLowerCase(), code);
  }
  const state = { height: checkpoint.blockNumber, moduleCount: 1n, socialData: withFoundationModulePackages("0x", [entry.manifest.packageId], pins),
    quoteAllowance: 10_000n, permitAllowance: 10_000n, extraDelta: 0n, extraDecimals: 6, reorg: false };
  const readContract = vi.fn(async (call: ContractRead) => {
    expect(call.blockNumber).toBe(state.height);
    const at = getAddress(call.address);
    if (at === binding.factory.address) {
      if (call.functionName === "VERSION_ID") return FOUNDATION_ABI_ID;
      if (call.functionName === "launchOf") return record;
      if (call.functionName === "hookDeployer") return binding.hookDeployer.address;
      if (["poolManager", "positionManager", "universalRouter", "permit2"].includes(call.functionName)) {
        return FOUNDATION_INFRASTRUCTURE[call.functionName as keyof typeof FOUNDATION_INFRASTRUCTURE].address;
      }
    }
    if (at === hook) {
      const fields: Record<string, unknown> = { initializer: binding.factory.address, token, quote, ledger, poolId: pool.poolId,
        poolKey: key, creatorFeeBps: 300, creator: account, moduleCount: state.moduleCount, compositionHash: composition.compositionHash, moduleAt: installed };
      if (Object.hasOwn(fields, call.functionName)) return structuredClone(fields[call.functionName]);
    }
    if (at === moduleInstance) {
      if (call.functionName === "context") return { host: hook, token, quote, creator: account, ledger, poolId: pool.poolId };
      if (call.functionName === "configurationHash") return installed.configurationHash;
      if (call.functionName === "descriptor") return descriptor;
    }
    if (at === token && call.functionName === "metadata") return ["Description", "https://example.com/fixture.png", "", state.socialData];
    if ([token, quote, extra].includes(at)) {
      if (call.functionName === "name") return at === extra ? "Additional asset" : "Base asset";
      if (call.functionName === "symbol") return at === extra ? "EXTRA" : "BASE";
      if (call.functionName === "decimals") return at === token ? 18 : at === extra ? state.extraDecimals : 6;
      if (call.functionName === "totalSupply") return 1_000_000n;
      if (at === quote && call.functionName === "allowance") return state.quoteAllowance;
    }
    if (at === FOUNDATION_INFRASTRUCTURE.permit2.address && call.functionName === "allowance") return [state.permitAllowance, now + 10_000, 0];
    throw new Error(`Unexpected contract read ${at} ${call.functionName}`);
  });
  const getCode = vi.fn(async (request: { address: Address; blockNumber: bigint }) => {
    expect(request.blockNumber).toBe(state.height); return codes.get(request.address.toLowerCase()) ?? "0x";
  });
  const getBlock = vi.fn(async (request: { blockNumber?: bigint; blockTag?: string }) => {
    const number = request.blockNumber ?? state.height;
    return { number, hash: state.reorg && request.blockNumber !== undefined ? hash("changed-trade-block")
      : number === checkpoint.blockNumber ? checkpoint.blockHash : hash(`trade-block-${number}`),
    timestamp: checkpoint.timestamp + number - checkpoint.blockNumber };
  });
  const simulateContract = vi.fn(async () => ({ result: [100n, 100_000n] }));
  const simulateCalls = vi.fn(async (request: { account: Address; blockNumber: bigint; calls: readonly SimulationCall[] }) => {
    expect(request.account).toBe(account); expect(request.blockNumber).toBe(state.height);
    let swapped = false;
    return { results: request.calls.map(call => {
      if (call.to === FOUNDATION_INFRASTRUCTURE.universalRouter.address) {
        expect(swapped).toBe(false); expect(call.value).toBe(0n); swapped = true;
        return { status: "success", data: "0x", gasUsed: 80_000n };
      }
      if (call.data.startsWith("0x70a08231")) {
        expect([token, quote, extra]).toContain(call.to);
        expect(decodeFunctionData({ abi: erc20Abi, data: call.data }).args).toEqual([account]);
        const delta = call.to === token ? 100n : call.to === quote ? -10n : state.extraDelta;
        return { status: "success", data: encodeAbiParameters([{ type: "uint256" }], [1_000n + (swapped ? delta : 0n)]), gasUsed: 1_000n };
      }
      expect([quote, FOUNDATION_INFRASTRUCTURE.permit2.address]).toContain(call.to);
      expect(call.value).toBe(0n);
      return { status: "success", data: "0x", gasUsed: 20_000n };
    }) };
  });
  const estimateGas = vi.fn(async () => 150_000n), getTransactionCount = vi.fn(async () => 7);
  const client = { readContract, getCode, getBlock, simulateContract, simulateCalls, estimateGas, getTransactionCount,
    getChainId: vi.fn(async () => 4663) } as unknown as PublicClient;
  const input = { client, binding, account, pool, side: "buy" as const, amountIn: 10n, slippageBps: 100,
    moduleReview: { catalog, selections, context } };
  return { input, entry, catalog, pins, codes, installed, state, readContract, getCode, simulateContract, simulateCalls, estimateGas, getTransactionCount };
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1_000);
  const storage = new MemoryStorage(), activeLocks = new Set<string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: storage }));
  vi.stubGlobal("localStorage", storage); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", { locks: { async request<T>(name: string, _options: unknown, callback: (lock: { name: string } | null) => Promise<T>) {
    if (activeLocks.has(name)) return callback(null);
    activeLocks.add(name); try { return await callback({ name }); } finally { activeLocks.delete(name); }
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Foundation modular trade admission and asset completeness", () => {
  it("rejects a direct registered Factory pool with modules but no source context before any quote or swap simulation", async () => {
    const f = fixture(); f.state.socialData = "0x";
    await expect(prepareFoundationTrade({ ...f.input, moduleReview: undefined })).rejects.toThrow("original admitted module sources");
    expect(f.readContract.mock.calls.some(([call]) => call.functionName === "launchOf")).toBe(true);
    expect(f.readContract.mock.calls.some(([call]) => call.functionName === "moduleCount")).toBe(true);
    expect(f.simulateContract).not.toHaveBeenCalled(); expect(f.simulateCalls).not.toHaveBeenCalled();
  });

  it.each(["claimed-context", "no-context"])("rejects missing immutable asset pins with %s even when the supplied source selection matches the installed module", async contextMode => {
    const f = fixture(); f.state.socialData = withFoundationModulePackages("0x", [f.entry.manifest.packageId]);
    await expect(prepareFoundationTrade({ ...f.input, moduleReview: { ...f.input.moduleReview,
      context: contextMode === "no-context" ? undefined : f.input.moduleReview.context } })).rejects.toThrow(/Asset aliases|metadata before preparation/);
    expect(f.simulateContract).not.toHaveBeenCalled(); expect(f.simulateCalls).not.toHaveBeenCalled();
  });

  it("rejects a different immutable package identity despite the same configuration, descriptor and runtime code", async () => {
    const f = fixture(); f.state.socialData = withFoundationModulePackages("0x", [hash("another-package")], f.pins);
    await expect(prepareFoundationTrade(f.input)).rejects.toMatchObject({ code: "FOUNDATION_ACTION_PACKAGE_IDENTITIES" });
    expect(f.simulateContract).not.toHaveBeenCalled(); expect(f.simulateCalls).not.toHaveBeenCalled();
  });

  it("runs actual source and runtime validation while preserving exact approvals, the official route and the extra asset zero-loss check", async () => {
    const f = fixture(); f.state.quoteAllowance = 5n; f.state.permitAllowance = 0n;
    const prepared = await prepareFoundationTrade(f.input), permit2 = FOUNDATION_INFRASTRUCTURE.permit2.address, router = FOUNDATION_INFRASTRUCTURE.universalRouter.address;
    expect(prepared.balanceChecks).toEqual([{ token: quote, account, delta: -10n }, { token, account, minimumDelta: 99n }, { token: extra, account, minimumDelta: 0n }]);
    expect(prepared.moduleAssetPins).toEqual(f.pins); expect(prepared.moduleReview!.selections).toEqual(f.input.moduleReview.selections);
    expect(prepared.steps.map(step => [step.kind, step.transaction.to, step.transaction.value])).toEqual([
      ["approve", quote, 0n], ["approve", quote, 0n], ["approve", permit2, 0n], ["buy", router, 0n],
    ]);
    expect(prepared.steps.slice(0, 2).map(step => decodeFunctionData({ abi: erc20Abi, data: step.transaction.data }).args)).toEqual([[permit2, 0n], [permit2, 10n]]);
    expect(decodeFunctionData({ abi: foundationPermit2Abi, data: prepared.steps[2].transaction.data }).args).toEqual([quote, router, 10n, now + 300]);
    expect(prepared.steps[3].transaction).toEqual(buildFoundationExactInput({ ...f.input, owner: account, recipient: account,
      minimumOutput: 99n, deadline: BigInt(now + 300), now: BigInt(now) }).transaction);
    expect(f.readContract.mock.calls.some(([call]) => call.functionName === "configurationHash" && call.address === moduleInstance)).toBe(true);
    expect(f.simulateCalls.mock.calls[0][0].calls).toHaveLength(10);
    expect(Object.isFrozen(prepared.moduleReview!.context.assets)).toBe(true);
  });

  it("rejects an actual extra-asset wallet debit even when the admitted module and swap both return success", async () => {
    const f = fixture(); f.state.extraDelta = -1n;
    await expect(prepareFoundationTrade(f.input)).rejects.toThrow("actual simulated wallet balances");
    expect(f.simulateContract).toHaveBeenCalledOnce(); expect(f.simulateCalls).toHaveBeenCalledOnce();
  });

  it.each(["admission", "asset-code", "asset-decimals", "module-code"])("rejects %s withdrawal or drift before wallet replay can simulate, estimate or request a transaction", async change => {
    const f = fixture(), sequence = await prepareFoundationTrade(f.input);
    f.simulateContract.mockClear(); f.simulateCalls.mockClear();
    const currentCatalog = change === "admission" ? catalogOf(f.entry, false) : f.catalog;
    if (change === "asset-code") f.codes.set(extra.toLowerCase(), "0x60ff");
    if (change === "asset-decimals") f.state.extraDecimals = 18;
    if (change === "module-code") f.codes.set(moduleInstance.toLowerCase(), "0x60ff");
    const resolveCatalog = vi.fn(async () => currentCatalog), requested = vi.fn();
    const value = bindFoundationWalletStep({ client: f.input.client, sequence, index: 0,
      resolveAuthority: async () => f.input.binding, resolveCatalog });
    await expect(submitFoundationWalletStep(value, async preparation => {
      try { await revalidateFoundationWalletStep(preparation, account); await foundationWalletRequestNonce(preparation); }
      catch (error) { throw Object.assign(error as Error, { walletRequestAttempted: false }); }
      requested(); return hash("unit-wallet-hash");
    })).rejects.toThrow(change === "admission" ? "no current admitted catalog binding" : change === "module-code" ? "differs from the admitted source" : "decimals or runtime code changed");
    expect(resolveCatalog).toHaveBeenCalledOnce(); expect(f.simulateContract).not.toHaveBeenCalled(); expect(f.simulateCalls).not.toHaveBeenCalled();
    expect(f.estimateGas).not.toHaveBeenCalled(); expect(requested).not.toHaveBeenCalled(); expect(readFoundationPending(account)).toBeNull();
  });

  it("uses the fresh runtime checkpoint for all replay balances and preserves the reviewed calldata, target, value and durable nonce", async () => {
    const f = fixture(), sequence = await prepareFoundationTrade(f.input), original = structuredClone(sequence.steps[0].transaction);
    f.simulateCalls.mockClear(); f.readContract.mockClear();
    const value = bindFoundationWalletStep({ client: f.input.client, sequence, index: 0,
      resolveAuthority: async () => f.input.binding,
      resolveCatalog: async () => { f.state.height = 1_001n; return f.catalog; } });
    const result = await submitFoundationWalletStep(value, async preparation => {
      const transaction = await revalidateFoundationWalletStep(preparation, account);
      expect(transaction).toMatchObject({ chainId: 4663, from: account, to: original.to, data: original.data, value: "0x0", gas: toHex(195_000n) });
      expect(await foundationWalletRequestNonce(preparation)).toBe(7);
      return hash("unit-wallet-hash");
    });
    expect(f.simulateCalls).toHaveBeenCalledOnce(); expect(f.simulateCalls.mock.calls[0][0].blockNumber).toBe(1_001n);
    const assetReads = f.readContract.mock.calls.filter(([call]) => call.address === extra || call.functionName === "configurationHash");
    expect(assetReads.length).toBeGreaterThan(0); expect(assetReads.every(([call]) => call.blockNumber === 1_001n)).toBe(true);
    expect(f.estimateGas).toHaveBeenCalledWith({ account, to: original.to, data: original.data, value: 0n, nonce: 7 });
    expect(sequence.steps[0].transaction).toEqual(original);
    expect(readFoundationPending(account)).toMatchObject({ transactionHash: result, nonce: 7, to: original.to, calldataHash: keccak256(original.data), value: "0x0" });
  });

  it("requires a fresh admission resolver even for a privately sealed successful modular trade", async () => {
    const f = fixture(), sequence = await prepareFoundationTrade(f.input); f.simulateCalls.mockClear();
    const value = bindFoundationWalletStep({ client: f.input.client, sequence, index: 0, resolveAuthority: async () => f.input.binding });
    await expect(submitFoundationWalletStep(value, async preparation => {
      try { await revalidateFoundationWalletStep(preparation, account); }
      catch (error) { throw Object.assign(error as Error, { walletRequestAttempted: false }); }
      throw new Error("Unexpectedly passed the missing admission resolver");
    })).rejects.toThrow("current module admissions");
    expect(f.simulateCalls).not.toHaveBeenCalled(); expect(f.estimateGas).not.toHaveBeenCalled(); expect(readFoundationPending(account)).toBeNull();
  });

  it("keeps the zero-module base pool usable without an optional source catalog", async () => {
    const f = fixture(); f.state.moduleCount = 0n; f.state.socialData = "0x";
    const sequence = await prepareFoundationTrade({ ...f.input, moduleReview: undefined });
    expect(sequence.moduleReview).toBeNull(); expect(sequence.moduleAssetPins).toEqual([]); expect(sequence.balanceChecks).toHaveLength(2);
    expect(f.simulateCalls).toHaveBeenCalledOnce();
  });
});
