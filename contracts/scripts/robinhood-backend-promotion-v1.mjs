#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_FLY_RELEASES_V1, MAX_FLY_RELEASE_READBACKS_V1,
  readCompleteFlyReleasesV1, validateCompleteFlyReleasesV1,
} from "./fly-release-pagination-v1.mjs";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import {
  assertExactKeys,
  atomicCreate,
  decodeExactUtf8,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import {
  computeV4BackendReleaseEvidenceDigest,
} from "../../scripts/programmable-launch-v4-release-binding.mjs";
import {
  canonicalRobinhoodFreshObservedAt,
  createRobinhoodResponseBudget,
  readRobinhoodBoundedResponse,
} from "./robinhood-custom-launch-capture-v2.mjs";

// Explicit factories keep historical proof defaults closed while allowing a separately pinned successor.
export function createRobinhoodBackendPromotionTools(release = null) {
const configured = (name, fallback) => release !== null && Object.hasOwn(release, name)
  ? release[name] : fallback;
const FLY_RELEASE_PAGE_SIZE = configured("flyReleasePageSize", 256);
if (![32, 256].includes(FLY_RELEASE_PAGE_SIZE)) throw new TypeError("Unsupported Fly release page size");
const ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA =
  "programmable.robinhood-custom-launch.backend-promotion-input.v1";
const ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA =
  "programmable.robinhood-custom-launch.backend-promotion-public-input.v2";
const ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA =
  "programmable.launch-cli-v4-backend-release-authorization.v1";
const ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW =
  configured("ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW", ".github/workflows/finalize-robinhood-custom-launch-promotion.yml");
const ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA =
  "programmable.robinhood-custom-launch.backend-capture-authorization.v3";
const ROBINHOOD_BACKEND_CAPTURE_WORKFLOW =
  configured("ROBINHOOD_BACKEND_CAPTURE_WORKFLOW", ".github/workflows/capture-programmable-robinhood-promotion.yml");
const ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME =
  configured("ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME", "Capture Programmable Robinhood backend promotion");
const ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS =
  "sigstore-keyless-github-actions-protected-main-v1";
const ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY =
  configured("ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY",
    "https://github.com/programmablehq/programmable-open-hook-v2-internal/"
      + ".github/workflows/capture-programmable-robinhood-promotion.yml@refs/heads/main");
const ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";
const ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF = "refs/heads/main";
const ROBINHOOD_BACKEND_CAPTURE_TRIGGER = "workflow_dispatch";
const CAPTURE_OBSERVER_SOURCE = configured("captureObserverSource", null);
const ROBINHOOD_BACKEND_COSIGN_VERSION = "v3.1.3";
const ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256 =
  "sha256:4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71";
const SIGSTORE_BUNDLE_V03_MEDIA_TYPE =
  "application/vnd.dev.sigstore.bundle.v0.3+json";
const ROBINHOOD_BACKEND_READINESS_SCHEMA =
  "programmable.custom-launch-api-release-identity.v4";
const ROBINHOOD_BACKEND_EVIDENCE_SCHEMA =
  "programmable.launch-cli-v4-backend-release-evidence.v1";
const ROBINHOOD_BACKEND_HOSTNAME =
  "programmable-custom-launch-api.fly.dev";
const ROBINHOOD_FLY_MACHINES_HOSTNAME = "api.machines.dev";
const ROBINHOOD_FLY_GRAPHQL_HOSTNAME = "api.fly.io";
const ROBINHOOD_FLY_APP = "programmable-custom-launch-api";
const ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH =
  configured("ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH", "release/robinhood-chain-4663/backend-promotion-input.json");
const ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH =
  configured("ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH", "release/robinhood-chain-4663/backend-promotion-input.public.json");
const ROBINHOOD_BACKEND_AUTHORIZATION_PATH =
  configured("ROBINHOOD_BACKEND_AUTHORIZATION_PATH", "release/robinhood-chain-4663/programmable-backend-authorization.json");
const ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH =
  configured("ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH", "release/robinhood-chain-4663/programmable-backend-authorization.attestation.json");
const ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH =
  configured("ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH", "release/robinhood-chain-4663/backend-promotion-input.attestation.json");
const ROBINHOOD_STAGE_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-stage-bundle.json";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX40 = /^(?!0{40}$)[0-9a-f]{40}$/u;
const HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const ISO_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CAPTURE_ID = /^[0-9a-f]{64}$/u;
const FLY_RELEASE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const FLY_MACHINE_RELEASE_ID = /^rel_[a-z0-9]{6,128}$/u;
const FLY_V1_SCHEME = "FlyV1 ";
const FLY_V1_SEGMENT = /^fm2_([A-Za-z0-9/+_-]+={0,2})$/u;
const FLY_V1_MAXIMUM_SEGMENTS = 16;

function resolveCaptureWorkflowCommit(sourceCommit) {
  if (CAPTURE_OBSERVER_SOURCE === null) return sourceCommit;
  const { runtime, observer } = CAPTURE_OBSERVER_SOURCE;
  if (![runtime?.sourceCommit, runtime?.sourceTree, observer?.sourceCommit, observer?.sourceTree]
    .every(value => HEX40.test(value ?? "")) || sourceCommit !== runtime.sourceCommit) {
    throw new TypeError("runtime capture differs from the reviewed observer binding");
  }
  return observer.sourceCommit;
}
const FLY_V1_MINIMUM_SEGMENT_BYTES = 32;
const FLY_V1_MAXIMUM_SEGMENT_BYTES = 12_288;
const BACKEND_REPOSITORY = "programmablehq/programmable-open-hook-v2-internal";
const BACKEND_REPOSITORY_ID = "1318883798";
const PROGRAMMABLE_REPOSITORY = "programmablehq/PROGRAMMABLE";
const PROGRAMMABLE_REPOSITORY_ID = "1314365508";
const PROGRAMMABLE_PRODUCTION_REF = "refs/heads/production";
const CHAIN_DEPLOYMENT_ID = "robinhood-mainnet-custom-launch-v1";
const CHAIN_ID = "4663";
const UNISWAP_REGISTRY = Object.freeze({
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  sourcePath: "deployments/json/4663.json",
  releasePath: "release/assets/uniswap-4663-4cfc406.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
});
const COMPOSITION_KEYS = Object.freeze([
  "authoritativeChainRuntime",
  "liveExactPrivyPolicyReadiness",
  "apiSignerObserverVerifierRoleAttestation",
  "durableLedger",
  "exactCredentialScopeRecheck",
  "isolatedImageDecoder",
  "dualProviderSimulation",
  "exactExternalContractVerifier",
  "permitDigestSigner",
  "durableFinalityWriter",
  "canonicalFinalitySubjectReader",
  "dualProviderSubmissionDiscovery",
  "finalityObserver",
  "finalityWorkerLifecycle",
  "sourceVerificationWorkerConfigured",
  "sourceVerificationWorkerStarted",
  "sourceVerificationWorkerLifecycle",
  ...(release?.profile?.profileVersion === "4.1.0" ? ["nativeInitialBuyQuote"] : []),
]);

function failFlyV1TokenWire() {
  throw new TypeError("FLY_V1_TOKEN_WIRE_INVALID");
}

function canonicalFlyV1Segment(segment) {
  const match = FLY_V1_SEGMENT.exec(segment);
  if (match === null) failFlyV1TokenWire();
  const encoded = match[1];
  const unpadded = encoded.replace(/=+$/u, "");
  const paddingLength = encoded.length - unpadded.length;
  const remainder = unpadded.length % 4;
  if (remainder === 1) failFlyV1TokenWire();
  const requiredPadding = remainder === 0 ? 0 : 4 - remainder;
  if (paddingLength !== 0 && paddingLength !== requiredPadding) failFlyV1TokenWire();
  if (/[+/]/u.test(unpadded) && /[-_]/u.test(unpadded)) failFlyV1TokenWire();
  const standardUnpadded = unpadded.replaceAll("-", "+").replaceAll("_", "/");
  const standard = `${standardUnpadded}${"=".repeat(requiredPadding)}`;
  const bytes = Buffer.from(standard, "base64");
  if (bytes.byteLength < FLY_V1_MINIMUM_SEGMENT_BYTES
    || bytes.byteLength > FLY_V1_MAXIMUM_SEGMENT_BYTES
    || bytes.toString("base64") !== standard) {
    bytes.fill(0);
    failFlyV1TokenWire();
  }
  bytes.fill(0);
  return `fm2_${standard}`;
}

function normalizeFlyV1TokenWireV1(value, { requireScheme = false } = {}) {
  if (typeof value !== "string" || !/^[\x20-\x7e]+$/u.test(value)) failFlyV1TokenWire();
  const hasScheme = value.startsWith(FLY_V1_SCHEME);
  if (requireScheme && !hasScheme) failFlyV1TokenWire();
  const raw = hasScheme ? value.slice(FLY_V1_SCHEME.length) : value;
  const segments = raw.split(",");
  if (segments.length < 1 || segments.length > FLY_V1_MAXIMUM_SEGMENTS) {
    failFlyV1TokenWire();
  }
  const canonicalRaw = segments.map(canonicalFlyV1Segment).join(",");
  return Object.freeze({
    raw: canonicalRaw,
    header: `${FLY_V1_SCHEME}${canonicalRaw}`,
  });
}

function normalizeFlyV1Authorization(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 16_384
    || !/^[\x20-\x7e]+$/u.test(value)) {
    failFlyV1TokenWire();
  }
  return normalizeFlyV1TokenWireV1(value);
}
const MAX_CAPTURE_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const MAX_FLY_RELEASE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CAPTURE_AUTHORIZATION_DELAY_MS = 10 * 60 * 1000;
const BACKEND_SAFE_RECEIPTS_DOMAIN =
  "programmable.robinhood-custom-launch.backend-safe-readback-receipts.v2";
const FLY_SAFE_READBACKS_DOMAIN =
  "programmable.custom-launch-api-fly-safe-readbacks.v2";
const FLY_RELEASE_ID_DOMAIN =
  "programmable.robinhood-custom-launch.backend-release-id.v1";
const FLY_RELEASE_VERSION_DOMAIN =
  "programmable.robinhood-custom-launch.backend-release-version.v1";
const FLY_MACHINE_ID_DOMAIN =
  "programmable.robinhood-custom-launch.backend-machine-id.v1";
const FLY_IMAGE_IDENTITY_DOMAIN =
  "programmable.robinhood-custom-launch.backend-image-identity.v1";
const FLY_RELEASE_IDENTITY_DOMAIN =
  "programmable.robinhood-custom-launch.backend-fly-release-identity.v1";
const BACKEND_SAFE_RESPONSE_DOMAIN =
  "programmable.robinhood-custom-launch.backend-safe-normalized-response.v1";
const FLY_CONTROL_PLANE_SCHEMA =
  "programmable.custom-launch-api-fly-control-plane-receipt.v2";
const BACKEND_PROMOTION_SEMANTIC_INPUT_DOMAIN =
  "programmable.robinhood-custom-launch.backend-promotion-semantic-input.v1";
const BACKEND_PRIVATE_RESPONSE_BYTES = 32 * 1024 * 1024;
const ROBINHOOD_BACKEND_PRIVATE_ARTIFACT_BYTES = 48 * 1024 * 1024;
const BACKEND_PUBLIC_INPUT_BYTES = 16 * 1024 * 1024;
const BACKEND_FRESH_AGGREGATE_BYTES = 32 * 1024 * 1024;
const BACKEND_RESPONSE_BYTES = Object.freeze({
  readiness: 1 * 1024 * 1024,
  releases: 4 * 1024 * 1024,
  app: 1 * 1024 * 1024,
  "machine-list": 1 * 1024 * 1024,
  machine: 2 * 1024 * 1024,
  metadata: 1 * 1024 * 1024,
});
const FLY_RELEASES_QUERY = "query ProgrammableRobinhoodRelease($appName: String!, $first: Int!) { app(name: $appName) { releasesUnprocessed(first: $first) { totalCount pageInfo { hasNextPage hasPreviousPage startCursor endCursor } nodes { id version status stable imageRef image { registry repository tag digest } createdAt } } } }";
const BACKEND_MIGRATION_PATH = configured("BACKEND_MIGRATION_PATH", "migrations/0024_custom_launch_source_authority_v4.sql");
const BACKEND_MIGRATION_SHA256 =
  configured("BACKEND_MIGRATION_SHA256", "sha256:51efb50f6f59131042d4253ce485cf14c3d375ab639d8c7075eb22dc8a9d44a0");
const BACKEND_API_CONTRACT_PATH = configured("BACKEND_API_CONTRACT_PATH", "release/custom-launch-api-contract.v4.json");
const BACKEND_API_CONTRACT_SHA256 =
  configured("BACKEND_API_CONTRACT_SHA256", "sha256:1c22711fa0516507d1e207ee7cb565d9ec95f59e042d869c0052a98a57d73634");
const ROBINHOOD_PROVIDER_PROFILE_SHA256 =
  configured("ROBINHOOD_PROVIDER_PROFILE_SHA256",
    "sha256:88daed906c2a142c57d2483099a6d18be31dbff2a282108657ec6f5e73f53132");

function validateSigstoreMessageBundleV03({ bundleBytes, subjectBytes }) {
  if (!Buffer.isBuffer(bundleBytes) || bundleBytes.byteLength < 1
    || bundleBytes.byteLength > 16 * 1024 * 1024
    || !Buffer.isBuffer(subjectBytes) || subjectBytes.byteLength < 1
    || subjectBytes.byteLength > BACKEND_PUBLIC_INPUT_BYTES) {
    throw new TypeError("Sigstore bundle or subject bytes are empty or oversized");
  }
  const bundle = parseStrictJson(
    decodeExactUtf8(bundleBytes, "Sigstore v0.3 bundle"),
    { maximumBytes: 16 * 1024 * 1024, maximumDepth: 256 },
  );
  assertExactKeys(bundle, [
    "mediaType", "verificationMaterial", "messageSignature",
  ], "Sigstore v0.3 message-signature bundle");
  if (bundle.mediaType !== SIGSTORE_BUNDLE_V03_MEDIA_TYPE) {
    throw new TypeError("Sigstore bundle is not the required standardized v0.3 format");
  }
  const materialKeys = Object.keys(bundle.verificationMaterial ?? {});
  const allowedMaterialKeys = new Set([
    "certificate", "tlogEntries", "timestampVerificationData",
  ]);
  if (bundle.verificationMaterial?.certificate !== undefined) {
    assertExactKeys(
      bundle.verificationMaterial.certificate,
      ["rawBytes"],
      "Sigstore leaf certificate",
    );
  }
  const certificateBytes = typeof bundle.verificationMaterial?.certificate?.rawBytes === "string"
    ? Buffer.from(bundle.verificationMaterial.certificate.rawBytes, "base64")
    : Buffer.alloc(0);
  if (materialKeys.some((key) => !allowedMaterialKeys.has(key))
    || certificateBytes.byteLength === 0
    || certificateBytes.toString("base64")
      !== bundle.verificationMaterial?.certificate?.rawBytes
    || !Array.isArray(bundle.verificationMaterial?.tlogEntries)
    || bundle.verificationMaterial.tlogEntries.length < 1
    || bundle.verificationMaterial.tlogEntries.some((entry) =>
      entry === null || typeof entry !== "object" || Array.isArray(entry))) {
    throw new TypeError("Sigstore bundle lacks keyless certificate or transparency-log proof");
  }
  assertExactKeys(bundle.messageSignature, [
    "messageDigest", "signature",
  ], "Sigstore message signature");
  assertExactKeys(bundle.messageSignature.messageDigest, [
    "algorithm", "digest",
  ], "Sigstore message digest");
  const expectedDigest = createHash("sha256").update(subjectBytes).digest("base64");
  const signatureBytes = typeof bundle.messageSignature.signature === "string"
    ? Buffer.from(bundle.messageSignature.signature, "base64")
    : Buffer.alloc(0);
  if (bundle.messageSignature.messageDigest.algorithm !== "SHA2_256"
    || bundle.messageSignature.messageDigest.digest !== expectedDigest
    || signatureBytes.byteLength === 0
    || signatureBytes.toString("base64") !== bundle.messageSignature.signature) {
    throw new TypeError("Sigstore message signature does not bind the exact subject bytes");
  }
  return Object.freeze(structuredClone(bundle));
}

function buildRobinhoodBackendCosignVerifyBlobArgs({
  subjectPath,
  bundlePath,
  sourceCommit,
}) {
  if (typeof subjectPath !== "string" || subjectPath.length === 0
    || typeof bundlePath !== "string" || bundlePath.length === 0
    || !HEX40.test(sourceCommit)) {
    throw new TypeError("backend Cosign verification coordinates are invalid");
  }
  return Object.freeze([
    "verify-blob",
    "--bundle", bundlePath,
    "--certificate-identity", ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
    "--certificate-oidc-issuer", ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
    "--certificate-github-workflow-name", ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
    "--certificate-github-workflow-repository", BACKEND_REPOSITORY,
    "--certificate-github-workflow-ref", ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
    "--certificate-github-workflow-sha", resolveCaptureWorkflowCommit(sourceCommit),
    "--certificate-github-workflow-trigger", ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
    subjectPath,
  ]);
}

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function assertJsonBytesMatch(value, bytes, label, maximumBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new TypeError(`${label} bytes are empty or exceed the bounded input limit`);
  }
  const parsed = parseStrictJson(decodeExactUtf8(bytes, `${label} bytes`), {
    maximumBytes,
    maximumDepth: 256,
  });
  if (canonicalizeJson(parsed) !== canonicalizeJson(value)) {
    throw new TypeError(`${label} object differs from its exact authorized bytes`);
  }
  return bytes;
}

