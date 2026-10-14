import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFinalizedCustomLaunchMetadataFeedReaderV1,
  enrichRouterCustomSnapshotWithFinalizedMetadataV1,
  FINALIZED_CUSTOM_LAUNCH_METADATA_CACHE_TTL_MS,
  FINALIZED_CUSTOM_LAUNCH_METADATA_FEED_URL,
  FINALIZED_CUSTOM_LAUNCH_METADATA_LKG_TTL_MS,
  readFinalizedCustomLaunchMetadataPagesV1,
} from "../lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";
import { PROGRAMMABLE_TOKEN_IMAGE_HOST } from "../lib/token-image";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

const NOW = Date.parse("2026-08-25T06:00:00.000Z");
const GENERATED_AT = "2026-08-25T06:00:00.000Z";
const PAGE_CURSOR = "abcdefghijklmnop";
const METADATA_OVERLAY_SCHEMA =
  "programmable.router-custom-metadata-overlay.v1";
const SYNTHETIC_PROGRAMMABLE_API_KEY =
  `pm_live_${"a".repeat(22)}_${"b".repeat(43)}`;
const PARTNER_ATTRIBUTION_SNAPSHOT = Object.freeze({
  schemaVersion: "programmable.launch-partner-attribution.v1" as const,
  partnerId: "018f3e2a-7b4c-7d5e-8f90-123456789abc",
  name: "Partner Studio",
  website: "https://partner.example/",
  attributionSource: "authenticated-partner-api-key" as const,
  attributionVersion: 1 as const,
});
const PARTNER_ATTRIBUTION = Object.freeze({
  ...PARTNER_ATTRIBUTION_SNAPSHOT,
  snapshotDigest: canonicalSha256(
    "programmable.launch-partner-attribution.v1",
    PARTNER_ATTRIBUTION_SNAPSHOT,
  ),
});

function hex32(byte: string) {
  return `0x${byte.repeat(32)}` as `0x${string}`;
}

function digest(byte: string) {
  return `sha256:${byte.repeat(32)}` as `sha256:${string}`;
}

function projectMetadata(
  tokenName: string = customGraphExploreEntry.name,
  tokenSymbol: string = customGraphExploreEntry.symbol,
  standardReadModel: Readonly<{ name: boolean; symbol: boolean }> = {
    name: true,
    symbol: true,
  },
  imageUri =
    `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/custom-graph.webp`,
) {
  return {
    schemaVersion: "programmable.project-metadata.v1",
    token: {
      name: tokenName,
      symbol: tokenSymbol,
    },
    presentation: {
      schemaVersion: "programmable.launch-presentation-draft.v1",
      description: "A finalized Custom Graph project.",
      image: {
        uri: imageUri,
        contentSha256: digest("31"),
        mediaType: "image/webp",
        byteLength: 1_024,
        width: 512,
        height: 512,
      },
      links: [
        {
          kind: "discord",
          uri: "https://discord.com/invite/customgraph",
        },
        {
          kind: "documentation",
          uri: "https://docs.example.com/custom-graph",
        },
        {
          kind: "github",
          uri: "https://github.com/example/custom-graph",
        },
        {
          kind: "other",
          uri: "https://community.example.com/custom-graph",
        },
        {
          kind: "telegram",
          uri: "https://t.me/customgraph",
        },
        {
          kind: "website",
          uri: "https://example.com/custom-graph",
        },
        {
          kind: "x",
          uri: "https://x.com/customgraph",
        },
      ],
    },
    tokenMetadataBinding: {
      schemaVersion: "programmable.project-token-metadata-binding.v1",
      tokenTargetId: "custom-token",
      declarationBinding: "request-and-launch-id",
      standardReadModel: {
        name: standardReadModel.name,
        symbol: standardReadModel.symbol,
      },
      name: {
        staticSource: "constructor-argument",
        argumentIndex: 0,
        argumentName: "name_",
      },
      symbol: {
        staticSource: "constructor-argument",
        argumentIndex: 1,
        argumentName: "symbol_",
      },
      postDeploymentReadback: "required",
    },
  } as const;
}

type LaunchFixtureOptions = Readonly<{
  resourceId?: string;
  routerLaunchId?: `0x${string}`;
  launchProfileVersion?: "2.0.0" | "3.0.0" | "3.1.0" | "3.2.0" | "3.3.0" | "3.4.0" | "3.5.0";
  tokenAddress?: `0x${string}`;
  createdAt?: string;
  finalizedAt?: string;
  tokenName?: string;
  tokenSymbol?: string;
  projectMetadataHash?: `sha256:${string}`;
  graphBundleHash?: `sha256:${string}`;
  providerOrder?: readonly ["primary" | "secondary", "primary" | "secondary"];
  readbackStatus?: "matching" | "mismatch" | "unavailable";
  observedName?: string;
  observedSymbol?: string;
  observedAtBlockNumber?: string | null;
  observedAt?: string | null;
  standardReadModel?: Readonly<{ name: boolean; symbol: boolean }>;
  imageUri?: string;
  partnerAttribution?: typeof PARTNER_ATTRIBUTION;
}>;

