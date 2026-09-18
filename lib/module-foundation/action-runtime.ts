import {
  decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi,
  type AbiParameter, type Address, type Hex, type PublicClient,
} from "viem";
import type { OpenConfigContext, OpenConfigSchema, OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import type { ModuleEngineConfigurationArgument, ModuleEngineConfigurationComponent } from "@/lib/module-engine/catalog";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleHash, moduleInteger } from "@/lib/module-mode/release";
import { foundationFactoryNativeAbi, foundationTokenAbi } from "./abi";
import { readFoundationModulePackages } from "./metadata";
import {
  assertFoundationInfrastructure, assertFoundationPool, readFoundationPoolAssetPins, readFoundationQuote, simulateFoundationSequence,
  type FoundationBalanceCheck, type FoundationCheckpoint, type FoundationDeploymentBinding, type FoundationPreparedStep,
} from "./client";
import { FOUNDATION_CHAIN_ID } from "./constants";
import {
  hashFoundationAssetPinsV1, mergeFoundationAssetPinsV1, refreshFoundationAssetsV1, resolveFoundationAssetFieldsV1, resolveFoundationAssetsV1,
  type FoundationAssetPinV1, type FoundationResolvedAssetV1,
} from "./assets";
import { assertBoundFoundationCatalogV1, resolveFoundationCatalogEntryV1, type FoundationCatalogV1 } from "./catalog";
import { hashFoundationCompositionV1 } from "./composition";
import {
  FOUNDATION_HOST_ADAPTER_ID_V1, encodeFoundationConfigurationV1, foundationDataDigest, foundationRequire,
  hashFoundationModuleDescriptorV1,
} from "./manifest";
import {
  FOUNDATION_CREATOR_SHARE_FIELD_V1, bindFoundationActionContextV1, composeFoundationUiSelectionsV1, foundationAssetForAddressV1,
  prepareFoundationActionIntentV1, presentFoundationFieldsV1,
  type FoundationActionContextV1, type FoundationActionIntentV1, type FoundationActionRoleGrantV1, type FoundationActionSelectionV1,
} from "./presentation";
import type { FoundationPool } from "./route";
import type { FoundationConfiguration, FoundationModuleSelection } from "./ui-types";

/** ABI of the immutable FoundationHookV1 and IFoundationModuleV1, including the exact context field order. */
export const foundationActionRuntimeAbiV1 = parseAbi([
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "struct ModuleContext { address host; address token; address quote; address creator; address ledger; bytes32 poolId; }",
  "function moduleCount() view returns (uint256)",
  "function moduleAt(uint256 index) view returns (Module)",
  "function compositionHash() view returns (bytes32)",
  "function context() view returns (ModuleContext)",
  "function configurationHash() view returns (bytes32)",
  "function descriptor() view returns (Descriptor)",
]);

export interface FoundationActionRuntimeInputV1 {
  client: PublicClient; binding: FoundationDeploymentBinding; pool: FoundationPool; catalog: FoundationCatalogV1;
  /** Restore the complete immutable selection, in launch order, from the original artifact or launch calldata. */
  selections: readonly FoundationModuleSelection[];
  /** Application-owned resolved accounts/assets/components; a package cannot supply a resolver. */
  context?: OpenConfigContext;
}
export interface FoundationActionRuntimeV1 {
  checkpoint: FoundationCheckpoint; instances: readonly FoundationActionContextV1[];
  /** Original configuration assets are derived from base assets and the token's immutable pin metadata. */
  configurationContext: OpenConfigContext; moduleAssetPins: readonly FoundationAssetPinV1[];
  /** Digest of the completed RPC observations, not a substitute for source review or release authority. */
  sourceVerificationDigest: Hex; creatorFeeBps: number; compositionHash: Hex;
}

