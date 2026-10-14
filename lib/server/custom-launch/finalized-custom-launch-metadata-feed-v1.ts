import "server-only";
import { parseEthereumRoutingFeePolicyV1, type EthereumRoutingFeePolicyBindingV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";

import { isIP } from "node:net";

import { getAddress, isAddress } from "viem";

import type {
  CanonicalTokenExploreEntry,
  TokenLink,
} from "../../tokens";
import {
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import { canonicalSha256 } from "../projection-target/hashing";
import {
  LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1,
  parseLaunchPartnerAttributionV1,
  type LaunchPartnerAttributionV1,
} from "../../launch-partner-attribution";
import {
  parseFinalizedTradeAdapterDescriptorV1,
  type FinalizedTradeAdapterDescriptorV1,
} from "./finalized-trade-adapter-descriptor-v1";

export const FINALIZED_CUSTOM_LAUNCH_METADATA_FEED_URL =
  "https://api.programmable.market/v3/finalized-custom-launches" as const;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1 =
  "programmable.finalized-custom-launch-metadata-list.v1" as const;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_SCHEMA_V1 =
  "programmable.finalized-custom-launch-metadata.v1" as const;
export const ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1 =
  "programmable.router-custom-metadata-overlay.v1" as const;
export const ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1 =
  "programmable-finalized-custom-launch-metadata-feed" as const;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_CACHE_TTL_MS = 15_000;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_LKG_TTL_MS = 300_000;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_TIMEOUT_MS = 1_500;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT = 25;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGES = 400;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_RECORDS = 10_000;
export const FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGE_BYTES =
  4 * 1_024 * 1_024;

const PROJECT_METADATA_SCHEMA_V1 =
  "programmable.project-metadata.v1" as const;
const PROJECT_METADATA_GRAPH_BINDING_DOMAIN_V1 =
  "programmable.custom-graph-project-metadata.v1" as const;
const PROJECT_TOKEN_METADATA_BINDING_SCHEMA_V1 =
  "programmable.project-token-metadata-binding.v1" as const;
const LAUNCH_PRESENTATION_DRAFT_SCHEMA_V1 =
  "programmable.launch-presentation-draft.v1" as const;
const FINALIZED_CHECKPOINT_SCHEMA_V1 =
  "programmable.ethereum-finalized-checkpoint-quorum.v1" as const;
const EXPECTED_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=300";
const MAXIMUM_FUTURE_SKEW_MS = 60_000;
const MAXIMUM_GENERATED_AGE_MS = 300_000;
const URI_MAXIMUM_BYTES = 2_048;
const DESCRIPTION_MAXIMUM_BYTES = 4_096;
const IMAGE_MAXIMUM_BYTES = 20 * 1_024 * 1_024;
const IMAGE_MAXIMUM_DIMENSION = 8_192;
const LINK_MAXIMUM_COUNT = 32;
const TRUSTED_IPFS_PROJECT_IMAGE_GATEWAY_V1 =
  "https://ipfs.io/ipfs/" as const;
const TRUSTED_ARWEAVE_PROJECT_IMAGE_GATEWAY_V1 =
  "https://arweave.net/" as const;
const LOWER_BYTES32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR = /^[A-Za-z0-9_-]{16,512}$/u;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][a-zA-Z2-7]{31,127})$/u;
const ARWEAVE_TRANSACTION_ID = /^[A-Za-z0-9_-]{43}$/u;
const DISALLOWED_TOKEN_TEXT = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const DISALLOWED_DESCRIPTION_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const UNSAFE_READBACK_TEXT = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const SENSITIVE_QUERY_KEY = /(?:api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|password|secret|signature|sig)/iu;
const SECRET_PATTERNS = Object.freeze([
  /PROGRAMMABLE_API_KEY\s*=/iu,
  /(?:^|[^A-Za-z0-9_-])pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u,
  /\b(?:sk|rk|pk)-(?:live|test)?[_-]?[A-Za-z0-9_-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|authorization|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/iu,
] as const);

type Sha256Digest = `sha256:${string}`;
type Hex32 = `0x${string}`;
type Address = `0x${string}`;
type LaunchProfileVersionV1 =
  | "2.0.0"
  | "3.0.0"
  | "3.1.0"
  | "3.2.0"
  | "3.3.0"
  | "3.4.0"
  | "3.5.0"
  | "3.6.0";

type LaunchPresentationLinkKindV1 =
  | "website"
  | "documentation"
  | "x"
  | "telegram"
  | "discord"
  | "github"
  | "other";

type LaunchPresentationDraftV1 = Readonly<{
  schemaVersion: typeof LAUNCH_PRESENTATION_DRAFT_SCHEMA_V1;
  description: string;
  image: Readonly<{
    uri: string;
    contentSha256: Sha256Digest;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    byteLength: number;
    width: number;
    height: number;
  }> | null;
  links: readonly Readonly<{
    kind: LaunchPresentationLinkKindV1;
    uri: string;
  }>[];
}>;

type ProjectMetadataV1 = Readonly<{
  schemaVersion: typeof PROJECT_METADATA_SCHEMA_V1;
  token: Readonly<{ name: string; symbol: string }>;
  presentation: LaunchPresentationDraftV1;
  tokenMetadataBinding: Readonly<{
    schemaVersion: typeof PROJECT_TOKEN_METADATA_BINDING_SCHEMA_V1;
    tokenTargetId: string;
    declarationBinding: "request-and-launch-id";
    standardReadModel: Readonly<{ name: boolean; symbol: boolean }>;
    name: ProjectTokenMetadataFieldBindingV1;
    symbol: ProjectTokenMetadataFieldBindingV1;
    postDeploymentReadback: "required";
  }>;
}>;

type ProjectTokenMetadataFieldBindingV1 = Readonly<{
  staticSource:
    | "constructor-argument"
    | "initializer-argument"
    | "not-deterministically-extractable";
  argumentIndex: number | null;
  argumentName: string | null;
}>;

type FinalizedCheckpointV1 = Readonly<{
  schemaVersion: typeof FINALIZED_CHECKPOINT_SCHEMA_V1;
  blockNumber: string;
  blockHash: Hex32;
  quorumSize: 2;
  observations: readonly [
    FinalizedCheckpointObservationV1,
    FinalizedCheckpointObservationV1,
  ];
}>;

type FinalizedCheckpointObservationV1 = Readonly<{
  provider: "primary" | "secondary";
  finalizedBlockNumber: string;
  finalizedBlockHash: Hex32;
  commonBlockHash: Hex32;
}>;

export type FinalizedCustomLaunchMetadataV1 = Readonly<{
  schemaVersion: typeof FINALIZED_CUSTOM_LAUNCH_METADATA_SCHEMA_V1;
  resourceId: string;
  routerLaunchId: Hex32;
  launchProfileVersion: LaunchProfileVersionV1;
  routingFeePolicy?: EthereumRoutingFeePolicyBindingV1;
  chainId: "1";
  router: Address;
  token: Address;
  hook: Address;
  poolManager: Address;
  poolId: Hex32;
  projectMetadata: ProjectMetadataV1 | null;
  projectMetadataHash: Sha256Digest | null;
  partnerAttribution?: LaunchPartnerAttributionV1;
  tradeAdapterDescriptor?: FinalizedTradeAdapterDescriptorV1;
  bindings: Readonly<{
    requestHash: Sha256Digest;
    launchIntentHash: Sha256Digest;
    graphBundleHash: Sha256Digest;
    unboundGraphBundleHash: Sha256Digest;
    artifactHash: Sha256Digest;
  }>;
  tokenMetadataReadback: Readonly<{
    status: "matching" | "mismatch" | "unavailable";
    declared: Readonly<{ name: string; symbol: string }>;
    observed: Readonly<{
      name: string | null;
      symbol: string | null;
    }>;
    observedAtBlockNumber: string | null;
    observedAt: string | null;
  }>;
  finality: Readonly<{
    state: "finalized";
    transactionHash: Hex32;
    blockNumber: string;
    blockHash: Hex32;
    logIndex: number;
    confirmationDepth: string;
    requiredConfirmationDepth: "64";
    finalizedCheckpoint: FinalizedCheckpointV1;
  }>;
  createdAt: string;
  finalizedAt: string;
}>;

export type FinalizedCustomLaunchMetadataFeedV1 = Readonly<{
  schemaVersion: typeof FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1;
  status: "current" | "last-known-good";
  generatedAt: string;
  launches: readonly FinalizedCustomLaunchMetadataV1[];
}>;

type FeedPageV1 = Readonly<{
  schemaVersion: typeof FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1;
  generatedAt: string;
  launches: readonly FinalizedCustomLaunchMetadataV1[];
  nextCursor: string | null;
}>;

export type RouterCustomMetadataOverlayBindingV1 = Readonly<{
  routerLaunchId: Hex32;
  router: Address;
  token: Address;
  hook: Address;
  poolManager: Address;
  poolId: Hex32;
  projectMetadataHash: Sha256Digest;
  requestHash: Sha256Digest;
  launchIntentHash: Sha256Digest;
  graphBundleHash: Sha256Digest;
  unboundGraphBundleHash: Sha256Digest;
  artifactHash: Sha256Digest;
  partnerAttribution?: LaunchPartnerAttributionV1;
  tradeAdapterDescriptor?: FinalizedTradeAdapterDescriptorV1;
  tokenMetadataReadback: Readonly<{
    status: "matching" | "unavailable";
    observedAtBlockNumber: string | null;
    observedAt: string | null;
  }>;
}>;

export type RouterCustomMetadataOverlayV1 = Readonly<{
  schemaVersion: typeof ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1;
  source: typeof ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1;
  status: "current" | "last-known-good";
  generatedAt: string;
  routerIdentityCommitment: Sha256Digest;
  appliedBindings: readonly RouterCustomMetadataOverlayBindingV1[];
  metadataCommitment: Sha256Digest;
}>;

export type RouterCustomMetadataEnrichedSnapshotV1<
  Snapshot,
> = Snapshot & Readonly<{ metadataOverlay: RouterCustomMetadataOverlayV1 }>;

type ReaderDependenciesV1 = Readonly<{
  fetchFeed?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maximumPages?: number;
}>;

type EnrichmentDependenciesV1 = Readonly<{
  readFeed?: () => Promise<FinalizedCustomLaunchMetadataFeedV1>;
}>;

type ProjectedLaunchPresentationV1 = Readonly<{
  description: string;
  imageUrl: string | null;
  links: readonly TokenLink[];
  projectMetadataLinks: readonly Readonly<{
    kind: LaunchPresentationLinkKindV1;
    url: string;
  }>[];
}>;

export function createFinalizedCustomLaunchMetadataFeedReaderV1(
  dependencies: ReaderDependenciesV1 = {},
) {
  const fetchFeed = dependencies.fetchFeed ?? fetch;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ??
    FINALIZED_CUSTOM_LAUNCH_METADATA_TIMEOUT_MS;
  const maximumPages = dependencies.maximumPages ??
    FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGES;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 10
    || timeoutMs > 5_000
    || !Number.isSafeInteger(maximumPages)
    || maximumPages < 1
    || maximumPages > FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGES
  ) throw new TypeError("Finalized Custom metadata reader bounds are invalid");

  let cached: Readonly<{
    freshUntil: number;
    lkgUntil: number;
    feed: FinalizedCustomLaunchMetadataFeedV1;
  }> | null = null;
  let inFlight: Promise<FinalizedCustomLaunchMetadataFeedV1> | null = null;

  return async function readFinalizedCustomLaunchMetadataFeedV1() {
    const startedAt = now();
    if (cached && cached.freshUntil > startedAt) return cached.feed;
    const flight = inFlight ?? readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed,
      now,
      timeoutMs,
      maximumPages,
    }).then((feed) => {
      const loadedAt = now();
      cached = Object.freeze({
        freshUntil: loadedAt + FINALIZED_CUSTOM_LAUNCH_METADATA_CACHE_TTL_MS,
        lkgUntil: loadedAt + FINALIZED_CUSTOM_LAUNCH_METADATA_LKG_TTL_MS,
        feed,
      });
      return feed;
    }).catch((error: unknown) => {
      if (cached && cached.lkgUntil > now()) {
        return Object.freeze({
          ...cached.feed,
          status: "last-known-good" as const,
        });
      }
      throw error;
    }).finally(() => {
      inFlight = null;
    });
    inFlight = flight;
    return await flight;
  };
}

