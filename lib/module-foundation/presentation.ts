import { encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import {
  assertOpenConfigSchema, type OpenConfigContext, type OpenConfigSchema, type OpenConfigValue,
} from "@/packages/classic-modules/src/open-config.mjs";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleHash, moduleInteger, moduleRecord } from "@/lib/module-mode/release";
import type {
  FoundationConfiguration, FoundationConfigurationField, FoundationModuleDescriptor, FoundationModuleSelection,
} from "./ui-types";
import {
  FOUNDATION_ZERO_HASH, encodeFoundationActionV1, foundationDataDigest, foundationDiagnostic,
  foundationRequire, hashFoundationModuleDescriptorV1, type FoundationDiagnosticV1, type FoundationModuleDescriptorV1,
} from "./manifest";
import {
  assertBoundFoundationCatalogV1, resolveFoundationCatalogEntryV1, type BoundFoundationCatalogEntryV1, type FoundationCatalogV1,
} from "./catalog";
import {
  composeFoundationModulesV1,
  type FoundationCompositionInputV1, type FoundationCompositionV1, type FoundationModuleChoiceV1,
} from "./composition";

export const FOUNDATION_CREATOR_SHARE_FIELD_V1 = "$creatorSharePercent" as const;
/** Final FoundationHookV1 ABI, confirmed against the source; there is no generic executeAction entrypoint. */
export const FOUNDATION_MANAGEMENT_ACTION_ABI_V1 = parseAbi(["function executeModuleAction(uint256 index, bytes data)"]);
export const FOUNDATION_ACTION_READBACK_MAX_AGE_SECONDS_V1 = 120;
type Environment = Pick<FoundationCompositionInputV1, "catalog" | "chainId" | "hostAdapterId" | "context" | "hostAdapters">;
const missing = Symbol("missing Foundation form value");
const pointer = (path: readonly string[]) => path.length ? `/${path.join("/")}` : "$value";
const equalAddress = (a: Address, b: Address) => getAddress(a) === getAddress(b);
const pretty = (key: string) => key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const hasOwn = (value: unknown, key: string): value is Record<string, unknown> => !!value && typeof value === "object" && Object.hasOwn(value, key);
function provided(node: OpenConfigSchema, value: unknown): unknown {
  if (node.binding?.mode === "fixed") return node.binding.value;
  if (value !== undefined) return value;
  return node.binding?.mode === "input" ? node.binding.default : undefined;
}
function addressDefault(node: OpenConfigSchema, value: unknown, context: OpenConfigContext): string | undefined {
  if (typeof value === "string") return value;
  if (hasOwn(value, "address") && typeof value.address === "string") return value.address;
  if (node.type === "account" && hasOwn(value, "role") && typeof value.role === "string") return context.roles?.[value.role];
  if (node.type === "component" && hasOwn(value, "component") && typeof value.component === "string") return context.components?.[value.component];
  return undefined;
}