const sameAddress = (a: Address, b: Address) => getAddress(a) === getAddress(b);
const sameHex = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
function snapshot<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function jsonObservation(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonObservation);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonObservation(item)]));
  return value;
}
function runtimeEnvironment(catalog: FoundationCatalogV1, context?: OpenConfigContext) {
  return { catalog, chainId: FOUNDATION_CHAIN_ID, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, context };
}
function assertOriginalComposition(input: FoundationActionRuntimeInputV1, creatorFeeBps: number) {
  const composition = composeFoundationUiSelectionsV1({ ...runtimeEnvironment(input.catalog, input.context), selections: input.selections, creatorFeeBps });
  foundationRequire(composition.ok, "FOUNDATION_ACTION_COMPOSITION_INVALID", composition.diagnostics[0]?.message ?? "Restore the original admitted module selections.");
  return composition;
}
async function codeHash(client: PublicClient, address: Address, checkpoint: FoundationCheckpoint): Promise<Hex> {
  const code = await client.getCode({ address, blockNumber: checkpoint.blockNumber });
  foundationRequire(code && code !== "0x", "FOUNDATION_ACTION_RUNTIME_MISSING", `No contract runtime exists at ${address}.`);
  return keccak256(code);
}

function originalAssetContext(input: FoundationActionRuntimeInputV1, creator: Address, quoteDecimals: number,
  pins: readonly FoundationAssetPinV1[]): OpenConfigContext {
  const assets: NonNullable<OpenConfigContext["assets"]> = {
    token: { chainId: FOUNDATION_CHAIN_ID, address: input.pool.token, decimals: 18 },
    quote: { chainId: FOUNDATION_CHAIN_ID, address: input.pool.quote, decimals: quoteDecimals },
    ...Object.fromEntries(pins.map(([address, decimals]) => [`erc20:${address.toLowerCase()}`, { chainId: FOUNDATION_CHAIN_ID, address, decimals }])),
  };
  for (const [key, claimed] of Object.entries(input.context?.assets ?? {})) {
    const address = moduleAddress(claimed.address, `foundation.assets.${key}`);
    const actual = Object.values(assets).find(asset => sameAddress(asset.address, address));
    foundationRequire(actual && String(claimed.chainId) === String(FOUNDATION_CHAIN_ID) && claimed.decimals === actual.decimals
      && (!Object.hasOwn(assets, key) || sameAddress(assets[key].address, address)),
    "FOUNDATION_ACTION_ASSET_CONTEXT", "Asset aliases must match the pool's actual base assets or immutable additional-asset metadata.");
    assets[key] = { ...actual };
  }
  return { ...input.context, roles: { ...input.context?.roles, creator }, assets };
}