export async function readFinalizedCustomLaunchMetadataPagesV1(input: Readonly<{
  fetchFeed: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maximumPages?: number;
}>): Promise<FinalizedCustomLaunchMetadataFeedV1> {
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? FINALIZED_CUSTOM_LAUNCH_METADATA_TIMEOUT_MS;
  const maximumPages = input.maximumPages ??
    FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGES;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 10
    || timeoutMs > 5_000
    || !Number.isSafeInteger(maximumPages)
    || maximumPages < 1
    || maximumPages > FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGES
  ) throw new TypeError("Finalized Custom metadata request bounds are invalid");

  const signal = AbortSignal.timeout(timeoutMs);
  const cursors = new Set<string>();
  const resourceIds = new Set<string>();
  const launchIds = new Set<string>();
  const launches: FinalizedCustomLaunchMetadataV1[] = [];
  let cursor: string | null = null;
  let firstGeneratedAt: string | null = null;
  let previous: FinalizedCustomLaunchMetadataV1 | null = null;

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = new URL(FINALIZED_CUSTOM_LAUNCH_METADATA_FEED_URL);
    url.searchParams.set("limit", String(FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await abortable(
      () => input.fetchFeed(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      }),
      signal,
    );
    if (response.status !== 200) {
      throw new Error("Finalized Custom metadata feed is unavailable");
    }
    const page = parseFeedPageV1(
      await readBoundedJson(response),
      now(),
    );
    firstGeneratedAt ??= page.generatedAt;
    for (const launch of page.launches) {
      if (
        resourceIds.has(launch.resourceId)
        || launchIds.has(launch.routerLaunchId)
        || (previous !== null && compareLaunchOrderV1(previous, launch) >= 0)
      ) throw new Error("Finalized Custom metadata feed ordering is invalid");
      resourceIds.add(launch.resourceId);
      launchIds.add(launch.routerLaunchId);
      launches.push(launch);
      previous = launch;
      if (launches.length > FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_RECORDS) {
        throw new Error("Finalized Custom metadata feed exceeds its record bound");
      }
    }
    if (page.nextCursor === null) {
      return deepFreeze({
        schemaVersion: FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1,
        status: "current",
        generatedAt: firstGeneratedAt,
        launches,
      });
    }
    if (page.launches.length === 0 || cursors.has(page.nextCursor)) {
      throw new Error("Finalized Custom metadata feed cursor is invalid");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error("Finalized Custom metadata feed exceeds its page bound");
}

export const readProductionFinalizedCustomLaunchMetadataFeedV1 =
  createFinalizedCustomLaunchMetadataFeedReaderV1();

export async function enrichRouterCustomSnapshotWithFinalizedMetadataV1<
  Snapshot extends Readonly<{
    identityCommitment: Sha256Digest;
    entries: readonly CanonicalTokenExploreEntry[];
  }>,
>(
  snapshot: Snapshot,
  dependencies: EnrichmentDependenciesV1 = {},
): Promise<Snapshot | RouterCustomMetadataEnrichedSnapshotV1<Snapshot>> {
  if (snapshot.entries.length === 0) return snapshot;
  let feed: FinalizedCustomLaunchMetadataFeedV1;
  try {
    feed = await (dependencies.readFeed ??
      readProductionFinalizedCustomLaunchMetadataFeedV1)();
  } catch (error) {
    console.warn("Finalized Custom metadata feed unavailable", {
      name: error instanceof Error
        ? error.name
        : "FinalizedCustomMetadataFeedError",
    });
    return snapshot;
  }

  const byLaunchId = new Map<string, FinalizedCustomLaunchMetadataV1>(
    feed.launches.map((launch) => [
      launch.routerLaunchId,
      launch,
    ]),
  );
  let changed = false;
  const appliedBindings: RouterCustomMetadataOverlayBindingV1[] = [];
  const entries = snapshot.entries.map((entry) => {
    const launchId = entry.launchStampProvenance?.launchId.toLowerCase();
    const metadata = launchId ? byLaunchId.get(launchId) : undefined;
    if (!metadata) return entry;
    if (!metadataMatchesRouterEntryV1(metadata, entry)) {
      console.warn("Finalized Custom metadata binding mismatch", { launchId });
      return entry;
    }
    if (metadata.tokenMetadataReadback.status === "mismatch") {
      console.warn("Finalized Custom token metadata declaration not applied", {
        launchId,
        status: metadata.tokenMetadataReadback.status,
      });
      return entry;
    }
    if (metadata.projectMetadata === null || metadata.projectMetadataHash === null) {
      return entry;
    }
    let presentation: ProjectedLaunchPresentationV1;
    try {
      presentation = projectLaunchPresentationV1(
        metadata.projectMetadata.presentation,
      );
    } catch {
      console.warn("Finalized Custom presentation projection unavailable", {
        launchId,
      });
      return entry;
    }
    const {
      description: _priorDescription,
      imageUrl: _priorImageUrl,
      links: _priorLinks,
      ...identity
    } = entry;
    void _priorDescription;
    void _priorImageUrl;
    void _priorLinks;
    changed = true;
    appliedBindings.push(Object.freeze({
      routerLaunchId: metadata.routerLaunchId,
      router: metadata.router,
      token: metadata.token,
      hook: metadata.hook,
      poolManager: metadata.poolManager,
      poolId: metadata.poolId,
      projectMetadataHash: metadata.projectMetadataHash,
      requestHash: metadata.bindings.requestHash,
      launchIntentHash: metadata.bindings.launchIntentHash,
      graphBundleHash: metadata.bindings.graphBundleHash,
      unboundGraphBundleHash: metadata.bindings.unboundGraphBundleHash,
      artifactHash: metadata.bindings.artifactHash,
      ...(metadata.partnerAttribution
        ? { partnerAttribution: metadata.partnerAttribution }
        : {}),
      ...(metadata.tradeAdapterDescriptor
        ? { tradeAdapterDescriptor: metadata.tradeAdapterDescriptor }
        : {}),
      tokenMetadataReadback: Object.freeze({
        status: metadata.tokenMetadataReadback.status,
        observedAtBlockNumber:
          metadata.tokenMetadataReadback.observedAtBlockNumber,
        observedAt: metadata.tokenMetadataReadback.observedAt,
      }),
    }));
    return Object.freeze({
      ...identity,
      ...(metadata.tokenMetadataReadback.status === "matching" ? {
        name: metadata.tokenMetadataReadback.declared.name,
        symbol: metadata.tokenMetadataReadback.declared.symbol,
      } : {}),
      ...(presentation.description ? { description: presentation.description } : {}),
      ...(presentation.imageUrl ? { imageUrl: presentation.imageUrl } : {}),
      ...(presentation.links.length > 0
        ? { links: presentation.links }
        : {}),
      projectMetadataLinks: presentation.projectMetadataLinks,
      projectMetadataStatus: feed.status,
      ...(metadata.partnerAttribution
        ? { partnerAttribution: metadata.partnerAttribution }
        : {}),
    });
  });
  if (!changed) return snapshot;
  const frozenBindings = Object.freeze(appliedBindings);
  const commitmentInput = Object.freeze({
    source: ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
    generatedAt: feed.generatedAt,
    routerIdentityCommitment: snapshot.identityCommitment,
    appliedBindings: frozenBindings,
  });
  const metadataOverlay = Object.freeze({
    schemaVersion: ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
    source: ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
    status: feed.status,
    generatedAt: feed.generatedAt,
    routerIdentityCommitment: snapshot.identityCommitment,
    appliedBindings: frozenBindings,
    metadataCommitment: canonicalSha256(
      ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
      commitmentInput,
    ),
  });
  // `identityCommitment` belongs exclusively to the durable Router core. The
  // presentation overlay has its own canonical commitment and provenance so a
  // feed outage or invalid binding can never weaken or hide Router identity.
  return Object.freeze({
    ...snapshot,
    entries: Object.freeze(entries),
    metadataOverlay,
  }) as RouterCustomMetadataEnrichedSnapshotV1<Snapshot>;
}

function projectLaunchPresentationV1(
  presentation: LaunchPresentationDraftV1,
): ProjectedLaunchPresentationV1 {
  const description = humanText(
    presentation.description,
    0,
    DESCRIPTION_MAXIMUM_BYTES,
    "project description",
    true,
  );
  const projectMetadataLinks = presentation.links.map((link) => {
    if (
      link.kind !== "website"
      && link.kind !== "documentation"
      && link.kind !== "x"
      && link.kind !== "telegram"
      && link.kind !== "discord"
      && link.kind !== "github"
      && link.kind !== "other"
    ) throw new Error("Launch presentation link kind is invalid");
    return deepFreeze({
      kind: link.kind,
      url: normalizeHttpsUri(link.uri),
    });
  });
  for (let index = 1; index < projectMetadataLinks.length; index += 1) {
    if (
      compareLinksV1(
        {
          kind: projectMetadataLinks[index - 1]!.kind,
          uri: projectMetadataLinks[index - 1]!.url,
        },
        {
          kind: projectMetadataLinks[index]!.kind,
          uri: projectMetadataLinks[index]!.url,
        },
      ) >= 0
    ) throw new Error("Launch presentation links are unsorted or duplicated");
  }
  const links = projectMetadataLinks.flatMap((link): TokenLink[] => {
    if (
      link.kind !== "website"
      && link.kind !== "x"
      && link.kind !== "telegram"
    ) return [];
    return [{ kind: link.kind, url: link.url }];
  });

  let imageUrl: string | null = null;
  if (presentation.image !== null) {
    const contentUri = normalizeContentUri(presentation.image.uri);
    const url = new URL(contentUri);
    if (url.protocol === "https:") {
      imageUrl = contentUri;
    } else if (url.protocol === "ipfs:") {
      imageUrl = `${TRUSTED_IPFS_PROJECT_IMAGE_GATEWAY_V1}${url.hostname}`;
    } else if (url.protocol === "ar:") {
      imageUrl = `${TRUSTED_ARWEAVE_PROJECT_IMAGE_GATEWAY_V1}${url.hostname}`;
    } else {
      throw new Error("Project metadata image URI scheme is invalid");
    }
  }

  return deepFreeze({
    description,
    imageUrl,
    links,
    projectMetadataLinks,
  });
}

export function metadataMatchesRouterEntryV1(
  metadata: FinalizedCustomLaunchMetadataV1,
  entry: CanonicalTokenExploreEntry,
) {
  const stamp = entry.launchStampProvenance;
  return stamp?.kind === "custom-graph"
    && metadata.chainId === "1"
    && sameHex(metadata.routerLaunchId, stamp.launchId)
    && sameHex(metadata.router, stamp.routerAddress)
    && sameHex(metadata.token, entry.tokenAddress)
    && sameHex(metadata.hook, entry.hookAddress)
    && sameHex(metadata.poolManager, stamp.poolManagerAddress)
    && sameHex(metadata.poolId, entry.poolId)
    && sameHex(metadata.finality.transactionHash, stamp.transactionHash)
    && metadata.finality.blockNumber === stamp.blockNumber
    && sameHex(metadata.finality.blockHash, stamp.blockHash)
    && metadata.finality.logIndex === stamp.launchLogIndex;
}

function parseFeedPageV1(value: JsonValue, now: number): FeedPageV1 {
  const hasQuality = value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.hasOwn(value, "quality");
  const record = exactRecord(value, [
    "schemaVersion", "generatedAt", "launches", "nextCursor",
    ...(hasQuality ? ["quality"] : []),
  ], "Finalized Custom metadata list");
  if (
    record.schemaVersion !== FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1
    || !Array.isArray(record.launches)
    || record.launches.length > FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT
    || (record.nextCursor !== null && (
      typeof record.nextCursor !== "string" || !CURSOR.test(record.nextCursor)
    ))
  ) throw new Error("Finalized Custom metadata list is invalid");
  const generatedAt = instant(record.generatedAt, "metadata list generation time");
  const generatedAtMs = Date.parse(generatedAt);
  if (
    generatedAtMs > now + MAXIMUM_FUTURE_SKEW_MS
    || now - generatedAtMs > MAXIMUM_GENERATED_AGE_MS
  ) throw new Error("Finalized Custom metadata list is stale");
  if (hasQuality) parseFeedQualityV1(record.quality, record.launches.length);
  return deepFreeze({
    schemaVersion: FINALIZED_CUSTOM_LAUNCH_METADATA_LIST_SCHEMA_V1,
    generatedAt,
    launches: record.launches.map(parseLaunchV1),
    nextCursor: record.nextCursor as string | null,
  });
}

function parseFeedQualityV1(
  value: JsonValue | undefined,
  publishedLaunchCount: number,
) {
  const record = exactRecord(value, [
    "status", "sourceRowCount", "publishedRowCount",
    "quarantinedRowCount", "diagnostics",
  ], "Finalized Custom metadata quality");
  if (
    (record.status !== "complete" && record.status !== "partial")
    || !boundedInteger(
      record.sourceRowCount,
      0,
      FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT,
    )
    || !boundedInteger(
      record.publishedRowCount,
      0,
      FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT,
    )
    || !boundedInteger(
      record.quarantinedRowCount,
      0,
      FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT,
    )
    || !Array.isArray(record.diagnostics)
    || record.diagnostics.length > FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT
    || record.publishedRowCount !== publishedLaunchCount
    || record.publishedRowCount + record.quarantinedRowCount
      !== record.sourceRowCount
    || record.diagnostics.length !== record.quarantinedRowCount
    || (record.status === "complete" && record.quarantinedRowCount !== 0)
    || (record.status === "partial" && record.quarantinedRowCount === 0)
  ) throw new Error("Finalized Custom metadata quality is invalid");

  const rowIndexes = new Set<number>();
  for (const value of record.diagnostics) {
    const diagnostic = exactRecord(value, [
      "rowIndex", "code",
    ], "Finalized Custom metadata quality diagnostic");
    if (
      !boundedInteger(
        diagnostic.rowIndex,
        0,
        FINALIZED_CUSTOM_LAUNCH_METADATA_PAGE_LIMIT - 1,
      )
      || diagnostic.rowIndex >= record.sourceRowCount
      || diagnostic.code !== "FINALIZED_ROW_QUARANTINED"
      || rowIndexes.has(diagnostic.rowIndex)
    ) throw new Error("Finalized Custom metadata quality diagnostic is invalid");
    rowIndexes.add(diagnostic.rowIndex);
  }
}

function parseLaunchV1(value: JsonValue): FinalizedCustomLaunchMetadataV1 {
  const hasRoutingFeePolicy = value !== null && typeof value === "object"
    && !Array.isArray(value) && Object.hasOwn(value, "routingFeePolicy");
  const hasPartnerAttribution = value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.hasOwn(value, "partnerAttribution");
  const hasTradeAdapterDescriptor = value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.hasOwn(value, "tradeAdapterDescriptor");
  const record = exactRecord(value, [
    "schemaVersion", "resourceId", "routerLaunchId", "chainId", "router",
    "token", "hook", "poolManager", "poolId", "launchProfileVersion",
    "projectMetadata",
    "projectMetadataHash", "bindings", "tokenMetadataReadback", "finality",
    "createdAt", "finalizedAt",
    ...(hasPartnerAttribution ? ["partnerAttribution"] : []),
    ...(hasTradeAdapterDescriptor ? ["tradeAdapterDescriptor"] : []),
    ...(hasRoutingFeePolicy ? ["routingFeePolicy"] : []),
  ], "Finalized Custom metadata item");
  if (
    record.schemaVersion !== FINALIZED_CUSTOM_LAUNCH_METADATA_SCHEMA_V1
    || typeof record.resourceId !== "string"
    || !UUID.test(record.resourceId)
    || record.chainId !== "1"
  ) throw new Error("Finalized Custom metadata item is invalid");
  if (
    record.launchProfileVersion !== "2.0.0"
    && record.launchProfileVersion !== "3.0.0"
    && record.launchProfileVersion !== "3.1.0"
    && record.launchProfileVersion !== "3.2.0"
    && record.launchProfileVersion !== "3.3.0"
    && record.launchProfileVersion !== "3.4.0"
    && record.launchProfileVersion !== "3.5.0"
    && record.launchProfileVersion !== "3.6.0"
  ) throw new Error("Finalized Custom metadata launch profile version is invalid");
  if (hasRoutingFeePolicy !== (record.launchProfileVersion === "3.6.0")) {
    throw new Error("Finalized Custom routing fee policy is missing or unexpected");
  }
  const routingFeePolicy = hasRoutingFeePolicy ? parseEthereumRoutingFeePolicyV1(record.routingFeePolicy) : null;
  const metadataRequired = launchProfileUsesProjectMetadataV1(
    record.launchProfileVersion,
  );
  let projectMetadata: ProjectMetadataV1 | null = null;
  let projectMetadataHash: Sha256Digest | null = null;
  if (metadataRequired) {
    projectMetadata = parseProjectMetadataV1(record.projectMetadata);
    projectMetadataHash = digest(
      record.projectMetadataHash,
      "project metadata hash",
    );
    if (
      canonicalSha256(PROJECT_METADATA_SCHEMA_V1, projectMetadata)
        !== projectMetadataHash
    ) throw new Error("Finalized Custom project metadata hash is invalid");
  } else if (record.projectMetadata !== null || record.projectMetadataHash !== null) {
    throw new Error("Finalized Custom legacy launch metadata fields must be null");
  }
  const partnerAttribution = hasPartnerAttribution
    ? parseLaunchPartnerAttributionV1(record.partnerAttribution)
    : null;
  if (hasPartnerAttribution && partnerAttribution === null) {
    throw new Error("Finalized Custom partner attribution is invalid");
  }
  if (partnerAttribution !== null) {
    const { snapshotDigest, ...snapshot } = partnerAttribution;
    if (
      canonicalSha256(LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1, snapshot)
        !== snapshotDigest
    ) throw new Error("Finalized Custom partner attribution digest is invalid");
  }

  const bindingsRecord = exactRecord(record.bindings, [
    "requestHash", "launchIntentHash", "graphBundleHash",
    "unboundGraphBundleHash", "artifactHash",
  ], "Finalized Custom metadata bindings");
  const bindings = deepFreeze({
    requestHash: digest(bindingsRecord.requestHash, "request hash"),
    launchIntentHash: digest(bindingsRecord.launchIntentHash, "launch intent hash"),
    graphBundleHash: digest(bindingsRecord.graphBundleHash, "graph bundle hash"),
    unboundGraphBundleHash: digest(
      bindingsRecord.unboundGraphBundleHash,
      "unbound graph bundle hash",
    ),
    artifactHash: digest(bindingsRecord.artifactHash, "artifact hash"),
  });
  if (
    metadataRequired
    && canonicalSha256(PROJECT_METADATA_GRAPH_BINDING_DOMAIN_V1, {
      graphBundleHash: bindings.unboundGraphBundleHash,
      projectMetadataHash,
    }) !== bindings.graphBundleHash
  ) throw new Error("Finalized Custom graph metadata binding is invalid");

  const createdAt = instant(record.createdAt, "metadata creation time");
  const finalizedAt = instant(record.finalizedAt, "metadata finalization time");
  if (Date.parse(createdAt) > Date.parse(finalizedAt)) {
    throw new Error("Finalized Custom metadata timestamps are invalid");
  }
  const finality = parseFinalityV1(record.finality);
  const routerLaunchId = lowerBytes32(
    record.routerLaunchId,
    "Router launch id",
  );
  const router = canonicalAddress(record.router, "Router address");
  const token = canonicalAddress(record.token, "token address");
  const hook = canonicalAddress(record.hook, "hook address");
  const poolManager = canonicalAddress(
    record.poolManager,
    "PoolManager address",
  );
  const poolId = lowerBytes32(record.poolId, "pool id");
  const tradeAdapterDescriptor = hasTradeAdapterDescriptor
    ? parseFinalizedTradeAdapterDescriptorV1(
        record.tradeAdapterDescriptor,
        {
          routerLaunchId,
          router,
          token,
          hook,
          poolManager,
          poolId,
          artifactHash: bindings.artifactHash,
          graphBundleHash: bindings.graphBundleHash,
          finality: {
            transactionHash: finality.transactionHash,
            blockNumber: finality.blockNumber,
            blockHash: finality.blockHash,
            logIndex: finality.logIndex,
          },
        },
      )
    : null;
  const readback = parseTokenMetadataReadbackV1(
    record.tokenMetadataReadback,
    projectMetadata,
  );
  if (
    readback.observedAtBlockNumber !== null
    && readback.observedAtBlockNumber
      !== finality.finalizedCheckpoint.blockNumber
  ) throw new Error("Finalized Custom token metadata readback block is invalid");
  return deepFreeze({
    schemaVersion: FINALIZED_CUSTOM_LAUNCH_METADATA_SCHEMA_V1,
    resourceId: record.resourceId,
    routerLaunchId,
    launchProfileVersion: record.launchProfileVersion,
    ...(routingFeePolicy ? { routingFeePolicy } : {}),
    chainId: "1",
    router,
    token,
    hook,
    poolManager,
    poolId,
    projectMetadata,
    projectMetadataHash,
    ...(partnerAttribution ? { partnerAttribution } : {}),
    ...(tradeAdapterDescriptor ? { tradeAdapterDescriptor } : {}),
    bindings,
    tokenMetadataReadback: readback,
    finality,
    createdAt,
    finalizedAt,
  });
}

function launchProfileUsesProjectMetadataV1(
  launchProfileVersion: LaunchProfileVersionV1,
) {
  return launchProfileVersion === "3.2.0"
    || launchProfileVersion === "3.3.0"
    || launchProfileVersion === "3.4.0"
    || launchProfileVersion === "3.5.0"
    || launchProfileVersion === "3.6.0";
}

function parseTokenMetadataReadbackV1(
  value: JsonValue | undefined,
  metadata: ProjectMetadataV1 | null,
): FinalizedCustomLaunchMetadataV1["tokenMetadataReadback"] {
  const record = exactRecord(value, [
    "status", "declared", "observed", "observedAtBlockNumber", "observedAt",
  ], "Finalized Custom token metadata readback");
  const declaredRecord = exactRecord(
    record.declared,
    ["name", "symbol"],
    "declared token metadata",
  );
  const observedRecord = exactRecord(
    record.observed,
    ["name", "symbol"],
    "observed token metadata",
  );
  const declared = deepFreeze({
    name: humanText(declaredRecord.name, 1, 64, "declared token name"),
    symbol: humanText(declaredRecord.symbol, 1, 16, "declared token symbol"),
  });
  if (
    (metadata !== null && (
      declared.name !== metadata.token.name
      || declared.symbol !== metadata.token.symbol
    ))
    || (record.status !== "matching"
      && record.status !== "mismatch"
      && record.status !== "unavailable")
  ) throw new Error("Finalized Custom declared token metadata is invalid");
  const observed = deepFreeze({
    name: observedRecord.name === null
      ? null
      : rawSafeReadbackText(observedRecord.name, 1_024, "observed token name"),
    symbol: observedRecord.symbol === null
      ? null
      : rawSafeReadbackText(observedRecord.symbol, 256, "observed token symbol"),
  });
  if (
    (record.status === "matching" && (
      observed.name !== declared.name || observed.symbol !== declared.symbol
    ))
    || (record.status === "mismatch" && (
      observed.name === null
      || observed.symbol === null
      || (observed.name === declared.name && observed.symbol === declared.symbol)
    ))
    || (record.status === "unavailable" && (
      observed.name !== null || observed.symbol !== null
    ))
  ) throw new Error("Finalized Custom observed token metadata is invalid");
  const observedAtBlockNumber = record.observedAtBlockNumber === null
    ? null
    : decimal(
      record.observedAtBlockNumber,
      "token metadata observation block",
    );
  const observedAt = record.observedAt === null
    ? null
    : instant(record.observedAt, "token metadata observation time");
  if ((observedAtBlockNumber === null) !== (observedAt === null)) {
    throw new Error("Finalized Custom token metadata observation is invalid");
  }
  return deepFreeze({
    status: record.status as "matching" | "mismatch" | "unavailable",
    declared,
    observed,
    observedAtBlockNumber,
    observedAt,
  });
}

function parseFinalityV1(value: JsonValue | undefined) {
  const record = exactRecord(value, [
    "state", "transactionHash", "blockNumber", "blockHash", "logIndex",
    "confirmationDepth", "requiredConfirmationDepth", "finalizedCheckpoint",
  ], "Finalized Custom finality");
  if (
    record.state !== "finalized"
    || record.requiredConfirmationDepth !== "64"
    || typeof record.logIndex !== "number"
    || !Number.isSafeInteger(record.logIndex)
    || record.logIndex < 0
  ) throw new Error("Finalized Custom finality is invalid");
  const blockNumber = decimal(record.blockNumber, "launch block number");
  const confirmationDepth = decimal(record.confirmationDepth, "confirmation depth");
  if (BigInt(confirmationDepth) < 64n) {
    throw new Error("Finalized Custom confirmation depth is invalid");
  }
  const checkpoint = parseFinalizedCheckpointV1(record.finalizedCheckpoint);
  if (BigInt(checkpoint.blockNumber) < BigInt(blockNumber)) {
    throw new Error("Finalized Custom checkpoint predates the launch");
  }
  return deepFreeze({
    state: "finalized" as const,
    transactionHash: lowerBytes32(record.transactionHash, "launch transaction hash"),
    blockNumber,
    blockHash: lowerBytes32(record.blockHash, "launch block hash"),
    logIndex: record.logIndex,
    confirmationDepth,
    requiredConfirmationDepth: "64" as const,
    finalizedCheckpoint: checkpoint,
  });
}

function parseFinalizedCheckpointV1(value: JsonValue | undefined): FinalizedCheckpointV1 {
  const record = exactRecord(value, [
    "schemaVersion", "blockNumber", "blockHash", "quorumSize", "observations",
  ], "finalized checkpoint");
  if (
    record.schemaVersion !== FINALIZED_CHECKPOINT_SCHEMA_V1
    || record.quorumSize !== 2
    || !Array.isArray(record.observations)
    || record.observations.length !== 2
  ) throw new Error("Finalized Custom checkpoint is invalid");
  const blockNumber = decimal(record.blockNumber, "finalized checkpoint block");
  const blockHash = lowerBytes32(record.blockHash, "finalized checkpoint hash");
  const observations = record.observations.map((observation, index) => {
    const candidate = exactRecord(observation, [
      "provider", "finalizedBlockNumber", "finalizedBlockHash", "commonBlockHash",
    ], "finalized checkpoint observation");
    const provider = index === 0 ? "primary" : "secondary";
    if (candidate.provider !== provider) {
      throw new Error("Finalized Custom checkpoint provider order is invalid");
    }
    const finalizedBlockNumber = decimal(
      candidate.finalizedBlockNumber,
      "provider finalized block",
    );
    if (BigInt(finalizedBlockNumber) < BigInt(blockNumber)) {
      throw new Error("Finalized Custom provider checkpoint is invalid");
    }
    const commonBlockHash = lowerBytes32(
      candidate.commonBlockHash,
      "provider common block hash",
    );
    if (commonBlockHash !== blockHash) {
      throw new Error("Finalized Custom checkpoint quorum is invalid");
    }
    return deepFreeze({
      provider,
      finalizedBlockNumber,
      finalizedBlockHash: lowerBytes32(
        candidate.finalizedBlockHash,
        "provider finalized block hash",
      ),
      commonBlockHash,
    });
  }) as [FinalizedCheckpointObservationV1, FinalizedCheckpointObservationV1];
  return deepFreeze({
    schemaVersion: FINALIZED_CHECKPOINT_SCHEMA_V1,
    blockNumber,
    blockHash,
    quorumSize: 2,
    observations,
  });
}

function parseProjectMetadataV1(value: JsonValue | undefined): ProjectMetadataV1 {
  const record = exactRecord(value, [
    "presentation", "schemaVersion", "token", "tokenMetadataBinding",
  ], "project metadata");
  if (record.schemaVersion !== PROJECT_METADATA_SCHEMA_V1) {
    throw new Error("Project metadata schema is invalid");
  }
  const tokenRecord = exactRecord(record.token, ["name", "symbol"], "project token metadata");
  const token = deepFreeze({
    name: canonicalProjectText(
      tokenRecord.name,
      64,
      64,
      false,
      "project token name",
    ),
    symbol: canonicalProjectText(
      tokenRecord.symbol,
      16,
      16,
      true,
      "project token symbol",
    ),
  });
  return deepFreeze({
    schemaVersion: PROJECT_METADATA_SCHEMA_V1,
    token,
    presentation: parsePresentationV1(record.presentation),
    tokenMetadataBinding: parseProjectTokenMetadataBindingV1(
      record.tokenMetadataBinding,
    ),
  });
}

function parsePresentationV1(value: JsonValue | undefined): LaunchPresentationDraftV1 {
  const record = exactRecord(value, [
    "description", "image", "links", "schemaVersion",
  ], "launch presentation");
  if (
    record.schemaVersion !== LAUNCH_PRESENTATION_DRAFT_SCHEMA_V1
    || !Array.isArray(record.links)
    || record.links.length > LINK_MAXIMUM_COUNT
  ) throw new Error("Launch presentation is invalid");
  const links = record.links.map((value) => {
    const link = exactRecord(value, ["kind", "uri"], "launch presentation link");
    if (
      link.kind !== "website"
      && link.kind !== "documentation"
      && link.kind !== "x"
      && link.kind !== "telegram"
      && link.kind !== "discord"
      && link.kind !== "github"
      && link.kind !== "other"
    ) throw new Error("Launch presentation link kind is invalid");
    return deepFreeze({
      kind: link.kind as LaunchPresentationLinkKindV1,
      uri: normalizeHttpsUri(link.uri),
    });
  });
  for (let index = 0; index < links.length; index += 1) {
    if (index > 0 && compareLinksV1(links[index - 1]!, links[index]!) >= 0) {
      throw new Error("Launch presentation links are unsorted or duplicated");
    }
  }
  return deepFreeze({
    schemaVersion: LAUNCH_PRESENTATION_DRAFT_SCHEMA_V1,
    description: humanText(
      record.description,
      0,
      DESCRIPTION_MAXIMUM_BYTES,
      "project description",
      true,
    ),
    image: record.image === null ? null : parsePresentationImageV1(record.image),
    links,
  });
}

function parsePresentationImageV1(
  value: JsonValue | undefined,
): NonNullable<LaunchPresentationDraftV1["image"]> {
  const record = exactRecord(value, [
    "byteLength", "contentSha256", "height", "mediaType", "uri", "width",
  ], "launch presentation image");
  if (
    (record.mediaType !== "image/png"
      && record.mediaType !== "image/jpeg"
      && record.mediaType !== "image/webp"
      && record.mediaType !== "image/gif")
    || !boundedInteger(record.byteLength, 1, IMAGE_MAXIMUM_BYTES)
    || !boundedInteger(record.width, 1, IMAGE_MAXIMUM_DIMENSION)
    || !boundedInteger(record.height, 1, IMAGE_MAXIMUM_DIMENSION)
  ) throw new Error("Launch presentation image is invalid");
  return deepFreeze({
    uri: normalizeContentUri(record.uri),
    contentSha256: digest(record.contentSha256, "image content hash"),
    mediaType: record.mediaType as
      | "image/png"
      | "image/jpeg"
      | "image/webp"
      | "image/gif",
    byteLength: record.byteLength,
    width: record.width,
    height: record.height,
  });
}

function parseProjectTokenMetadataBindingV1(value: JsonValue | undefined) {
  const record = exactRecord(value, [
    "declarationBinding", "name", "postDeploymentReadback", "schemaVersion",
    "standardReadModel", "symbol", "tokenTargetId",
  ], "project token metadata binding");
  const standardReadModel = exactRecord(
    record.standardReadModel,
    ["name", "symbol"],
    "project token standard read model",
  );
  if (
    record.schemaVersion !== PROJECT_TOKEN_METADATA_BINDING_SCHEMA_V1
    || typeof record.tokenTargetId !== "string"
    || !TARGET_ID.test(record.tokenTargetId)
    || containsRecognizableSecret(record.tokenTargetId)
    || record.declarationBinding !== "request-and-launch-id"
    || typeof standardReadModel.name !== "boolean"
    || typeof standardReadModel.symbol !== "boolean"
    || record.postDeploymentReadback !== "required"
  ) throw new Error("Project token metadata binding is invalid");
  return deepFreeze({
    schemaVersion: PROJECT_TOKEN_METADATA_BINDING_SCHEMA_V1,
    tokenTargetId: record.tokenTargetId,
    declarationBinding: "request-and-launch-id" as const,
    standardReadModel: deepFreeze({
      name: standardReadModel.name,
      symbol: standardReadModel.symbol,
    }),
    name: parseProjectTokenMetadataFieldV1(record.name),
    symbol: parseProjectTokenMetadataFieldV1(record.symbol),
    postDeploymentReadback: "required" as const,
  });
}

function parseProjectTokenMetadataFieldV1(
  value: JsonValue | undefined,
): ProjectTokenMetadataFieldBindingV1 {
  const record = exactRecord(value, [
    "argumentIndex", "argumentName", "staticSource",
  ], "project token metadata field binding");
  if (
    record.staticSource !== "constructor-argument"
    && record.staticSource !== "initializer-argument"
    && record.staticSource !== "not-deterministically-extractable"
  ) throw new Error("Project token metadata static source is invalid");
  if (record.staticSource === "not-deterministically-extractable") {
    if (record.argumentIndex !== null || record.argumentName !== null) {
      throw new Error("Project token metadata field binding is invalid");
    }
    return deepFreeze({
      staticSource: record.staticSource,
      argumentIndex: null,
      argumentName: null,
    });
  }
  if (
    !boundedInteger(record.argumentIndex, 0, Number.MAX_SAFE_INTEGER)
    || typeof record.argumentName !== "string"
    || record.argumentName.length === 0
    || hasLoneUtf16Surrogate(record.argumentName)
    || containsRecognizableSecret(record.argumentName)
  ) throw new Error("Project token metadata field binding is invalid");
  return deepFreeze({
    staticSource: record.staticSource,
    argumentIndex: record.argumentIndex,
    argumentName: record.argumentName,
  });
}

async function readBoundedJson(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  const cacheControl = response.headers.get("cache-control")?.trim().toLowerCase();
  if (
    contentType !== "application/json"
    || cacheControl !== EXPECTED_CACHE_CONTROL
  ) throw new Error("Finalized Custom metadata response headers are invalid");
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGE_BYTES
    ) throw new Error("Finalized Custom metadata response size is invalid");
  }
  if (!response.body) throw new Error("Finalized Custom metadata response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGE_BYTES) {
        await reader.cancel();
        throw new Error("Finalized Custom metadata response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Finalized Custom")) {
      throw error;
    }
    throw new Error("Finalized Custom metadata response is invalid");
  }
  if (!text) throw new Error("Finalized Custom metadata response is empty");
  return parseStrictJson(text, {
    maximumBytes: FINALIZED_CUSTOM_LAUNCH_METADATA_MAXIMUM_PAGE_BYTES,
    maximumDepth: 16,
  });
}

