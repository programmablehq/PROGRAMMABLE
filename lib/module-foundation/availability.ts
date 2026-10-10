import { foundationBindingChainId, foundationChainProfile, type FoundationChainId } from "./chains";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { FoundationDeploymentBinding } from "./client";
import { ETHEREUM_MODULE_BINDING, ETHEREUM_MODULE_SOURCE } from "./ethereum-release";
import { foundationFactoryVersion } from "./protocol";
import { bindFoundationCatalogV1, FOUNDATION_CATALOG_SCHEMA_V1, type FoundationCatalogAuthorityV1, type FoundationCatalogDocumentV1 } from "./catalog";

export const FOUNDATION_AVAILABILITY_SCHEMA = "programmable.module-foundation.availability.v1";
export const FOUNDATION_AVAILABILITY_SCHEMA_V2 = "programmable.module-foundation.availability.v2";
export const FOUNDATION_AVAILABILITY_SCHEMA_V3 = "programmable.module-foundation.availability.v3";
export const FOUNDATION_AVAILABILITY_SCHEMA_V4 = "programmable.module-foundation.availability.v4";
export const FOUNDATION_AVAILABILITY_SCHEMA_V5 = "programmable.module-foundation.availability.v5";
export interface FoundationAvailabilityEnvelope {
  chainId?: FoundationChainId;
  schemaVersion: typeof FOUNDATION_AVAILABILITY_SCHEMA | typeof FOUNDATION_AVAILABILITY_SCHEMA_V2 | typeof FOUNDATION_AVAILABILITY_SCHEMA_V3 | typeof FOUNDATION_AVAILABILITY_SCHEMA_V4 | typeof FOUNDATION_AVAILABILITY_SCHEMA_V5;
  available: boolean;
  reason: string | null;
  binding: FoundationDeploymentBinding | null;
  catalog: { document: FoundationCatalogDocumentV1; authority: FoundationCatalogAuthorityV1 };
  /** Present only on a token-specific authority response, normalized to lowercase. */
  token?: Address;
  /** An exact backend provider disagreement is retryable; it never authorizes a launch. */
  providerDisagreement?: boolean;
  /** Token absent from the finalized index; never grants transaction authority. */
  indexPending?: boolean;
  /** Both finalized providers verified that this deployed token has no canonical stamp. */
  stampMissing?: boolean;
}
export class FoundationProviderDisagreementError extends Error {
  constructor() { super("Launch checks are temporarily out of sync."); }
}
export function unavailableFoundation(schemaVersion: FoundationAvailabilityEnvelope["schemaVersion"] = FOUNDATION_AVAILABILITY_SCHEMA, chainId: FoundationChainId = 4663): FoundationAvailabilityEnvelope {
  foundationChainProfile(chainId);
  if (chainId === 1 && schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V4 && schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V5) throw new Error("Ethereum availability requires an explicit chain-bound schema.");
  return { schemaVersion, ...([FOUNDATION_AVAILABILITY_SCHEMA_V4, FOUNDATION_AVAILABILITY_SCHEMA_V5].includes(schemaVersion) ? { chainId } : {}), available: false,
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
  if (r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V5) {
    if (r.chainId !== 1) throw new Error("This graph release belongs only to Ethereum.");
    const token = r.token === undefined ? undefined : tokenAddress(r.token).toLowerCase() as Address;
    if (r.available !== true) return { ...unavailableFoundation(FOUNDATION_AVAILABILITY_SCHEMA_V5, 1), ...(token ? { token } : {}),
      ...(token && r.reason === "MODULE_INDEX_PENDING" ? { indexPending: true, reason: "Waiting for this launch to appear in the index." } : {}),
      ...(token && r.reason === "MODULE_STAMP_MISSING" ? { stampMissing: true,
        reason: "This token has no Programmable launch stamp. Contact the project team." } : {}) };
    const b = record(r.binding), e = record(r.evidence);
    if (e.kind !== "owner-source-runtime-v1" || e.releaseDigest !== ETHEREUM_MODULE_SOURCE.releaseDigest
      || typeof e.checkedAt !== "string" || !Number.isFinite(Date.parse(e.checkedAt))
      || Math.abs(now - Date.parse(e.checkedAt)) > 120_000 || e.providerCount !== 2
      || b.releaseDigest !== ETHEREUM_MODULE_SOURCE.releaseDigest || b.chainId !== 1
      || b.sourceCommit !== ETHEREUM_MODULE_SOURCE.sourceCommit || b.startBlock !== String(ETHEREUM_MODULE_SOURCE.startBlock)
      || b.factoryVersion !== "v3" || b.lpCustodyId !== ETHEREUM_MODULE_BINDING.lpCustodyId) throw new Error("Current Ethereum source evidence is unavailable.");
    hash(e.blockHash);
    const factory = pin(b.factory), hookDeployer = pin(b.hookDeployer);
    if (hookDeployer.address !== ETHEREUM_MODULE_BINDING.hookDeployer.address || hookDeployer.runtimeCodeHash !== ETHEREUM_MODULE_BINDING.hookDeployer.runtimeCodeHash
      || (token ? factory.runtimeCodeHash !== ETHEREUM_MODULE_SOURCE.proxyRuntimeCodeHash
        : factory.address !== ETHEREUM_MODULE_SOURCE.implementation.address || factory.runtimeCodeHash !== ETHEREUM_MODULE_SOURCE.implementation.runtimeCodeHash)) throw new Error("The Ethereum launch source changed.");
    const catalog = record(r.catalog) as unknown as FoundationAvailabilityEnvelope["catalog"];
    bindFoundationCatalogV1(catalog.document, catalog.authority);
    return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V5, chainId: 1, available: true, reason: null,
      binding: { ...ETHEREUM_MODULE_BINDING, factory }, catalog, ...(token ? { token } : {}) };
  }
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA && r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V2 && r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V3 && r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V4) throw new Error("The release response is unsupported.");
  const chainId = r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4 ? foundationChainProfile(Number(r.chainId)).chainId : 4663;
  if (r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4 && r.chainId !== chainId) throw new Error("The release response has no exact network identity.");
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA_V4 && r.chainId !== undefined && r.chainId !== 4663) throw new Error("Legacy source authority belongs only to Robinhood Chain.");
  const token = r.token === undefined ? undefined : tokenAddress(r.token).toLowerCase() as Address;
  if (r.token !== undefined && r.token !== token) throw new Error("The token authority response is not canonical.");
  if (r.available !== true) return { ...unavailableFoundation(r.schemaVersion, chainId), ...(token ? { token } : {}),
    ...(r.reason === "MODULE_INDEX_PROVIDER_DISAGREEMENT" ? { providerDisagreement: true } : {}) };
  const b = record(r.binding), evidence = record(r.evidence);
  if (typeof b.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(b.sourceCommit)
    || typeof b.startBlock !== "string" || !/^[1-9][0-9]{0,19}$/.test(b.startBlock)
    || typeof evidence.checkedAt !== "string" || !Number.isFinite(Date.parse(evidence.checkedAt))
    || Math.abs(now - Date.parse(evidence.checkedAt)) > 120_000
    || evidence.sourcePath !== (r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4
      ? `/v2/modules/foundation/chains/${chainId}/source/release/${hash(b.releaseDigest).toLowerCase()}` : r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA
      ? `/v1/modules/foundation/source/release/${hash(b.releaseDigest).toLowerCase()}` : "/v1/modules/foundation/source")) throw new Error("Current verified release evidence is unavailable.");
  for (const field of ["artifactDigest", "decisionDigest", "sourceManifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "finalityEvidenceDigest", "blockHash"]) hash(evidence[field]);
  if (r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4 && b.chainId !== chainId) throw new Error("The deployment binding belongs to a different network.");
  const pins = { ...(r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4 ? { chainId } : {}), releaseDigest: hash(b.releaseDigest), sourceCommit: b.sourceCommit,
    startBlock: BigInt(b.startBlock), factory: pin(b.factory), hookDeployer: pin(b.hookDeployer) };
  let binding: FoundationDeploymentBinding;
  if (r.schemaVersion !== FOUNDATION_AVAILABILITY_SCHEMA) {
    const factoryVersion = (r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V3 || r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4) ? "v3" : "v2";
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
  return { schemaVersion: r.schemaVersion, ...(r.schemaVersion === FOUNDATION_AVAILABILITY_SCHEMA_V4 ? { chainId } : {}), available: true, reason: null, binding, catalog: { document, authority }, ...(token ? { token } : {}) };
}
export async function fetchFoundationAvailability(signal?: AbortSignal, token?: Address, chainId: FoundationChainId = 4663): Promise<FoundationAvailabilityEnvelope> {
  const profile = foundationChainProfile(chainId);
  const unavailable = () => unavailableFoundation(chainId === 1 ? FOUNDATION_AVAILABILITY_SCHEMA_V4 : FOUNDATION_AVAILABILITY_SCHEMA, chainId);
  const params = new URLSearchParams(); if (chainId !== 4663) params.set("chainId", String(chainId));
  const selected = token === undefined ? undefined : tokenAddress(token);
  if (selected) params.set("token", selected);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const response = await fetch(`/api/module-foundation${params.size ? `?${params}` : ""}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
    if (response.redirected || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Launch availability could not be checked.");
    const value: unknown = await response.json();
    if (!response.ok && (!value || typeof value !== "object" || !("schemaVersion" in value))) return unavailable();
    const envelope = parseFoundationAvailability(value);
    if (foundationBindingChainId(envelope.binding ?? envelope) !== profile.chainId) throw new Error("The source authority belongs to a different network.");
    if (envelope.token !== selected?.toLowerCase()) throw new Error("The release authority belongs to a different token request.");
    if (!response.ok && envelope.available) throw new Error("An unsuccessful response cannot authorize a release.");
    // Robinhood RPCs occasionally disagree at a fresh checkpoint. A new server proof is required on every retry.
    if (attempt === 2 || envelope.available || !value || typeof value !== "object" || !("reason" in value)
      || value.reason !== "MODULE_INDEX_PROVIDER_DISAGREEMENT") return envelope;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 200 * (attempt + 1));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  throw new Error("Launch availability could not be checked.");
}
