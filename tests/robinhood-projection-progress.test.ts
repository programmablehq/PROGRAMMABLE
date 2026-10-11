import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { launchList, parseSnapshot, projectionReadState, tokenLaunchRecord, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { syncLaunchProjectionIndex, type LaunchProjectionSourceV1 } from "@/lib/server/robinhood-index/launch-projection-source";
import type { IndexStore } from "@/lib/server/robinhood-index/store";
import { projectionFixture } from "./fixtures/universal-launch-v1";

const time = Date.parse("2026-10-11T12:00:00Z");
const iso = (offset = 0) => new Date(time + offset).toISOString();
function fixture() {
  let snapshot: RobinhoodSnapshot = { version: 1, chainId: 4663, routerAddress: `0x${"1".repeat(40)}`,
    binding: `0x${"2".repeat(64)}`, startBlock: "1", cursor: { number: "42", hash: `0x${"3".repeat(64)}` },
    checkpoints: [], finalizedBlock: "42", updatedAt: iso(), items: [] };
  let revision = 1;
  const store: IndexStore = {
    read: async () => ({ snapshot: structuredClone(snapshot), etag: String(revision) }),
    write: async (next, etag) => { if (etag !== String(revision)) throw Error("CAS conflict"); snapshot = parseSnapshot(next); revision++; },
  };
  const source: LaunchProjectionSourceV1 = { page: vi.fn(), verify: vi.fn(async () => ({ launchedAt: iso() })) };
  return { store, source, saved: () => snapshot };
}

describe("verified projection traversal progress", () => {
  it("keeps initial sparse pages syncing, then preserves completed coverage during refresh", async () => {
    const { source, store, saved } = fixture();
    vi.mocked(source.page).mockResolvedValueOnce({ launches: [], nextCursor: "more" })
      .mockResolvedValueOnce({ launches: [projectionFixture()], nextCursor: null })
      .mockResolvedValueOnce({ launches: [], nextCursor: "refresh" });
    await syncLaunchProjectionIndex(source, store, () => time);
    expect(launchList(saved(), 1, "", time).status).toBe("syncing");
    expect(saved().launchProjections?.completedAt).toBeNull();
    await syncLaunchProjectionIndex(source, store, () => time + 1000);
    expect(saved().launchProjections?.completedAt).toBe(iso(1000));
    expect(launchList(saved(), 1, "", time + 1000).status).toBe("ready");
    await syncLaunchProjectionIndex(source, store, () => time + 60000);
    expect(source.page).toHaveBeenNthCalledWith(2, "more");
    expect(source.page).toHaveBeenNthCalledWith(3, null);
    expect(saved().launchProjections).toMatchObject({ completedAt: iso(1000), updatedAt: iso(60000), nextCursor: "refresh" });
    expect(projectionReadState(saved().launchProjections!, time + 60000)).toEqual({ status: "ready", updatedAt: iso(1000) });
    const token = saved().launchProjections!.items[0];
    expect(tokenLaunchRecord(saved(), token.tokenAddress, time + 60000)).toMatchObject({ status: "ready", updatedAt: iso(1000) });
    expect(tokenLaunchRecord(saved(), token.tokenAddress, time + 301001).status).toBe("stale");
    saved().updatedAt = iso(301001); // Other sources still advance; page progress cannot conceal this stalled traversal.
    expect(launchList(saved(), 1, "", time + 301001).status).toBe("stale");
  });

  it("does not advance completion or the cursor after verification fails", async () => {
    const { source, store, saved } = fixture();
    vi.mocked(source.page).mockResolvedValueOnce({ launches: [], nextCursor: null })
      .mockResolvedValueOnce({ launches: [projectionFixture()], nextCursor: null });
    await syncLaunchProjectionIndex(source, store, () => time);
    const previous = structuredClone(saved());
    vi.mocked(source.verify).mockRejectedValueOnce(Error("Providers disagree"));
    await expect(syncLaunchProjectionIndex(source, store, () => time + 1000)).rejects.toThrow("Providers disagree");
    expect(saved()).toEqual(previous);
  });

  it("migrates only a completed legacy cursor and rejects invalid completion times", async () => {
    for (const nextCursor of [null, "remaining"]) {
      const { source, store, saved } = fixture();
      saved().launchProjections = { version: 1, sourceUrl: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections",
        updatedAt: iso(), nextCursor, items: [] };
      vi.mocked(source.page).mockResolvedValue({ launches: [], nextCursor: "more" });
      await syncLaunchProjectionIndex(source, store, () => time + 1000);
      expect(saved().launchProjections?.completedAt).toBe(nextCursor === null ? iso() : null);
      expect(projectionReadState(saved().launchProjections!, time + 1000).status).toBe(nextCursor === null ? "ready" : "syncing");
      for (const invalid of ["invalid", iso(2000)]) {
        expect(() => parseSnapshot({ ...saved(), launchProjections: { ...saved().launchProjections, completedAt: invalid } })).toThrow();
      }
    }
  });
});
