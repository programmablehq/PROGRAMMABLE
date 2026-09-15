import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import frozen from "./fixtures/module-foundation-review.json";
import { createModuleReviewClient, verifyFoundationReviewSourceV1 } from "../lib/server/module-mode/review-client";
import { FOUNDATION_BUILD_SCHEMA_V1, FOUNDATION_PROTOCOL_BUILD_V1, parseReviewArtifact, parseReviewJob, parseReviewPlan, reviewDigest,
  foundationProtocolReviewManifestHashV1, foundationProtocolReviewManifestV1, summarizeReviewJob, type FoundationBuildArtifactV1, type FoundationProtocolBuildV1,
  type ReviewJob } from "../lib/module-mode/review-contract";
import { createFoundationModuleManifestV1, hashFoundationModuleManifestV1 } from "../lib/module-foundation/manifest";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import type { WalletPrincipalAuthenticatorV1 } from "../lib/server/creator-article/wallet-principal.server";
import type { ModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FoundationReviewChecks } from "../components/module-review-admin-console";
import { createAuthenticatedReviewReader } from "../ops/module-mode-publication/review";

vi.mock("server-only", () => ({}));
vi.mock("../components/wallet-provider", () => ({ useWallet: () => ({}) }));
const token = "service_" + "a".repeat(48), key = "assert_" + "b".repeat(48), time = "2026-09-15T13:00:00.000Z", nonce = "abcdefghijklmnopqrstuv";
const profiles = ["protocol", "module"] as const;
function fixture(profile: typeof profiles[number]) {
  // Frozen from the backend's finite, repository-owned unit fixtures. Their injected success records
  // exercise DTO parity only; they are never protected worker, reviewer or deployment evidence.
  const f = structuredClone(frozen[profile]);
  const artifact = f.artifact as unknown as FoundationBuildArtifactV1 | FoundationProtocolBuildV1;
  const subject = artifact.subject, plan = parseReviewPlan(f.plan, subject), source = f.source as ModuleSubmissionRequest;
  const manifest = artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V1 ? foundationProtocolReviewManifestV1(artifact) : createFoundationModuleManifestV1(source.descriptor, subject.requestDigest);
  const manifestHash = artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V1 ? foundationProtocolReviewManifestHashV1(artifact) : hashFoundationModuleManifestV1(manifest as ReturnType<typeof createFoundationModuleManifestV1>);
  const job: ReviewJob = { subject, state: "built", reviewRevision: 2, plan, planDigest: artifact.planDigest, artifact, attempt: 1, lastError: null, createdAt: time, updatedAt: time };
  return { artifact, subject, plan, source, manifest, manifestHash, job };
}
function setup(profile: typeof profiles[number], options: { self?: boolean; unlinked?: boolean } = {}) {
  const f = fixture(profile), wallet = options.self ? f.subject.author : WEBSITE_ADMIN_WALLET.toLowerCase();
  const authenticate = vi.fn(async () => ({ privyUserId: "did:privy:foundation-review-unit", privySessionId: "session", wallets: options.unlinked ? [] : [wallet] }));
  const detail = { schemaVersion: "programmable.modules.review-detail.v1", job: f.job, decisions: [] as ModuleReviewDecisionRecordV1[], attempts: [] };
  const sourceRaw = JSON.stringify(f.source, null, 2) + "\n";
  const fetchBackend = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/source")) return new Response(sourceRaw, { headers: { "Content-Type": "application/json" } });
    if (path.endsWith("/plan")) return Response.json({ schemaVersion: "programmable.modules.review-plan-receipt.v1", job: { ...f.job, state: "queued", reviewRevision: 3, artifact: null }, approved: false, available: false }, { status: 202 });
    if (path.endsWith("/decisions")) {
      const command = JSON.parse(Buffer.from(init!.body as Uint8Array).toString()) as ModuleReviewDecisionCommandV1;
      const contents = { schemaVersion: "programmable.modules.review-decision.v1" as const, reviewerWallet: wallet, policyDigest: `0x${"ab".repeat(32)}` as const,
        subject: f.subject, command, decidedAt: time, registryApproved: false as const, available: false as const };
      return Response.json({ schemaVersion: "programmable.modules.review-decision-receipt.v1", decision: { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) } }, { status: 201 });
    }
    return Response.json(detail);
  });
  const client = createModuleReviewClient({ authenticator: { authenticate } as WalletPrincipalAuthenticatorV1, backendBaseUrl: "https://review.example.invalid", websiteToken: token, bffAssertionKeyV2: key,
    fetchBackend, now: () => new Date(time), nonce: () => nonce, releaseIdentity: null, engineReleaseIdentity: null });
  const read = () => new Request(`https://website.invalid/api/admin/modules/${f.subject.submissionId}?walletAddress=${wallet}`);
  const post = (body: object) => new Request(read().url.split("?")[0], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: wallet, ...body }) });
  const command: ModuleReviewDecisionCommandV1 = { schemaVersion: "programmable.modules.review-command.v1", submissionId: f.subject.submissionId, requestDigest: f.subject.requestDigest, expectedReviewRevision: 2,
    outcome: "accept", reason: "Synthetic transport test only; no real approval.", artifactDigest: f.artifact.artifactDigest, hostManifestHash: f.manifestHash, acknowledgedReviewAreas: [...f.artifact.reviewRequired] };
  return { ...f, wallet, authenticate, fetchBackend, detail, sourceRaw, client, read, post, command };
}
function rehash<T extends { artifactDigest: string; schemaVersion: string }>(artifact: T): T {
  const contents = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactDigest"));
  return { ...artifact, artifactDigest: reviewDigest(artifact.schemaVersion, contents) };
}

