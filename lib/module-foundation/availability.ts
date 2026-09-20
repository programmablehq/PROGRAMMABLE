import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { FoundationDeploymentBinding } from "./client";
import { foundationFactoryVersion } from "./protocol";
import { bindFoundationCatalogV1, FOUNDATION_CATALOG_SCHEMA_V1, type FoundationCatalogAuthorityV1, type FoundationCatalogDocumentV1 } from "./catalog";

export const FOUNDATION_AVAILABILITY_SCHEMA = "programmable.module-foundation.availability.v1";
export const FOUNDATION_AVAILABILITY_SCHEMA_V2 = "programmable.module-foundation.availability.v2";
export const FOUNDATION_AVAILABILITY_SCHEMA_V3 = "programmable.module-foundation.availability.v3";
export interface FoundationAvailabilityEnvelope {
  schemaVersion: typeof FOUNDATION_AVAILABILITY_SCHEMA | typeof FOUNDATION_AVAILABILITY_SCHEMA_V2 | typeof FOUNDATION_AVAILABILITY_SCHEMA_V3;
  available: boolean;
  reason: string | null;
  binding: FoundationDeploymentBinding | null;
  catalog: { document: FoundationCatalogDocumentV1; authority: FoundationCatalogAuthorityV1 };
  /** Present only on a token-specific authority response, normalized to lowercase. */
  token?: Address;
}
export function unavailableFoundation(schemaVersion: FoundationAvailabilityEnvelope["schemaVersion"] = FOUNDATION_AVAILABILITY_SCHEMA): FoundationAvailabilityEnvelope {
  return { schemaVersion, available: false,
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
function tokenAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: true }) || BigInt(value) === 0n
    || (value !== value.toLowerCase() && value !== getAddress(value))) throw new Error("A nonzero, correctly checksummed token address is required.");
  return getAddress(value);
}
/** Parse only the trusted same-origin response; this is not an independent acceptance decision. */
export function parseFoundationAvailability(value: unknown, now = Date.now()): FoundationAvailabilityEnvelope {
  const r = record(value);
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA && r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V2 && r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V3) throw new Error("The release response is unsupported.");
  const token = r.token === undefined ? undefined : tokenAddress(r.token).toLowerCase() as Address;
  if (r.token !== undefined && r.token !== token) throw new Error("The token authority response is not canonical.");
  if (r.available !== true) return { ...unavailableFoundation(r.schemaVersion), ...(token ? { token } : {}) };
  const b = record(r.binding), evidence = record(r.evidence);
  if (typeof b.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(b.sourceCommit)
    || typeof b.startBlock !== "string" || !/^[1-9][0-9]{0,19}$/.test(b.startBlock)
    || typeof evidence.checkedAt !== "string" || !Number.isFinite(Date.parse(evidence.checkedAt))
    || Math.abs(now - Date.parse(evidence.checkedAt)) > 120_000
    || evidence.sourcePath !== (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA
      ? `/v1/modules/foundation/source/release/${hash(b.releaseDigest).toLowerCase()}` : "/v1/modules/foundation/source")) throw new Error("Current verified release evidence is unavailable.");
  for (const field of ["artifactDigest", "decisionDigest", "sourceManifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "finalityEvidenceDigest", "blockHash"]) hash(evidence[field]);
  const pins = { releaseDigest: hash(b.releaseDigest), sourceCommit: b.sourceCommit,
    startBlock: BigInt(b.startBlock), factory: pin(b.factory), hookDeployer: pin(b.hookDeployer) };
  let binding: FoundationDeploymentBinding;
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA) {
    const factoryVersion = r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V3 ? "v3" : "v2";
    if (b.factoryVersion !== factoryVersion) throw new Error("The release has no exact factory version.");
    binding = { ...pins, factoryVersion, lpCustodyId: hash(b.lpCustodyId) };
  } else {
    if ((b.factoryVersion !== undefined && b.factoryVersion !== "v1") || b.lpCustodyId !== undefined) throw new Error("A V1 response cannot authorize V2 custody.");
    binding = { ...pins, ...(b.factoryVersion === "v1" ? { factoryVersion: "v1" as const } : {}) };
  }
  foundationFactoryVersion(binding);
  if (binding.factory.address === binding.hookDeployer.address) throw new Error("The deployment roles overlap.");
  const catalog = r.catalog === undefined ? unavailableFoundation().catalog : record(r.catalog);
  const document = catalog.document as FoundationCatalogDocumentV1;
  const authority = catalog.authority as FoundationCatalogAuthorityV1;
  bindFoundationCatalogV1(document, authority);
  return { schemaVersion: r.schemaVersion, available: true, reason: null, binding, catalog: { document, authority }, ...(token ? { token } : {}) };
}
export async function fetchFoundationAvailability(signal?: AbortSignal, token?: Address): Promise<FoundationAvailabilityEnvelope> {
  const selected = token === undefined ? undefined : tokenAddress(token);
  const response = await fetch(`/api/module-foundation${selected ? `?token=${selected}` : ""}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (response.redirected || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Launch availability could not be checked.");
  const value = await response.json();
  if (!response.ok && (!value || typeof value !== "object" || !("schemaVersion" in value))) return unavailableFoundation();
  const envelope = parseFoundationAvailability(value);
  if (envelope.token !== selected?.toLowerCase()) throw new Error("The release authority belongs to a different token request.");
  if (!response.ok && envelope.available) throw new Error("An unsuccessful response cannot authorize a release.");
  return envelope;
}
