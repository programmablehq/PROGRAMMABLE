import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  validateRetainedWebsiteProjectionPlan,
  WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF,
  WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
  WEBSITE_PROJECTION_MIGRATION_FILES,
  WEBSITE_PROJECTION_MIGRATION_ROOT,
} from "./website-projection-db-operator-core.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_SHA256 = /^0x[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,77}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ARTIFACT_PATH = /^(?!\/)(?!.*\/\/)[A-Za-z0-9_.\[\]/-]+$/u;

const IMPLEMENTATION_ARTIFACTS = Object.freeze([
  "app/api/ops/custom-launch/generic-v2-projector/route.ts",
  "app/v2/internal/projections/approval-descriptors/[projectionKey]/route.ts",
  "lib/server/custom-launch/generic-launch-contract-v2.ts",
  "lib/server/custom-launch/generic-launch-production-v2.ts",
  "lib/server/custom-launch/generic-launch-projector-v2.ts",
  "lib/server/custom-launch/generic-launch-registry-reader-v2.ts",
  "lib/server/projection-target/approval-v3-target.ts",
]);
const PERSISTENCE_ARTIFACTS = Object.freeze([
  "lib/server/custom-launch/generic-launch-postgres-v2.ts",
  ...WEBSITE_PROJECTION_MIGRATION_FILES.slice(
    0,
    WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
  ).map(
    (file) => `${WEBSITE_PROJECTION_MIGRATION_ROOT}/${file}`,
  ),
]);
const QUERY_ARTIFACTS = Object.freeze([
  "app/api/custom-launch/generic/v2/launches/[recordHash]/route.ts",
  "app/api/custom-launch/generic/v2/launches/route.ts",
  "app/api/custom-launch/generic/v2/readiness/route.ts",
  "app/api/ops/custom-launch/generic-v2-signer-probe/route.ts",
  "config/generic-launch-public.v2.schema.json",
  "lib/server/custom-launch/generic-launch-read-production-probe-v1.ts",
  "lib/server/custom-launch/generic-launch-read-signer-v2.ts",
  "lib/server/custom-launch/generic-launch-read-v2.ts",
]);
const REGISTRY_PROJECTION_ARTIFACTS = Object.freeze([
  "config/custom-registry-v2.deployment.prelaunch.json",
  "lib/server/custom-launch/generic-launch-contract-v2.ts",
  "lib/server/custom-launch/generic-launch-projector-v2.ts",
  "lib/server/custom-launch/generic-launch-registry-reader-v2.ts",
]);
const WEBSITE_REPOSITORY_IDENTITY = Object.freeze({
  repositoryId: "1314365508",
  repositoryFullName: "0xprogrammable/programmable",
});
const APPROVAL_REPOSITORY_IDENTITY = Object.freeze({
  repositoryId: "1318883798",
  repositoryFullName: "0xprogrammable/programmable-open-hook-v2-internal",
});
const HOSTED_PERSISTENCE_EVIDENCE_IDENTITY = Object.freeze({
  planArtifactSha256:
    "sha256:4bea658e36b40af2d4d6ee7e71039d302704e6ddc2f4ca8f4190a17c2ad50d57",
  adoptionArtifactSha256:
    "sha256:a38c37cf5b1dfe8526387c31d378c87bfd5f88bd4408ae91e56a549900622271",
  applyArtifactSha256:
    "sha256:954430a402a9b8de8352f915a97ae67de88cff513af9f0ee1d8a64238181930a",
  verifyArtifactSha256:
    "sha256:cb72cceff9376584c382b948be2229d74e591873dfe63852c59adcc3c1412f10",
  planRepositoryCommit: "c235fbd55259f76d8356d6f07073c48b00eb294d",
  planRepositoryTree: "57d09edb4793d6fe9f8a3bfad8e311accbb4caec",
  planSha256:
    "0xbcdb49c686413cd5eab15514e0182eb929f5771e58059ce0fe59f928c44e6f3f",
  orderSha256:
    "0xce50954bfa6ff3b66b849bb5b53e8f1adf93abbe12cf865c19375100f2571cc2",
  finalCatalogSha256:
    "0x92a17ae38c7562cea0609bc8a8263ff190486a389b886072fb9ef30f0cffc0c4",
});
const CURRENT_HOSTED_PERSISTENCE_EVIDENCE_IDENTITY = Object.freeze({
  planArtifactSha256:
    "sha256:4bea658e36b40af2d4d6ee7e71039d302704e6ddc2f4ca8f4190a17c2ad50d57",
  rotationReceiptArtifactSha256:
    "sha256:25991a95896673cbcffc60aefab8353a9562ef132e63bf2fb343f9b61411b163",
  planRepositoryCommit: "c235fbd55259f76d8356d6f07073c48b00eb294d",
  planRepositoryTree: "57d09edb4793d6fe9f8a3bfad8e311accbb4caec",
  planSha256:
    "0xbcdb49c686413cd5eab15514e0182eb929f5771e58059ce0fe59f928c44e6f3f",
  orderSha256:
    "0xce50954bfa6ff3b66b849bb5b53e8f1adf93abbe12cf865c19375100f2571cc2",
  finalCatalogSha256:
    "0x92a17ae38c7562cea0609bc8a8263ff190486a389b886072fb9ef30f0cffc0c4",
  operatorCatalogSha256:
    "0xf8127e64734fd233765f8d41fedde1d4b0e5af5035eef599bdb144764bd63baa",
  rotationSourceCommit: "fec98782757aa9b87760c9a5743c3f016208f0ab",
  rotationSourceTree: "0337d7a5bdda046cc4fa879283fd269068caa538",
  rotationSourceParent: "6895dcf863e8406d283aec700c705a37ff76a8a3",
});