function launchFixture(input: LaunchFixtureOptions = {}) {
  const metadata = projectMetadata(
    input.tokenName,
    input.tokenSymbol,
    input.standardReadModel,
    input.imageUri,
  );
  const actualProjectMetadataHash = canonicalSha256(
    "programmable.project-metadata.v1",
    metadata,
  );
  const projectMetadataHash = input.projectMetadataHash
    ?? actualProjectMetadataHash;
  const unboundGraphBundleHash = digest("32");
  const graphBundleHash = input.graphBundleHash ?? canonicalSha256(
    "programmable.custom-graph-project-metadata.v1",
    {
      graphBundleHash: unboundGraphBundleHash,
      projectMetadataHash,
    },
  );
  const providerOrder = input.providerOrder ?? ["primary", "secondary"];
  const tokenName = input.tokenName ?? customGraphExploreEntry.name;
  const tokenSymbol = input.tokenSymbol ?? customGraphExploreEntry.symbol;
  const readbackStatus = input.readbackStatus ?? "matching";
  const checkpointHash = hex32("90");

  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata.v1",
    resourceId: input.resourceId ?? "123e4567-e89b-42d3-a456-426614174000",
    routerLaunchId: input.routerLaunchId
      ?? customGraphExploreEntry.launchStampProvenance.launchId,
    launchProfileVersion: input.launchProfileVersion ?? "3.3.0",
    chainId: "1",
    router: customGraphExploreEntry.launchStampProvenance.routerAddress,
    token: input.tokenAddress ?? customGraphExploreEntry.tokenAddress,
    hook: customGraphExploreEntry.hookAddress,
    poolManager:
      customGraphExploreEntry.launchStampProvenance.poolManagerAddress,
    poolId: customGraphExploreEntry.poolId,
    projectMetadata: metadata,
    projectMetadataHash,
    ...(input.partnerAttribution
      ? { partnerAttribution: input.partnerAttribution }
      : {}),
    bindings: {
      requestHash: digest("33"),
      launchIntentHash: digest("34"),
      graphBundleHash,
      unboundGraphBundleHash,
      artifactHash: digest("35"),
    },
    tokenMetadataReadback: {
      status: readbackStatus,
      declared: {
        name: tokenName,
        symbol: tokenSymbol,
      },
      observed: {
        name: readbackStatus === "unavailable"
          ? null
          : input.observedName ?? tokenName,
        symbol: readbackStatus === "unavailable"
          ? null
          : input.observedSymbol ?? tokenSymbol,
      },
      observedAtBlockNumber: input.observedAtBlockNumber === undefined
        ? "25718017"
        : input.observedAtBlockNumber,
      observedAt: input.observedAt === undefined
        ? "2026-08-25T05:30:00.000Z"
        : input.observedAt,
    },
    finality: {
      state: "finalized",
      transactionHash:
        customGraphExploreEntry.launchStampProvenance.transactionHash,
      blockNumber: customGraphExploreEntry.launchStampProvenance.blockNumber,
      blockHash: customGraphExploreEntry.launchStampProvenance.blockHash,
      logIndex:
        customGraphExploreEntry.launchStampProvenance.launchLogIndex,
      confirmationDepth: "64",
      requiredConfirmationDepth: "64",
      finalizedCheckpoint: {
        schemaVersion:
          "programmable.ethereum-finalized-checkpoint-quorum.v1",
        blockNumber: "25718017",
        blockHash: checkpointHash,
        quorumSize: 2,
        observations: [
          {
            provider: providerOrder[0],
            finalizedBlockNumber: "25718017",
            finalizedBlockHash: hex32("91"),
            commonBlockHash: checkpointHash,
          },
          {
            provider: providerOrder[1],
            finalizedBlockNumber: "25718017",
            finalizedBlockHash: hex32("92"),
            commonBlockHash: checkpointHash,
          },
        ],
      },
    },
    createdAt: input.createdAt ?? "2026-08-25T05:00:00.000Z",
    finalizedAt: input.finalizedAt ?? "2026-08-25T05:31:00.000Z",
  } as const;
}