function iso(value, label) {
  if (typeof value !== "string" || !ISO_SECOND.test(value)
    || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactBase64(value, label, maximumBytes = BACKEND_PRIVATE_RESPONSE_BYTES) {
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;
  if (typeof value !== "string" || value.length === 0
    || value.length > maximumEncodedLength) {
    throw new TypeError(`${label} must retain non-empty base64 bytes`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maximumBytes
    || bytes.toString("base64") !== value) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  return bytes;
}

function exactMaybeEmptyBase64(value, label, maximumBytes = BACKEND_PRIVATE_RESPONSE_BYTES) {
  if (value === "") return Buffer.alloc(0);
  return exactBase64(value, label, maximumBytes);
}

function parseBody(value, label, maximumBytes = BACKEND_PRIVATE_RESPONSE_BYTES) {
  const bytes = exactBase64(value, `${label}.bodyBytesBase64`, maximumBytes);
  return {
    bytes,
    value: parseStrictJson(decodeExactUtf8(bytes, `${label} body`), {
      maximumBytes,
      maximumDepth: 256,
    }),
  };
}

function normalizeReadback(value, {
  kind,
  hostname,
  pathPattern,
  authentication,
  method = "GET",
  requestBodyValidator = null,
  captureObservedAt,
  maximumResponseBytes,
}) {
  assertExactKeys(value, ["kind", "request", "response"], `${kind} readback`);
  if (value.kind !== kind) throw new TypeError(`expected ${kind} readback`);
  assertExactKeys(value.request, [
    "method", "scheme", "hostname", "path", "accept", "contentType",
    "authentication", "bodyBytesBase64", "bodyByteLength", "bodySha256",
    "sanitizedBytesBase64", "byteLength", "sha256",
  ], `${kind} request`);
  if (value.request.method !== method || value.request.scheme !== "https"
    || value.request.hostname !== hostname || !pathPattern.test(value.request.path)
    || value.request.accept !== "application/json"
    || value.request.authentication !== authentication
    || value.request.contentType !== (method === "POST" ? "application/json" : null)) {
    throw new TypeError(`${kind} request target/authentication differs`);
  }
  const requestBody = exactMaybeEmptyBase64(
    value.request.bodyBytesBase64,
    `${kind} request body`,
    1_048_576,
  );
  if (value.request.bodyByteLength !== String(requestBody.byteLength)
    || value.request.bodySha256 !== sha256Digest(requestBody)) {
    throw new TypeError(`${kind} request body binding differs`);
  }
  if (requestBodyValidator !== null) {
    const bodyValue = parseStrictJson(decodeExactUtf8(requestBody, `${kind} request body`), {
      maximumBytes: 1_048_576,
      maximumDepth: 64,
    });
    requestBodyValidator(bodyValue);
  } else if (requestBody.byteLength !== 0) {
    throw new TypeError(`${kind} GET request body must be empty`);
  }
  const requestBytes = exactBase64(
    value.request.sanitizedBytesBase64,
    `${kind} request sanitized bytes`,
    1_048_576,
  );
  const requestText = decodeExactUtf8(requestBytes, `${kind} request sanitized bytes`);
  const expectedRequest = `${method} https://${hostname}${value.request.path}\n`
    + `accept: application/json\ncontent-type: ${value.request.contentType ?? "none"}\n`
    + `authentication: ${authentication}\n\n${requestBody.toString("utf8")}`;
  if (requestText !== expectedRequest) {
    throw new TypeError(`${kind} request bytes contain a secret or differ from the safe contract`);
  }
  if (value.request.byteLength !== String(requestBytes.byteLength)
    || value.request.sha256 !== sha256Digest(requestBytes)) {
    throw new TypeError(`${kind} request byte binding differs`);
  }
  assertExactKeys(value.response, [
    "httpStatus", "contentType", "date", "requestId", "bodyBytesBase64",
    "bodyByteLength", "bodySha256",
  ], `${kind} response`);
  if (value.response.httpStatus !== 200
    || typeof value.response.contentType !== "string"
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value.response.contentType)
    || typeof value.response.date !== "string"
    || typeof value.response.requestId !== "string"
    || !/^[A-Za-z0-9._:-]{1,200}$/u.test(value.response.requestId)) {
    throw new TypeError(`${kind} response status or safe headers differ`);
  }
  const responseTime = Date.parse(value.response.date);
  const captureTime = Date.parse(captureObservedAt);
  if (Number.isNaN(responseTime) || Number.isNaN(captureTime)
    || new Date(responseTime).toUTCString() !== value.response.date
    || Math.abs(responseTime - captureTime) > MAX_FUTURE_SKEW_MS) {
    throw new TypeError(`${kind} response Date does not bind the capture observation`);
  }
  const body = parseBody(
    value.response.bodyBytesBase64,
    `${kind} response`,
    maximumResponseBytes,
  );
  if (value.response.bodyByteLength !== String(body.bytes.byteLength)
    || value.response.bodySha256 !== sha256Digest(body.bytes)) {
    throw new TypeError(`${kind} response byte binding differs`);
  }
  return Object.freeze({
    closure: structuredClone(value),
    body: body.value,
    responseByteLength: body.bytes.byteLength,
  });
}

function safeReadbackReceipt(value, kind, normalizedResponse) {
  return Object.freeze({
    kind,
    httpStatus: 200,
    contentType: "application/json",
    requestSha256: value.request.sha256,
    normalizedResponseSha256: framedSha256(
      BACKEND_SAFE_RESPONSE_DOMAIN,
      { kind, result: normalizedResponse },
    ),
  });
}

function bindingMachineContract(stageBundle, name) {
  const value = stageBundle?.artifacts?.cliReleaseBinding?.value?.machineContracts
    ?.find((entry) => entry?.name === name);
  if (value === undefined || !SHA256.test(value.sha256)) {
    throw new TypeError(`staged ${name} machine contract is invalid`);
  }
  return value;
}

function exactReadinessIdentity(value, stageBundle, backendSource) {
  assertExactKeys(value, [
    "schemaVersion", "status", "service", "sourceCommit", "sourceTree", "chainId",
    "chainDeploymentId", "chainDeploymentDescriptorDigest", "providerProfileDigest",
    "migration", "apiContract", "openApiSha256", "finalityPolicy",
    "uniswapRegistrySnapshot", "policySource", "profile", "providerQuorums", "composition",
  ], "backend readiness release identity");
  const descriptorDigest = stageBundle.finalizedBindings.chainDeploymentDescriptorDigest;
  const releaseIdentity = stageBundle.artifacts.cliReleaseBinding.value.releaseIdentity;
  if (release?.profile && canonicalizeJson(releaseIdentity.profile) !== canonicalizeJson(release.profile)) {
    throw new TypeError("backend readiness requires the exact successor release profile");
  }
  if (value.schemaVersion !== ROBINHOOD_BACKEND_READINESS_SCHEMA || value.status !== "ready"
    || value.service !== "custom-launch-api-v1" || value.sourceCommit !== backendSource.sourceCommit
    || value.sourceTree !== backendSource.sourceTree || value.chainId !== CHAIN_ID
    || value.chainDeploymentId !== CHAIN_DEPLOYMENT_ID
    || value.chainDeploymentDescriptorDigest !== descriptorDigest
    || value.providerProfileDigest !== ROBINHOOD_PROVIDER_PROFILE_SHA256) {
    throw new TypeError("backend readiness release identity does not bind the staged deployment");
  }
  assertExactKeys(value.migration, ["path", "sha256"], "backend readiness migration");
  assertExactKeys(value.apiContract, ["path", "sha256"], "backend readiness API contract");
  if (value.migration.path !== BACKEND_MIGRATION_PATH
    || value.migration.sha256 !== BACKEND_MIGRATION_SHA256
    || value.apiContract.path !== BACKEND_API_CONTRACT_PATH
    || value.apiContract.sha256 !== BACKEND_API_CONTRACT_SHA256) {
    throw new TypeError("backend readiness artifact bindings are invalid");
  }
  const openApi = bindingMachineContract(stageBundle, "openapi");
  if (value.openApiSha256 !== openApi.sha256
    || canonicalizeJson(value.finalityPolicy)
      !== canonicalizeJson(releaseIdentity.finalityPolicy)) {
    throw new TypeError("backend readiness OpenAPI/finality policy differs");
  }
  if (canonicalizeJson(value.uniswapRegistrySnapshot) !== canonicalizeJson(UNISWAP_REGISTRY)
    || canonicalizeJson(value.policySource) !== canonicalizeJson(releaseIdentity.policySource)) {
    throw new TypeError("backend readiness registry/policy source differs");
  }
  assertExactKeys(value.profile, [
    "structuralProfileId", "businessProfileId", "profileRevision", "profileVersion",
    "profileDigest", "providerProfileDigest",
  ], "backend readiness profile");
  const expectedProfile = releaseIdentity.profile;
  if (value.profile.structuralProfileId !== expectedProfile.structuralProfileId
    || value.profile.businessProfileId !== expectedProfile.businessProfileId
    || value.profile.profileRevision !== expectedProfile.profileRevision
    || value.profile.profileVersion !== expectedProfile.profileVersion
    || value.profile.profileDigest !== expectedProfile.profileDigest
    || value.profile.providerProfileDigest !== ROBINHOOD_PROVIDER_PROFILE_SHA256
    || value.profile.providerProfileDigest !== value.providerProfileDigest) {
    throw new TypeError("backend readiness profile differs");
  }
  assertExactKeys(value.providerQuorums, ["robinhood", "ethereum"],
    "backend readiness provider quorums");
  if (canonicalizeJson(value.providerQuorums) !== canonicalizeJson({
    robinhood: [
      { providerId: "drpc", trustDomain: "drpc.org" },
      { providerId: "alchemy", trustDomain: "alchemy.com" },
    ],
    ethereum: [
      { providerId: "drpc", trustDomain: "drpc.org" },
      { providerId: "quicknode", trustDomain: "quicknode.com" },
    ],
  })) throw new TypeError("backend readiness provider quorums differ");
  assertExactKeys(value.composition, COMPOSITION_KEYS, "backend readiness composition");
  if (COMPOSITION_KEYS.some((key) => value.composition[key] !== true)) {
    throw new TypeError("backend readiness production composition is incomplete");
  }
  return structuredClone(value);
}

function validateFlyGraphqlRequest(value, expected = {
  query: FLY_RELEASES_QUERY, variables: { appName: ROBINHOOD_FLY_APP, first: FLY_RELEASE_PAGE_SIZE },
}) {
  assertExactKeys(value, ["query", "variables"], "Fly releases GraphQL request");
  assertExactKeys(value.variables, Object.keys(expected.variables), "Fly releases GraphQL variables");
  if (value.query !== expected.query
    || canonicalizeJson(value.variables) !== canonicalizeJson(expected.variables)) {
    throw new TypeError("Fly releases GraphQL query differs from the pinned read-only query");
  }
}

function normalizeFlyBodies(fly, backendSource, observedAt) {
  const app = fly.app.body;
  if (app?.name !== ROBINHOOD_FLY_APP || app.status !== "deployed"
    || typeof app.id !== "string" || app.id.length === 0) {
    throw new TypeError("Fly app identity/status differs");
  }
  const releasesBody = fly.releases.body;
  if (Object.hasOwn(releasesBody, "errors")) {
    throw new TypeError("Fly releases GraphQL response contains errors");
  }
  assertExactKeys(releasesBody, ["data"], "Fly GraphQL response");
  assertExactKeys(releasesBody.data, ["app"], "Fly GraphQL data");
  assertExactKeys(releasesBody.data.app, ["releasesUnprocessed"], "Fly GraphQL app");
  const releaseConnection = releasesBody.data.app.releasesUnprocessed;
  assertExactKeys(releaseConnection, ["totalCount", "pageInfo", "nodes"],
    "Fly releasesUnprocessed connection");
  assertExactKeys(releaseConnection.pageInfo, [
    "hasNextPage", "hasPreviousPage", "startCursor", "endCursor",
  ], "Fly release pageInfo");
  const pageInfo = releaseConnection.pageInfo;
  if (pageInfo.hasNextPage !== false || pageInfo.hasPreviousPage !== false) {
    throw new TypeError("Fly releasesUnprocessed inventory is paginated or incomplete");
  }
  if (typeof pageInfo.startCursor !== "string" || pageInfo.startCursor.length < 1
    || pageInfo.startCursor.length > 2048 || typeof pageInfo.endCursor !== "string"
    || pageInfo.endCursor.length < 1 || pageInfo.endCursor.length > 2048) {
    throw new TypeError("Fly release inventory cursors are invalid");
  }
  const releases = releaseConnection.nodes;
  if (!Array.isArray(releases) || releases.length < 1 || releases.length > MAX_FLY_RELEASES_V1
    || !Number.isSafeInteger(releaseConnection.totalCount)
    || releaseConnection.totalCount !== releases.length) {
    throw new TypeError("Fly releasesUnprocessed inventory count is invalid or incomplete");
  }
  const versions = releases.map((entry) => entry?.version);
  const ids = releases.map((entry) => entry?.id);
  for (const entry of releases) {
    assertExactKeys(entry, [
      "id", "version", "status", "stable", "imageRef", "image", "createdAt",
    ], "Fly release node");
  }
  const observedTime = Date.parse(observedAt);
  if (versions.some((version) => !Number.isSafeInteger(version) || version < 1)
    || ids.some((id) => typeof id !== "string" || !FLY_RELEASE_ID.test(id))
    || new Set(versions).size !== versions.length || new Set(ids).size !== ids.length
    || releases.some((entry) => typeof entry.status !== "string"
      || typeof entry.stable !== "boolean" || !ISO_SECOND.test(entry.createdAt)
      || Number.isNaN(Date.parse(entry.createdAt))
      || Date.parse(entry.createdAt) > observedTime + MAX_FUTURE_SKEW_MS)) {
    throw new TypeError("Fly release identities/versions/timestamps are invalid");
  }
  const release = releases.reduce((latest, entry) => entry.version > latest.version
    ? entry : latest);
  if (release.status !== "complete") {
    throw new TypeError("The latest Fly release is not complete");
  }
  if (observedTime - Date.parse(release.createdAt) > MAX_FLY_RELEASE_AGE_MS) {
    throw new TypeError("The latest Fly release is stale or future-dated");
  }
  assertExactKeys(release.image, ["registry", "repository", "tag", "digest"],
    "latest Fly release image");
  if (release.imageRef !== `registry.fly.io/${ROBINHOOD_FLY_APP}:${release.image?.tag}`
    || release.image?.registry !== "registry.fly.io"
    || release.image?.repository !== ROBINHOOD_FLY_APP
    || typeof release.image?.tag !== "string"
    || !/^(?:main|production)-[0-9a-f]{12}$/u.test(release.image.tag)
    || typeof release.image?.digest !== "string" || !SHA256.test(release.image.digest)) {
    throw new TypeError("Fly latest release image closure is invalid");
  }
  if (release.image.tag !== `main-${backendSource.sourceCommit.slice(0, 12)}`) {
    throw new TypeError("Fly release image tag does not bind the attested backend source");
  }
  const releaseIdDigest = framedSha256(FLY_RELEASE_ID_DOMAIN, {
    releaseId: String(release.id),
  });
  const releaseVersionDigest = framedSha256(FLY_RELEASE_VERSION_DOMAIN, {
    releaseVersion: String(release.version),
  });
  const imageIdentityDigest = framedSha256(FLY_IMAGE_IDENTITY_DOMAIN, {
    registry: release.image.registry,
    repository: release.image.repository,
    imageTag: release.image.tag,
    imageDigest: release.image.digest,
  });
  const listedMachines = fly.machineList.body;
  if (!Array.isArray(listedMachines) || listedMachines.length < 1
    || listedMachines.length > 8) {
    throw new TypeError("Fly machine inventory is invalid");
  }
  const listedIds = listedMachines.map((machine) => machine?.id).sort();
  if (listedIds.some((id) => typeof id !== "string" || !/^[a-z0-9]{6,64}$/u.test(id))
    || new Set(listedIds).size !== listedIds.length
    || canonicalizeJson(listedIds) !== canonicalizeJson([...fly.machines.keys()])) {
    throw new TypeError("Fly list/individual machine inventories differ");
  }
  let machineReleaseId = null;
  const normalizedMachines = listedIds.map((id, index) => {
    const listed = listedMachines.find((entry) => entry?.id === id);
    const machine = fly.machines.get(id).body;
    const metadata = fly.metadata.get(id).body;
    const imageRef = machine?.image_ref;
    const listedImageRef = listed?.image_ref;
    if (typeof listed?.id !== "string" || !/^[a-z0-9]{6,64}$/u.test(listed.id)
      || listed.id !== id
      || listed.state !== "started" || listed.region !== "fra"
      || listed?.config?.image !== release.imageRef
      || listedImageRef?.registry !== release.image.registry
      || listedImageRef?.repository !== release.image.repository
      || listedImageRef?.tag !== release.image.tag
      || listedImageRef?.digest !== release.image.digest
      || typeof machine?.id !== "string" || !/^[a-z0-9]{6,64}$/u.test(machine.id)
      || machine.id !== id
      || machine.state !== "started" || machine.region !== "fra"
      || machine?.config?.image !== release.imageRef
      || imageRef?.registry !== release.image.registry
      || imageRef?.repository !== release.image.repository
      || imageRef?.tag !== release.image.tag
      || imageRef?.digest !== release.image.digest
      || listed.state !== machine.state || listed.region !== machine.region
      || listedImageRef.registry !== imageRef.registry
      || listedImageRef.repository !== imageRef.repository
      || listedImageRef.tag !== imageRef.tag
      || listedImageRef.digest !== imageRef.digest
      || listed.config.image !== machine.config.image) {
      throw new TypeError("Fly machine identity/state/image differs");
    }
    if (typeof metadata?.fly_release_id !== "string"
      || !FLY_MACHINE_RELEASE_ID.test(metadata.fly_release_id)
      || metadata.fly_release_version !== String(release.version)) {
      throw new TypeError("Fly machine metadata differs from the latest release");
    }
    if (machineReleaseId === null) machineReleaseId = metadata.fly_release_id;
    else if (metadata.fly_release_id !== machineReleaseId) {
      throw new TypeError("Fly machine release metadata inventories differ");
    }
    return Object.freeze({
      slot: String(index + 1),
      machineIdentityDigest: framedSha256(FLY_MACHINE_ID_DOMAIN, { machineId: id }),
      state: "started",
      region: "fra",
    });
  });
  const publicIdentity = {
    app: ROBINHOOD_FLY_APP,
    appStatus: "deployed",
    releaseIdDigest,
    releaseVersionDigest,
    imageTag: release.image.tag,
    imageIdentityDigest,
    machines: normalizedMachines,
  };
  const releaseIdentityDigest = framedSha256(
    FLY_RELEASE_IDENTITY_DOMAIN,
    publicIdentity,
  );
  const releaseResponse = Object.freeze({
    releaseIdDigest,
    releaseVersionDigest,
    status: "complete",
    stable: true,
    imageTag: release.image.tag,
    imageIdentityDigest,
  });
  const safeResponses = [
    releaseResponse,
    Object.freeze({ app: ROBINHOOD_FLY_APP, appStatus: "deployed" }),
    Object.freeze({
      machines: normalizedMachines.map(({ slot, machineIdentityDigest }) => ({
        slot,
        machineIdentityDigest,
      })),
    }),
  ];
  for (const machine of normalizedMachines) {
    safeResponses.push(Object.freeze({
      slot: machine.slot,
      machineIdentityDigest: machine.machineIdentityDigest,
      state: "started",
      region: "fra",
      imageTag: release.image.tag,
      imageIdentityDigest,
    }));
    safeResponses.push(Object.freeze({
      slot: machine.slot,
      machineIdentityDigest: machine.machineIdentityDigest,
      releaseIdDigest,
      releaseVersionDigest,
    }));
  }
  return Object.freeze({
    ...publicIdentity,
    machines: Object.freeze(normalizedMachines),
    releaseIdentityDigest,
    safeResponses: Object.freeze(safeResponses),
  });
}

function computeRobinhoodBackendPromotionInputDigest(value) {
  return framedSha256(
    ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
    { ...structuredClone(value), backendPromotionInputDigest: null },
  );
}

function buildRobinhoodBackendPromotionInput(value) {
  const normalized = { ...structuredClone(value), backendPromotionInputDigest: null };
  normalized.backendPromotionInputDigest = computeRobinhoodBackendPromotionInputDigest(normalized);
  return Object.freeze(normalized);
}

function validateRobinhoodBackendPromotionInput({
  input,
  stageBundle,
  now = () => new Date(),
}) {
  assertExactKeys(input, [
    "schemaVersion", "captureId", "observedAt", "backendSource", "readinessReadback",
    "flyReadbacks", "backendPromotionInputDigest",
  ], "backend promotion input");
  if (input.schemaVersion !== ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA
    || !CAPTURE_ID.test(input.captureId)) throw new TypeError("backend promotion identity is invalid");
  iso(input.observedAt, "backend promotion observedAt");
  const currentTime = now().getTime();
  const observedTime = Date.parse(input.observedAt);
  if (!Number.isFinite(currentTime) || observedTime > currentTime + MAX_FUTURE_SKEW_MS
    || currentTime - observedTime > MAX_CAPTURE_AGE_MS) {
    throw new TypeError("backend promotion input is stale or future-dated");
  }
  assertExactKeys(input.backendSource, ["repository", "sourceCommit", "sourceTree"],
    "backend source");
  if (input.backendSource.repository !== BACKEND_REPOSITORY
    || !HEX40.test(input.backendSource.sourceCommit) || !HEX40.test(input.backendSource.sourceTree)) {
    throw new TypeError("backend source identity is invalid");
  }
  if (input.backendPromotionInputDigest !== computeRobinhoodBackendPromotionInputDigest(input)) {
    throw new TypeError("backend promotion input digest differs");
  }
  const readiness = normalizeReadback(input.readinessReadback, {
    kind: "readiness",
    hostname: ROBINHOOD_BACKEND_HOSTNAME,
    pathPattern: /^\/v4\/chains\/4663\/readiness$/u,
    authentication: "none",
    captureObservedAt: input.observedAt,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES.readiness,
  });
  if (!Array.isArray(input.flyReadbacks) || input.flyReadbacks.length < 5
    || input.flyReadbacks.length > MAX_FLY_RELEASE_READBACKS_V1 + 18) {
    throw new TypeError("backend promotion Fly inventory has an invalid bounded size");
  }
  let releaseReadbackCount = 0;
  const inventory = validateCompleteFlyReleasesV1({
    firstRequest: { query: FLY_RELEASES_QUERY, variables: { appName: ROBINHOOD_FLY_APP, first: FLY_RELEASE_PAGE_SIZE } },
    read: (request, kind) => {
      const readback = input.flyReadbacks[releaseReadbackCount++];
      const normalized = normalizeReadback(readback, {
        kind,
        hostname: ROBINHOOD_FLY_GRAPHQL_HOSTNAME,
        pathPattern: /^\/graphql$/u,
        authentication: "fly-api-token-redacted",
        method: "POST",
        requestBodyValidator: value => validateFlyGraphqlRequest(value, request),
        captureObservedAt: input.observedAt,
        maximumResponseBytes: BACKEND_RESPONSE_BYTES.releases,
      });
      return { value: normalized.body, readback, responseByteLength: normalized.responseByteLength };
    },
  });
  const releases = { body: inventory.value,
    responseByteLength: inventory.observations.reduce((total, entry) => total + entry.responseByteLength, 0) };
  const app = normalizeReadback(input.flyReadbacks[releaseReadbackCount], {
    kind: "app",
    hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
    pathPattern: /^\/v1\/apps\/programmable-custom-launch-api$/u,
    authentication: "fly-api-token-redacted",
    captureObservedAt: input.observedAt,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES.app,
  });
  const machineList = normalizeReadback(input.flyReadbacks[releaseReadbackCount + 1], {
    kind: "machine-list",
    hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
    pathPattern: /^\/v1\/apps\/programmable-custom-launch-api\/machines$/u,
    authentication: "fly-api-token-redacted",
    captureObservedAt: input.observedAt,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES["machine-list"],
  });
  const listedMachines = Array.isArray(machineList.body)
    ? machineList.body : machineList.body?.machines;
  if (!Array.isArray(listedMachines) || listedMachines.length < 1
    || listedMachines.length > 8) throw new TypeError("Fly machine list is invalid");
  const machineIds = listedMachines.map(({ id } = {}) => id).sort();
  if (machineIds.some((id) => typeof id !== "string" || !/^[a-z0-9]{6,64}$/u.test(id))
    || new Set(machineIds).size !== machineIds.length
    || input.flyReadbacks.length !== releaseReadbackCount + 2 + machineIds.length * 2) {
    throw new TypeError("Fly per-machine inventory is missing, duplicated, or excessive");
  }
  const machines = new Map();
  const metadata = new Map();
  for (const [index, machineId] of machineIds.entries()) {
    const machineOffset = releaseReadbackCount + 2 + index * 2;
    machines.set(machineId, normalizeReadback(input.flyReadbacks[machineOffset], {
      kind: `machine:${machineId}`,
      hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
      pathPattern: new RegExp(`^/v1/apps/${ROBINHOOD_FLY_APP}/machines/${machineId}$`, "u"),
      authentication: "fly-api-token-redacted",
      captureObservedAt: input.observedAt,
      maximumResponseBytes: BACKEND_RESPONSE_BYTES.machine,
    }));
    metadata.set(machineId, normalizeReadback(input.flyReadbacks[machineOffset + 1], {
      kind: `metadata:${machineId}`,
      hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
      pathPattern: new RegExp(
        `^/v1/apps/${ROBINHOOD_FLY_APP}/machines/${machineId}/metadata$`,
        "u",
      ),
      authentication: "fly-api-token-redacted",
      captureObservedAt: input.observedAt,
      maximumResponseBytes: BACKEND_RESPONSE_BYTES.metadata,
    }));
  }
  const fly = { releases, app, machineList, machines, metadata };
  const releaseIdentity = exactReadinessIdentity(
    readiness.body,
    stageBundle,
    input.backendSource,
  );
  const flyIdentity = normalizeFlyBodies(fly, input.backendSource, input.observedAt);
  const privateResponseBytes = readiness.responseByteLength
    + releases.responseByteLength + app.responseByteLength + machineList.responseByteLength
    + [...machines.values()].reduce((total, entry) => total + entry.responseByteLength, 0)
    + [...metadata.values()].reduce((total, entry) => total + entry.responseByteLength, 0);
  if (privateResponseBytes > BACKEND_FRESH_AGGREGATE_BYTES) {
    throw new TypeError("backend promotion private readbacks exceed the aggregate response budget");
  }
  const readinessReceipt = safeReadbackReceipt(
    input.readinessReadback,
    "readiness",
    releaseIdentity,
  );
  const flyKinds = [
    "releases",
    "app",
    "machine-list",
    ...flyIdentity.machines.flatMap(({ slot }) => [`machine:${slot}`, `metadata:${slot}`]),
  ];
  const baseReadbacks = [input.flyReadbacks[0], ...input.flyReadbacks.slice(releaseReadbackCount)];
  const flyReceipts = baseReadbacks.map((readback, index) => {
    const receipt = safeReadbackReceipt(readback, flyKinds[index], flyIdentity.safeResponses[index]);
    return index === 0 && releaseReadbackCount > 1 ? Object.freeze({ ...receipt,
      requestSha256: framedSha256("programmable.fly-release-page-requests.v1",
        inventory.observations.map(({ readback }) => ({ kind: readback.kind,
          requestSha256: readback.request.sha256, responseSha256: readback.response.bodySha256 }))),
    }) : receipt;
  });
  const flySafeReadbacksDigest = framedSha256(FLY_SAFE_READBACKS_DOMAIN, flyReceipts);
  const safeReceiptDigest = framedSha256(
    BACKEND_SAFE_RECEIPTS_DOMAIN,
    [readinessReceipt, ...flyReceipts],
  );
  const readbackReceipts = {
    readiness: readinessReceipt,
    fly: flyReceipts,
    digest: safeReceiptDigest,
  };
  const runtimeReadiness = {
    schemaVersion: "programmable.custom-launch-api-runtime-readiness-receipt.v4",
    path: "/v4/chains/4663/readiness",
    releaseIdentity: structuredClone(releaseIdentity),
    releaseIdentityDigest: framedSha256(ROBINHOOD_BACKEND_READINESS_SCHEMA, releaseIdentity),
    observedAt: input.observedAt,
  };
  const flyControlPlane = {
    schemaVersion: FLY_CONTROL_PLANE_SCHEMA,
    app: flyIdentity.app,
    appStatus: flyIdentity.appStatus,
    releaseIdDigest: flyIdentity.releaseIdDigest,
    releaseVersionDigest: flyIdentity.releaseVersionDigest,
    imageTag: flyIdentity.imageTag,
    imageIdentityDigest: flyIdentity.imageIdentityDigest,
    machines: flyIdentity.machines,
    safeReadbacksDigest: flySafeReadbacksDigest,
    releaseIdentityDigest: flyIdentity.releaseIdentityDigest,
    observedAt: input.observedAt,
  };
  const backendPromotionInputDigest = computeRobinhoodBackendPromotionSemanticDigest({
    observedAt: input.observedAt,
    backendSource: input.backendSource,
    readbackReceipts,
    runtimeReadiness,
    flyControlPlane,
  });
  const runtimeAuthorizationDigest = framedSha256(
    "programmable.custom-launch-api-runtime-readiness-receipt.v4",
    {
      backendPromotionInputDigest,
      requestSha256: readinessReceipt.requestSha256,
      normalizedResponseSha256: readinessReceipt.normalizedResponseSha256,
    },
  );
  const flyAuthorizationDigest = framedSha256(
    FLY_CONTROL_PLANE_SCHEMA,
    {
      backendPromotionInputDigest,
      safeReadbacksDigest: flySafeReadbacksDigest,
      runtimeReadinessNormalizedResponseSha256:
        readinessReceipt.normalizedResponseSha256,
      releaseIdentityDigest: flyIdentity.releaseIdentityDigest,
    },
  );
  const binding = stageBundle.artifacts.cliReleaseBinding.value;
  const evidence = {
    schemaVersion: ROBINHOOD_BACKEND_EVIDENCE_SCHEMA,
    repository: BACKEND_REPOSITORY,
    sourceCommit: input.backendSource.sourceCommit,
    sourceTree: input.backendSource.sourceTree,
    chainDeploymentDescriptorDigest:
      stageBundle.finalizedBindings.chainDeploymentDescriptorDigest,
    backendPromotionInputDigest,
    apiContract: structuredClone(releaseIdentity.apiContract),
    migration: structuredClone(releaseIdentity.migration),
    openApiSha256: releaseIdentity.openApiSha256,
    profileDigest: binding.releaseIdentity.profile.profileDigest,
    admissionPolicyDigest: binding.releaseIdentity.profile.admissionPolicyDigest,
    finalityPolicyDigest: releaseIdentity.finalityPolicy.policyDigest,
    runtimeReadiness: {
      schemaVersion: runtimeReadiness.schemaVersion,
      path: runtimeReadiness.path,
      httpStatus: 200,
      contentType: "application/json",
      normalizedResponseSha256: readinessReceipt.normalizedResponseSha256,
      releaseIdentityDigest: runtimeReadiness.releaseIdentityDigest,
      observedAt: runtimeReadiness.observedAt,
      authorizationDigest: runtimeAuthorizationDigest,
    },
    flyControlPlane: {
      ...flyControlPlane,
      authorizationDigest: flyAuthorizationDigest,
    },
    backendReleaseEvidenceDigest: null,
  };
  evidence.backendReleaseEvidenceDigest = computeV4BackendReleaseEvidenceDigest(evidence);
  return Object.freeze({
    input: Object.freeze(structuredClone(input)),
    captureId: backendPromotionInputDigest.slice("sha256:".length),
    backendPromotionInputDigest,
    releaseIdentity: Object.freeze(releaseIdentity),
    backendReleaseEvidence: Object.freeze(evidence),
    safeReadbackReceipts: Object.freeze(readbackReceipts),
  });
}

function computeRobinhoodBackendPromotionPublicInputDigest(value) {
  return framedSha256(
    ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA,
    { ...structuredClone(value), publicInputDigest: null },
  );
}

function backendPromotionSemanticSubject({
  observedAt,
  backendSource,
  readbackReceipts,
  runtimeReadiness,
  flyControlPlane,
}) {
  return {
    schemaVersion: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA,
    observedAt,
    backendSource: structuredClone(backendSource),
    readbackReceipts: structuredClone(readbackReceipts),
    runtimeReadiness: Object.fromEntries(Object.entries(runtimeReadiness)
      .filter(([key]) => key !== "authorizationDigest")),
    flyControlPlane: Object.fromEntries(Object.entries(flyControlPlane)
      .filter(([key]) => key !== "authorizationDigest")),
  };
}

function computeRobinhoodBackendPromotionSemanticDigest(value) {
  return framedSha256(
    BACKEND_PROMOTION_SEMANTIC_INPUT_DOMAIN,
    backendPromotionSemanticSubject(value),
  );
}

function buildRobinhoodBackendPromotionPublicInput(value) {
  const normalized = { ...structuredClone(value), publicInputDigest: null };
  normalized.publicInputDigest =
    computeRobinhoodBackendPromotionPublicInputDigest(normalized);
  return Object.freeze(normalized);
}

function validateSafeReceipt(value, expectedKind, label) {
  assertExactKeys(value, [
    "kind", "httpStatus", "contentType", "requestSha256", "normalizedResponseSha256",
  ], label);
  if (value.kind !== expectedKind || value.httpStatus !== 200
    || value.contentType !== "application/json" || !SHA256.test(value.requestSha256)
    || !SHA256.test(value.normalizedResponseSha256)) {
    throw new TypeError(`${label} safe receipt is invalid`);
  }
  return structuredClone(value);
}

function buildPublicInputFromPrivate({ privateInput, validated }) {
  const { readiness: readinessReceipt, fly: flyReceipts, digest } =
    validated.safeReadbackReceipts;
  const fly = validated.backendReleaseEvidence.flyControlPlane;
  return buildRobinhoodBackendPromotionPublicInput({
    schemaVersion: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA,
    captureId: validated.captureId,
    observedAt: privateInput.observedAt,
    backendSource: structuredClone(privateInput.backendSource),
    backendPromotionInputDigest: validated.backendPromotionInputDigest,
    readbackReceipts: {
      readiness: readinessReceipt,
      fly: flyReceipts,
      digest,
    },
    runtimeReadiness: {
      schemaVersion: validated.backendReleaseEvidence.runtimeReadiness.schemaVersion,
      path: validated.backendReleaseEvidence.runtimeReadiness.path,
      releaseIdentity: structuredClone(validated.releaseIdentity),
      releaseIdentityDigest:
        validated.backendReleaseEvidence.runtimeReadiness.releaseIdentityDigest,
      observedAt: validated.backendReleaseEvidence.runtimeReadiness.observedAt,
      authorizationDigest:
        validated.backendReleaseEvidence.runtimeReadiness.authorizationDigest,
    },
    flyControlPlane: {
      schemaVersion: fly.schemaVersion,
      app: fly.app,
      appStatus: fly.appStatus,
      releaseIdDigest: fly.releaseIdDigest,
      releaseVersionDigest: fly.releaseVersionDigest,
      imageTag: fly.imageTag,
      imageIdentityDigest: fly.imageIdentityDigest,
      machines: structuredClone(fly.machines),
      safeReadbacksDigest: fly.safeReadbacksDigest,
      releaseIdentityDigest: fly.releaseIdentityDigest,
      observedAt: fly.observedAt,
      authorizationDigest: fly.authorizationDigest,
    },
    publicInputDigest: null,
  });
}

function buildRobinhoodBackendPromotionPublicInputFromPrivate({
  privateInput,
  privateInputBytes,
  stageBundle,
  now = () => new Date(),
}) {
  if (!Buffer.isBuffer(privateInputBytes) || privateInputBytes.byteLength < 1
    || privateInputBytes.byteLength > ROBINHOOD_BACKEND_PRIVATE_ARTIFACT_BYTES) {
    throw new TypeError("private backend promotion artifact exceeds the 48 MiB input limit");
  }
  const exactPrivateBytes = Buffer.from(privateInputBytes);
  const parsedPrivateInput = parseStrictJson(
    decodeExactUtf8(exactPrivateBytes, "private backend promotion input"),
    { maximumBytes: ROBINHOOD_BACKEND_PRIVATE_ARTIFACT_BYTES },
  );
  if (canonicalizeJson(parsedPrivateInput) !== canonicalizeJson(privateInput)) {
    throw new TypeError("private backend promotion input bytes differ from the validated value");
  }
  const validated = validateRobinhoodBackendPromotionInput({
    input: privateInput,
    stageBundle,
    now,
  });
  return buildPublicInputFromPrivate({
    privateInput,
    validated,
  });
}

function buildRobinhoodBackendPromotionPublicFixture(stageBundle) {
  const privateInput = buildRobinhoodBackendPromotionFixture(stageBundle);
  const privateInputBytes = Buffer.from(`${JSON.stringify(privateInput, null, 2)}\n`, "utf8");
  return Object.freeze({
    privateInput,
    privateInputBytes,
    publicInput: buildRobinhoodBackendPromotionPublicInputFromPrivate({
      privateInput,
      privateInputBytes,
      stageBundle,
      now: () => new Date("2026-08-29T12:01:00Z"),
    }),
  });
}

function validateRobinhoodBackendPromotionPublicInput({
  input,
  stageBundle,
  now = () => new Date(),
}) {
  assertExactKeys(input, [
    "schemaVersion", "captureId", "observedAt", "backendSource", "backendPromotionInputDigest",
    "readbackReceipts", "runtimeReadiness", "flyControlPlane", "publicInputDigest",
  ], "backend promotion public input");
  if (input.schemaVersion !== ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA
    || !CAPTURE_ID.test(input.captureId)) {
    throw new TypeError("backend promotion public identity is invalid");
  }
  iso(input.observedAt, "backend promotion public observedAt");
  const currentTime = now().getTime();
  const observedTime = Date.parse(input.observedAt);
  if (!Number.isFinite(currentTime) || observedTime > currentTime + MAX_FUTURE_SKEW_MS
    || currentTime - observedTime > MAX_CAPTURE_AGE_MS) {
    throw new TypeError("backend promotion public input is stale or future-dated");
  }
  assertExactKeys(input.backendSource, ["repository", "sourceCommit", "sourceTree"],
    "backend promotion public source");
  if (input.backendSource.repository !== BACKEND_REPOSITORY
    || !HEX40.test(input.backendSource.sourceCommit)
    || !HEX40.test(input.backendSource.sourceTree)) {
    throw new TypeError("backend promotion public source identity is invalid");
  }
  if (CAPTURE_OBSERVER_SOURCE !== null) {
    resolveCaptureWorkflowCommit(input.backendSource.sourceCommit);
    if (input.backendSource.sourceTree !== CAPTURE_OBSERVER_SOURCE.runtime.sourceTree) {
      throw new TypeError("runtime capture tree differs from the reviewed observer binding");
    }
  }
  if (!SHA256.test(input.backendPromotionInputDigest)
    || input.captureId !== input.backendPromotionInputDigest.slice("sha256:".length)) {
    throw new TypeError("backend promotion semantic identity is invalid");
  }
  if (input.publicInputDigest !== computeRobinhoodBackendPromotionPublicInputDigest(input)) {
    throw new TypeError("backend promotion public input digest differs");
  }
  assertExactKeys(input.readbackReceipts, ["readiness", "fly", "digest"],
    "backend safe readback receipts");
  const readinessReceipt = validateSafeReceipt(
    input.readbackReceipts.readiness,
    "readiness",
    "backend readiness",
  );
  if (!Array.isArray(input.readbackReceipts.fly)
    || input.readbackReceipts.fly.length < 5 || input.readbackReceipts.fly.length > 19) {
    throw new TypeError("backend safe Fly receipt inventory is invalid");
  }
  assertExactKeys(input.runtimeReadiness, [
    "schemaVersion", "path", "releaseIdentity", "releaseIdentityDigest", "observedAt",
    "authorizationDigest",
  ], "public runtime readiness");
  const releaseIdentity = exactReadinessIdentity(
    input.runtimeReadiness.releaseIdentity,
    stageBundle,
    input.backendSource,
  );
  if (input.runtimeReadiness.schemaVersion
      !== "programmable.custom-launch-api-runtime-readiness-receipt.v4"
    || input.runtimeReadiness.path !== "/v4/chains/4663/readiness"
    || input.runtimeReadiness.releaseIdentityDigest
      !== framedSha256(ROBINHOOD_BACKEND_READINESS_SCHEMA, releaseIdentity)
    || input.runtimeReadiness.observedAt !== input.observedAt
    || readinessReceipt.normalizedResponseSha256 !== framedSha256(
      BACKEND_SAFE_RESPONSE_DOMAIN,
      { kind: "readiness", result: releaseIdentity },
    )
    || input.runtimeReadiness.authorizationDigest !== framedSha256(
      "programmable.custom-launch-api-runtime-readiness-receipt.v4",
      {
        backendPromotionInputDigest: input.backendPromotionInputDigest,
        requestSha256: readinessReceipt.requestSha256,
        normalizedResponseSha256: readinessReceipt.normalizedResponseSha256,
      },
    )) throw new TypeError("public runtime readiness binding differs");
  assertExactKeys(input.flyControlPlane, [
    "schemaVersion", "app", "appStatus", "releaseIdDigest", "releaseVersionDigest",
    "imageTag", "imageIdentityDigest", "machines", "safeReadbacksDigest",
    "releaseIdentityDigest", "observedAt", "authorizationDigest",
  ], "public Fly control-plane binding");
  const fly = input.flyControlPlane;
  if (fly.schemaVersion !== FLY_CONTROL_PLANE_SCHEMA
    || fly.app !== ROBINHOOD_FLY_APP || fly.appStatus !== "deployed"
    || !SHA256.test(fly.releaseIdDigest) || !SHA256.test(fly.releaseVersionDigest)
    || !SHA256.test(fly.imageIdentityDigest)
    || fly.imageTag !== `main-${input.backendSource.sourceCommit.slice(0, 12)}`
    || fly.observedAt !== input.observedAt) {
    throw new TypeError("public Fly release identity differs");
  }
  if (!Array.isArray(fly.machines) || fly.machines.length < 1 || fly.machines.length > 8) {
    throw new TypeError("public Fly machine inventory is invalid");
  }
  const machines = fly.machines.map((machine, index) => {
    assertExactKeys(machine, [
      "slot", "machineIdentityDigest", "state", "region",
    ], `public Fly machine ${index}`);
    if (machine.slot !== String(index + 1) || !SHA256.test(machine.machineIdentityDigest)
      || machine.state !== "started" || machine.region !== "fra") {
      throw new TypeError(`public Fly machine ${index} binding differs`);
    }
    return structuredClone(machine);
  });
  const machineDigests = machines.map(({ machineIdentityDigest }) => machineIdentityDigest);
  if (new Set(machineDigests).size !== machineDigests.length) {
    throw new TypeError("public Fly machine identity digests are not unique");
  }
  const expectedKinds = ["releases", "app", "machine-list",
    ...machines.flatMap(({ slot }) => [`machine:${slot}`, `metadata:${slot}`])];
  if (input.readbackReceipts.fly.length !== expectedKinds.length) {
    throw new TypeError("public Fly safe receipts are incomplete");
  }
  const flyReceipts = input.readbackReceipts.fly.map((receipt, index) =>
    validateSafeReceipt(receipt, expectedKinds[index],
      `backend Fly receipt ${index}`));
  const releaseIdentitySubject = {
    app: fly.app,
    appStatus: fly.appStatus,
    releaseIdDigest: fly.releaseIdDigest,
    releaseVersionDigest: fly.releaseVersionDigest,
    imageTag: fly.imageTag,
    imageIdentityDigest: fly.imageIdentityDigest,
    machines,
  };
  if (fly.releaseIdentityDigest !== framedSha256(
    FLY_RELEASE_IDENTITY_DOMAIN,
    releaseIdentitySubject,
  )) throw new TypeError("public Fly release identity digest differs");
  const normalizedFlyResponses = [
    {
      releaseIdDigest: fly.releaseIdDigest,
      releaseVersionDigest: fly.releaseVersionDigest,
      status: "complete",
      stable: true,
      imageTag: fly.imageTag,
      imageIdentityDigest: fly.imageIdentityDigest,
    },
    { app: fly.app, appStatus: fly.appStatus },
    {
      machines: machines.map(({ slot, machineIdentityDigest }) => ({
        slot,
        machineIdentityDigest,
      })),
    },
    ...machines.flatMap((machine) => [{
      ...machine,
      imageTag: fly.imageTag,
      imageIdentityDigest: fly.imageIdentityDigest,
    }, {
      slot: machine.slot,
      machineIdentityDigest: machine.machineIdentityDigest,
      releaseIdDigest: fly.releaseIdDigest,
      releaseVersionDigest: fly.releaseVersionDigest,
    }]),
  ];
  for (const [index, receipt] of flyReceipts.entries()) {
    const expectedDigest = framedSha256(BACKEND_SAFE_RESPONSE_DOMAIN, {
      kind: expectedKinds[index],
      result: normalizedFlyResponses[index],
    });
    if (receipt.normalizedResponseSha256 !== expectedDigest) {
      throw new TypeError(`backend Fly receipt ${index} normalized response differs`);
    }
  }
  if (fly.safeReadbacksDigest !== framedSha256(
    FLY_SAFE_READBACKS_DOMAIN,
    flyReceipts,
  )) throw new TypeError("public Fly safe receipt digest differs");
  if (input.readbackReceipts.digest !== framedSha256(
    BACKEND_SAFE_RECEIPTS_DOMAIN,
    [readinessReceipt, ...flyReceipts],
  )) throw new TypeError("backend safe receipt aggregate digest differs");
  if (fly.authorizationDigest !== framedSha256(
    FLY_CONTROL_PLANE_SCHEMA,
    {
      backendPromotionInputDigest: input.backendPromotionInputDigest,
      safeReadbacksDigest: fly.safeReadbacksDigest,
      runtimeReadinessNormalizedResponseSha256: readinessReceipt.normalizedResponseSha256,
      releaseIdentityDigest: fly.releaseIdentityDigest,
    },
  )) throw new TypeError("public Fly authorization digest differs");
  if (input.backendPromotionInputDigest
    !== computeRobinhoodBackendPromotionSemanticDigest(input)) {
    throw new TypeError("backend promotion semantic digest differs");
  }
  const binding = stageBundle.artifacts.cliReleaseBinding.value;
  const evidence = {
    schemaVersion: ROBINHOOD_BACKEND_EVIDENCE_SCHEMA,
    repository: BACKEND_REPOSITORY,
    sourceCommit: input.backendSource.sourceCommit,
    sourceTree: input.backendSource.sourceTree,
    chainDeploymentDescriptorDigest:
      stageBundle.finalizedBindings.chainDeploymentDescriptorDigest,
    backendPromotionInputDigest: input.backendPromotionInputDigest,
    apiContract: structuredClone(releaseIdentity.apiContract),
    migration: structuredClone(releaseIdentity.migration),
    openApiSha256: releaseIdentity.openApiSha256,
    profileDigest: binding.releaseIdentity.profile.profileDigest,
    admissionPolicyDigest: binding.releaseIdentity.profile.admissionPolicyDigest,
    finalityPolicyDigest: releaseIdentity.finalityPolicy.policyDigest,
    runtimeReadiness: {
      schemaVersion: input.runtimeReadiness.schemaVersion,
      path: input.runtimeReadiness.path,
      httpStatus: readinessReceipt.httpStatus,
      contentType: readinessReceipt.contentType,
      normalizedResponseSha256: readinessReceipt.normalizedResponseSha256,
      releaseIdentityDigest: input.runtimeReadiness.releaseIdentityDigest,
      observedAt: input.runtimeReadiness.observedAt,
      authorizationDigest: input.runtimeReadiness.authorizationDigest,
    },
    flyControlPlane: {
      schemaVersion: fly.schemaVersion,
      app: fly.app,
      appStatus: fly.appStatus,
      releaseIdDigest: fly.releaseIdDigest,
      releaseVersionDigest: fly.releaseVersionDigest,
      imageTag: fly.imageTag,
      imageIdentityDigest: fly.imageIdentityDigest,
      machines,
      safeReadbacksDigest: fly.safeReadbacksDigest,
      releaseIdentityDigest: fly.releaseIdentityDigest,
      observedAt: fly.observedAt,
      authorizationDigest: fly.authorizationDigest,
    },
    backendReleaseEvidenceDigest: null,
  };
  evidence.backendReleaseEvidenceDigest = computeV4BackendReleaseEvidenceDigest(evidence);
  const serializedInput = JSON.stringify(input);
  if (/"(?:bodyBytesBase64|sanitizedBytesBase64|private_ip|instance_id|config|env|requestId|date|byteLength|responseByteLength|responseBodyByteLength|releaseId|releaseVersion|imageDigest)"\s*:/u
    .test(serializedInput)) {
    throw new TypeError("backend promotion public input contains private raw fields");
  }
  return Object.freeze({
    input: Object.freeze(structuredClone(input)),
    releaseIdentity: Object.freeze(releaseIdentity),
    backendReleaseEvidence: Object.freeze(evidence),
  });
}

function computeRobinhoodBackendAuthorizationDigest(value) {
  return framedSha256(
    ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "authorizationDigest")),
  );
}