const INPUT_KEYS = Object.freeze([
  "approvalArtifactSchema",
  "approvalRelease",
  "implementation",
  "persistence",
  "queryContract",
  "registryProjection",
  "schemaVersion",
  "websiteSource",
]);

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach(assertWellFormedUnicode);
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  throw new TypeError("Canonical JSON contains an unsupported value");
}

export function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalSha256(domain, value) {
  if (!/^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/u.test(domain)) {
    throw new TypeError("Hash domain must be a versioned Programmable namespace");
  }
  return sha256Bytes(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0),
    Buffer.from(canonicalJson(value), "utf8"),
  ]));
}

export async function deriveGenericLaunchReadModelContractV2(input, options) {
  const repoRoot = resolve(options?.repoRoot ?? process.cwd());
  const read = options?.readFile ?? readFile;
  const gitBlobIdentity = options?.gitBlobIdentity ?? currentGitBlobIdentity;
  const hostedEvidenceIdentity = options?.hostedEvidenceIdentity
    ?? HOSTED_PERSISTENCE_EVIDENCE_IDENTITY;
  const currentHostedEvidenceIdentity = options?.currentHostedEvidenceIdentity
    ?? CURRENT_HOSTED_PERSISTENCE_EVIDENCE_IDENTITY;
  const value = exactObject(input, INPUT_KEYS, "derivation input");
  if (value.schemaVersion
    !== "programmable.generic-launch-read-model-contract-derivation-input.v1") {
    throw new TypeError("Generic launch read-model derivation input is invalid");
  }

  const websiteSource = sourceIdentity(value.websiteSource, "Website source");
  if (websiteSource.repositoryId !== WEBSITE_REPOSITORY_IDENTITY.repositoryId
    || websiteSource.repositoryFullName
      !== WEBSITE_REPOSITORY_IDENTITY.repositoryFullName) {
    throw new TypeError("Website source is not the canonical repository");
  }
  if (options?.gitIdentity) {
    const actual = options.gitIdentity(repoRoot);
    if (actual.commit !== websiteSource.commit || actual.tree !== websiteSource.tree) {
      throw new TypeError("Website source identity does not match the checkout");
    }
  }

  const implementation = await localArtifactComponent(
    value.implementation,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
    "implementation",
  );
  const persistence = await persistenceComponent(
    value.persistence,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
    hostedEvidenceIdentity,
    currentHostedEvidenceIdentity,
  );
  const queryContract = await queryComponent(
    value.queryContract,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
  );
  const approvalArtifactSchema = approvalSchemaComponent(value.approvalArtifactSchema);
  const approvalRelease = approvalReleaseComponent(
    value.approvalRelease,
    approvalArtifactSchema.source,
  );
  const registryProjection = await registryComponent(
    value.registryProjection,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
  );

  const componentBindingHashes = Object.freeze({
    implementationBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-implementation-binding.v1",
      implementation,
    ),
    persistenceBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-persistence-binding.v1",
      persistence,
    ),
    queryContractBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-query-contract-binding.v1",
      queryContract,
    ),
    approvalArtifactSchemaBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-approval-schema-binding.v1",
      approvalArtifactSchema,
    ),
    approvalReleaseBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-approval-release-binding.v1",
      approvalRelease,
    ),
    registryProjectionBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-registry-projection-binding.v1",
      registryProjection,
    ),
  });
  const contract = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract.v2",
    sourceLane: "generic.finalized-launch-v2",
    ...componentBindingHashes,
  });
  const readModelBindingHash = canonicalSha256(contract.schemaVersion, contract);
  const core = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-model-contract-derivation.v1",
    websiteSource,
    components: Object.freeze({
      implementation,
      persistence,
      queryContract,
      approvalArtifactSchema,
      approvalRelease,
      registryProjection,
    }),
    componentBindingHashes,
    contract,
    readModelBindingHash,
  });
  return Object.freeze({
    ...core,
    derivationHash: canonicalSha256(core.schemaVersion, core),
  });
}

async function localArtifactComponent(
  raw,
  websiteSource,
  repoRoot,
  read,
  gitBlobIdentity,
  label,
) {
  const value = exactObject(raw, ["artifacts"], `${label} component`);
  const artifacts = await localArtifacts(
    value.artifacts,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
    label,
  );
  assertExactArtifactInventory(
    artifacts,
    label === "implementation" ? IMPLEMENTATION_ARTIFACTS : [],
    label,
  );
  return Object.freeze({
    source: websiteSource,
    artifacts,
  });
}

async function persistenceComponent(
  raw,
  websiteSource,
  repoRoot,
  read,
  gitBlobIdentity,
  hostedEvidenceIdentity,
  currentHostedEvidenceIdentity,
) {
  const value = exactObject(raw, ["artifacts", "hostedEvidence"],
    "persistence component");
  const artifacts = await localArtifacts(
    value.artifacts,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
    "persistence",
  );
  const evidence = await hostedPersistenceEvidence(
    value.hostedEvidence,
    hostedEvidenceIdentity,
    currentHostedEvidenceIdentity,
  );
  assertExactArtifactInventory(artifacts, PERSISTENCE_ARTIFACTS, "persistence");
  for (const migration of evidence.plan.migrations) {
    const artifact = artifacts.find(({ path }) => path === migration.file);
    if (!artifact
      || artifact.sha256 !== `sha256:${migration.fileSha256.slice(2)}`) {
      throw new TypeError(
        `Hosted migration evidence is not bound to ${migration.file}`,
      );
    }
  }
  return Object.freeze({
    source: websiteSource,
    artifacts,
    hostedEvidence: evidence,
  });
}

