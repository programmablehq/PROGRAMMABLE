import { describe, expect, it } from "vitest";
import { decodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_HOST_ADAPTER_ID_V1,
  FOUNDATION_PACKAGE_EXTENSION_V1, FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1,
  encodeFoundationActionV1, encodeFoundationConfigurationV1, foundationDataDigest,
  hashFoundationModuleDescriptorV1, hashFoundationModuleManifestV1, readFoundationPackageExtensionV1,
  type FoundationModuleDescriptorV1, type FoundationPackageExtensionV1,
} from "@/lib/module-foundation/manifest";
import {
  FOUNDATION_CATALOG_SCHEMA_V1, bindFoundationCatalogV1, type FoundationCatalogDocumentV1,
  type FoundationCatalogEntryV1, type FoundationCatalogAuthorityV1, type FoundationReleaseReferenceV1,
  type FoundationReviewReferenceV1,
} from "@/lib/module-foundation/catalog";
import { composeFoundationModulesV1, hashFoundationCompositionV1 } from "@/lib/module-foundation/composition";

const hash = (value: string) => keccak256(toHex(value));
const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const descriptor = (id: string, overrides: Partial<FoundationModuleDescriptorV1> = {}): FoundationModuleDescriptorV1 => ({
  moduleId: hash(id), abiVersion: 1, phases: 6, resources: 1,
  beforeGas: 0, afterGas: 50_000, actionGas: 80_000, failOpenAfter: false,
  exclusiveGroup: FOUNDATION_ZERO_HASH, ...overrides,
});

/** Inert technical state-cell package; no product module, deployment or acceptance is asserted by these fixtures. */
function source(id: string, overrides: Partial<FoundationModuleDescriptorV1> = {}): OpenSourcePackage {
  const d = descriptor(id, overrides);
  const extension: FoundationPackageExtensionV1 = {
    hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor: d,
    descriptorHash: hashFoundationModuleDescriptorV1(d), configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
    configurationAbi: [{ path: ["ceiling"], type: "uint256" }], defaults: { ceiling: "1000" },
    actions: [{ id: "advance", selector: "0x12345678", configurationAbi: [{ path: ["step"], type: "uint256" }] }],
  };
  return {
    format: "programmable.classic.source-package.v0.1", name: `Technical state ${id}`, version: "1.0.0",
    author: address(1), rewardWallet: address(1), familySalt: hash(id),
    source: { repository: "https://github.com/programmablehq/PROGRAMMABLE", revision: "1".repeat(40),
      files: [{ path: "src/StateCell.sol", sha256: "a".repeat(64) }, { path: "README.md", sha256: "b".repeat(64) }] },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/StateCell.sol", entrypoint: "StateCell" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/StateCell.sol", entrypoint: "StateCellFactory" }],
    configuration: { type: "record", fields: { ceiling: { type: "uint", bits: 256, min: "1", max: "1000000", unit: "count" } }, required: ["ceiling"] },
    ports: { inputs: {}, outputs: {} }, constraints: [],
    management: { summary: "Bounded technical state cell.", reads: [], actions: [{
      id: "advance", label: "Advance state", description: "Advance this instance within its configured ceiling.", component: "module", entrypoint: "onAction", role: "creator",
      inputs: { type: "record", fields: { step: { type: "uint", min: "1", max: "100", unit: "count" } }, required: ["step"] },
    }] },
    requiresHost: [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)],
    documentation: "README.md", extensions: { [FOUNDATION_PACKAGE_EXTENSION_V1]: extension },
  };
}
function fixture(id: string, overrides: Partial<FoundationModuleDescriptorV1> = {}, modify?: (pkg: OpenSourcePackage) => void): FoundationCatalogEntryV1 {
  const pkg = source(id, overrides); modify?.(pkg);
  const manifest = createFoundationModuleManifestV1(pkg, hash(`request:${id}`));
  const manifestHash = hashFoundationModuleManifestV1(manifest), runtime = readFoundationPackageExtensionV1(manifest);
  const review: FoundationReviewReferenceV1 = {
    submissionId: "11111111-1111-4111-8111-111111111111", requestDigest: manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", pkg), manifestHash,
    artifactDigest: hash(`artifact:${id}`), decisionDigest: hash(`decision:${id}`), reviewer: address(2), reviewerPolicyDigest: hash("review-policy"),
  };
  const release: FoundationReleaseReferenceV1 = {
    chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, manifestHash, releaseDigest: hash("foundation-host-release"),
    deploymentEvidenceDigest: hash(`deploy:${id}`), runtimeVerificationDigest: hash(`runtime:${id}`),
    factory: address(id.charCodeAt(0) + 100), factoryCodeHash: hash(`factory:${id}`),
    moduleCodeHash: hash(`module:${id}`), descriptorHash: runtime.descriptorHash,
  };
  return { manifest, review, release };
}
function bound(entries: FoundationCatalogEntryV1[], authority?: FoundationCatalogAuthorityV1) {
  const document: FoundationCatalogDocumentV1 = { schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries };
  return bindFoundationCatalogV1(document, authority ?? {
    admissions: entries.flatMap(entry => entry.review ? [entry.review] : []),
    releases: entries.flatMap(entry => entry.release ? [entry.release] : []),
  });
}
function compose(entries: FoundationCatalogEntryV1[], shares = entries.map(() => 0)) {
  return composeFoundationModulesV1({ catalog: bound(entries), hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
    chainId: 4663, creatorFeeBps: 300,
    selections: entries.map((entry, index) => ({ packageId: entry.manifest.packageId, configuration: { ceiling: String(index + 10) }, creatorShareBps: shares[index] })),
  });
}
function codes(result: ReturnType<typeof composeFoundationModulesV1>) { return result.diagnostics.map(item => item.code); }

