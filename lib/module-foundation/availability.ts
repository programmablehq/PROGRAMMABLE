import { getAddress, type Hex } from "viem";
import type { FoundationDeploymentBinding } from "./client";
import { bindFoundationCatalogV1, FOUNDATION_CATALOG_SCHEMA_V1, type FoundationCatalogAuthorityV1, type FoundationCatalogDocumentV1 } from "./catalog";

export const FOUNDATION_AVAILABILITY_SCHEMA = "programmable.module-foundation.availability.v1";
export interface FoundationAvailabilityEnvelope {
  schemaVersion: typeof FOUNDATION_AVAILABILITY_SCHEMA;
  available: boolean;
  reason: string | null;
  binding: FoundationDeploymentBinding | null;
  catalog: { document: FoundationCatalogDocumentV1; authority: FoundationCatalogAuthorityV1 };
}
export function unavailableFoundation(): FoundationAvailabilityEnvelope {
  return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: false,
    reason: "Launching is temporarily unavailable while this release is being verified. Your coin details stay here.", binding: null,
    catalog: { document: { schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [] }, authority: { admissions: [], releases: [] } } };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid foundation response.");
  return value as Record<string, unknown>;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value) || BigInt(value) === 0n) throw new Error("Invalid release evidence.");
  return value as Hex;
}
function pin(value: unknown) {
  const item = record(value);
  if (typeof item.address !== "string" || BigInt(item.address) === 0n) throw new Error("Invalid deployment address.");
  return { address: getAddress(item.address), runtimeCodeHash: hash(item.runtimeCodeHash) };
}
/** Parse only the trusted same-origin response; this is not an independent acceptance decision. */
export function parseFoundationAvailability(value: unknown, now = Date.now()): FoundationAvailabilityEnvelope {
  const r = record(value);
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA) throw new Error("The release response is unsupported.");
  if (r.available !== true) return unavailableFoundation();
  const b = record(r.binding), evidence = record(r.evidence);
  if (typeof b.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(b.sourceCommit)
    || typeof b.startBlock !== "string" || !/^[1-9][0-9]{0,19}$/.test(b.startBlock)
    || typeof evidence.checkedAt !== "string" || !Number.isFinite(Date.parse(evidence.checkedAt))
    || Math.abs(now - Date.parse(evidence.checkedAt)) > 120_000
    || evidence.sourcePath !== "/v1/modules/foundation/source") throw new Error("Current verified release evidence is unavailable.");
  for (const field of ["artifactDigest", "decisionDigest", "sourceManifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "finalityEvidenceDigest", "blockHash"]) hash(evidence[field]);
  const binding: FoundationDeploymentBinding = { releaseDigest: hash(b.releaseDigest), sourceCommit: b.sourceCommit,
    startBlock: BigInt(b.startBlock), factory: pin(b.factory), hookDeployer: pin(b.hookDeployer) };
  if (binding.factory.address === binding.hookDeployer.address) throw new Error("The deployment roles overlap.");
  const catalog = r.catalog === undefined ? unavailableFoundation().catalog : record(r.catalog);
  const document = catalog.document as FoundationCatalogDocumentV1;
  const authority = catalog.authority as FoundationCatalogAuthorityV1;
  bindFoundationCatalogV1(document, authority);
  return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: true, reason: null, binding, catalog: { document, authority } };
}
export async function fetchFoundationAvailability(signal?: AbortSignal): Promise<FoundationAvailabilityEnvelope> {
  const response = await fetch("/api/module-foundation", { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (response.redirected || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Launch availability could not be checked.");
  const value = await response.json();
  if (!response.ok) return unavailableFoundation();
  return parseFoundationAvailability(value);
}

