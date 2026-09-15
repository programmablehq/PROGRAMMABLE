import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  compileOpenConfig, type OpenConfigContext, type OpenConfigSchema, type OpenConfigValue,
} from "@/packages/classic-modules/src/open-config.mjs";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleHash, moduleInteger } from "@/lib/module-mode/release";
import type { FoundationCheckpoint } from "./client";
import { FOUNDATION_CHAIN_ID } from "./constants";
import { foundationDataDigest, foundationRequire } from "./manifest";
import { decodeFoundationFieldsV1, foundationAssetForAddressV1, presentFoundationFieldsV1 } from "./presentation";
import type { FoundationConfiguration } from "./ui-types";

/** Token + quote + two additional assets fit the V1 simulator's four balance checks. */
export const FOUNDATION_ADDITIONAL_ASSET_LIMIT_V1 = 2;
/** Chain 4663 is fixed by this adapter version. Order follows the first source-field occurrence. */
export type FoundationAssetPinV1 = readonly [address: Address, decimals: number, runtimeCodeHash: Hex];
export interface FoundationResolvedAssetV1 {
  chainId: typeof FOUNDATION_CHAIN_ID; address: Address; decimals: number; runtimeCodeHash: Hex; name: string; symbol: string;
}
export interface FoundationAssetResolutionV1 {
  checkpoint: FoundationCheckpoint; assets: readonly FoundationResolvedAssetV1[];
  pins: readonly FoundationAssetPinV1[]; pinsDigest: Hex; context: OpenConfigContext;
}
export interface FoundationResolveAssetsInputV1 {
  client: PublicClient; addresses: readonly Address[];
  /** App-verified base assets only, normally token and quote. Form data cannot populate this context. */
  context?: OpenConfigContext;
  /** Reuse the source/pool checkpoint so metadata and simulation refer to the same fresh block. */
  checkpoint?: FoundationCheckpoint;
}
const sameAddress = (a: Address, b: Address) => getAddress(a) === getAddress(b);
const own = (value: unknown, key: string): value is Record<string, unknown> => !!value && typeof value === "object" && Object.hasOwn(value, key);
const pointer = (path: readonly string[]) => path.length ? `/${path.join("/")}` : "$value";
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function addressKey(address: Address) { return `erc20:${address.toLowerCase()}`; }
function bounded(count: number) {
  foundationRequire(count <= FOUNDATION_ADDITIONAL_ASSET_LIMIT_V1, "FOUNDATION_ASSET_ADAPTER_LIMIT",
    "This host adapter supports two additional ERC20 assets alongside the coin and quote. More assets need a versioned adapter with broader balance protection.");
}

/** Shape validation only. The host must recover these tuples from verified immutable launch metadata. */
export function parseFoundationAssetPinsV1(raw: unknown): readonly FoundationAssetPinV1[] {
  const values = nativeJson(raw);
  foundationRequire(Array.isArray(values), "FOUNDATION_ASSET_PINS_SHAPE", "Restore the original asset metadata tuples.");
  bounded(values.length);
  const pins = values.map((value, index): FoundationAssetPinV1 => {
    foundationRequire(Array.isArray(value) && value.length === 3, "FOUNDATION_ASSET_PINS_SHAPE", "Each asset tuple must bind address, decimals and runtime code hash.");
    return [moduleAddress(value[0], `foundation.assets.${index}.address`).toLowerCase() as Address,
      moduleInteger(value[1], `foundation.assets.${index}.decimals`, 36), moduleHash(value[2], `foundation.assets.${index}.runtimeCodeHash`).toLowerCase() as Hex];
  });
  foundationRequire(new Set(pins.map(pin => pin[0])).size === pins.length, "FOUNDATION_ASSET_PIN_DUPLICATE", "Bind each additional asset once in the immutable metadata.");
  return freeze(pins);
}

export function hashFoundationAssetPinsV1(pins: readonly FoundationAssetPinV1[]): Hex {
  return foundationDataDigest("programmable.module-foundation.assets.v1", { chainId: FOUNDATION_CHAIN_ID, pins: parseFoundationAssetPinsV1(pins) });
}

