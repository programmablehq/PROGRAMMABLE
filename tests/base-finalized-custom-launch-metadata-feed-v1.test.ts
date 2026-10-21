import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/base-finalized-custom-launch-metadata-feed-v1.json";

vi.mock("server-only", () => ({}));

import { readFinalizedCustomLaunchMetadataPagesV1 } from "../lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1";

// Public Base feed captured after the funded launch reached independent finality.
async function readFeed(page = structuredClone(fixture)) {
  return readFinalizedCustomLaunchMetadataPagesV1({
    chainId: "8453",
    now: () => Date.parse(fixture.generatedAt),
    timeoutMs: 50,
    fetchFeed: (async () => new Response(JSON.stringify(page), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=15, stale-while-revalidate=300",
      },
    })) as typeof fetch,
  });
}

describe("public Base finalized launch feed", () => {
  it("accepts the published checkpoint contract and preserves the launch identity", async () => {
    const result = await readFeed();
    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toMatchObject({
      chainId: "8453",
      resourceId: fixture.launches[0].resourceId,
      token: fixture.launches[0].token,
      finality: fixture.launches[0].finality,
    });
  });

  it.each([
    "programmable.ethereum-finalized-checkpoint-quorum.v1",
    "programmable.base-finalized-checkpoint-quorum.v1",
  ])("rejects a checkpoint from another contract: %s", async schemaVersion => {
    const page = structuredClone(fixture);
    page.launches[0].finality.finalizedCheckpoint.schemaVersion = schemaVersion;
    await expect(readFeed(page)).rejects.toThrow(/checkpoint is invalid/u);
  });

  it("rejects providers that disagree about the common block", async () => {
    const page = structuredClone(fixture);
    page.launches[0].finality.finalizedCheckpoint.observations[1].commonBlockHash = `0x${"11".repeat(32)}`;
    await expect(readFeed(page)).rejects.toThrow(/checkpoint quorum is invalid/u);
  });

  it("requires both independent provider positions", async () => {
    const page = structuredClone(fixture);
    page.launches[0].finality.finalizedCheckpoint.observations[1].provider = "primary";
    await expect(readFeed(page)).rejects.toThrow(/provider order is invalid/u);
  });

  it("rejects a provider that has not finalized the common block", async () => {
    const page = structuredClone(fixture);
    const checkpoint = page.launches[0].finality.finalizedCheckpoint;
    checkpoint.observations[1].finalizedBlockNumber = String(BigInt(checkpoint.blockNumber) - 1n);
    await expect(readFeed(page)).rejects.toThrow(/provider checkpoint is invalid/u);
  });

  it("rejects a checkpoint before the launch", async () => {
    const page = structuredClone(fixture);
    page.launches[0].finality.blockNumber = String(BigInt(page.launches[0].finality.finalizedCheckpoint.blockNumber) + 1n);
    await expect(readFeed(page)).rejects.toThrow(/checkpoint predates the launch/u);
  });

  it("still requires the full confirmation depth", async () => {
    const page = structuredClone(fixture);
    page.launches[0].finality.confirmationDepth = "63";
    await expect(readFeed(page)).rejects.toThrow(/confirmation depth is invalid/u);
  });
});
