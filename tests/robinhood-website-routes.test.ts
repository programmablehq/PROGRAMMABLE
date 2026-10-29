import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexStore } from "@/lib/server/robinhood-index/store";
import type { ModuleModeIndexSource } from "@/lib/server/robinhood-index/sync";
import type { ModuleModeUnavailableSource } from "@/lib/server/robinhood-index/module-source";
import type { RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(), releaseLease: vi.fn(),
  foundationSources: vi.fn(), projectionSync: vi.fn(), projectionSource: vi.fn(), read: vi.fn(), source: vi.fn(), sync: vi.fn(), moduleSync: vi.fn(),
  moduleSources: vi.fn<typeof import("@/lib/server/robinhood-index/module-source").configuredModuleModeSources>(),
  store: vi.fn<() => IndexStore>(), storeRead: vi.fn<IndexStore["read"]>(), storeWrite: vi.fn<IndexStore["write"]>(),
}));
vi.mock("@/lib/server/robinhood-index/source-lease", () => ({ acquireIndexSourceLease: mocks.acquireLease }));
vi.mock("@/lib/server/robinhood-index/foundation-source", () => ({ configuredFoundationSources: mocks.foundationSources }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodLaunches: mocks.read }));
vi.mock("@/lib/server/robinhood-index/launch-projection-source", () => ({ launchProjectionSourceV1: mocks.projectionSource, syncLaunchProjectionIndex: mocks.projectionSync }));
vi.mock("@/lib/server/robinhood-index/source", () => ({ robinhoodSource: mocks.source }));
vi.mock("@/lib/server/robinhood-index/module-source", () => ({ configuredModuleModeSources: mocks.moduleSources }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: mocks.store }));
vi.mock("@/lib/server/robinhood-index/sync", () => ({ syncRobinhoodIndex: mocks.sync, syncModuleModeIndex: mocks.moduleSync }));
import { GET as list } from "@/app/api/explore/robinhood/route";
import { GET as update } from "@/app/api/ops/robinhood-index/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.releaseLease.mockResolvedValue(undefined);
  mocks.acquireLease.mockResolvedValue(mocks.releaseLease);
  mocks.projectionSync.mockRejectedValue(new Error("Projection unavailable"));
  mocks.moduleSources.mockResolvedValue({ lanes: [], unavailableSources: [] });
  mocks.foundationSources.mockResolvedValue({ lanes: [], unavailableSources: [] });
  mocks.storeRead.mockResolvedValue(null);
  mocks.store.mockReturnValue({ read: mocks.storeRead, write: mocks.storeWrite });
  vi.stubEnv("CRON_SECRET", "a".repeat(48));

});
afterEach(() => vi.unstubAllEnvs());