/** Deduplicates repeated source references while retaining the original order and exact metadata. */
export function mergeFoundationAssetPinsV1(...tables: readonly (readonly FoundationAssetPinV1[])[]): readonly FoundationAssetPinV1[] {
  const combined: FoundationAssetPinV1[] = [];
  for (const table of tables) for (const pin of parseFoundationAssetPinsV1(table)) {
    const previous = combined.find(item => item[0] === pin[0]);
    foundationRequire(!previous || (previous[1] === pin[1] && previous[2] === pin[2]), "FOUNDATION_ASSET_PIN_MISMATCH",
      "The same asset has conflicting immutable metadata.");
    if (!previous) combined.push(pin);
  }
  return parseFoundationAssetPinsV1(combined);
}

function checkedContext(raw: OpenConfigContext = {}): OpenConfigContext {
  const context = nativeJson(raw) as OpenConfigContext;
  compileOpenConfig({ type: "record", fields: {}, required: [] }, {}, context);
  for (const asset of Object.values(context.assets ?? {})) foundationAssetForAddressV1(asset.address, context);
  return context;
}

async function resolve(input: FoundationResolveAssetsInputV1, expected?: readonly FoundationAssetPinV1[]): Promise<FoundationAssetResolutionV1> {
  const context = checkedContext(input.context), pins = expected === undefined ? undefined : parseFoundationAssetPinsV1(expected);
  foundationRequire(Array.isArray(input.addresses) && input.addresses.length <= 256, "FOUNDATION_ASSET_REQUEST_LIMIT", "The asset request exceeds this schema adapter's input limit.");
  const addresses = [...new Set(input.addresses.map(address => moduleAddress(address, "foundation.asset.address").toLowerCase() as Address))];
  const additional = addresses.filter(address => pins?.some(pin => sameAddress(pin[0], address))
    || !Object.values(context.assets ?? {}).some(asset => sameAddress(asset.address, address)));
  bounded(additional.length);
  if (pins) foundationRequire(pins.length === additional.length && pins.every((pin, index) => sameAddress(pin[0], additional[index])),
    "FOUNDATION_ASSET_PIN_MISMATCH", "Restore the original ordered asset identities before refreshing metadata.");
  foundationRequire(await input.client.getChainId() === FOUNDATION_CHAIN_ID, "FOUNDATION_ASSET_CHAIN_MISMATCH", "Resolve module assets on Robinhood Chain (4663).");
  const block = await input.client.getBlock(input.checkpoint ? { blockNumber: input.checkpoint.blockNumber } : { blockTag: "latest" });
  foundationRequire(block.number !== null && block.hash && Math.abs(Date.now() / 1000 - Number(block.timestamp)) <= 120
    && (!input.checkpoint || (block.number === input.checkpoint.blockNumber && block.hash === input.checkpoint.blockHash && block.timestamp === input.checkpoint.timestamp)),
  "FOUNDATION_ASSET_CHECKPOINT_INVALID", "Refresh the current chain checkpoint before resolving asset metadata.");
  const checkpoint = { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp };
  // Metadata parsing also imports this file. Load the RPC reader only at the actual read boundary.
  const { readFoundationQuote } = await import("./client");
  const assets = await Promise.all(additional.map(async (address): Promise<FoundationResolvedAssetV1> => {
    const observed = await readFoundationQuote(input.client, address, undefined, checkpoint.blockNumber);
    const previous = pins?.find(pin => sameAddress(pin[0], address));
    foundationRequire(!previous || (previous[1] === observed.decimals && previous[2] === observed.codeHash.toLowerCase()),
      "FOUNDATION_ASSET_PIN_MISMATCH", "This asset's decimals or runtime code changed from the immutable launch metadata.");
    for (const existing of Object.values(context.assets ?? {}).filter(asset => sameAddress(asset.address, address))) {
      foundationRequire(String(existing.chainId) === String(FOUNDATION_CHAIN_ID) && existing.decimals === observed.decimals,
        "FOUNDATION_ASSET_METADATA_MISMATCH", "The asset context differs from the current ERC20 metadata.");
    }
    return { chainId: FOUNDATION_CHAIN_ID, address: address.toLowerCase() as Address, decimals: observed.decimals,
      runtimeCodeHash: observed.codeHash.toLowerCase() as Hex, name: observed.name, symbol: observed.symbol };
  }));
  const endBlock = await input.client.getBlock({ blockNumber: checkpoint.blockNumber });
  foundationRequire(endBlock.hash === checkpoint.blockHash, "FOUNDATION_ASSET_CHECKPOINT_CHANGED", "Chain state changed while resolving assets. Refresh the asset metadata.");
  const merged = { ...context, assets: { ...context.assets } };
  for (const asset of assets) {
    if (!Object.values(merged.assets).some(existing => sameAddress(existing.address, asset.address))) {
      const key = addressKey(asset.address);
      foundationRequire(!Object.hasOwn(merged.assets, key), "FOUNDATION_ASSET_CONTEXT_CONFLICT", "The canonical asset reference is already bound to another address.");
      merged.assets[key] = { chainId: FOUNDATION_CHAIN_ID, address: asset.address, decimals: asset.decimals };
    }
  }
  const resolvedPins = parseFoundationAssetPinsV1(assets.map(asset => [asset.address, asset.decimals, asset.runtimeCodeHash]));
  return freeze({ checkpoint, assets, pins: resolvedPins, pinsDigest: hashFoundationAssetPinsV1(resolvedPins), context: checkedContext(merged) });
}

