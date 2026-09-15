import {
  concatHex, encodeAbiParameters, keccak256, sha256, toHex, type Address, type Hex,
} from "viem";
import {
  compileOpenConfig, type OpenConfigContext, type OpenConfigSchema, type OpenConfigValue,
} from "@/packages/classic-modules/src/open-config.mjs";
import { evaluateOpenConstraints } from "@/packages/classic-modules/src/open-constraints.mjs";
import { validateOpenPackage, type OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import {
  encodeModuleEngineConfiguration, validateModuleEngineConfigurationAbi,
} from "@/lib/module-engine/configuration";
import type { ModuleEngineConfigurationArgument } from "@/lib/module-engine/catalog";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleBytes, moduleHash, moduleInteger, moduleRecord } from "@/lib/module-mode/release";

export const FOUNDATION_MANIFEST_SCHEMA_V1 = "programmable.module-foundation.package.v1" as const;
export const FOUNDATION_PACKAGE_EXTENSION_V1 = "programmable.module-foundation@1" as const;
export const FOUNDATION_CONFIGURATION_CODEC_V1 = "programmable.foundation-abi@1" as const;
export const FOUNDATION_HOST_ADAPTER_ID_V1 = "programmable.module-foundation.host@1" as const;
export const FOUNDATION_ABI_ID_V1 = keccak256(toHex("programmable.module-foundation.v1"));
export const FOUNDATION_ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
export const FOUNDATION_PHASES_V1 = { beforeSwap: 1, afterSwap: 2, action: 4 } as const;
export const FOUNDATION_RESOURCES_V1 = { ownQuoteBudget: 1 } as const;
export const FOUNDATION_CAPABILITIES_V1 = {
  configuration: FOUNDATION_CONFIGURATION_CODEC_V1,
  beforeSwap: "programmable.module-foundation.before-swap@1",
  afterSwap: "programmable.module-foundation.after-swap@1",
  action: "programmable.module-foundation.action@1",
  ownQuoteBudget: "programmable.module-foundation.own-quote-budget@1",
} as const;

/** Field order and widths match FoundationTypesV1.Descriptor, including all nine fields. */
export const FOUNDATION_DESCRIPTOR_ABI_V1 = [{
  type: "tuple", components: [
    { name: "moduleId", type: "bytes32" }, { name: "abiVersion", type: "uint16" },
    { name: "phases", type: "uint8" }, { name: "resources", type: "uint8" },
    { name: "beforeGas", type: "uint32" }, { name: "afterGas", type: "uint32" },
    { name: "actionGas", type: "uint32" }, { name: "failOpenAfter", type: "bool" },
    { name: "exclusiveGroup", type: "bytes32" },
  ],
}] as const;
export const FOUNDATION_SELECTION_ABI_V1 = [{
  type: "tuple[]", components: [
    { name: "factory", type: "address" }, { name: "factoryCodeHash", type: "bytes32" },
    { name: "moduleCodeHash", type: "bytes32" }, { name: "descriptorHash", type: "bytes32" },
    { name: "configuration", type: "bytes" }, { name: "creatorShareBps", type: "uint16" },
  ],
}] as const;

