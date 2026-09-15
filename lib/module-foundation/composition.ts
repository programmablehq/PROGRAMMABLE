import { encodeAbiParameters, keccak256, type Hex } from "viem";
import type { OpenConfigContext, OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleHash, moduleInteger, moduleRecord } from "@/lib/module-mode/release";
import {
  FOUNDATION_ABI_ID_V1, FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1,
  FOUNDATION_HOST_ADAPTER_ID_V1, FOUNDATION_SELECTION_ABI_V1, FOUNDATION_ZERO_HASH,
  encodeFoundationConfigurationV1, foundationDiagnostic, foundationRequire, foundationVersionedName,
  type FoundationDiagnosticV1, type FoundationModuleSelectionV1,
} from "./manifest";
import { assertBoundFoundationCatalogV1, resolveFoundationCatalogEntryV1, type FoundationCatalogV1 } from "./catalog";

export interface FoundationHostAdapterV1 {
  id: string; abiVersion: number; configurationCodec: string; capabilities: readonly string[];
  phases: number; resources: number; maxModules: number; minimumPhaseGas: number;
  maxBeforeGas: number; maxAfterGas: number; maxActionGas: number; maxTotalSwapGas: number;
}
/** App-owned ABI adapter. New package data cannot grant new host capabilities or change immutable pool hooks. */
export const FOUNDATION_HOST_ADAPTER_V1: FoundationHostAdapterV1 = Object.freeze({
  id: FOUNDATION_HOST_ADAPTER_ID_V1, abiVersion: 1, configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
  capabilities: Object.freeze([FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)]),
  phases: 7, resources: 1, maxModules: 8, minimumPhaseGas: 10_000,
  maxBeforeGas: 300_000, maxAfterGas: 300_000, maxActionGas: 2_000_000, maxTotalSwapGas: 1_200_000,
});
export interface FoundationModuleChoiceV1 {
  packageId: Hex; configuration: OpenConfigValue; creatorShareBps: number;
}
export interface FoundationCompositionInputV1 {
  catalog: FoundationCatalogV1; selections: readonly FoundationModuleChoiceV1[];
  hostAdapterId: string; chainId: number; creatorFeeBps: number;
  context?: OpenConfigContext;
  /** Only registered, trusted application adapters. Never accept this from contributor or launch-request JSON. */
  hostAdapters?: readonly FoundationHostAdapterV1[];
}
export interface FoundationCompositionTotalsV1 {
  moduleCount: number; beforeGas: number; afterGas: number; swapGas: number;
  creatorAssignedShareBps: number; creatorRetainedShareBps: number;
  platformBps: 30; platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
}
export type FoundationCompositionV1 = {
  ok: true; modules: readonly FoundationModuleSelectionV1[]; compositionHash: Hex;
  diagnostics: readonly FoundationDiagnosticV1[]; totals: FoundationCompositionTotalsV1;
} | {
  ok: false; modules: readonly []; compositionHash: null;
  diagnostics: readonly FoundationDiagnosticV1[]; totals: FoundationCompositionTotalsV1;
};

/** Bound byte array in its explicit user-selected order; the host runs both swap phases in this same order. */
export function hashFoundationCompositionV1(modules: readonly FoundationModuleSelectionV1[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, ...FOUNDATION_SELECTION_ABI_V1], [FOUNDATION_ABI_ID_V1, modules]));
}