/** Read every installed module at one current checkpoint before exposing a bound management context. */
export async function readFoundationActionRuntimeV1(raw: FoundationActionRuntimeInputV1): Promise<FoundationActionRuntimeV1> {
  assertBoundFoundationCatalogV1(raw.catalog);
  const input = { ...raw, binding: snapshot(raw.binding), pool: snapshot(raw.pool), selections: nativeJson(raw.selections) as FoundationModuleSelection[],
    context: raw.context === undefined ? undefined : nativeJson(raw.context) as OpenConfigContext };
  foundationRequire(Array.isArray(input.selections) && input.selections.length <= 8, "FOUNDATION_MODULE_LIMIT", "Restore at most eight original module selections.");
  const { client, binding, pool } = input, checkpoint = await assertFoundationInfrastructure(client, binding);
  const provenance = await assertFoundationPool(client, binding, pool, checkpoint.blockNumber);
  const [moduleAssetPins, quote, metadata] = await Promise.all([
    readFoundationPoolAssetPins(client, pool, checkpoint), readFoundationQuote(client, pool.quote, undefined, checkpoint.blockNumber),
    client.readContract({ address: pool.token, abi: foundationTokenAbi, functionName: "metadata", blockNumber: checkpoint.blockNumber }),
  ]);
  const modulePackageIds = readFoundationModulePackages(metadata[3], input.selections.length);
  foundationRequire(modulePackageIds === undefined ? input.selections.length === 0
    : input.selections.every((selection, index) => modulePackageIds[index] === moduleHash(selection.id, "foundation.packageId")),
  "FOUNDATION_ACTION_PACKAGE_IDENTITIES", "The original ordered source package identities must match the token's immutable metadata.");
  const configurationContext = originalAssetContext(input, provenance.creator, quote.decimals, moduleAssetPins);
  input.context = configurationContext;
  const composition = assertOriginalComposition(input, provenance.creatorFeeBps);
  const [count, compositionHash, hostCodeHash] = await Promise.all([
    client.readContract({ address: pool.hook, abi: foundationActionRuntimeAbiV1, functionName: "moduleCount", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationActionRuntimeAbiV1, functionName: "compositionHash", blockNumber: checkpoint.blockNumber }),
    codeHash(client, pool.hook, checkpoint),
  ]);
  foundationRequire(count <= 8n && count === BigInt(composition.modules.length) && sameHex(compositionHash, composition.compositionHash),
    "FOUNDATION_ACTION_COMPOSITION_MISMATCH", "The original selections do not match this registered pool's immutable composition.");
  const observed = await Promise.all(composition.modules.map(async (selected, moduleIndex) => {
    const installedModule = await client.readContract({ address: pool.hook, abi: foundationActionRuntimeAbiV1, functionName: "moduleAt", args: [BigInt(moduleIndex)], blockNumber: checkpoint.blockNumber });
    moduleAddress(installedModule.instance, "foundation.module.instance");
    const [observedCodeHash, factoryCodeHash, moduleContext, configurationHash, descriptor] = await Promise.all([
      codeHash(client, installedModule.instance, checkpoint), codeHash(client, selected.factory, checkpoint),
      client.readContract({ address: installedModule.instance, abi: foundationActionRuntimeAbiV1, functionName: "context", blockNumber: checkpoint.blockNumber }),
      client.readContract({ address: installedModule.instance, abi: foundationActionRuntimeAbiV1, functionName: "configurationHash", blockNumber: checkpoint.blockNumber }),
      client.readContract({ address: installedModule.instance, abi: foundationActionRuntimeAbiV1, functionName: "descriptor", blockNumber: checkpoint.blockNumber }),
    ]);
    foundationRequire(sameHex(factoryCodeHash, selected.factoryCodeHash) && sameHex(observedCodeHash, selected.moduleCodeHash)
      && sameHex(installedModule.codeHash, selected.moduleCodeHash) && sameHex(configurationHash, installedModule.configurationHash)
      && sameHex(configurationHash, keccak256(selected.configuration))
      && sameHex(hashFoundationModuleDescriptorV1(descriptor), selected.descriptorHash)
      && sameHex(hashFoundationModuleDescriptorV1(installedModule.descriptor), selected.descriptorHash),
    "FOUNDATION_ACTION_SOURCE_MISMATCH", "The installed module, factory, configuration or descriptor differs from the admitted source binding.");
    const expected = { host: pool.hook, token: pool.token, quote: pool.quote, creator: provenance.creator, ledger: provenance.record.ledger };
    for (const field of ["host", "token", "quote", "creator", "ledger"] as const) foundationRequire(sameAddress(moduleContext[field], expected[field]),
      "FOUNDATION_ACTION_CONTEXT_MISMATCH", "A module is bound to another host, asset, ledger or creator.");
    foundationRequire(sameHex(moduleContext.poolId, pool.poolId), "FOUNDATION_ACTION_CONTEXT_MISMATCH", "A module is bound to another pool.");
    return { moduleIndex, module: installedModule, moduleContext, observedCodeHash, factoryCodeHash };
  }));
  foundationRequire(new Set(observed.map(item => item.module.instance.toLowerCase())).size === observed.length,
    "FOUNDATION_ACTION_INSTANCE_DUPLICATE", "The host repeats a module instance.");
  const endBlock = await client.getBlock({ blockNumber: checkpoint.blockNumber });
  foundationRequire(endBlock.hash === checkpoint.blockHash, "FOUNDATION_ACTION_CHECKPOINT_CHANGED", "Chain state changed while reading the module composition. Refresh it.");
  const sourceVerificationDigest = foundationDataDigest("programmable.module-foundation.action-rpc-observations.v1", jsonObservation({
    chainId: FOUNDATION_CHAIN_ID, binding, checkpoint, pool, registeredLaunch: provenance.record, creator: provenance.creator,
    creatorFeeBps: provenance.creatorFeeBps, hostCodeHash, compositionHash, modules: observed, moduleAssetPins, configurationContext, quote,
    modulePackageIds: modulePackageIds ?? [], sourceMetadataHash: keccak256(metadata[3]),
  }));
  const instances = observed.map(item => {
    const entry = resolveFoundationCatalogEntryV1(input.catalog, moduleHash(input.selections[item.moduleIndex].id, "foundation.packageId"));
    return bindFoundationActionContextV1({ ...runtimeEnvironment(input.catalog, input.context), selections: input.selections, readback: {
      chainId: FOUNDATION_CHAIN_ID, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: entry.release!.releaseDigest,
      sourceVerificationDigest, host: pool.hook, token: pool.token, quote: pool.quote, poolId: pool.poolId,
      creator: provenance.creator, ledger: provenance.record.ledger, creatorFeeBps: provenance.creatorFeeBps, compositionHash,
      blockNumber: checkpoint.blockNumber.toString(), blockHash: checkpoint.blockHash, blockTimestamp: Number(checkpoint.timestamp),
      moduleIndex: item.moduleIndex, moduleCount: Number(count), module: { ...item.module, observedCodeHash: item.observedCodeHash },
      moduleContext: item.moduleContext,
    } });
  });
  return freeze({ checkpoint, instances, sourceVerificationDigest, creatorFeeBps: provenance.creatorFeeBps, compositionHash, configurationContext, moduleAssetPins });
}

