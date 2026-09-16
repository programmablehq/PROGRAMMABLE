import { keccak256, sha256, toHex, encodeAbiParameters, parseAbi, toFunctionSelector, type Hex } from "viem";
import { nativeCanonicalJson, nativeJson } from "./native-catalog";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { ModuleReviewDecisionCommandV1, ModuleReviewDecisionRecordV1 } from "@/lib/server/module-mode/review-decision-wire-v1";

import { ENGINE_REVIEW_COMPILER, parseEngineReviewArtifact, validateModuleEngineBuildPlanV1 } from "./review-engine-contract";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "./review-engine-types";
import { parseModuleEngineConfigurationAbi } from "../module-engine/configuration";
import type { ModuleEngineConfigurationArgument as ModuleEngineConfigurationArgumentV1 } from "../module-engine/catalog";
export type { ModuleReviewDecisionCommandV1, ModuleReviewDecisionRecordV1 };
export type AnyFoundationProtocolPlan = FoundationProtocolPlanV1 | FoundationProtocolPlanV2;
export type AnyFoundationProtocolBuild = FoundationProtocolBuildV1 | FoundationProtocolBuildV2;
export type AnyReviewPlan = ReviewPlan | ModuleEngineBuildPlanV1 | FoundationBuildPlanV1 | AnyFoundationProtocolPlan;
export type AnyReviewBuildArtifact = ReviewBuildArtifact | ModuleEngineBuildArtifactV1 | FoundationBuildArtifactV1 | AnyFoundationProtocolBuild;
export const MODULE_REVIEW_STATES = ["awaiting_plan", "queued", "running", "built", "build_failed", "changes_requested", "accepted", "rejected"] as const;
export type ModuleReviewState = typeof MODULE_REVIEW_STATES[number];
export interface ReviewSubject { submissionId: string; principalId: string; author: string; requestDigest: Hex }
export interface ReviewProgramArgument { path: string[]; type: string }
export interface ReviewPlan { schemaVersion: "programmable.modules.native-build-plan.v1"; submissionId: string; requestDigest: Hex; programComponentId: string; factoryComponentId: string; configurationCodec: "programmable.native-abi@1"; programAbi: ReviewProgramArgument[]; callbackGas: number; cases: { id: string; parameters: unknown; budgetWei: string; expectedDeployment: "success" | "revert"; rawConfigBytes?: Hex }[] }
export interface ReviewContractArtifact { componentId: string; sourcePath: string; contractName: string; abi: unknown[]; abiHash: Hex; creationBytecode: Hex; creationCodeHash: Hex; runtimeBytecode: Hex; runtimeCodeHash: Hex; externalSelectors: string[] }
export interface ReviewBuildArtifact {
  schemaVersion: "programmable.modules.native-build.v1"; authority: "programmable.module-review.native-build.v1";
  subject: ReviewSubject; packageId: Hex; familyId: Hex; rewardWallet: string; sourceManifestHash: Hex; planDigest: Hex; configurationSchemaHash: Hex;
  compiler: { version: string; binarySha256: string; imageDigest: string; settingsHash: Hex; completeInputHash: Hex; reproducible: true };
  factory: ReviewContractArtifact; program: ReviewContractArtifact; configurationCodec: "programmable.native-abi@1"; programAbi: ReviewProgramArgument[]; callbackGas: number; cases: unknown[];
  tests: { schemaVersion: "programmable.modules.native-test-results.v1"; requestDigest: Hex; planDigest: Hex; harnessDigest: Hex; execution: "isolated-docker-anvil"; cases: Record<string, unknown>[]; allRequiredChecksPassed: boolean };
  reviewRequired: string[]; approved: false; registryApproved: false; available: false; artifactDigest: Hex;
}
export interface ReviewJob { subject: ReviewSubject; state: ModuleReviewState; reviewRevision: number; plan: AnyReviewPlan | null; planDigest: Hex | null; artifact: AnyReviewBuildArtifact | null; attempt: number; lastError: string | null; createdAt: string; updatedAt: string }
export interface ReviewQueueItem extends Omit<ReviewJob, "artifact" | "plan" | "planDigest"> { sourceSummary?: { name: string; version: string } | null; build: { artifactDigest: Hex; programName: string; testsPassed: boolean; caseCount: number } | null }
export interface ReviewQueue { schemaVersion: "programmable.modules.website-review-queue.v1"; jobs: ReviewQueueItem[]; nextCursor: string | null }
export interface ReviewSourceInfo { descriptor: OpenSourcePackage; packageId: Hex; familyId: Hex; files: { path: string; sha256: string; bytes: number }[] }
export interface ReviewAttempt { attempt: number; event: "claimed" | "completed" | "failed" | "expired"; requestDigest: Hex; planDigest: Hex; workerIdentity: null | { sourceCommit: string; runId: string; runAttempt: string; workflowRef: string; identityDigest: Hex }; artifactDigest: Hex | null; errorCode: string | null; createdAt: string }
export interface ReviewSourceCorrection {
  schemaVersion: "programmable.modules.source-correction-record.v1"; parentSubmissionId: string; submissionId: string;
  principalId: string; author: string; rewardWallet: string; familyId: Hex; baseRequestDigest: Hex; requestDigest: Hex;
  packageId: Hex; version: string; correctedBy: string; policyDigest: Hex; commandDigest: Hex; reason: string; createdAt: string; correctionDigest: Hex;
}
export interface ReviewDetail { schemaVersion: "programmable.modules.website-review-detail.v1"; job: ReviewJob; decisions: ModuleReviewDecisionRecordV1[]; attempts: ReviewAttempt[]; source: ReviewSourceInfo; sourceCorrection?: ReviewSourceCorrection | null }
export interface ReviewManifestCheck { schemaVersion: "programmable.modules.website-manifest-check.v1"; submissionId: string; requestDigest: Hex; reviewRevision: number; artifactDigest: Hex; hostManifestHash: Hex }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/u;
export function isReviewId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function isReviewDigest(value: unknown): value is Hex { return typeof value === "string" && HASH.test(value); }
export function reviewRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Module review data is invalid.");
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))) throw new Error("Module review fields differ from the expected format.");
  return result;
}
function requireValue(ok: unknown, label: string): asserts ok { if (!ok) throw new Error(`Module review ${label} is invalid.`); }
function integer(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
const JOB_KEYS = ["subject", "state", "reviewRevision", "plan", "planDigest", "artifact", "attempt", "lastError", "createdAt", "updatedAt"];
function jobState(r: Record<string, unknown>) {
  requireValue(MODULE_REVIEW_STATES.includes(r.state as ModuleReviewState) && integer(r.reviewRevision) && integer(r.attempt) && (r.lastError === null || (typeof r.lastError === "string" && r.lastError.length <= 256)) && timestamp(r.createdAt) && timestamp(r.updatedAt), "job state");
}
export function reviewDigest(domain: string, value: unknown): Hex { return sha256(toHex(nativeCanonicalJson({ domain, value }))); }
export function parseReviewSubject(value: unknown): ReviewSubject {
  const r = reviewRecord(value, ["submissionId", "principalId", "author", "requestDigest"]);
  requireValue(isReviewId(r.submissionId) && isReviewId(r.principalId) && typeof r.author === "string" && ADDRESS.test(r.author) && isReviewDigest(r.requestDigest), "subject");
  return r as unknown as ReviewSubject;
}
export function parseReviewSourceCorrection(value: unknown): ReviewSourceCorrection {
  const r = reviewRecord(value, ["schemaVersion", "parentSubmissionId", "submissionId", "principalId", "author", "rewardWallet", "familyId", "baseRequestDigest", "requestDigest", "packageId", "version", "correctedBy", "policyDigest", "commandDigest", "reason", "createdAt", "correctionDigest"]);
  requireValue(r.schemaVersion === "programmable.modules.source-correction-record.v1" && isReviewId(r.parentSubmissionId)
    && isReviewId(r.submissionId) && r.submissionId !== r.parentSubmissionId && isReviewId(r.principalId), "source correction subject");
  for (const key of ["author", "rewardWallet", "correctedBy"] as const) requireValue(typeof r[key] === "string" && ADDRESS.test(r[key]), "source correction wallet");
  for (const key of ["familyId", "baseRequestDigest", "requestDigest", "packageId", "policyDigest", "commandDigest", "correctionDigest"] as const) requireValue(isReviewDigest(r[key]), "source correction digest");
  requireValue(typeof r.version === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-pm\.[1-9][0-9]*$/u.test(r.version) && r.version.length <= 128
    && typeof r.reason === "string" && r.reason.trim() === r.reason && !r.reason.includes("\0") && new TextEncoder().encode(r.reason).byteLength >= 10 && new TextEncoder().encode(r.reason).byteLength <= 4096
    && r.correctedBy !== r.author && r.baseRequestDigest !== r.requestDigest && timestamp(r.createdAt), "source correction metadata");
  const { correctionDigest, ...contents } = r;
  requireValue(correctionDigest === reviewDigest("programmable.modules.source-correction-record.v1", contents), "source correction record digest");
  return r as unknown as ReviewSourceCorrection;
}
export function parseReviewProgramAbi(value: unknown): ReviewProgramArgument[] {
  requireValue(Array.isArray(value) && value.length <= 128, "configuration ABI");
  for (const raw of value) {
    const argument = reviewRecord(raw, ["path", "type"]);
    requireValue(Array.isArray(argument.path) && argument.path.length <= 16 && argument.path.every(key => typeof key === "string" && /^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|0|[1-9][0-9]{0,2})$/u.test(key) && !["__proto__", "prototype", "constructor"].includes(key)), "configuration ABI path");
    requireValue(typeof argument.type === "string" && argument.type.length > 0 && argument.type.length <= 128, "configuration ABI type");
    const type = /^(address|bool|string|bytes(?:[1-9]|[12][0-9]|3[0-2])?|uint(?:[1-9][0-9]{0,2})?)((?:\[(?:[1-9][0-9]{0,2})?\])*)$/u.exec(argument.type);
    requireValue(type !== null, "configuration ABI type");
    if (type[1].startsWith("uint") && type[1] !== "uint") {
      const bits = Number(type[1].slice(4));
      requireValue(bits >= 8 && bits <= 256 && bits % 8 === 0, "configuration ABI integer width");
    }
    const dimensions = [...type[2].matchAll(/\[([0-9]*)\]/gu)];
    requireValue(dimensions.length <= 12 && dimensions.every(([, size]) => size === "" || Number(size) <= 256), "configuration ABI array bounds");
  }
  return value as ReviewProgramArgument[];
}
export function parseReviewPlan(value: unknown, subject: ReviewSubject): AnyReviewPlan {
  const raw = nativeJson(value), schema = reviewRecord(raw).schemaVersion;
  if (schema === FOUNDATION_PLAN_SCHEMA_V1) return validateFoundationBuildPlanV1(raw, subject);
  if (schema === FOUNDATION_PROTOCOL_PLAN_V1) return validateFoundationProtocolPlanV1(raw, subject);
  if (schema === FOUNDATION_PROTOCOL_PLAN_V2) return validateFoundationProtocolPlanV2(raw, subject);
  return schema === "programmable.modules.engine-build-plan.v1"
    ? validateModuleEngineBuildPlanV1(raw, subject) : parseNativeReviewPlan(raw, subject);
}
export function parseNativeReviewPlan(value: unknown, subject: ReviewSubject): ReviewPlan {
  const p = reviewRecord(nativeJson(value), ["schemaVersion", "submissionId", "requestDigest", "programComponentId", "factoryComponentId", "configurationCodec", "programAbi", "callbackGas", "cases"]);
  requireValue(p.schemaVersion === "programmable.modules.native-build-plan.v1" && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest, "plan subject");
  requireValue(p.configurationCodec === "programmable.native-abi@1", "configuration codec");
  parseReviewProgramAbi(p.programAbi);
  const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
  requireValue(typeof p.programComponentId === "string" && identifier.test(p.programComponentId) && typeof p.factoryComponentId === "string" && identifier.test(p.factoryComponentId) && p.programComponentId !== p.factoryComponentId, "plan components");
  requireValue(integer(p.callbackGas) && Number(p.callbackGas) >= 25_000 && Number(p.callbackGas) <= 500_000, "callback gas");
  requireValue(Array.isArray(p.cases) && p.cases.length >= 1 && p.cases.length <= 16, "plan cases");
  const ids = new Set<string>(); let positive = false;
  for (const raw of p.cases) {
    const c = reviewRecord(raw, ["id", "parameters", "budgetWei", "expectedDeployment", ...(Object.hasOwn(reviewRecord(raw), "rawConfigBytes") ? ["rawConfigBytes"] : [])]);
    requireValue(typeof c.id === "string" && identifier.test(c.id) && !ids.has(c.id), "case identifier"); ids.add(c.id);
    requireValue(typeof c.budgetWei === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(c.budgetWei) && BigInt(c.budgetWei) < 2n ** 128n, "case budget");
    requireValue(c.expectedDeployment === "success" || c.expectedDeployment === "revert", "case outcome");
    requireValue(c.rawConfigBytes === undefined || (c.expectedDeployment === "revert" && typeof c.rawConfigBytes === "string" && /^0x(?:[0-9a-f]{2})*$/u.test(c.rawConfigBytes) && c.rawConfigBytes.length <= 32_770), "negative configuration");
    positive ||= c.expectedDeployment === "success";
  }
  requireValue(positive, "positive test coverage");
  return p as unknown as ReviewPlan;
}
export function parseReviewArtifact(value: unknown, subject: ReviewSubject): AnyReviewBuildArtifact {
  const schema = reviewRecord(value).schemaVersion;
  if (schema === FOUNDATION_BUILD_SCHEMA_V1 || schema === FOUNDATION_PROTOCOL_BUILD_V1 || schema === FOUNDATION_PROTOCOL_BUILD_V2) return parseFoundationReviewArtifact(value, subject);
  return schema === "programmable.modules.engine-build.v1"
    ? parseEngineReviewArtifact(value, subject) : parseNativeReviewArtifact(value, subject);
}
export function parseNativeReviewArtifact(value: unknown, subject: ReviewSubject): ReviewBuildArtifact {
  const r = reviewRecord(nativeJson(value));
  const { artifactDigest, ...contents } = r;
  requireValue(r.schemaVersion === "programmable.modules.native-build.v1" && r.authority === "programmable.module-review.native-build.v1" && isReviewDigest(artifactDigest) && reviewDigest("programmable.modules.native-build.v1", contents) === artifactDigest, "build digest");
  requireValue(nativeCanonicalJson(parseReviewSubject(r.subject)) === nativeCanonicalJson(subject), "build subject");
  requireValue(r.configurationCodec === "programmable.native-abi@1", "configuration codec");
  parseReviewProgramAbi(r.programAbi);
  for (const field of ["packageId", "familyId", "sourceManifestHash", "planDigest", "configurationSchemaHash"]) requireValue(isReviewDigest(r[field]), field);
  requireValue(typeof r.rewardWallet === "string" && ADDRESS.test(r.rewardWallet) && r.approved === false && r.registryApproved === false && r.available === false, "build authority");
  requireValue(integer(r.callbackGas) && Number(r.callbackGas) >= 25_000 && Number(r.callbackGas) <= 500_000 && Array.isArray(r.cases) && r.cases.length >= 1 && r.cases.length <= 16, "build cases");
  requireValue(Array.isArray(r.reviewRequired) && r.reviewRequired.length <= 32 && new Set(r.reviewRequired).size === r.reviewRequired.length && r.reviewRequired.every((area) => typeof area === "string" && /^[a-z][a-z0-9-]{0,127}$/u.test(area)), "required review areas");
  const compiler = reviewRecord(r.compiler);
  requireValue(compiler.reproducible === true && ["version", "binarySha256", "imageDigest"].every((key) => typeof compiler[key] === "string" && String(compiler[key]).length < 256), "compiler");
  requireValue(isReviewDigest(compiler.settingsHash) && isReviewDigest(compiler.completeInputHash), "compiler input");
  for (const key of ["factory", "program"]) {
    const c = reviewRecord(r[key]);
    requireValue(["componentId", "sourcePath", "contractName"].every((field) => typeof c[field] === "string" && String(c[field]).length <= 512) && Array.isArray(c.abi) && c.abi.length <= 256 && Array.isArray(c.externalSelectors), "compiled contract");
    requireValue(c.abiHash === reviewDigest("programmable.modules.abi.v1", c.abi) && c.externalSelectors.every((selector) => typeof selector === "string" && /^0x[0-9a-f]{8}$/u.test(selector)), "compiled ABI");
    for (const [bytes, hash, maximum] of [["runtimeBytecode", "runtimeCodeHash", 49_154], ["creationBytecode", "creationCodeHash", 98_306]] as const) {
      requireValue(typeof c[bytes] === "string" && /^0x(?:[0-9a-f]{2})+$/u.test(c[bytes]) && c[bytes].length <= maximum && keccak256(c[bytes] as Hex) === c[hash], "compiled bytecode");
    }
  }
  const tests = reviewRecord(r.tests);
  requireValue(tests.schemaVersion === "programmable.modules.native-test-results.v1" && tests.requestDigest === subject.requestDigest && tests.planDigest === r.planDigest && isReviewDigest(tests.harnessDigest) && tests.execution === "isolated-docker-anvil" && typeof tests.allRequiredChecksPassed === "boolean" && Array.isArray(tests.cases) && tests.cases.length <= 16, "build test results");
  requireValue(tests.cases.length === r.cases.length, "test coverage");
  const flags = ["codeHashMatched", "bindingMatched", "unauthorizedTradeReverted", "unauthorizedActionReverted", "callbackGasBound", "budgetIsolationChecked"];
  tests.cases.forEach((raw, index) => {
    const result = reviewRecord(raw, ["id", "configHash", "deploymentMatched", ...flags]);
    const compiled = reviewRecord((r.cases as unknown[])[index]);
    requireValue(typeof result.id === "string" && result.id === compiled.id && isReviewDigest(result.configHash) && result.configHash === compiled.configHash && typeof result.deploymentMatched === "boolean" && flags.every((key) => result[key] === null || typeof result[key] === "boolean"), "test case");
    if (tests.allRequiredChecksPassed) requireValue(result.deploymentMatched && flags.every((key) => result[key] === (compiled.expectedDeployment === "success" ? true : null)), "reported test success");
  });
  return r as unknown as ReviewBuildArtifact;
}
export function parseReviewJob(value: unknown): ReviewJob {
  const r = reviewRecord(value, JOB_KEYS);
  const subject = parseReviewSubject(r.subject);
  jobState(r);
  const plan = r.plan === null ? null : parseReviewPlan(r.plan, subject);
  requireValue(plan === null ? r.planDigest === null : r.planDigest === reviewDigest(plan.schemaVersion, plan), "plan digest");
  const artifact = r.artifact === null ? null : plan?.schemaVersion === "programmable.modules.engine-build-plan.v1"
    ? parseEngineReviewArtifact(r.artifact, subject, plan) : parseReviewArtifact(r.artifact, subject);
  requireValue(!artifact || artifact.planDigest === r.planDigest, "build plan binding");
  if (artifact && plan) {
    if (artifact.schemaVersion === FOUNDATION_BUILD_SCHEMA_V1 || isFoundationProtocolArtifact(artifact)) parseFoundationReviewArtifact(artifact, subject, plan);
    else requireValue("configurationCodec" in plan && artifact.configurationCodec === plan.configurationCodec &&
      (artifact.schemaVersion === "programmable.modules.native-build.v1" && plan.schemaVersion === "programmable.modules.native-build-plan.v1"
        ? nativeCanonicalJson(artifact.programAbi) === nativeCanonicalJson(plan.programAbi)
        : artifact.schemaVersion === "programmable.modules.engine-build.v1" && plan.schemaVersion === "programmable.modules.engine-build-plan.v1" && nativeCanonicalJson(artifact.configurationAbi) === nativeCanonicalJson(plan.configurationAbi)), "build configuration ABI binding");
  }
  requireValue(!artifact || plan !== null, "required build plan");
  requireValue(!["built", "accepted"].includes(String(r.state)) || artifact !== null, "required build");
  return { ...(r as unknown as ReviewJob), subject, plan, artifact };
}
export function parseReviewAttempt(value: unknown, subject: ReviewSubject): ReviewAttempt {
  const r = reviewRecord(value, ["attempt", "event", "requestDigest", "planDigest", "workerIdentity", "artifactDigest", "errorCode", "createdAt"]);
  requireValue(integer(r.attempt) && Number(r.attempt) > 0 && ["claimed", "completed", "failed", "expired"].includes(String(r.event)) && r.requestDigest === subject.requestDigest && isReviewDigest(r.planDigest) && (r.artifactDigest === null || isReviewDigest(r.artifactDigest)) && (r.errorCode === null || (typeof r.errorCode === "string" && /^[A-Z_a-z0-9]{1,128}$/u.test(r.errorCode))) && typeof r.createdAt === "string" && Number.isFinite(Date.parse(r.createdAt)), "build attempt");
  if (r.workerIdentity !== null) {
    const worker = reviewRecord(r.workerIdentity, ["sourceCommit", "runId", "runAttempt", "workflowRef", "identityDigest"]);
    requireValue(typeof worker.sourceCommit === "string" && /^[0-9a-f]{40}$/u.test(worker.sourceCommit) && typeof worker.runId === "string" && /^[1-9][0-9]{0,19}$/u.test(worker.runId) && typeof worker.runAttempt === "string" && /^[1-9][0-9]{0,9}$/u.test(worker.runAttempt) && typeof worker.workflowRef === "string" && worker.workflowRef.length <= 1024 && isReviewDigest(worker.identityDigest), "worker identity");
  }
  return r as unknown as ReviewAttempt;
}
export function summarizeReviewJob(job: ReviewJob): ReviewQueueItem {
  return { subject: job.subject, state: job.state, reviewRevision: job.reviewRevision, attempt: job.attempt, lastError: job.lastError, createdAt: job.createdAt, updatedAt: job.updatedAt, build: job.artifact ? { artifactDigest: job.artifact.artifactDigest, programName: isFoundationProtocolArtifact(job.artifact) ? job.artifact.factory.contractName : job.artifact.schemaVersion === FOUNDATION_BUILD_SCHEMA_V1 ? job.artifact.module.contractName : job.artifact.schemaVersion === "programmable.modules.engine-build.v1" ? job.artifact.engine.contractName : job.artifact.program.contractName, testsPassed: job.artifact.tests.allRequiredChecksPassed, caseCount: reviewArtifactCheckCount(job.artifact) } : null };
}
export function parseReviewQueueItem(value: unknown): ReviewQueueItem {
  const raw = reviewRecord(value);
  const r = reviewRecord(raw, Object.hasOwn(raw, "sourceSummary") ? [...JOB_KEYS, "sourceSummary"] : JOB_KEYS); jobState(r);
  const subject = parseReviewSubject(r.subject);
  requireValue(r.plan === null && r.artifact === null && (r.planDigest === null || isReviewDigest(r.planDigest)), "lightweight queue entry");
  const result = summarizeReviewJob({ ...r, subject } as unknown as ReviewJob);
  if (r.sourceSummary !== undefined && r.sourceSummary !== null) {
    const summary = reviewRecord(r.sourceSummary, ["name", "version"]);
    const bytes = new TextEncoder();
    requireValue(typeof summary.name === "string" && bytes.encode(summary.name).length >= 1 && bytes.encode(summary.name).length <= 512 &&
      typeof summary.version === "string" && bytes.encode(summary.version).length >= 1 && bytes.encode(summary.version).length <= 128, "source summary");
    result.sourceSummary = { name: summary.name, version: summary.version };
  }
  return result;
}
export function reviewStateLabel(state: ModuleReviewState) {
  return ({ awaiting_plan: "Needs build plan", queued: "Queued", running: "Building", built: "Ready for review", build_failed: "Build failed", changes_requested: "Changes requested", accepted: "Review approved", rejected: "Rejected" })[state];
}

