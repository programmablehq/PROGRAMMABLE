import { moduleModeSnapshots, parseSnapshot, type RobinhoodSnapshot } from "./model";
import type { IndexStore } from "./store";

type SavedIndex = Awaited<ReturnType<IndexStore["read"]>>;
type Lane = { kind: "router" } | { kind: "module"; releaseDigest: string } | { kind: "projections" };
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function router(snapshot: RobinhoodSnapshot) {
  return { version: snapshot.version, chainId: snapshot.chainId, routerAddress: snapshot.routerAddress,
    binding: snapshot.binding, startBlock: snapshot.startBlock, cursor: snapshot.cursor,
    checkpoints: snapshot.checkpoints, pending: snapshot.pending ?? null, finalizedBlock: snapshot.finalizedBlock,
    updatedAt: snapshot.updatedAt, items: snapshot.items };
}

function anchor(snapshot: RobinhoodSnapshot) {
  return [snapshot.version, snapshot.chainId, snapshot.routerAddress, snapshot.binding, snapshot.startBlock];
}

function value(snapshot: RobinhoodSnapshot | undefined, lane: Lane) {
  if (!snapshot) return null;
  if (lane.kind === "router") return router(snapshot);
  if (lane.kind === "projections") return snapshot.launchProjections ?? null;
  return moduleModeSnapshots(snapshot).find(source => source.releaseDigest.toLowerCase() === lane.releaseDigest.toLowerCase()) ?? null;
}

function merge(current: RobinhoodSnapshot, next: RobinhoodSnapshot, lane: Lane): RobinhoodSnapshot {
  if (lane.kind === "router") {
    return parseSnapshot({ ...current, ...router(next), pending: next.pending ?? null });
  }
  if (lane.kind === "projections") return parseSnapshot({ ...current, launchProjections: next.launchProjections });
  const source = moduleModeSnapshots(next).find(item => item.releaseDigest.toLowerCase() === lane.releaseDigest.toLowerCase());
  if (!source) throw new Error("Updated index source is missing");
  if (!current.moduleMode || current.moduleMode.releaseDigest.toLowerCase() === lane.releaseDigest.toLowerCase()) {
    return parseSnapshot({ ...current, moduleMode: source });
  }
  return parseSnapshot({ ...current, moduleModeSources: [
    ...(current.moduleModeSources ?? []).filter(item => item.releaseDigest.toLowerCase() !== lane.releaseDigest.toLowerCase()), source,
  ] });
}

/** Rebase only an unchanged source after a competing source wins the Blob CAS.
 * A newer checkpoint in this source, or a changed Router binding, still wins.
 * An uncertain write is accepted only after the exact source is read back. */
export async function writeIndexLane(store: IndexStore, saved: SavedIndex, next: RobinhoodSnapshot, lane: Lane) {
  const baseline = value(saved?.snapshot, lane), desired = value(next, lane);
  const expectedAnchor = anchor(saved?.snapshot ?? next);
  let candidate = parseSnapshot(next), etag = saved?.etag ?? null;
  for (let attempt = 0; ; attempt++) {
    try { await store.write(candidate, etag); return; }
    catch (error) {
      if (attempt >= 3) throw error;
      const current = await store.read();
      if (!current || !same(anchor(current.snapshot), expectedAnchor)) throw error;
      const observed = value(current.snapshot, lane);
      if (same(observed, desired)) return;
      if (current.etag === etag || !same(observed, baseline)) throw error;
      candidate = merge(current.snapshot, next, lane);
      etag = current.etag;
    }
  }
}
