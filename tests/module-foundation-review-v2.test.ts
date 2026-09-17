import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import frozen from "./fixtures/module-foundation-review-v2.json";
import frozenV1 from "./fixtures/module-foundation-review.json";
import {
  FOUNDATION_HOST_V1, FOUNDATION_LP_CUSTODY_ID_V2, FOUNDATION_PROTOCOL_BUILD_V1,
  FOUNDATION_PROTOCOL_PLAN_V1, FOUNDATION_PROTOCOL_PLAN_V2, FOUNDATION_PROTOCOL_EXTENSION_V1, FOUNDATION_PROTOCOL_EXTENSION_V2,
  FOUNDATION_PROTOCOL_CHECKS_V1, FOUNDATION_PROTOCOL_CHECKS_V2, FOUNDATION_PROTOCOL_REVIEW_AREAS_V2, FOUNDATION_PROTOCOL_FIELDS_V2,
  foundationProtocolReviewManifest, foundationProtocolReviewManifestHash, foundationProtocolReviewManifestV1, foundationProtocolReviewManifestHashV1,
  foundationProtocolReviewManifestV2, foundationProtocolReviewManifestHashV2, isFoundationProtocolArtifact,
  parseReviewArtifact, parseFoundationReviewArtifact, parseReviewJob, parseReviewPlan, reviewArtifactCheckCount, reviewDigest, reviewRecord,
  summarizeReviewJob, validateFoundationProtocolPlanV1, validateFoundationProtocolPlanV2,
  type FoundationProtocolBuildV2, type FoundationProtocolPlanV2, type ReviewJob, type ReviewSubject,
} from "../lib/module-mode/review-contract";
import { createModuleReviewClient, verifyFoundationReviewSource, verifyFoundationReviewSourceV1, verifyFoundationReviewSourceV2 } from "../lib/server/module-mode/review-client";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import type { WalletPrincipalAuthenticatorV1 } from "../lib/server/creator-article/wallet-principal.server";

vi.mock("server-only", () => ({}));
const time = "2026-09-17T00:00:00.000Z", token = "service_" + "a".repeat(48), key = "assert_" + "b".repeat(48), nonce = "abcdefghijklmnopqrstuv";
const otherHash = `0x${"bc".repeat(32)}` as const;