export function reviewArtifactCheckCount(artifact: AnyReviewBuildArtifact): number {
  return isFoundationProtocolArtifact(artifact) ? Object.keys(artifact.tests.checks).length : artifact.tests.cases.length;
}

/** Discriminates already parsed artifacts; untrusted input must pass parseReviewArtifact first. */
export function isFoundationProtocolArtifact(artifact: AnyReviewBuildArtifact | null | undefined): artifact is AnyFoundationProtocolBuild {
  return artifact?.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V1 || artifact?.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V2;
}

/** Review binds immutable source/build facts; release, deployment and activation are separate authorities. */
export function foundationProtocolReviewManifestV1(artifact: FoundationProtocolBuildV1) {
  return { hostAdapterId: artifact.hostAdapterId, sourceCommit: artifact.sourceCommit, sourceManifestHash: artifact.sourceManifestHash,
    compiler: artifact.compiler, platformBps: artifact.platformBps, platformRecipient: artifact.platformRecipient,
    factory: artifact.factory, hookDeployer: artifact.hookDeployer, factoryImmutableBindings: artifact.factoryImmutableBindings };
}
export function foundationProtocolReviewManifestHashV1(artifact: FoundationProtocolBuildV1): Hex {
  return reviewDigest("programmable.module-foundation.protocol-host-manifest.v1", foundationProtocolReviewManifestV1(artifact));
}