/** Executed only by application code. A source role remains subject to the module's own authorization in simulation. */
export type FoundationActionRoleResolverV1 = (input: {
  client: PublicClient; checkpoint: FoundationCheckpoint; instance: FoundationActionContextV1; account: Address; actionId: string; role: string;
}) => Promise<FoundationActionRoleGrantV1 | null>;
export interface FoundationActionWalletMinimumV1 { token: Address; minimumDelta: bigint }
export interface FoundationPrepareModuleActionInputV1 extends FoundationActionRuntimeInputV1 {
  account: Address; moduleIndex: number; selection: FoundationActionSelectionV1;
  /** Nonnegative raw ERC20 gains. Token and quote are always protected; at most four assets in total. */
  minimumWalletDeltas?: readonly FoundationActionWalletMinimumV1[];
  resolveRole?: FoundationActionRoleResolverV1;
}
type SequenceSimulation = Awaited<ReturnType<typeof simulateFoundationSequence>>;
export interface FoundationPreparedModuleActionV1 {
  kind: "module-action"; sourceKind: "module-foundation-v1"; simulation: "rpc-sequence";
  account: Address; binding: FoundationDeploymentBinding; pool: FoundationPool; moduleIndex: number;
  selections: readonly FoundationModuleSelection[]; selection: FoundationActionSelectionV1; configurationContext: OpenConfigContext;
  moduleAssetPins: readonly FoundationAssetPinV1[]; assets: readonly FoundationResolvedAssetV1[];
  intent: FoundationActionIntentV1; checkpoint: FoundationCheckpoint; sourceVerificationDigest: Hex; expiresAt: bigint;
  steps: SequenceSimulation["steps"]; balances: SequenceSimulation["balances"]; balanceChecks: readonly FoundationBalanceCheck[];
}

function walletChecks(pool: FoundationPool, account: Address, minima: readonly FoundationActionWalletMinimumV1[],
  pins: readonly FoundationAssetPinV1[] = []): FoundationBalanceCheck[] {
  foundationRequire(Array.isArray(minima) && minima.length <= 4, "FOUNDATION_ACTION_BALANCE_LIMIT", "At most four wallet assets can be checked in one action.");
  const checks = new Map<string, FoundationBalanceCheck>([pool.token, pool.quote, ...pins.map(pin => pin[0])].map(raw => {
    const token = moduleAddress(raw, "foundation.action.balanceToken"); return [token.toLowerCase(), { token, account, minimumDelta: 0n }];
  })), supplied = new Set<string>();
  for (const item of minima) {
    const token = moduleAddress(item.token, "foundation.action.minimumToken"), key = token.toLowerCase();
    foundationRequire(!supplied.has(key) && typeof item.minimumDelta === "bigint" && item.minimumDelta >= 0n && item.minimumDelta < 1n << 256n,
      "FOUNDATION_ACTION_BALANCE_MINIMUM", "Wallet minima must name each asset once and use nonnegative uint256 raw amounts.");
    supplied.add(key); checks.set(key, { token, account, minimumDelta: item.minimumDelta });
  }
  foundationRequire(checks.size <= 4, "FOUNDATION_ACTION_BALANCE_LIMIT", "Token, quote and additional wallet checks exceed the four-asset simulation limit.");
  return [...checks.values()];
}