function fixture() {
  const artifact = structuredClone(frozen.artifact) as unknown as FoundationProtocolBuildV2;
  const plan = structuredClone(frozen.plan) as FoundationProtocolPlanV2;
  const source = structuredClone(frozen.source) as ModuleSubmissionRequest;
  const subject = artifact.subject;
  const manifest = foundationProtocolReviewManifestV2(artifact), manifestHash = frozen.backend.hostManifestHash;
  const job: ReviewJob = { subject, state: "built", reviewRevision: 2, plan, planDigest: artifact.planDigest, artifact,
    attempt: 1, lastError: null, createdAt: time, updatedAt: time };
  return { artifact, plan, source, subject, manifest, manifestHash, job };
}
function rehash<T extends { artifactDigest: string; schemaVersion: string }>(artifact: T): T {
  const contents = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactDigest"));
  return { ...artifact, artifactDigest: reviewDigest(artifact.schemaVersion, contents) };
}
/** Rebind the source identity so adversarial tests reach the profile checks, not just the request hash. */
function reboundSource(mutate: (source: ModuleSubmissionRequest) => void) {
  const f = fixture(); mutate(f.source);
  const checked = validateModuleSubmissionRequest(f.source);
  if (!checked.ok) throw new Error(`Invalid adversarial source fixture: ${JSON.stringify(checked.errors)}`);
  Object.assign(f.subject, { requestDigest: checked.requestDigest });
  Object.assign(f.plan, { requestDigest: checked.requestDigest });
  Object.assign(f.artifact, { packageId: checked.packageId, familyId: checked.familyId,
    sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", checked.request.descriptor), planDigest: reviewDigest(FOUNDATION_PROTOCOL_PLAN_V2, f.plan) });
  Object.assign(f.artifact.tests, { requestDigest: checked.requestDigest, planDigest: f.artifact.planDigest });
  f.artifact = rehash(f.artifact);
  return f;
}
function setup(options: { unlinked?: boolean; nonAdmin?: boolean; self?: boolean } = {}) {
  const f = fixture();
  const wallet = options.nonAdmin ? "0x1234567890123456789012345678901234567890" : WEBSITE_ADMIN_WALLET.toLowerCase();
  if (options.self) {
    f.source.descriptor.author = wallet as `0x${string}`;
    const checked = validateModuleSubmissionRequest(f.source); if (!checked.ok) throw new Error("Self-review fixture is invalid");
    Object.assign(f.subject, { author: wallet, requestDigest: checked.requestDigest });
    Object.assign(f.plan, { requestDigest: checked.requestDigest });
    Object.assign(f.artifact, { packageId: checked.packageId, familyId: checked.familyId,
      sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", f.source.descriptor), planDigest: reviewDigest(FOUNDATION_PROTOCOL_PLAN_V2, f.plan) });
    Object.assign(f.artifact.tests, { requestDigest: checked.requestDigest, planDigest: f.artifact.planDigest });
    f.artifact = rehash(f.artifact); f.job.artifact = f.artifact; f.job.planDigest = f.artifact.planDigest;
    f.manifest = foundationProtocolReviewManifestV2(f.artifact); f.manifestHash = foundationProtocolReviewManifestHashV2(f.artifact);
  }
  const authenticate = vi.fn(async () => ({ privyUserId: "did:privy:v2-review-fixture", privySessionId: "session", wallets: options.unlinked ? [] : [wallet] }));
  const detail = { schemaVersion: "programmable.modules.review-detail.v1", job: f.job, decisions: [] as ModuleReviewDecisionRecordV1[], attempts: [] };
  const sourceRaw = JSON.stringify(f.source, null, 2) + "\n";
  const fetchBackend = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/source")) return new Response(sourceRaw, { headers: { "Content-Type": "application/json" } });
    if (path.endsWith("/plan")) return Response.json({ schemaVersion: "programmable.modules.review-plan-receipt.v1",
      job: { ...f.job, state: "queued", reviewRevision: 3, artifact: null }, approved: false, available: false }, { status: 202 });
    if (path.endsWith("/decisions")) {
      const command = JSON.parse(Buffer.from(init!.body as Uint8Array).toString()) as ModuleReviewDecisionCommandV1;
      const contents = { schemaVersion: "programmable.modules.review-decision.v1" as const, reviewerWallet: wallet, policyDigest: otherHash,
        subject: f.subject, command, decidedAt: time, registryApproved: false as const, available: false as const };
      return Response.json({ schemaVersion: "programmable.modules.review-decision-receipt.v1",
        decision: { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) } }, { status: 201 });
    }
    return Response.json(detail);
  });
  const client = createModuleReviewClient({ authenticator: { authenticate } as WalletPrincipalAuthenticatorV1,
    backendBaseUrl: "https://review.example.invalid", websiteToken: token, bffAssertionKeyV2: key, fetchBackend,
    now: () => new Date(time), nonce: () => nonce, releaseIdentity: null, engineReleaseIdentity: null });
  const read = () => new Request(`https://website.invalid/api/admin/modules/${f.subject.submissionId}?walletAddress=${wallet}`);
  const post = (body: object) => new Request(read().url.split("?")[0], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: wallet, ...body }) });
  const command: ModuleReviewDecisionCommandV1 = { schemaVersion: "programmable.modules.review-command.v1", submissionId: f.subject.submissionId,
    requestDigest: f.subject.requestDigest, expectedReviewRevision: 2, outcome: "accept", reason: "Synthetic local transport test only; no actual reviewer approval.",
    artifactDigest: f.artifact.artifactDigest, hostManifestHash: f.manifestHash as `0x${string}`, acknowledgedReviewAreas: [...f.artifact.reviewRequired] };
  return { ...f, wallet, authenticate, fetchBackend, detail, sourceRaw, client, read, post, command };
}