/** Pure schema projection. Nested records become JSON-pointer keys; bounded compound values remain inert JSON text. */
export function presentFoundationFieldsV1(schema: OpenConfigSchema, defaults: unknown = undefined,
  context: OpenConfigContext = {}): readonly FoundationConfigurationField[] {
  assertOpenConfigSchema(schema);
  const checkedDefaults = defaults === undefined ? undefined : nativeJson(defaults), fields: FoundationConfigurationField[] = [];
  function visit(node: OpenConfigSchema, path: string[], fallback: unknown, required: boolean) {
    if (node.binding?.mode === "fixed") return;
    const value = provided(node, fallback);
    if (node.type === "record") {
      for (const [name, child] of Object.entries(node.fields)) visit(child, [...path, name], hasOwn(value, name) ? value[name] : undefined, required && node.required.includes(name));
      return;
    }
    const field: FoundationConfigurationField = {
      key: pointer(path), label: node.label ?? (path.length ? path.map(pretty).join(" / ") : "Value"),
      kind: "text", required: required && node.type !== "string", ...(node.help ? { description: node.help } : {}),
    };
    if (node.type === "uint") {
      field.kind = "integer";
      if (typeof value === "string" || typeof value === "number") field.defaultValue = String(value);
      field.description = [node.help, node.unit ? `Unit: ${node.unit}.` : undefined,
        node.max !== undefined ? `Range: ${node.min ?? 0} to ${node.max}.` : node.min !== undefined ? `Minimum: ${node.min}.` : undefined].filter(Boolean).join(" ");
    } else if (node.type === "bool") {
      field.kind = "boolean"; if (typeof value === "boolean") field.defaultValue = value;
    } else if (["address", "account", "component"].includes(node.type)) {
      field.kind = "address"; field.defaultValue = addressDefault(node, value, context);
    } else if (node.type === "asset") {
      const assets = Object.entries(context.assets ?? {});
      foundationRequire(assets.length > 0, "FOUNDATION_ASSET_CONTEXT_REQUIRED", "A verified asset list is needed for this field.", field.key);
      field.kind = "select"; field.options = assets.map(([name, asset]) => ({ value: name, label: `${pretty(name)} (${asset.address})` }));
      if (hasOwn(value, "asset") && typeof value.asset === "string") field.defaultValue = value.asset;
      else if (hasOwn(value, "address")) field.defaultValue = assets.find(([, asset]) => asset.address.toLowerCase() === String(value.address).toLowerCase()
        && String(asset.chainId) === String(value.chainId) && asset.decimals === value.decimals)?.[0];
    } else if (node.type === "array" || node.type === "variant") {
      field.description = [node.help, node.type === "array" ? `Enter a JSON list with ${node.minItems ?? 0} to ${node.maxItems} items.` : "Enter a JSON object using one of the declared variants."].filter(Boolean).join(" ");
      if (value !== undefined) field.defaultValue = JSON.stringify(value);
    } else if (typeof value === "string") field.defaultValue = value;
    else if (node.type === "bytes") field.defaultValue = "0x";
    fields.push(Object.fromEntries(Object.entries(field).filter(([, entry]) => entry !== undefined)) as unknown as FoundationConfigurationField);
  }
  visit(schema, [], checkedDefaults, true);
  return fields;
}

/** Decode only fields generated from the reviewed schema; the source compiler performs the final type/bounds checks. */
export function decodeFoundationFieldsV1(schema: OpenConfigSchema, input: FoundationConfiguration,
  defaults: unknown = undefined, context: OpenConfigContext = {}): OpenConfigValue {
  const raw = nativeJson(input);
  foundationRequire(raw && typeof raw === "object" && !Array.isArray(raw), "FOUNDATION_FORM_SHAPE", "Module configuration must be a field-value record.");
  const fields = presentFoundationFieldsV1(schema, defaults, context), keys = new Set(fields.map(field => field.key));
  for (const [key, value] of Object.entries(raw)) foundationRequire(keys.has(key) && (typeof value === "string" || typeof value === "boolean"),
    "FOUNDATION_FORM_FIELD_UNKNOWN", "The form contains a field that is not editable in this source version.", key);
  function decode(node: OpenConfigSchema, path: string[], fallback: unknown): unknown {
    if (node.binding?.mode === "fixed") return nativeJson(node.binding.value);
    const value = provided(node, fallback);
    if (node.type === "record") {
      const entries = Object.entries(node.fields).map(([name, child]) => [name, decode(child, [...path, name], hasOwn(value, name) ? value[name] : undefined)] as const);
      return Object.fromEntries(entries.filter(([, entry]) => entry !== missing));
    }
    const key = pointer(path), supplied = hasOwn(raw, key) ? raw[key] : undefined;
    if (supplied === undefined) return value === undefined ? missing : nativeJson(value);
    if (node.type === "account" || node.type === "component") return { address: supplied };
    if (node.type === "asset") {
      foundationRequire(typeof supplied === "string" && !!context.assets && Object.hasOwn(context.assets, supplied),
        "FOUNDATION_ASSET_CONTEXT_REQUIRED", "Choose an asset from the current verified list.", key);
      return { asset: supplied };
    }
    if (node.type === "array" || node.type === "variant") {
      foundationRequire(typeof supplied === "string" && supplied.length <= 131_072, "FOUNDATION_FORM_JSON_LIMIT", "Structured field data exceeds its input limit.", key);
      let parsed: unknown;
      try { parsed = nativeJson(JSON.parse(supplied)); } catch { throw new Error(`Invalid JSON in ${key}.`); }
      return parsed;
    }
    return supplied;
  }
  const result = decode(schema, [], defaults);
  foundationRequire(result !== missing, "FOUNDATION_FORM_VALUE_REQUIRED", "Complete the module configuration.");
  return result as OpenConfigValue;
}