export function foundationProtocolReviewManifestV2(artifact: FoundationProtocolBuildV2) {
  return { hostAdapterId: artifact.hostAdapterId, factoryVersion: artifact.factoryVersion, lpCustodyId: artifact.lpCustodyId,
    sourceCommit: artifact.sourceCommit, sourceManifestHash: artifact.sourceManifestHash, compiler: artifact.compiler,
    platformBps: artifact.platformBps, platformRecipient: artifact.platformRecipient,
    factory: artifact.factory, hookDeployer: artifact.hookDeployer, factoryImmutableBindings: artifact.factoryImmutableBindings };
}
export function foundationProtocolReviewManifestHashV2(artifact: FoundationProtocolBuildV2): Hex {
  return reviewDigest("programmable.module-foundation.protocol-host-manifest.v2", foundationProtocolReviewManifestV2(artifact));
}
export function foundationProtocolReviewManifest(artifact: AnyFoundationProtocolBuild) {
  return artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V2 ? foundationProtocolReviewManifestV2(artifact) : foundationProtocolReviewManifestV1(artifact);
}
export function foundationProtocolReviewManifestHash(artifact: AnyFoundationProtocolBuild): Hex {
  return artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V2 ? foundationProtocolReviewManifestHashV2(artifact) : foundationProtocolReviewManifestHashV1(artifact);
}