describe("Foundation V2 backend DTO parity", () => {
  it("binds the actual pinned backend source, compiler output, 12 checks, 9 review areas and V2 manifest digest", () => {
    const f = fixture();
    expect(frozen.fixtureOnly).toBe(true);
    expect(frozen.provenance.backendCommit).toBe("bcbc7f71d59b43c43cf60dab5569ddc974f85cd0");
    expect(frozen.provenance.conformance).toContain("Injected success records");
    expect(f.source.files).toHaveLength(76);
    expect(parseReviewPlan(f.plan, f.subject)).toEqual(f.plan);
    expect(validateFoundationProtocolPlanV2(f.plan, f.subject)).toEqual(f.plan);
    expect(parseReviewArtifact(f.artifact, f.subject)).toEqual(f.artifact);
    expect(parseFoundationReviewArtifact(f.artifact, f.subject, f.plan)).toEqual(f.artifact);
    expect(parseReviewJob(f.job)).toEqual(f.job);
    expect(() => verifyFoundationReviewSourceV2(f.artifact, f.source)).not.toThrow();
    expect(() => verifyFoundationReviewSource(f.artifact, f.source)).not.toThrow();
    expect(FOUNDATION_PROTOCOL_CHECKS_V2).toEqual(frozen.backend.checks);
    expect(FOUNDATION_PROTOCOL_REVIEW_AREAS_V2).toEqual(frozen.backend.reviewAreas);
    expect(FOUNDATION_PROTOCOL_FIELDS_V2).toEqual(frozen.backend.immutableFields);
    expect(FOUNDATION_PROTOCOL_CHECKS_V2).toHaveLength(12);
    expect(FOUNDATION_PROTOCOL_REVIEW_AREAS_V2).toHaveLength(9);
    expect(f.artifact.hostAdapterId).toBe(FOUNDATION_HOST_V1);
    expect(f.artifact.lpCustodyId).toBe(FOUNDATION_LP_CUSTODY_ID_V2);
    expect(foundationProtocolReviewManifestHashV2(f.artifact)).toBe(frozen.backend.hostManifestHash);
    expect(foundationProtocolReviewManifestHash(f.artifact)).toBe(frozen.backend.hostManifestHash);
    expect(foundationProtocolReviewManifest(f.artifact)).toEqual(f.manifest);
    expect(reviewArtifactCheckCount(f.artifact)).toBe(12);
    expect(summarizeReviewJob(f.job).build).toEqual({ artifactDigest: f.artifact.artifactDigest,
      programName: "FoundationFactoryV2", testsPassed: true, caseCount: 12 });
    expect(f.artifact).toMatchObject({ approved: false, registryApproved: false, available: false });
  });

  it("preserves exact V1 plan, artifact and manifest hashes while discriminating both protocol versions", () => {
    for (const profile of ["protocol", "module"] as const) {
      const original = frozenV1[profile];
      const subject = original.artifact.subject as ReviewSubject;
      const plan = parseReviewPlan(original.plan, subject), artifact = parseReviewArtifact(original.artifact, subject);
      expect(plan).toEqual(original.plan);
      expect(artifact).toEqual(original.artifact);
      expect(artifact.artifactDigest).toBe(original.artifact.artifactDigest);
      expect(() => verifyFoundationReviewSourceV1(artifact as Parameters<typeof verifyFoundationReviewSourceV1>[0], original.source as ModuleSubmissionRequest)).not.toThrow();
      expect(isFoundationProtocolArtifact(artifact)).toBe(profile === "protocol");
      if (isFoundationProtocolArtifact(artifact) && artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V1) {
        expect(foundationProtocolReviewManifestHashV1(artifact)).toBe(frozen.backend.v1HostManifestHash);
        expect(foundationProtocolReviewManifestHash(artifact)).toBe(frozen.backend.v1HostManifestHash);
        expect(JSON.stringify(foundationProtocolReviewManifest(artifact))).toBe(JSON.stringify(foundationProtocolReviewManifestV1(artifact)));
        expect(reviewArtifactCheckCount(artifact)).toBe(10);
      }
    }
    expect(isFoundationProtocolArtifact(fixture().artifact)).toBe(true);
    expect(isFoundationProtocolArtifact(null)).toBe(false);
    expect(isFoundationProtocolArtifact(undefined)).toBe(false);
  });

  it("keeps plan, build, test and manifest version domains distinct", () => {
    const f = fixture(), wrongPlan = { ...f.plan, schemaVersion: FOUNDATION_PROTOCOL_PLAN_V1 };
    expect(() => validateFoundationProtocolPlanV1(f.plan, f.subject)).toThrow();
    expect(() => validateFoundationProtocolPlanV2(wrongPlan, f.subject)).toThrow();
    expect(() => parseFoundationReviewArtifact(f.artifact, f.subject, wrongPlan)).toThrow();
    expect(() => parseReviewJob({ ...f.job, plan: wrongPlan, planDigest: reviewDigest(FOUNDATION_PROTOCOL_PLAN_V1, wrongPlan) })).toThrow();
    expect(() => parseReviewArtifact({ ...f.artifact, artifactDigest: reviewDigest(FOUNDATION_PROTOCOL_BUILD_V1,
      Object.fromEntries(Object.entries(f.artifact).filter(([key]) => key !== "artifactDigest"))) }, f.subject)).toThrow();
    expect(reviewDigest("programmable.module-foundation.protocol-host-manifest.v1", f.manifest)).not.toBe(f.manifestHash);
    expect(() => parseReviewJob({ ...f.job, plan: null, planDigest: null })).toThrow();
    expect(() => parseReviewArtifact(f.artifact, { ...f.subject, principalId: "00000000-0000-4000-8000-000000000099" })).toThrow();
  });
});

