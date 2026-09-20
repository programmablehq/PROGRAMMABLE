import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexStore } from "@/lib/server/robinhood-index/store";
import type { ModuleModeIndexSource } from "@/lib/server/robinhood-index/sync";
import type { ModuleModeUnavailableSource } from "@/lib/server/robinhood-index/module-source";

const mocks = vi.hoisted(() => ({
  foundationSources: vi.fn(), projectionSync: vi.fn(), projectionSource: vi.fn(), read: vi.fn(), source: vi.fn(), sync: vi.fn(), moduleSync: vi.fn(),
  moduleSources: vi.fn<typeof import("@/lib/server/robinhood-index/module-source").configuredModuleModeSources>(),
  store: vi.fn<() => IndexStore>(), storeRead: vi.fn<IndexStore["read"]>(), storeWrite: vi.fn<IndexStore["write"]>(),
}));
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
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort: "highest", mode: "all" }, 50);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each(["highest", "lowest", "newest", "oldest"])("passes %s order to the complete saved list", async (sort) => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    expect((await list(new Request(`https://website.invalid/api/explore/robinhood?page=2&q=V4&sort=${sort}`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort, mode: "all" }, 50);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("passes source filters and the website page size to the saved index", async () => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    expect((await list(new Request("https://website.invalid/api/explore/robinhood?page=2&mode=module&pageSize=10"))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "", { sort: "highest", mode: "module" }, 10);
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

});