function buildRobinhoodBackendCaptureAuthorization(value) {
  const result = { ...structuredClone(value), verificationDigest: null };
  result.verificationDigest = framedSha256(
    ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
    result,
  );
  return Object.freeze(result);
}

function validateRobinhoodBackendCaptureAuthorization({
  authorization,
  inputBytes,
  attestationBundleBytes,
  input,
  allowTestOnly = false,
}) {
  assertJsonBytesMatch(
    input,
    inputBytes,
    "backend promotion public input",
    BACKEND_PUBLIC_INPUT_BYTES,
  );
  assertExactKeys(authorization, [
    "schemaVersion", "trustClass", "subjectPath", "subjectSha256",
    "attestationBundlePath", "attestationBundleSha256",
    "bundleMediaType", "verifier",
    "certificateIdentity", "certificateOidcIssuer",
    "certificateGithubWorkflowName", "certificateGithubWorkflowRepository",
    "certificateGithubWorkflowRef", "certificateGithubWorkflowSha",
    "certificateGithubWorkflowTrigger",
    "repository", "repositoryId",
    "workflow", "sourceRef", "sourceRevision", "sourceTree", "verifiedAt",
    "verificationDigest",
  ], "backend capture authorization");
  assertExactKeys(authorization.verifier, [
    "name", "version", "sha256",
  ], "backend capture Cosign verifier");
  if (!Buffer.isBuffer(attestationBundleBytes) || attestationBundleBytes.byteLength < 1
    || attestationBundleBytes.byteLength > 16 * 1024 * 1024) {
    throw new TypeError("backend capture trust sidecar is empty or oversized");
  }
  const productionTrust = authorization.trustClass
    === ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS;
  const trustAllowed = productionTrust
    || (allowTestOnly && authorization.trustClass === "test-only");
  if (productionTrust) {
    validateSigstoreMessageBundleV03({
      bundleBytes: attestationBundleBytes,
      subjectBytes: inputBytes,
    });
  }
  if (authorization.schemaVersion !== ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA
    || !trustAllowed
    || authorization.subjectPath !== ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH
    || authorization.subjectSha256 !== sha256Digest(inputBytes)
    || authorization.attestationBundlePath !== ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH
    || authorization.attestationBundleSha256 !== sha256Digest(attestationBundleBytes)
    || authorization.bundleMediaType !== SIGSTORE_BUNDLE_V03_MEDIA_TYPE
    || authorization.verifier.name !== "cosign"
    || authorization.verifier.version !== ROBINHOOD_BACKEND_COSIGN_VERSION
    || authorization.verifier.sha256 !== ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256
    || authorization.certificateIdentity
      !== ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY
    || authorization.certificateOidcIssuer
      !== ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER
    || authorization.certificateGithubWorkflowName
      !== ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME
    || authorization.certificateGithubWorkflowRepository !== BACKEND_REPOSITORY
    || authorization.certificateGithubWorkflowRef
      !== ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF
    || authorization.certificateGithubWorkflowSha !== resolveCaptureWorkflowCommit(input.backendSource.sourceCommit)
    || authorization.certificateGithubWorkflowTrigger
      !== ROBINHOOD_BACKEND_CAPTURE_TRIGGER
    || authorization.repository !== BACKEND_REPOSITORY
    || authorization.repositoryId !== BACKEND_REPOSITORY_ID
    || authorization.workflow !== ROBINHOOD_BACKEND_CAPTURE_WORKFLOW
    || authorization.sourceRef !== ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF
    || authorization.sourceRevision !== input.backendSource.sourceCommit
    || authorization.sourceTree !== input.backendSource.sourceTree) {
    throw new TypeError("backend capture authorization does not bind protected backend source");
  }
  iso(authorization.verifiedAt, "backend capture authorization verifiedAt");
  const verifiedTime = Date.parse(authorization.verifiedAt);
  const observedTime = Date.parse(input.observedAt);
  if (verifiedTime < observedTime
    || verifiedTime - observedTime > MAX_CAPTURE_AUTHORIZATION_DELAY_MS) {
    throw new TypeError("backend capture authorization time is outside the capture window");
  }
  const expected = framedSha256(
    ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
    { ...structuredClone(authorization), verificationDigest: null },
  );
  if (authorization.verificationDigest !== expected) {
    throw new TypeError("backend capture authorization digest differs");
  }
  return Object.freeze(structuredClone(authorization));
}

