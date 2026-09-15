import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, keccak256, toHex, type Address } from "viem";
import type { OpenConfigContext, OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_HOST_ADAPTER_ID_V1,
  FOUNDATION_PACKAGE_EXTENSION_V1, FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1,
  foundationDataDigest, hashFoundationModuleDescriptorV1, hashFoundationModuleManifestV1,
  type FoundationModuleDescriptorV1, type FoundationPackageExtensionV1,
} from "@/lib/module-foundation/manifest";
import { FOUNDATION_CATALOG_SCHEMA_V1, bindFoundationCatalogV1, type FoundationCatalogEntryV1 } from "@/lib/module-foundation/catalog";
import {
  FOUNDATION_CREATOR_SHARE_FIELD_V1, FOUNDATION_MANAGEMENT_ACTION_ABI_V1,
  bindFoundationActionContextV1, composeFoundationUiSelectionsV1, decodeFoundationFieldsV1,
  presentFoundationActionsV1, presentFoundationCatalogV1, presentFoundationFieldsV1,
  prepareFoundationActionIntentV1, type FoundationActionReadbackV1,
} from "@/lib/module-foundation/presentation";

const hash = (value: string) => keccak256(toHex(value));
const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const creator = address(3), now = 1_800_000_000;

function fixture(role = "creator", modify?: (source: OpenSourcePackage) => void, context?: OpenConfigContext) {
  const descriptor: FoundationModuleDescriptorV1 = { moduleId: hash("technical.state-cell"), abiVersion: 1, phases: 6, resources: 1,
    beforeGas: 0, afterGas: 50_000, actionGas: 60_000, failOpenAfter: false, exclusiveGroup: FOUNDATION_ZERO_HASH };
  const source: OpenSourcePackage = {
    format: "programmable.classic.source-package.v0.1", name: "Technical state cell", version: "1.2.0",
    author: address(1), rewardWallet: address(1), familySalt: hash("family"),
    source: { files: [{ path: "src/Cell.sol", sha256: "a".repeat(64) }, { path: "README.md", sha256: "b".repeat(64) }] },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "Cell" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "CellFactory" }],
    configuration: { type: "record", fields: {
      settings: { type: "record", fields: { ceiling: { type: "uint", min: "1", max: "1000", label: "State ceiling" },
        enabled: { type: "bool", binding: { mode: "fixed", value: true } } }, required: ["ceiling", "enabled"] },
    }, required: ["settings"] },
    ports: { inputs: {}, outputs: {} }, constraints: [], documentation: "README.md",
    requiresHost: [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)],
    management: { summary: "Advance a bounded state cell.", reads: [], actions: [{ id: "advance", label: "Advance state", component: "module", entrypoint: "onAction",
      description: "Advance this cell's state within its ceiling.", role,
      inputs: { type: "record", fields: { step: { type: "uint", min: "1", max: "50", label: "Step" } }, required: ["step"] } }] },
    extensions: { [FOUNDATION_PACKAGE_EXTENSION_V1]: { hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor,
      descriptorHash: hashFoundationModuleDescriptorV1(descriptor), configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
      configurationAbi: [{ path: ["settings"], type: "tuple", components: [{ name: "ceiling", type: "uint256" }, { name: "enabled", type: "bool" }] }],
      defaults: { settings: { ceiling: "100", enabled: true } },
      actions: [{ id: "advance", selector: "0x12345678", configurationAbi: [{ path: ["step"], type: "uint256" }] }],
    } },
  };
  modify?.(source);
  const manifest = createFoundationModuleManifestV1(source, hash("source-request")), manifestHash = hashFoundationModuleManifestV1(manifest);
  const entry: FoundationCatalogEntryV1 = { manifest, review: {
    submissionId: "11111111-1111-4111-8111-111111111111", requestDigest: manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", source), manifestHash,
    artifactDigest: hash("artifact"), decisionDigest: hash("decision"), reviewer: address(2), reviewerPolicyDigest: hash("review-policy"),
  }, release: { chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: hash("release"), manifestHash,
    deploymentEvidenceDigest: hash("deploy"), runtimeVerificationDigest: hash("runtime"), factory: address(10),
    factoryCodeHash: hash("factory-code"), moduleCodeHash: hash("module-code"), descriptorHash: hashFoundationModuleDescriptorV1(descriptor) } };
  const catalog = bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [entry] }, { admissions: [entry.review!], releases: [entry.release!] });
  const environment = { catalog, chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, context };
  const selection: FoundationModuleSelection = { id: manifest.packageId, version: source.version, digest: manifestHash,
    configuration: { "/settings/ceiling": "100", [FOUNDATION_CREATOR_SHARE_FIELD_V1]: "25.50" } };
  const composition = composeFoundationUiSelectionsV1({ ...environment, selections: [selection], creatorFeeBps: 300 });
  if (!composition.ok) throw new Error(JSON.stringify(composition.diagnostics));
  const common = { host: address(20), poolId: hash("pool"), token: address(21), quote: address(22), creator, ledger: address(23) };
  const readback: FoundationActionReadbackV1 = { ...common, chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: hash("release"), sourceVerificationDigest: hash("canonical-pool-proof"),
    creatorFeeBps: 300, compositionHash: composition.compositionHash, blockNumber: "1000", blockHash: hash("block-1000"), blockTimestamp: now,
    moduleIndex: 0, moduleCount: 1, module: { instance: address(24), codeHash: hash("module-code"), observedCodeHash: hash("module-code"),
      configurationHash: keccak256(composition.modules[0].configuration), descriptor }, moduleContext: common };
  const instance = bindFoundationActionContextV1({ ...environment, selections: [selection], readback, now });
  const actionSelection = { id: manifest.packageId, version: source.version, digest: manifestHash, actionId: "advance", configuration: { "/step": "7" } };
  return { ...environment, entry, selection, readback, instance, actionSelection };
}