function shareEnabled(entry: BoundFoundationCatalogEntryV1) { return (entry.runtime.descriptor.resources & 1) !== 0 && (entry.runtime.descriptor.phases & 4) !== 0; }
function assertSelection(catalog: FoundationCatalogV1, input: unknown): { entry: BoundFoundationCatalogEntryV1; selection: FoundationModuleSelection } {
  const r = moduleRecord(nativeJson(input), ["id", "version", "digest", "configuration"], "foundation.uiSelection");
  const entry = resolveFoundationCatalogEntryV1(catalog, moduleHash(r.id, "foundation.uiSelection.id"));
  foundationRequire(entry.manifest.sourceDescriptor.version === r.version && entry.manifestHash === r.digest,
    "FOUNDATION_UI_SELECTION_STALE", "The selected package version or manifest changed. Select its current catalog entry again.");
  foundationRequire(entry.status === "available", "FOUNDATION_UI_SELECTION_UNAVAILABLE", "This package has no current admitted catalog binding.");
  return { entry, selection: r as unknown as FoundationModuleSelection };
}
function choiceForUi(input: Environment, value: FoundationModuleSelection): FoundationModuleChoiceV1 {
  const { entry, selection } = assertSelection(input.catalog, value);
  const raw = nativeJson(selection.configuration);
  foundationRequire(raw && typeof raw === "object" && !Array.isArray(raw), "FOUNDATION_FORM_SHAPE", "Module configuration must be a field-value record.");
  const record = raw as Record<string, string | boolean>, hasShare = Object.hasOwn(record, FOUNDATION_CREATOR_SHARE_FIELD_V1);
  const percent = hasShare ? record[FOUNDATION_CREATOR_SHARE_FIELD_V1] : "0";
  foundationRequire(!hasShare || shareEnabled(entry), "FOUNDATION_CREATOR_BUDGET_UNAUTHORIZED", "This package cannot receive creator-fee proceeds.");
  foundationRequire(typeof percent === "string" && /^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/.test(percent),
    "FOUNDATION_CREATOR_SHARE_PERCENT", "Enter a creator-fee share from 0% through 100% with at most two decimal places.", FOUNDATION_CREATOR_SHARE_FIELD_V1);
  const [whole, fraction = ""] = percent.split("."), creatorShareBps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  foundationRequire(creatorShareBps <= 10_000, "FOUNDATION_CREATOR_SHARE_PERCENT", "The creator-fee share cannot exceed 100%.", FOUNDATION_CREATOR_SHARE_FIELD_V1);
  const configuration = decodeFoundationFieldsV1(entry.manifest.sourceDescriptor.configuration,
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== FOUNDATION_CREATOR_SHARE_FIELD_V1)), entry.runtime.defaults, input.context);
  return { packageId: entry.manifest.packageId, configuration, creatorShareBps };
}

export function composeFoundationUiSelectionsV1(input: Environment & { selections: readonly FoundationModuleSelection[]; creatorFeeBps: number }): FoundationCompositionV1 {
  try {
    assertBoundFoundationCatalogV1(input.catalog);
    foundationRequire(Array.isArray(input.selections) && input.selections.length <= 8, "FOUNDATION_MODULE_LIMIT", "Select at most eight modules.");
    const choices = (nativeJson(input.selections) as FoundationModuleSelection[]).map(selection => choiceForUi(input, selection));
    return composeFoundationModulesV1({ ...input, selections: choices });
  } catch (error) {
    const empty = composeFoundationModulesV1({ ...input, selections: [] });
    return { ok: false, modules: [], compositionHash: null, totals: { ...empty.totals, moduleCount: Array.isArray(input.selections) ? input.selections.length : 0 },
      diagnostics: [foundationDiagnostic(error)] };
  }
}

