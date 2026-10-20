import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const pendingDiscovery = {
  status: "source-candidate", activationStage: "pending", activationScope: "public-self-serve",
  publication: "pending", cliReleased: false, cliInstallable: false, cliRelease: null,
  releaseReady: false, publicAuthorization: false, publicWrites: false,
  activationBlockers: ["test-activation-blocker"],
};

async function document(profileVersion: "4.0.0" | "4.1.0", ready = false) {
  vi.resetModules();
  vi.doMock("../lib/custom-launch/v4-api-discovery", () => ({
    V4_API_PROFILE_VERSION: profileVersion,
    V4_API_DISCOVERY: {
      ...pendingDiscovery,
      ...(ready ? {
        status: "live", activationStage: "api-until-wallet", cliReleased: true,
        cliInstallable: true, cliRelease: "4.1.0", releaseReady: true,
        publicAuthorization: true, publicWrites: true, activationBlockers: [],
      } : {}),
    },
  }));
  const [{ programmableWellKnownDocumentV1 }, { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 }] = await Promise.all([
    import("../lib/server/custom-launch/well-known-v1"),
    import("../lib/custom-launch/registry-public-manifest-v1"),
  ]);
  return programmableWellKnownDocumentV1(PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1);
}

afterEach(() => {
  vi.doUnmock("../lib/custom-launch/v4-api-discovery");
  vi.resetModules();
});

describe("profile-selected Robinhood well-known discovery", () => {
  it("pins historical Robinhood discovery alongside current Ethereum version selection", async () => {
    const original = await document("4.0.0");
    // Ethereum discovery now selects the active profile from capabilities. The
    // Robinhood 4.0.0 fixture remains historical; the complete document includes
    // the additive Ethereum 3.6 and Base metadata, protected-launch policy, and CLI release pointer.
    expect(original.customLaunchApi.ethereumProfileSelection).toMatchObject({
      discoveryIsActivationEvidence: false,
      profile36: {
        programmableHundredthsOfBip: "3000",
        programmableTradeFeePolicyHash: "sha256:e2025776ad3b12e6277575259cccf11444810365975209083fea534d8e70b4b5",
        rateSource: "capabilities.programmableTradeFeePolicy.policy.ratePpm",
      },
      cli: { sourceCandidateVersion: "4.2.0", publicationVerified: null },
    });
    expect(original.customLaunchApi.launchProtection).toMatchObject({
      policyVersion: "programmable.launch-protection.v1",
      statusUrl: "https://api.programmable.market/v1/launch-protection",
      supportedChainIds: ["1", "4663", "8453"], discoveryIsActivationEvidence: false,
      minimumFdvUsd: "15000", maximumAdditionalTaxExemptWallets: 6,
    });
    expect(createHash("sha256").update(JSON.stringify(original)).digest("hex"))
      .toBe("6f140df8a3a6b46c14655cc21b13c0fb6abff12dc623253a3c91eda7adf1886a");
  });

  it("publishes successor fee and funding rules while pending authority stays closed", async () => {
    const next = await document("4.1.0");
    expect(next.customLaunchApi.versions.v4).toMatchObject({
      profileVersion: "4.1.0", cliVersion: "4.1.0",
      publicWrites: false, publicAuthorization: false, releaseReady: false,
      activationBlockers: ["test-activation-blocker"],
      openApiUrl: "https://programmable.market/openapi/custom-launch-v4.1.json",
      packConfigSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json",
      sourceVerificationSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json",
      admissionDescriptorUrl: "https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.1.json",
      advertisedFundingModes: ["wallet-transaction-value"],
      cli: { sourceCandidateVersion: "4.1.0", sourceCandidate: true, released: false,
        installable: false, release: null, signsWalletTransactions: false, broadcastsWalletTransactions: false },
      fundingPlan: { required: true, gasAdditionalToLaunchValue: true, buildOnlyCreatesPermits: false },
      initialBuy: { required: true, minimumUsd: "1", assessmentTime: "permit-authorization",
        quotePath: "/v4/chains/4663/initial-buy-quote", staleFallback: false,
        walletExecutionUsdValueGuaranteed: false, firstTradeIndexingGuaranteed: false },
      platformFeePolicyStatus: "required-exact-native-fee-kernel",
      platformFeePolicy: { rateBps: 20, basis: "gross-native-leg-once-per-successful-swap",
        feeCurrency: "native-ETH", enforcement: "exact-kernel-proof-required-before-wallet-handoff",
        canonicalOnchainEnforcementProven: false, guaranteedRevenue: false, universalFeeBehaviorClaim: false },
      nativeFeeClaiming: { requiresPostDeploymentVaultVerification: true, apiKeyScopeGranted: false,
        transactionBroadcastByApi: false },
    });
    expect(next.chains.find(chain => chain.chainId === 4663)).toMatchObject({
      publicWrites: false, publicAuthorization: false, releaseReady: false,
    });
    expect(next.description).toContain("exact server-verified native fee kernel");
    expect(next.description).not.toContain("Its required 20 bps default policy is not a canonical onchain fee-enforcement or revenue claim.");
    expect(next.customLaunchApi.intake.chainSpecific.robinhood.instructions.join("\n"))
      .toContain("Native20 charges 20 bps (0.20%)");
  });

  it("retains released profile and historical routes while retiring fresh V4.1 writes", async () => {
    const previous = await document("4.0.0");
    const next = await document("4.1.0", true);
    expect(next.customLaunchApi.versions.v4).toMatchObject({
      profileVersion: "4.1.0", publicWrites: false, publicAuthorization: false, releaseReady: true,
      activationBlockers: [], cli: { sourceCandidateVersion: "4.1.0", sourceCandidate: false,
        released: true, installable: true, release: "4.1.0", liveEthereumVersion: "3.3.9",
        signsWalletTransactions: false, broadcastsWalletTransactions: false },
      externalIndexingGuaranteed: false, genericFeeClaiming: "not-live", genericBuybackManagement: "not-live",
    });
    expect(next.chains.find(chain => chain.chainId === 4663)).toMatchObject({
      publicWrites: false, publicAuthorization: false, releaseReady: true,
    });
    const { v4: previousV4, ...previousVersions } = previous.customLaunchApi.versions;
    const { v4: nextV4, ...nextVersions } = next.customLaunchApi.versions;
    expect(nextVersions).toEqual(previousVersions);
    expect(next.chains.find(chain => chain.chainId === 1))
      .toEqual(previous.chains.find(chain => chain.chainId === 1));
    expect(nextV4.cli.liveEthereumVersion).toBe(previousV4.cli.liveEthereumVersion);
    expect(next.customLaunchApi.walletAuthority).toBe(previous.customLaunchApi.walletAuthority);
  });
});
