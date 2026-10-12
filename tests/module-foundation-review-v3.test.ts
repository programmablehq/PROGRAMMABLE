import { describe, expect, it, vi } from "vitest";
import frozen from "./fixtures/module-foundation-review-v3.json";
import { FOUNDATION_PROTOCOL_BUILD_V3, FOUNDATION_PROTOCOL_EXTENSION_V3, FOUNDATION_PROTOCOL_EXTENSION_FEE100_V1,
  FOUNDATION_PROTOCOL_PLAN_V3, foundationProtocolReviewManifestHash, foundationProtocolReviewManifest,
  parseReviewArtifact, parseReviewPlan, reviewDigest, type FoundationProtocolBuildV3, type FoundationProtocolPlanV3, type ReviewJob,
} from "../lib/module-mode/review-contract";
import { createModuleReviewClient, verifyFoundationReviewSource } from "../lib/server/module-mode/review-client";
import { validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import type { WalletPrincipalAuthenticatorV1 } from "../lib/server/creator-article/wallet-principal.server";
vi.mock("server-only", () => ({}));
function fixture(bps: 30 | 100) {
  const f = structuredClone(frozen.cases.find(f => f.artifact.platformBps === bps)!);
  return { source: f.source as ModuleSubmissionRequest, artifact: f.artifact as unknown as FoundationProtocolBuildV3,
    plan: f.plan as FoundationProtocolPlanV3, hostManifestHash: f.hostManifestHash };
}
function rehash(artifact: FoundationProtocolBuildV3) {
  const contents = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactDigest"));
  return { ...artifact, artifactDigest: reviewDigest(FOUNDATION_PROTOCOL_BUILD_V3, contents) };
}
describe.each([30, 100] as const)("Foundation V3 %i bps transport", bps => {
  it("matches the backend source, plan, artifact, checks and manifest without granting activation", () => {
    const f = fixture(bps), subject = f.artifact.subject;
    expect(frozen.fixtureOnly).toBe(true);
    expect(parseReviewPlan(f.plan, subject)).toEqual(f.plan);
    expect(parseReviewArtifact(f.artifact, subject)).toEqual(f.artifact);
    expect(() => verifyFoundationReviewSource(f.artifact, f.source)).not.toThrow();
    expect(foundationProtocolReviewManifestHash(f.artifact)).toBe(f.hostManifestHash);
    expect(foundationProtocolReviewManifest(f.artifact)).toMatchObject({ platformBps: bps, factoryVersion: "v3" });
    expect(f.artifact).toMatchObject({ approved: false, registryApproved: false, available: false });
  });
  it("rejects mismatched fee checks, custody and plan identity even with a recomputed artifact digest", () => {
    const f = fixture(bps), subject = f.artifact.subject;
    for (const replacement of [
      { platformBps: bps === 30 ? 100 : 30 },
      { factoryVersion: "v2" },
      { lpCustodyId: `0x${"ab".repeat(32)}` },
      { planDigest: `0x${"ab".repeat(32)}` },
      { tests: { ...f.artifact.tests, checks: { ...f.artifact.tests.checks, independentCreatorFees: false } } },
    ]) expect(() => parseReviewArtifact(rehash({ ...f.artifact, ...replacement } as FoundationProtocolBuildV3), subject)).toThrow();
    expect(() => parseReviewPlan({ ...f.plan, factoryImmutableBindings: f.plan.factoryImmutableBindings.slice(1) }, subject)).toThrow();
    expect(() => parseReviewPlan({ ...f.plan, sourceCommit: "0".repeat(40) }, subject)).toThrow();
  });
  it("rejects a conflicting fee extension after rebinding the source hashes", () => {
    const f = fixture(bps);
    const selected = bps === 100 ? FOUNDATION_PROTOCOL_EXTENSION_FEE100_V1 : FOUNDATION_PROTOCOL_EXTENSION_V3;
    const other = bps === 100 ? FOUNDATION_PROTOCOL_EXTENSION_V3 : FOUNDATION_PROTOCOL_EXTENSION_FEE100_V1;
    f.source.descriptor.extensions![other] = f.source.descriptor.extensions![selected];
    const checked = validateModuleSubmissionRequest(f.source);
    if (!checked.ok) throw new Error("Fixture transport invalid");
    Object.assign(f.artifact.subject, { requestDigest: checked.requestDigest });
    Object.assign(f.plan, { requestDigest: checked.requestDigest });
    Object.assign(f.artifact, { packageId: checked.packageId, familyId: checked.familyId,
      sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", f.source.descriptor),
      planDigest: reviewDigest(FOUNDATION_PROTOCOL_PLAN_V3, f.plan) });
    Object.assign(f.artifact.tests, { requestDigest: checked.requestDigest, planDigest: f.artifact.planDigest });
    f.artifact = rehash(f.artifact);
    expect(() => verifyFoundationReviewSource(f.artifact, f.source)).toThrow();
  });
  it("forwards a valid build plan and reconstructs its manifest through the authenticated BFF", async () => {
    const f = fixture(bps), walletAddress = WEBSITE_ADMIN_WALLET.toLowerCase(), subject = f.artifact.subject;
    const job: ReviewJob = { subject, plan: f.plan, planDigest: f.artifact.planDigest, artifact: f.artifact,
      state: "built", reviewRevision: 2, attempt: 1, lastError: null, createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
    const fetchBackend = vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/source")) return Response.json(f.source);
      if (path.endsWith("/plan")) {
        const body = JSON.parse(Buffer.from(init!.body as Uint8Array).toString());
        expect(body.plan).toEqual(f.plan);
        return Response.json({ schemaVersion: "programmable.modules.review-plan-receipt.v1", job: { ...job, state: "queued", reviewRevision: 3, artifact: null }, approved: false, available: false }, { status: 202 });
      }
      return Response.json({ schemaVersion: "programmable.modules.review-detail.v1", job, decisions: [], attempts: [] });
    });
    const client = createModuleReviewClient({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:fixture", privySessionId: "fixture", wallets: [walletAddress] }) } as WalletPrincipalAuthenticatorV1,
      backendBaseUrl: "https://review.example.invalid", websiteToken: "service_" + "a".repeat(48), bffAssertionKeyV2: "assert_" + "b".repeat(48), fetchBackend, releaseIdentity: null, engineReleaseIdentity: null });
    const post = (body: object) => new Request("https://website.invalid/api/admin/modules/fixture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress, ...body }) });
    const queued = await client.handle(post({ expectedReviewRevision: 2, planJson: JSON.stringify(f.plan) }), "plan", subject.submissionId);
    expect(queued.status).toBe(202);
    const manifest = await client.handle(post({ expectedReviewRevision: 2, hostManifestJson: JSON.stringify(foundationProtocolReviewManifest(f.artifact)) }), "manifest", subject.submissionId);
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({ hostManifestHash: f.hostManifestHash });
  });
});