export function parseFoundationReviewArtifact(value: unknown, subject: ReviewSubject, suppliedPlan?: AnyReviewPlan): FoundationBuildArtifactV1 | AnyFoundationProtocolBuild {
  const raw = reviewRecord(nativeJson(value));
  const protocolV2 = raw.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V2;
  const protocol = raw.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V1 || protocolV2;
  reviewRecord(raw, ["schemaVersion", "authority", "subject", "packageId", "familyId", "rewardWallet", "sourceManifestHash", "planDigest", "hostAdapterId", "compiler", "factory", "tests", "reviewRequired", "approved", "registryApproved", "available", "artifactDigest",
    ...(protocolV2 ? ["factoryVersion", "lpCustodyId"] : []),
    ...(protocol ? ["sourceCommit", "platformBps", "platformRecipient", "hookDeployer", "factoryImmutableBindings"] : ["manifestHash", "descriptor", "descriptorHash", "configurationSchemaHash", "configurationCodec", "configurationAbi", "module", "cases"])]);
  const { artifactDigest, ...contents } = raw;
  requireValue(raw.schemaVersion === (protocolV2 ? FOUNDATION_PROTOCOL_BUILD_V2 : protocol ? FOUNDATION_PROTOCOL_BUILD_V1 : FOUNDATION_BUILD_SCHEMA_V1)
    && raw.authority === (protocolV2 ? "programmable.module-review.foundation-protocol-build.v2" : protocol ? "programmable.module-review.foundation-protocol-build.v1" : "programmable.module-review.foundation-build.v1")
    && isReviewDigest(artifactDigest) && artifactDigest === reviewDigest(String(raw.schemaVersion), contents), "Foundation artifact digest");
  requireValue(nativeCanonicalJson(parseReviewSubject(raw.subject)) === nativeCanonicalJson(subject) && raw.hostAdapterId === FOUNDATION_HOST_V1
    && raw.approved === false && raw.registryApproved === false && raw.available === false && typeof raw.rewardWallet === "string" && ADDRESS.test(raw.rewardWallet), "Foundation artifact authority");
  for (const key of ["packageId", "familyId", "sourceManifestHash", "planDigest"]) requireValue(isReviewDigest(raw[key]), "Foundation identity");
  const compiler = reviewRecord(raw.compiler, ["version", "binarySha256", "imageDigest", "settingsHash", "completeInputHash", "reproducible"]);
  requireValue(Object.entries(ENGINE_REVIEW_COMPILER).every(([key, value]) => compiler[key] === value) && compiler.reproducible === true
    && compiler.settingsHash === reviewDigest("programmable.modules.compiler-settings.v1", FOUNDATION_SETTINGS_V1) && isReviewDigest(compiler.completeInputHash), "Foundation compiler profile");
  requireValue(nativeCanonicalJson(raw.reviewRequired) === nativeCanonicalJson(protocolV2 ? FOUNDATION_PROTOCOL_REVIEW_AREAS_V2 : protocol ? FOUNDATION_PROTOCOL_REVIEW_AREAS_V1 : FOUNDATION_REVIEW_AREAS_V1)
    && new TextEncoder().encode(nativeCanonicalJson(raw)).length <= 2 * 1024 * 1024, "Foundation review coverage");
  const target = (contract: { componentId: string; sourcePath: string; contractName: string }) => {
    requireValue(typeof contract.componentId === "string" && ID.test(contract.componentId) && typeof contract.sourcePath === "string" && contract.sourcePath.length <= 512
      && typeof contract.contractName === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,255}$/u.test(contract.contractName), "Foundation target");
    return { id: contract.componentId, sourcePath: contract.sourcePath, entrypoint: contract.contractName };
  };
  if (protocol) {
    const artifact = raw as unknown as AnyFoundationProtocolBuild;
    const plan = (protocolV2 ? validateFoundationProtocolPlanV2 : validateFoundationProtocolPlanV1)({ schemaVersion: protocolV2 ? FOUNDATION_PROTOCOL_PLAN_V2 : FOUNDATION_PROTOCOL_PLAN_V1, submissionId: subject.submissionId, requestDigest: subject.requestDigest,
      sourceCommit: artifact.sourceCommit, factoryComponentId: artifact.factory.componentId, hookDeployerComponentId: artifact.hookDeployer.componentId, factoryImmutableBindings: artifact.factoryImmutableBindings }, subject);
    requireValue(artifact.platformBps === 30 && artifact.platformRecipient === "0xd88539d3c4c460136a733a3fd60cf6bf269079da", "Foundation protocol economics");
    if (artifact.schemaVersion === FOUNDATION_PROTOCOL_BUILD_V2) requireValue(artifact.factoryVersion === "v2" && artifact.lpCustodyId === FOUNDATION_LP_CUSTODY_ID_V2, "Foundation protocol custody");
    for (const [contract, bindings] of [[artifact.factory, plan.factoryImmutableBindings], [artifact.hookDeployer, []]] as const) {
      requireValue(Array.isArray(contract.immutableReferences) && contract.immutableReferences.length <= 11, "Foundation immutable references");
      const rebuilt = foundationProtocolContractArtifact({ abi: contract.abi, evm: { bytecode: { object: contract.creationBytecode.slice(2) }, deployedBytecode: { object: contract.runtimeTemplate.slice(2),
        immutableReferences: Object.fromEntries(contract.immutableReferences.map(ref => [ref.id, ref.ranges])) } } }, target(contract), bindings);
      requireValue(nativeCanonicalJson(contract) === nativeCanonicalJson(rebuilt), "Foundation protocol contract");
    }
    const tests = reviewRecord(artifact.tests, ["schemaVersion", "requestDigest", "planDigest", "harnessDigest", "execution", "checks", "allRequiredChecksPassed"]);
    const checks = reviewRecord(tests.checks, protocolV2 ? FOUNDATION_PROTOCOL_CHECKS_V2 : FOUNDATION_PROTOCOL_CHECKS_V1);
    requireValue(tests.schemaVersion === (protocolV2 ? "programmable.modules.foundation-protocol-test-results.v2" : "programmable.modules.foundation-protocol-test-results.v1") && tests.requestDigest === subject.requestDigest && tests.planDigest === artifact.planDigest
      && isReviewDigest(tests.harnessDigest) && tests.execution === "isolated-docker-anvil" && tests.allRequiredChecksPassed === true && Object.values(checks).every(value => value === true), "Foundation protocol tests");
    requireValue(artifact.planDigest === reviewDigest(plan.schemaVersion, plan) && (!suppliedPlan || nativeCanonicalJson(suppliedPlan) === nativeCanonicalJson(plan)), "Foundation protocol plan");
    return artifact;
  }
  const artifact = raw as unknown as FoundationBuildArtifactV1;
  const descriptor = validateFoundationDescriptorV1(artifact.descriptor);
  requireValue(artifact.descriptorHash === hashFoundationDescriptorV1(descriptor) && isReviewDigest(artifact.manifestHash) && isReviewDigest(artifact.configurationSchemaHash)
    && Array.isArray(artifact.cases) && artifact.cases.length > 0 && artifact.cases.length <= 16, "Foundation descriptor");
  const plan = validateFoundationBuildPlanV1({ schemaVersion: FOUNDATION_PLAN_SCHEMA_V1, submissionId: subject.submissionId, requestDigest: subject.requestDigest,
    moduleComponentId: artifact.module.componentId, factoryComponentId: artifact.factory.componentId, hostAdapterId: artifact.hostAdapterId, descriptorHash: artifact.descriptorHash,
    configurationCodec: artifact.configurationCodec, configurationAbi: artifact.configurationAbi,
    cases: artifact.cases.map(value => Object.fromEntries(Object.entries(value).filter(([key]) => !["configBytes", "configHash", "compiledActions"].includes(key)))) }, subject);
  for (const [contract, factory] of [[artifact.module, false], [artifact.factory, true]] as const) {
    const rebuilt = foundationModuleContractArtifact({ abi: contract.abi, evm: { bytecode: { object: contract.creationBytecode.slice(2) }, deployedBytecode: { object: contract.runtimeBytecode.slice(2), immutableReferences: {} } } }, target(contract), factory);
    requireValue(nativeCanonicalJson(contract) === nativeCanonicalJson(rebuilt), "Foundation module contract");
  }
  for (const value of artifact.cases) {
    hex(value.configBytes); requireValue(value.configHash === keccak256(value.configBytes) && Array.isArray(value.compiledActions) && value.compiledActions.length === value.actions.length, "Foundation compiled case");
    value.compiledActions.forEach((action: FoundationCompiledCaseV1["compiledActions"][number], index: number) => {
      const { data, ...expected } = action; hex(data, 4);
      requireValue(nativeCanonicalJson(expected) === nativeCanonicalJson(value.actions[index]), "Foundation compiled action");
    });
  }
  validateResults(artifact.tests, subject.requestDigest, artifact.planDigest, artifact.cases);
  requireValue(artifact.planDigest === reviewDigest(plan.schemaVersion, plan) && (!suppliedPlan || nativeCanonicalJson(suppliedPlan) === nativeCanonicalJson(plan)), "Foundation module plan");
  return artifact;
}