function buildRobinhoodBackendAuthorization(value) {
  const result = { ...structuredClone(value), authorizationDigest: null };
  result.authorizationDigest = computeRobinhoodBackendAuthorizationDigest(result);
  return Object.freeze(result);
}

function validateRobinhoodBackendAuthorization({
  authorization,
  stageBundle,
  stageBundleBytes,
  backendPromotionInputBytes,
  backendPromotionPublicInput,
  backendReleaseEvidence,
  allowTestOnly = false,
}) {
  assertJsonBytesMatch(stageBundle, stageBundleBytes, "stage bundle", 64 * 1024 * 1024);
  assertJsonBytesMatch(
    backendPromotionPublicInput,
    backendPromotionInputBytes,
    "backend promotion public input",
    BACKEND_PUBLIC_INPUT_BYTES,
  );
  assertExactKeys(authorization, [
    "schemaVersion", "trustClass", "repository", "repositoryId", "workflow", "sourceRef",
    "producerRevision", "producerTree", "stageSourceRevision", "stageSourceTree",
    "stageBundlePath", "stageBundleSha256", "stageBundleDigest",
    "backendPromotionPublicInputPath", "backendPromotionPublicInputSha256",
    "backendPromotionPublicInputDigest", "backendPromotionInputDigest",
    "chainDeploymentDescriptorDigest",
    "backendReleaseEvidenceDigest",
    "runtimeReadinessNormalizedResponseSha256", "flySafeReadbacksDigest", "observedAt",
    "authorizationDigest",
  ], "backend release authorization");
  const source = stageBundle.sourceClosure;
  const trustAllowed = authorization.trustClass === "github-artifact-attestation"
    || (allowTestOnly && authorization.trustClass === "test-only");
  if (authorization.schemaVersion !== ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA || !trustAllowed
    || authorization.repository !== PROGRAMMABLE_REPOSITORY
    || authorization.repositoryId !== PROGRAMMABLE_REPOSITORY_ID
    || authorization.workflow !== ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW
    || authorization.sourceRef !== PROGRAMMABLE_PRODUCTION_REF
    || !HEX40.test(authorization.producerRevision)
    || !HEX40.test(authorization.producerTree)
    || authorization.stageSourceRevision !== source.revision
    || authorization.stageSourceTree !== source.tree
    || authorization.stageBundlePath !== ROBINHOOD_STAGE_BUNDLE_PATH
    || authorization.stageBundleSha256 !== sha256Digest(stageBundleBytes)
    || authorization.stageBundleDigest !== stageBundle.stageBundleDigest
    || authorization.backendPromotionPublicInputPath
      !== ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH
    || authorization.backendPromotionPublicInputSha256
      !== sha256Digest(backendPromotionInputBytes)
    || authorization.backendPromotionPublicInputDigest
      !== backendPromotionPublicInput.publicInputDigest
    || authorization.chainDeploymentDescriptorDigest
      !== backendReleaseEvidence.chainDeploymentDescriptorDigest
    || authorization.backendPromotionInputDigest
      !== backendReleaseEvidence.backendPromotionInputDigest
    || authorization.backendReleaseEvidenceDigest
      !== backendReleaseEvidence.backendReleaseEvidenceDigest
    || authorization.runtimeReadinessNormalizedResponseSha256
      !== backendReleaseEvidence.runtimeReadiness.normalizedResponseSha256
    || authorization.flySafeReadbacksDigest
      !== backendReleaseEvidence.flyControlPlane.safeReadbacksDigest) {
    throw new TypeError("backend release authorization does not bind exact production evidence");
  }
  if (authorization.trustClass === "github-artifact-attestation"
    && authorization.producerRevision === authorization.stageSourceRevision) {
    throw new TypeError("backend finalization producer must be distinct from staged source");
  }
  iso(authorization.observedAt, "backend authorization observedAt");
  if (authorization.observedAt !== backendReleaseEvidence.runtimeReadiness.observedAt
    || authorization.observedAt !== backendReleaseEvidence.flyControlPlane.observedAt) {
    throw new TypeError("backend authorization observation differs from raw evidence");
  }
  if (authorization.authorizationDigest !== computeRobinhoodBackendAuthorizationDigest(
    authorization,
  )) throw new TypeError("backend authorization digest differs");
  return Object.freeze(structuredClone(authorization));
}