async function queryComponent(
  raw,
  websiteSource,
  repoRoot,
  read,
  gitBlobIdentity,
) {
  const value = exactObject(raw, [
    "artifacts", "detailPathTemplate", "feedPath", "readinessPath",
  ], "query contract component");
  if (value.feedPath !== "/api/custom-launch/generic/v2/launches"
    || value.detailPathTemplate
      !== "/api/custom-launch/generic/v2/launches/{recordHash}"
    || value.readinessPath !== "/api/custom-launch/generic/v2/readiness") {
    throw new TypeError("Generic launch V2 query paths are invalid");
  }
  return Object.freeze({
    source: websiteSource,
    artifacts: assertExactArtifactInventory(await localArtifacts(
      value.artifacts,
      websiteSource,
      repoRoot,
      read,
      gitBlobIdentity,
      "query contract",
    ), QUERY_ARTIFACTS, "query contract"),
    feedPath: value.feedPath,
    detailPathTemplate: value.detailPathTemplate,
    readinessPath: value.readinessPath,
  });
}

function approvalSchemaComponent(raw) {
  const value = exactObject(raw, [
    "artifact", "audience", "domain", "handoffEvidenceSha256",
    "schemaVersion", "source", "status",
  ], "Approval artifact schema component");
  const source = sourceIdentity(value.source, "Approval schema source");
  if (value.status !== "frozen"
    || value.schemaVersion
      !== "programmable.approval-registry-v2-descriptor-binding.v2"
    || value.domain !== "programmable.approval-registry-descriptor-binding.v3"
    || value.audience !== "programmable.custom-registry.v2"
    || source.repositoryId !== APPROVAL_REPOSITORY_IDENTITY.repositoryId
    || source.repositoryFullName
      !== APPROVAL_REPOSITORY_IDENTITY.repositoryFullName
    || value.artifact?.path
      !== "services/autonomous-approval-v1/schemas/approval-registry-v2-descriptor-binding-v2.schema.json") {
    throw new TypeError("Approval artifact schema is not frozen for Registry V2");
  }
  return Object.freeze({
    status: "frozen",
    source,
    schemaVersion: value.schemaVersion,
    domain: value.domain,
    audience: value.audience,
    artifact: externalArtifact(value.artifact, "Approval schema artifact"),
    handoffEvidenceSha256: digest(
      value.handoffEvidenceSha256,
      "Approval schema handoff evidence",
    ),
  });
}

function approvalReleaseComponent(raw, schemaSource) {
  const value = exactObject(raw, [
    "aggregateReadinessBindingHash",
    "artifactVerifierBindingHash",
    "liveDeploymentEvidenceSha256",
    "packageArtifactSha256",
    "source",
    "status",
  ], "Approval release component");
  const source = sourceIdentity(value.source, "Approval release source");
  if (value.status !== "live"
    || source.repositoryId !== schemaSource.repositoryId
    || source.repositoryFullName !== schemaSource.repositoryFullName) {
    throw new TypeError("Approval release is not a live release of the frozen schema");
  }
  return Object.freeze({
    status: "live",
    source,
    packageArtifactSha256: digest(
      value.packageArtifactSha256,
      "Approval package artifact",
    ),
    aggregateReadinessBindingHash: digest(
      value.aggregateReadinessBindingHash,
      "Approval aggregate readiness binding",
    ),
    artifactVerifierBindingHash: digest(
      value.artifactVerifierBindingHash,
      "Approval artifact verifier binding",
    ),
    liveDeploymentEvidenceSha256: digest(
      value.liveDeploymentEvidenceSha256,
      "Approval live deployment evidence",
    ),
  });
}

async function registryComponent(
  raw,
  websiteSource,
  repoRoot,
  read,
  gitBlobIdentity,
) {
  const value = exactObject(raw, [
    "abiArtifactSha256", "artifacts", "deploymentArtifactSha256",
    "eventSetSha256", "liveVerificationEvidenceSha256",
    "minimumFinalityBlocks", "registryAddress", "registryPolicyCommitment",
    "registryRuntimeCodeKeccak256", "source", "sourceArtifactSha256",
    "sourceVerificationEvidenceSha256", "status",
  ], "Registry projection component");
  if (value.status !== "live") {
    throw new TypeError("Registry projection is not live");
  }
  const artifacts = await localArtifacts(
    value.artifacts,
    websiteSource,
    repoRoot,
    read,
    gitBlobIdentity,
    "Registry projection",
  );
  assertExactArtifactInventory(
    artifacts,
    REGISTRY_PROJECTION_ARTIFACTS,
    "Registry projection",
  );
  const deployment = artifacts.find(({ path }) =>
    path === "config/custom-registry-v2.deployment.prelaunch.json");
  if (!deployment
    || deployment.sha256 !== digest(
      value.deploymentArtifactSha256,
      "Registry deployment artifact",
    )) {
    throw new TypeError("Registry deployment artifact is not in the projection closure");
  }
  const registrySource = sourceIdentity(value.source, "Registry source");
  if (registrySource.repositoryId !== websiteSource.repositoryId
    || registrySource.repositoryFullName !== websiteSource.repositoryFullName) {
    throw new TypeError("Registry source is not the exact Website repository");
  }
  const registryAddress = address(value.registryAddress, "Registry address");
  const registryRuntimeCodeKeccak256 = hash32(
    value.registryRuntimeCodeKeccak256,
    "Registry runtime code hash",
  );
  const registryPolicyCommitment = hash32(
    value.registryPolicyCommitment,
    "Registry policy commitment",
  );
  const minimumFinalityBlocks = positiveDecimal(
    value.minimumFinalityBlocks,
    "Registry minimum finality blocks",
  );
  const sourceArtifactSha256 = digest(
    value.sourceArtifactSha256,
    "Registry source artifact",
  );
  const abiArtifactSha256 = digest(value.abiArtifactSha256, "Registry ABI artifact");
  const eventSetSha256 = digest(value.eventSetSha256, "Registry event set");
  const deploymentBytes = read === readFile
    ? await readRegularArtifact(resolve(repoRoot, deployment.path), "Registry deployment")
    : await read(resolve(repoRoot, deployment.path));
  if (sha256Bytes(deploymentBytes) !== deployment.sha256) {
    throw new TypeError("Registry deployment artifact changed during derivation");
  }
  assertRegistryDeploymentConfig(JSON.parse(deploymentBytes.toString("utf8")), {
    registrySource,
    registryAddress,
    registryRuntimeCodeKeccak256,
    registryPolicyCommitment,
    minimumFinalityBlocks,
    sourceArtifactSha256,
    abiArtifactSha256,
    eventSetSha256,
  });
  return Object.freeze({
    status: "live",
    websiteSource,
    registrySource,
    artifacts,
    deploymentArtifactSha256: deployment.sha256,
    sourceArtifactSha256,
    abiArtifactSha256,
    eventSetSha256,
    registryAddress,
    registryRuntimeCodeKeccak256,
    registryPolicyCommitment,
    minimumFinalityBlocks,
    liveVerificationEvidenceSha256: digest(
      value.liveVerificationEvidenceSha256,
      "Registry live verification evidence",
    ),
    sourceVerificationEvidenceSha256: digest(
      value.sourceVerificationEvidenceSha256,
      "Registry source verification evidence",
    ),
  });
}