// Inert DTO profiles mirrored from the protected backend Foundation adapter v1.
export const FOUNDATION_PLAN_SCHEMA_V1 = "programmable.modules.foundation-build-plan.v1" as const;
export const FOUNDATION_BUILD_SCHEMA_V1 = "programmable.modules.foundation-build.v1" as const;
export const FOUNDATION_PROFILE_V1 = "programmable.module-foundation.solidity@1" as const;
export const FOUNDATION_EXTENSION_V1 = "programmable.module-foundation@1" as const;
export const FOUNDATION_HOST_V1 = "programmable.module-foundation.host@1" as const;
export const FOUNDATION_CODEC_V1 = "programmable.foundation-abi@1" as const;
export const FOUNDATION_MANIFEST_SCHEMA_V1 = "programmable.module-foundation.package.v1" as const;
export const FOUNDATION_DESCRIPTOR_ABI_V1 = [{ type: "tuple", components: [
  { name: "moduleId", type: "bytes32" }, { name: "abiVersion", type: "uint16" },
  { name: "phases", type: "uint8" }, { name: "resources", type: "uint8" },
  { name: "beforeGas", type: "uint32" }, { name: "afterGas", type: "uint32" },
  { name: "actionGas", type: "uint32" }, { name: "failOpenAfter", type: "bool" },
  { name: "exclusiveGroup", type: "bytes32" },
] }] as const;
export interface FoundationDescriptorV1 {
  moduleId: Hex; abiVersion: 1; phases: number; resources: number;
  beforeGas: number; afterGas: number; actionGas: number; failOpenAfter: boolean; exclusiveGroup: Hex;
}
export interface FoundationAssertionV1 { readonly callData: `0x${string}`; readonly expectedData: `0x${string}` }
export interface FoundationSwapV1 {
  readonly buy: boolean; readonly exactInput: boolean;
  readonly beforeOutcome: "success" | "revert" | "absent";
  readonly afterOutcome: "success" | "revert" | "absent";
  readonly assertions: readonly FoundationAssertionV1[];
}
export interface FoundationActionV1 {
  readonly id: string; readonly actor: "creator" | "user"; readonly parameters: unknown;
  readonly expectedOutcome: "success" | "revert"; readonly assertions: readonly FoundationAssertionV1[];
}
export interface FoundationCaseV1 {
  readonly id: string; readonly parameters: unknown; readonly budgetQuote: string;
  readonly expectedDeployment: "success" | "revert"; readonly rawConfigBytes?: `0x${string}`;
  readonly swaps: readonly FoundationSwapV1[]; readonly actions: readonly FoundationActionV1[];
}
/** Chosen by the existing authenticated reviewer plan endpoint, never by an uploaded executable. */
export interface FoundationBuildPlanV1 {
  readonly schemaVersion: typeof FOUNDATION_PLAN_SCHEMA_V1;
  readonly submissionId: string; readonly requestDigest: Hex;
  readonly moduleComponentId: string; readonly factoryComponentId: string;
  readonly hostAdapterId: typeof FOUNDATION_HOST_V1; readonly descriptorHash: Hex;
  readonly configurationCodec: typeof FOUNDATION_CODEC_V1;
  readonly configurationAbi: readonly ModuleEngineConfigurationArgumentV1[];
  readonly cases: readonly FoundationCaseV1[];
}
export interface FoundationCompiledCaseV1 extends FoundationCaseV1 {
  readonly configBytes: `0x${string}`; readonly configHash: Hex;
  readonly compiledActions: readonly (FoundationActionV1 & { readonly data: `0x${string}` })[];
}
export interface FoundationTestResultV1 {
  readonly schemaVersion: "programmable.modules.foundation-test-results.v1";
  readonly requestDigest: Hex; readonly planDigest: Hex;
  readonly harnessDigest: Hex; readonly execution: "isolated-docker-anvil";
  readonly cases: readonly {
    readonly id: string; readonly configHash: Hex; readonly deploymentMatched: boolean;
    readonly codeHashMatched: boolean | null; readonly contextMatched: boolean | null;
    readonly descriptorMatched: boolean | null; readonly configurationMatched: boolean | null;
    readonly freshInstances: boolean | null; readonly unauthorizedCallbacksReverted: boolean | null;
    readonly boundedCallbacks: boolean | null; readonly ownQuoteBudgetConserved: boolean | null;
    readonly swapOutcomes: readonly boolean[]; readonly actionOutcomes: readonly boolean[];
    readonly stateAssertions: boolean | null;
  }[];
  readonly allRequiredChecksPassed: boolean;
}
export interface FoundationBuildArtifactV1 {
  readonly schemaVersion: typeof FOUNDATION_BUILD_SCHEMA_V1;
  readonly authority: "programmable.module-review.foundation-build.v1";
  readonly subject: ReviewSubject; readonly packageId: Hex; readonly familyId: Hex;
  readonly rewardWallet: string; readonly sourceManifestHash: Hex; readonly manifestHash: Hex;
  readonly planDigest: Hex; readonly hostAdapterId: typeof FOUNDATION_HOST_V1;
  readonly descriptor: FoundationDescriptorV1; readonly descriptorHash: Hex;
  readonly configurationSchemaHash: Hex; readonly configurationCodec: typeof FOUNDATION_CODEC_V1;
  readonly configurationAbi: readonly ModuleEngineConfigurationArgumentV1[];
  readonly compiler: {
    readonly version: string; readonly binarySha256: string; readonly imageDigest: string;
    readonly settingsHash: Hex; readonly completeInputHash: Hex; readonly reproducible: true;
  };
  readonly factory: ReviewContractArtifact; readonly module: ReviewContractArtifact;
  readonly cases: readonly FoundationCompiledCaseV1[]; readonly tests: FoundationTestResultV1;
  readonly reviewRequired: readonly string[]; readonly approved: false; readonly registryApproved: false; readonly available: false;
  readonly artifactDigest: Hex;
}

