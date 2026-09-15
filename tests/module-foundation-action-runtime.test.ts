import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { OpenConfigContext } from "@/packages/classic-modules/src/open-config.mjs";
import { foundationFactoryAbi, type FoundationLaunchParameters } from "@/lib/module-foundation/abi";
import { assertFoundationInfrastructure, assertFoundationPool, type FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import { FOUNDATION_CATALOG_SCHEMA_V1, bindFoundationCatalogV1, type FoundationCatalogEntryV1 } from "@/lib/module-foundation/catalog";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_HOST_ADAPTER_ID_V1, FOUNDATION_PACKAGE_EXTENSION_V1,
  FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1, foundationDataDigest, hashFoundationModuleDescriptorV1, hashFoundationModuleManifestV1,
  type FoundationModuleDescriptorV1,
} from "@/lib/module-foundation/manifest";
import { FOUNDATION_MANAGEMENT_ACTION_ABI_V1, composeFoundationUiSelectionsV1 } from "@/lib/module-foundation/presentation";
import {
  decodeFoundationLaunchSelectionsV1, prepareFoundationModuleActionV1, readFoundationActionRuntimeV1,
  revalidateFoundationModuleActionV1, type FoundationActionRoleResolverV1,
} from "@/lib/module-foundation/action-runtime";
import type { FoundationModuleSelection } from "@/lib/module-foundation/ui-types";

// Infrastructure provenance is covered by the SDK tests. Keep the real sequence simulator here so balance reads and reorg checks execute.
vi.mock("@/lib/module-foundation/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/module-foundation/client")>(),
  assertFoundationInfrastructure: vi.fn(), assertFoundationPool: vi.fn(),
}));

const hash = (value: string) => keccak256(toHex(value));
const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const now = 1_800_000_000, creator = address(3), token = address(21), quote = address(22), hook = address(20), ledger = address(23);
const checkpoint = { blockNumber: 1000n, blockHash: hash("block-1000"), timestamp: BigInt(now) };
const moduleCode = "0x60016000526001601ff3" as Hex, factoryCode = "0x60026000526001601ff3" as Hex;
const descriptor = (i: number): FoundationModuleDescriptorV1 => ({ moduleId: hash(`technical-state-${i}`), abiVersion: 1, phases: 6, resources: 1,
  beforeGas: 0, afterGas: 50_000, actionGas: 60_000, failOpenAfter: false, exclusiveGroup: FOUNDATION_ZERO_HASH });