/** Safe display DTOs for the existing Module Mode picker; UI flags never replace preparation-time composition. */
export function presentFoundationCatalogV1(input: Environment): readonly FoundationModuleDescriptor[] {
  assertBoundFoundationCatalogV1(input.catalog);
  return input.catalog.entries.map(entry => {
    const errors: FoundationDiagnosticV1[] = [...entry.diagnostics]; let fields: readonly FoundationConfigurationField[] = [];
    try { fields = presentFoundationFieldsV1(entry.manifest.sourceDescriptor.configuration, entry.runtime.defaults, input.context); }
    catch (error) { errors.push(foundationDiagnostic(error)); }
    const sample = composeFoundationModulesV1({ ...input, creatorFeeBps: 0, selections: [{ packageId: entry.manifest.packageId, configuration: entry.runtime.defaults, creatorShareBps: 0 }] });
    // Missing form values and stateful value constraints are resolved when the user prepares their actual configuration.
    errors.push(...sample.diagnostics.filter(issue => !["FOUNDATION_INPUT_INVALID", "FOUNDATION_CONFIGURATION_CONSTRAINT", "FOUNDATION_CONFIGURATION_LIMIT"].includes(issue.code)));
    if (shareEnabled(entry)) fields = [...fields, { key: FOUNDATION_CREATOR_SHARE_FIELD_V1, label: "Share of creator fees (%)", kind: "decimal", required: true, defaultValue: "0",
      description: "Assign 0% to 100% of the creator fee to this module. The separate 0.3% platform fee is unchanged." }];
    const d = entry.runtime.descriptor;
    const conflictsWith = input.catalog.entries.filter(other => other.manifest.packageId !== entry.manifest.packageId && (other.runtime.descriptor.moduleId === d.moduleId
      || (d.exclusiveGroup !== FOUNDATION_ZERO_HASH && d.exclusiveGroup === other.runtime.descriptor.exclusiveGroup))).map(other => other.manifest.packageId);
    return { id: entry.manifest.packageId, version: entry.manifest.sourceDescriptor.version, digest: entry.manifestHash,
      name: entry.manifest.sourceDescriptor.name, description: entry.manifest.sourceDescriptor.management.summary,
      capabilities: entry.manifest.sourceDescriptor.requiresHost, fields, available: entry.status === "available" && errors.length === 0,
      ...(errors.length ? { unavailableReason: [...new Set(errors.map(issue => issue.message))].join(" ") } : {}),
      ...(conflictsWith.length ? { conflictsWith } : {}) };
  });
}