/** Builds one nonpayable host action, then measures the caller's actual ERC20 balances in its RPC simulation. */
export async function prepareFoundationModuleActionV1(raw: FoundationPrepareModuleActionInputV1): Promise<FoundationPreparedModuleActionV1> {
  const input = { ...raw, binding: snapshot(raw.binding), pool: snapshot(raw.pool), selections: snapshot(raw.selections),
    selection: snapshot(raw.selection), context: snapshot(raw.context ?? {}), minimumWalletDeltas: snapshot(raw.minimumWalletDeltas ?? []) };
  const account = moduleAddress(input.account, "foundation.action.account"), moduleIndex = moduleInteger(input.moduleIndex, "foundation.action.moduleIndex", 7);
  walletChecks(input.pool, account, input.minimumWalletDeltas);
  const runtime = await readFoundationActionRuntimeV1(input);
  const instance = runtime.instances[moduleIndex];
  foundationRequire(instance, "FOUNDATION_ACTION_MODULE_MISSING", "This pool has no module at the selected position.");
  const entry = resolveFoundationCatalogEntryV1(input.catalog, instance.packageId);
  foundationRequire(input.selection.id === entry.manifest.packageId && input.selection.version === entry.manifest.sourceDescriptor.version
    && input.selection.digest === entry.manifestHash, "FOUNDATION_ACTION_SELECTION_STALE", "This action selection does not match the bound source version.");
  const action = entry.manifest.sourceDescriptor.management.actions.find(item => item.id === input.selection.actionId);
  foundationRequire(action, "FOUNDATION_ACTION_UNAVAILABLE", "This source version has no such action.");
  let roleGrants: FoundationActionRoleGrantV1[] = [];
  if (action.role !== "public" && action.role !== "creator" && input.resolveRole) {
    const grant = await input.resolveRole({ client: input.client, checkpoint: runtime.checkpoint, instance, account, actionId: action.id, role: action.role });
    if (grant) roleGrants = [nativeJson(grant) as unknown as FoundationActionRoleGrantV1];
  }
  const actionAssets = await resolveFoundationAssetFieldsV1({ client: input.client, schema: action.inputs, configuration: input.selection.configuration,
    context: runtime.configurationContext, checkpoint: runtime.checkpoint });
  const minimumAssets = await resolveFoundationAssetsV1({ client: input.client, addresses: input.minimumWalletDeltas.map(item => item.token),
    context: actionAssets.context, checkpoint: runtime.checkpoint });
  const moduleAssetPins = mergeFoundationAssetPinsV1(runtime.moduleAssetPins, actionAssets.pins, minimumAssets.pins);
  const checks = walletChecks(input.pool, account, input.minimumWalletDeltas, moduleAssetPins);
  const [pinnedAssets, token, quote] = await Promise.all([
    refreshFoundationAssetsV1({ client: input.client, pins: moduleAssetPins, context: minimumAssets.context, checkpoint: runtime.checkpoint }),
    readFoundationQuote(input.client, input.pool.token, undefined, runtime.checkpoint.blockNumber),
    readFoundationQuote(input.client, input.pool.quote, undefined, runtime.checkpoint.blockNumber),
  ]);
  foundationRequire(token.decimals === 18 && quote.decimals === runtime.configurationContext.assets!.quote.decimals,
    "FOUNDATION_ACTION_ASSET_METADATA", "The pool's current asset metadata differs from its verified source context.");
  const assets: FoundationResolvedAssetV1[] = [token, quote].map(asset => ({ chainId: FOUNDATION_CHAIN_ID, address: asset.address,
    decimals: asset.decimals, runtimeCodeHash: asset.codeHash, name: asset.name, symbol: asset.symbol }));
  assets.push(...pinnedAssets.assets);
  const intent = prepareFoundationActionIntentV1({ catalog: input.catalog, instance, selection: input.selection, account,
    context: pinnedAssets.context, roleGrants });
  const step: FoundationPreparedStep = { kind: "module-action", label: intent.label, transaction: intent.transaction, gasUsed: 0n,
    effect: action.description };
  const simulation = await simulateFoundationSequence(input.client, [step], runtime.checkpoint, checks);
  foundationRequire(simulation.results[0].data === "0x", "FOUNDATION_ACTION_RESPONSE_INVALID", "The hook action returned data outside its reviewed ABI.");
  const explicit = new Set(input.minimumWalletDeltas.map(item => item.token.toLowerCase()));
  const balanceChecks = checks.map((check, i) => ({ ...check,
    minimumDelta: explicit.has(check.token.toLowerCase()) ? check.minimumDelta! : simulation.balances[i].delta,
  }));
  const expiresAt = BigInt(intent.expiresAt);
  foundationRequire(expiresAt > BigInt(Math.floor(Date.now() / 1000)), "FOUNDATION_ACTION_PREPARATION_EXPIRED", "Action preparation expired during simulation. Prepare again.");
  return freeze({ kind: "module-action", sourceKind: "module-foundation-v1", simulation: "rpc-sequence", account,
    binding: input.binding, pool: input.pool, moduleIndex, selections: input.selections, selection: input.selection,
    configurationContext: runtime.configurationContext, moduleAssetPins, assets,
    intent, checkpoint: runtime.checkpoint, sourceVerificationDigest: runtime.sourceVerificationDigest, expiresAt,
    steps: simulation.steps, balances: simulation.balances, balanceChecks });
}