function sourcePackage(i: number, role: string): OpenSourcePackage {
  const d = descriptor(i);
  return { format: "programmable.classic.source-package.v0.1", name: `Technical state cell ${i}`, version: "1.2.0",
    author: address(1), rewardWallet: address(1), familySalt: hash(`family-${i}`),
    source: { files: [{ path: "src/Cell.sol", sha256: "a".repeat(64) }, { path: "README.md", sha256: "b".repeat(64) }] },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "Cell" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "CellFactory" }],
    configuration: { type: "record", fields: {
      settings: { type: "record", fields: { ceiling: { type: "uint", min: "1", max: "1000" }, enabled: { type: "bool", binding: { mode: "fixed", value: true } } }, required: ["ceiling", "enabled"] },
      amounts: { type: "array", items: { type: "uint", max: "10" }, minItems: 1, maxItems: 3 },
      recipient: { type: "account" }, asset: { type: "asset" },
    }, required: ["settings", "amounts", "recipient", "asset"] },
    ports: { inputs: {}, outputs: {} }, constraints: [], documentation: "README.md",
    requiresHost: [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)],
    management: { summary: "Advance a bounded state cell.", reads: [], actions: [{ id: "advance", label: "Advance state", component: "module", entrypoint: "onAction",
      description: "Advance this cell's state within its ceiling.", role,
      inputs: { type: "record", fields: { step: { type: "uint", min: "1", max: "50" } }, required: ["step"] } }] },
    extensions: { [FOUNDATION_PACKAGE_EXTENSION_V1]: { hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor: d,
      descriptorHash: hashFoundationModuleDescriptorV1(d), configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
      configurationAbi: [{ path: ["settings"], type: "tuple", components: [{ name: "ceiling", type: "uint256" }, { name: "enabled", type: "bool" }] },
        { path: ["amounts"], type: "uint256[]" }, { path: ["recipient"], type: "address" }, { path: ["asset"], type: "address" }],
      defaults: { settings: { ceiling: "100", enabled: true }, amounts: ["1", "2"], recipient: { role: "creator" }, asset: { asset: "quote" } },
      actions: [{ id: "advance", selector: "0x12345678", configurationAbi: [{ path: ["step"], type: "uint256" }] }],
    } },
  };
}
function admitted(source: OpenSourcePackage, i = 0): FoundationCatalogEntryV1 {
  const manifest = createFoundationModuleManifestV1(source, hash(`source-request-${source.version}-${i}`)), manifestHash = hashFoundationModuleManifestV1(manifest);
  return { manifest, review: {
    submissionId: `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`, requestDigest: manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", source), manifestHash,
    artifactDigest: hash(`artifact-${source.version}-${i}`), decisionDigest: hash(`decision-${source.version}-${i}`), reviewer: address(2), reviewerPolicyDigest: hash("review-policy"),
  }, release: { chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: hash(`module-release-${source.version}-${i}`), manifestHash,
    deploymentEvidenceDigest: hash(`deploy-${i}`), runtimeVerificationDigest: hash(`runtime-${i}`), factory: address(10 + i),
    factoryCodeHash: keccak256(factoryCode), moduleCodeHash: keccak256(moduleCode), descriptorHash: hashFoundationModuleDescriptorV1(descriptor(i)) } };
}
function catalogOf(entries: FoundationCatalogEntryV1[]) {
  return bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries }, { admissions: entries.map(entry => entry.review!), releases: entries.map(entry => entry.release!) });
}
interface ContractRead { address: Address; functionName: string; args?: readonly unknown[]; blockNumber: bigint }
interface SimulateInput { account: Address; blockNumber: bigint; calls: readonly { to: Address; data: Hex; value?: bigint }[] }