function assertRegistryDeploymentConfig(raw, expected) {
  const value = exactObject(raw, [
    "caip2", "chainId", "finality", "generation", "indexingEnabled",
    "profiles", "publicReadEnabled", "registry", "release", "schemaVersion",
    "status",
  ], "Registry deployment config");
  const registry = exactObject(value.registry, [
    "address", "deploymentBlock", "deploymentBlockHash",
    "deploymentTransactionHash", "runtimeCodeKeccak256",
  ], "Registry deployment identity");
  const release = exactObject(value.release, [
    "abiArtifactSha256", "eventSetSha256", "sourceArtifactSha256",
    "sourceCommit", "sourceTree",
  ], "Registry deployment release");
  const finality = exactObject(value.finality, [
    "minimumConfirmations", "policyBindingHash",
  ], "Registry deployment finality");
  const profiles = exactObject(value.profiles, [
    "NoMarket0", "Standard10",
  ], "Registry deployment profiles");
  const noMarket = exactObject(profiles.NoMarket0, [
    "marketMode", "protocolFeeBps",
  ], "Registry NoMarket0 profile");
  const standard = exactObject(profiles.Standard10, [
    "marketMode", "protocolFeeBps",
  ], "Registry Standard10 profile");
  const deploymentTransactionHash = hash32(
    registry.deploymentTransactionHash,
    "Registry deployment transaction hash",
  );
  const deploymentBlock = positiveDecimal(
    registry.deploymentBlock,
    "Registry deployment block",
  );
  const deploymentBlockHash = hash32(
    registry.deploymentBlockHash,
    "Registry deployment block hash",
  );
  if (value.schemaVersion !== "programmable.custom-registry-v2-deployment.v1"
    || value.status !== "live" || value.generation !== "2"
    || value.chainId !== "1" || value.caip2 !== "eip155:1"
    || value.publicReadEnabled !== true || value.indexingEnabled !== true
    || noMarket.marketMode !== 0 || noMarket.protocolFeeBps !== 0
    || standard.marketMode !== 1 || standard.protocolFeeBps !== 10
    || /^0x0{64}$/u.test(deploymentTransactionHash)
    || deploymentBlock === "0"
    || /^0x0{64}$/u.test(deploymentBlockHash)
    || address(registry.address, "deployed Registry address")
      !== expected.registryAddress
    || registry.runtimeCodeKeccak256 !== expected.registryRuntimeCodeKeccak256
    || release.sourceCommit !== expected.registrySource.commit
    || release.sourceTree !== expected.registrySource.tree
    || release.sourceArtifactSha256 !== expected.sourceArtifactSha256
    || release.abiArtifactSha256 !== expected.abiArtifactSha256
    || release.eventSetSha256 !== expected.eventSetSha256
    || finality.minimumConfirmations !== expected.minimumFinalityBlocks
    || finality.policyBindingHash !== expected.registryPolicyCommitment) {
    throw new TypeError("Registry projection does not match the live deployment config");
  }
}

async function localArtifacts(
  raw,
  websiteSource,
  repoRoot,
  read,
  gitBlobIdentity,
  label,
) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
    throw new TypeError(`${label} artifacts are invalid`);
  }
  const result = [];
  for (const candidate of raw) {
    const value = exactObject(candidate, [
      "gitBlobOid", "path", "sha256",
    ], `${label} artifact`);
    const path = artifactPath(value.path, `${label} artifact path`);
    const fullPath = resolve(repoRoot, path);
    const rel = relative(repoRoot, fullPath);
    if (rel.startsWith(`..${sep}`) || rel === ".." || rel === "") {
      throw new TypeError(`${label} artifact escapes the repository`);
    }
    const expected = digest(value.sha256, `${label} artifact digest`);
    const expectedGitBlobOid = match(
      value.gitBlobOid,
      GIT_OID,
      `${label} artifact Git blob`,
    );
    const gitBlob = await gitBlobIdentity(repoRoot, websiteSource.commit, path);
    if (gitBlob.type !== "blob"
      || !["100644", "100755"].includes(gitBlob.mode)
      || gitBlob.oid !== expectedGitBlobOid
      || gitBlob.contentSha256 !== expected) {
      throw new TypeError(`${label} artifact does not match the HEAD Git blob ${path}`);
    }
    const bytes = read === readFile
      ? await readRegularArtifact(fullPath, label)
      : await read(fullPath);
    if (bytes.byteLength === 0 || bytes.byteLength > 4_194_304
      || sha256Bytes(bytes) !== expected) {
      throw new TypeError(`${label} artifact bytes do not match ${path}`);
    }
    result.push(Object.freeze({
      path,
      sha256: expected,
      gitBlobOid: expectedGitBlobOid,
    }));
  }
  const paths = result.map(({ path }) => path);
  if (new Set(paths).size !== paths.length
    || canonicalJson(paths) !== canonicalJson([...paths].sort())) {
    throw new TypeError(`${label} artifacts must be unique and sorted`);
  }
  return Object.freeze(result);
}