export interface FoundationModuleDescriptorV1 {
  moduleId: Hex; abiVersion: number; phases: number; resources: number;
  beforeGas: number; afterGas: number; actionGas: number; failOpenAfter: boolean; exclusiveGroup: Hex;
}
export interface FoundationModuleSelectionV1 {
  factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex;
  configuration: Hex; creatorShareBps: number;
}
export interface FoundationActionDefinitionV1 {
  /** Matches an action in sourceDescriptor.management.actions. No contributor JavaScript is executed. */
  id: string; selector: Hex; configurationAbi: readonly ModuleEngineConfigurationArgument[];
}
export interface FoundationPackageExtensionV1 {
  hostAdapterId: string; descriptor: FoundationModuleDescriptorV1; descriptorHash: Hex;
  configurationCodec: typeof FOUNDATION_CONFIGURATION_CODEC_V1;
  configurationAbi: readonly ModuleEngineConfigurationArgument[];
  defaults: OpenConfigValue; actions: readonly FoundationActionDefinitionV1[];
}
/** Source identity only. Review decisions and deployment/readback evidence belong to the catalog entry. */
export interface FoundationModuleManifestV1 {
  schemaVersion: typeof FOUNDATION_MANIFEST_SCHEMA_V1;
  packageId: Hex; familyId: Hex; requestDigest: Hex; sourceDescriptor: OpenSourcePackage;
}
export interface FoundationDiagnosticV1 {
  code: string; path: string; message: string; packageId?: Hex; capability?: string;
}
export class FoundationPackageError extends Error {
  constructor(readonly code: string, message: string, readonly path = "") {
    super(message); this.name = "FoundationPackageError";
  }
}
export function foundationRequire(condition: unknown, code: string, message: string, path = ""): asserts condition {
  if (!condition) throw new FoundationPackageError(code, message, path);
}
export function foundationVersionedName(value: unknown, path: string): string {
  foundationRequire(typeof value === "string" && /^[a-z][a-z0-9_.-]{0,95}@[1-9][0-9]{0,5}$/.test(value)
    && value.split("@")[0].includes("."), "FOUNDATION_INTERFACE_ID", "Use an exact namespaced interface and version.", path);
  return value;
}
export function foundationDataDigest(domain: string, value: unknown): Hex {
  return sha256(toHex(nativeCanonicalJson({ domain, value: nativeJson(value) })));
}
export function foundationDiagnostic(error: unknown, path = "", packageId?: Hex): FoundationDiagnosticV1 {
  return {
    code: error instanceof FoundationPackageError ? error.code : "FOUNDATION_INPUT_INVALID",
    message: error instanceof Error ? error.message : "Invalid Foundation package data.",
    path: error instanceof FoundationPackageError && error.path ? error.path : path,
    ...(packageId === undefined ? {} : { packageId }),
  };
}

export function bindFoundationModuleDescriptorV1(value: unknown): FoundationModuleDescriptorV1 {
  const r = moduleRecord(nativeJson(value), ["moduleId", "abiVersion", "phases", "resources", "beforeGas", "afterGas", "actionGas", "failOpenAfter", "exclusiveGroup"], "foundation.descriptor");
  moduleHash(r.moduleId, "foundation.moduleId");
  moduleInteger(r.abiVersion, "foundation.abiVersion", 65_535);
  moduleInteger(r.phases, "foundation.phases", 255); moduleInteger(r.resources, "foundation.resources", 255);
  for (const field of ["beforeGas", "afterGas", "actionGas"]) moduleInteger(r[field], `foundation.${field}`, 4_294_967_295);
  foundationRequire(typeof r.failOpenAfter === "boolean" && moduleBytes(r.exclusiveGroup, "foundation.exclusiveGroup", 32).length === 66,
    "FOUNDATION_DESCRIPTOR_SHAPE", "Descriptor needs an explicit after-swap failure policy and bytes32 exclusive group.", "/descriptor");
  return { ...r, moduleId: moduleHash(r.moduleId, "foundation.moduleId"),
    exclusiveGroup: moduleBytes(r.exclusiveGroup, "foundation.exclusiveGroup", 32) } as unknown as FoundationModuleDescriptorV1;
}
/** Exactly Solidity keccak256(abi.encode(descriptor)); this is not a JSON or packed hash. */
export function hashFoundationModuleDescriptorV1(value: FoundationModuleDescriptorV1): Hex {
  return keccak256(encodeAbiParameters(FOUNDATION_DESCRIPTOR_ABI_V1, [bindFoundationModuleDescriptorV1(value)]));
}

