import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicPolicyDescription } from "../lib/custom-launch/v4-public-contract-discovery";

const discovery = {
  status: "source-candidate", activationStage: "pending", activationScope: "public-self-serve", publication: "pending",
  cliReleased: false, cliInstallable: false, cliRelease: null, releaseReady: false, publicAuthorization: false,
  publicWrites: false, activationBlockers: ["test-activation-blocker"],
};
async function document(profileVersion: "4.0.0" | "4.1.0", ready = false) {
  vi.resetModules();
  vi.doMock("../lib/custom-launch/v4-api-discovery", () => ({ V4_API_PROFILE_VERSION: profileVersion,
    V4_API_DISCOVERY: { ...discovery, ...(ready ? { status: "live", cliReleased: true, cliInstallable: true,
      cliRelease: "4.1.0", releaseReady: true, publicAuthorization: true, publicWrites: true, activationBlockers: [] } : {}) } }));
  return (await import("../lib/public-openapi")).programmablePublicOpenApi;
}
afterEach(() => { vi.doUnmock("../lib/custom-launch/v4-api-discovery"); vi.resetModules(); });

describe("profile selected public Robinhood API contract", () => {
  it("leaves the historical contract untouched and never selects an unknown successor", () => {
    expect(robinhoodV4PublicContractDiscovery("4.0.0")).toEqual({});
    expect(robinhoodV4PublicContractDiscovery("4.2.0")).toEqual({});
    const legacy = "Existing Ethereum and Robinhood 4.0 wording.";
    expect(robinhoodV4PublicPolicyDescription("4.0.0", legacy)).toBe(legacy);
  });

  it("preserves the historical launch profile while website OpenAPI adds completed and early index observations", async () => {
    const actual = await document("4.0.0");
    expect(actual.info.version).toBe("1.18.0");
    const previous = JSON.parse(JSON.stringify(actual));
    previous.info.version = "1.15.0";
    const health = JSON.parse(readFileSync(new URL("./fixtures/public-ops-health-website-v116.json", import.meta.url), "utf8"));
    previous.paths["/api/ops/health"].get = health.operation;
    previous.components.schemas.OperationsHealth = health.schema;
    previous.components.schemas.EthereumExplorePage.properties.presentations.items.properties.market = { type: "null" };
    const ethereumItems = previous.components.schemas.EthereumExplorePage.properties.items;
    expect(ethereumItems.items.oneOf).toHaveLength(2);
    expect(ethereumItems.items.oneOf[1]).toMatchObject({
      additionalProperties: false,
      properties: { confirmation: { const: "confirming" }, observationExpiresAt: { type: "integer" } },
      description: expect.stringContaining("Not finalized provenance or authorization to trade"),
    });
    // The additive display-only variant may change; the canonical contract must not.
    ethereumItems.items = ethereumItems.items.oneOf[0];
    for (const kind of ["classic", "custom"]) {
      const source = previous.components.schemas.EthereumExplorePage.properties.sourceEvidence.properties[kind].anyOf[0].properties;
      expect(source.source).toEqual({ enum: ["codex-classic-launches", "canonical-launch-stamp-router"] });
      expect(source.releaseDigest).toEqual({ $ref: "#/components/schemas/Sha256Digest" });
      expect(source.provider).toEqual({ const: "codex" });
      expect(source.observedAt).toEqual({ type: "string", format: "date-time" });
      source.source = { enum: ["envio-classic-v3", "canonical-launch-stamp-router"] };
      delete source.releaseDigest;
      delete source.provider;
      delete source.observedAt;
      source.deployment = { type: "string" };
      source.sourceCommit = { type: "string" };
    }
    const projection = previous.components.schemas.RobinhoodExplorePage.properties.sourceEvidence.anyOf[0].properties.launchProjections.anyOf[0];
    expect(projection.properties.completedAt).toMatchObject({ description: expect.stringContaining("Last fully verified traversal") });
    expect(projection.required).toEqual(["sourceUrl", "updatedAt", "nextCursor"]);
    delete projection.properties.completedAt;
    const operation = previous.paths["/api/explore/robinhood"].get;
    expect(operation.description).toContain("routine projection refreshes preserve that completed observation");
    operation.description = operation.description.replace(
      "ready means each block source has reached its finalized cursor and the projection feed has a completed traversal within five minutes; routine projection refreshes preserve that completed observation; syncing means an admitted source is still catching up without completed coverage;",
      "ready means each saved source has reached its finalized cursor; syncing means an admitted source is still catching up;",
    );
    const serialized = JSON.stringify(previous);
    const sources = '"enum":["codex","dexscreener","uniswap-v4"]';
    expect(serialized).toContain(sources);
    // Only the explicitly normalized website observations may differ from the historical launch contract.
    const historical = serialized.replace(sources, '"enum":["dexscreener","uniswap-v4"]');
    const expectedDigest = readFileSync(new URL("./fixtures/public-openapi-v40-website-v115.sha256", import.meta.url), "utf8").trim();
    expect(createHash("sha256").update(historical).digest("hex")).toBe(expectedDigest);
  });

  it("shows successor rules without promoting pending release or wallet authority", async () => {
    const doc = await document("4.1.0");
    const v4 = doc["x-programmable-availability"].v4;
    expect(v4).toMatchObject({ profileVersion: "4.1.0", cliVersion: "4.1.0", publicWrites: false,
      publicAuthorization: false, releaseReady: false, released: false, installable: false, releaseBlockers: ["test-activation-blocker"],
      openApiUrl: "https://programmable.market/openapi/custom-launch-v4.1.json",
      packConfigSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json",
      sourceVerificationSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json",
      fundingPlan: { required: true, gasAdditionalToLaunchValue: true, buildOnlyCreatesPermits: false },
      initialBuy: { minimumUsd: "1", assessmentTime: "permit-authorization", executionChainId: 4663, referenceChainId: 1,
        quotePath: "/v4/chains/4663/initial-buy-quote", quoteAuthentication: "none", staleFallback: false,
        walletExecutionUsdValueGuaranteed: false, firstTradeIndexingGuaranteed: false },
      platformFeePolicy: { rateBps: 20, basis: "gross-native-leg-once-per-successful-swap", feeCurrency: "native-ETH",
        accrual: "pool-manager-native-claims", claimMechanism: "permissionless-fixed-recipient", rounding: "ceil-per-trade",
        canonicalOnchainEnforcementProven: false, guaranteedRevenue: false, universalFeeBehaviorClaim: false },
      genericFeeClaiming: "not-live", externalIndexingGuaranteed: false, cliWalletAuthority: false });
    expect(doc.info.description).toContain("exact server-verified native fee kernel");
    expect(doc.info.description).not.toContain("missing onchain fee enforcement is not itself a write blocker");
    expect(doc["x-programmable-boundary"].actions).not.toContain("missing onchain fee enforcement is not itself a write blocker");
    expect(doc["x-programmable-api-scopes"]["custom-launch:create"].description).not.toContain("non-fee release predicates");
    expect(doc["x-programmable-api-scopes"]["fees:claim"].state).toBe("reserved-disabled");
  });

  it("preserves Ethereum, paths and schemas while released V4.1 fresh writes stay retired", async () => {
    const old = await document("4.0.0");
    const next = await document("4.1.0", true);
    const { v4: oldV4, ...oldOther } = old["x-programmable-availability"];
    const { v4: nextV4, ...nextOther } = next["x-programmable-availability"];
    expect(nextOther).toEqual(oldOther);
    expect(next.paths).toEqual(old.paths);
    expect(next.components).toEqual(old.components);
    expect(next["x-programmable-wallet-authorization-gate"]).toEqual(old["x-programmable-wallet-authorization-gate"]);
    expect(nextV4.publicWrites).toBe(false);
    expect(nextV4.publicAuthorization).toBe(false);
    expect(nextV4.releaseReady).toBe(true);
    expect(oldV4.publicWrites).toBe(false);
    for (const field of ["publicWrites", "publicAuthorization", "releaseReady", "released", "installable", "releaseBlockers"]) {
      expect(robinhoodV4PublicContractDiscovery("4.1.0")).not.toHaveProperty(field);
    }
  });
});