async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function exactRecord(
  value: JsonValue | undefined,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new Error(`${label} has unknown or missing fields`);
  return value;
}

function canonicalAddress(value: JsonValue | undefined, label: string): Address {
  if (typeof value !== "string" || !isAddress(value) || getAddress(value) !== value) {
    throw new Error(`${label} is not canonical`);
  }
  return value as Address;
}

function lowerBytes32(value: JsonValue | undefined, label: string): Hex32 {
  if (typeof value !== "string" || !LOWER_BYTES32.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Hex32;
}

function digest(value: JsonValue | undefined, label: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function decimal(value: JsonValue | undefined, label: string) {
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function instant(value: JsonValue | undefined, label: string) {
  if (
    typeof value !== "string"
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) throw new Error(`${label} is invalid`);
  return value;
}

function humanText(
  value: JsonValue | undefined,
  minimumBytes: number,
  maximumBytes: number,
  label: string,
  multiline = false,
) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (
    normalized !== value
    || bytes < minimumBytes
    || bytes > maximumBytes
    || hasLoneUtf16Surrogate(normalized)
    || (multiline
      ? DISALLOWED_DESCRIPTION_TEXT.test(normalized)
      : DISALLOWED_TOKEN_TEXT.test(normalized))
    || (!multiline && normalized.includes("\n"))
    || containsRecognizableSecret(normalized)
  ) throw new Error(`${label} is unsafe or outside its bound`);
  return normalized;
}

function canonicalProjectText(
  value: JsonValue | undefined,
  maximumCharacters: number,
  maximumBytes: number,
  whitespaceForbidden: boolean,
  label: string,
) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.normalize("NFC").trim();
  if (
    normalized !== value
    || normalized.length === 0
    || [...normalized].length > maximumCharacters
    || Buffer.byteLength(normalized, "utf8") > maximumBytes
    || hasLoneUtf16Surrogate(normalized)
    || DISALLOWED_TOKEN_TEXT.test(normalized)
    || (whitespaceForbidden && /\s/u.test(normalized))
    || containsRecognizableSecret(normalized)
  ) throw new Error(`${label} is unsafe or outside its bound`);
  return normalized;
}

function rawSafeReadbackText(
  value: JsonValue | undefined,
  maximumBytes: number,
  label: string,
) {
  if (
    typeof value !== "string"
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || hasLoneUtf16Surrogate(value)
    || UNSAFE_READBACK_TEXT.test(value)
    || containsRecognizableSecret(value)
  ) throw new Error(`${label} is unsafe or outside its bound`);
  return value;
}

/** Credential-free public metadata links shared by approved and finalized display readers. */
export function publicLaunchMetadataHttpsUriV1(value: unknown): string | null {
  try { return typeof value === "string" ? normalizeHttpsUri(new URL(value).href) : null; }
  catch { return null; }
}

function normalizeHttpsUri(value: JsonValue | undefined) {
  const url = parsedUrl(value, "project metadata HTTPS URI");
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.hostname === ""
    || url.hostname === "localhost"
    || url.hostname === "localhost."
    || url.hostname.endsWith(".localhost")
    || url.hostname.endsWith(".localhost.")
    || url.hostname.endsWith(".local")
    || url.hostname.endsWith(".local.")
    || url.hostname.includes(":")
    || isIP(url.hostname) !== 0
    || !/^[a-z0-9.-]+$/u.test(url.hostname)
    || url.hash !== ""
  ) throw new Error("Project metadata HTTPS URI is invalid");
  for (const [key, queryValue] of url.searchParams) {
    if (
      SENSITIVE_QUERY_KEY.test(key)
      || containsRecognizableSecret(fullyDecode(queryValue))
    ) throw new Error("Project metadata URI contains credentials");
  }
  return canonicalUri(url, value);
}

