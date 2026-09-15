import type { Address, Hex } from "viem";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleHash, moduleInteger, moduleRecord } from "@/lib/module-mode/release";
import {
  bindFoundationModuleManifestV1, foundationDataDigest, foundationRequire, foundationVersionedName,
  hashFoundationModuleManifestV1, readFoundationPackageExtensionV1,
  type FoundationDiagnosticV1, type FoundationModuleManifestV1, type FoundationPackageExtensionV1,
} from "./manifest";

export const FOUNDATION_CATALOG_SCHEMA_V1 = "programmable.module-foundation.catalog.v1" as const;

/** An independently recorded accepted review. Merely copying these fields grants no authority. */
export interface FoundationReviewReferenceV1 {
  submissionId: string; requestDigest: Hex; sourceManifestHash: Hex; manifestHash: Hex;
  artifactDigest: Hex; decisionDigest: Hex; reviewer: Address; reviewerPolicyDigest: Hex;
}
/** Runtime code observed for this exact factory/module pair and separately admitted host release. */
export interface FoundationReleaseReferenceV1 {
  chainId: number; hostAdapterId: string; releaseDigest: Hex; manifestHash: Hex;
  deploymentEvidenceDigest: Hex; runtimeVerificationDigest: Hex;
  factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex;
}
export interface FoundationCatalogEntryV1 {
  manifest: FoundationModuleManifestV1;
  review: FoundationReviewReferenceV1 | null;
  release: FoundationReleaseReferenceV1 | null;
}
export interface FoundationCatalogDocumentV1 {
  schemaVersion: typeof FOUNDATION_CATALOG_SCHEMA_V1; entries: readonly FoundationCatalogEntryV1[];
}
/** Trusted application input, obtained outside the submitted catalog through authenticated review/readback adapters. */
export interface FoundationCatalogAuthorityV1 {
  admissions: readonly FoundationReviewReferenceV1[];
  releases: readonly FoundationReleaseReferenceV1[];
}
export interface BoundFoundationCatalogEntryV1 extends FoundationCatalogEntryV1 {
  manifestHash: Hex; runtime: FoundationPackageExtensionV1;
  status: "available" | "review_pending" | "release_pending" | "authority_unverified";
  diagnostics: readonly FoundationDiagnosticV1[];
}
export interface FoundationCatalogV1 {
  schemaVersion: typeof FOUNDATION_CATALOG_SCHEMA_V1; entries: readonly BoundFoundationCatalogEntryV1[];
}
const boundCatalogs = new WeakSet<object>();
const equal = (a: unknown, b: unknown) => nativeCanonicalJson(a) === nativeCanonicalJson(b);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function bindReview(value: unknown, manifest: FoundationModuleManifestV1, manifestHash: Hex): FoundationReviewReferenceV1 {
  const r = moduleRecord(nativeJson(value), ["submissionId", "requestDigest", "sourceManifestHash", "manifestHash", "artifactDigest", "decisionDigest", "reviewer", "reviewerPolicyDigest"], "foundation.review");
  foundationRequire(typeof r.submissionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.submissionId),
    "FOUNDATION_REVIEW_SUBMISSION", "Review must identify the source submission UUID.");
  for (const field of ["requestDigest", "sourceManifestHash", "manifestHash", "artifactDigest", "decisionDigest", "reviewerPolicyDigest"]) moduleHash(r[field], `foundation.review.${field}`);
  const reviewer = moduleAddress(r.reviewer, "foundation.review.reviewer");
  foundationRequire(reviewer !== manifest.sourceDescriptor.author.toLowerCase(),
    "FOUNDATION_REVIEW_INDEPENDENCE", "The source author cannot supply the independent acceptance decision.");
  foundationRequire(r.requestDigest === manifest.requestDigest && r.manifestHash === manifestHash
    && r.sourceManifestHash === foundationDataDigest("programmable.modules.source-manifest.v1", manifest.sourceDescriptor),
  "FOUNDATION_REVIEW_SOURCE_MISMATCH", "Review must bind the exact source request and Foundation manifest.");
  return r as unknown as FoundationReviewReferenceV1;
}
function bindRelease(value: unknown, runtime: FoundationPackageExtensionV1, manifestHash: Hex): FoundationReleaseReferenceV1 {
  const r = moduleRecord(nativeJson(value), ["chainId", "hostAdapterId", "releaseDigest", "manifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "factory", "factoryCodeHash", "moduleCodeHash", "descriptorHash"], "foundation.release");
  foundationRequire(moduleInteger(r.chainId, "foundation.chainId") > 0, "FOUNDATION_CHAIN_ID", "Release needs an explicit chain ID.");
  foundationVersionedName(r.hostAdapterId, "/release/hostAdapterId");
  moduleAddress(r.factory, "foundation.factory");
  for (const field of ["releaseDigest", "manifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "factoryCodeHash", "moduleCodeHash", "descriptorHash"]) moduleHash(r[field], `foundation.release.${field}`);
  foundationRequire(r.manifestHash === manifestHash && r.hostAdapterId === runtime.hostAdapterId && r.descriptorHash === runtime.descriptorHash,
    "FOUNDATION_RELEASE_BINDING_MISMATCH", "Release must identify this manifest, descriptor and host adapter.");
  return r as unknown as FoundationReleaseReferenceV1;
}

/**
 * Parsing and authority are separate. Omitted authority yields visible but unselectable entries.
 * The two supplied snapshots must come from trusted review and runtime readers, never request JSON.
 */
export function bindFoundationCatalogV1(value: unknown, authority: FoundationCatalogAuthorityV1 = { admissions: [], releases: [] }): FoundationCatalogV1 {
  const raw = moduleRecord(nativeJson(value), ["schemaVersion", "entries"], "foundation.catalog");
  foundationRequire(raw.schemaVersion === FOUNDATION_CATALOG_SCHEMA_V1 && Array.isArray(raw.entries) && raw.entries.length <= 1000,
    "FOUNDATION_CATALOG_SCHEMA", "Catalog requires a supported schema and at most 1000 entries.");
  const trusted = moduleRecord(nativeJson(authority), ["admissions", "releases"], "foundation.authority");
  foundationRequire(Array.isArray(trusted.admissions) && trusted.admissions.length <= 1000 && Array.isArray(trusted.releases) && trusted.releases.length <= 1000,
    "FOUNDATION_AUTHORITY_SNAPSHOT", "Provide bounded independent admission and release snapshots.");
  const admissions = trusted.admissions, releases = trusted.releases;
  const ids = new Set<string>();
  const entries = raw.entries.map((value, index): BoundFoundationCatalogEntryV1 => {
    const entry = moduleRecord(value, ["manifest", "review", "release"], "foundation.catalog.entry");
    const manifest = bindFoundationModuleManifestV1(entry.manifest);
    foundationRequire(!ids.has(manifest.packageId), "FOUNDATION_CATALOG_DUPLICATE", "A catalog may contain each package version once.", `/entries/${index}`);
    ids.add(manifest.packageId);
    const runtime = readFoundationPackageExtensionV1(manifest), manifestHash = hashFoundationModuleManifestV1(manifest);
    const review = entry.review === null ? null : bindReview(entry.review, manifest, manifestHash);
    const release = entry.release === null ? null : bindRelease(entry.release, runtime, manifestHash);
    const diagnostics: FoundationDiagnosticV1[] = [];
    const issue = (code: string, message: string) => diagnostics.push({ code, message, path: `/entries/${index}`, packageId: manifest.packageId });
    let status: BoundFoundationCatalogEntryV1["status"] = "available";
    if (!review) { status = "review_pending"; issue("FOUNDATION_REVIEW_PENDING", "Independent acceptance has not been recorded for this source version."); }
    else if (!admissions.some(item => equal(item, review))) {
      status = "authority_unverified"; issue("FOUNDATION_REVIEW_AUTHORITY_UNVERIFIED", "The supplied review reference has not been confirmed by the trusted admission reader.");
    }
    if (!release) {
      if (status === "available") status = "release_pending";
      issue("FOUNDATION_RELEASE_PENDING", "This module factory and runtime have no verified release binding.");
    } else if (!releases.some(item => equal(item, release))) {
      if (status === "available") status = "authority_unverified";
      issue("FOUNDATION_RUNTIME_AUTHORITY_UNVERIFIED", "The supplied code and deployment references have not been confirmed by the trusted runtime reader.");
    }
    return { manifest, manifestHash, runtime, review, release, status, diagnostics };
  });
  const catalog: FoundationCatalogV1 = freeze({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries });
  boundCatalogs.add(catalog);
  return catalog;
}
export function assertBoundFoundationCatalogV1(value: FoundationCatalogV1): void {
  foundationRequire(value && boundCatalogs.has(value), "FOUNDATION_CATALOG_UNBOUND",
    "Bind the catalog through the trusted application adapter before preparing module transactions.");
}
export function resolveFoundationCatalogEntryV1(catalog: FoundationCatalogV1, packageId: Hex): BoundFoundationCatalogEntryV1 {
  assertBoundFoundationCatalogV1(catalog);
  const id = moduleHash(packageId, "foundation.packageId");
  const entry = catalog.entries.find(item => item.manifest.packageId === id);
  foundationRequire(entry, "FOUNDATION_PACKAGE_UNKNOWN", "The selected package version is not present in this catalog.", "/packageId");
  return entry;
}