/** Read-only standard ERC20 resolution. It creates neither transfer permission nor wallet transactions. */
export function resolveFoundationAssetsV1(input: FoundationResolveAssetsInputV1): Promise<FoundationAssetResolutionV1> {
  return resolve(input);
}

/** Every pinned address is read again, even if a previous context already contains its alias. */
export function refreshFoundationAssetsV1(input: Omit<FoundationResolveAssetsInputV1, "addresses"> & { pins: readonly FoundationAssetPinV1[] }): Promise<FoundationAssetResolutionV1> {
  const pins = parseFoundationAssetPinsV1(input.pins);
  return resolve({ ...input, addresses: pins.map(pin => pin[0]) }, pins);
}

export interface FoundationAssetFieldsInputV1 {
  schema: OpenConfigSchema; configuration: FoundationConfiguration; defaults?: unknown; context?: OpenConfigContext;
}

/** Extracts addresses from actual reviewed field types, including bounded arrays, variants and fixed source values. */
export function foundationAssetAddressesForFieldsV1(input: FoundationAssetFieldsInputV1 & {
  /** Collection only: source references whose actual addresses do not exist until launch prediction. */
  deferredAssetKeys?: readonly string[];
}): readonly Address[] {
  const context = checkedContext(input.context), raw = nativeJson(input.configuration) as FoundationConfiguration;
  const fields = presentFoundationFieldsV1(input.schema, input.defaults, context), keys = new Set(fields.map(field => field.key));
  foundationRequire(raw && typeof raw === "object" && !Array.isArray(raw), "FOUNDATION_FORM_SHAPE", "Module configuration must be a field-value record.");
  for (const [key, value] of Object.entries(raw)) foundationRequire(keys.has(key) && (typeof value === "string" || typeof value === "boolean"),
    "FOUNDATION_FORM_FIELD_UNKNOWN", "The form contains a field that is not editable in this source version.", key);
  const deferred = new Set(input.deferredAssetKeys ?? []);
  foundationRequire(deferred.size <= 256 && [...deferred].every(key => /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(key)),
    "FOUNDATION_ASSET_DEFERRED_KEY", "Deferred asset references must use bounded source reference names.");
  const addresses: Address[] = [];
  function valueOf(node: OpenConfigSchema, value: unknown) {
    return node.binding?.mode === "fixed" ? node.binding.value : value ?? (node.binding?.mode === "input" ? node.binding.default : undefined);
  }
  function visit(node: OpenConfigSchema, supplied: unknown, path: string) {
    const value = valueOf(node, supplied);
    if (value === undefined) return;
    if (node.type === "asset") {
      let address: unknown = value;
      const reference = typeof value === "string" ? value : own(value, "asset") && typeof value.asset === "string" ? value.asset : undefined;
      if (reference !== undefined && deferred.has(reference) && !Object.hasOwn(context.assets ?? {}, reference)) return;
      if (typeof value === "string" && context.assets && Object.hasOwn(context.assets, value)) address = context.assets[value].address;
      else if (own(value, "asset") && typeof value.asset === "string") address = context.assets?.[value.asset]?.address;
      else if (own(value, "address")) address = value.address;
      addresses.push(moduleAddress(address, path).toLowerCase() as Address);
    } else if (node.type === "record") {
      for (const [key, child] of Object.entries(node.fields)) visit(child, own(value, key) ? value[key] : undefined, `${path}/${key}`);
    } else if (node.type === "array") {
      foundationRequire(Array.isArray(value) && value.length <= node.maxItems, "FOUNDATION_FORM_JSON_LIMIT", "Enter a list within the source schema's item limit.", path);
      value.forEach((item, index) => visit(node.items, item, `${path}/${index}`));
    } else if (node.type === "variant") {
      foundationRequire(own(value, node.tag) && typeof value[node.tag] === "string" && Object.hasOwn(node.variants, value[node.tag] as string),
        "FOUNDATION_FORM_VARIANT", "Choose a variant declared by this source schema.", path);
      visit(node.variants[value[node.tag] as string], value, path);
    }
  }
  function form(node: OpenConfigSchema, fallback: unknown, path: string[]) {
    const value = valueOf(node, fallback);
    if (node.binding?.mode === "fixed") { visit(node, value, pointer(path)); return; }
    if (node.type === "record") {
      for (const [key, child] of Object.entries(node.fields)) form(child, own(value, key) ? value[key] : undefined, [...path, key]);
      return;
    }
    const key = pointer(path);
    let supplied: unknown = Object.hasOwn(raw, key) ? raw[key] : value;
    if (node.type === "asset" && supplied === "" && value !== undefined) supplied = value;
    if ((node.type === "array" || node.type === "variant") && Object.hasOwn(raw, key)) {
      foundationRequire(typeof supplied === "string" && supplied.length <= 131_072, "FOUNDATION_FORM_JSON_LIMIT", "Structured field data exceeds its input limit.", key);
      try { supplied = nativeJson(JSON.parse(supplied)); } catch { throw new Error(`Invalid JSON in ${key}.`); }
    }
    visit(node, supplied, key);
  }
  form(input.schema, input.defaults === undefined ? undefined : nativeJson(input.defaults), []);
  return freeze([...new Set(addresses)]);
}