/** Trusted, same-block observations after canonical factory/pool verification by the caller's chain reader. */
export interface FoundationActionReadbackV1 {
  chainId: number; hostAdapterId: string; releaseDigest: Hex; sourceVerificationDigest: Hex;
  host: Address; poolId: Hex; token: Address; quote: Address; creator: Address; ledger: Address;
  creatorFeeBps: number; compositionHash: Hex; blockNumber: string; blockHash: Hex; blockTimestamp: number;
  moduleIndex: number; moduleCount: number;
  module: { instance: Address; codeHash: Hex; observedCodeHash: Hex; configurationHash: Hex; descriptor: FoundationModuleDescriptorV1 };
  moduleContext: { host: Address; poolId: Hex; token: Address; quote: Address; creator: Address; ledger: Address };
}
export interface FoundationActionContextV1 {
  readonly readback: FoundationActionReadbackV1;
  readonly packageId: Hex; readonly version: string; readonly manifestHash: Hex;
  readonly contextKey: Hex; readonly expiresAt: number;
}
/** Supplied only by an application-owned role resolver, with evidence scoped to this exact source and readback. */
export interface FoundationActionRoleGrantV1 { role: string; account: Address; contextKey: Hex; evidenceDigest: Hex }
const boundActionContexts = new WeakSet<object>();
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function assertFresh(readback: FoundationActionReadbackV1, now: number) {
  foundationRequire(Number.isSafeInteger(now) && Number.isSafeInteger(readback.blockTimestamp) && readback.blockTimestamp <= now + 30
    && now - readback.blockTimestamp <= FOUNDATION_ACTION_READBACK_MAX_AGE_SECONDS_V1,
  "FOUNDATION_ACTION_READBACK_STALE", "Read current module state again before preparing this action.");
}
export function bindFoundationActionContextV1(input: Environment & {
  selections: readonly FoundationModuleSelection[]; readback: FoundationActionReadbackV1; now?: number;
}): FoundationActionContextV1 {
  const r = nativeJson(input.readback) as FoundationActionReadbackV1;
  assertFresh(r, input.now ?? nowSeconds());
  for (const field of ["releaseDigest", "sourceVerificationDigest", "poolId", "compositionHash", "blockHash"] as const) moduleHash(r[field], `foundation.action.${field}`);
  for (const field of ["host", "token", "quote", "creator", "ledger"] as const) moduleAddress(r[field], `foundation.action.${field}`);
  foundationRequire(r.chainId === input.chainId && r.hostAdapterId === input.hostAdapterId && typeof r.blockNumber === "string"
    && r.blockNumber.length <= 78 && /^(?:0|[1-9][0-9]*)$/.test(r.blockNumber),
    "FOUNDATION_ACTION_CHAIN_BINDING", "The action readback belongs to another chain or host adapter.");
  const composition = composeFoundationUiSelectionsV1({ ...input, creatorFeeBps: r.creatorFeeBps });
  foundationRequire(composition.ok, "FOUNDATION_ACTION_COMPOSITION_INVALID", composition.diagnostics[0]?.message ?? "Restore the original admitted module composition.");
  foundationRequire(r.moduleCount === composition.modules.length && moduleInteger(r.moduleIndex, "foundation.moduleIndex", 7) < r.moduleCount
    && r.compositionHash === composition.compositionHash, "FOUNDATION_ACTION_COMPOSITION_MISMATCH", "The supplied selections do not match this pool's immutable module composition.");
  const { entry, selection } = assertSelection(input.catalog, input.selections[r.moduleIndex]), selected = composition.modules[r.moduleIndex];
  foundationRequire(entry.release?.releaseDigest === r.releaseDigest && r.module.codeHash === selected.moduleCodeHash
    && r.module.observedCodeHash === selected.moduleCodeHash && r.module.configurationHash === keccak256(selected.configuration)
    && hashFoundationModuleDescriptorV1(r.module.descriptor) === selected.descriptorHash,
  "FOUNDATION_ACTION_SOURCE_MISMATCH", "The module runtime, configuration or descriptor differs from the admitted source version.");
  moduleAddress(r.module.instance, "foundation.module.instance");
  for (const field of ["host", "token", "quote", "creator", "ledger"] as const) foundationRequire(equalAddress(r.moduleContext[field], r[field]),
    "FOUNDATION_ACTION_CONTEXT_MISMATCH", "The module is bound to a different host, pool or owner.");
  foundationRequire(r.moduleContext.poolId === r.poolId && !equalAddress(r.token, r.quote), "FOUNDATION_ACTION_CONTEXT_MISMATCH", "The module pool context is inconsistent.");
  const value: FoundationActionContextV1 = freeze({ readback: r, packageId: entry.manifest.packageId, version: selection.version, manifestHash: entry.manifestHash,
    contextKey: foundationDataDigest("programmable.module-foundation.action-context.v1", { readback: r, packageId: entry.manifest.packageId, manifestHash: entry.manifestHash }),
    expiresAt: r.blockTimestamp + FOUNDATION_ACTION_READBACK_MAX_AGE_SECONDS_V1 });
  boundActionContexts.add(value); return value;
}
function actionEntry(catalog: FoundationCatalogV1, instance: FoundationActionContextV1, now: number) {
  foundationRequire(instance && boundActionContexts.has(instance), "FOUNDATION_ACTION_CONTEXT_UNBOUND", "Obtain a source-verified module readback before preparing actions.");
  assertFresh(instance.readback, now);
  const entry = resolveFoundationCatalogEntryV1(catalog, instance.packageId);
  foundationRequire(entry.status === "available" && entry.manifestHash === instance.manifestHash && entry.release?.releaseDigest === instance.readback.releaseDigest,
    "FOUNDATION_ACTION_CATALOG_CHANGED", "The source admission changed. Refresh the module readback.");
  return entry;
}
function roleError(role: string, account: Address, instance: FoundationActionContextV1, grants: readonly FoundationActionRoleGrantV1[]): string | null {
  if (role === "creator") return equalAddress(account, instance.readback.creator) ? null : "This action requires the pool creator's wallet.";
  if (role === "public") return null;
  const grant = grants.find(item => item.role === role && equalAddress(item.account, account) && item.contextKey === instance.contextKey);
  if (grant) { moduleHash(grant.evidenceDigest, "foundation.action.roleEvidence"); return null; }
  return `This action requires the ${role} role. Resolve that role against the current module before preparation.`;
}
export interface FoundationPresentedActionV1 {
  id: string; moduleId: Hex; version: string; digest: Hex; actionId: string; label: string; description: string;
  role: string; fields: readonly FoundationConfigurationField[]; available: boolean; unavailableReason?: string;
}
export function presentFoundationActionsV1(input: { catalog: FoundationCatalogV1; instance: FoundationActionContextV1; account: Address;
  context?: OpenConfigContext; roleGrants?: readonly FoundationActionRoleGrantV1[]; now?: number }): readonly FoundationPresentedActionV1[] {
  const entry = actionEntry(input.catalog, input.instance, input.now ?? nowSeconds()), account = moduleAddress(input.account, "foundation.action.account");
  return entry.manifest.sourceDescriptor.management.actions.map(action => {
    let reason = roleError(action.role, account, input.instance, input.roleGrants ?? []), fields: readonly FoundationConfigurationField[] = [];
    try { fields = presentFoundationFieldsV1(action.inputs, undefined, input.context); } catch (error) { reason = foundationDiagnostic(error).message; }
    return { id: `${entry.manifest.packageId}:${action.id}`, moduleId: entry.manifest.packageId, version: entry.manifest.sourceDescriptor.version, digest: entry.manifestHash,
      actionId: action.id, label: action.label, description: action.description, role: action.role, fields,
      available: reason === null, ...(reason ? { unavailableReason: reason } : {}) };
  });
}
export interface FoundationActionSelectionV1 { id: string; version: string; digest: Hex; actionId: string; configuration: FoundationConfiguration }
export interface FoundationActionIntentV1 {
  packageId: Hex; manifestHash: Hex; actionId: string; role: string; moduleIndex: number; moduleInstance: Address;
  chainId: number; contextKey: Hex; readbackContextKey: Hex; expiresAt: number; simulationRequired: true;
  readbackBlock: { number: string; hash: Hex }; label: string;
  transaction: { from: Address; to: Address; data: Hex; value: 0n };
}
/** Calldata intent only. The owner controller must simulate these exact bytes and rebind the wallet before signing. */
export function prepareFoundationActionIntentV1(input: { catalog: FoundationCatalogV1; instance: FoundationActionContextV1;
  selection: FoundationActionSelectionV1; account: Address; context?: OpenConfigContext; roleGrants?: readonly FoundationActionRoleGrantV1[]; now?: number }): FoundationActionIntentV1 {
  const entry = actionEntry(input.catalog, input.instance, input.now ?? nowSeconds()), account = moduleAddress(input.account, "foundation.action.account");
  const selected = moduleRecord(nativeJson(input.selection), ["id", "version", "digest", "actionId", "configuration"], "foundation.action.selection");
  foundationRequire(selected.id === entry.manifest.packageId && selected.version === entry.manifest.sourceDescriptor.version && selected.digest === entry.manifestHash,
    "FOUNDATION_ACTION_SELECTION_STALE", "This action selection does not match the bound source version.");
  const action = entry.manifest.sourceDescriptor.management.actions.find(item => item.id === selected.actionId);
  foundationRequire(action, "FOUNDATION_ACTION_UNAVAILABLE", "This source version has no such action.");
  const denied = roleError(action.role, account, input.instance, input.roleGrants ?? []);
  foundationRequire(denied === null, "FOUNDATION_ACTION_ROLE_REQUIRED", denied ?? "The current wallet lacks this action role.");
  const values = decodeFoundationFieldsV1(action.inputs, selected.configuration as FoundationConfiguration, undefined, input.context);
  const encoded = encodeFoundationActionV1(entry.manifest, action.id, values, input.context), r = input.instance.readback;
  const data = encodeFunctionData({ abi: FOUNDATION_MANAGEMENT_ACTION_ABI_V1, functionName: "executeModuleAction", args: [BigInt(r.moduleIndex), encoded.data] });
  return freeze({ packageId: entry.manifest.packageId, manifestHash: entry.manifestHash, actionId: action.id, role: action.role,
    moduleIndex: r.moduleIndex, moduleInstance: r.module.instance, chainId: r.chainId, label: action.label,
    readbackBlock: { number: r.blockNumber, hash: r.blockHash }, expiresAt: input.instance.expiresAt, simulationRequired: true,
    readbackContextKey: input.instance.contextKey, contextKey: foundationDataDigest("programmable.module-foundation.action-intent.v1", {
      readbackContextKey: input.instance.contextKey, account, manifestHash: entry.manifestHash, actionId: action.id, dataHash: keccak256(data),
    }), transaction: { from: account, to: r.host, data, value: 0n } });
}