const invalidPlans: [string, (plan: FoundationProtocolPlanV2) => void][] = [
  ["unexpected key", p => Object.assign(p, { approved: true })],
  ["zero source revision", p => Object.assign(p, { sourceCommit: "0".repeat(40) })],
  ["uppercase source revision", p => Object.assign(p, { sourceCommit: "AB".repeat(20) })],
  ["wrong request", p => Object.assign(p, { requestDigest: otherHash })],
  ["duplicate component", p => Object.assign(p, { hookDeployerComponentId: p.factoryComponentId })],
  ["missing immutable", p => Object.assign(p, { factoryImmutableBindings: p.factoryImmutableBindings.slice(1) })],
  ["duplicate immutable id", p => Object.assign(p.factoryImmutableBindings[1], { id: p.factoryImmutableBindings[0].id })],
  ["duplicate immutable field", p => Object.assign(p.factoryImmutableBindings[1], { field: p.factoryImmutableBindings[0].field })],
  ["unknown immutable field", p => Object.assign(p.factoryImmutableBindings[0], { field: "creator" })],
  ["noncanonical immutable id", p => Object.assign(p.factoryImmutableBindings[0], { id: "01" })],
  ["unexpected immutable key", p => Object.assign(p.factoryImmutableBindings[0], { value: "1" })],
];
it.each(invalidPlans)("rejects V2 plan %s", (_name, mutate) => {
  const f = fixture(); mutate(f.plan);
  expect(() => parseReviewPlan(f.plan, f.subject)).toThrow();
});

