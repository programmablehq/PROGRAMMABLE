import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { ModuleEngineConfigurationArgument } from "@/lib/module-engine/catalog";
import { POST, maxDuration } from "@/app/api/module-foundation/compose/route";
import { FOUNDATION_AVAILABILITY_SCHEMA, FOUNDATION_AVAILABILITY_SCHEMA_V3 } from "@/lib/module-foundation/availability";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
import { FOUNDATION_CATALOG_SCHEMA_V1, type FoundationCatalogEntryV1 } from "@/lib/module-foundation/catalog";
import { foundationMetadataParameters, type FoundationMetadata } from "@/lib/module-foundation/abi";
import { foundationMetadata } from "@/lib/module-foundation/client";
import { resolveFoundationAssetsV1 } from "@/lib/module-foundation/assets";
import { readFoundationAssetPins, readFoundationModulePackages } from "@/lib/module-foundation/metadata";
import { FOUNDATION_CREATOR_SHARE_FIELD_V1 } from "@/lib/module-foundation/presentation";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_HOST_ADAPTER_ID_V1,
  FOUNDATION_PACKAGE_EXTENSION_V1, FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1,
  foundationDataDigest, hashFoundationModuleDescriptorV1, hashFoundationModuleManifestV1,
  type FoundationModuleDescriptorV1,
} from "@/lib/module-foundation/manifest";
import type { FoundationConfiguration, FoundationLaunchDraft, FoundationModuleSelection } from "@/lib/module-foundation/ui-types";