/** The wallet owner must first require its own private prepared-sequence seal, then call this before every send. */
export async function revalidateFoundationModuleActionV1(prepared: FoundationPreparedModuleActionV1, input: {
  client: PublicClient; catalog: FoundationCatalogV1; binding: FoundationDeploymentBinding; account: Address; resolveRole?: FoundationActionRoleResolverV1;
}): Promise<FoundationPreparedModuleActionV1> {
  foundationRequire(prepared.kind === "module-action" && prepared.simulation === "rpc-sequence" && prepared.steps.length === 1
    && prepared.steps[0].kind === "module-action" && prepared.expiresAt > BigInt(Math.floor(Date.now() / 1000))
    && sameAddress(prepared.account, input.account), "FOUNDATION_ACTION_REVIEW_EXPIRED", "The action review expired or belongs to another connected wallet.");
  foundationRequire(foundationDataDigest("programmable.module-foundation.deployment-binding.v1", jsonObservation(prepared.binding))
    === foundationDataDigest("programmable.module-foundation.deployment-binding.v1", jsonObservation(input.binding)),
  "FOUNDATION_ACTION_RELEASE_CHANGED", "The foundation deployment binding changed after review.");
  const minimumWalletDeltas = prepared.balanceChecks.map(check => {
    foundationRequire(sameAddress(check.account, input.account) && check.minimumDelta !== undefined && check.delta === undefined && !check.newToken,
      "FOUNDATION_ACTION_BALANCE_MINIMUM", "The reviewed action contains an invalid caller balance check.");
    return { token: check.token, minimumDelta: check.minimumDelta };
  });
  const reviewedAssetDigest = hashFoundationAssetPinsV1(prepared.moduleAssetPins);
  if (prepared.moduleAssetPins.length) await refreshFoundationAssetsV1({ client: input.client, pins: prepared.moduleAssetPins });
  const fresh = await prepareFoundationModuleActionV1({ ...input, pool: prepared.pool, selections: prepared.selections,
    context: prepared.configurationContext, moduleIndex: prepared.moduleIndex, selection: prepared.selection, minimumWalletDeltas });
  foundationRequire(hashFoundationAssetPinsV1(fresh.moduleAssetPins) === reviewedAssetDigest, "FOUNDATION_ACTION_ASSET_PINS_CHANGED",
    "The action's asset identities or metadata changed after review. Prepare the action again.");
  const original = prepared.steps[0].transaction, actual = fresh.steps[0].transaction;
  foundationRequire(sameAddress(actual.from, original.from) && sameAddress(actual.to, original.to) && sameHex(actual.data, original.data)
    && actual.value === 0n && original.value === 0n && sameAddress(fresh.intent.moduleInstance, prepared.intent.moduleInstance)
    && fresh.intent.packageId === prepared.intent.packageId && fresh.intent.manifestHash === prepared.intent.manifestHash
    && fresh.intent.actionId === prepared.intent.actionId && fresh.intent.role === prepared.intent.role,
  "FOUNDATION_ACTION_REVIEW_CHANGED", "The prepared action's caller, source, target or bytes changed. Review it again.");
  return fresh;
}

