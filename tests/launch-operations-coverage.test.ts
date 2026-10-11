import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectionFixture, hash } from "./fixtures/universal-launch-v1";
import { projectionToRobinhoodLaunch } from "@/lib/custom-launch/launch-projection-v1";
import type { RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { buildOperationsRows, type OperationsReview } from "@/lib/launch-operations";

const mocks = vi.hoisted(() => ({ read: vi.fn(), page: vi.fn(), write: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: () => ({ read: mocks.read, write: mocks.write }) }));
vi.mock("@/lib/server/robinhood-index/launch-projection-source", () => ({ launchProjectionSourceV1: () => ({ page: mocks.page }) }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumUnifiedExploreCatalog: async () => ({ status: "ready", entries: [] }) }));
vi.mock("@/lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1", () => ({ readProductionFinalizedCustomLaunchMetadataFeedV1: async () => ({ status: "current", launches: [] }) }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ readRecentFoundationLaunches: async () => [] }));
import { createOperationsSnapshotReader } from "@/lib/server/launch-operations";

const now = Date.parse("2026-10-11T18:00:00Z"), fresh = new Date(now).toISOString();
function fixture(): RobinhoodSnapshot {
  const items = Array.from({ length: 241 }, (_, index) => {
    const base = projectionFixture();
    const projection = { ...base, launchId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      planHash: `sha256:${(index + 1).toString(16).padStart(64, "0")}` as const,
      components: [{ ...base.components[0], expectedAddress: `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}` }],
      publication: index === 240 ? { visibility: "unlisted" as const } : null };
    return projectionToRobinhoodLaunch(projection, fresh);
  });
  return { version: 1, chainId: 4663, routerAddress: `0x${"1".repeat(40)}`, binding: hash, startBlock: "1",
    cursor: { number: "42", hash }, checkpoints: [], finalizedBlock: "42", updatedAt: fresh, items: [],
    launchProjections: { version: 1, sourceUrl: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections",
      updatedAt: fresh, completedAt: fresh, nextCursor: null, items } };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now); vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "fixture");
  // Reproduces the old collector: every page has a continuation, including empty pages.
  mocks.page.mockImplementation(async (cursor: string | null) => ({ launches: [], nextCursor: String(Number(cursor ?? 0) + 1) }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("complete saved Robinhood observations", () => {
  it("recognizes a completed unlisted launch beyond 20 pages without re-fetching the feed", async () => {
    const saved = fixture(), last = saved.launchProjections!.items[240];
    mocks.read.mockResolvedValue({ snapshot: saved });
    const snapshot = await createOperationsSnapshotReader()();
    expect(snapshot.published).toHaveLength(241);
    expect(snapshot.sources.find(source => source.id === "feed:4663")).toMatchObject({ status: "ready", complete: true, count: 241 });
    const review: OperationsReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "20000000-0000-4000-8000-000000000001",
      launchId: last.launchId, subjectHash: last.launchProjection!.planHash!, chainId: "4663", controller: last.creator,
      state: "approved", revision: 1, submittedAt: fresh, approvedAt: fresh, expiresAt: fresh,
      launchRequestedAt: null, launchDeadline: null, reason: null, requestSummary: {} };
    expect(buildOperationsRows([review], snapshot, now).find(row => row.reviewId === review.reviewId)).toMatchObject({ group: "complete", status: "Launched · unlisted" });
    expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it("retains finalized rows during a stale refresh and excludes unconfirmed pending rows", async () => {
    const saved = fixture(), stale = new Date(now - 300_001).toISOString();
    saved.launchProjections!.completedAt = stale; saved.launchProjections!.nextCursor = "refresh-in-progress";
    saved.pending = { block: { number: "43", hash }, items: [{ ...saved.launchProjections!.items[0], launchId: "not-finalized" }] };
    mocks.read.mockResolvedValue({ snapshot: saved });
    const snapshot = await createOperationsSnapshotReader()();
    expect(snapshot.sources.find(source => source.id === "feed:4663")).toMatchObject({ status: "stale", complete: false });
    expect(snapshot.published).toHaveLength(241);
    expect(snapshot.published.some(row => row.launchId === "not-finalized")).toBe(false);
  });

  it("does not report complete coverage without a saved projection traversal", async () => {
    const saved = fixture(); saved.launchProjections = null;
    mocks.read.mockResolvedValue({ snapshot: saved });
    const snapshot = await createOperationsSnapshotReader()();
    expect(snapshot.sources.find(source => source.id === "feed:4663")).toMatchObject({ status: "partial", complete: false });
  });
});