function fixture(count = 1, role = "creator", selectedAsset = quote) {
  const entries = Array.from({ length: count }, (_, i) => admitted(sourcePackage(i, role), i));
  const catalog = catalogOf(entries), context: OpenConfigContext = { roles: { creator }, assets: { quote: { address: quote, chainId: 4663, decimals: 6 },
    ...(selectedAsset === quote ? {} : { [`erc20:${selectedAsset}`]: { address: selectedAsset, chainId: 4663, decimals: 6 } }) } };
  const selections: FoundationModuleSelection[] = entries.map(entry => ({ id: entry.manifest.packageId, version: entry.manifest.sourceDescriptor.version,
    digest: hashFoundationModuleManifestV1(entry.manifest), configuration: { "/settings/ceiling": "100", "/amounts": '["1","2"]', "/recipient": creator, "/asset": selectedAsset, "$creatorSharePercent": "25.50" } }));
  const environment = { catalog, chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, context };
  const composition = composeFoundationUiSelectionsV1({ ...environment, selections, creatorFeeBps: 300 });
  if (!composition.ok) throw new Error(JSON.stringify(composition.diagnostics));
  const pool = { token, quote, hook, poolId: hash("pool") };
  const binding: FoundationDeploymentBinding = { releaseDigest: hash("foundation-release"), sourceCommit: "a".repeat(40), startBlock: 10n,
    factory: { address: address(40), runtimeCodeHash: hash("launch-factory") }, hookDeployer: { address: address(41), runtimeCodeHash: hash("hook-deployer") } };
  const record = { token, hook, ledger, poolId: pool.poolId, baseVault: address(42), basePositionId: 1n, creatorPositionId: 0n, initialBuyTokenAmount: 0n };
  const installed = composition.modules.map((selected, i) => ({ instance: address(30 + i), codeHash: selected.moduleCodeHash,
    configurationHash: keccak256(selected.configuration), descriptor: descriptor(i) }));
  const contexts = installed.map(() => ({ host: hook, token, quote, creator, ledger, poolId: pool.poolId }));
  const childConfigs = installed.map(item => item.configurationHash), childDescriptors = installed.map(item => structuredClone(item.descriptor));
  const codes = new Map<string, Hex>([[hook, "0x60036000526001601ff3"], ...installed.map(item => [item.instance, moduleCode] as const), ...composition.modules.map(item => [item.factory, factoryCode] as const)]);
  const state = { count: BigInt(count), compositionHash: composition.compositionHash, reorg: false, deltas: new Map<Address, bigint>(), actionReturn: "0x" as Hex, actionFailure: false };
  vi.mocked(assertFoundationInfrastructure).mockResolvedValue(checkpoint);
  vi.mocked(assertFoundationPool).mockResolvedValue({ record, creator, creatorFeeBps: 300,
    key: { currency0: token, currency1: quote, hooks: hook, fee: 0, tickSpacing: 60 } });
  const readContract = vi.fn(async (call: ContractRead) => {
    expect(call.blockNumber).toBe(checkpoint.blockNumber);
    if (call.address === hook) {
      if (call.functionName === "moduleCount") return state.count;
      if (call.functionName === "compositionHash") return state.compositionHash;
      if (call.functionName === "moduleAt") return structuredClone(installed[Number(call.args![0])]);
    }
    const index = installed.findIndex(item => item.instance === call.address);
    if (index >= 0) {
      if (call.functionName === "context") return structuredClone(contexts[index]);
      if (call.functionName === "configurationHash") return childConfigs[index];
      if (call.functionName === "descriptor") return structuredClone(childDescriptors[index]);
    }
    throw new Error(`Unexpected read ${call.functionName}`);
  });
  const getCode = vi.fn(async (call: { address: Address; blockNumber: bigint }) => { expect(call.blockNumber).toBe(checkpoint.blockNumber); return codes.get(call.address.toLowerCase()) ?? "0x"; });
  const getBlock = vi.fn(async (call: { blockNumber: bigint }) => { expect(call.blockNumber).toBe(checkpoint.blockNumber); return { ...checkpoint, hash: state.reorg ? hash("reorg") : checkpoint.blockHash }; });
  const simulateCalls = vi.fn(async (input: SimulateInput) => {
    expect(input.blockNumber).toBe(checkpoint.blockNumber);
    let acted = false;
    return { results: input.calls.map(call => {
      if (call.to === hook) {
        expect(acted).toBe(false); acted = true; expect(call.value).toBe(0n);
        expect(decodeFunctionData({ abi: FOUNDATION_MANAGEMENT_ACTION_ABI_V1, data: call.data }).functionName).toBe("executeModuleAction");
        return state.actionFailure ? { status: "failure", error: { message: "Source action reverted" } } : { status: "success", data: state.actionReturn, gasUsed: 75_000n };
      }
      // These are actual ABI balanceOf calls generated by simulateFoundationSequence, before and after the action.
      expect(call.data.slice(0, 10)).toBe("0x70a08231");
      const value = 1_000n + (acted ? state.deltas.get(call.to) ?? 0n : 0n);
      return { status: "success", data: encodeAbiParameters([{ type: "uint256" }], [value]), gasUsed: 1_000n };
    }) };
  });
  const client = { readContract, getCode, getBlock, simulateCalls } as unknown as PublicClient;
  const selection = { id: selections[0]?.id ?? hash("none"), version: "1.2.0", digest: selections[0]?.digest ?? hash("none"), actionId: "advance", configuration: { "/step": "7" } };
  const input = { client, binding, pool, catalog, selections, context, account: creator, moduleIndex: 0, selection };
  const parameters: FoundationLaunchParameters = { metadata: { name: "Technical", symbol: "TECH", description: "Fixture", imageURI: "https://example.com/fixture.png", website: "", socialData: "0x" },
    quote, quoteDecimals: 6, initialTick: 0, creatorFeeBps: 300, additionalQuoteAmount: 0n, initialBuyQuoteAmount: 0n, initialBuyMinimumTokenAmount: 0n,
    deadline: BigInt(now + 60), tokenSalt: hash("token-salt"), hookSalt: hash("hook-salt"), modules: composition.modules };
  const calldata = encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [parameters] });
  return { ...input, input, entries, parameters, calldata, installed, childConfigs, childDescriptors, contexts, codes, state, readContract, getCode, getBlock, simulateCalls };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("Foundation RPC module action binding", () => {
  it("rejects a withdrawn module admission at action replay even when its host release and runtime bytes are unchanged", async () => {
    const f = fixture(), prepared = await prepareFoundationModuleActionV1(f.input);
    const withdrawn = bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: f.entries },
      { admissions: [], releases: f.entries.map(entry => entry.release!) });
    f.simulateCalls.mockClear();
    await expect(revalidateFoundationModuleActionV1(prepared, { ...f.input, catalog: withdrawn })).rejects.toThrow();
    expect(f.simulateCalls).not.toHaveBeenCalled();
    expect(prepared.binding.releaseDigest).toBe(f.binding.releaseDigest);
  });

  it("rejects a withdrawn module runtime release at launch re-decoding while its original source remains admitted", () => {
    const f = fixture();
    const withdrawn = bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: f.entries },
      { admissions: f.entries.map(entry => entry.review!), releases: [] });
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: withdrawn, calldata: f.calldata, context: f.context }))
      .toThrow("No currently admitted package");
  });

  it("reads and binds every installed module at one actual checkpoint", async () => {
    const f = fixture(2), runtime = await readFoundationActionRuntimeV1(f.input);
    expect(runtime.instances).toHaveLength(2);
    expect(runtime.instances[1].readback.module.instance).toBe(f.installed[1].instance);
    expect(runtime.instances[0].readback.releaseDigest).toBe(f.entries[0].release!.releaseDigest);
    expect(runtime.sourceVerificationDigest).not.toBe(f.binding.releaseDigest);
    expect(runtime.instances[0].readback.sourceVerificationDigest).toBe(runtime.sourceVerificationDigest);
    expect(f.readContract.mock.calls.filter(([call]) => call.functionName === "context")).toHaveLength(2);
    expect(f.getBlock).toHaveBeenCalledWith({ blockNumber: checkpoint.blockNumber });
    expect(assertFoundationInfrastructure).toHaveBeenCalledWith(f.client, f.binding);
    expect(assertFoundationPool).toHaveBeenCalledWith(f.client, f.binding, f.pool, checkpoint.blockNumber);
    expect(f.simulateCalls).not.toHaveBeenCalled();
  });
  it("represents an empty composition and rejects an absent action position", async () => {
    const f = fixture(0); expect((await readFoundationActionRuntimeV1(f.input)).instances).toEqual([]);
    await expect(prepareFoundationModuleActionV1(f.input)).rejects.toThrow(/no module/);
  });
  it.each(["child-code", "factory-code", "child-configuration", "host-configuration", "child-descriptor", "host-descriptor", "context"])("rejects %s changes in the unselected second module", async mutation => {
    const f = fixture(2);
    if (mutation === "child-code") f.codes.set(f.installed[1].instance, "0x60ff");
    if (mutation === "factory-code") f.codes.set(address(11), "0x60ff");
    if (mutation === "child-configuration") f.childConfigs[1] = hash("changed");
    if (mutation === "host-configuration") f.installed[1].configurationHash = hash("changed");
    if (mutation === "child-descriptor") f.childDescriptors[1].actionGas += 10_000;
    if (mutation === "host-descriptor") f.installed[1].descriptor.actionGas += 10_000;
    if (mutation === "context") f.contexts[1].creator = address(99);
    await expect(prepareFoundationModuleActionV1(f.input)).rejects.toThrow(/differs|bound to another/);
    expect(f.simulateCalls).not.toHaveBeenCalled();
  });
  it("rejects composition/count changes and a reorg during reads", async () => {
    const f = fixture(), originalHash = f.state.compositionHash; f.state.compositionHash = hash("wrong");
    await expect(readFoundationActionRuntimeV1(f.input)).rejects.toThrow(/immutable composition/);
    f.state.compositionHash = originalHash;
    f.state.count = 9n;
    await expect(readFoundationActionRuntimeV1(f.input)).rejects.toThrow(/immutable composition/);
    f.state.count = 1n; f.state.reorg = true;
    await expect(readFoundationActionRuntimeV1(f.input)).rejects.toThrow(/Chain state changed/);
  });
  it("simulates real balanceOf calls and locks observed positive gains for replay", async () => {
    const f = fixture(); f.state.deltas.set(quote, 25n);
    const prepared = await prepareFoundationModuleActionV1(f.input);
    expect(prepared.steps).toHaveLength(1);
    expect(prepared.steps[0]).toMatchObject({ kind: "module-action", gasUsed: 75_000n, transaction: { from: creator, to: hook, value: 0n } });
    expect(prepared.balances).toEqual(expect.arrayContaining([expect.objectContaining({ token: quote, before: 1_000n, after: 1_025n, delta: 25n })]));
    expect(prepared.balanceChecks).toEqual([{ token, account: creator, minimumDelta: 0n }, { token: quote, account: creator, minimumDelta: 25n }]);
    expect(f.simulateCalls.mock.calls[0][0].calls).toHaveLength(5);
    expect(Object.isFrozen(prepared.steps[0].transaction)).toBe(true);
    // Root's private registry seals a clone, so validator supports cloning while requiring fresh RPC/source/role reconstruction.
    await expect(revalidateFoundationModuleActionV1(structuredClone(prepared), f.input)).resolves.toMatchObject({ kind: "module-action" });
    f.state.deltas.set(quote, 24n);
    await expect(revalidateFoundationModuleActionV1(prepared, f.input)).rejects.toThrow(/actual simulated wallet balances/);
  });
  it("rejects caller token losses and an action revert", async () => {
    const f = fixture(); f.state.deltas.set(token, -1n);
    await expect(prepareFoundationModuleActionV1(f.input)).rejects.toThrow(/actual simulated wallet balances/);
    f.state.deltas.set(token, 0n); f.state.actionFailure = true;
    await expect(prepareFoundationModuleActionV1(f.input)).rejects.toThrow(/Source action reverted/);
  });
  it("rejects stale action identity and attempted arbitrary targets or value", async () => {
    const f = fixture();
    for (const field of ["id", "digest", "version"] as const) {
      await expect(prepareFoundationModuleActionV1({ ...f.input, selection: { ...f.selection, [field]: field === "version" ? "2.0.0" : hash("substitute") } })).rejects.toThrow(/source version/);
    }
    await expect(prepareFoundationModuleActionV1({ ...f.input, selection: { ...f.selection, configuration: { "/step": "7", to: address(99), value: "1" } } })).rejects.toThrow(/not editable/);
    expect(f.simulateCalls).not.toHaveBeenCalled();
    const prepared = await prepareFoundationModuleActionV1(f.input), changed = structuredClone(prepared);
    changed.steps[0].transaction.to = address(99);
    await expect(revalidateFoundationModuleActionV1(changed, f.input)).rejects.toThrow(/target or bytes changed/);
    changed.steps[0].transaction.to = hook; changed.steps[0].transaction.value = 1n;
    await expect(revalidateFoundationModuleActionV1(changed, f.input)).rejects.toThrow(/target or bytes changed/);
  });
  it("protects an explicitly listed extra ERC20 using the same before/after sequence", async () => {
    const f = fixture(), extra = address(60); f.state.deltas.set(extra, 9n);
    const input = { ...f.input, minimumWalletDeltas: [{ token: extra, minimumDelta: 9n }] };
    const prepared = await prepareFoundationModuleActionV1(input);
    expect(prepared.balances).toEqual(expect.arrayContaining([expect.objectContaining({ token: extra, delta: 9n })]));
    expect(f.simulateCalls.mock.calls[0][0].calls).toHaveLength(7);
    f.state.deltas.set(extra, 8n);
    await expect(revalidateFoundationModuleActionV1(prepared, f.input)).rejects.toThrow(/actual simulated wallet balances/);
  });
  it("preserves explicit nonnegative minima and rejects asset limits and invalid return data", async () => {
    const f = fixture(); f.state.deltas.set(quote, 25n);
    const prepared = await prepareFoundationModuleActionV1({ ...f.input, minimumWalletDeltas: [{ token: quote, minimumDelta: 20n }] });
    expect(prepared.balanceChecks[1].minimumDelta).toBe(20n);
    f.state.deltas.set(quote, 20n); await expect(revalidateFoundationModuleActionV1(prepared, f.input)).resolves.toBeDefined();
    await expect(prepareFoundationModuleActionV1({ ...f.input, minimumWalletDeltas: [{ token: quote, minimumDelta: -1n }] })).rejects.toThrow(/nonnegative/);
    await expect(prepareFoundationModuleActionV1({ ...f.input, minimumWalletDeltas: [50, 51, 52].map(n => ({ token: address(n), minimumDelta: 0n })) })).rejects.toThrow(/four-asset/);
    await expect(prepareFoundationModuleActionV1({ ...f.input, minimumWalletDeltas: [{ token: quote, minimumDelta: 0n }, { token: quote, minimumDelta: 0n }] })).rejects.toThrow(/each asset once/);
    f.state.actionReturn = "0x1234"; await expect(prepareFoundationModuleActionV1(f.input)).rejects.toThrow(/outside its reviewed ABI/);
  });
  it("resolves custom roles only through the app callback at the current bound context", async () => {
    const f = fixture(1, "operator"), account = address(90);
    await expect(prepareFoundationModuleActionV1({ ...f.input, account })).rejects.toThrow(/operator role/);
    const resolveRole = vi.fn<FoundationActionRoleResolverV1>(async ({ instance, checkpoint: observed, role, account: actual }) => {
      expect(observed).toEqual(checkpoint); expect(actual).toBe(account);
      return { role, account: actual, contextKey: instance.contextKey, evidenceDigest: hash("actual-app-role-proof") };
    });
    const prepared = await prepareFoundationModuleActionV1({ ...f.input, account, resolveRole });
    expect(prepared.intent.role).toBe("operator");
    await expect(revalidateFoundationModuleActionV1(prepared, { ...f.input, account, resolveRole })).resolves.toBeDefined();
    expect(resolveRole).toHaveBeenCalledTimes(2);
    await expect(revalidateFoundationModuleActionV1(prepared, { ...f.input, account, resolveRole: async () => null })).rejects.toThrow(/operator role/);
    await expect(prepareFoundationModuleActionV1({ ...f.input, account, resolveRole: async () => ({ role: "operator", account, contextKey: hash("different-context"), evidenceDigest: hash("proof") }) })).rejects.toThrow(/operator role/);
  });
  it("enforces real creator/public roles and rejects wallet or release changes before replay", async () => {
    const f = fixture();
    await expect(prepareFoundationModuleActionV1({ ...f.input, account: address(90) })).rejects.toThrow(/creator's wallet/);
    const prepared = await prepareFoundationModuleActionV1(f.input);
    await expect(revalidateFoundationModuleActionV1(prepared, { ...f.input, account: address(90) })).rejects.toThrow(/another connected wallet/);
    await expect(revalidateFoundationModuleActionV1(prepared, { ...f.input, binding: { ...f.binding, sourceCommit: "b".repeat(40) } })).rejects.toThrow(/deployment binding changed/);
    vi.setSystemTime((now + 121) * 1000);
    await expect(revalidateFoundationModuleActionV1(prepared, f.input)).rejects.toThrow(/expired/);
    vi.setSystemTime(now * 1000);
    const publicFixture = fixture(1, "public");
    await expect(prepareFoundationModuleActionV1({ ...publicFixture.input, account: address(90) })).resolves.toMatchObject({ account: address(90) });
  });
});