describe("Robinhood website HTTP boundaries", () => {
  it("returns an uncached failure when the saved index cannot be read", async () => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "unavailable", items: [] });
    const response = await list(new Request("https://website.invalid/api/explore/robinhood"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-indexing-status")).toBe("unavailable");
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each(["chainId=1", "page=0", "page=1&page=2", "q=a&q=b", `q=${"x".repeat(129)}`, "age=0", "age=any", "age=7d&age=30d", "sort=market-cap", "sort=oldest&sort=newest", "pageSize=9", "pageSize=10&pageSize=50", "mode=invalid", "mode=module&mode=custom"])("rejects invalid public query %s without reading storage", async (query) => {
    expect((await list(new Request(`https://website.invalid/api/explore/robinhood?${query}`))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.moduleSources).not.toHaveBeenCalled();
  });
  it("reads only the saved list with bounded query values", async () => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    const response = await list(new Request("https://website.invalid/api/explore/robinhood?page=2&q=V4"));
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort: "newest", mode: "all" }, 50);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each(["highest", "lowest", "newest", "oldest", "activity"])("passes %s order to the complete saved list", async (sort) => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    expect((await list(new Request(`https://website.invalid/api/explore/robinhood?page=2&q=V4&sort=${sort}`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort, mode: "all" }, 50);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("passes source filters and the website page size to the saved index", async () => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    expect((await list(new Request("https://website.invalid/api/explore/robinhood?page=2&mode=module&pageSize=10"))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "", { sort: "newest", mode: "module" }, 10);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer wrong", `Bearer ${"b".repeat(48)}`])("does not start background work with invalid authorization", async (authorization) => {
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: authorization ? { authorization } : {},
    }));
    expect(response.status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("does not accept operator overrides in the URL", async () => {
    expect((await update(new Request("https://website.invalid/api/ops/robinhood-index?chain=1", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }))).status).toBe(400);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("drains continuation pages in one job and stops after the completed page", async () => {
    mocks.source.mockRejectedValue(new Error("Custom unavailable"));
    mocks.projectionSync.mockResolvedValueOnce({ status: "syncing", indexed: 1, nextCursor: "next-page" })
      .mockResolvedValueOnce({ status: "ready", indexed: 2, nextCursor: null });
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(mocks.projectionSync).toHaveBeenCalledTimes(2);
    expect(mocks.projectionSource).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ launchProjections: { status: "ready", indexed: 2, nextCursor: null } });
  });
  it("bounds continuation work and preserves committed progress when a later page fails", async () => {
    mocks.source.mockRejectedValue(new Error("Custom unavailable"));
    const progress = { status: "syncing", indexed: 1, nextCursor: "next-page" };
    mocks.projectionSync.mockResolvedValueOnce(progress).mockRejectedValueOnce(new Error("Provider unavailable"));
    const request = () => new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    });
    expect(await (await update(request())).json()).toMatchObject({ launchProjections: progress });
    expect(mocks.projectionSync).toHaveBeenCalledTimes(2);
    mocks.projectionSync.mockReset().mockResolvedValue(progress);
    expect(await (await update(request())).json()).toMatchObject({ launchProjections: progress });
    expect(mocks.projectionSync).toHaveBeenCalledTimes(128);
  });
  it.each(["disabled", "unavailable"])("hides provider credentials when Module Mode is %s", async (moduleStatus) => {
    mocks.source.mockRejectedValue(new Error("https://rpc.invalid/private-key"));
    const unavailableSources: ModuleModeUnavailableSource[] = moduleStatus === "disabled"
      ? [{ releaseId: "module-mode-native-v1", reasonCode: "MODULE_MODE_RELEASE_DISABLED" }] : [];
    if (moduleStatus === "unavailable") mocks.moduleSources.mockRejectedValue(new Error("https://module-rpc.invalid/private-key"));
    else mocks.moduleSources.mockResolvedValue({ lanes: [], unavailableSources });
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "index_update_unavailable", custom: { status: "unavailable" }, launchProjections: { status: "unavailable" }, moduleMode: { status: moduleStatus },
      moduleSources: {}, moduleUnavailableSources: unavailableSources, foundation: "disabled", foundationSources: {}, foundationUnavailableSources: [],
    });
    expect(mocks.moduleSources).toHaveBeenCalledOnce();
    expect(mocks.moduleSources).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(mocks.storeRead).toHaveBeenCalledTimes(1);
    expect(mocks.moduleSync).not.toHaveBeenCalled();
    expect(mocks.storeWrite).not.toHaveBeenCalled();
  });
  it("collects Foundation even when the older Module inventory is unavailable", async () => {
    mocks.source.mockRejectedValue(new Error("Custom unavailable"));
    mocks.moduleSources.mockRejectedValue(new Error("Module authority unavailable"));
    const source = { sourceKind: "module-foundation-v1", factoryVersion: "v3" };
    const sourceFactory = vi.fn(async () => source);
    mocks.foundationSources.mockResolvedValue({ lanes: [{ releaseDigest: "foundation", source: sourceFactory }], unavailableSources: [] });
    mocks.moduleSync.mockResolvedValue({ status: "ready", ranges: 1, launches: 2 });
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ moduleMode: { status: "unavailable" }, foundation: "ready",
      foundationSources: { foundation: { status: "ready", launches: 2 } } });
    expect(sourceFactory).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(mocks.moduleSync).toHaveBeenCalledWith(source, expect.anything(), expect.objectContaining({ rangeSize: 5_000n }));
  });
  it("reports a missing Foundation inventory without suppressing independent Module progress", async () => {
    mocks.source.mockRejectedValue(new Error("Custom unavailable"));
    const source: ModuleModeIndexSource = { sourceKind: "module-native-v2", sourceAddress: `0x${"1".repeat(40)}`,
      releaseDigest: `0x${"2".repeat(64)}`, startBlock: 1n, finalized: { number: "10", hash: `0x${"3".repeat(64)}` },
      block: async number => ({ number: number.toString(), hash: `0x${"3".repeat(64)}` }), launches: async () => [] };
    mocks.moduleSources.mockResolvedValue({ lanes: [{ releaseDigest: "modules", source: vi.fn(async () => source) }], unavailableSources: [] });
    mocks.foundationSources.mockRejectedValue(new Error("Foundation authority unavailable"));
    mocks.moduleSync.mockResolvedValue({ status: "ready" });
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(await response.json()).toMatchObject({ moduleMode: { status: "ready" }, foundation: "unavailable",
      foundationUnavailableSources: ["FOUNDATION_RELEASE_INVENTORY_UNAVAILABLE"] });
    expect(mocks.moduleSync).toHaveBeenCalledWith(source, expect.anything(), expect.not.objectContaining({ rangeSize: 5_000n }));
  });

  it("defers a leased source without starting duplicate provider work", async () => {
    const source = vi.fn();
    mocks.source.mockResolvedValue({});
    mocks.sync.mockResolvedValue({ status: "ready" });
    mocks.projectionSync.mockResolvedValue({ status: "ready", nextCursor: null });
    mocks.foundationSources.mockResolvedValue({ lanes: [{ releaseDigest: "foundation", source }], unavailableSources: [] });
    mocks.acquireLease.mockResolvedValue(null);
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ foundationSources: { foundation: { status: "deferred" } } });
    expect(source).not.toHaveBeenCalled();
    expect(mocks.moduleSync).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });

  it("releases the source lease after a bounded failed attempt", async () => {
    mocks.source.mockResolvedValue({});
    mocks.sync.mockResolvedValue({ status: "ready" });
    mocks.projectionSync.mockResolvedValue({ status: "ready", nextCursor: null });
    mocks.foundationSources.mockResolvedValue({ lanes: [{ releaseDigest: "foundation", source: vi.fn(async () => ({})) }], unavailableSources: [] });
    mocks.moduleSync.mockRejectedValue(new Error("Provider unavailable"));
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(503);
    expect(mocks.moduleSync).toHaveBeenCalledTimes(2);
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });

  it("keeps independent sources progressing after one lease read fails", async () => {
    const first = vi.fn(async () => ({})), second = vi.fn(async () => ({}));
    mocks.source.mockResolvedValue({});
    mocks.sync.mockResolvedValue({ status: "ready" });
    mocks.projectionSync.mockResolvedValue({ status: "ready", nextCursor: null });
    mocks.foundationSources.mockResolvedValue({ lanes: [
      { releaseDigest: "first", source: first }, { releaseDigest: "second", source: second },
    ], unavailableSources: [] });
    mocks.acquireLease.mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(mocks.releaseLease);
    mocks.moduleSync.mockResolvedValue({ status: "ready" });
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(503);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ foundationSources: {
      first: { status: "unavailable" }, second: { status: "ready" },
    } });
  });

  it("reserves a useful oldest-source budget and rotates the other slot without losing checkpoints", async () => {
    const started = Date.parse("2026-10-20T12:00:00Z");
    let clock = started;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
    const source = (id: number, foundation: boolean): ModuleModeIndexSource => ({
      sourceKind: foundation ? "module-foundation-v1" : "module-native-v2",
      ...(foundation ? { factoryVersion: "v2" as const } : {}),
      sourceAddress: `0x${id.toString(16).padStart(40, "0")}`, releaseDigest: hash(id), startBlock: 1n,
      finalized: { number: "20", hash: hash(20) },
      block: async number => ({ number: String(number), hash: hash(Number(number)) }), launches: async () => [],
    });
    const modules = [1, 2, 3, 4].map(id => source(id, false));
    const foundations = [5, 6, 7, 8, 9].map(id => source(id, true));
    const history = [...modules, ...foundations].map((item, index) => ({
      version: 1, chainId: 4663, sourceKind: item.sourceKind, factoryVersion: item.factoryVersion,
      sourceAddress: item.sourceAddress, releaseDigest: item.releaseDigest, startBlock: "1", cursor: { number: "10", hash: hash(10) },
      checkpoints: [], finalizedBlock: "10", updatedAt: new Date(started - (index < 4 ? 0 : 10 - index) * 60_000).toISOString(), items: [],
    }));
    const snapshot = { version: 1, chainId: 4663, routerAddress: `0x${"a".repeat(40)}`, binding: hash(1), startBlock: "1",
      cursor: { number: "10", hash: hash(10) }, checkpoints: [], finalizedBlock: "10", updatedAt: new Date(started).toISOString(),
      items: [], moduleMode: history[0], moduleModeSources: history.slice(1) } as RobinhoodSnapshot;
    try {
      mocks.source.mockResolvedValue({});
      mocks.sync.mockImplementation(async () => { clock += 45_000; return { status: "ready" }; });
      mocks.projectionSync.mockImplementation(async () => { clock += 45_000; return { status: "ready", nextCursor: null }; });
      mocks.storeRead.mockResolvedValue({ snapshot, etag: "saved" });
      mocks.moduleSources.mockResolvedValue({ lanes: modules.map(item => ({ releaseDigest: item.releaseDigest, source: async () => item })), unavailableSources: [] });
      mocks.foundationSources.mockResolvedValue({ lanes: foundations.map(item => ({ releaseDigest: item.releaseDigest, source: async () => item })), unavailableSources: [] });
      mocks.moduleSync.mockImplementation(async () => { clock += 5_000; return { status: "ready" }; });
      const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", { headers: { authorization: `Bearer ${"a".repeat(48)}` } }));
      expect(response.status).toBe(200);
      expect(mocks.moduleSync).toHaveBeenCalledTimes(2);
      expect(mocks.moduleSync.mock.calls.map(([item]) => item.releaseDigest)).toEqual([hash(5), hash(1)]);
      for (const [, , options] of mocks.moduleSync.mock.calls) expect(options.budgetMs).toBeGreaterThanOrEqual(20_000);
      expect(await response.json()).toMatchObject({ foundation: "syncing", moduleMode: { status: "ready" },
        foundationSources: { [hash(5)]: { status: "ready" }, [hash(6)]: { status: "deferred" }, [hash(7)]: { status: "deferred" } } });
      expect(snapshot.moduleModeSources).toEqual(history.slice(1));
    } finally { now.mockRestore(); }
  });
});