describe("Foundation catalog to UI binding", () => {
  it("checks asset bindings inserted by the compiler inside fixed array children against the verified context", () => {
    const asset = address(70), context: OpenConfigContext = { assets: { verified: { chainId: 4663, address: asset, decimals: 6 } } };
    const f = fixture("creator", source => {
      if (source.configuration.type !== "record") throw new Error("Expected fixture record");
      source.configuration.fields.cells = { type: "array", maxItems: 1, binding: { mode: "input", default: [{}] },
        items: { type: "record", fields: { asset: { type: "asset", binding: { mode: "fixed", value: { chainId: 4663, address: asset, decimals: 6 } } } }, required: ["asset"] } };
      source.configuration.required.push("cells");
      const extension = source.extensions![FOUNDATION_PACKAGE_EXTENSION_V1] as unknown as FoundationPackageExtensionV1;
      extension.configurationAbi = [...extension.configurationAbi, { path: ["cells"], type: "tuple[]", components: [{ name: "asset", type: "address" }] }];
    }, context);
    expect(composeFoundationUiSelectionsV1({ ...f, selections: [f.selection], creatorFeeBps: 300 }).ok).toBe(true);
    expect(composeFoundationUiSelectionsV1({ ...f, selections: [f.selection], creatorFeeBps: 300, context: {} })).toMatchObject({
      ok: false, modules: [], diagnostics: [expect.objectContaining({ code: "FOUNDATION_ASSET_CONTEXT_REQUIRED" })],
    });
    expect(composeFoundationUiSelectionsV1({ ...f, selections: [f.selection], creatorFeeBps: 300,
      context: { assets: { verified: { chainId: 4663, address: asset, decimals: 18 } } } })).toMatchObject({
      ok: false, modules: [], diagnostics: [expect.objectContaining({ code: "FOUNDATION_ASSET_METADATA_MISMATCH" })],
    });
  });
  it("projects primitive nested fields and exact source identity without exposing fixed fields", () => {
    const f = fixture(), [module] = presentFoundationCatalogV1(f);
    expect(module).toMatchObject({ id: f.entry.manifest.packageId, version: "1.2.0", digest: f.selection.digest, available: true });
    expect(module.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "/settings/ceiling", label: "State ceiling", kind: "integer", defaultValue: "100" }),
      expect.objectContaining({ key: FOUNDATION_CREATOR_SHARE_FIELD_V1, kind: "decimal", defaultValue: "0" }),
    ]));
    expect(module.fields.some(field => field.key.includes("enabled"))).toBe(false);
  });
  it("reconstructs schema values and converts an exact percent into creator bps", () => {
    const f = fixture();
    const result = composeFoundationUiSelectionsV1({ ...f, selections: [f.selection], creatorFeeBps: 300 });
    expect(result.ok).toBe(true); expect(result.modules[0].creatorShareBps).toBe(2550);
    expect(decodeAbiParameters([{ type: "tuple", components: [{ name: "ceiling", type: "uint256" }, { name: "enabled", type: "bool" }] }], result.modules[0].configuration)).toEqual([{ ceiling: 100n, enabled: true }]);
    expect(result.totals).toMatchObject({ creatorAssignedShareBps: 2550, creatorRetainedShareBps: 7450, platformBps: 30 });
  });
  it.each(["version", "digest", "id"] as const)("rejects substituted selection %s before encoding", key => {
    const f = fixture(), selected = { ...f.selection, [key]: key === "version" ? "1.1.0" : hash("substitute") };
    const result = composeFoundationUiSelectionsV1({ ...f, selections: [selected], creatorFeeBps: 300 });
    expect(result.ok).toBe(false); expect(result.modules).toEqual([]);
  });
  it("rejects hidden fixed overrides and out-of-range or imprecise creator allocations", () => {
    const f = fixture();
    for (const configuration of [{ ...f.selection.configuration, "/settings/enabled": false },
      { ...f.selection.configuration, [FOUNDATION_CREATOR_SHARE_FIELD_V1]: "100.01" },
      { ...f.selection.configuration, [FOUNDATION_CREATOR_SHARE_FIELD_V1]: "1.001" }]) {
      expect(composeFoundationUiSelectionsV1({ ...f, selections: [{ ...f.selection, configuration }], creatorFeeBps: 300 }).ok).toBe(false);
    }
  });
  it("handles bounded arrays as inert JSON and assets through a verified context", () => {
    const schema: OpenConfigSchema = { type: "record", fields: {
      amounts: { type: "array", items: { type: "uint", max: "10" }, minItems: 1, maxItems: 3 },
      asset: { type: "asset" }, recipient: { type: "account" }, active: { type: "bool" },
    }, required: ["amounts", "asset", "recipient", "active"] };
    const context = { assets: { quote: { chainId: 4663, address: address(30), decimals: 6 } }, roles: { creator } };
    const fields = presentFoundationFieldsV1(schema, { amounts: ["1"], asset: { asset: "quote" }, recipient: { role: "creator" }, active: false }, context);
    expect(fields.find(field => field.key === "/asset")).toMatchObject({ kind: "address", defaultValue: address(30) });
    expect(decodeFoundationFieldsV1(schema, { "/amounts": '["2","3"]', "/asset": "quote", "/recipient": creator, "/active": true }, undefined, context))
      .toEqual({ amounts: ["2", "3"], asset: { asset: "quote" }, recipient: { address: creator }, active: true });
    expect(() => decodeFoundationFieldsV1(schema, { "/amounts": "(()=>evil())()" }, undefined, context)).toThrow(/Invalid JSON/);
    expect(presentFoundationFieldsV1(schema).find(field => field.key === "/asset")).toMatchObject({ kind: "address" });
    expect(() => decodeFoundationFieldsV1(schema, { "/asset": address(30) })).toThrow(/metadata before preparation/);
  });
});