export const FOUNDATION_PROTOCOL_PLAN_V1 = "programmable.modules.foundation-protocol-build-plan.v1" as const;
export const FOUNDATION_PROTOCOL_BUILD_V1 = "programmable.modules.foundation-protocol-build.v1" as const;
export const FOUNDATION_PROTOCOL_EXTENSION_V1 = "programmable.module-foundation.protocol@1" as const;
export const FOUNDATION_PROTOCOL_CHECKS_V1 = Object.freeze([
  "officialInfrastructure", "bothTokenOrders", "zeroCreatorQuoteLaunch", "metadataSupplyAndPoolIdentity",
  "initialBuyAtomicity", "additionalCreatorPositionOwnership", "universalRouterFourForms",
  "quoteFeeAccounting30Bps", "fixedPlatformRecipientPayout", "settlementAndAllowances",
] as const);
export const FOUNDATION_PROTOCOL_REVIEW_AREAS_V1 = Object.freeze([
  "foundation-standard-token-fixed-supply-no-transfer-tax", "foundation-immutable-30bps-platform-quote-fee",
  "foundation-poolmanager-account-and-currency-deltas", "foundation-official-router-empty-hookdata-four-forms",
  "foundation-one-sided-position-price-and-creator-nft-ownership", "foundation-immutable-host-module-capabilities",
  "foundation-reentrancy-partialfill-and-quote-transfer-adversaries", "foundation-source-runtime-and-deployment-binding",
] as const);
export const FOUNDATION_PROTOCOL_FIELDS_V1 = ["chainId", "poolManager", "positionManager", "universalRouter", "permit2", "hookDeployer", "poolManagerCodeHash", "positionManagerCodeHash", "universalRouterCodeHash", "permit2CodeHash", "hookDeployerCodeHash"] as const;
type Field = typeof FOUNDATION_PROTOCOL_FIELDS_V1[number];
export interface FoundationProtocolPlanV1 {
  readonly schemaVersion: typeof FOUNDATION_PROTOCOL_PLAN_V1; readonly submissionId: string; readonly requestDigest: Hex;
  readonly sourceCommit: string; readonly factoryComponentId: string; readonly hookDeployerComponentId: string;
  readonly factoryImmutableBindings: readonly { readonly id: string; readonly field: Field }[];
}
export interface FoundationProtocolContractV1 {
  readonly componentId: string; readonly sourcePath: string; readonly contractName: string; readonly abi: readonly unknown[];
  readonly creationBytecode: Hex; readonly creationCodeHash: Hex; readonly runtimeTemplate: Hex; readonly runtimeTemplateHash: Hex;
  readonly immutableReferences: readonly { readonly id: string; readonly ranges: readonly { readonly start: number; readonly length: 32 }[] }[];
}
export interface FoundationProtocolTestResultV1 {
  readonly schemaVersion: "programmable.modules.foundation-protocol-test-results.v1"; readonly requestDigest: Hex; readonly planDigest: Hex;
  readonly harnessDigest: Hex; readonly execution: "isolated-docker-anvil";
  readonly checks: Readonly<Record<typeof FOUNDATION_PROTOCOL_CHECKS_V1[number], true>>; readonly allRequiredChecksPassed: true;
}
export interface FoundationProtocolBuildV1 {
  readonly schemaVersion: typeof FOUNDATION_PROTOCOL_BUILD_V1; readonly authority: "programmable.module-review.foundation-protocol-build.v1";
  readonly subject: ReviewSubject; readonly packageId: Hex; readonly familyId: Hex; readonly rewardWallet: string;
  readonly sourceCommit: string; readonly sourceManifestHash: Hex; readonly planDigest: Hex;
  readonly hostAdapterId: typeof FOUNDATION_HOST_V1; readonly platformBps: 30; readonly platformRecipient: "0xd88539d3c4c460136a733a3fd60cf6bf269079da";
  readonly compiler: { readonly version: string; readonly binarySha256: string; readonly imageDigest: string; readonly settingsHash: Hex; readonly completeInputHash: Hex; readonly reproducible: true };
  readonly factory: FoundationProtocolContractV1; readonly hookDeployer: FoundationProtocolContractV1;
  readonly factoryImmutableBindings: FoundationProtocolPlanV1["factoryImmutableBindings"];
  readonly tests: FoundationProtocolTestResultV1; readonly reviewRequired: readonly string[];
  readonly approved: false; readonly registryApproved: false; readonly available: false; readonly artifactDigest: Hex;
}
export const FOUNDATION_PROTOCOL_PLAN_V2 = "programmable.modules.foundation-protocol-build-plan.v2" as const;
export const FOUNDATION_PROTOCOL_BUILD_V2 = "programmable.modules.foundation-protocol-build.v2" as const;
export const FOUNDATION_PROTOCOL_EXTENSION_V2 = "programmable.module-foundation.protocol@2" as const;
export const FOUNDATION_LP_CUSTODY_ID_V2 = keccak256(toHex("programmable.module-foundation.launch-nfts.dead.v1"));
export const FOUNDATION_PROTOCOL_CHECKS_V2 = Object.freeze([
  "officialInfrastructure", "bothTokenOrders", "zeroCreatorQuoteLaunch", "metadataSupplyAndPoolIdentity",
  "initialBuyAtomicity", "directDeadPositionCustody", "universalRouterFourForms",
  "quoteFeeAccounting30Bps", "fixedPlatformRecipientPayout", "settlementAndAllowances", "roundingInventoryToDead", "receiptRegistryAndRefundBinding",
] as const);
export const FOUNDATION_PROTOCOL_REVIEW_AREAS_V2 = Object.freeze([
  "foundation-standard-token-fixed-supply-no-transfer-tax", "foundation-immutable-30bps-platform-quote-fee",
  "foundation-poolmanager-account-and-currency-deltas", "foundation-official-router-empty-hookdata-four-forms",
  "foundation-one-sided-price-direct-dead-nft-custody-and-no-vault", "foundation-immutable-host-module-capabilities",
  "foundation-reentrancy-partialfill-and-quote-transfer-adversaries", "foundation-source-runtime-and-deployment-binding", "foundation-dead-rounding-inventory-and-quote-refund-conservation",
] as const);
// V2 preserves the host ABI, immutable fields and compiler profile. Its digest domains remain distinct.
export const FOUNDATION_PROTOCOL_FIELDS_V2 = FOUNDATION_PROTOCOL_FIELDS_V1;
export interface FoundationProtocolPlanV2 extends Omit<FoundationProtocolPlanV1, "schemaVersion"> {
  readonly schemaVersion: typeof FOUNDATION_PROTOCOL_PLAN_V2;
}
export type FoundationProtocolContractV2 = FoundationProtocolContractV1;
export interface FoundationProtocolTestResultV2 extends Omit<FoundationProtocolTestResultV1, "schemaVersion" | "checks"> {
  readonly schemaVersion: "programmable.modules.foundation-protocol-test-results.v2";
  readonly checks: Readonly<Record<typeof FOUNDATION_PROTOCOL_CHECKS_V2[number], true>>;
}
export interface FoundationProtocolBuildV2 extends Omit<FoundationProtocolBuildV1, "schemaVersion" | "authority" | "tests"> {
  readonly schemaVersion: typeof FOUNDATION_PROTOCOL_BUILD_V2;
  readonly authority: "programmable.module-review.foundation-protocol-build.v2";
  readonly factoryVersion: "v2"; readonly lpCustodyId: Hex;
  readonly tests: FoundationProtocolTestResultV2;
}
export const FOUNDATION_SETTINGS_V1 = Object.freeze({ optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true, metadata: { bytecodeHash: "none", appendCBOR: false } });
export const FOUNDATION_REVIEW_AREAS_V1 = Object.freeze([
  "complete-configuration-and-action-domain", "host-only-callbacks-and-bound-context",
  "declared-phases-gas-and-failure-policy", "own-quote-budget-and-external-asset-behavior",
  "fresh-non-upgradeable-instance-and-factory", "affected-resource-and-order-interactions",
]);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const exact = reviewRecord, object = reviewRecord, foundationJsonV1 = nativeCanonicalJson, json = nativeCanonicalJson;
const need: typeof requireValue = requireValue;
function hex(value: unknown, min = 0, max = 16_384): asserts value is `0x${string}` { need(typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/u.test(value) && value.length >= 2 + min * 2 && value.length <= 2 + max * 2, "BYTES_INVALID"); }
function assertions(value: unknown) { need(Array.isArray(value) && value.length <= 16, "ASSERTIONS_INVALID"); for (const v of value) { const r = exact(v, ["callData", "expectedData"]); hex(r.callData, 4); hex(r.expectedData); } }
export function validateFoundationDescriptorV1(value: unknown): FoundationDescriptorV1 {
  const d = exact(value, ["moduleId", "abiVersion", "phases", "resources", "beforeGas", "afterGas", "actionGas", "failOpenAfter", "exclusiveGroup"]);
  need(typeof d.moduleId === "string" && HASH.test(d.moduleId) && d.abiVersion === 1 && Number.isInteger(d.phases) && Number(d.phases) >= 1 && Number(d.phases) <= 7
    && Number.isInteger(d.resources) && Number(d.resources) >= 0 && Number(d.resources) <= 1 && typeof d.failOpenAfter === "boolean", "DESCRIPTOR_INVALID");
  hex(d.exclusiveGroup, 32, 32);
  for (const [key, bit, max] of [["beforeGas", 1, 300_000], ["afterGas", 2, 300_000], ["actionGas", 4, 2_000_000]] as const)
    need(Number.isInteger(d[key]) && ((Number(d.phases) & bit) !== 0 ? Number(d[key]) >= 10_000 && Number(d[key]) <= max : d[key] === 0), "DESCRIPTOR_GAS_INVALID");
  need((Number(d.phases) & 2) !== 0 || !d.failOpenAfter, "DESCRIPTOR_FAILURE_POLICY_INVALID");
  need((Number(d.phases) & 4) !== 0 || d.resources === 0, "DESCRIPTOR_RESOURCE_INVALID");
  return d as unknown as FoundationDescriptorV1;
}
export const hashFoundationDescriptorV1 = (d: FoundationDescriptorV1) => keccak256(encodeAbiParameters(FOUNDATION_DESCRIPTOR_ABI_V1, [validateFoundationDescriptorV1(d)]));
export function validateFoundationBuildPlanV1(value: unknown, subject: ReviewSubject): FoundationBuildPlanV1 {
  exact(subject, ["submissionId", "principalId", "author", "requestDigest"]);
  need(UUID.test(subject.submissionId) && UUID.test(subject.principalId) && ADDRESS.test(subject.author) && HASH.test(subject.requestDigest), "SUBJECT_INVALID");
  const p = exact(value, ["schemaVersion", "submissionId", "requestDigest", "moduleComponentId", "factoryComponentId", "hostAdapterId", "descriptorHash", "configurationCodec", "configurationAbi", "cases"]);
  need(p.schemaVersion === FOUNDATION_PLAN_SCHEMA_V1 && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest, "SUBJECT_MISMATCH");
  need(p.hostAdapterId === FOUNDATION_HOST_V1 && p.configurationCodec === FOUNDATION_CODEC_V1 && typeof p.descriptorHash === "string" && HASH.test(p.descriptorHash), "ADAPTER_UNSUPPORTED");
  need(typeof p.moduleComponentId === "string" && ID.test(p.moduleComponentId) && typeof p.factoryComponentId === "string" && ID.test(p.factoryComponentId) && p.moduleComponentId !== p.factoryComponentId, "TARGET_INVALID");
  parseModuleEngineConfigurationAbi(p.configurationAbi);
  need(Array.isArray(p.cases) && p.cases.length > 0 && p.cases.length <= 16, "CASES_INVALID");
  const ids = new Set<string>(); let positive = false;
  for (const raw of p.cases) {
    const c = exact(raw, ["id", "parameters", "budgetQuote", "expectedDeployment", "swaps", "actions", ...(Object.hasOwn(object(raw), "rawConfigBytes") ? ["rawConfigBytes"] : [])]);
    need(typeof c.id === "string" && ID.test(c.id) && !ids.has(c.id), "CASE_ID_INVALID"); ids.add(c.id);
    need(typeof c.budgetQuote === "string" && /^(0|[1-9][0-9]{0,24})$/u.test(c.budgetQuote) && BigInt(c.budgetQuote) <= 10n ** 24n, "BUDGET_INVALID");
    need(c.expectedDeployment === "success" || c.expectedDeployment === "revert", "CASE_OUTCOME_INVALID");
    if (Object.hasOwn(c, "rawConfigBytes")) { need(c.expectedDeployment === "revert", "NEGATIVE_CONFIG_INVALID"); hex(c.rawConfigBytes); }
    need(Array.isArray(c.swaps) && c.swaps.length <= 4 && Array.isArray(c.actions) && c.actions.length <= 16, "VECTORS_INVALID");
    need(c.expectedDeployment === "success" || c.swaps.length + c.actions.length === 0, "NEGATIVE_VECTOR_INVALID");
    const quadrants = new Set<string>();
    for (const rawSwap of c.swaps) {
      const s = exact(rawSwap, ["buy", "exactInput", "beforeOutcome", "afterOutcome", "assertions"]);
      need(typeof s.buy === "boolean" && typeof s.exactInput === "boolean", "SWAP_INVALID");
      const key = `${s.buy}:${s.exactInput}`; need(!quadrants.has(key), "SWAP_DUPLICATE"); quadrants.add(key);
      need(["success", "revert", "absent"].includes(String(s.beforeOutcome)) && ["success", "revert", "absent"].includes(String(s.afterOutcome)), "SWAP_OUTCOME_INVALID"); assertions(s.assertions);
    }
    for (const rawAction of c.actions) {
      const a = exact(rawAction, ["id", "actor", "parameters", "expectedOutcome", "assertions"]);
      need(typeof a.id === "string" && ID.test(a.id) && ["creator", "user"].includes(String(a.actor)) && ["success", "revert"].includes(String(a.expectedOutcome)), "ACTION_INVALID"); assertions(a.assertions);
    }
    positive ||= c.expectedDeployment === "success";
  }
  need(positive && new TextEncoder().encode(foundationJsonV1(value)).length <= 256 * 1024, "PLAN_CAPACITY");
  return JSON.parse(foundationJsonV1(value)) as FoundationBuildPlanV1;
}
export function validateFoundationProtocolPlanV1(value: unknown, subject: ReviewSubject): FoundationProtocolPlanV1 {
  exact(subject, ["submissionId", "principalId", "author", "requestDigest"]);
  need(UUID.test(subject.submissionId) && UUID.test(subject.principalId) && /^0x(?!0{40}$)[0-9a-f]{40}$/u.test(subject.author) && HASH.test(subject.requestDigest), "PROTOCOL_SUBJECT_INVALID");
  const p = exact(value, ["schemaVersion", "submissionId", "requestDigest", "sourceCommit", "factoryComponentId", "hookDeployerComponentId", "factoryImmutableBindings"]);
  need(p.schemaVersion === FOUNDATION_PROTOCOL_PLAN_V1 && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest
    && typeof p.sourceCommit === "string" && /^(?!0{40}$)[0-9a-f]{40}$/u.test(p.sourceCommit), "PROTOCOL_SOURCE_INVALID");
  for (const field of ["factoryComponentId", "hookDeployerComponentId"]) need(typeof p[field] === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(p[field]), "PROTOCOL_TARGET_INVALID");
  need(p.factoryComponentId !== p.hookDeployerComponentId && Array.isArray(p.factoryImmutableBindings) && p.factoryImmutableBindings.length === FOUNDATION_PROTOCOL_FIELDS_V1.length, "PROTOCOL_IMMUTABLES_INVALID");
  const ids = new Set<string>(), fields = new Set<string>();
  for (const raw of p.factoryImmutableBindings) {
    const b = exact(raw, ["id", "field"]);
    need(typeof b.id === "string" && /^(0|[1-9][0-9]{0,9})$/u.test(b.id) && !ids.has(b.id)
      && typeof b.field === "string" && FOUNDATION_PROTOCOL_FIELDS_V1.includes(b.field as Field) && !fields.has(b.field), "PROTOCOL_IMMUTABLES_INVALID");
    ids.add(b.id); fields.add(b.field);
  }
  return JSON.parse(json(value)) as FoundationProtocolPlanV1;
}
export function validateFoundationProtocolPlanV2(value: unknown, subject: ReviewSubject): FoundationProtocolPlanV2 {
  exact(subject, ["submissionId", "principalId", "author", "requestDigest"]);
  need(UUID.test(subject.submissionId) && UUID.test(subject.principalId) && ADDRESS.test(subject.author) && HASH.test(subject.requestDigest), "PROTOCOL_SUBJECT_INVALID");
  const p = exact(value, ["schemaVersion", "submissionId", "requestDigest", "sourceCommit", "factoryComponentId", "hookDeployerComponentId", "factoryImmutableBindings"]);
  need(p.schemaVersion === FOUNDATION_PROTOCOL_PLAN_V2 && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest
    && typeof p.sourceCommit === "string" && /^(?!0{40}$)[0-9a-f]{40}$/u.test(p.sourceCommit), "PROTOCOL_SOURCE_INVALID");
  for (const field of ["factoryComponentId", "hookDeployerComponentId"]) need(typeof p[field] === "string" && ID.test(p[field]), "PROTOCOL_TARGET_INVALID");
  need(p.factoryComponentId !== p.hookDeployerComponentId && Array.isArray(p.factoryImmutableBindings) && p.factoryImmutableBindings.length === FOUNDATION_PROTOCOL_FIELDS_V2.length, "PROTOCOL_IMMUTABLES_INVALID");
  const ids = new Set<string>(), fields = new Set<string>();
  for (const raw of p.factoryImmutableBindings) {
    const b = exact(raw, ["id", "field"]);
    need(typeof b.id === "string" && /^(0|[1-9][0-9]{0,9})$/u.test(b.id) && !ids.has(b.id)
      && typeof b.field === "string" && FOUNDATION_PROTOCOL_FIELDS_V2.includes(b.field as Field) && !fields.has(b.field), "PROTOCOL_IMMUTABLES_INVALID");
    ids.add(b.id); fields.add(b.field);
  }
  return JSON.parse(json(value)) as FoundationProtocolPlanV2;
}