function readback(kind, hostname, requestPath, authentication, body, index, {
  method = "GET",
  requestBody = null,
} = {}) {
  const requestBodyBytes = requestBody === null
    ? Buffer.alloc(0) : Buffer.from(JSON.stringify(requestBody), "utf8");
  const contentType = method === "POST" ? "application/json" : null;
  const requestBytes = Buffer.from(
    `${method} https://${hostname}${requestPath}\naccept: application/json\n`
      + `content-type: ${contentType ?? "none"}\n`
      + `authentication: ${authentication}\n\n${requestBodyBytes.toString("utf8")}`,
    "utf8",
  );
  const bodyBytes = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  return {
    kind,
    request: {
      method,
      scheme: "https",
      hostname,
      path: requestPath,
      accept: "application/json",
      contentType,
      authentication,
      bodyBytesBase64: requestBodyBytes.toString("base64"),
      bodyByteLength: String(requestBodyBytes.byteLength),
      bodySha256: sha256Digest(requestBodyBytes),
      sanitizedBytesBase64: requestBytes.toString("base64"),
      byteLength: String(requestBytes.byteLength),
      sha256: sha256Digest(requestBytes),
    },
    response: {
      httpStatus: 200,
      contentType: "application/json; charset=utf-8",
      date: "Sat, 29 Aug 2026 12:00:00 GMT",
      requestId: `fixture-${index}`,
      bodyBytesBase64: bodyBytes.toString("base64"),
      bodyByteLength: String(bodyBytes.byteLength),
      bodySha256: sha256Digest(bodyBytes),
    },
  };
}