describe("Foundation source-bound management actions", () => {
  it("encodes the actual hook entrypoint with the bound module index and real caller", () => {
    const f = fixture(), [action] = presentFoundationActionsV1({ ...f, account: creator, now });
    expect(action).toMatchObject({ actionId: "advance", role: "creator", available: true });
    const intent = prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account: creator, now });
    expect(intent.transaction).toMatchObject({ from: creator, to: f.readback.host, value: 0n });
    const decoded = decodeFunctionData({ abi: FOUNDATION_MANAGEMENT_ACTION_ABI_V1, data: intent.transaction.data });
    expect(decoded.functionName).toBe("executeModuleAction"); expect(decoded.args[0]).toBe(0n);
    expect(decoded.args[1].slice(0, 10)).toBe("0x12345678");
    expect(decodeAbiParameters([{ type: "uint256" }], `0x${decoded.args[1].slice(10)}`)).toEqual([7n]);
    expect(intent).toMatchObject({ simulationRequired: true, expiresAt: now + 120, moduleInstance: f.readback.module.instance });
  });
  it("keeps creator authorization separate from source role labels and user input", () => {
    const f = fixture();
    expect(presentFoundationActionsV1({ ...f, account: address(99), now })[0]).toMatchObject({ available: false });
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account: address(99), now })).toThrow(/creator's wallet/);
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: { ...f.actionSelection, configuration: { "/step": "7", role: "creator" } }, account: creator, now })).toThrow(/not editable/);
  });
  it("requires a contextual trusted role grant for custom roles", () => {
    const f = fixture("operator"), account = address(90);
    expect(presentFoundationActionsV1({ ...f, account, now })[0]).toMatchObject({ available: false,
      unavailableCode: "FOUNDATION_ACTION_ROLE_INTEGRATION_REQUIRED", unavailableReason: expect.stringContaining("Wallet permission has not been determined") });
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account, now }))
      .toThrowError(expect.objectContaining({ code: "FOUNDATION_ACTION_ROLE_INTEGRATION_REQUIRED" }));
    const roleGrants = [{ role: "operator", account, contextKey: f.instance.contextKey, evidenceDigest: hash("verified-role-read") }];
    expect(prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account, roleGrants, now }).transaction.from).toBe(account);
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account,
      roleGrants: [{ ...roleGrants[0], contextKey: hash("another-instance") }], now })).toThrow(/operator role/);
  });
  it("supports an explicitly public source action for a noncreator wallet", () => {
    const f = fixture("public"), account = address(99);
    expect(prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account, now }).transaction.from).toBe(account);
  });
  it("rejects source/runtime/configuration/composition and host substitutions", () => {
    const f = fixture();
    const variants = [
      { ...f.readback, compositionHash: hash("wrong-composition") },
      { ...f.readback, module: { ...f.readback.module, observedCodeHash: hash("wrong-runtime") } },
      { ...f.readback, module: { ...f.readback.module, configurationHash: hash("wrong-config") } },
      { ...f.readback, moduleContext: { ...f.readback.moduleContext, host: address(98) } },
      { ...f.readback, module: { ...f.readback.module, descriptor: { ...f.readback.module.descriptor, actionGas: 70_000 } } },
    ];
    for (const readback of variants) expect(() => bindFoundationActionContextV1({ ...f, selections: [f.selection], readback, now })).toThrow();
  });
  it("rejects stale, serialized and wrong-manifest action contexts", () => {
    const f = fixture();
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account: creator, now: now + 121 })).toThrow(/current module state/);
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: f.actionSelection, account: creator, instance: JSON.parse(JSON.stringify(f.instance)), now })).toThrow(/source-verified/);
    expect(() => prepareFoundationActionIntentV1({ ...f, selection: { ...f.actionSelection, digest: hash("stale-manifest") }, account: creator, now })).toThrow(/source version/);
  });
});