function assertExactArtifactInventory(artifacts, expected, label) {
  const paths = artifacts.map(({ path }) => path);
  if (canonicalJson(paths) !== canonicalJson(expected)) {
    throw new TypeError(`${label} artifact inventory is not exact`);
  }
  return artifacts;
}

async function hostedPersistenceEvidence(
  raw,
  expectedIdentity,
  currentExpectedIdentity,
) {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)
    && Object.keys(raw).includes("rotationReceipt")) {
    return currentHostedPersistenceEvidence(raw, currentExpectedIdentity);
  }
  const expected = exactObject(expectedIdentity, [
    "adoptionArtifactSha256", "applyArtifactSha256", "finalCatalogSha256",
    "orderSha256", "planArtifactSha256", "planRepositoryCommit",
    "planRepositoryTree", "planSha256", "verifyArtifactSha256",
  ], "hosted persistence expected identity");
  const value = exactObject(raw, [
    "adoption", "apply", "plan", "verify",
  ], "hosted persistence evidence");
  const [planArtifact, adoptionArtifact, applyArtifact, verifyArtifact] =
    await Promise.all([
      readProtectedEvidenceArtifact(value.plan, "hosted migration plan"),
      readProtectedEvidenceArtifact(value.adoption, "hosted adoption evidence"),
      readProtectedEvidenceArtifact(value.apply, "hosted apply evidence"),
      readProtectedEvidenceArtifact(value.verify, "hosted verify evidence"),
    ]);
  const plan = validateRetainedWebsiteProjectionPlan(planArtifact.value);
  const adoption = operatorResult(adoptionArtifact.value, "adopt-existing");
  const apply = operatorResult(applyArtifact.value, "apply");
  const verify = operatorResult(verifyArtifact.value, "verify");
  const resultArtifacts = [adoption, apply, verify];
  if (planArtifact.sha256 !== digest(
    expected.planArtifactSha256,
    "expected hosted plan artifact",
  )
    || adoptionArtifact.sha256 !== digest(
      expected.adoptionArtifactSha256,
      "expected hosted adoption artifact",
    )
    || applyArtifact.sha256 !== digest(
      expected.applyArtifactSha256,
      "expected hosted apply artifact",
    )
    || verifyArtifact.sha256 !== digest(
      expected.verifyArtifactSha256,
      "expected hosted verify artifact",
    )
    || plan.repositoryCommit !== expected.planRepositoryCommit
    || plan.repositoryTree !== expected.planRepositoryTree
    || plan.planSha256 !== expected.planSha256
    || plan.orderSha256 !== expected.orderSha256) {
    throw new TypeError("Hosted persistence artifacts do not match the frozen closure");
  }
  if (resultArtifacts.some((result) =>
    result.planSha256 !== plan.planSha256
    || canonicalJson(result.target) !== canonicalJson(adoption.target)
    || canonicalJson(result.operatorIdentity)
      !== canonicalJson(adoption.operatorIdentity))) {
    throw new TypeError("Hosted persistence evidence is not one operator chain");
  }
  const expectedPending = plan.migrations.slice(3).map(
    ({ ordinal, version, file }) => ({ ordinal, version, file }),
  );
  const adopted = exactObject(adoption.state, [
    "adoptedExisting", "adoptedThisRun", "adoptionAttestationSha256",
    "adoptionDataSha256", "adoptionSourceCatalogSha256", "appliedCount",
    "catalogSha256", "pending", "runtimeRoleStatus", "status",
  ], "hosted adoption state");
  const applied = exactObject(apply.state, [
    "appliedCount", "appliedThisRun", "catalogSha256", "pending",
    "roleCreated", "runtimeRoleStatus", "status",
  ], "hosted apply state");
  const verified = exactObject(verify.state, [
    "appliedCount", "catalogSha256", "pending", "runtimeRoleStatus", "status",
  ], "hosted verify state");
  if (adoption.changed !== true
    || adopted.status !== "pending" || adopted.appliedCount !== 3
    || canonicalJson(adopted.pending) !== canonicalJson(expectedPending)
    || adopted.runtimeRoleStatus !== "current"
    || adopted.adoptedExisting !== true
    || canonicalJson(adopted.adoptedThisRun) !== canonicalJson([
      "0001", "0002", "0003",
    ])
    || !HEX_SHA256.test(adopted.catalogSha256)
    || !HEX_SHA256.test(adopted.adoptionSourceCatalogSha256)
    || !HEX_SHA256.test(adopted.adoptionDataSha256)
    || !HEX_SHA256.test(adopted.adoptionAttestationSha256)) {
    throw new TypeError("Hosted adoption evidence is not the exact 0001-0003 prefix");
  }
  if (apply.changed !== true
    || applied.status !== "current" || applied.appliedCount !== 5
    || canonicalJson(applied.pending) !== "[]"
    || applied.runtimeRoleStatus !== "current"
    || canonicalJson(applied.appliedThisRun) !== canonicalJson(["0004", "0005"])
    || applied.roleCreated !== false
    || !HEX_SHA256.test(applied.catalogSha256)) {
    throw new TypeError("Hosted apply evidence is not exact through 0005");
  }
  if (verify.changed !== false
    || verified.status !== "current" || verified.appliedCount !== 5
    || canonicalJson(verified.pending) !== "[]"
    || verified.runtimeRoleStatus !== "current"
    || verified.catalogSha256 !== applied.catalogSha256
    || verified.catalogSha256 !== expected.finalCatalogSha256) {
    throw new TypeError("Hosted verify evidence does not close the 0005 catalog");
  }
  const normalized = Object.freeze({
    target: adoption.target,
    plan: Object.freeze({
      repositoryCommit: plan.repositoryCommit,
      repositoryTree: plan.repositoryTree,
      planSha256: plan.planSha256,
      orderSha256: plan.orderSha256,
      migrations: Object.freeze(plan.migrations.map((migration) => Object.freeze({
        ordinal: migration.ordinal,
        version: migration.version,
        file: migration.file,
        fileSha256: migration.fileSha256,
        executionSha256: migration.executionSha256,
      }))),
    }),
    protectedArtifacts: Object.freeze({
      planSha256: planArtifact.sha256,
      adoptionSha256: adoptionArtifact.sha256,
      applySha256: applyArtifact.sha256,
      verifySha256: verifyArtifact.sha256,
    }),
    adoption: Object.freeze({
      catalogSha256: adopted.catalogSha256,
      sourceCatalogSha256: adopted.adoptionSourceCatalogSha256,
      dataSha256: adopted.adoptionDataSha256,
      attestationSha256: adopted.adoptionAttestationSha256,
    }),
    finalCatalogSha256: verified.catalogSha256,
    migratedThrough: "0005",
  });
  return Object.freeze({
    ...normalized,
    closureHash: canonicalSha256(
      "programmable.generic-launch-read-model-hosted-persistence-closure.v1",
      normalized,
    ),
  });
}