function buildRobinhoodBackendPromotionFixture(stageBundle) {
  const binding = stageBundle.artifacts.cliReleaseBinding.value;
  const sourceCommit = "8".repeat(40);
  const sourceTree = "9".repeat(40);
  const imageDigest = `sha256:${"5".repeat(64)}`;
  const imageTag = "main-888888888888";
  const imageRef = `registry.fly.io/${ROBINHOOD_FLY_APP}:${imageTag}`;
  const readiness = {
    schemaVersion: ROBINHOOD_BACKEND_READINESS_SCHEMA,
    status: "ready",
    service: "custom-launch-api-v1",
    sourceCommit,
    sourceTree,
    chainId: CHAIN_ID,
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest:
      stageBundle.finalizedBindings.chainDeploymentDescriptorDigest,
    providerProfileDigest: ROBINHOOD_PROVIDER_PROFILE_SHA256,
    migration: {
      path: BACKEND_MIGRATION_PATH,
      sha256: BACKEND_MIGRATION_SHA256,
    },
    apiContract: {
      path: BACKEND_API_CONTRACT_PATH,
      sha256: BACKEND_API_CONTRACT_SHA256,
    },
    openApiSha256: bindingMachineContract(stageBundle, "openapi").sha256,
    finalityPolicy: structuredClone(binding.releaseIdentity.finalityPolicy),
    uniswapRegistrySnapshot: UNISWAP_REGISTRY,
    policySource: binding.releaseIdentity.policySource,
    profile: {
      structuralProfileId: binding.releaseIdentity.profile.structuralProfileId,
      businessProfileId: binding.releaseIdentity.profile.businessProfileId,
      profileRevision: binding.releaseIdentity.profile.profileRevision,
      profileVersion: binding.releaseIdentity.profile.profileVersion,
      profileDigest: binding.releaseIdentity.profile.profileDigest,
      providerProfileDigest: ROBINHOOD_PROVIDER_PROFILE_SHA256,
    },
    providerQuorums: {
      robinhood: [
        { providerId: "drpc", trustDomain: "drpc.org" },
        { providerId: "alchemy", trustDomain: "alchemy.com" },
      ],
      ethereum: [
        { providerId: "drpc", trustDomain: "drpc.org" },
        { providerId: "quicknode", trustDomain: "quicknode.com" },
      ],
    },
    composition: Object.fromEntries(COMPOSITION_KEYS.map((key) => [key, true])),
  };
  return buildRobinhoodBackendPromotionInput({
    schemaVersion: ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
    captureId: createHash("sha256").update(stageBundle.stageBundleDigest).digest("hex"),
    observedAt: "2026-08-29T12:00:00Z",
    backendSource: { repository: BACKEND_REPOSITORY, sourceCommit, sourceTree },
    readinessReadback: readback(
      "readiness",
      ROBINHOOD_BACKEND_HOSTNAME,
      "/v4/chains/4663/readiness",
      "none",
      readiness,
      0,
    ),
    flyReadbacks: [
      readback("releases", ROBINHOOD_FLY_GRAPHQL_HOSTNAME,
        "/graphql", "fly-api-token-redacted", {
          data: { app: { releasesUnprocessed: {
            totalCount: 1,
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: "cursor-123",
              endCursor: "cursor-123",
            },
            nodes: [{
            id: "release_123",
            version: 123,
            status: "complete",
            stable: false,
            imageRef,
            image: {
              registry: "registry.fly.io",
              repository: ROBINHOOD_FLY_APP,
              tag: imageTag,
              digest: imageDigest,
            },
            createdAt: "2026-08-29T11:59:00Z",
          }],
          } } },
        }, 1, { method: "POST", requestBody: {
          query: FLY_RELEASES_QUERY,
          variables: { appName: ROBINHOOD_FLY_APP, first: FLY_RELEASE_PAGE_SIZE },
        } }),
      readback("app", ROBINHOOD_FLY_MACHINES_HOSTNAME,
        `/v1/apps/${ROBINHOOD_FLY_APP}`, "fly-api-token-redacted",
        { id: ROBINHOOD_FLY_APP, name: ROBINHOOD_FLY_APP, status: "deployed",
          organization: { slug: "programmable" } }, 2),
      readback("machine-list", ROBINHOOD_FLY_MACHINES_HOSTNAME,
        `/v1/apps/${ROBINHOOD_FLY_APP}/machines`, "fly-api-token-redacted",
        [{ id: "abcdef123456", state: "started", region: "fra",
          config: { image: imageRef }, image_ref: {
            registry: "registry.fly.io",
            repository: ROBINHOOD_FLY_APP,
            tag: imageTag,
            digest: imageDigest,
          } }], 3),
      readback("machine:abcdef123456", ROBINHOOD_FLY_MACHINES_HOSTNAME,
        `/v1/apps/${ROBINHOOD_FLY_APP}/machines/abcdef123456`,
        "fly-api-token-redacted", { id: "abcdef123456", state: "started",
          region: "fra", config: { image: imageRef }, image_ref: {
            registry: "registry.fly.io",
            repository: ROBINHOOD_FLY_APP,
            tag: imageTag,
            digest: imageDigest,
          } }, 4),
      readback("metadata:abcdef123456", ROBINHOOD_FLY_MACHINES_HOSTNAME,
        `/v1/apps/${ROBINHOOD_FLY_APP}/machines/abcdef123456/metadata`,
        "fly-api-token-redacted", {
          fly_release_id: "rel_abcdef123456",
          fly_release_version: "123",
        }, 5),
    ],
    backendPromotionInputDigest: null,
  });
}