describe("Foundation original launch configuration restoration", () => {
  it("restores exact tuples, arrays, account/asset bindings, version/digest and creator allocation", async () => {
    const f = fixture(2), decoded = decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: f.calldata, context: f.context });
    expect(decoded.selections).toEqual(f.selections);
    expect(decoded).toMatchObject({ creatorFeeBps: 300, quote, quoteDecimals: 6, transactionVerified: false, calldataHash: keccak256(f.calldata) });
    await expect(readFoundationActionRuntimeV1({ ...f.input, selections: decoded.selections })).resolves.toMatchObject({ compositionHash: decoded.compositionHash });
  });
  it("restores zero modules without inventing a package identity", () => {
    const f = fixture(0); expect(decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: f.calldata }).selections).toEqual([]);
  });
  it("restores a third asset with exact address/metadata context and equivalent source aliases", async () => {
    const f = fixture(1, "creator", address(70));
    const context = { ...f.context, assets: { ...f.context.assets, exactAlias: { chainId: 4663, address: address(70), decimals: 6 } } };
    const decoded = decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: f.calldata, context, packageIds: [f.entries[0].manifest.packageId] });
    expect(decoded.selections).toEqual(f.selections);
    await expect(readFoundationActionRuntimeV1({ ...f.input, context, selections: decoded.selections })).resolves.toMatchObject({ compositionHash: decoded.compositionHash });
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: f.calldata,
      context: { ...context, assets: { ...context.assets, badAlias: { chainId: 4663, address: address(70), decimals: 18 } } } }))
      .toThrow(/metadata bindings disagree/);
  });
  it("requires the original package id when different source versions share identical runtime bytes", () => {
    const f = fixture(), nextSource = sourcePackage(0, "creator"); nextSource.version = "1.2.1";
    const catalog = catalogOf([...f.entries, admitted(nextSource)]);
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog, calldata: f.calldata, context: f.context })).toThrow(/Multiple admitted packages/);
    expect(decodeFoundationLaunchSelectionsV1({ catalog, calldata: f.calldata, context: f.context, packageIds: [f.entries[0].manifest.packageId] }).selections).toEqual(f.selections);
  });
  it("rejects altered source bindings, unverified assets and noncanonical launch/configuration bytes", () => {
    const f = fixture();
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: f.calldata })).toThrow(/metadata before preparation/);
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: `${f.calldata}00`, context: f.context })).toThrow(/canonical ABI/);
    const wrongFactory = { ...f.parameters, modules: [{ ...f.parameters.modules[0], factory: address(99) }] };
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [wrongFactory] }), context: f.context })).toThrow(/No currently admitted package/);
    const padded = { ...f.parameters, modules: [{ ...f.parameters.modules[0], configuration: `${f.parameters.modules[0].configuration}00` as Hex }] };
    expect(() => decodeFoundationLaunchSelectionsV1({ catalog: f.catalog, calldata: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [padded] }), context: f.context })).toThrow(/re-encode exactly/);
  });
});
