import { parseSwapTokenDescriptor } from "@/lib/swap/client";
import { ETHEREUM_MODULE_SOURCE } from "@/lib/module-foundation/ethereum-release";
import ethereumModuleSpec from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { describe, expect, it, vi } from "vitest";
import { brotliDecompressSync } from "node:zlib";
import { getAddress } from "viem";
import { resolveSwapToken, resolveVerifiedLaunchSwapToken, type SwapTokenDependencies } from "@/lib/server/swap/token";
import { normalizeSupportedModuleModeLaunches } from "@/lib/module-mode/source-adapters";
import { moduleEnginePublicLaunch, moduleModePublicLaunch } from "@/lib/server/robinhood-index/module-source";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { bindActiveModuleEngineRelease, type ModuleEngineAvailability, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import type { ModuleEngineProvenanceV1 } from "@/lib/module-engine/index/provenance-v1";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";
import { moduleEvidenceFixtureV2 } from "./fixtures/module-mode-evidence-v2";
import anyQuote from "./fixtures/module-engine-any-quote-index.json";
import anyQuoteEth from "./fixtures/module-engine-any-quote-eth-index.json";
import genericEngine from "./fixtures/module-engine-index.json";
import { shardRouterTradeEntry } from "./shard-router-trade-fixture";
import { resolveServerBoundRouterTradeAdapterV1 } from "@/lib/server/custom-launch/router-trade-descriptor-v1";
import { SHARD_ROUTER_TRADE_PROJECT_ID } from "@/lib/custom-launch/router-trade-adapters-v1";
import ethereumRecording from "./fixtures/ethereum-stamped-swap-rpc.json";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodToken: vi.fn() }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumToken: vi.fn() }));
vi.mock("@/lib/server/swap/custom-v4", () => ({ readCustomV4SwapDescriptor: vi.fn() }));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readWebsiteRouterCustomIdentitySnapshotV1: vi.fn() }));

// Synthetic source fixtures exercise routing decisions only, never live execution.
function dependencies(row: RobinhoodLaunch) {
  return {
    robinhood: vi.fn(async () => ({ token: row, status: "ready" })), ethereum: vi.fn(),
    native: vi.fn(), engine: vi.fn(), custom: vi.fn(async () => ({ launch: row })), decimals: vi.fn(async () => 18),
    ethereumCustom: vi.fn(async entry => resolveServerBoundRouterTradeAdapterV1(entry, null)),
  } as unknown as SwapTokenDependencies;
}
function nativeFixture(v2 = false) {
  const fixture = v2 ? moduleEvidenceFixtureV2(0, 0) : moduleEvidenceFixture(0, 0);
  const row = moduleModePublicLaunch(normalizeSupportedModuleModeLaunches([fixture.evidence], fixture.release)[0], null);
  const deps = dependencies(row), release = bindActiveModuleModeRelease(fixture.release);
  vi.mocked(deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release, catalog: [], reason: null });
  return { row, deps, release };
}

