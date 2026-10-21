import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseHistoryPage, walletPlatformFeeDisclosureV3, walletProjectMetadataReadyForReviewV1 } from
  "../components/developer-launch-history";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { programmableWellKnownDocumentV1 } from "../lib/server/custom-launch/well-known-v1";
import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from "../lib/custom-launch/registry-public-manifest-v1";
import { PROGRAMMABLE_AGENT_SETUP_TEXT_V1 } from "../lib/custom-launch/agent-setup-v1";

const wallet = "0x1111111111111111111111111111111111111111";
const launchId = "60000000-0000-4000-8000-000000000006";
const metadata = {
  schemaVersion: "programmable.project-metadata.v1",
  token: { name: "Example Hook", symbol: "HOOK" },
  presentation: { schemaVersion: "programmable.launch-presentation-draft.v1",
    description: "An exact-source custom hook.",
    image: { uri: "https://example.com/image.png", contentSha256: `sha256:${"44".repeat(32)}`,
      mediaType: "image/png", byteLength: 4096, width: 512, height: 512 },
    links: [{ kind: "website", uri: "https://example.com/" }, { kind: "x", uri: "https://x.com/example" }] },
  tokenMetadataBinding: { schemaVersion: "programmable.project-token-metadata-binding.v1", tokenTargetId: "token",
    declarationBinding: "request-and-launch-id", standardReadModel: { name: true, symbol: true },
    name: { staticSource: "constructor-argument", argumentIndex: 0, argumentName: "name_" },
    symbol: { staticSource: "constructor-argument", argumentIndex: 1, argumentName: "symbol_" },
    postDeploymentReadback: "required" },
};
function resource(version: string) {
  return { schemaVersion: "programmable.custom-launch.v3", routeId: "custom-launch:create:v3",
    launchId, requestId: launchId, onchainLaunchId: null, ownerWallet: wallet, status: "received",
    requestHash: `sha256:${"11".repeat(32)}`, launchProfileHash: `sha256:${"22".repeat(32)}`,
    launchIntentHash: `sha256:${"33".repeat(32)}`, launchProfileVersion: version,
    projectMetadata: structuredClone(metadata),
    projectMetadataHash: canonicalBrowserSha256V2("programmable.project-metadata.v1", metadata),
    fundingIntentHash: null, liquidityIntent: { model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required", binding: "legacy-v3-default" },
    createdAt: "2026-10-07T12:00:00.000Z", updatedAt: "2026-10-07T12:00:00.000Z", output: null, failure: null };
}
function parse(value: unknown) {
  return parseHistoryPage({ schemaVersion: "programmable.custom-launch-list.v3", launches: [value], nextCursor: null }, wallet);
}

describe("additive Ethereum 3.6 public client", () => {
  it.each(["3.5.0", "3.6.0"])("reads %s without dropping metadata binding or promoting authorization", version => {
    const page = parse(resource(version));
    expect(page?.launches[0].launchProfileVersion).toBe(version);
    expect(page?.launches[0].status).toBe("received");
    expect(page?.launches[0].walletHandoffUrl).toBeNull();
    expect(walletProjectMetadataReadyForReviewV1(page!.launches[0])).toBe(true);
    const changed = resource(version); changed.projectMetadata.token.name = "Changed after admission";
    expect(parse(changed)).toBeNull();
    expect(parse({ ...resource(version), projectMetadata: null, projectMetadataHash: null })).toBeNull();
  });
  it("rejects unknown profile versions and keeps collection claims qualified", () => {
    expect(parse(resource("3.7.0"))).toBeNull();
    expect(walletPlatformFeeDisclosureV3("3.6.0", {behaviorEvidence:{requirements:{vectorSetVersion:"1.3.0"}}})).toBe("1% platform fee on Programmable trades");
    expect(walletPlatformFeeDisclosureV3("3.6.0", {behaviorEvidence:{requirements:{vectorSetVersion:"1.2.0"}}})).toContain("0.3%");
    expect(walletPlatformFeeDisclosureV3("3.5.0")).toContain("verification required");
    expect(walletPlatformFeeDisclosureV3("3.6.0")).toContain("approved launch policy");
  });
  it("can precede backend activation and leaves fresh selection to public capabilities", () => {
    const api = programmableWellKnownDocumentV1(PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1).customLaunchApi;
    expect(api.generalHookProfile.profileVersion).toBeNull();
    expect(api.generalHookProfile.productionLaunchAuthorized).toBeNull();
    expect(api.versions.v3.freshWritesOnlyProfileVersion).toBeNull();
    expect(api.ethereumProfileSelection).toMatchObject({ capabilitiesUrl: api.capabilitiesUrl,
      selectionRequiredBeforePacking: true, discoveryIsActivationEvidence: false,
      supportedActiveProfileVersions: ["3.3.0", "3.6.0"], unknownProfileDisposition: "fail-closed",
      cli: { sourceCandidateVersion: "4.2.0", publicationVerified: null,
        publicationAuthority: "immutable-github-release",
        releaseTag: "programmable-launch-v4.2.0",
        releaseUrl: "https://github.com/programmablehq/PROGRAMMABLE/releases/tag/programmable-launch-v4.2.0",
        publishedReleaseAndArtifactVerificationRequired: true },
      profile36: { openApiUrl: "https://programmable.market/openapi/custom-launch-v3.6.json",
        behaviorScenarioInputsRequired: false, mandatoryCanonicalFeeVaultTarget: false,
        launchAdmissionEstablishesFeeCollection: false, applicantWaiverAssertionsAccepted: false } });
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("use the exact current V3 profile from capabilities");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("Historically, pre-3.6 open arbitrary-custom-hook lanes");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("first-party Programmable trade collection at the exact rate in the selected policy");
  });
});