/** A visible configuration field must affect committed bytes; array elements cannot be silently omitted. */
function validateConfigurationCoverage(schema: OpenConfigSchema, mapping: readonly ModuleEngineConfigurationArgument[]): void {
  validateModuleEngineConfigurationAbi(schema, mapping);
  const paths = mapping.map(arg => [...arg.path]);
  const prefix = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((part, index) => part === b[index]);
  for (const [index, path] of paths.entries()) {
    foundationRequire(path.every(part => !/^[0-9]+$/.test(part)) && !paths.some((other, otherIndex) => otherIndex !== index && (prefix(path, other) || prefix(other, path))),
      "FOUNDATION_CONFIGURATION_ABI_COVERAGE", "ABI mappings must be unique, nonoverlapping paths; encode each array as a whole.", "/configurationAbi");
  }
  function covered(node: OpenConfigSchema, path: string[]): boolean {
    return paths.some(mapped => prefix(mapped, path)) || (node.type === "record"
      && Object.entries(node.fields).every(([key, child]) => covered(child, [...path, key])));
  }
  foundationRequire(covered(schema, []), "FOUNDATION_CONFIGURATION_ABI_COVERAGE",
    "Every configuration field must be represented in the reviewed ABI bytes.", "/configurationAbi");
}

export function readFoundationPackageExtensionV1(manifest: FoundationModuleManifestV1): FoundationPackageExtensionV1 {
  const source = manifest.sourceDescriptor;
  const r = moduleRecord(nativeJson(source.extensions?.[FOUNDATION_PACKAGE_EXTENSION_V1]),
    ["hostAdapterId", "descriptor", "descriptorHash", "configurationCodec", "configurationAbi", "defaults", "actions"], "foundation.extension");
  foundationVersionedName(r.hostAdapterId, "/hostAdapterId");
  const descriptor = bindFoundationModuleDescriptorV1(r.descriptor);
  foundationRequire(moduleHash(r.descriptorHash, "foundation.descriptorHash") === hashFoundationModuleDescriptorV1(descriptor),
    "FOUNDATION_DESCRIPTOR_HASH_MISMATCH", "Descriptor hash differs from its canonical onchain ABI encoding.", "/descriptorHash");
  foundationRequire(r.configurationCodec === FOUNDATION_CONFIGURATION_CODEC_V1,
    "FOUNDATION_CONFIGURATION_CODEC_UNSUPPORTED", "This package requires a configuration codec adapter that is not installed.", "/configurationCodec");
  validateConfigurationCoverage(source.configuration, r.configurationAbi as readonly ModuleEngineConfigurationArgument[]);
  foundationRequire(Array.isArray(r.actions) && r.actions.length <= 64, "FOUNDATION_ACTION_LIMIT", "At most 64 action definitions are allowed.", "/actions");
  const actionIds = new Set<string>(), selectors = new Set<string>();
  for (const [index, value] of r.actions.entries()) {
    const a = moduleRecord(value, ["id", "selector", "configurationAbi"], `foundation.actions.${index}`);
    const action = source.management.actions.find(item => item.id === a.id);
    foundationRequire(action && !actionIds.has(action.id), "FOUNDATION_ACTION_BINDING", "Every action must bind one unique source management action.", `/actions/${index}/id`);
    const selector = moduleBytes(a.selector, "foundation.action.selector", 4);
    foundationRequire(selector.length === 10 && selector !== "0x00000000" && !selectors.has(selector),
      "FOUNDATION_ACTION_SELECTOR", "Action selectors must be unique nonzero bytes4.", `/actions/${index}/selector`);
    validateConfigurationCoverage(action.inputs, a.configurationAbi as readonly ModuleEngineConfigurationArgument[]);
    actionIds.add(action.id); selectors.add(selector);
  }
  foundationRequire(actionIds.size === source.management.actions.length,
    "FOUNDATION_ACTION_BINDING", "Each declared source action needs an executable ABI mapping.", "/actions");
  // Empty defaults are permitted for required values supplied at launch. Their types are checked when encoded.
  return { ...r, descriptor } as unknown as FoundationPackageExtensionV1;
}