describe("swap source resolution", () => {
  it("reuses a verified page identity without another catalog lookup and keeps the same route", async () => {
    const { row, deps } = nativeFixture();
    const expected = await resolveSwapToken({ address: row.tokenAddress, chainId: 4663 }, deps);
    vi.mocked(deps.robinhood).mockClear();
    const actual = await resolveVerifiedLaunchSwapToken({ chainId: 4663, token: row }, deps);
    expect(actual).toEqual(expected);
    expect(parseSwapTokenDescriptor(actual, { address: row.tokenAddress, chainId: 4663 })).toEqual(actual);
    expect(deps.robinhood).not.toHaveBeenCalled();
    expect(deps.ethereum).not.toHaveBeenCalled();
  });

  it.each(["v1", "v2", "v3"])("routes finalized Foundation %s launches to their original module controls", async factoryVersion => {
    const row = { ...nativeFixture().row, sourceKind: "module-foundation-v1", factoryVersion,
      routerAddress: null, stampHash: null, sourceAddress: a(101), sourceReleaseDigest: h(201),
      feeLedgerAddress: a(102), poolManager: a(103), quoteAsset: a(104),
      launchId: h(301), poolId: h(301), metadataHash: h(302), compositionHash: h(303), decimals: 18,
    } as RobinhoodLaunch;
    const deps = dependencies(row);
    const result = await resolveSwapToken({ address: row.tokenAddress, chainId: 4663 }, deps);
    expect(result).toMatchObject({ status: "ready", route: { kind: "module-foundation", transactionHash: row.transactionHash },
      manageHref: `/modules/${row.tokenAddress.toLowerCase()}` });
    expect(parseSwapTokenDescriptor(result, { address: row.tokenAddress, chainId: 4663 })).toEqual(result);
    expect(deps.custom).not.toHaveBeenCalled();
    expect(deps.native).not.toHaveBeenCalled();
    expect(() => parseSwapTokenDescriptor({ ...result, manageHref: `/modules/${a(900)}` }, { address: row.tokenAddress })).toThrow("controls link");
    expect(() => parseSwapTokenDescriptor({ ...result, route: { kind: "module-foundation", transactionHash: "0x" } }, { address: row.tokenAddress })).toThrow("identity");
  });

  it("selects Ethereum Foundation controls before generic stamped swaps", async () => {
    const row = { ...shardRouterTradeEntry, launchTransactionHash: h(101), launchStampProvenance: {
      ...shardRouterTradeEntry.launchStampProvenance!,
      routerAddress: ethereumModuleSpec.canonicalStamp.router.address,
      routeLauncherAddress: ethereumModuleSpec.canonicalStamp.graphFactory.address,
      blockNumber: ETHEREUM_MODULE_SOURCE.startBlock.toString(),
      components: [{ kind: "other", scope: "exclusive", runtimeCodeHash: ETHEREUM_MODULE_SOURCE.proxyRuntimeCodeHash },
        { kind: "token" }, { kind: "hook" }],
    } } as unknown as CanonicalTokenExploreEntry;
    const { deps } = nativeFixture();
    vi.mocked(deps.ethereum).mockResolvedValue({ chainId: 1, status: "ready", token: row } as Awaited<ReturnType<SwapTokenDependencies["ethereum"]>>);
    const result = await resolveSwapToken({ address: row.tokenAddress, chainId: 1 }, deps);
    expect(result).toMatchObject({ status: "ready", route: { kind: "module-foundation", transactionHash: h(101) },
      manageHref: `/modules/${row.tokenAddress.toLowerCase()}?chainId=1` });
    expect(parseSwapTokenDescriptor(result, { address: row.tokenAddress, chainId: 1 })).toEqual(result);
    expect(deps.ethereumCustom).not.toHaveBeenCalled();
    vi.mocked(deps.ethereum).mockClear();
    expect(await resolveVerifiedLaunchSwapToken({ chainId: 1, token: row }, deps)).toEqual(result);
    expect(deps.ethereum).not.toHaveBeenCalled();
  });

  it.each([false, true])("uses the exact saved native release with an empty current catalogue (V2=%s)", async v2 => {
    const f = nativeFixture(v2);
    const value = await resolveSwapToken({ address: f.row.tokenAddress }, f.deps);
    expect(value).toMatchObject({ status: "ready", chainId: 4663, token: { address: getAddress(f.row.tokenAddress), decimals: 18 }, route: { kind: "module-native", availability: { release: f.release } } });
    expect(f.deps.native).toHaveBeenCalledWith(f.row.sourceReleaseDigest);
    expect(f.deps.custom).not.toHaveBeenCalled();
  });

  it("does not substitute the current release for an unavailable historical release", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [], reason: "Unavailable" });
    expect(await resolveSwapToken({ address: f.row.tokenAddress }, f.deps)).toMatchObject({ status: "unavailable", route: null });
    vi.mocked(f.deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release: { ...f.release, releaseDigest: h(999) }, catalog: [], reason: null });
    expect(await resolveSwapToken({ address: f.row.tokenAddress }, f.deps)).toMatchObject({ status: "unavailable", route: null });
  });

  it.each([anyQuote, anyQuoteEth])("resolves both shared Any Quote generations from their original engine source", async fixture => {
    const item = fixture.cases[0], row = moduleEnginePublicLaunch(item.normalized as unknown as ModuleEngineProvenanceV1, null), deps = dependencies(row);
    const template = { manifest: { manifest: { revision: { packageId: row.engineRevisionId }, catalogDefinition: { interface: "quote-shared-v1" } } } } as ModuleEngineTemplate;
    const availability = { release: bindActiveModuleEngineRelease(item.release), templates: [template] } as ModuleEngineAvailability;
    vi.mocked(deps.engine).mockResolvedValue(availability);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "ready", route: { kind: "any-quote", availability, template } });
    expect(deps.engine).toHaveBeenCalledWith(row.sourceReleaseDigest);
  });

  it("does not invent an ETH route for an engine with no market", async () => {
    const item = genericEngine.cases[0], row = moduleEnginePublicLaunch(item.normalized as unknown as ModuleEngineProvenanceV1, null), deps = dependencies(row);
    vi.mocked(deps.engine).mockResolvedValue({ release: bindActiveModuleEngineRelease(item.release), templates: [{ manifest: { manifest: { revision: { packageId: row.engineRevisionId }, catalogDefinition: { interface: "quote-v1" } } } }] } as ModuleEngineAvailability);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "unavailable", route: null, manageHref: expect.stringContaining("/launch/modules/manage/"), reason: expect.stringContaining("no trading pool") });
    expect(deps.custom).not.toHaveBeenCalled();
  });

  it("rejects supporting-contract lookup instead of swapping the primary asset", async () => {
    const f = nativeFixture();
    await expect(resolveSwapToken({ address: a(999) }, f.deps)).rejects.toMatchObject({ code: "NOT_PRIMARY_TOKEN" });
    expect(f.deps.native).not.toHaveBeenCalled();
  });

  it.each([undefined, "multi-role-v2"] as const)("delegates historical custom source %s without manufacturing a vNext projection", async sourceKind => {
    const row = { ...nativeFixture().row, sourceKind } as RobinhoodLaunch, deps = dependencies(row);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "ready", route: { kind: "custom-v4", descriptor: { launch: row } } });
    expect(deps.custom).toHaveBeenCalledWith(row);
  });

  it("leaves unrecognized assets unavailable instead of falling back to arbitrary swaps", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.robinhood).mockResolvedValue({ token: null, status: "ready" } as Awaited<ReturnType<SwapTokenDependencies["robinhood"]>>);
    await expect(resolveSwapToken({ address: a(900) }, f.deps)).rejects.toMatchObject({ code: "TOKEN_NOT_FOUND" });
    expect(f.deps.custom).not.toHaveBeenCalled();
  });

  it.each([0, 6, 18])("reads missing projected token units from the contract (%s decimals)", async decimals => {
    const row = { ...nativeFixture().row, sourceKind: "multi-role-v2", decimals: null } as RobinhoodLaunch;
    const deps = dependencies(row);
    vi.mocked(deps.decimals).mockResolvedValue(decimals);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "ready", token: { decimals }, route: { kind: "custom-v4" } });
    expect(deps.decimals).toHaveBeenCalledWith(row.tokenAddress);
    expect(deps.custom).toHaveBeenCalledWith(row);
  });

  it("does not guess token units when the contract read fails", async () => {
    const row = { ...nativeFixture().row, sourceKind: "multi-role-v2", decimals: null } as RobinhoodLaunch;
    const deps = dependencies(row);
    vi.mocked(deps.decimals).mockRejectedValue(new Error("Provider unavailable"));
    await expect(resolveSwapToken({ address: row.tokenAddress }, deps)).rejects.toThrow("Provider unavailable");
    expect(deps.custom).not.toHaveBeenCalled();
  });

  it("reuses the existing Ethereum classic adapter with token decimals", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.ethereum).mockResolvedValue({ status: "ready", token: { tokenAddress: a(300), name: "Decimal fixture", symbol: "DEC", tokenDecimals: 6, hookAddress: a(301), poolId: h(300), launchModel: "classic" } } as Awaited<ReturnType<SwapTokenDependencies["ethereum"]>>);
    expect(await resolveSwapToken({ address: a(300), chainId: 1 }, f.deps)).toMatchObject({ status: "ready", chainId: 1, token: { decimals: 6 }, route: { kind: "classic", hook: getAddress(a(301)), poolId: h(300) } });
    expect(f.deps.robinhood).not.toHaveBeenCalled();
  });

  it("uses the reviewed SHARD market and canonical project identity", async () => {
    const { deps } = nativeFixture();
    vi.mocked(deps.ethereum).mockResolvedValue({ chainId: 1, status: "ready", sources: { classic: "current", custom: "current" },
      updatedAt: "2026-09-20T16:00:00.000Z", token: shardRouterTradeEntry });
    expect(await resolveSwapToken({ address: shardRouterTradeEntry.tokenAddress, chainId: 1 }, deps)).toMatchObject({
      status: "ready", route: { kind: "custom-market", projectId: SHARD_ROUTER_TRADE_PROJECT_ID, marketId: "shard-eth-v4",
        capability: { poolKey: { poolId: shardRouterTradeEntry.poolId }, supportedSides: ["base-to-quote", "quote-to-base"] } },
    });
    expect(deps.custom).not.toHaveBeenCalled();
  });

  it("does not give an unreviewed or changed Ethereum Custom launch a swap route", async () => {
    const { deps } = nativeFixture();
    const changed = { ...shardRouterTradeEntry, launchStampProvenance: { ...shardRouterTradeEntry.launchStampProvenance!, stampHash: h(777) } };
    vi.mocked(deps.ethereum).mockResolvedValue({ chainId: 1, status: "ready", sources: { classic: "current", custom: "current" },
      updatedAt: "2026-09-20T16:00:00.000Z", token: changed });
    expect(await resolveSwapToken({ address: changed.tokenAddress, chainId: 1 }, deps)).toMatchObject({ status: "unavailable", route: null });
    expect(deps.custom).not.toHaveBeenCalled();
  });
  it("automatically resolves a finalized native ETH CustomGraph without a reviewed coin descriptor", async () => {
    const saved = JSON.parse(brotliDecompressSync(Buffer.from(ethereumRecording.brotliBase64, "base64")).toString());
    const row = saved.buy.snapshot.entries.find((e: CanonicalTokenExploreEntry) => e.tokenAddress === saved.buy.request.token) as CanonicalTokenExploreEntry;
    const { deps } = nativeFixture();
    vi.mocked(deps.ethereumCustom).mockResolvedValue(null);
    vi.mocked(deps.ethereum).mockResolvedValue({ chainId: 1, status: "ready", sources: { classic: "current", custom: "current" }, updatedAt: saved.buy.snapshot.generatedAt, token: row });
    expect(await resolveSwapToken({ address: row.tokenAddress, chainId: 1 }, deps)).toMatchObject({
      status: "ready", route: { kind: "ethereum-stamped", descriptor: { stamp: { launchId: row.launchStampProvenance!.launchId } } },
    });
    await expect(resolveSwapToken({ address: a(900), chainId: 1 }, deps)).rejects.toMatchObject({ code: "NOT_PRIMARY_TOKEN" });
  });
});