function feedPage(
  launches: readonly Readonly<Record<string, unknown>>[],
  nextCursor: string | null = null,
  quality?: Readonly<Record<string, unknown>>,
) {
  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata-list.v1",
    generatedAt: GENERATED_AT,
    launches,
    nextCursor,
    ...(quality ? { quality } : {}),
  } as const;
}

function completeFeedQuality(publishedRowCount: number) {
  return {
    status: "complete",
    sourceRowCount: publishedRowCount,
    publishedRowCount,
    quarantinedRowCount: 0,
    diagnostics: [],
  } as const;
}

function partialFeedQuality(publishedRowCount: number) {
  return {
    status: "partial",
    sourceRowCount: publishedRowCount + 1,
    publishedRowCount,
    quarantinedRowCount: 1,
    diagnostics: [{
      rowIndex: publishedRowCount,
      code: "FINALIZED_ROW_QUARANTINED",
    }],
  } as const;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "cache-control": "public, max-age=15, stale-while-revalidate=300",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function parsedFeed(
  launch: Readonly<Record<string, unknown>> = launchFixture(),
) {
  return await readFinalizedCustomLaunchMetadataPagesV1({
    fetchFeed: (async () => jsonResponse(feedPage([launch]))) as typeof fetch,
    now: () => NOW,
    timeoutMs: 50,
  });
}

function routerSnapshot() {
  return Object.freeze({
    schemaVersion: "programmable.router-custom-identity-snapshot.v1",
    source: "canonical-launch-stamp-router",
    status: "current" as const,
    generatedAt: GENERATED_AT,
    asOfBlock: "25718017",
    asOfBlockHash: hex32("93"),
    finalityConfirmations: 64,
    identityCommitment: digest("94"),
    entries: Object.freeze([
      Object.freeze({
        ...customGraphExploreEntry,
        description: "Prior presentation",
        imageUrl: "https://prior.example.com/image.png",
        links: [{ kind: "website" as const, url: "https://prior.example.com/" }],
      }),
    ]),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finalized Custom launch metadata feed v1", () => {
  it.each([
    ["complete", completeFeedQuality(1)],
    ["partial", partialFeedQuality(1)],
  ])("accepts and validates the documented %s page-quality envelope", async (
    _status,
    quality,
  ) => {
    const launch = launchFixture();
    const feed = await readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed: (async () => jsonResponse(feedPage(
        [launch],
        null,
        quality,
      ))) as typeof fetch,
      now: () => NOW,
      timeoutMs: 50,
    });

    expect(feed.launches).toHaveLength(1);
    expect(feed.launches[0]?.routerLaunchId).toBe(launch.routerLaunchId);
  });

  it("keeps the legacy list page without quality compatible", async () => {
    const launch = launchFixture();
    const feed = await readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed: (async () => jsonResponse(feedPage([launch]))) as typeof fetch,
      now: () => NOW,
      timeoutMs: 50,
    });

    expect(feed.launches[0]?.routerLaunchId).toBe(launch.routerLaunchId);
  });

  it("indexes profile 3.5.0 only with the exact bound project metadata", async () => {
    const launch = launchFixture({ launchProfileVersion: "3.5.0" });
    const feed = await parsedFeed(launch);
    expect(feed.launches[0]).toMatchObject({
      launchProfileVersion: "3.5.0",
      projectMetadataHash: launch.projectMetadataHash,
      token: launch.token,
    });
    await expect(parsedFeed({ ...launch, projectMetadataHash: digest("ff") }))
      .rejects.toThrow();
    await expect(parsedFeed({ ...launch, projectMetadata: null, projectMetadataHash: null }))
      .rejects.toThrow();
  });

  it("accepts legacy finalized entries with explicit null metadata keyed by launchProfileVersion", async () => {
    const current = launchFixture({ launchProfileVersion: "3.1.0" });
    const legacy = {
      ...current,
      projectMetadata: null,
      projectMetadataHash: null,
      bindings: {
        ...current.bindings,
        graphBundleHash: current.bindings.unboundGraphBundleHash,
      },
    } as const;
    const feed = await parsedFeed(legacy);

    expect(feed.launches[0]).toMatchObject({
      launchProfileVersion: "3.1.0",
      projectMetadata: null,
      projectMetadataHash: null,
    });
  });

  it.each([
    {
      name: "unknown quality key",
      quality: { ...completeFeedQuality(1), extra: true },
    },
    {
      name: "unsupported status",
      quality: { ...completeFeedQuality(1), status: "unknown" },
    },
    {
      name: "published count mismatch",
      quality: { ...completeFeedQuality(1), publishedRowCount: 0 },
    },
    {
      name: "broken source accounting",
      quality: { ...completeFeedQuality(1), sourceRowCount: 2 },
    },
    {
      name: "partial status without quarantine",
      quality: { ...completeFeedQuality(1), status: "partial" },
    },
    {
      name: "wrong diagnostic code",
      quality: {
        status: "partial",
        sourceRowCount: 2,
        publishedRowCount: 1,
        quarantinedRowCount: 1,
        diagnostics: [{ rowIndex: 1, code: "UNKNOWN" }],
      },
    },
    {
      name: "duplicate diagnostic row",
      quality: {
        status: "partial",
        sourceRowCount: 3,
        publishedRowCount: 1,
        quarantinedRowCount: 2,
        diagnostics: [
          { rowIndex: 1, code: "FINALIZED_ROW_QUARANTINED" },
          { rowIndex: 1, code: "FINALIZED_ROW_QUARANTINED" },
        ],
      },
    },
  ])("rejects malformed page quality: $name", async ({ quality }) => {
    await expect(readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed: (async () => jsonResponse(feedPage(
        [launchFixture()],
        null,
        quality,
      ))) as typeof fetch,
      now: () => NOW,
      timeoutMs: 50,
    })).rejects.toThrow(/metadata quality/u);
  });

  it("repairs placeholder identity text only after matching token readback", async () => {
    const snapshot = routerSnapshot();
    const placeholders = { ...snapshot, entries: snapshot.entries.map(entry => ({
      ...entry, name: "Custom token", symbol: "A753915BD7",
    })) };
    for (const readbackStatus of ["matching", "unavailable"] as const) {
      const feed = await parsedFeed(launchFixture({ readbackStatus }));
      const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(placeholders, { readFeed: async () => feed });
      expect(result.identityCommitment).toBe(snapshot.identityCommitment);
      expect(result.entries[0]?.symbol).toBe(readbackStatus === "matching" ? customGraphExploreEntry.symbol : "A753915BD7");
    }
  });

  it("binds immutable partner attribution into the public Router overlay", async () => {
    const feed = await parsedFeed(launchFixture({
      partnerAttribution: PARTNER_ATTRIBUTION,
    }));
    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      routerSnapshot(),
      { readFeed: async () => feed },
    );
    expect(feed.launches[0]?.partnerAttribution).toEqual(PARTNER_ATTRIBUTION);
    expect((result.entries[0] as typeof result.entries[number] & {
      partnerAttribution?: typeof PARTNER_ATTRIBUTION;
    })?.partnerAttribution).toEqual(PARTNER_ATTRIBUTION);
    expect((result as typeof result & {
      metadataOverlay?: { appliedBindings: readonly Record<string, unknown>[] };
    }).metadataOverlay?.appliedBindings[0]?.partnerAttribution).toEqual(
      PARTNER_ATTRIBUTION,
    );
  });

  it("rejects caller-shaped partner attribution instead of projecting it", async () => {
    await expect(parsedFeed({
      ...launchFixture(),
      partnerAttribution: {
        ...PARTNER_ATTRIBUTION,
        attributionSource: "request-body",
      },
    } as unknown as ReturnType<typeof launchFixture>)).rejects.toThrow(
      "partner attribution is invalid",
    );
  });

  it("rejects altered partner attribution with a stale snapshot digest", async () => {
    await expect(parsedFeed({
      ...launchFixture(),
      partnerAttribution: {
        ...PARTNER_ATTRIBUTION,
        name: "Altered partner",
      },
    } as unknown as ReturnType<typeof launchFixture>)).rejects.toThrow(
      "partner attribution digest is invalid",
    );
  });

  it("quarantines an invalid trade descriptor without hiding launch metadata", async () => {
    const feed = await parsedFeed({
      ...launchFixture(),
      tradeAdapterDescriptor: {
        schemaVersion: "caller-authored",
      },
    } as unknown as ReturnType<typeof launchFixture>);
    expect(feed.launches[0]?.tradeAdapterDescriptor).toBeUndefined();

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      routerSnapshot(),
      { readFeed: async () => feed },
    );
    expect(result.entries[0]?.description).toBe(
      "A finalized Custom Graph project.",
    );
    if ("metadataOverlay" in result) {
      expect(
        result.metadataOverlay.appliedBindings[0]?.tradeAdapterDescriptor,
      ).toBeUndefined();
    }
  });

  it("strictly parses and hash-binds every page of the finalized inventory", async () => {
    const first = launchFixture();
    const second = launchFixture({
      resourceId: "123e4567-e89b-42d3-a456-426614174001",
      routerLaunchId: hex32("45"),
      createdAt: "2026-08-25T04:59:00.000Z",
      finalizedAt: "2026-08-25T05:00:00.000Z",
    });
    const fetchFeed = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      void _init;
      const url = new URL(String(input));
      return url.searchParams.get("cursor") === null
        ? jsonResponse(feedPage([first], PAGE_CURSOR))
        : jsonResponse(feedPage([second]));
    });

    const feed = await readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed: fetchFeed as typeof fetch,
      now: () => NOW,
      timeoutMs: 50,
    });

    expect(feed).toMatchObject({
      schemaVersion: "programmable.finalized-custom-launch-metadata-list.v1",
      generatedAt: GENERATED_AT,
      launches: [
        {
          resourceId: first.resourceId,
          routerLaunchId: first.routerLaunchId,
          launchProfileVersion: first.launchProfileVersion,
        },
        {
          resourceId: second.resourceId,
          routerLaunchId: second.routerLaunchId,
          launchProfileVersion: second.launchProfileVersion,
        },
      ],
    });
    expect(feed.launches[0]?.projectMetadataHash).toBe(canonicalSha256(
      "programmable.project-metadata.v1",
      feed.launches[0]?.projectMetadata,
    ));
    expect(feed.launches[0]?.bindings.graphBundleHash).toBe(canonicalSha256(
      "programmable.custom-graph-project-metadata.v1",
      {
        graphBundleHash:
          feed.launches[0]?.bindings.unboundGraphBundleHash,
        projectMetadataHash: feed.launches[0]?.projectMetadataHash,
      },
    ));
    expect(Object.isFrozen(feed)).toBe(true);
    expect(Object.isFrozen(feed.launches[0]?.projectMetadata)).toBe(true);
    expect(fetchFeed).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchFeed.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchFeed.mock.calls[1]?.[0]));
    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
      FINALIZED_CUSTOM_LAUNCH_METADATA_FEED_URL,
    );
    expect(firstUrl.searchParams.get("limit")).toBe("25");
    expect(firstUrl.searchParams.has("cursor")).toBe(false);
    expect(secondUrl.searchParams.get("cursor")).toBe(PAGE_CURSOR);
    expect(fetchFeed.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("preserves bounded raw readback strings and binds their block to the checkpoint", async () => {
    const rawName = "  noncanonical onchain name  ";
    const feed = await parsedFeed(launchFixture({
      readbackStatus: "mismatch",
      observedName: rawName,
      observedSymbol: "",
    }));
    expect(feed.launches[0]?.tokenMetadataReadback.observed).toEqual({
      name: rawName,
      symbol: "",
    });

    await expect(parsedFeed(launchFixture({
      observedAtBlockNumber: "25718018",
    }))).rejects.toThrow("token metadata readback block is invalid");
  });

  it("fails soft on invalid Unicode metadata without hiding Router identity", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const base = launchFixture();
    const unsafeText = {
      ...base,
      projectMetadata: {
        ...base.projectMetadata,
        presentation: {
          ...base.projectMetadata.presentation,
          description: `unsafe${String.fromCharCode(0xd800)}`,
        },
      },
    } as unknown as ReturnType<typeof launchFixture>;
    const unsafeArgumentName = {
      ...base,
      projectMetadata: {
        ...base.projectMetadata,
        tokenMetadataBinding: {
          ...base.projectMetadata.tokenMetadataBinding,
          name: {
            ...base.projectMetadata.tokenMetadataBinding.name,
            argumentName: `name${String.fromCharCode(0xdc00)}`,
          },
        },
      },
    } as unknown as ReturnType<typeof launchFixture>;

    await expect(parsedFeed(unsafeArgumentName)).rejects.toThrow(
      /surrogate|project token metadata field binding is invalid/u,
    );
    const snapshot = routerSnapshot();
    await expect(enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed: async () => await parsedFeed(unsafeText) },
    )).resolves.toBe(snapshot);
  });

  it.each([
    "https://metadata.local/",
    "https://metadata.local./",
    "https://localhost./",
    "https://metadata.localhost./",
  ])("rejects local presentation URLs fail closed: %s", async (uri) => {
    const base = launchFixture();
    const unsafeUrl = {
      ...base,
      projectMetadata: {
        ...base.projectMetadata,
        presentation: {
          ...base.projectMetadata.presentation,
          links: base.projectMetadata.presentation.links.map((link) =>
            link.kind === "website" ? { ...link, uri } : link),
        },
      },
    } as unknown as ReturnType<typeof launchFixture>;

    await expect(parsedFeed(unsafeUrl)).rejects.toThrow(
      "Project metadata HTTPS URI is invalid",
    );
  });

  it("fails soft when DLP rejects raw or decoded Programmable credentials", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const base = launchFixture();
    const presentation = base.projectMetadata.presentation;
    const candidates = [
      {
        ...base,
        projectMetadata: {
          ...base.projectMetadata,
          presentation: {
            ...presentation,
            description: `credential ${SYNTHETIC_PROGRAMMABLE_API_KEY}`,
          },
        },
      },
      {
        ...base,
        projectMetadata: {
          ...base.projectMetadata,
          presentation: {
            ...presentation,
            description: "programmable_api_key = redacted",
          },
        },
      },
      {
        ...base,
        tokenMetadataReadback: {
          ...base.tokenMetadataReadback,
          status: "mismatch",
          observed: {
            name: SYNTHETIC_PROGRAMMABLE_API_KEY,
            symbol: base.tokenMetadataReadback.declared.symbol,
          },
        },
      },
      {
        ...base,
        projectMetadata: {
          ...base.projectMetadata,
          tokenMetadataBinding: {
            ...base.projectMetadata.tokenMetadataBinding,
            tokenTargetId: SYNTHETIC_PROGRAMMABLE_API_KEY,
          },
        },
      },
      {
        ...base,
        projectMetadata: {
          ...base.projectMetadata,
          tokenMetadataBinding: {
            ...base.projectMetadata.tokenMetadataBinding,
            name: {
              ...base.projectMetadata.tokenMetadataBinding.name,
              argumentName: SYNTHETIC_PROGRAMMABLE_API_KEY,
            },
          },
        },
      },
      {
        ...base,
        projectMetadata: {
          ...base.projectMetadata,
          presentation: {
            ...presentation,
            links: presentation.links.map((link) => link.kind === "website"
              ? {
                  ...link,
                  uri: `https://example.com/?ref=${
                    SYNTHETIC_PROGRAMMABLE_API_KEY.replace("_", "%5F")
                  }`,
                }
              : link),
          },
        },
      },
    ] as unknown as readonly ReturnType<typeof launchFixture>[];
    const snapshot = routerSnapshot();

    for (const candidate of candidates) {
      const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
        snapshot,
        { readFeed: async () => await parsedFeed(candidate) },
      );
      expect(result).toBe(snapshot);
      expect("metadataOverlay" in result).toBe(false);
    }
  });

  it("keeps onchain token identity authoritative while applying bound presentation", async () => {
    const snapshot = routerSnapshot();
    const feed = await parsedFeed();

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed: async () => feed },
    );

    expect(result).not.toBe(snapshot);
    expect(result.identityCommitment).toBe(snapshot.identityCommitment);
    expect(result.entries[0]).toMatchObject({
      name: customGraphExploreEntry.name,
      symbol: customGraphExploreEntry.symbol,
      tokenDecimals: customGraphExploreEntry.tokenDecimals,
      description: "A finalized Custom Graph project.",
      imageUrl:
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/custom-graph.webp`,
      projectMetadataStatus: "current",
      links: [
        { kind: "telegram", url: "https://t.me/customgraph" },
        { kind: "website", url: "https://example.com/custom-graph" },
        { kind: "x", url: "https://x.com/customgraph" },
      ],
      projectMetadataLinks: [
        {
          kind: "discord",
          url: "https://discord.com/invite/customgraph",
        },
        {
          kind: "documentation",
          url: "https://docs.example.com/custom-graph",
        },
        {
          kind: "github",
          url: "https://github.com/example/custom-graph",
        },
        {
          kind: "other",
          url: "https://community.example.com/custom-graph",
        },
        { kind: "telegram", url: "https://t.me/customgraph" },
        { kind: "website", url: "https://example.com/custom-graph" },
        { kind: "x", url: "https://x.com/customgraph" },
      ],
    });
    expect(result.entries[0]?.links).not.toContainEqual(expect.objectContaining({
      kind: "documentation",
    }));

    const overlay = (result as typeof result & Readonly<{
      metadataOverlay?: Readonly<{
        schemaVersion: string;
        source: string;
        status: string;
        generatedAt: string;
        routerIdentityCommitment: `sha256:${string}`;
        appliedBindings: readonly Readonly<Record<string, unknown>>[];
        metadataCommitment: `sha256:${string}`;
      }>;
    }>).metadataOverlay;
    expect(overlay).toMatchObject({
      schemaVersion: METADATA_OVERLAY_SCHEMA,
      source: "programmable-finalized-custom-launch-metadata-feed",
      status: "current",
      generatedAt: GENERATED_AT,
      routerIdentityCommitment: snapshot.identityCommitment,
      appliedBindings: [{
        routerLaunchId:
          customGraphExploreEntry.launchStampProvenance.launchId,
        router: customGraphExploreEntry.launchStampProvenance.routerAddress,
        token: customGraphExploreEntry.tokenAddress,
        hook: customGraphExploreEntry.hookAddress,
        poolManager:
          customGraphExploreEntry.launchStampProvenance.poolManagerAddress,
        poolId: customGraphExploreEntry.poolId,
        projectMetadataHash: feed.launches[0]?.projectMetadataHash,
        requestHash: feed.launches[0]?.bindings.requestHash,
        launchIntentHash: feed.launches[0]?.bindings.launchIntentHash,
        graphBundleHash: feed.launches[0]?.bindings.graphBundleHash,
        unboundGraphBundleHash:
          feed.launches[0]?.bindings.unboundGraphBundleHash,
        artifactHash: feed.launches[0]?.bindings.artifactHash,
        tokenMetadataReadback: {
          status: "matching",
          observedAtBlockNumber: "25718017",
          observedAt: "2026-08-25T05:30:00.000Z",
        },
      }],
    });
    expect(overlay?.metadataCommitment).toBe(canonicalSha256(
      METADATA_OVERLAY_SCHEMA,
      {
        source: overlay?.source,
        generatedAt: overlay?.generatedAt,
        routerIdentityCommitment: overlay?.routerIdentityCommitment,
        appliedBindings: overlay?.appliedBindings,
      },
    ));
  });

  it.each([
    {
      imageUri:
        "ipfs://QmYwAPJzv5CZsnAzt8auVZRnG9n4FJSj3cKX5Q9zVqvJf8",
      expected:
        "https://ipfs.io/ipfs/QmYwAPJzv5CZsnAzt8auVZRnG9n4FJSj3cKX5Q9zVqvJf8",
    },
    {
      imageUri: `ar://${"a".repeat(43)}`,
      expected: `https://arweave.net/${"a".repeat(43)}`,
    },
  ])("projects $imageUri through the trusted image gateway", async ({
    imageUri,
    expected,
  }) => {
    const snapshot = routerSnapshot();
    const feed = await parsedFeed(launchFixture({ imageUri }));

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed: async () => feed },
    );

    expect(result.identityCommitment).toBe(snapshot.identityCommitment);
    expect(result.entries[0]).toMatchObject({ imageUrl: expected });
  });

  it("displays the approved public HTTPS image without changing the launch identity", async () => {
    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      routerSnapshot(),
      {
        readFeed: async () => await parsedFeed(launchFixture({
          imageUri: "https://assets.example.com/mutable-project.webp",
        })),
      },
    );

    expect(result.entries[0]).toMatchObject({
      description: "A finalized Custom Graph project.",
      projectMetadataStatus: "current",
    });
    expect(result.entries[0]?.imageUrl).toBe("https://assets.example.com/mutable-project.webp");
  });

  it("keeps Router identity and drops an untrusted image URL", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const snapshot = routerSnapshot();

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      {
        readFeed: async () => await parsedFeed(launchFixture({
          imageUri: "https://127.0.0.1/project.png",
        })),
      },
    );

    expect(result).toBe(snapshot);
    expect(result.entries[0]?.imageUrl).toBe(
      "https://prior.example.com/image.png",
    );
  });

  it.each([
    {
      caseName: "Router identity",
      launch: launchFixture({
        tokenAddress: "0x3333333333333333333333333333333333333333",
      }),
    },
    {
      caseName: "project graph commitment",
      launch: launchFixture({ graphBundleHash: digest("fe") }),
    },
    {
      caseName: "finality provider quorum",
      launch: launchFixture({ providerOrder: ["secondary", "primary"] }),
    },
  ])("fails soft on a $caseName mismatch without replacing healthy Router identity", async ({
    caseName,
    launch,
  }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const snapshot = routerSnapshot();
    const readFeed = caseName === "Router identity"
      ? async () => await parsedFeed(launch)
      : async () => await readFinalizedCustomLaunchMetadataPagesV1({
        fetchFeed: (async () => jsonResponse(feedPage([launch]))) as typeof fetch,
        now: () => NOW,
        timeoutMs: 50,
      });

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed },
    );

    expect(result).toBe(snapshot);
    expect(result.entries).toBe(snapshot.entries);
    expect(result.entries[0]).toBe(snapshot.entries[0]);
    expect("metadataOverlay" in result).toBe(false);
  });

  it("applies unavailable-readback presentation without overriding onchain token identity", async () => {
    const snapshot = routerSnapshot();
    const feed = await parsedFeed(launchFixture({
      readbackStatus: "unavailable",
      standardReadModel: { name: false, symbol: false },
    }));

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed: async () => feed },
    );

    expect(result).not.toBe(snapshot);
    expect(result.entries[0]).toMatchObject({
      name: customGraphExploreEntry.name,
      symbol: customGraphExploreEntry.symbol,
      tokenDecimals: customGraphExploreEntry.tokenDecimals,
      description: "A finalized Custom Graph project.",
    });
    expect("metadataOverlay" in result).toBe(true);
    if ("metadataOverlay" in result) {
      expect(
        result.metadataOverlay.appliedBindings[0]?.tokenMetadataReadback.status,
      ).toBe("unavailable");
    }
  });

  it("omits only the mismatching declaration while enriching another bound entry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const original = routerSnapshot();
    const secondLaunchId = hex32("45");
    const secondToken = "0x3333333333333333333333333333333333333333";
    const secondEntry = Object.freeze({
      ...original.entries[0]!,
      id: "token:1:0x3333333333333333333333333333333333333333",
      tokenAddress: secondToken,
      launchStampProvenance: Object.freeze({
        ...original.entries[0]!.launchStampProvenance,
        launchId: secondLaunchId,
      }),
    });
    const snapshot = Object.freeze({
      ...original,
      entries: Object.freeze([original.entries[0]!, secondEntry]),
    });
    const mismatching = launchFixture({
      readbackStatus: "mismatch",
      observedName: "Observed Graph",
    });
    const matching = launchFixture({
      resourceId: "123e4567-e89b-42d3-a456-426614174001",
      routerLaunchId: secondLaunchId,
      tokenAddress: secondToken,
      createdAt: "2026-08-25T04:59:00.000Z",
      finalizedAt: "2026-08-25T05:00:00.000Z",
    });
    const feed = await readFinalizedCustomLaunchMetadataPagesV1({
      fetchFeed: (async () =>
        jsonResponse(feedPage([mismatching, matching]))) as typeof fetch,
      now: () => NOW,
      timeoutMs: 50,
    });

    const result = await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
      snapshot,
      { readFeed: async () => feed },
    );

    expect(result).not.toBe(snapshot);
    expect(result.entries[0]).toBe(snapshot.entries[0]);
    expect(result.entries[0]).toMatchObject({
      name: customGraphExploreEntry.name,
      symbol: customGraphExploreEntry.symbol,
      tokenDecimals: customGraphExploreEntry.tokenDecimals,
      description: "Prior presentation",
    });
    expect(result.entries[1]).toMatchObject({
      tokenAddress: secondToken,
      description: "A finalized Custom Graph project.",
    });
    expect("metadataOverlay" in result).toBe(true);
    if ("metadataOverlay" in result) {
      expect(result.metadataOverlay.appliedBindings).toHaveLength(1);
      expect(result.metadataOverlay.appliedBindings[0]?.routerLaunchId).toBe(
        secondLaunchId,
      );
    }
  });

  it("bounds its cache and serves only a time-limited last-known-good feed", async () => {
    let now = NOW;
    const fetchFeed = vi.fn()
      .mockImplementationOnce(async () => jsonResponse(feedPage([
        launchFixture(),
      ])))
      .mockRejectedValue(new Error("provider unavailable"));
    const readFeed = createFinalizedCustomLaunchMetadataFeedReaderV1({
      fetchFeed: fetchFeed as typeof fetch,
      now: () => now,
      timeoutMs: 50,
    });

    const current = await readFeed();
    expect(current.status).toBe("current");

    now += FINALIZED_CUSTOM_LAUNCH_METADATA_CACHE_TTL_MS - 1;
    await expect(readFeed()).resolves.toBe(current);
    expect(fetchFeed).toHaveBeenCalledTimes(1);

    now += 2;
    const lastKnownGood = await readFeed();
    expect(lastKnownGood.status).toBe("last-known-good");
    expect(lastKnownGood.launches).toBe(current.launches);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    const projectedLastKnownGood =
      await enrichRouterCustomSnapshotWithFinalizedMetadataV1(
        routerSnapshot(),
        { readFeed: async () => lastKnownGood },
      );
    expect(projectedLastKnownGood.entries[0]).toMatchObject({
      projectMetadataStatus: "last-known-good",
    });

    now = NOW + FINALIZED_CUSTOM_LAUNCH_METADATA_LKG_TTL_MS + 1;
    await expect(readFeed()).rejects.toThrow("provider unavailable");
    expect(fetchFeed).toHaveBeenCalledTimes(3);
  });
});
