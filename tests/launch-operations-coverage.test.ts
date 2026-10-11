import { describe, expect, it, vi } from "vitest";
import { projectionFixture } from "./fixtures/universal-launch-v1";
import { buildOperationsRows, type OperationsReview, type OperationsSnapshot } from "@/lib/launch-operations";
import { readRobinhoodOperationsFeed, type OperationsFeedState, type OperationsFeedStore } from "@/lib/server/launch-operations-robinhood-feed";
vi.mock("server-only", () => ({}));

const now = Date.parse("2026-10-11T18:00:00Z");
function projection(index: number, listed = true) {
  const base = projectionFixture();
  return { ...base, launchId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    planHash: `sha256:${(index + 1).toString(16).padStart(64, "0")}` as const,
    components: [{ ...base.components[0], expectedAddress: `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}` }],
    publication: { visibility: listed ? "listed" as const : "unlisted" as const } };
}
function memory() {
  let state: OperationsFeedState | null = null, version = 0;
  const store: OperationsFeedStore = {
    read: async () => state && { state: structuredClone(state), etag: String(version) },
    write: vi.fn(async (next, etag) => {
      if (etag !== (state ? String(version) : null)) throw new Error("Version changed");
      state = structuredClone(next); version++;
    }),
  };
  return { store };
}
describe("independent resumable Robinhood observations", () => {
  it("resumes beyond 20 pages across instances, including empty pages and an unlisted final launch", async () => {
    const { store } = memory(); let clock = now;
    const page = vi.fn(async (cursor: string | null) => {
      const number = Number(cursor ?? 0);
      return { launches: number === 23 ? [] : [projection(number, number !== 24)], nextCursor: number === 24 ? null : String(number + 1) };
    });
    const first = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock, maxPages: 20 });
    expect(first).toMatchObject({ status: "partial", complete: false }); expect(first.rows).toHaveLength(20);
    clock += 11_000;
    const complete = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock });
    expect(page.mock.calls[20]).toEqual(["20"]);
    expect(complete).toMatchObject({ status: "ready", complete: true }); expect(complete.rows).toHaveLength(24);
    expect(complete.rows.at(-1)).toMatchObject({ launchId: projection(24).launchId, listed: false });
    expect((await store.read())!.state.nextCursor).toBeNull();
    expect((await store.read())!.state.pendingRows).toEqual([]);
  });

  it("detects independently finalized launches missing from the index and completes unlisted reviews", async () => {
    const { store } = memory(), publicLaunch = projection(0), hiddenLaunch = projection(1, false);
    const result = await readRobinhoodOperationsFeed({ store, source: { page: async () => ({ launches: [publicLaunch, hiddenLaunch], nextCursor: null }) }, now: () => now });
    const snapshot: OperationsSnapshot = { schemaVersion: "programmable.launch-operations.v1", checkedAt: new Date(now).toISOString(),
      indexed: [], recent: [], published: result.rows, sources: [{ id: "index:4663", label: "Robinhood", chainId: 4663, status: "ready", count: 0, complete: true, updatedAt: result.updatedAt }] };
    const review: OperationsReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "20000000-0000-4000-8000-000000000001",
      launchId: hiddenLaunch.launchId, subjectHash: hiddenLaunch.planHash, chainId: "4663", controller: hiddenLaunch.controller,
      state: "approved", revision: 1, submittedAt: result.updatedAt, approvedAt: result.updatedAt, expiresAt: result.updatedAt,
      launchRequestedAt: null, launchDeadline: null, reason: null, requestSummary: {} };
    const rows = buildOperationsRows([review], snapshot, now);
    expect(rows.find(row => row.reviewId === review.reviewId)).toMatchObject({ group: "complete", status: "Launched · unlisted" });
    expect(rows.find(row => !row.reviewId)).toMatchObject({ group: "attention", status: "Index not observed" });
  });

  it("keeps the complete pass during a failed refresh and never refreshes its completion time", async () => {
    const { store } = memory(); let clock = now;
    const source = { page: vi.fn().mockResolvedValueOnce({ launches: [projection(0)], nextCursor: null }).mockRejectedValueOnce(new Error("Unavailable")) };
    const first = await readRobinhoodOperationsFeed({ store, source, now: () => clock });
    clock += 11_000;
    const failed = await readRobinhoodOperationsFeed({ store, source, now: () => clock });
    expect(failed).toMatchObject({ status: "stale", complete: false, updatedAt: first.updatedAt, rows: first.rows });
    expect((await store.read())!.state.completedAt).toBe(first.updatedAt);
  });

  it("retains older completed records while a later pass is still paging", async () => {
    const { store } = memory(); let clock = now;
    const page = vi.fn().mockResolvedValueOnce({ launches: [projection(0), projection(1)], nextCursor: null })
      .mockResolvedValueOnce({ launches: [projection(2)], nextCursor: "older" })
      .mockResolvedValueOnce({ launches: [projection(0), projection(1)], nextCursor: null });
    const complete = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock });
    clock += 11_000;
    const progress = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock, maxPages: 1 });
    expect(progress.rows).toHaveLength(3); expect(progress.updatedAt).toBe(complete.updatedAt);
    clock += 301_000;
    const next = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock });
    expect(next).toMatchObject({ status: "ready", complete: true }); expect(next.rows).toHaveLength(3);
    expect(next.updatedAt).not.toBe(complete.updatedAt);
  });

  it("uses a concurrent writer's checkpoint instead of overwriting newer progress", async () => {
    const { store } = memory();
    await readRobinhoodOperationsFeed({ store, source: { page: async () => ({ launches: [projection(0)], nextCursor: null }) }, now: () => now });
    const winner = (await store.read())!;
    const conflict: OperationsFeedStore = { read: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(winner), write: vi.fn().mockRejectedValue(new Error("Precondition failed")) };
    const result = await readRobinhoodOperationsFeed({ store: conflict,
      source: { page: async () => ({ launches: [projection(1)], nextCursor: "next" }) }, now: () => now, maxPages: 1 });
    expect(result).toMatchObject({ complete: true, rows: winner.state.rows });
    expect(conflict.write).toHaveBeenCalledTimes(1);
  });

  it("rejects a cursor cycle across separate batches and does not include non-finalized data", async () => {
    const { store } = memory(); let clock = now;
    const page = vi.fn().mockResolvedValueOnce({ launches: [projection(0)], nextCursor: "next" })
      .mockResolvedValueOnce({ launches: [projection(1)], nextCursor: "next" })
      .mockResolvedValueOnce({ launches: [{ ...projection(2), finality: { ...projection(2).finality, status: "pending" } }], nextCursor: null });
    await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock, maxPages: 1 });
    clock += 11_000;
    const cycle = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock });
    expect(cycle.complete).toBe(false); expect(cycle.rows).toHaveLength(1);
    clock += 11_000;
    const unconfirmed = await readRobinhoodOperationsFeed({ store, source: { page }, now: () => clock });
    expect(unconfirmed.complete).toBe(false); expect(unconfirmed.rows).toHaveLength(1);
  });
});
