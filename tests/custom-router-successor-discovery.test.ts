import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { filterUnseenSuccessorDiscoveryCandidatesV1, mergeSuccessorDiscoveryCandidatesV1 } from "../lib/alchemy/custom-router-successor.server";
import { CANONICAL_LAUNCH_STAMP_24H_V1 } from "../lib/tokens";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
const saved = () => ({ ...customGraphExploreEntry, launchStampProvenance: {
  ...customGraphExploreEntry.launchStampProvenance!, routerAddress: CANONICAL_LAUNCH_STAMP_24H_V1.routerAddress,
  routerRuntimeCodeHash: CANONICAL_LAUNCH_STAMP_24H_V1.routerRuntimeCodeHash,
} });
describe("successor discovery survives optional metadata removal", () => {
  it("keeps a saved launch as an onchain discovery hint when the feed omits it", () => {
    const entry = saved(), stamp = entry.launchStampProvenance;
    const hints = mergeSuccessorDiscoveryCandidatesV1([], [entry], BigInt(stamp.blockNumber));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ token: entry.tokenAddress, routerLaunchId: stamp.launchId,
      finality: { blockHash: stamp.blockHash, logIndex: stamp.launchLogIndex } });
    expect(mergeSuccessorDiscoveryCandidatesV1(hints, [entry], BigInt(stamp.blockNumber))).toHaveLength(1);
  });
  it("retains the chain, router runtime, boundary and conflicting-identity checks", () => {
    const entry = saved(), stamp = entry.launchStampProvenance;
    expect(mergeSuccessorDiscoveryCandidatesV1([], [entry], BigInt(stamp.blockNumber) - 1n)).toHaveLength(0);
    expect(mergeSuccessorDiscoveryCandidatesV1([], [customGraphExploreEntry], BigInt(stamp.blockNumber))).toHaveLength(0);
    const hints = mergeSuccessorDiscoveryCandidatesV1([], [entry], BigInt(stamp.blockNumber));
    expect(() => mergeSuccessorDiscoveryCandidatesV1([{ ...hints[0], finality: {
      ...hints[0].finality, logIndex: hints[0].finality.logIndex + 1,
    } }], [entry], BigInt(stamp.blockNumber))).toThrow("Conflicting successor");
  });

  it("does not rehydrate an identity already present in the authoritative cursor", () => {
    const entry = saved(), stamp = entry.launchStampProvenance;
    const hints = mergeSuccessorDiscoveryCandidatesV1([], [entry], BigInt(stamp.blockNumber));
    expect(filterUnseenSuccessorDiscoveryCandidatesV1(hints, [entry])).toHaveLength(0);
    expect(filterUnseenSuccessorDiscoveryCandidatesV1(hints, [])).toHaveLength(1);
  });

  it("rejects a metadata candidate that conflicts with a known onchain identity", () => {
    const entry = saved(), stamp = entry.launchStampProvenance;
    const hints = mergeSuccessorDiscoveryCandidatesV1([], [entry], BigInt(stamp.blockNumber));
    expect(() => filterUnseenSuccessorDiscoveryCandidatesV1([
      { ...hints[0], token: "0x2222222222222222222222222222222222222222" },
    ], [entry])).toThrow("Conflicting successor");
  });
});
