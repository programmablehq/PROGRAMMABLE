import { describe, expect, it } from "vitest";
import { writeIndexLane } from "@/lib/server/robinhood-index/lane-write";
import { parseSnapshot, type ModuleModeSnapshot, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import type { IndexStore } from "@/lib/server/robinhood-index/store";

const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const point = (id: number) => ({ number: String(id), hash: hash(id) });
const at = "2026-10-20T12:00:00.000Z";
const projection = (nextCursor: string | null) => ({ version: 1 as const,
  sourceUrl: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections" as const,
  updatedAt: at, nextCursor, items: [] });
function snapshot(): RobinhoodSnapshot {
  return parseSnapshot({ version: 1, chainId: 4663, routerAddress: `0x${"1".repeat(40)}`, binding: hash(1),
    startBlock: "1", cursor: point(10), checkpoints: [point(10)], finalizedBlock: "20", updatedAt: at, items: [] });
}
function moduleLane(id: number): ModuleModeSnapshot {
  return { version: 1, chainId: 4663, sourceKind: "module-native-v1", sourceAddress: `0x${id.toString(16).padStart(40, "0")}`,
    releaseDigest: hash(id), startBlock: "1", cursor: point(10), checkpoints: [point(10)], finalizedBlock: "20", updatedAt: at, items: [] };
}
function memory(initial = snapshot()) {
  let current = structuredClone(initial), revision = 1, writes = 0;
  const replace = (next: RobinhoodSnapshot) => { current = structuredClone(parseSnapshot(next)); revision++; };
  const store: IndexStore = {
    read: async () => ({ snapshot: structuredClone(current), etag: String(revision) }),
    write: async (next, etag) => { writes++; if (etag !== String(revision)) throw Error("CAS conflict"); replace(next); },
  };
  return { store, replace, saved: () => current, writes: () => writes };
}

describe("concurrent Robinhood index sources", () => {
  it("commits a verified Router range while preserving a newer projection cursor", async () => {
    const m = memory(), saved = await m.store.read();
    const next = { ...saved!.snapshot, cursor: point(20) };
    m.replace({ ...m.saved(), launchProjections: projection("next-page") });
    await writeIndexLane(m.store, saved, next, { kind: "router" });
    expect(m.saved().cursor).toEqual(point(20));
    expect(m.saved().launchProjections?.nextCursor).toBe("next-page");
    expect(m.writes()).toBe(2);
  });

  it("keeps a concurrently installed primary source when adding another module", async () => {
    const m = memory(), saved = await m.store.read();
    const next = { ...saved!.snapshot, moduleMode: moduleLane(2) };
    m.replace({ ...m.saved(), moduleMode: moduleLane(3) });
    await writeIndexLane(m.store, saved, next, { kind: "module", releaseDigest: hash(2) });
    expect(m.saved().moduleMode).toEqual(moduleLane(3));
    expect(m.saved().moduleModeSources).toEqual([moduleLane(2)]);
  });

  it("preserves Router and module progress while saving a verified projection page", async () => {
    const m = memory(), saved = await m.store.read();
    const next = { ...saved!.snapshot, launchProjections: projection("next") };
    m.replace({ ...m.saved(), cursor: point(20), moduleMode: moduleLane(2) });
    await writeIndexLane(m.store, saved, next, { kind: "projections" });
    expect(m.saved()).toMatchObject({ cursor: point(20), moduleMode: moduleLane(2), launchProjections: projection("next") });
  });

  it("rejects a stale checkpoint in the same source", async () => {
    const m = memory(), saved = await m.store.read();
    const newer = { ...m.saved(), cursor: point(20) };
    m.replace(newer);
    await expect(writeIndexLane(m.store, saved, { ...saved!.snapshot, cursor: point(15) }, { kind: "router" })).rejects.toThrow("CAS conflict");
    expect(m.saved()).toEqual(newer);
    expect(m.writes()).toBe(1);
  });

  it("never merges across a canonical Router change", async () => {
    const m = memory(), saved = await m.store.read();
    const newer = { ...m.saved(), binding: hash(99) };
    m.replace(newer);
    await expect(writeIndexLane(m.store, saved, { ...saved!.snapshot, moduleMode: moduleLane(2) },
      { kind: "module", releaseDigest: hash(2) })).rejects.toThrow("CAS conflict");
    expect(m.saved()).toEqual(newer);
  });

  it("accepts an uncertain write only after reading back the exact source", async () => {
    const m = memory(), saved = await m.store.read(), write = m.store.write;
    m.store.write = async (next, etag) => { await write(next, etag); throw Error("connection closed after commit"); };
    await writeIndexLane(m.store, saved, { ...saved!.snapshot, cursor: point(20) }, { kind: "router" });
    expect(m.saved().cursor).toEqual(point(20));
    expect(m.writes()).toBe(1);
  });

  it("does not retry a failed write when storage has not changed", async () => {
    const m = memory(), saved = await m.store.read();
    let attempts = 0;
    m.store.write = async () => { attempts++; throw Error("storage unavailable"); };
    await expect(writeIndexLane(m.store, saved, { ...saved!.snapshot, cursor: point(20) }, { kind: "router" })).rejects.toThrow("storage unavailable");
    expect(attempts).toBe(1);
    expect(m.saved()).toEqual(saved!.snapshot);
  });
});