const MODULE_ABI = parseAbi([
  "function context() view returns((address host,address token,address quote,address creator,address ledger,bytes32 poolId))",
  "function configurationHash() view returns(bytes32)",
  "function descriptor() view returns((bytes32 moduleId,uint16 abiVersion,uint8 phases,uint8 resources,uint32 beforeGas,uint32 afterGas,uint32 actionGas,bool failOpenAfter,bytes32 exclusiveGroup))",
  "function onBeforeSwap((bytes32 poolId,address router,bool buy,bool exactInput,uint256 specifiedAmount,uint256 grossQuote,int128 coreAmount0,int128 coreAmount1)) returns(bytes4)",
  "function onAfterSwap((bytes32 poolId,address router,bool buy,bool exactInput,uint256 specifiedAmount,uint256 grossQuote,int128 coreAmount0,int128 coreAmount1)) returns(bytes4)",
  "function onAction(address actor,bytes data) returns(bytes4)",
]);
const FACTORY_ABI = parseAbi(["function createModule((address host,address token,address quote,address creator,address ledger,bytes32 poolId),bytes) returns(address)"]);
function foundationModuleContractArtifact(raw: unknown, target: { id: string; sourcePath: string; entrypoint: string }, factory: boolean): ReviewContractArtifact {
  const r = object(raw), abi = r.abi; need(Array.isArray(abi) && abi.length <= 256, "ABI_INVALID");
  const evm = object(r.evm), deployed = object(evm.deployedBytecode), creation = object(evm.bytecode);
  need(deployed.immutableReferences === undefined || Object.keys(object(deployed.immutableReferences)).length === 0, "UNIFORM_RUNTIME_REQUIRED");
  const runtimeBytecode = `0x${String(deployed.object)}` as const, creationBytecode = `0x${String(creation.object)}` as const;
  hex(runtimeBytecode, 1, 24_576); hex(creationBytecode, 1, 49_152);
  const functions = abi.filter(a => object(a).type === "function");
  const types = (value: unknown): unknown => { need(Array.isArray(value), "ABI_INVALID"); return value.map(v => { const p = object(v); return { type: p.type, ...(p.components ? { components: types(p.components) } : {}) }; }); };
  for (const item of factory ? FACTORY_ABI : MODULE_ABI) {
    const actual = functions.find(f => toFunctionSelector(f) === toFunctionSelector(item));
    need(actual && foundationJsonV1(types(object(actual).outputs)) === foundationJsonV1(types(item.outputs)), "INTERFACE_MISMATCH");
  }
  if (factory) { const constructor = abi.find(a => object(a).type === "constructor"); need(!constructor || Array.isArray(constructor.inputs) && constructor.inputs.length === 0, "FACTORY_CONSTRUCTOR_UNSUPPORTED"); }
  return { componentId: target.id, sourcePath: target.sourcePath, contractName: target.entrypoint, abi,
    abiHash: reviewDigest("programmable.modules.abi.v1", abi), creationBytecode, creationCodeHash: keccak256(creationBytecode),
    runtimeBytecode, runtimeCodeHash: keccak256(runtimeBytecode), externalSelectors: functions.map(f => toFunctionSelector(f)).sort() };
}
function validateResults(result: FoundationTestResultV1, requestDigest: Hex, planDigest: Hex, cases: readonly FoundationCompiledCaseV1[]) {
  exact(result, ["schemaVersion", "requestDigest", "planDigest", "harnessDigest", "execution", "cases", "allRequiredChecksPassed"]);
  need(result.schemaVersion === "programmable.modules.foundation-test-results.v1" && result.requestDigest === requestDigest && result.planDigest === planDigest && HASH.test(result.harnessDigest)
    && result.execution === "isolated-docker-anvil" && result.allRequiredChecksPassed === true && Array.isArray(result.cases) && result.cases.length === cases.length, "TEST_BINDING_INVALID");
  result.cases.forEach((r, i) => {
    exact(r, ["id", "configHash", "deploymentMatched", "codeHashMatched", "contextMatched", "descriptorMatched", "configurationMatched", "freshInstances", "unauthorizedCallbacksReverted", "boundedCallbacks", "ownQuoteBudgetConserved", "swapOutcomes", "actionOutcomes", "stateAssertions"]);
    const c = cases[i]!, expected = c.expectedDeployment === "success" ? true : null;
    need(r.id === c.id && r.configHash === c.configHash && r.deploymentMatched === true && [r.codeHashMatched, r.contextMatched, r.descriptorMatched, r.configurationMatched, r.freshInstances, r.unauthorizedCallbacksReverted, r.boundedCallbacks, r.ownQuoteBudgetConserved, r.stateAssertions].every(v => v === expected), "TEST_CASE_FAILED");
    need(Array.isArray(r.swapOutcomes) && r.swapOutcomes.length === c.swaps.length && r.swapOutcomes.every((v: unknown) => v === true)
      && Array.isArray(r.actionOutcomes) && r.actionOutcomes.length === c.actions.length && r.actionOutcomes.every((v: unknown) => v === true), "TEST_VECTOR_FAILED");
  });
}
function foundationProtocolContractArtifact(value: unknown, target: { id: string; sourcePath: string; entrypoint: string }, bindings: AnyFoundationProtocolPlan["factoryImmutableBindings"]): FoundationProtocolContractV1 | FoundationProtocolContractV2 {
  const r = object(value), evm = object(r.evm), bytecode = object(evm.bytecode), deployed = object(evm.deployedBytecode);
  const creationBytecode = `0x${String(bytecode.object)}` as Hex, runtimeTemplate = `0x${String(deployed.object)}` as Hex;
  need(Array.isArray(r.abi) && r.abi.length <= 256 && /^0x(?:[0-9a-f]{2})+$/u.test(creationBytecode) && creationBytecode.length <= 2 + 49_152 * 2
    && /^0x(?:[0-9a-f]{2})+$/u.test(runtimeTemplate) && runtimeTemplate.length <= 2 + 24_576 * 2, "PROTOCOL_BYTECODE_INVALID");
  const references = object(deployed.immutableReferences ?? {});
  need(Object.keys(references).sort().join() === bindings.map(b => b.id).sort().join(), "PROTOCOL_IMMUTABLES_MISMATCH");
  const occupied = new Set<number>();
  const immutableReferences = Object.entries(references).sort(([a], [b]) => a.localeCompare(b)).map(([id, raw]) => {
    need(Array.isArray(raw) && raw.length > 0 && raw.length <= 256, "PROTOCOL_IMMUTABLES_INVALID");
    const ranges = raw.map(value => { const p = exact(value, ["start", "length"]); need(Number.isSafeInteger(p.start) && Number(p.start) >= 0 && p.length === 32 && (Number(p.start) + 32) * 2 <= runtimeTemplate.length - 2, "PROTOCOL_IMMUTABLES_INVALID");
      for (let i = Number(p.start); i < Number(p.start) + 32; i++) { need(!occupied.has(i), "PROTOCOL_IMMUTABLES_OVERLAP"); occupied.add(i); }
      need(runtimeTemplate.slice(2 + Number(p.start) * 2, 2 + (Number(p.start) + 32) * 2) === "0".repeat(64), "PROTOCOL_IMMUTABLES_TEMPLATE_INVALID"); return { start: Number(p.start), length: 32 as const }; });
    return { id, ranges };
  });
  return { componentId: target.id, sourcePath: target.sourcePath, contractName: target.entrypoint, abi: r.abi, creationBytecode, creationCodeHash: keccak256(creationBytecode), runtimeTemplate, runtimeTemplateHash: keccak256(runtimeTemplate), immutableReferences };
}
