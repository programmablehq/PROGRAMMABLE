import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import deployments from "../lib/custom-ai/deployments.json";
import bundle from "../scripts/custom-ai/core-bundle.json";

it("binds active Custom AI deployments to finalized funded acceptance", () => {
  const raw = readFileSync(new URL("../docs/operations/custom-ai/funded-acceptance-20261022.json", import.meta.url));
  const proof = JSON.parse(raw.toString());
  const digest = createHash("sha256").update(raw).digest("hex");
  expect(proof.complete).toBe(true);
  expect(proof.bundleHash).toBe(bundle.bundleHash);
  expect(proof.sourceVerification).toHaveLength(20);
  for (const [chainId, deployment] of Object.entries(deployments.networks)) {
    if (deployment.status !== "active") continue;
    expect(deployment.acceptanceEvidenceHash).toBe(digest);
    const chain = proof.chains[chainId];
    expect(chain.complete).toBe(true);
    expect(BigInt(chain.finalizedBlock.number)).toBeGreaterThanOrEqual(BigInt(chain.latestTransactionBlock));
    expect(chain.token.factory.toLowerCase()).toBe(deployment.factory.address.toLowerCase());
    expect(chain.token.coreBundleHash).toBe(deployment.bundleHash);
    expect(chain.swaps).toHaveLength(3);
    expect(chain.ledger.platformReceived).toBe(chain.ledger.platformClaimed);
    expect(chain.ledger.additionalReceived).toBe(chain.ledger.additionalClaimed);
    expect(chain.ledger.outstandingBacking).toBe("0");
    expect(chain.claims.platform.recipient.toLowerCase()).toBe("0xd88539d3c4c460136a733a3fd60cf6bf269079da");
    const verified = proof.sourceVerification.filter((row: { chainId: number }) => row.chainId === Number(chainId));
    expect(verified).toHaveLength(10);
    for (const row of verified) {
      expect(["match", "exact_match"]).toContain(row.creationMatch);
      expect(["match", "exact_match"]).toContain(row.runtimeMatch);
    }
  }
});