const mocks = vi.hoisted(() => ({ availability: vi.fn(), infrastructure: vi.fn(), client: vi.fn(), startPrice: vi.fn(),
  getChainId: vi.fn(), getBlock: vi.fn(), getCode: vi.fn(), readContract: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/module-foundation/start-price", () => ({ readFoundationStartPrice: mocks.startPrice }));
// The fixed server admission boundary and RPC transport are mocked; all source, metadata and asset parsers run.
vi.mock("@/lib/server/module-foundation/availability", () => ({ readFoundationAvailabilityResponse: mocks.availability }));
vi.mock("@/lib/module-foundation/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/module-foundation/client")>(),
  createFoundationClient: mocks.client, assertFoundationInfrastructure: mocks.infrastructure,
}));
vi.mock("@/lib/module-foundation/assets", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-foundation/assets")>();
  return { ...actual, resolveFoundationAssetsV1: vi.fn(actual.resolveFoundationAssetsV1) };
});

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (value: string) => keccak256(toHex(value));
const now = 1_800_000_000, creator = address(30), quote = address(100), first = address(701), second = address(702), third = address(703);
const factory = address(40), hookDeployer = address(41), releaseDigest = hash("protocol-release"), tokenSalt = hash("launch-salt");
const checkpoint = { blockNumber: 1234n, blockHash: hash("checkpoint"), timestamp: BigInt(now) };
const code = "0x60016000526001601ff3" as Hex;
const assets = new Map<Address, { code: Hex; decimals: number }>();
interface Fields {
  schema: OpenConfigSchema; defaults: unknown; configuration: FoundationConfiguration;
  abi: ModuleEngineConfigurationArgument[];
}
function ordinaryFields(asset = first): Fields {
  return { schema: { type: "record", fields: {
    asset: { type: "asset" }, token: { type: "asset", binding: { mode: "input", default: { asset: "token" } } },
    quote: { type: "asset", binding: { mode: "input", default: { asset: "quote" } } },
    creator: { type: "account", binding: { mode: "input", default: { role: "creator" } } },
    factory: { type: "component", binding: { mode: "input", default: { component: "factory" } } },
    recipient: { type: "address" },
  }, required: ["asset", "token", "quote", "creator", "factory", "recipient"] },
  defaults: { asset: { chainId: 4663, address: asset, decimals: 6 }, recipient: third }, configuration: { "/asset": asset },
  abi: ["asset", "token", "quote", "creator", "factory", "recipient"].map(key => ({ path: [key], type: "address" })) };
}
function listFields(values: unknown[]): Fields {
  return { schema: { type: "array", items: { type: "asset" }, maxItems: 2 }, defaults: [],
    configuration: { $value: JSON.stringify(values) }, abi: [{ path: [], type: "address[]" }] };
}
function fixture(id = "first", fields = ordinaryFields()) {
  const descriptor: FoundationModuleDescriptorV1 = { moduleId: hash(`module-${id}`), abiVersion: 1, phases: 6, resources: 1,
    beforeGas: 0, afterGas: 50_000, actionGas: 60_000, failOpenAfter: false, exclusiveGroup: FOUNDATION_ZERO_HASH };
  const source: OpenSourcePackage = {
    format: "programmable.classic.source-package.v0.1", name: `Asset fixture ${id}`, version: "1.2.0",
    author: address(1), rewardWallet: address(1), familySalt: hash(`family-${id}`),
    source: { files: [{ path: "src/Cell.sol", sha256: "a".repeat(64) }, { path: "README.md", sha256: "b".repeat(64) }] },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "Cell" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: "src/Cell.sol", entrypoint: "CellFactory" }],
    configuration: fields.schema, ports: { inputs: {}, outputs: {} }, constraints: [], documentation: "README.md",
    requiresHost: [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1)],
    management: { summary: "Technical configuration fixture.", reads: [], actions: [] },
    extensions: { [FOUNDATION_PACKAGE_EXTENSION_V1]: { hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor,
      descriptorHash: hashFoundationModuleDescriptorV1(descriptor), configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1,
      configurationAbi: fields.abi, defaults: fields.defaults, actions: [] } },
  };
  const manifest = createFoundationModuleManifestV1(source, hash(`request-${id}`)), manifestHash = hashFoundationModuleManifestV1(manifest);
  const entry: FoundationCatalogEntryV1 = { manifest, review: {
    submissionId: "11111111-1111-4111-8111-111111111111", requestDigest: manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", source), manifestHash,
    artifactDigest: hash(`artifact-${id}`), decisionDigest: hash(`decision-${id}`), reviewer: address(2), reviewerPolicyDigest: hash("review-policy"),
  }, release: { chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, releaseDigest: hash(`module-release-${id}`), manifestHash,
    deploymentEvidenceDigest: hash(`deploy-${id}`), runtimeVerificationDigest: hash(`runtime-${id}`), factory: address(50),
    factoryCodeHash: hash("module-factory-code"), moduleCodeHash: hash("module-code"), descriptorHash: hashFoundationModuleDescriptorV1(descriptor) } };
  const selection: FoundationModuleSelection = { id: manifest.packageId, version: source.version, digest: manifestHash,
    configuration: { ...fields.configuration, [FOUNDATION_CREATOR_SHARE_FIELD_V1]: "25.50" } };
  return { entry, selection };
}
function accepted(entries: FoundationCatalogEntryV1[] = []) {
  return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: true,
    binding: { releaseDigest, sourceCommit: "a".repeat(40), startBlock: "100",
      factory: { address: factory, runtimeCodeHash: hash("factory") }, hookDeployer: { address: hookDeployer, runtimeCodeHash: hash("deployer") } },
    evidence: { checkedAt: new Date().toISOString(), sourcePath: "/v1/modules/foundation/source", artifactDigest: hash("protocol-artifact"),
      decisionDigest: hash("protocol-decision"), sourceManifestHash: hash("protocol-source"), deploymentEvidenceDigest: hash("protocol-deploy"),
      runtimeVerificationDigest: hash("protocol-runtime"), finalityEvidenceDigest: hash("protocol-finality"), blockHash: checkpoint.blockHash },
    catalog: { document: { schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries },
      authority: { admissions: entries.flatMap(entry => entry.review ? [entry.review] : []), releases: entries.flatMap(entry => entry.release ? [entry.release] : []) } } };
}
function body(selections: FoundationModuleSelection[] = []) {
  const draft: FoundationLaunchDraft = { name: "Fixture coin", symbol: "FIX", description: "A source-bound technical fixture.",
    image: { url: "https://programmable.market/fixture.webp", sha256: hash("image") }, socialLinks: {}, quoteAsset: quote,
    creatorFeeBps: 300, initialBuy: "0", additionalLiquidity: "0", modules: selections };
  return { account: creator, releaseDigest, tokenSalt, draft, launchFlow: "single-eth-v1" };
}
const request = (value: unknown) => new Request("http://localhost/api/module-foundation/compose", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
});
const predictions = () => mocks.readContract.mock.calls.filter(([call]) => call.functionName === "predictTokenAddress");
function predicted(metadata: FoundationMetadata) {
  return getAddress(`0x${keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata])).slice(-40)}`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); vi.clearAllMocks();
  assets.clear(); for (const asset of [quote, first, second, third]) assets.set(asset, { code, decimals: asset === second ? 8 : 6 });
  mocks.startPrice.mockImplementation(async (asset: { address: Address; decimals: number; codeHash: Hex }) => ({
    chainId: 4663, quoteAsset: asset.address, quoteCodeHash: asset.codeHash, decimals: asset.decimals, targetMarketCapUsd: "5000",
    checkpoint: { number: "1234", hash: checkpoint.blockHash, timestamp: String(now) },
    price: { usd: { numerator: "2500", denominator: "1" }, source: "chainlink", observedAt: String(now - 10),
      validUntil: String(now + 45), evidenceHash: hash("price"), heartbeatSeconds: 86400 },
  }));
  mocks.availability.mockResolvedValue(accepted()); mocks.infrastructure.mockResolvedValue(checkpoint);
  mocks.getChainId.mockResolvedValue(4663);
  mocks.getBlock.mockResolvedValue({ number: checkpoint.blockNumber, hash: checkpoint.blockHash, timestamp: checkpoint.timestamp });
  mocks.getCode.mockImplementation(async ({ address: raw, blockNumber }: { address: Address; blockNumber: bigint }) => {
    expect(blockNumber).toBe(checkpoint.blockNumber); return assets.get(raw.toLowerCase() as Address)?.code ?? "0x";
  });
  mocks.readContract.mockImplementation(async (input: { address: Address; functionName: string; blockNumber: bigint; args?: unknown[] }) => {
    expect(input.blockNumber).toBe(checkpoint.blockNumber);
    if (input.functionName === "predictTokenAddress") return predicted(input.args![2] as FoundationMetadata);
    const asset = assets.get(input.address.toLowerCase() as Address);
    if (!asset) throw new Error("Unexpected ERC20 read.");
    if (input.functionName === "name") return "Technical asset";
    if (input.functionName === "symbol") return "ASSET";
    if (input.functionName === "decimals") return asset.decimals;
    if (input.functionName === "totalSupply" || input.functionName === "balanceOf") return 1_000_000n;
    throw new Error("Unexpected contract read.");
  });
  mocks.client.mockReturnValue({ getChainId: mocks.getChainId, getBlock: mocks.getBlock, getCode: mocks.getCode, readContract: mocks.readContract });
});
afterEach(() => vi.useRealTimers());