describe.each(profiles)("Foundation %s existing review transport", profile => {
  it("renders its actual conformance evidence and explicitly refuses the Native/Engine publication operator", async () => {
    const f = fixture(profile), html = renderToStaticMarkup(createElement(FoundationReviewChecks, { artifact: f.artifact }));
    expect(html).toContain(profile === "protocol" ? "Foundation protocol conformance" : "Own quote budget");
    expect(html).not.toContain("callbackGasBound");
    const reader = createAuthenticatedReviewReader({ walletAddress: WEBSITE_ADMIN_WALLET, accessToken: "synthetic_unit_session_token_only" },
      async url => Response.json(String(url).includes("/source?") ? f.source : { schemaVersion: "programmable.modules.website-review-detail.v1", job: f.job, decisions: [], attempts: [] }));
    await expect(reader.read(f.subject.submissionId)).rejects.toThrow("separate Foundation protocol/catalog release qualification");
  });
  it("parses exact backend source/plan/build and summarizes protocol checks or module cases", () => {
    const f = fixture(profile);
    expect(parseReviewJob(f.job)).toEqual(f.job);
    expect(() => verifyFoundationReviewSourceV1(f.artifact, f.source)).not.toThrow();
    expect(summarizeReviewJob(f.job).build?.caseCount).toBe(profile === "protocol" ? 10 : (f.artifact as FoundationBuildArtifactV1).cases.length);
    expect(() => parseReviewPlan({ ...f.plan, approval: true }, f.subject)).toThrow();
    expect(() => parseReviewJob({ ...f.job, plan: null, planDigest: null })).toThrow();
  });
  it("tracks and downloads exact immutable bytes, then queues through the same body-bound Privy assertion", async () => {
    const f = setup(profile);
    expect((await f.client.handle(f.read(), "detail", f.subject.submissionId)).status).toBe(200);
    expect(await (await f.client.handle(f.read(), "source", f.subject.submissionId)).text()).toBe(f.sourceRaw);
    const result = await f.client.handle(f.post({ expectedReviewRevision: 2, planJson: JSON.stringify(f.plan) }), "plan", f.subject.submissionId);
    expect(result.status).toBe(202);
    const [url, init] = f.fetchBackend.mock.calls.find(([url, init]) => String(url).endsWith("/plan") && init?.method === "POST")!;
    const path = new URL(String(url)).pathname, bytes = Buffer.from(init!.body as Uint8Array), headers = new Headers(init!.headers);
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const signing = `programmable.custom-launch-api.wallet-bff-assertion.v2\0POST\0${path}\0did:privy:foundation-review-unit\0${f.wallet}\0${time}\0${nonce}\0${hash}`;
    expect(headers.get("X-Programmable-Bff-Assertion-Signature")).toBe(`hmac-sha256:${createHmac("sha256", key).update(signing).digest("hex")}`);
    expect(JSON.parse(bytes.toString())).toEqual({ expectedReviewRevision: 2, plan: f.plan });
  });
  it("checks the exact Foundation review manifest and independently records the same decision contract", async () => {
    const f = setup(profile), hostManifestJson = JSON.stringify(f.manifest);
    const manifest = await f.client.handle(f.post({ expectedReviewRevision: 2, hostManifestJson }), "manifest", f.subject.submissionId);
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({ hostManifestHash: f.manifestHash, artifactDigest: f.artifact.artifactDigest });
    const result = await f.client.handle(f.post({ command: f.command, hostManifestJson }), "decision", f.subject.submissionId);
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ decision: { reviewerWallet: f.wallet, registryApproved: false, available: false, command: f.command } });
  });
  it("rejects self-review, unlinked wallets, manifest substitution, missing acknowledgement and stale revisions before a mutation", async () => {
    for (const options of [{ self: true }, { unlinked: true }]) {
      const f = setup(profile, options);
      const result = await f.client.handle(f.post({ command: f.command, hostManifestJson: JSON.stringify(f.manifest) }), "decision", f.subject.submissionId);
      expect(result.status).toBe(403); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    }
    for (const patch of [{ hostManifestJson: JSON.stringify({ ...fixture(profile).manifest, available: true }) }, { command: { ...setup(profile).command, acknowledgedReviewAreas: [] } }, { command: { ...setup(profile).command, expectedReviewRevision: 1 } }]) {
      const f = setup(profile), result = await f.client.handle(f.post({ command: f.command, hostManifestJson: JSON.stringify(f.manifest), ...patch }), "decision", f.subject.submissionId);
      expect([400, 409]).toContain(result.status); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    }
  });
  it("rejects rehashed authority, compiler, coverage and source substitutions", () => {
    const f = fixture(profile);
    for (const mutate of [
      (a: typeof f.artifact) => Object.assign(a, { available: true }),
      (a: typeof f.artifact) => Object.assign(a.compiler, { settingsHash: `0x${"bc".repeat(32)}` }),
      (a: typeof f.artifact) => Object.assign(a, { reviewRequired: [] }),
      (a: typeof f.artifact) => Object.assign(a.tests, { allRequiredChecksPassed: false }),
    ]) { const artifact = structuredClone(f.artifact); mutate(artifact); expect(() => parseReviewArtifact(rehash(artifact), f.subject)).toThrow(); }
    const changed = structuredClone(f.source); changed.files[0].bytes = Buffer.from("substituted").toString("base64");
    expect(() => verifyFoundationReviewSourceV1(f.artifact, changed)).toThrow();
  });
});

it("binds protocol immutable IDs and module compiled action/config bytes to the reviewed plan/source", () => {
  const p = fixture("protocol"), protocol = p.artifact as FoundationProtocolBuildV1;
  const changed = structuredClone(protocol); Object.assign(changed.factoryImmutableBindings[0], { field: changed.factoryImmutableBindings[1].field });
  expect(() => parseReviewArtifact(rehash(changed), p.subject)).toThrow();
  const m = fixture("module"), moduleArtifact = structuredClone(m.artifact) as FoundationBuildArtifactV1;
  Object.assign(moduleArtifact.cases[0], { configBytes: "0x" });
  expect(() => parseReviewArtifact(rehash(moduleArtifact), m.subject)).toThrow();
  expect(moduleArtifact.schemaVersion).toBe(FOUNDATION_BUILD_SCHEMA_V1);
});
