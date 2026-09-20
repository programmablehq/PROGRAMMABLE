import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toHex, type PublicClient } from "viem";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
import type { FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import type { FoundationLaunchIndexPage } from "@/lib/module-foundation/discovery";
import { isRobinhoodFoundationLaunch, robinhoodModuleManageHref } from "@/lib/robinhood-launches";
import { launchList, parseSnapshot, profileLaunchList, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { configuredFoundationSources, foundationIndexSource } from "@/lib/server/robinhood-index/foundation-source";
import { IndexRangeTooWide, syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";
import type { IndexStore } from "@/lib/server/robinhood-index/store";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/module-foundation/discovery", () => ({ FOUNDATION_DISCOVERY_MAX_BLOCKS: 5_000n, readFoundationLaunchIndex: mocks.read }));
const hash = (value: number | bigint) => toHex(value, { size: 32 });
const address = (value: number) => toHex(value, { size: 20 });
const now = Date.parse("2026-09-20T15:00:00Z");
const point = (number: bigint) => ({ number, hash: hash(number), timestamp: BigInt(now / 1_000) + number });
const checkpoint = (number: bigint) => ({ number: number.toString(), hash: hash(number) });
function binding(version: "v1" | "v2" | "v3" = "v2", id = 1): FoundationDeploymentBinding {
  return { ...(version === "v1" ? { factoryVersion: "v1" as const } : { factoryVersion: version, lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID }),
    releaseDigest: hash(id), sourceCommit: "a".repeat(40), startBlock: 100n,
    factory: { address: address(100 + id), runtimeCodeHash: hash(31) }, hookDeployer: { address: address(200 + id), runtimeCodeHash: hash(32) } };
}
function entry(version = "v2", id = 1, height = 150n) {
  return { sourceKind: "module-foundation-v1", factoryVersion: version, token: address(1_000 + id), hook: address(2_000 + id),
    creator: address(3_000), ledger: address(4_000 + id), quote: address(5_000), poolId: hash(6_000 + id),
    metadataHash: hash(7_000 + id), compositionHash: hash(8_000 + id), blockNumber: height, blockHash: hash(height),
    transactionHash: hash(9_000 + id), transactionIndex: 0, logIndex: id } as unknown as FoundationLaunchIndexPage["entries"][number];
}
function client(tip = 199n) {
  const getBlock = vi.fn(async (query: { blockNumber?: bigint }) => point(query.blockNumber ?? tip));
  const readContract = vi.fn(async (request: { functionName: string }) => request.functionName === "name" ? "Foundation coin" : "FND");
  return { api: { getChainId: vi.fn(async () => 4663), getBlock, readContract } as unknown as PublicClient, getBlock, readContract };
}
function snapshot(): RobinhoodSnapshot {
  return { version: 1, chainId: 4663, routerAddress: address(99), binding: hash(99), startBlock: "1", cursor: checkpoint(199n),
    checkpoints: [checkpoint(199n)], finalizedBlock: "199", updatedAt: new Date(now).toISOString(), items: [] };
}
function memoryStore(initial = snapshot()) {
  let saved = parseSnapshot(initial), revision = 0;
  const write = vi.fn(async (value: RobinhoodSnapshot, expected: string | null) => {
    if (expected !== String(revision)) throw new Error("Compare-and-swap conflict");
    saved = structuredClone(parseSnapshot(value)); revision++;
  });
  const store: IndexStore = { read: async () => ({ snapshot: structuredClone(saved), etag: String(revision) }), write };
  return { store, write, saved: () => saved };
}
function authority(version: "v1" | "v2" | "v3" = "v2", id = 1) {
  const source = binding(version, id);
  return { schemaVersion: `programmable.module-foundation.availability.${version}`, available: true,
    binding: { ...source, startBlock: source.startBlock.toString() }, evidence: { checkedAt: new Date().toISOString(),
      sourcePath: version === "v1" ? "/v1/modules/foundation/source" : `/v1/modules/foundation/source/release/${source.releaseDigest}`,
      artifactDigest: hash(1), decisionDigest: hash(2), sourceManifestHash: hash(3), deploymentEvidenceDigest: hash(4),
      runtimeVerificationDigest: hash(5), finalityEvidenceDigest: hash(6), blockHash: hash(7) } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockImplementation(async (input: Parameters<typeof import("@/lib/module-foundation/discovery").readFoundationLaunchIndex>[0]) => ({
    evidence: "canonical-launch-index", checkpoint: { blockNumber: input.toBlock, blockHash: hash(input.toBlock), timestamp: 1n },
    fromBlock: input.fromBlock, toBlock: input.toBlock, token: null,
    entries: [entry(input.binding.factoryVersion, Number(BigInt(input.binding.releaseDigest)))], nextCursor: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("Foundation releases in the canonical Robinhood saved index", () => {
  it.each(["v1", "v2", "v3"] as const)("adds finalized %s launches using both providers and the versioned Foundation reader", async version => {
    const first = client(209n), second = client(199n), source = await foundationIndexSource(binding(version), [first.api, second.api]);
    const memory = memoryStore();
    expect(await syncModuleModeIndex(source, memory.store, { rangeSize: 100n, now: () => now })).toMatchObject({ status: "ready", launches: 1, indexedThrough: "199" });
    const rows = launchList(memory.saved(), 1, "", now, { sort: "newest", mode: "module" }).items;
    expect(rows).toHaveLength(1);
    expect(isRobinhoodFoundationLaunch(rows[0])).toBe(true);
    expect(rows[0]).toMatchObject({ factoryVersion: version, routerAddress: null, stampHash: null, tokenAddress: address(1_001),
      creator: address(3_000), poolId: hash(6_001), metadataHash: hash(7_001), name: "Foundation coin", symbol: "FND" });
    expect(memory.saved().moduleMode).toMatchObject({ factoryVersion: version, sourceKind: "module-foundation-v1" });
    expect(profileLaunchList(memory.saved(), address(3_000), 1, now).items).toEqual(rows);
    expect(robinhoodModuleManageHref(rows[0])).toBe(`/modules/${address(1_001)}`);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    for (const call of mocks.read.mock.calls) expect(call[0]).toMatchObject({ binding: binding(version), fromBlock: 100n, toBlock: 199n, pageSize: 100 });
  });
  it("retains prior generations and sorts all releases by canonical launch time", async () => {
    const memory = memoryStore();
    for (const [id, version] of (["v1", "v2", "v3"] as const).entries()) {
      const source = await foundationIndexSource(binding(version, id + 1), [client().api, client().api]);
      await syncModuleModeIndex(source, memory.store, { rangeSize: 100n, now: () => now });
    }
    expect(launchList(memory.saved(), 1, "", now, { sort: "newest", mode: "all" }).items.map(row => row.factoryVersion)).toEqual(["v3", "v2", "v1"]);
    expect(memory.saved().moduleModeSources).toHaveLength(2);
  });
  it("keeps canonical coin existence when optional name and symbol calls fail", async () => {
    const first = client(), second = client(); second.readContract.mockRejectedValue(new Error("Metadata unavailable"));
    const source = await foundationIndexSource(binding(), [first.api, second.api]);
    expect(await source.launches(100n, 199n, [])).toMatchObject([{ tokenAddress: address(1_001), name: null, symbol: null }]);
  });
  it("does not advance or replace saved rows after a source verification failure", async () => {
    const memory = memoryStore(), source = await foundationIndexSource(binding(), [client().api, client().api]);
    await syncModuleModeIndex(source, memory.store, { rangeSize: 100n, now: () => now });
    const saved = structuredClone(memory.saved());
    mocks.read.mockRejectedValue(new Error("Canonical factory disagrees"));
    expect(await syncModuleModeIndex(source, memory.store, { rangeSize: 100n, now: () => now })).toMatchObject({ status: "partial", indexedThrough: "199" });
    expect(memory.saved()).toEqual(saved);
    expect(memory.write).toHaveBeenCalledTimes(1);
  });
  it("rejects provider disagreement and never scans past the lower finalized boundary", async () => {
    const first = client(), second = client(189n);
    const source = await foundationIndexSource(binding(), [first.api, second.api]);
    await expect(source.launches(100n, 190n, [])).rejects.toThrow("outside finality");
    const implementation = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async input => ({ ...await implementation(input), entries: [entry("v2", input.client === first.api ? 1 : 2)] }));
    await expect(source.launches(100n, 189n, [])).rejects.toThrow("disagree");
    second.getBlock.mockImplementation(async ({ blockNumber }) => ({ ...point(blockNumber ?? 189n), hash: hash(777) }));
    await expect(source.block(189n)).rejects.toThrow("disagree");
  });
  it("splits busy ranges rather than storing the first page as a complete range", async () => {
    const source = await foundationIndexSource(binding(), [client().api, client().api]);
    const implementation = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async input => ({ ...await implementation(input), nextCursor: hash(1) }));
    await expect(source.launches(100n, 199n, [])).rejects.toBeInstanceOf(IndexRangeTooWide);
  });
  it("rejects a changed factory version, a duplicate canonical token, or a fabricated Router stamp", async () => {
    const memory = memoryStore(), source = await foundationIndexSource(binding(), [client().api, client().api]);
    await syncModuleModeIndex(source, memory.store, { rangeSize: 100n, now: () => now });
    const stored = memory.saved(), row = stored.moduleMode!.items[0];
    expect(isRobinhoodFoundationLaunch({ ...row, stampHash: hash(1) })).toBe(false);
    expect(() => parseSnapshot({ ...stored, moduleMode: { ...stored.moduleMode, factoryVersion: "v3" } })).toThrow("Invalid Module Mode launch");
    expect(() => parseSnapshot({ ...stored, moduleModeSources: [{ ...stored.moduleMode,
      sourceAddress: address(500), releaseDigest: hash(500), items: [{ ...row, sourceAddress: address(500), sourceReleaseDigest: hash(500) }] }] })).toThrow("cross-source");
  });
});

describe("Foundation source inventory authority", () => {
  beforeEach(() => vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL", "https://authority.example"));
  const descriptor = (version: "v1" | "v2" | "v3", id: number) => ({ releaseDigest: hash(id), factoryVersion: version,
    availabilityPath: `/v1/modules/foundation/availability/release/${hash(id)}` });
  it("discovers all retained versions without treating their descriptors as launch authority", async () => {
    const fetcher = vi.fn(async () => Response.json({ schemaVersion: "programmable.module-foundation.release-inventory.v1",
      releases: [descriptor("v1", 1), descriptor("v2", 2), descriptor("v3", 3)] }));
    const result = await configuredFoundationSources(AbortSignal.timeout(1_000), fetcher);
    expect(result.lanes.map(lane => lane.releaseDigest)).toEqual([hash(1), hash(2), hash(3)]);
    expect(result.unavailableSources).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(Response.json(authority("v2", 2)));
    await expect(result.lanes[0].source(AbortSignal.timeout(1_000))).rejects.toThrow("authority differs");
  });
  it("rejects redirected authority paths and duplicate releases", async () => {
    for (const releases of [[{ ...descriptor("v2", 1), availabilityPath: "https://untrusted.example" }], [descriptor("v2", 1), descriptor("v2", 1)]]) {
      await expect(configuredFoundationSources(AbortSignal.timeout(1_000), async () => Response.json({
        schemaVersion: "programmable.module-foundation.release-inventory.v1", releases }))).rejects.toThrow();
    }
  });
  it("explicitly reports incomplete historical discovery during a backend rolling upgrade", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("/releases")
      ? new Response(null, { status: 404 }) : Response.json(authority()));
    const result = await configuredFoundationSources(AbortSignal.timeout(1_000), fetcher);
    expect(result.lanes.map(lane => lane.releaseDigest)).toEqual([hash(1)]);
    expect(result.unavailableSources).toEqual(["FOUNDATION_RELEASE_INVENTORY_UNAVAILABLE"]);
  });
});