async function fetchRawReadback({
  kind,
  hostname,
  requestPath,
  authentication,
  token,
  fetchImpl,
  method = "GET",
  requestBody = null,
  maximumResponseBytes,
  responseBudget,
}) {
  const requestBodyBytes = requestBody === null
    ? Buffer.alloc(0) : Buffer.from(JSON.stringify(requestBody), "utf8");
  const headers = { accept: "application/json" };
  if (method === "POST") headers["content-type"] = "application/json";
  if (authentication === "fly-api-token-redacted") {
    headers.authorization = normalizeFlyV1TokenWireV1(token, { requireScheme: true }).header;
  }
  const response = await fetchImpl(`https://${hostname}${requestPath}`, {
    method,
    headers,
    body: requestBody === null ? undefined : requestBodyBytes,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const responseBytes = await readRobinhoodBoundedResponse(response, {
    label: `${kind} fresh response`,
    maximumBytes: maximumResponseBytes,
    budget: responseBudget,
  });
  const contentType = response.headers.get("content-type");
  const date = response.headers.get("date");
  const requestId = response.headers.get("fly-request-id")
    ?? response.headers.get("x-request-id");
  const contentTypeValue = method === "POST" ? "application/json" : null;
  const sanitized = Buffer.from(
    `${method} https://${hostname}${requestPath}\naccept: application/json\n`
      + `content-type: ${contentTypeValue ?? "none"}\n`
      + `authentication: ${authentication}\n\n${requestBodyBytes.toString("utf8")}`,
    "utf8",
  );
  return {
    kind,
    request: {
      method,
      scheme: "https",
      hostname,
      path: requestPath,
      accept: "application/json",
      contentType: contentTypeValue,
      authentication,
      bodyBytesBase64: requestBodyBytes.toString("base64"),
      bodyByteLength: String(requestBodyBytes.byteLength),
      bodySha256: sha256Digest(requestBodyBytes),
      sanitizedBytesBase64: sanitized.toString("base64"),
      byteLength: String(sanitized.byteLength),
      sha256: sha256Digest(sanitized),
    },
    response: {
      httpStatus: response.status,
      contentType,
      date,
      requestId,
      bodyBytesBase64: responseBytes.toString("base64"),
      bodyByteLength: String(responseBytes.byteLength),
      bodySha256: sha256Digest(responseBytes),
    },
  };
}

async function freshVerifyRobinhoodBackendPromotionInput({
  stageBundle,
  capturedInput,
  fetch: fetchImpl = globalThis.fetch,
  flyApiToken = process.env.FLY_API_TOKEN,
  now = () => new Date(),
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fresh backend fetch is unavailable");
  const flyAuthorization = normalizeFlyV1Authorization(flyApiToken).header;
  const captured = validateRobinhoodBackendPromotionPublicInput({
    input: capturedInput,
    stageBundle,
    now: () => new Date(capturedInput.observedAt),
  });
  const responseBudget = createRobinhoodResponseBudget(BACKEND_FRESH_AGGREGATE_BYTES);
  const readinessReadback = await fetchRawReadback({
    kind: "readiness",
    hostname: ROBINHOOD_BACKEND_HOSTNAME,
    requestPath: "/v4/chains/4663/readiness",
    authentication: "none",
    token: null,
    fetchImpl,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES.readiness,
    responseBudget,
  });
  const releaseInventory = await readCompleteFlyReleasesV1({
    firstRequest: { query: FLY_RELEASES_QUERY, variables: { appName: ROBINHOOD_FLY_APP, first: FLY_RELEASE_PAGE_SIZE } },
    read: async (requestBody, kind) => {
      const readback = await fetchRawReadback({
        kind,
        hostname: ROBINHOOD_FLY_GRAPHQL_HOSTNAME,
        requestPath: "/graphql",
        authentication: "fly-api-token-redacted",
        token: flyAuthorization,
        fetchImpl,
        method: "POST",
        requestBody,
        maximumResponseBytes: BACKEND_RESPONSE_BYTES.releases,
        responseBudget,
      });
      return { readback, value: parseBody(readback.response.bodyBytesBase64,
        "fresh Fly release page", BACKEND_RESPONSE_BYTES.releases).value };
    },
  });
  const appReadback = await fetchRawReadback({
    kind: "app",
    hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
    requestPath: `/v1/apps/${ROBINHOOD_FLY_APP}`,
    authentication: "fly-api-token-redacted",
    token: flyAuthorization,
    fetchImpl,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES.app,
    responseBudget,
  });
  const listReadback = await fetchRawReadback({
    kind: "machine-list",
    hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
    requestPath: `/v1/apps/${ROBINHOOD_FLY_APP}/machines`,
    authentication: "fly-api-token-redacted",
    token: flyAuthorization,
    fetchImpl,
    maximumResponseBytes: BACKEND_RESPONSE_BYTES["machine-list"],
    responseBudget,
  });
  const listValue = parseBody(
    listReadback.response.bodyBytesBase64,
    "fresh Fly machine list",
    BACKEND_RESPONSE_BYTES["machine-list"],
  ).value;
  const listed = listValue;
  if (!Array.isArray(listed)) throw new TypeError("fresh Fly machine list is invalid");
  const machineIds = listed.map(({ id } = {}) => id).sort();
  if (machineIds.length < 1 || machineIds.length > 8
    || machineIds.some((id) => typeof id !== "string" || !/^[a-z0-9]{6,64}$/u.test(id))
    || new Set(machineIds).size !== machineIds.length) {
    throw new TypeError("fresh Fly machine inventory is invalid");
  }
  const perMachine = [];
  for (const [index, machineId] of machineIds.entries()) {
    perMachine.push(await fetchRawReadback({
      kind: `machine:${machineId}`,
      hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
      requestPath: `/v1/apps/${ROBINHOOD_FLY_APP}/machines/${machineId}`,
      authentication: "fly-api-token-redacted",
      token: flyAuthorization,
      fetchImpl,
      maximumResponseBytes: BACKEND_RESPONSE_BYTES.machine,
      responseBudget,
    }));
    perMachine.push(await fetchRawReadback({
      kind: `metadata:${machineId}`,
      hostname: ROBINHOOD_FLY_MACHINES_HOSTNAME,
      requestPath: `/v1/apps/${ROBINHOOD_FLY_APP}/machines/${machineId}/metadata`,
      authentication: "fly-api-token-redacted",
      token: flyAuthorization,
      fetchImpl,
      maximumResponseBytes: BACKEND_RESPONSE_BYTES.metadata,
      responseBudget,
    }));
    if (perMachine.length !== (index + 1) * 2) {
      throw new TypeError("fresh Fly machine inventory ordering differs");
    }
  }
  const observedAt = canonicalRobinhoodFreshObservedAt(now);
  const backendInputObservedAt = observedAt.replace(".000Z", "Z");
  const freshInput = buildRobinhoodBackendPromotionInput({
    schemaVersion: ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
    captureId: createHash("sha256")
      .update(`${capturedInput.captureId}\0${observedAt}`, "utf8").digest("hex"),
    observedAt: backendInputObservedAt,
    backendSource: structuredClone(capturedInput.backendSource),
    readinessReadback,
    flyReadbacks: [...releaseInventory.observations.map(entry => entry.readback),
      appReadback, listReadback, ...perMachine],
    backendPromotionInputDigest: null,
  });
  const fresh = validateRobinhoodBackendPromotionInput({
    input: freshInput,
    stageBundle,
    now,
  });
  const stableCaptured = {
    backendSource: captured.input.backendSource,
    releaseIdentity: captured.releaseIdentity,
    flyControlPlane: {
      app: captured.backendReleaseEvidence.flyControlPlane.app,
      appStatus: captured.backendReleaseEvidence.flyControlPlane.appStatus,
      releaseIdDigest: captured.backendReleaseEvidence.flyControlPlane.releaseIdDigest,
      releaseVersionDigest: captured.backendReleaseEvidence.flyControlPlane.releaseVersionDigest,
      imageTag: captured.backendReleaseEvidence.flyControlPlane.imageTag,
      imageIdentityDigest: captured.backendReleaseEvidence.flyControlPlane.imageIdentityDigest,
      machines: captured.backendReleaseEvidence.flyControlPlane.machines,
      releaseIdentityDigest:
        captured.backendReleaseEvidence.flyControlPlane.releaseIdentityDigest,
    },
  };
  const stableFresh = {
    backendSource: fresh.input.backendSource,
    releaseIdentity: fresh.releaseIdentity,
    flyControlPlane: {
      app: fresh.backendReleaseEvidence.flyControlPlane.app,
      appStatus: fresh.backendReleaseEvidence.flyControlPlane.appStatus,
      releaseIdDigest: fresh.backendReleaseEvidence.flyControlPlane.releaseIdDigest,
      releaseVersionDigest: fresh.backendReleaseEvidence.flyControlPlane.releaseVersionDigest,
      imageTag: fresh.backendReleaseEvidence.flyControlPlane.imageTag,
      imageIdentityDigest: fresh.backendReleaseEvidence.flyControlPlane.imageIdentityDigest,
      machines: fresh.backendReleaseEvidence.flyControlPlane.machines,
      releaseIdentityDigest: fresh.backendReleaseEvidence.flyControlPlane.releaseIdentityDigest,
    },
  };
  if (canonicalizeJson(stableCaptured) !== canonicalizeJson(stableFresh)) {
    throw new TypeError("fresh backend/Fly readback differs from the authorized capture");
  }
  return Object.freeze({
    observedAt,
    backendPromotionInputDigest: fresh.backendPromotionInputDigest,
    freshBackendReadbackDigest: framedSha256(
      "programmable.robinhood-custom-launch.fresh-backend-readback.v1",
      { observedAt, ...stableFresh },
    ),
  });
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== "fixture" || rest.length !== 4 || rest[0] !== "--stage"
    || rest[2] !== "--output") {
    throw new TypeError("Usage: robinhood-backend-promotion-v1.mjs fixture --stage PATH --output PATH");
  }
  const stage = parseStrictJson(decodeExactUtf8(await readFile(path.resolve(rest[1])),
    "stage bundle"), { maximumBytes: 256 * 1024 * 1024, maximumDepth: 512 });
  const fixture = buildRobinhoodBackendPromotionFixture(stage);
  const bytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  await atomicCreate(path.resolve(rest[3]), bytes, 0o600);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(rest[3]),
    sha256: sha256Digest(bytes), backendPromotionInputDigest:
      fixture.backendPromotionInputDigest })}\n`);
}

const ROBINHOOD_BACKEND_DIGEST_DOMAINS = Object.freeze({
  promotionInput: ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
  captureAuthorization: ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
  authorization: ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
  readinessIdentity: ROBINHOOD_BACKEND_READINESS_SCHEMA,
  runtimeReadinessReceipt:
    "programmable.custom-launch-api-runtime-readiness-receipt.v4",
  safeReadbackReceipts: BACKEND_SAFE_RECEIPTS_DOMAIN,
  safeNormalizedResponse: BACKEND_SAFE_RESPONSE_DOMAIN,
  flySafeReadbacks: FLY_SAFE_READBACKS_DOMAIN,
  flyReleaseId: FLY_RELEASE_ID_DOMAIN,
  flyReleaseVersion: FLY_RELEASE_VERSION_DOMAIN,
  flyMachineId: FLY_MACHINE_ID_DOMAIN,
  flyImageIdentity: FLY_IMAGE_IDENTITY_DOMAIN,
  flyReleaseIdentity: FLY_RELEASE_IDENTITY_DOMAIN,
  flyControlPlaneReceipt: FLY_CONTROL_PLANE_SCHEMA,
  freshBackendReadback:
    "programmable.robinhood-custom-launch.fresh-backend-readback.v1",
});

return Object.freeze({
  ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA,
  ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
  ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
  ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
  ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
  ROBINHOOD_BACKEND_COSIGN_VERSION,
  ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
  SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
  ROBINHOOD_BACKEND_READINESS_SCHEMA,
  ROBINHOOD_BACKEND_EVIDENCE_SCHEMA,
  ROBINHOOD_BACKEND_HOSTNAME,
  ROBINHOOD_FLY_MACHINES_HOSTNAME,
  ROBINHOOD_FLY_GRAPHQL_HOSTNAME,
  ROBINHOOD_FLY_APP,
  ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_STAGE_BUNDLE_PATH,
  ROBINHOOD_BACKEND_PRIVATE_ARTIFACT_BYTES,
  validateSigstoreMessageBundleV03,
  buildRobinhoodBackendCosignVerifyBlobArgs,
  resolveCaptureWorkflowCommit,
  computeRobinhoodBackendPromotionInputDigest,
  buildRobinhoodBackendPromotionInput,
  validateRobinhoodBackendPromotionInput,
  computeRobinhoodBackendPromotionPublicInputDigest,
  computeRobinhoodBackendPromotionSemanticDigest,
  buildRobinhoodBackendPromotionPublicInput,
  buildRobinhoodBackendPromotionPublicInputFromPrivate,
  buildRobinhoodBackendPromotionPublicFixture,
  validateRobinhoodBackendPromotionPublicInput,
  computeRobinhoodBackendAuthorizationDigest,
  buildRobinhoodBackendCaptureAuthorization,
  validateRobinhoodBackendCaptureAuthorization,
  buildRobinhoodBackendAuthorization,
  validateRobinhoodBackendAuthorization,
  buildRobinhoodBackendPromotionFixture,
  freshVerifyRobinhoodBackendPromotionInput,
  ROBINHOOD_BACKEND_DIGEST_DOMAINS,
  main,
});
}

export const {
  ROBINHOOD_BACKEND_PROMOTION_INPUT_SCHEMA,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_SCHEMA,
  ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
  ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
  ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
  ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
  ROBINHOOD_BACKEND_COSIGN_VERSION,
  ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
  SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
  ROBINHOOD_BACKEND_READINESS_SCHEMA,
  ROBINHOOD_BACKEND_EVIDENCE_SCHEMA,
  ROBINHOOD_BACKEND_HOSTNAME,
  ROBINHOOD_FLY_MACHINES_HOSTNAME,
  ROBINHOOD_FLY_GRAPHQL_HOSTNAME,
  ROBINHOOD_FLY_APP,
  ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_STAGE_BUNDLE_PATH,
  ROBINHOOD_BACKEND_PRIVATE_ARTIFACT_BYTES,
  validateSigstoreMessageBundleV03,
  buildRobinhoodBackendCosignVerifyBlobArgs,
  resolveCaptureWorkflowCommit,
  computeRobinhoodBackendPromotionInputDigest,
  buildRobinhoodBackendPromotionInput,
  validateRobinhoodBackendPromotionInput,
  computeRobinhoodBackendPromotionPublicInputDigest,
  computeRobinhoodBackendPromotionSemanticDigest,
  buildRobinhoodBackendPromotionPublicInput,
  buildRobinhoodBackendPromotionPublicInputFromPrivate,
  buildRobinhoodBackendPromotionPublicFixture,
  validateRobinhoodBackendPromotionPublicInput,
  computeRobinhoodBackendAuthorizationDigest,
  buildRobinhoodBackendCaptureAuthorization,
  validateRobinhoodBackendCaptureAuthorization,
  buildRobinhoodBackendAuthorization,
  validateRobinhoodBackendAuthorization,
  buildRobinhoodBackendPromotionFixture,
  freshVerifyRobinhoodBackendPromotionInput,
  ROBINHOOD_BACKEND_DIGEST_DOMAINS,
} = createRobinhoodBackendPromotionTools();

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    await createRobinhoodBackendPromotionTools().main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