const invalidArtifacts: [string, (artifact: FoundationProtocolBuildV2) => void][] = [
  ["V1 authority", a => Object.assign(a, { authority: "programmable.module-review.foundation-protocol-build.v1" })],
  ["V1 build schema", a => Object.assign(a, { schemaVersion: FOUNDATION_PROTOCOL_BUILD_V1 })],
  ["unknown schema", a => Object.assign(a, { schemaVersion: "programmable.modules.foundation-protocol-build.v3" })],
  ["unknown artifact key", a => Object.assign(a, { reviewer: a.subject.author })],
  ["approval claim", a => Object.assign(a, { approved: true })],
  ["Registry claim", a => Object.assign(a, { registryApproved: true })],
  ["availability claim", a => Object.assign(a, { available: true })],
  ["V1 factory", a => Object.assign(a, { factoryVersion: "v1" })],
  ["missing factory version", a => { delete reviewRecord(a).factoryVersion; }],
  ["wrong LP custody", a => Object.assign(a, { lpCustodyId: otherHash })],
  ["missing LP custody", a => { delete reviewRecord(a).lpCustodyId; }],
  ["changed host ABI", a => Object.assign(a, { hostAdapterId: "programmable.module-foundation.host@2" })],
  ["wrong platform fee", a => Object.assign(a, { platformBps: 31 })],
  ["wrong platform recipient", a => Object.assign(a, { platformRecipient: "0x1234567890123456789012345678901234567890" })],
  ["wrong compiler version", a => Object.assign(a.compiler, { version: "0.8.27" })],
  ["wrong compiler binary", a => Object.assign(a.compiler, { binarySha256: `sha256:${"ac".repeat(32)}` })],
  ["wrong compiler image", a => Object.assign(a.compiler, { imageDigest: `sha256:${"ac".repeat(32)}` })],
  ["wrong settings", a => Object.assign(a.compiler, { settingsHash: otherHash })],
  ["extra compiler key", a => Object.assign(a.compiler, { viaIR: false })],
  ["missing source digest", a => Object.assign(a, { sourceManifestHash: "0x" + "00".repeat(32) })],
  ["V1 test schema", a => Object.assign(a.tests, { schemaVersion: "programmable.modules.foundation-protocol-test-results.v1" })],
  ["V1 check set", a => Object.assign(a.tests, { checks: Object.fromEntries(FOUNDATION_PROTOCOL_CHECKS_V1.map(check => [check, true])) })],
  ["missing V2 check", a => { delete reviewRecord(a.tests.checks).directDeadPositionCustody; }],
  ["extra V1 check", a => Object.assign(a.tests.checks, { additionalCreatorPositionOwnership: true })],
  ["failed V2 check", a => Object.assign(a.tests.checks, { roundingInventoryToDead: false })],
  ["nonboolean check", a => Object.assign(a.tests.checks, { receiptRegistryAndRefundBinding: "true" })],
  ["incomplete tests", a => Object.assign(a.tests, { allRequiredChecksPassed: false })],
  ["different test request", a => Object.assign(a.tests, { requestDigest: otherHash })],
  ["different test plan", a => Object.assign(a.tests, { planDigest: otherHash })],
  ["unknown test execution", a => Object.assign(a.tests, { execution: "local" })],
  ["missing review area", a => Object.assign(a, { reviewRequired: a.reviewRequired.slice(1) })],
  ["reordered review areas", a => Object.assign(a, { reviewRequired: [...a.reviewRequired].reverse() })],
  ["wrong creation code", a => Object.assign(a.factory, { creationBytecode: `${a.factory.creationBytecode}00` })],
  ["wrong runtime code", a => Object.assign(a.factory, { runtimeTemplate: `${a.factory.runtimeTemplate}00` })],
  ["wrong creation hash", a => Object.assign(a.hookDeployer, { creationCodeHash: otherHash })],
  ["wrong runtime hash", a => Object.assign(a.hookDeployer, { runtimeTemplateHash: otherHash })],
  ["unknown contract key", a => Object.assign(a.factory, { runtimeCodeHash: otherHash })],
  ["wrong immutable binding", a => Object.assign(a.factoryImmutableBindings[0], { id: "9999999999" })],
  ["duplicate immutable reference", a => Object.assign(a.factory, { immutableReferences: [...a.factory.immutableReferences, a.factory.immutableReferences[0]] })],
  ["overlapping immutable ranges", a => Object.assign(a.factory.immutableReferences[1], { ranges: a.factory.immutableReferences[0].ranges })],
  ["out-of-bounds immutable", a => Object.assign(a.factory.immutableReferences[0].ranges[0], { start: a.factory.runtimeTemplate.length })],
  ["wrong immutable width", a => Object.assign(a.factory.immutableReferences[0].ranges[0], { length: 31 })],
  ["nonzero immutable template", a => {
    const start = 2 + a.factory.immutableReferences[0].ranges[0].start * 2;
    const runtimeTemplate = `${a.factory.runtimeTemplate.slice(0, start)}ff${a.factory.runtimeTemplate.slice(start + 2)}` as `0x${string}`;
    Object.assign(a.factory, { runtimeTemplate, runtimeTemplateHash: keccak256(runtimeTemplate) });
  }],
];
it.each(invalidArtifacts)("rejects rehashed V2 artifact with %s", (_name, mutate) => {
  const f = fixture(); mutate(f.artifact);
  expect(() => parseReviewArtifact(rehash(f.artifact), f.subject)).toThrow();
});