export function composeFoundationModulesV1(input: FoundationCompositionInputV1): FoundationCompositionV1 {
  const diagnostics: FoundationDiagnosticV1[] = [], modules: FoundationModuleSelectionV1[] = [];
  const totals: FoundationCompositionTotalsV1 = { moduleCount: 0, beforeGas: 0, afterGas: 0, swapGas: 0,
    creatorAssignedShareBps: 0, creatorRetainedShareBps: 10_000, platformBps: 30,
    platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" };
  const fail = (): FoundationCompositionV1 => ({ ok: false, modules: [], compositionHash: null, diagnostics, totals });
  let choices: readonly FoundationModuleChoiceV1[], adapter: FoundationHostAdapterV1;
  try {
    assertBoundFoundationCatalogV1(input.catalog);
    foundationVersionedName(input.hostAdapterId, "/hostAdapterId");
    foundationRequire(moduleInteger(input.chainId, "foundation.chainId") > 0, "FOUNDATION_CHAIN_ID", "Choose an explicit chain ID.");
    const creatorFee = moduleInteger(input.creatorFeeBps, "foundation.creatorFeeBps", 1000);
    foundationRequire(creatorFee % 100 === 0, "FOUNDATION_CREATOR_FEE", "Creator fee must be 0% or a whole percentage from 1% through 10%.", "/creatorFeeBps");
    const found = (input.hostAdapters ?? [FOUNDATION_HOST_ADAPTER_V1]).find(item => item.id === input.hostAdapterId);
    foundationRequire(found, "FOUNDATION_HOST_ADAPTER_UNAVAILABLE",
      `The application has no transaction and conformance adapter for ${input.hostAdapterId}. Register a versioned host adapter to evaluate this capability.`, "/hostAdapterId");
    adapter = found;
    const raw = nativeJson(input.selections);
    foundationRequire(Array.isArray(raw) && raw.length <= adapter.maxModules, "FOUNDATION_MODULE_LIMIT", `This host supports at most ${adapter.maxModules} modules.`, "/selections");
    choices = raw as unknown as readonly FoundationModuleChoiceV1[];
    totals.moduleCount = choices.length;
  } catch (error) { diagnostics.push(foundationDiagnostic(error)); return fail(); }

  const moduleIds = new Map<string, number>(), exclusiveGroups = new Map<string, number>();
  for (const [index, value] of choices.entries()) {
    const path = `/selections/${index}`;
    try {
      const raw = moduleRecord(value, ["packageId", "configuration", "creatorShareBps"], `foundation.selection.${index}`);
      const packageId = moduleHash(raw.packageId, "foundation.packageId");
      const share = moduleInteger(raw.creatorShareBps, "foundation.creatorShareBps", 10_000);
      const entry = resolveFoundationCatalogEntryV1(input.catalog, packageId), runtime = entry.runtime, d = runtime.descriptor;
      const issue = (code: string, message: string, capability?: string) => diagnostics.push({ code, message, path, packageId, ...(capability ? { capability } : {}) });
      if (entry.status !== "available" || !entry.release) { diagnostics.push(...entry.diagnostics); continue; }
      if (entry.release.chainId !== input.chainId) issue("FOUNDATION_CHAIN_MISMATCH", "This module factory is released on a different chain.");
      if (runtime.hostAdapterId !== adapter.id) issue("FOUNDATION_HOST_ADAPTER_MISMATCH", `This package requires ${runtime.hostAdapterId}; select or register that host adapter.`, runtime.hostAdapterId);
      if (d.abiVersion !== adapter.abiVersion) issue("FOUNDATION_ABI_VERSION_UNSUPPORTED", `Descriptor ABI ${d.abiVersion} needs a matching versioned host adapter.`);
      if (runtime.configurationCodec !== adapter.configurationCodec) issue("FOUNDATION_CODEC_UNSUPPORTED", "This host adapter does not implement the package configuration codec.", runtime.configurationCodec);
      for (const capability of entry.manifest.sourceDescriptor.requiresHost) {
        if (!adapter.capabilities.includes(capability)) issue("FOUNDATION_CAPABILITY_UNAVAILABLE", `This host does not expose ${capability}. A capability adapter and its conformance evidence are required.`, capability);
      }
      const required = [adapter.id, FOUNDATION_CAPABILITIES_V1.configuration,
        ...((d.phases & 1) ? [FOUNDATION_CAPABILITIES_V1.beforeSwap] : []),
        ...((d.phases & 2) ? [FOUNDATION_CAPABILITIES_V1.afterSwap] : []),
        ...((d.phases & 4) ? [FOUNDATION_CAPABILITIES_V1.action] : []),
        ...((d.resources & 1) ? [FOUNDATION_CAPABILITIES_V1.ownQuoteBudget] : [])];
      for (const capability of required) {
        if (!entry.manifest.sourceDescriptor.requiresHost.includes(capability)) issue("FOUNDATION_CAPABILITY_UNDECLARED", `Declare ${capability} in the source package before review.`, capability);
      }
      if (!d.phases || (d.phases & ~adapter.phases) !== 0) issue("FOUNDATION_PHASE_UNSUPPORTED", `Unsupported callback phase bits: ${d.phases & ~adapter.phases}. A new execution capability needs a versioned host.`);
      if ((d.resources & ~adapter.resources) !== 0) issue("FOUNDATION_RESOURCE_UNSUPPORTED", `Unsupported resource bits: ${d.resources & ~adapter.resources}. Existing platform and other module budgets cannot supply new rights.`);
      const phases = [[1, d.beforeGas, adapter.maxBeforeGas, "beforeSwap"], [2, d.afterGas, adapter.maxAfterGas, "afterSwap"], [4, d.actionGas, adapter.maxActionGas, "action"]] as const;
      for (const [bit, gas, maximum, name] of phases) {
        if ((d.phases & bit) ? gas < adapter.minimumPhaseGas || gas > maximum : gas !== 0) issue("FOUNDATION_GAS_BUDGET", `${name} gas must be ${d.phases & bit ? `between ${adapter.minimumPhaseGas} and ${maximum}` : "zero while that phase is disabled"}.`);
      }
      if (!(d.phases & 2) && d.failOpenAfter) issue("FOUNDATION_FAILURE_POLICY", "failOpenAfter requires the after-swap phase.");
      if ((d.resources & 1) && !(d.phases & 4)) issue("FOUNDATION_RESOURCE_PHASE", "Own quote-budget withdrawals require a declared action phase.");
      if (runtime.actions.length && !(d.phases & 4)) issue("FOUNDATION_ACTION_PHASE", "Declared actions require the action phase.");
      if (share > 0 && (!(d.resources & 1) || !(d.phases & 4))) issue("FOUNDATION_CREATOR_BUDGET_UNAUTHORIZED", "A creator share requires the module's own quote-budget resource and action phase.");
      if (moduleIds.has(d.moduleId)) issue("FOUNDATION_MODULE_ID_DUPLICATE", `This module identity is already selected at position ${moduleIds.get(d.moduleId)! + 1}.`);
      moduleIds.set(d.moduleId, index);
      if (d.exclusiveGroup !== FOUNDATION_ZERO_HASH) {
        if (exclusiveGroups.has(d.exclusiveGroup)) issue("FOUNDATION_EXCLUSIVE_GROUP_CONFLICT", `This exclusive resource is already claimed at position ${exclusiveGroups.get(d.exclusiveGroup)! + 1}.`);
        exclusiveGroups.set(d.exclusiveGroup, index);
      }
      totals.beforeGas += d.beforeGas; totals.afterGas += d.afterGas;
      totals.creatorAssignedShareBps += share;
      const configuration = encodeFoundationConfigurationV1(entry.manifest, raw.configuration, input.context);
      modules.push({ factory: entry.release.factory, factoryCodeHash: entry.release.factoryCodeHash,
        moduleCodeHash: entry.release.moduleCodeHash, descriptorHash: runtime.descriptorHash,
        configuration: configuration.configuration, creatorShareBps: share });
    } catch (error) { diagnostics.push(foundationDiagnostic(error, path)); }
  }
  totals.swapGas = totals.beforeGas + totals.afterGas;
  totals.creatorRetainedShareBps = Math.max(0, 10_000 - totals.creatorAssignedShareBps);
  if (totals.swapGas > adapter.maxTotalSwapGas) diagnostics.push({ code: "FOUNDATION_TOTAL_SWAP_GAS", path: "/selections", message: `Combined swap callbacks exceed ${adapter.maxTotalSwapGas} gas.` });
  if (totals.creatorAssignedShareBps > 10_000) diagnostics.push({ code: "FOUNDATION_CREATOR_BUDGET_EXCEEDED", path: "/selections", message: "Modules may share at most 10000 bps of the creator fee. The separate 30-bps platform fee is never available to modules." });
  if (diagnostics.length) return fail();
  return { ok: true, modules, compositionHash: hashFoundationCompositionV1(modules), diagnostics, totals };
}
