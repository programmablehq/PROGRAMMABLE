import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/base-finalized-custom-launch-metadata-feed-v1.json";

vi.mock("server-only", () => ({}));
const readFeed = vi.hoisted(() => vi.fn());
vi.mock("../lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1", () => ({
  createFinalizedCustomLaunchMetadataFeedReaderV1: () => readFeed,
}));
vi.mock("../lib/server/codex-market", () => ({ readCodexMarkets: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("../lib/server/hyperevm-market", () => ({ enrichHyperEvmMarkets: vi.fn().mockResolvedValue(new Map()) }));
import { createEvmCustomExploreReaders } from "../lib/server/evm-custom-explore";

beforeEach(() => vi.clearAllMocks());

describe.each([8453, 999] as const)("chain %s finalized catalog completeness", chainId => {
  it.each(["current", "last-known-good"] as const)("keeps partial %s feeds partial with source diagnostics", async status => {
    const quality = { status: "partial", sourceRowCount: 1, publishedRowCount: 0, quarantinedRowCount: 1,
      diagnostics: [{ rowIndex: 0, code: "FINALIZED_ROW_QUARANTINED" }] };
    readFeed.mockResolvedValue({ ...fixture, status, launches: [], quality, retainedRowCount: 0 });
    const readers = createEvmCustomExploreReaders(chainId);
    expect(await readers.readCatalog()).toMatchObject({ status: "partial", items: [],
      sourceEvidence: { freshness: status, quality, retainedRecords: 0 } });
    await expect(readers.readLaunchEvidence(fixture.launches[0].token)).rejects.toThrow(/stale/);
  });

  it("exposes retained identities as partial and recovers to ready after a complete refresh", async () => {
    readFeed.mockResolvedValueOnce({ ...fixture, status: "current", retainedRowCount: 1,
      quality: { status: "partial", sourceRowCount: 1, publishedRowCount: 0, quarantinedRowCount: 1,
        diagnostics: [{ rowIndex: 0, code: "FINALIZED_ROW_QUARANTINED" }] } });
    const readers = createEvmCustomExploreReaders(chainId);
    expect(await readers.readCatalog()).toMatchObject({ status: "partial", items: [{ tokenAddress: fixture.launches[0].token }],
      sourceEvidence: { retainedRecords: 1 } });
    readFeed.mockResolvedValueOnce({ ...fixture, status: "current", retainedRowCount: 0,
      quality: { status: "complete", sourceRowCount: 1, publishedRowCount: 1, quarantinedRowCount: 0, diagnostics: [] } });
    expect(await readers.readCatalog()).toMatchObject({ status: "ready", sourceEvidence: { retainedRecords: 0 } });
  });
});
