import { describe, expect, it } from "vitest";
import { generalGraphFinalizedReceipt, readGeneralWalletResource } from "../lib/custom-ai/general-wallet";
import { readCustomGraphFinalizedTransactionV3 } from "../lib/custom-launch/wallet-handoff-v3";
import { graphFinalityFixture } from "./fixtures/custom-ai-general-wallet-finality-v1";

describe("original Graph finality before journal release", () => {
  it.each(["1", "8453", "999"] as const)("requires owned source, request and exact chain %s two-provider finality", async chainId => {
    const f = graphFinalityFixture(chainId);
    await expect(generalGraphFinalizedReceipt(f.subject, await readGeneralWalletResource(f.subject, f.resource))).resolves.toBe(f.hash);
  });
  it("does not treat a non-final lifecycle state or a successful empty response as finality", async () => {
    const f = graphFinalityFixture();
    await expect(generalGraphFinalizedReceipt(f.subject, await readGeneralWalletResource(f.subject, { ...f.resource, status: "submitted" }))).resolves.toBeNull();
    await expect(readGeneralWalletResource(f.subject, {})).rejects.toThrow();
    const body = { ...f.resource, output: null };
    await expect(generalGraphFinalizedReceipt(f.subject, await readGeneralWalletResource(f.subject, body))).rejects.toThrow();
  });
  it.each(["network", "launch", "depth", "checkpoint", "provider", "quorum"])("retains the attempt when its %s finality evidence differs", kind => {
    const f = graphFinalityFixture(), proof = f.resource.output.onchain;
    if (kind === "network") proof.chainId = "8453";
    if (kind === "launch") proof.onchainLaunchId = `0x${"ff".repeat(32)}`;
    if (kind === "depth") proof.confirmationDepth = "63";
    if (kind === "checkpoint") proof.finalizedCheckpoint.blockNumber = "9";
    if (kind === "provider") proof.finalizedCheckpoint.observations[1].commonBlockHash = `0x${"ff".repeat(32)}`;
    if (kind === "quorum") proof.finalizedCheckpoint.quorumSize = 1;
    expect(() => readCustomGraphFinalizedTransactionV3(proof, { chainId: "1", onchainLaunchId: f.resource.onchainLaunchId })).toThrow();
  });
  it("rejects a finalized resource whose controller or stamped source identity differs", async () => {
    for (const kind of ["controller", "stamp", "chain"]) {
      const f = graphFinalityFixture();
      if (kind === "controller") f.resource.output.artifact.permit.launchWallet = `0x${"ff".repeat(20)}`;
      if (kind === "stamp") f.resource.output.artifact.stampRequest.launchId = `0x${"ff".repeat(32)}`;
      if (kind === "chain") f.resource.output.artifact.permit.chainId = "999";
      await expect(generalGraphFinalizedReceipt(f.subject, await readGeneralWalletResource(f.subject, f.resource))).rejects.toThrow();
    }
  });
});