/** Resolves the form, then checks all literal/fixed/reference metadata against current app-owned context. */
export async function resolveFoundationAssetFieldsV1(input: FoundationAssetFieldsInputV1 & { client: PublicClient; checkpoint?: FoundationCheckpoint }):
  Promise<FoundationAssetResolutionV1 & { value: OpenConfigValue }> {
  foundationRequire(!Object.hasOwn(input, "deferredAssetKeys"), "FOUNDATION_ASSET_CONTEXT_REQUIRED",
    "Final asset resolution requires the actual predicted addresses and complete verified context.");
  const addresses = foundationAssetAddressesForFieldsV1(input);
  const resolved = await resolveFoundationAssetsV1({ client: input.client, addresses, context: input.context, checkpoint: input.checkpoint });
  const value = decodeFoundationFieldsV1(input.schema, input.configuration, input.defaults, resolved.context);
  const compiled = compileOpenConfig(input.schema, value, resolved.context);
  for (const binding of compiled.bindings) if (binding.kind === "asset") {
    const { asset } = foundationAssetForAddressV1(binding.resolved.address, resolved.context, binding.path);
    foundationRequire(String(asset.chainId) === binding.resolved.chainId && asset.decimals === binding.resolved.decimals,
      "FOUNDATION_ASSET_METADATA_MISMATCH", "The source asset metadata differs from the verified metadata.", binding.path);
  }
  return freeze({ ...resolved, value: compiled.value });
}