function parameter(arg: { type: string; name?: string; components?: readonly ModuleEngineConfigurationComponent[] }): AbiParameter {
  return { type: arg.type, ...(arg.name === undefined ? {} : { name: arg.name }),
    ...(arg.components ? { components: arg.components.map(parameter) } : {}) } as AbiParameter;
}
function decodeConfiguration(schema: OpenConfigSchema, mapping: readonly ModuleEngineConfigurationArgument[], data: Hex,
  context: OpenConfigContext): OpenConfigValue {
  const decoded = decodeAbiParameters(mapping.map(parameter), data);
  function restore(node: OpenConfigSchema, type: string, value: unknown, components?: readonly ModuleEngineConfigurationComponent[]): OpenConfigValue {
    // The final byte-for-byte re-encoding proves fixed source values; they are never replaced by a decoder's guesses.
    if (node.binding?.mode === "fixed") return nativeJson(node.binding.value) as OpenConfigValue;
    const array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) {
      foundationRequire(node.type === "array" && Array.isArray(value), "FOUNDATION_CONFIGURATION_DECODE", "Configuration array differs from the admitted schema.");
      return value.map(item => restore(node.items, array[1], item, components));
    }
    if (type === "tuple") {
      foundationRequire(node.type === "record" && components && value && typeof value === "object" && !Array.isArray(value),
        "FOUNDATION_CONFIGURATION_DECODE", "Configuration tuple differs from the admitted schema.");
      return Object.fromEntries(components.map(item => [item.name, restore(node.fields[item.name], item.type, (value as Record<string, unknown>)[item.name], item.components)]));
    }
    if (/^uint(?:[0-9]+)?$/.test(type) || type === "int24") return String(value);
    if (type === "address") {
      const address = moduleAddress(value, "foundation.configuration.address", true);
      if (node.type === "account" || node.type === "component") return { address };
      if (node.type === "asset") {
        return { asset: foundationAssetForAddressV1(address, context, "foundation.configuration.asset").key };
      }
      return address;
    }
    return nativeJson(value) as OpenConfigValue;
  }
  let value: OpenConfigValue = {};
  mapping.forEach((arg, index) => {
    let node = schema;
    for (const key of arg.path) {
      foundationRequire(node.type === "record" && Object.hasOwn(node.fields, key), "FOUNDATION_CONFIGURATION_DECODE", "Configuration mapping has an unsupported source path.");
      node = node.fields[key];
    }
    const restored = restore(node, arg.type, decoded[index], arg.components);
    if (arg.path.length === 0) { value = restored; return; }
    let parent = value as Record<string, OpenConfigValue>;
    for (const key of arg.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key)) parent[key] = {};
      parent = parent[key] as Record<string, OpenConfigValue>;
    }
    parent[arg.path.at(-1)!] = restored;
  });
  return value;
}