describe("Foundation V2 authenticated source binding", () => {
  it("rejects changed bytes, even when the source and artifact identities are rebound", () => {
    const f = fixture(); f.source.files[0].bytes = Buffer.from("substituted").toString("base64");
    expect(() => verifyFoundationReviewSourceV2(f.artifact, f.source)).toThrow();
    const changed = reboundSource(source => {
      const file = source.files.find(file => file.path.endsWith(".sol"))!;
      const bytes = Buffer.concat([Buffer.from(file.bytes, "base64"), Buffer.from("\n// changed\n")]);
      file.bytes = bytes.toString("base64"); file.sha256 = createHash("sha256").update(bytes).digest("hex");
      source.descriptor.source.files.find(item => item.path === file.path)!.sha256 = file.sha256;
    });
    expect(() => parseReviewArtifact(changed.artifact, changed.subject)).not.toThrow();
    expect(() => verifyFoundationReviewSourceV2(changed.artifact, changed.source)).toThrow();
  });

  it.each([
    ["source revision", (source: ModuleSubmissionRequest) => Object.assign(reviewRecord(source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2]), { sourceCommit: "ab".repeat(20) })],
    ["V1 factory", (source: ModuleSubmissionRequest) => Object.assign(reviewRecord(source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2]), { factoryVersion: "v1" })],
    ["LP custody", (source: ModuleSubmissionRequest) => Object.assign(reviewRecord(source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2]), { lpCustodyId: otherHash })],
    ["platform fee", (source: ModuleSubmissionRequest) => Object.assign(reviewRecord(source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2]), { platformBps: 20 })],
    ["extra extension field", (source: ModuleSubmissionRequest) => Object.assign(reviewRecord(source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2]), { approved: true })],
    ["runtime family", (source: ModuleSubmissionRequest) => { source.descriptor.components[0].runtime = "programmable.module-foundation.solidity@1"; }],
    ["entrypoint", (source: ModuleSubmissionRequest) => { source.descriptor.components[0].entrypoint = "DifferentFactory"; }],
    ["V1 extension", (source: ModuleSubmissionRequest) => {
      const extension = source.descriptor.extensions![FOUNDATION_PROTOCOL_EXTENSION_V2];
      source.descriptor.extensions = { [FOUNDATION_PROTOCOL_EXTENSION_V1]: extension };
    }],
  ] as const)("rejects rebound %s substitution", (_name, mutate) => {
    const f = reboundSource(mutate);
    expect(() => parseReviewArtifact(f.artifact, f.subject)).not.toThrow();
    expect(() => verifyFoundationReviewSourceV2(f.artifact, f.source)).toThrow();
  });
});