describe("Foundation descriptor and generic package ABI", () => {
  it("matches an independent Foundry cast ABI golden vector", () => {
    // cast keccak of abi-encode f((bytes32,uint16,uint8,uint8,uint32,uint32,uint32,bool,bytes32)).
    const d = descriptor("golden", { moduleId: `0x${"11".repeat(32)}` as Hex });
    expect(hashFoundationModuleDescriptorV1(d)).toBe("0xc29b333b0a8a251573c7732e72fd86348d6fe097d63cddb0531d1e75a12142d0");
  });
  it("binds each reviewed schema to real configuration and action bytes", () => {
    const { manifest } = fixture("a");
    const encoded = encodeFoundationConfigurationV1(manifest, { ceiling: "123" });
    expect(decodeAbiParameters([{ type: "uint256" }], encoded.configuration)).toEqual([123n]);
    expect(encoded.configurationHash).toBe(keccak256(encoded.configuration));
    const action = encodeFoundationActionV1(manifest, "advance", { step: "7" });
    expect(action.role).toBe("creator");
    expect(action.data.slice(0, 10)).toBe("0x12345678");
    expect(decodeAbiParameters([{ type: "uint256" }], `0x${action.data.slice(10)}`)).toEqual([7n]);
    expect(() => encodeFoundationActionV1(manifest, "undeclared", {})).toThrow(/not declared/);
    expect(() => encodeFoundationActionV1(manifest, "advance", { step: "101" })).toThrow();
  });
  it("rejects a descriptor JSON hash substituted for the onchain ABI hash", () => {
    const pkg = source("wrong-hash"), runtime = pkg.extensions![FOUNDATION_PACKAGE_EXTENSION_V1] as FoundationPackageExtensionV1;
    runtime.descriptorHash = foundationDataDigest("descriptor", runtime.descriptor);
    expect(() => createFoundationModuleManifestV1(pkg, hash("request"))).toThrow(/canonical onchain ABI/);
  });
  it("never drops an unencoded UI configuration field", () => {
    const pkg = source("dropped-field");
    if (pkg.configuration.type !== "record") throw new Error("fixture");
    pkg.configuration.fields.second = { type: "bool" }; pkg.configuration.required.push("second");
    expect(() => createFoundationModuleManifestV1(pkg, hash("request"))).toThrow(/Every configuration field/);
  });
  it("respects fixed source bindings and local value constraints", () => {
    const entry = fixture("fixed", {}, pkg => {
      if (pkg.configuration.type !== "record") throw new Error("fixture");
      pkg.configuration.fields.ceiling.binding = { mode: "fixed", value: "20" };
      pkg.constraints = [{ id: "bounded", message: "Ceiling must stay below 50.", left: { ref: { instance: "$self", path: ["ceiling"] } }, operator: "lt", right: { literal: "50", unit: "count" } }];
    });
    expect(encodeFoundationConfigurationV1(entry.manifest, {}).value).toEqual({ ceiling: "20" });
    expect(() => encodeFoundationConfigurationV1(entry.manifest, { ceiling: "21" })).toThrow();
  });
});