async function currentHostedPersistenceEvidence(raw, expectedIdentity) {
  const expected = exactObject(expectedIdentity, [
    "finalCatalogSha256", "operatorCatalogSha256", "orderSha256",
    "planArtifactSha256", "planRepositoryCommit", "planRepositoryTree",
    "planSha256", "rotationReceiptArtifactSha256", "rotationSourceCommit",
    "rotationSourceParent", "rotationSourceTree",
  ], "current hosted persistence expected identity");
  const value = exactObject(raw, [
    "currentVerify", "plan", "rotationReceipt",
  ], "current hosted persistence evidence");
  const [planArtifact, rotationArtifact, verifyArtifact] = await Promise.all([
    readProtectedEvidenceArtifact(value.plan, "hosted migration plan"),
    readProtectedEvidenceArtifact(
      value.rotationReceipt,
      "hosted credential rotation receipt",
    ),
    readProtectedEvidenceArtifact(
      value.currentVerify,
      "hosted current read-only verify evidence",
    ),
  ]);
  const plan = validateWebsiteProjectionPlan(planArtifact.value);
  if (planArtifact.sha256 !== digest(
    expected.planArtifactSha256,
    "expected hosted plan artifact",
  )
    || rotationArtifact.sha256 !== digest(
      expected.rotationReceiptArtifactSha256,
      "expected hosted rotation receipt artifact",
    )
    || plan.repositoryCommit !== expected.planRepositoryCommit
    || plan.repositoryTree !== expected.planRepositoryTree
    || plan.planSha256 !== expected.planSha256
    || plan.orderSha256 !== expected.orderSha256) {
    throw new TypeError(
      "Current hosted persistence artifacts do not match the frozen closure",
    );
  }
  const rotation = credentialRotationReceipt(rotationArtifact.value, expected);
  const verified = operatorResult(verifyArtifact.value, "verify");
  const verifyState = exactObject(verified.state, [
    "appliedCount", "catalogSha256", "pending", "runtimeRoleStatus", "status",
  ], "hosted current verify state");
  if (verified.changed !== false
    || verified.planSha256 !== plan.planSha256
    || canonicalJson(verified.target) !== canonicalJson({
      projectRef: rotation.target.projectRef,
      host: rotation.target.authorityEndpoint.split(":")[0],
      port: 5432,
      database: rotation.target.database,
      sslMode: "verify-full",
    })
    || verifyState.status !== "current"
    || verifyState.appliedCount !== plan.migrationCount
    || canonicalJson(verifyState.pending) !== "[]"
    || verifyState.runtimeRoleStatus !== "current"
    || verifyState.catalogSha256 !== expected.finalCatalogSha256
    || verifyState.catalogSha256 !== rotation.catalog.afterSha256) {
    throw new TypeError(
      "Current hosted verify evidence does not close the exact 0005 catalog",
    );
  }
  const normalized = Object.freeze({
    evidenceBasis: "authenticated-rotation-plus-current-read-only-verify",
    target: verified.target,
    plan: Object.freeze({
      repositoryCommit: plan.repositoryCommit,
      repositoryTree: plan.repositoryTree,
      planSha256: plan.planSha256,
      orderSha256: plan.orderSha256,
      migrations: Object.freeze(plan.migrations.map((migration) => Object.freeze({
        ordinal: migration.ordinal,
        version: migration.version,
        file: migration.file,
        fileSha256: migration.fileSha256,
        executionSha256: migration.executionSha256,
      }))),
    }),
    protectedArtifacts: Object.freeze({
      planSha256: planArtifact.sha256,
      rotationReceiptSha256: rotationArtifact.sha256,
      currentVerifySha256: verifyArtifact.sha256,
    }),
    rotation,
    currentVerify: Object.freeze({
      operatorIdentity: verified.operatorIdentity,
      state: Object.freeze({ ...verifyState }),
    }),
    finalCatalogSha256: verifyState.catalogSha256,
    migratedThrough: "0005",
  });
  return Object.freeze({
    ...normalized,
    closureHash: canonicalSha256(
      "programmable.generic-launch-read-model-hosted-persistence-current-closure.v1",
      normalized,
    ),
  });
}