describe("Foundation compose BFF asset bindings", () => {
  it("retries a provider disagreement before composing the launch once", async () => {
    mocks.availability.mockResolvedValueOnce({ schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: false,
      reason: "MODULE_INDEX_PROVIDER_DISAGREEMENT" }).mockResolvedValue(accepted());
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(mocks.availability).toHaveBeenCalledTimes(2);
    expect(mocks.infrastructure).toHaveBeenCalledTimes(1);
    expect(predictions()).toHaveLength(1);
  });

  it("prepares after a slow authority response and closes a stalled read before the route expires", async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(now * 1000);
    vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL", "https://foundation-authority.example");
    const actual = await vi.importActual<typeof import("@/lib/server/module-foundation/availability")>("@/lib/server/module-foundation/availability");
    mocks.availability.mockImplementation(actual.readFoundationAvailabilityResponse);
    // Keep the real helper and abort behavior, with only the timer scheduler replaced.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    try {
      vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json(accepted())), 13_000);
        init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
      })));
      const delayed = POST(request(body()));
      await vi.advanceTimersByTimeAsync(13_000);
      const response = await delayed;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ releaseDigest, modules: [] });
      expect(predictions()).toHaveLength(1);

      mocks.readContract.mockClear(); mocks.infrastructure.mockClear();
      let settled = false, abortedAt: number | undefined;
      const startedAt = Date.now();
      vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => { abortedAt = Date.now() - startedAt; reject(init.signal!.reason); }, { once: true });
      })));
      const stalled = POST(request(body())).then(result => { settled = true; return result; });
      await vi.advanceTimersByTimeAsync(54_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await stalled).status).toBe(400);
      expect(abortedAt).toBeLessThan(maxDuration * 1000);
      expect(mocks.infrastructure).not.toHaveBeenCalled();
      expect(predictions()).toHaveLength(0);
    } finally {
      vi.clearAllTimers(); timeout.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });

  it("composes independent buy and sell fees only for a verified V3 release", async () => {
    const input = body();
    const draft: Partial<FoundationLaunchDraft> = { ...input.draft };
    delete draft.creatorFeeBps;
    const directional = { ...input, draft: { ...draft, creatorBuyFeeBps: 100, creatorSellFeeBps: 300 } };
    const old = await POST(request(directional));
    expect(old.status).toBe(400);
    expect(await old.json()).toMatchObject({ error: expect.stringContaining("not live yet") });
    expect(mocks.infrastructure).not.toHaveBeenCalled();

    const release = accepted();
    mocks.availability.mockResolvedValue({ ...release, schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V3,
      binding: { ...release.binding, factoryVersion: "v3", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID },
      evidence: { ...release.evidence, sourcePath: `/v1/modules/foundation/source/release/${releaseDigest}` } });
    const response = await POST(request(directional));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ releaseDigest, modules: [] });
    expect(predictions()).toHaveLength(1);
  });

  it.each([
    { creatorBuyFeeBps: 100 },
    { creatorBuyFeeBps: 100, creatorSellFeeBps: 300, creatorFeeBps: 100 },
    { creatorBuyFeeBps: 99, creatorSellFeeBps: 300 },
  ])("rejects invalid directional fee input before RPC: %j", async fees => {
    const input = body();
    const draft: Partial<FoundationLaunchDraft> = { ...input.draft };
    delete draft.creatorFeeBps;
    const response = await POST(request({ ...input, draft: { ...draft, ...fees } }));
    expect(response.status).toBe(400);
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(mocks.infrastructure).not.toHaveBeenCalled();
  });

  it("rejects an old quote-denominated form before any launch preparation", async () => {
    const old = body();
    const requestBody = { ...old, launchFlow: undefined };
    const response = await POST(request(requestBody));
    expect(response.status).toBe(400);
    expect(predictions()).toHaveLength(0);
  });

  it("supplies the fixed market-cap reference and rejects a submitted valuation override", async () => {
    const input = body();
    const response = await POST(request(input)), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.startPrice).toMatchObject({ targetMarketCapUsd: "5000", quoteAsset: quote, decimals: 6, quoteCodeHash: keccak256(code) });
    mocks.startPrice.mockClear(); mocks.availability.mockClear();
    const overridden = await POST(request({ ...input, draft: { ...input.draft, startValuationQuote: "2" } }));
    expect(overridden.status).toBe(400);
    expect(mocks.startPrice).not.toHaveBeenCalled();
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("does not prepare a launch when the automatic price is unavailable", async () => {
    mocks.startPrice.mockRejectedValueOnce(new Error("A current price for this quote token is unavailable."));
    const response = await POST(request(body()));
    expect(response.status).toBe(400);
    expect(predictions()).toHaveLength(0);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("current price") });
  });

  it("binds actual ERC20 pins before one prediction and composes the real token, quote, creator and factory", async () => {
    const f = fixture(), input = body([f.selection]); mocks.availability.mockResolvedValue(accepted([f.entry]));
    const response = await POST(request(input)), result = await response.json();
    expect(result, JSON.stringify(result)).not.toHaveProperty("error"); expect(response.status).toBe(200);
    const pins = [[first, 6, keccak256(code)]];
    expect(result.moduleAssetPins).toEqual(pins);
    expect(readFoundationAssetPins(result.metadata.socialData)).toEqual(pins);
    expect(readFoundationModulePackages(result.metadata.socialData)).toEqual([f.selection.id]);
    const expectedMetadata = foundationMetadata({ ...input.draft, imageURI: input.draft.image.url,
      modulePackageIds: [f.entry.manifest.packageId], moduleAssetPins: [[first, 6, keccak256(code)]] });
    expect(result.metadata).toEqual(expectedMetadata); expect(result.token).toBe(predicted(expectedMetadata));
    expect(predictions()).toHaveLength(1); expect(predictions()[0][0]).toMatchObject({ address: factory,
      blockNumber: checkpoint.blockNumber, args: [creator, tokenSalt, expectedMetadata] });
    expect(decodeAbiParameters(Array.from({ length: 6 }, () => ({ type: "address" })), result.modules[0].configuration))
      .toEqual([getAddress(first), result.token, quote, creator, factory, getAddress(third)]);
    expect(result.modules[0]).toMatchObject({ factory: f.entry.release!.factory, creatorShareBps: 2550 });
    expect(result.totals.creatorAssignedShareBps).toBe(2550);
    expect(resolveFoundationAssetsV1).toHaveBeenCalledOnce();
    expect(mocks.getCode.mock.calls.map(([call]) => call.address.toLowerCase())).toEqual([quote, first]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("retains a zero-module first release and does not pin the verified quote alias", async () => {
    let response = await POST(request(body())), result = await response.json();
    expect(response.status).toBe(200); expect(result.modules).toEqual([]); expect(result.moduleAssetPins).toEqual([]);
    const f = fixture(); f.selection.configuration["/asset"] = "quote";
    mocks.availability.mockResolvedValue(accepted([f.entry])); mocks.getCode.mockClear();
    response = await POST(request(body([f.selection]))); result = await response.json();
    expect(response.status).toBe(200); expect(result.moduleAssetPins).toEqual([]);
    expect(mocks.getCode.mock.calls.map(([call]) => call.address.toLowerCase())).toEqual([quote]);
  });

  it("uses reviewed defaults and a single global resolution with deterministic deduplication across modules", async () => {
    const a = fixture(), b = fixture("second", listFields([second, first])); delete a.selection.configuration["/asset"];
    mocks.availability.mockResolvedValue(accepted([a.entry, b.entry]));
    const response = await POST(request(body([a.selection, b.selection]))), result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.moduleAssetPins).toEqual([[first, 6, keccak256(code)], [second, 8, keccak256(code)]]);
    expect(resolveFoundationAssetsV1).toHaveBeenCalledOnce();
    expect(mocks.getCode.mock.calls.map(([call]) => call.address.toLowerCase())).toEqual([quote, first, second]);
  });

  it.each(["token", ""])("resolves the deferred token field %j only after the metadata-bound prediction", async value => {
    const f = fixture(); f.selection.configuration["/token"] = value;
    mocks.availability.mockResolvedValue(accepted([f.entry]));
    const response = await POST(request(body([f.selection]))), result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    const decoded = decodeAbiParameters(Array.from({ length: 6 }, () => ({ type: "address" })), result.modules[0].configuration);
    expect(decoded[1]).toBe(result.token); expect(predictions()).toHaveLength(1);
    expect(result.moduleAssetPins).toEqual([[first, 6, keccak256(code)]]);
  });

  it("reads every additional runtime and precision again and commits observed changes into prediction metadata", async () => {
    const f = fixture(); mocks.availability.mockResolvedValue(accepted([f.entry]));
    const firstResult = await (await POST(request(body([f.selection])))).json();
    assets.set(first, { code: "0x60ff", decimals: 8 });
    const response = await POST(request(body([f.selection]))), secondResult = await response.json();
    expect(response.status).toBe(200);
    expect(secondResult.moduleAssetPins).toEqual([[first, 8, keccak256("0x60ff")]]);
    expect(secondResult.metadata.socialData).not.toBe(firstResult.metadata.socialData);
    expect(secondResult.token).not.toBe(firstResult.token);
    expect(resolveFoundationAssetsV1).toHaveBeenCalledTimes(2);
  });

  it("enforces the two-extra-asset limit across the full composition before extra metadata reads or prediction", async () => {
    const a = fixture("first", listFields([first, second])), b = fixture("second", listFields([third]));
    mocks.availability.mockResolvedValue(accepted([a.entry, b.entry]));
    const response = await POST(request(body([a.selection, b.selection])));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("two additional") });
    expect(resolveFoundationAssetsV1).toHaveBeenCalledOnce(); expect(predictions()).toEqual([]);
    expect(mocks.getCode.mock.calls.map(([call]) => call.address.toLowerCase())).toEqual([quote]);
  });

  it.each(["id", "version", "digest"] as const)("rejects a substituted source %s before collecting or resolving assets", async key => {
    const f = fixture(); mocks.availability.mockResolvedValue(accepted([f.entry]));
    if (key === "version") f.selection.version = "1.1.0"; else f.selection[key] = hash("forged-source");
    const response = await POST(request(body([f.selection])));
    expect(response.status).toBe(400); expect(mocks.client).not.toHaveBeenCalled(); expect(resolveFoundationAssetsV1).not.toHaveBeenCalled();
  });

  it.each(["admissions", "releases"] as const)("requires the current server %s on every preparation", async field => {
    const f = fixture(), available = accepted([f.entry]);
    mocks.availability.mockResolvedValueOnce(available).mockResolvedValueOnce({ ...available,
      catalog: { ...available.catalog, authority: { ...available.catalog.authority, [field]: [] } } });
    expect((await POST(request(body([f.selection])))).status).toBe(200);
    mocks.client.mockClear(); vi.mocked(resolveFoundationAssetsV1).mockClear();
    expect((await POST(request(body([f.selection])))).status).toBe(400);
    expect(mocks.availability).toHaveBeenCalledTimes(2); expect(mocks.client).not.toHaveBeenCalled(); expect(resolveFoundationAssetsV1).not.toHaveBeenCalled();
  });

  it.each(["moduleAssetPins", "catalog", "sourceDescriptor", "authority"])("rejects browser-supplied %s as extra request data", async field => {
    const f = fixture(), value = { ...body([f.selection]), [field]: accepted([f.entry]).catalog };
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.availability).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects forged draft pins, hidden source fields and oversized or duplicate selections", async () => {
    const f = fixture(); mocks.availability.mockResolvedValue(accepted([f.entry]));
    const values = [
      { ...body([f.selection]), draft: { ...body([f.selection]).draft, moduleAssetPins: [[first, 18, hash("forged-code")]] } },
      body([{ ...f.selection, configuration: { ...f.selection.configuration, "/forged": third } }]),
      body(Array.from({ length: 9 }, () => f.selection)), body([f.selection, f.selection]),
    ];
    for (const value of values) expect((await POST(request(value))).status).toBe(400);
    expect(resolveFoundationAssetsV1).not.toHaveBeenCalled(); expect(predictions()).toEqual([]);
  });

  it.each(["release", "source", "stale-authority", "wrong-chain"])("fails closed on %s changes before asset RPC calls", async kind => {
    const f = fixture(), available = accepted([f.entry]), input = body([f.selection]);
    if (kind === "release") input.releaseDigest = hash("old-release");
    if (kind === "source") f.entry.manifest.sourceDescriptor.version = "9.0.0";
    if (kind === "stale-authority") available.evidence.checkedAt = new Date((now - 121) * 1000).toISOString();
    if (kind === "wrong-chain") f.entry.release!.chainId = 1;
    mocks.availability.mockResolvedValue(available);
    expect((await POST(request(input))).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["decimals", "chainId"])("does not accept literal %s as ERC20 authority", async field => {
    const f = fixture("literal", listFields([{ chainId: 4663, address: first, decimals: 6, [field]: field === "decimals" ? 18 : 1 }]));
    mocks.availability.mockResolvedValue(accepted([f.entry]));
    const response = await POST(request(body([f.selection])));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("verified metadata") });
    expect(mocks.getCode.mock.calls.map(([call]) => call.address.toLowerCase())).toEqual([quote, first]);
  });

  it("checks fixed asset metadata inserted by compilation inside structured inputs", async () => {
    const f = fixture("nested-fixed", { schema: { type: "array", maxItems: 1, items: { type: "record", fields: {
      asset: { type: "asset", binding: { mode: "fixed", value: { chainId: 4663, address: first, decimals: 18 } } },
    }, required: ["asset"] } }, defaults: [], configuration: { $value: "[{}]" },
    abi: [{ path: [], type: "tuple[]", components: [{ name: "asset", type: "address" }] }] });
    mocks.availability.mockResolvedValue(accepted([f.entry]));
    const response = await POST(request(body([f.selection])));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("source asset metadata") });
  });

  it.each(["wrong-chain", "stale", "checkpoint", "reorg", "no-code", "decimals"])("rejects %s asset observations before prediction", async kind => {
    const f = fixture(); mocks.availability.mockResolvedValue(accepted([f.entry]));
    if (kind === "wrong-chain") mocks.getChainId.mockResolvedValue(1);
    if (kind === "stale") mocks.getBlock.mockResolvedValue({ number: checkpoint.blockNumber, hash: checkpoint.blockHash, timestamp: BigInt(now - 121) });
    if (kind === "checkpoint") mocks.getBlock.mockResolvedValue({ number: checkpoint.blockNumber, hash: hash("other"), timestamp: checkpoint.timestamp });
    if (kind === "reorg") mocks.getBlock.mockResolvedValueOnce({ number: checkpoint.blockNumber, hash: checkpoint.blockHash, timestamp: checkpoint.timestamp })
      .mockResolvedValue({ number: checkpoint.blockNumber, hash: hash("reorg"), timestamp: checkpoint.timestamp });
    if (kind === "no-code") assets.get(first)!.code = "0x";
    if (kind === "decimals") assets.get(first)!.decimals = 37;
    expect((await POST(request(body([f.selection])))).status).toBe(400); expect(predictions()).toEqual([]);
  });

  it.each([quote, first])("rejects a predicted coin overlapping the existing asset %s", async collision => {
    const f = fixture(); mocks.availability.mockResolvedValue(accepted([f.entry]));
    const prior = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async input => input.functionName === "predictTokenAddress" ? collision : prior(input));
    const response = await POST(request(body([f.selection])));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("overlaps an existing asset") });
  });
});