describe("Foundation composition and evidence boundaries", () => {
  it("launches with zero optional modules and preserves the mandatory platform fee", () => {
    const result = compose([]);
    expect(result.ok).toBe(true); expect(result.modules).toEqual([]);
    expect(result.compositionHash).toBe(hashFoundationCompositionV1([]));
    expect(result.totals).toMatchObject({ platformBps: 30, platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", creatorRetainedShareBps: 10_000 });
  });
  it("composes two independent stateful fixtures in their chosen order with separate creator budgets", () => {
    const first = fixture("a"), second = fixture("b"), result = compose([second, first], [2500, 5000]);
    expect(result.ok).toBe(true);
    expect(result.modules.map(item => item.factory)).toEqual([second.release!.factory, first.release!.factory]);
    expect(result.modules.map(item => item.creatorShareBps)).toEqual([2500, 5000]);
    expect(result.totals).toMatchObject({ moduleCount: 2, creatorAssignedShareBps: 7500, creatorRetainedShareBps: 2500, swapGas: 100_000 });
    expect(result.modules[0].configuration).not.toBe(result.modules[1].configuration);
    expect(result.compositionHash).not.toBe(compose([first, second], [2500, 5000]).compositionHash);
  });
  it("rejects only an actually shared exclusive group and duplicate module identity", () => {
    const group = hash("exclusive-state");
    const result = compose([fixture("a", { exclusiveGroup: group }), fixture("b", { exclusiveGroup: group })]);
    expect(codes(result)).toContain("FOUNDATION_EXCLUSIVE_GROUP_CONFLICT"); expect(result.modules).toEqual([]);
    expect(codes(compose([fixture("a"), fixture("b", { moduleId: hash("a") })]))).toContain("FOUNDATION_MODULE_ID_DUPLICATE");
  });
  it("enforces per-phase gas, aggregate swap gas and disabled-phase semantics", () => {
    expect(codes(compose([fixture("a", { afterGas: 300_001 })]))).toContain("FOUNDATION_GAS_BUDGET");
    expect(codes(compose([fixture("a", { beforeGas: 10_000 })]))).toContain("FOUNDATION_GAS_BUDGET");
    const four = ["a", "b", "c", "d"].map(id => fixture(id, { phases: 7, beforeGas: 200_000, afterGas: 200_000 }));
    expect(codes(compose(four))).toContain("FOUNDATION_TOTAL_SWAP_GAS");
    expect(codes(compose([fixture("a", { phases: 4, afterGas: 0, failOpenAfter: true })]))).toContain("FOUNDATION_FAILURE_POLICY");
  });
  it("caps module count and creator shares without exposing platform credits", () => {
    expect(codes(compose("abcdefghi".split("").map(id => fixture(id))))).toContain("FOUNDATION_MODULE_LIMIT");
    const over = compose([fixture("a"), fixture("b")], [6000, 4001]);
    expect(codes(over)).toContain("FOUNDATION_CREATOR_BUDGET_EXCEEDED"); expect(over.modules).toEqual([]);
    expect(codes(compose([fixture("a", { resources: 0 })], [1]))).toContain("FOUNDATION_CREATOR_BUDGET_UNAUTHORIZED");
    const allCreator = compose([fixture("a")], [10_000]);
    expect(allCreator.ok).toBe(true); expect(allCreator.totals.platformBps).toBe(30); expect(allCreator.totals.creatorRetainedShareBps).toBe(0);
  });
  it("requires a separate action phase before a module may consume its own quote credits", () => {
    const entry = fixture("a", { phases: 2, actionGas: 0 }, pkg => {
      pkg.management.actions = []; (pkg.extensions![FOUNDATION_PACKAGE_EXTENSION_V1] as FoundationPackageExtensionV1).actions = [];
    });
    expect(codes(compose([entry], [1]))).toEqual(expect.arrayContaining(["FOUNDATION_RESOURCE_PHASE", "FOUNDATION_CREATOR_BUDGET_UNAUTHORIZED"]));
  });
  it("distinguishes unknown capability and host adapter from invalid source ideas", () => {
    const entry = fixture("a", {}, pkg => { pkg.requiresHost.push("org.research.new-resource@1"); });
    const result = compose([entry]);
    expect(codes(result)).toContain("FOUNDATION_CAPABILITY_UNAVAILABLE");
    expect(result.diagnostics.find(item => item.code === "FOUNDATION_CAPABILITY_UNAVAILABLE")?.capability).toBe("org.research.new-resource@1");
    const unknown = composeFoundationModulesV1({ catalog: bound([]), hostAdapterId: "org.research.host@2", chainId: 4663, creatorFeeBps: 0, selections: [] });
    expect(codes(unknown)).toEqual(["FOUNDATION_HOST_ADAPTER_UNAVAILABLE"]);
  });
  it("does not turn source hashes or copied review/release JSON into catalog admission", () => {
    const entry = fixture("a");
    const unverified = bound([entry], { admissions: [], releases: [] });
    expect(unverified.entries[0].status).toBe("authority_unverified");
    const result = composeFoundationModulesV1({ catalog: unverified, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
      chainId: 4663, creatorFeeBps: 0, selections: [{ packageId: entry.manifest.packageId, configuration: { ceiling: "10" }, creatorShareBps: 0 }] });
    expect(result.ok).toBe(false); expect(result.modules).toEqual([]);
    const sourceOnly = bound([{ ...entry, review: null, release: null }]);
    expect(sourceOnly.entries[0].status).toBe("review_pending");
    expect(Object.isFrozen(unverified.entries[0].manifest.sourceDescriptor)).toBe(true);
  });
  it("rejects stale code bindings, review source substitutions and self-acceptance", () => {
    const entry = fixture("a"), trusted = { admissions: [entry.review!], releases: [entry.release!] };
    const changed = structuredClone(entry); changed.release!.moduleCodeHash = hash("changed-code");
    expect(bound([changed], trusted).entries[0].status).toBe("authority_unverified");
    const wrong = structuredClone(entry); wrong.review!.requestDigest = hash("other-request");
    expect(() => bound([wrong])).toThrow(/exact source request/);
    const self = structuredClone(entry); self.review!.reviewer = self.manifest.sourceDescriptor.author;
    expect(() => bound([self])).toThrow(/independent acceptance/);
  });
  it("does not accept a catalog reconstituted from serialized public data for transaction preparation", () => {
    const catalog = bound([]);
    const result = composeFoundationModulesV1({ catalog: JSON.parse(JSON.stringify(catalog)), hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
      chainId: 4663, creatorFeeBps: 0, selections: [] });
    expect(codes(result)).toEqual(["FOUNDATION_CATALOG_UNBOUND"]);
  });
});