function normalizeContentUri(value: JsonValue | undefined) {
  const url = parsedUrl(value, "project metadata image URI");
  if (url.protocol === "https:") {
    if (url.search !== "") {
      throw new Error("Project metadata image HTTPS URI contains a query");
    }
    return normalizeHttpsUri(value);
  }
  if (
    url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname !== ""
  ) throw new Error("Project metadata content URI is invalid");
  if (url.protocol === "ipfs:" && IPFS_CID.test(url.hostname)) {
    return canonicalUri(url, value);
  }
  if (url.protocol === "ar:" && ARWEAVE_TRANSACTION_ID.test(url.hostname)) {
    return canonicalUri(url, value);
  }
  throw new Error("Project metadata image URI scheme is invalid");
}

function parsedUrl(value: JsonValue | undefined, label: string) {
  const decoded = typeof value === "string" ? fullyDecode(value) : "";
  if (
    typeof value !== "string"
    || value === ""
    || value.trim() !== value
    || /[\u0000-\u0020\u007f]/u.test(value)
    || /[\u0000-\u0020\u007f]/u.test(decoded)
    || containsRecognizableSecret(decoded)
  ) throw new Error(`${label} is invalid`);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function canonicalUri(url: URL, original: JsonValue | undefined) {
  const canonical = url.href;
  if (
    canonical !== original
    || Buffer.byteLength(canonical, "utf8") > URI_MAXIMUM_BYTES
    || containsRecognizableSecret(fullyDecode(canonical))
  ) throw new Error("Project metadata URI is noncanonical");
  return canonical;
}

function fullyDecode(value: string) {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

function containsRecognizableSecret(value: string) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function boundedInteger(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function hasLoneUtf16Surrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function compareLinksV1(
  left: Readonly<{ kind: string; uri: string }>,
  right: Readonly<{ kind: string; uri: string }>,
) {
  return compareUtf8(`${left.kind}\u0000${left.uri}`, `${right.kind}\u0000${right.uri}`);
}

function compareLaunchOrderV1(
  prior: FinalizedCustomLaunchMetadataV1,
  candidate: FinalizedCustomLaunchMetadataV1,
) {
  const createdOrder = Date.parse(candidate.createdAt) - Date.parse(prior.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return candidate.resourceId < prior.resourceId
    ? -1
    : candidate.resourceId > prior.resourceId
      ? 1
      : 0;
}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