function credentialRotationReceipt(raw, expected) {
  const value = exactObject(raw, [
    "catalog", "changed", "cutover", "migrationEvidence", "operation",
    "protectedOutputs", "rotatedAt", "runtimeProbe", "schemaVersion", "source",
    "target", "tls",
  ], "hosted credential rotation receipt");
  const source = exactObject(value.source, [
    "repositoryCommit", "repositoryParent", "repositoryTree",
  ], "hosted credential rotation source");
  const target = exactObject(value.target, [
    "authorityEndpoint", "database", "projectRef", "runtimeEndpoint", "runtimeRole",
  ], "hosted credential rotation target");
  const migrationEvidence = exactObject(value.migrationEvidence, [
    "catalogSha256", "migrationCount", "operatorCatalogSha256", "planSha256",
    "repositoryCommit", "repositoryTree",
  ], "hosted credential rotation migration evidence");
  const catalog = exactObject(value.catalog, [
    "afterSha256", "beforeSha256", "unchanged",
  ], "hosted credential rotation catalog");
  const runtimeProbe = exactObject(value.runtimeProbe, [
    "databaseName", "leastPrivilege", "runtimeRole", "serverVersionNum", "sslBits",
    "sslCipher", "sslVersion",
  ], "hosted credential rotation runtime probe");
  const tls = exactObject(value.tls, [
    "caSha256", "hostnameVerified", "mode",
  ], "hosted credential rotation TLS evidence");
  const cutover = exactObject(value.cutover, [
    "existingSessionsAreNotCutoverEvidence", "overlappingPasswordsSupported",
    "passwordSlots", "postCommitFailure", "preCommitFailure",
    "vercelMutationPerformed",
  ], "hosted credential rotation cutover evidence");
  const protectedOutputs = exactObject(value.protectedOutputs, [
    "containsSecretDerivedDigest", "databaseCaPem", "databaseRole", "databaseUrl",
    "mode", "receipt",
  ], "hosted credential rotation protected outputs");
  if (value.schemaVersion
      !== "programmable.website-projection-runtime-credential-rotation.v1"
    || value.operation !== "rotate-existing-runtime-role-password"
    || value.changed !== true
    || typeof value.rotatedAt !== "string"
    || !Number.isFinite(Date.parse(value.rotatedAt))
    || source.repositoryCommit !== expected.rotationSourceCommit
    || source.repositoryTree !== expected.rotationSourceTree
    || source.repositoryParent !== expected.rotationSourceParent
    || target.projectRef !== WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF
    || target.database !== "postgres"
    || target.authorityEndpoint !== `db.${target.projectRef}.supabase.co:5432`
    || target.runtimeEndpoint !== "aws-0-eu-central-1.pooler.supabase.com:6543"
    || target.runtimeRole !== "programmable_website_projection_runtime"
    || migrationEvidence.migrationCount !== 5
    || migrationEvidence.planSha256 !== expected.planSha256
    || migrationEvidence.repositoryCommit !== expected.planRepositoryCommit
    || migrationEvidence.repositoryTree !== expected.planRepositoryTree
    || migrationEvidence.catalogSha256 !== expected.finalCatalogSha256
    || migrationEvidence.operatorCatalogSha256 !== expected.operatorCatalogSha256
    || catalog.beforeSha256 !== expected.finalCatalogSha256
    || catalog.afterSha256 !== expected.finalCatalogSha256
    || catalog.unchanged !== true
    || runtimeProbe.runtimeRole !== target.runtimeRole
    || runtimeProbe.databaseName !== target.database
    || !/^[1-9][0-9]{5,}$/u.test(runtimeProbe.serverVersionNum)
    || runtimeProbe.leastPrivilege !== true
    || runtimeProbe.sslVersion !== "TLSv1.3"
    || runtimeProbe.sslCipher !== "TLS_AES_256_GCM_SHA384"
    || runtimeProbe.sslBits !== 256
    || tls.mode !== "verify-full-equivalent"
    || !SHA256.test(tls.caSha256)
    || tls.hostnameVerified !== true
    || cutover.passwordSlots !== 1
    || cutover.overlappingPasswordsSupported !== false
    || cutover.existingSessionsAreNotCutoverEvidence !== true
    || cutover.preCommitFailure !== "automatic-transaction-rollback"
    || cutover.postCommitFailure
      !== "forward-rotate-or-rerun-with-the-same-protected-secret"
    || cutover.vercelMutationPerformed !== false
    || protectedOutputs.databaseUrl
      !== "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"
    || protectedOutputs.databaseRole
      !== "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"
    || protectedOutputs.databaseCaPem
      !== "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM"
    || protectedOutputs.receipt
      !== "programmable-website-projection-runtime-credential-rotation-v1.json"
    || protectedOutputs.mode !== "0600"
    || protectedOutputs.containsSecretDerivedDigest !== false) {
    throw new TypeError(
      "Hosted credential rotation receipt is not the authenticated current state",
    );
  }
  return Object.freeze({
    rotatedAt: value.rotatedAt,
    source: Object.freeze({ ...source }),
    target: Object.freeze({ ...target }),
    migrationEvidence: Object.freeze({ ...migrationEvidence }),
    catalog: Object.freeze({ ...catalog }),
    runtimeProbe: Object.freeze({ ...runtimeProbe }),
    tls: Object.freeze({ ...tls }),
  });
}

function operatorResult(raw, operation) {
  const value = exactObject(raw, [
    "changed", "kind", "operation", "operatorIdentity", "planSha256",
    "schemaVersion", "state", "target",
  ], `hosted ${operation} result`);
  const target = exactObject(value.target, [
    "database", "host", "port", "projectRef", "sslMode",
  ], `hosted ${operation} target`);
  const operatorIdentity = exactObject(value.operatorIdentity, [
    "effectiveRole", "mode", "sessionUser",
  ], `hosted ${operation} operator`);
  if (value.kind !== "programmable-website-projection-db-operator-result"
    || value.schemaVersion !== 1 || value.operation !== operation
    || !HEX_SHA256.test(value.planSha256)
    || target.projectRef !== WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF
    || target.host !== `db.${target.projectRef}.supabase.co`
    || target.port !== 5432 || target.database !== "postgres"
    || target.sslMode !== "verify-full"
    || operatorIdentity.mode !== "database-owner"
    || operatorIdentity.sessionUser !== "postgres"
    || operatorIdentity.effectiveRole !== "postgres") {
    throw new TypeError(`Hosted ${operation} evidence identity is invalid`);
  }
  return Object.freeze({
    planSha256: value.planSha256,
    target: Object.freeze({ ...target }),
    operatorIdentity: Object.freeze({ ...operatorIdentity }),
    state: value.state,
    changed: value.changed,
  });
}