export function bindFoundationModuleManifestV1(value: unknown): FoundationModuleManifestV1 {
  const r = moduleRecord(nativeJson(value), ["schemaVersion", "packageId", "familyId", "requestDigest", "sourceDescriptor"], "foundation.manifest");
  foundationRequire(r.schemaVersion === FOUNDATION_MANIFEST_SCHEMA_V1, "FOUNDATION_MANIFEST_SCHEMA", "Unsupported Foundation manifest version.");
  const source = validateOpenPackage(r.sourceDescriptor);
  if (!source.ok) throw new FoundationPackageError(source.errors[0].code, source.errors[0].message, source.errors[0].path);
  foundationRequire(r.packageId === source.packageId && r.familyId === source.familyId,
    "FOUNDATION_SOURCE_IDENTITY_MISMATCH", "Package and family must match the exact source descriptor.");
  moduleHash(r.requestDigest, "foundation.requestDigest");
  const manifest = r as unknown as FoundationModuleManifestV1;
  readFoundationPackageExtensionV1(manifest);
  return manifest;
}
export function createFoundationModuleManifestV1(sourceDescriptor: OpenSourcePackage, requestDigest: Hex): FoundationModuleManifestV1 {
  const source = validateOpenPackage(sourceDescriptor);
  if (!source.ok) throw new FoundationPackageError(source.errors[0].code, source.errors[0].message, source.errors[0].path);
  return bindFoundationModuleManifestV1({ schemaVersion: FOUNDATION_MANIFEST_SCHEMA_V1,
    packageId: source.packageId, familyId: source.familyId, requestDigest, sourceDescriptor });
}
export function hashFoundationModuleManifestV1(value: FoundationModuleManifestV1): Hex {
  return foundationDataDigest(FOUNDATION_MANIFEST_SCHEMA_V1, bindFoundationModuleManifestV1(value));
}

export function encodeFoundationConfigurationV1(manifestInput: FoundationModuleManifestV1, value: unknown,
  context: OpenConfigContext = {}): { configuration: Hex; configurationHash: Hex; value: OpenConfigValue } {
  const manifest = bindFoundationModuleManifestV1(manifestInput), runtime = readFoundationPackageExtensionV1(manifest);
  const compiled = compileOpenConfig(manifest.sourceDescriptor.configuration, value, context);
  const constraints = evaluateOpenConstraints(manifest.sourceDescriptor.constraints,
    { $self: { schema: manifest.sourceDescriptor.configuration, value: compiled.value } });
  foundationRequire(constraints.ok, "FOUNDATION_CONFIGURATION_CONSTRAINT", constraints.violations[0]?.message ?? "Configuration constraint failed.", constraints.violations[0]?.path);
  const configuration = encodeModuleEngineConfiguration(runtime.configurationAbi, compiled, manifest.sourceDescriptor.configuration);
  foundationRequire(configuration.length <= 16_384 * 2 + 2, "FOUNDATION_CONFIGURATION_LIMIT", "Configuration exceeds the host's 16384-byte limit.");
  return { configuration, configurationHash: keccak256(configuration), value: compiled.value };
}

/** Produces bytes for host.executeModuleAction(index, data). Roles remain enforced by the reviewed module. */
export function encodeFoundationActionV1(manifestInput: FoundationModuleManifestV1, actionId: string, value: unknown,
  context: OpenConfigContext = {}): { data: Hex; dataHash: Hex; role: string; actionId: string } {
  const manifest = bindFoundationModuleManifestV1(manifestInput), runtime = readFoundationPackageExtensionV1(manifest);
  const definition = runtime.actions.find(item => item.id === actionId);
  const action = manifest.sourceDescriptor.management.actions.find(item => item.id === actionId);
  foundationRequire(definition && action && (runtime.descriptor.phases & FOUNDATION_PHASES_V1.action) !== 0,
    "FOUNDATION_ACTION_UNAVAILABLE", "This action is not declared for the selected module version.", "/actionId");
  const compiled = compileOpenConfig(action.inputs, value, context);
  const data = concatHex([definition.selector, encodeModuleEngineConfiguration(definition.configurationAbi, compiled, action.inputs)]);
  foundationRequire(data.length <= 16_384 * 2 + 2, "FOUNDATION_ACTION_LIMIT", "Action data exceeds the host's 16384-byte limit.");
  return { data, dataHash: keccak256(data), role: action.role, actionId };
}