describe("Foundation V2 admin transport", () => {
  it("reads the parsed build and downloads the exact source response bytes", async () => {
    const f = setup();
    const detail = await f.client.handle(f.read(), "detail", f.subject.submissionId);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ job: f.job });
    const source = await f.client.handle(f.read(), "source", f.subject.submissionId);
    expect(source.status).toBe(200); expect(await source.text()).toBe(f.sourceRaw);
    expect(source.headers.get("Cache-Control")).toBe("no-store");
    expect(source.headers.get("Content-Disposition")).toContain(f.subject.submissionId);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("queues a V2 plan with the exact body-bound authenticated assertion", async () => {
    const f = setup(), result = await f.client.handle(f.post({ expectedReviewRevision: 2, planJson: JSON.stringify(f.plan) }), "plan", f.subject.submissionId);
    expect(result.status).toBe(202);
    const [url, init] = f.fetchBackend.mock.calls.find(([url, init]) => String(url).endsWith("/plan") && init?.method === "POST")!;
    const bytes = Buffer.from(init!.body as Uint8Array), path = new URL(String(url)).pathname;
    expect(JSON.parse(bytes.toString())).toEqual({ expectedReviewRevision: 2, plan: f.plan });
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const signing = `programmable.custom-launch-api.wallet-bff-assertion.v2\0POST\0${path}\0did:privy:v2-review-fixture\0${f.wallet}\0${time}\0${nonce}\0${hash}`;
    expect(new Headers(init!.headers).get("X-Programmable-Bff-Assertion-Signature")).toBe(`hmac-sha256:${createHmac("sha256", key).update(signing).digest("hex")}`);
  });

  it("checks the V2 manifest and forwards the exact review command without a native or engine release", async () => {
    const f = setup(), hostManifestJson = JSON.stringify(f.manifest);
    const manifest = await f.client.handle(f.post({ expectedReviewRevision: 2, hostManifestJson }), "manifest", f.subject.submissionId);
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({ artifactDigest: f.artifact.artifactDigest, hostManifestHash: frozen.backend.hostManifestHash });
    const result = await f.client.handle(f.post({ command: f.command, hostManifestJson }), "decision", f.subject.submissionId);
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ decision: { command: f.command, reviewerWallet: f.wallet, registryApproved: false, available: false } });
    const [, init] = f.fetchBackend.mock.calls.find(([url]) => String(url).endsWith("/decisions"))!;
    expect(JSON.parse(Buffer.from(init!.body as Uint8Array).toString())).toEqual(f.command);
  });

  it.each([{ unlinked: true }, { nonAdmin: true }, { self: true }])("rejects unauthorized review before mutation: %j", async options => {
    const f = setup(options);
    const result = await f.client.handle(f.post({ command: f.command, hostManifestJson: JSON.stringify(f.manifest) }), "decision", f.subject.submissionId);
    expect(result.status).toBe(403);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    if (options.self) expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_SELF_DECISION_FORBIDDEN" } });
  });

  it.each([
    "V1 manifest", "V1 manifest domain", "LP custody", "missing acknowledgement", "V1 acknowledgement", "stale revision", "different artifact",
  ])("rejects %s before forwarding a decision", async kind => {
    const f = setup(); let hostManifestJson = JSON.stringify(f.manifest), command = f.command;
    if (kind === "V1 manifest") {
      const value = { ...f.manifest }; delete reviewRecord(value).factoryVersion; delete reviewRecord(value).lpCustodyId;
      hostManifestJson = JSON.stringify(value);
    }
    if (kind === "V1 manifest domain") command = { ...command, hostManifestHash: reviewDigest("programmable.module-foundation.protocol-host-manifest.v1", f.manifest) };
    if (kind === "LP custody") hostManifestJson = JSON.stringify({ ...f.manifest, lpCustodyId: otherHash });
    if (kind === "missing acknowledgement") command = { ...command, acknowledgedReviewAreas: f.artifact.reviewRequired.slice(0, -1) };
    if (kind === "V1 acknowledgement") command = { ...command, acknowledgedReviewAreas: frozenV1.protocol.artifact.reviewRequired };
    if (kind === "stale revision") command = { ...command, expectedReviewRevision: 1 };
    if (kind === "different artifact") command = { ...command, artifactDigest: otherHash };
    const result = await f.client.handle(f.post({ command, hostManifestJson }), "decision", f.subject.submissionId);
    expect([400, 409]).toContain(result.status);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses tampered upstream conformance before exposing source or forwarding a mutation", async () => {
    for (const operation of ["detail", "source", "decision"] as const) {
      const f = setup(), artifact = structuredClone(f.artifact);
      Object.assign(artifact.tests.checks, { directDeadPositionCustody: false });
      f.detail.job.artifact = rehash(artifact);
      const request = operation === "decision" ? f.post({ command: f.command, hostManifestJson: JSON.stringify(f.manifest) }) : f.read();
      const result = await f.client.handle(request, operation, f.subject.submissionId);
      expect(result.status).toBe(503);
      expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    }
  });
});