export interface FoundationDecodedLaunchSelectionsV1 {
  selections: readonly FoundationModuleSelection[]; creatorFeeBps: number; quote: Address; quoteDecimals: number;
  compositionHash: Hex; calldataHash: Hex; transactionVerified: false;
}
/** Restore exact admitted version/digest/configuration from calldata; the caller must separately establish transaction provenance. */
export function decodeFoundationLaunchSelectionsV1(input: {
  catalog: FoundationCatalogV1; calldata: Hex; context?: OpenConfigContext; packageIds?: readonly Hex[];
}): FoundationDecodedLaunchSelectionsV1 {
  assertBoundFoundationCatalogV1(input.catalog);
  foundationRequire(/^0x(?:[0-9a-fA-F]{2})+$/.test(input.calldata) && input.calldata.length <= 2_097_154,
    "FOUNDATION_LAUNCH_CALLDATA_LIMIT", "Restore bounded canonical launch calldata.");
  const decoded = decodeFunctionData({ abi: foundationFactoryNativeAbi, data: input.calldata });
  foundationRequire((decoded.functionName === "launch" || decoded.functionName === "launchWithEth"), "FOUNDATION_LAUNCH_CALLDATA", "The transaction does not call this foundation factory's launch entrypoint.");
  const parameters = decoded.args[0];
  const canonical = decoded.functionName === "launchWithEth"
    ? encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launchWithEth", args: [parameters, decoded.args[1]] })
    : encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launch", args: [parameters] });
  foundationRequire(sameHex(canonical, input.calldata),
    "FOUNDATION_LAUNCH_CALLDATA_NONCANONICAL", "The supplied launch bytes are not canonical ABI calldata.");
  foundationRequire(parameters.modules.length <= 8 && (!input.packageIds || input.packageIds.length === parameters.modules.length),
    "FOUNDATION_MODULE_LIMIT", "Restore one package identity for each of at most eight original modules.");
  const context = input.context ?? {};
  const selections = parameters.modules.map((selected, index): FoundationModuleSelection => {
    const candidates = input.catalog.entries.filter(entry => entry.status === "available" && entry.release?.chainId === FOUNDATION_CHAIN_ID
      && entry.runtime.hostAdapterId === FOUNDATION_HOST_ADAPTER_ID_V1 && entry.release.hostAdapterId === FOUNDATION_HOST_ADAPTER_ID_V1
      && sameAddress(entry.release.factory, selected.factory) && sameHex(entry.release.factoryCodeHash, selected.factoryCodeHash)
      && sameHex(entry.release.moduleCodeHash, selected.moduleCodeHash) && sameHex(entry.runtime.descriptorHash, selected.descriptorHash)
      && (!input.packageIds || sameHex(entry.manifest.packageId, input.packageIds[index])));
    foundationRequire(candidates.length === 1, "FOUNDATION_LAUNCH_PACKAGE_BINDING", candidates.length > 1
      ? "Multiple admitted packages share these bytes. Restore the exact package identities from the original launch artifact."
      : "No currently admitted package matches the launch's exact factory, code and descriptor bindings.");
    const entry = candidates[0];
    foundationRequire(selected.configuration.length <= 32_770, "FOUNDATION_CONFIGURATION_LIMIT", "Original module configuration exceeds the host's byte limit.");
    const restored = decodeConfiguration(entry.manifest.sourceDescriptor.configuration, entry.runtime.configurationAbi, selected.configuration, context);
    const encoded = encodeFoundationConfigurationV1(entry.manifest, restored, context);
    foundationRequire(sameHex(encoded.configuration, selected.configuration), "FOUNDATION_CONFIGURATION_NONCANONICAL", "Original configuration does not re-encode exactly against the admitted source schema.");
    const configuration: FoundationConfiguration = {};
    for (const field of presentFoundationFieldsV1(entry.manifest.sourceDescriptor.configuration, encoded.value, context)) {
      foundationRequire(field.defaultValue !== undefined, "FOUNDATION_CONFIGURATION_FORM_RESTORE", "A required source value could not be restored from launch bytes.");
      configuration[field.key] = field.defaultValue;
    }
    if ((entry.runtime.descriptor.resources & 1) !== 0 && (entry.runtime.descriptor.phases & 4) !== 0) {
      configuration[FOUNDATION_CREATOR_SHARE_FIELD_V1] = `${Math.floor(selected.creatorShareBps / 100)}.${String(selected.creatorShareBps % 100).padStart(2, "0")}`;
    } else foundationRequire(selected.creatorShareBps === 0, "FOUNDATION_CREATOR_BUDGET_UNAUTHORIZED", "Original creator share exceeds this source's resource rights.");
    return { id: entry.manifest.packageId, version: entry.manifest.sourceDescriptor.version, digest: entry.manifestHash, configuration };
  });
  const composition = composeFoundationUiSelectionsV1({ ...runtimeEnvironment(input.catalog, context), selections, creatorFeeBps: parameters.creatorFeeBps });
  foundationRequire(composition.ok && sameHex(composition.compositionHash, hashFoundationCompositionV1(parameters.modules)),
    "FOUNDATION_ACTION_COMPOSITION_MISMATCH", composition.diagnostics[0]?.message ?? "The reconstructed UI selections do not match the launch bytes.");
  return freeze({ selections, creatorFeeBps: parameters.creatorFeeBps, quote: parameters.quote, quoteDecimals: parameters.quoteDecimals,
    compositionHash: composition.compositionHash, calldataHash: keccak256(input.calldata), transactionVerified: false });
}