async function readProtectedEvidenceArtifact(raw, label) {
  const value = exactObject(raw, ["path", "sha256"], label);
  const path = nonempty(value.path, `${label} path`);
  const expected = digest(value.sha256, `${label} digest`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      || stat.size <= 0 || stat.size > 1_048_576) {
      throw new TypeError(`${label} must be an owner-only bounded regular file`);
    }
    const bytes = await handle.readFile();
    if (sha256Bytes(bytes) !== expected) {
      throw new TypeError(`${label} digest does not match`);
    }
    return Object.freeze({
      sha256: expected,
      value: JSON.parse(bytes.toString("utf8")),
    });
  } finally {
    await handle.close();
  }
}

async function readRegularArtifact(path, label) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > 4_194_304) {
      throw new TypeError(`${label} artifact is not a bounded regular file`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function sourceIdentity(raw, label) {
  const value = exactObject(raw, [
    "commit", "repositoryFullName", "repositoryId", "tree",
  ], label);
  return Object.freeze({
    repositoryId: positiveDecimal(value.repositoryId, `${label} repository ID`),
    repositoryFullName: match(value.repositoryFullName, REPOSITORY,
      `${label} repository name`),
    commit: match(value.commit, GIT_OID, `${label} commit`),
    tree: match(value.tree, GIT_OID, `${label} tree`),
  });
}

function externalArtifact(raw, label) {
  const value = exactObject(raw, ["path", "sha256"], label);
  return Object.freeze({
    path: artifactPath(value.path, `${label} path`),
    sha256: digest(value.sha256, `${label} digest`),
  });
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new TypeError(`${label} must contain exactly ${keys.join(", ")}`);
  }
  return value;
}

function artifactPath(value, label) {
  const path = match(value, ARTIFACT_PATH, label);
  if (path.startsWith("./")
    || path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(`${label} is not canonical`);
  }
  return path;
}

function digest(value, label) {
  return match(value, SHA256, label);
}

function hash32(value, label) {
  return match(value, HASH32, label);
}

function address(value, label) {
  const result = match(value, ADDRESS, label);
  if (/^0x0{40}$/iu.test(result)) throw new TypeError(`${label} is zero`);
  return result.toLowerCase();
}

function positiveDecimal(value, label) {
  return match(value, POSITIVE_DECIMAL, label);
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function match(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function currentGitIdentity(repoRoot) {
  const git = (args) => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (git(["status", "--porcelain"]) !== "") {
    throw new TypeError("Website checkout must be clean");
  }
  return Object.freeze({
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
  });
}

export function currentGitBlobIdentity(repoRoot, commit, path) {
  const output = execFileSync("git", [
    "ls-tree", "-z", "--full-tree", commit, "--", path,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const match = /^(100644|100755) (blob) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/u
    .exec(output);
  if (!match || match[4] !== path) {
    throw new TypeError(`Website HEAD does not contain exact artifact ${path}`);
  }
  const bytes = execFileSync("git", ["cat-file", "blob", match[3]], {
    cwd: repoRoot,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 4_194_305,
  });
  if (bytes.byteLength <= 0 || bytes.byteLength > 4_194_304) {
    throw new TypeError(`Website HEAD artifact is not bounded ${path}`);
  }
  return Object.freeze({
    mode: match[1],
    type: match[2],
    oid: match[3],
    contentSha256: sha256Bytes(bytes),
  });
}

function assertWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON contains a lone Unicode surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Canonical JSON contains a lone Unicode surrogate");
    }
  }
}

export async function readProtectedDerivationInput(path, expectedSha256) {
  const expected = digest(expectedSha256, "protected derivation input");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new TypeError("Protected derivation input must be an owner-only regular file");
    }
    if (stat.size <= 0 || stat.size > 1_048_576) {
      throw new TypeError("Protected derivation input size is invalid");
    }
    const bytes = await handle.readFile();
    if (sha256Bytes(bytes) !== expected) {
      throw new TypeError("Protected derivation input digest does not match");
    }
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await handle.close();
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = resolve(args.repoRoot ?? process.cwd());
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  if (inputPath === outputPath) throw new TypeError("Input and output must differ");
  const input = await readProtectedDerivationInput(inputPath, args.inputSha256);
  const artifact = await deriveGenericLaunchReadModelContractV2(input, {
    repoRoot,
    gitIdentity: currentGitIdentity,
  });
  const bytes = `${canonicalJson(artifact)}\n`;
  await writeFile(outputPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    artifactSha256: sha256Bytes(bytes),
    derivationHash: artifact.derivationHash,
    readModelBindingHash: artifact.readModelBindingHash,
  })}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--input", "--input-sha256", "--output", "--repo-root"].includes(key)) {
      throw new TypeError(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${key} is required`);
    const field = key === "--repo-root"
      ? "repoRoot"
      : key === "--input-sha256" ? "inputSha256" : key.slice(2);
    result[field] = value;
    index += 1;
  }
  if (!result.input || !result.inputSha256 || !result.output) {
    throw new TypeError(
      "Usage: --input <protected.json> --input-sha256 <sha256:...> --output <new-artifact.json>",
    );
  }
  return result;
}

if (process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
