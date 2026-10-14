import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { vi } from "vitest";
import {
  createCreatorArticleAuthorityReaderV1,
  listCreatorArticleAuthoritiesV1,
  requireCreatorArticleAuthorityV1,
} from "../lib/server/creator-article/authority.server";
import {
  createWalletPrincipalAuthenticatorFromBoundaryV1,
} from "../lib/server/creator-article/wallet-principal.server";
import type { ExploreEntry } from "../lib/tokens";
import {
  customGraphExploreEntry,
  launchStampProvenance,
  STAMP_POOL_ID,
  STAMP_TOKEN,
} from "./launch-stamp-surface-fixture";

const CREATOR = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const CUSTOM = "0x4444444444444444444444444444444444444444" as const;

function request() {
  return new Request("https://programmable.market/api/profile/projects", {
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "x-privy-identity-token": `${btoa("header")}.${Buffer.from(JSON.stringify({ sub: "did:privy:user", sid: "session" })).toString("base64url")}.signature`,
    },
  });
}

function classic(): ExploreEntry {
  return {
    exploreKind: "token",
    id: `1:${TOKEN.toLowerCase()}`,
    name: "Classic",
    symbol: "CLASSIC",
    tokenAddress: TOKEN,
    hookAddress: OTHER,
    poolId: `0x${"55".repeat(32)}`,
    creatorAddress: CREATOR,
    launchedAt: "2026-08-21T00:00:00.000Z",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
    totalSwapFeeBps: 100,
    launchCategoryProvenance: {} as never,
  };
}

function custom(input: Readonly<{
  tokenAddress?: `0x${string}`;
  launchingWallet?: `0x${string}`;
  poolId?: `0x${string}`;
}> = {}): ExploreEntry {
  const tokenAddress = input.tokenAddress ?? CUSTOM;
  const projectId = `sha256:${"66".repeat(32)}` as const;
  const launchId = `sha256:${"77".repeat(32)}` as const;
  return {
    exploreKind: "custom-project",
    id: "custom:test",
    name: "Custom",
    symbol: "CUSTOM",
    links: [],
    launchedAt: "2026-08-21T00:00:00.000Z",
    finalizedAt: "2026-08-21T00:00:00.000Z",
    chainId: "1",
    modelId: "custom",
    customProjectId: projectId,
    customLaunchId: launchId,
    launchingWallet: {
      namespace: "eip155:1",
      value: input.launchingWallet ?? CREATOR,
    },
    postLaunchAuthorityInventory: {} as never,
    postLaunchAuthorityInventoryHash: `sha256:${"88".repeat(32)}`,
    markets: input.poolId ? [{
      marketId: `eip155:1/uniswap-v4:${input.poolId}`,
      kind: "uniswap-v4",
      status: "active",
      poolId: input.poolId,
      baseAsset: {
        assetId: `eip155:1/erc20:${tokenAddress}`,
        identity: { namespace: "eip155:1/erc20", value: tokenAddress },
      },
      quoteAsset: {
        assetId: "eip155:1/slip44:60",
        identity: { namespace: "eip155:1/slip44", value: "60" },
      },
    }] : [],
    tokenAddress,
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "registry.custom-launched",
      projectId,
      launchId,
      sourceRecordBindingHash: `sha256:${"aa".repeat(32)}`,
      finalizedLaunchBindingHash: `sha256:${"bb".repeat(32)}`,
      registryAddress: "0x5555555555555555555555555555555555555555",
      registryStartBlock: "25700000",
      transactionHash: `0x${"cc".repeat(32)}`,
      blockHash: `0x${"dd".repeat(32)}`,
      blockNumber: "25700064",
      transactionIndex: 1,
      logIndex: 2,
      configurationHash: `0x${"ee".repeat(32)}`,
    },
  };
}

describe("creator article wallet principal", () => {
  it.each([[429, 503], [503, 503], [401, 401]])("preserves provider error %s as HTTP %s", async (providerStatus, status) => {
    const authenticator = createWalletPrincipalAuthenticatorFromBoundaryV1({ appId: "app", boundary: {
      verifyAccessToken: async () => ({ appId: "app", userId: "did:privy:user", sessionId: "session" }),
      verifyIdentityToken: async () => ({ userId: "did:privy:user", sessionId: "session" }),
      getCurrentUser: async () => { throw Object.assign(new Error("provider failure"), { status: providerStatus }); },
    } });
    await expect(authenticator.authenticate(request())).rejects.toMatchObject({ status });
  });

  it("binds both Privy tokens and returns unique Ethereum wallets", async () => {
    const authenticator = createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app",
      boundary: {
        verifyAccessToken: vi.fn().mockResolvedValue({
          appId: "app", userId: "did:privy:user", sessionId: "session",
        }),
        verifyIdentityToken: vi.fn().mockResolvedValue({
          userId: "did:privy:user", sessionId: "session",
        }),
        getCurrentUser: vi.fn().mockResolvedValue({
          id: "did:privy:user",
          linkedAccounts: [
            { type: "wallet", chainType: "ethereum", address: CREATOR.toLowerCase() },
            { type: "wallet", chainType: "ethereum", address: CREATOR },
            { type: "wallet", chainType: "solana", address: CREATOR },
          ],
        }),
      },
    });
    const principal = await authenticator.authenticate(request());
    expect(principal.wallets).toEqual([CREATOR]);
  });

  it("accepts a verified access session when Privy omits the identity token", async () => {
    const verifyIdentityToken = vi.fn();
    const authenticator = createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app",
      boundary: {
        verifyAccessToken: vi.fn().mockResolvedValue({
          appId: "app", userId: "did:privy:user", sessionId: "session",
        }),
        verifyIdentityToken,
        getCurrentUser: vi.fn().mockResolvedValue({
          id: "did:privy:user",
          linkedAccounts: [
            { type: "wallet", chainType: "ethereum", address: CREATOR },
          ],
        }),
      },
    });
    const accessOnlyRequest = new Request(
      "https://programmable.market/api/profile/projects",
      { headers: { authorization: `Bearer ${"a".repeat(32)}` } },
    );

    await expect(authenticator.authenticate(accessOnlyRequest)).resolves.toEqual({
      privyUserId: "did:privy:user",
      privySessionId: "session",
      wallets: [CREATOR],
    });
    expect(verifyIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects mismatched sessions and missing Ethereum wallets", async () => {
    const base = {
      verifyAccessToken: vi.fn().mockResolvedValue({ appId: "app", userId: "u", sessionId: "s1" }),
      verifyIdentityToken: vi.fn().mockResolvedValue({ userId: "u", sessionId: "s2" }),
      getCurrentUser: vi.fn().mockResolvedValue({ id: "u", linkedAccounts: [] }),
    };
    await expect(createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app", boundary: base,
    }).authenticate(request())).rejects.toMatchObject({ status: 401 });

    base.verifyIdentityToken.mockResolvedValue({ userId: "u", sessionId: "s1" });
    await expect(createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app", boundary: base,
    }).authenticate(request())).rejects.toMatchObject({ status: 403 });
  });
});

describe("creator article launch authority", () => {
  const principal = {
    privyUserId: "u",
    privySessionId: "s",
    wallets: [CREATOR],
  } as const;

  it("allows Classic V3 and Registry-verified Custom for their exact creator", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([classic()]),
      readCustom: vi.fn().mockResolvedValue([custom()]),
      readRouter: vi.fn().mockResolvedValue([]),
    });
    expect((await listCreatorArticleAuthoritiesV1({
      reader, principal, signal: new AbortController().signal,
    })).map(({ tokenAddress }) => tokenAddress)).toEqual([TOKEN, CUSTOM]);
    await expect(requireCreatorArticleAuthorityV1({
      reader, principal, tokenAddress: CUSTOM, signal: new AbortController().signal,
    })).resolves.toMatchObject({ source: "registry.custom-launched" });
  });

  it("keeps Custom fail-closed and rejects a different wallet", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([classic()]),
      readCustom: vi.fn().mockRejectedValue(new Error("Registry unavailable")),
      readRouter: vi.fn().mockRejectedValue(new Error("Router read unavailable")),
    });
    await expect(requireCreatorArticleAuthorityV1({
      reader, principal, tokenAddress: CUSTOM, signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 404 });
    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal: { ...principal, wallets: [OTHER] },
      tokenAddress: TOKEN,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("does not grant authority to a non-Registry Custom projection", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([{
        ...custom(),
        launchCategoryProvenance: {
          category: "custom",
          source: "interface-preview",
        } as never,
      }]),
      readRouter: vi.fn().mockResolvedValue([]),
    });

    await expect(reader.read(new AbortController().signal)).resolves.toEqual([]);
  });

  it("uses the validated Router stamp wallet instead of the display creator", async () => {
    const routerEntry = {
      ...customGraphExploreEntry,
      creatorAddress: OTHER,
    } satisfies ExploreEntry;
    const routerPrincipal = {
      ...principal,
      wallets: [launchStampProvenance.launchWallet],
    };
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([]),
      readRouter: vi.fn().mockResolvedValue([routerEntry]),
    });

    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal: routerPrincipal,
      tokenAddress: STAMP_TOKEN,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      tokenAddress: STAMP_TOKEN,
      creatorAddress: launchStampProvenance.launchWallet,
      source: "canonical-launch-stamp-router",
    });
    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal: { ...principal, wallets: [OTHER] },
      tokenAddress: STAMP_TOKEN,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("keeps Router article authority available during a Classic read outage", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockRejectedValue(new Error("Classic unavailable")),
      readCustom: vi.fn().mockResolvedValue([]),
      readRouter: vi.fn().mockResolvedValue([customGraphExploreEntry]),
    });

    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal: {
        ...principal,
        wallets: [launchStampProvenance.launchWallet],
      },
      tokenAddress: STAMP_TOKEN,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      creatorAddress: launchStampProvenance.launchWallet,
      source: "canonical-launch-stamp-router",
    });
  });

  it("deduplicates an exact Registry and Router launch after matching their launch wallets", async () => {
    const registryEntry = custom({
      tokenAddress: STAMP_TOKEN,
      launchingWallet: launchStampProvenance.launchWallet,
      poolId: STAMP_POOL_ID,
    });
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([registryEntry]),
      readRouter: vi.fn().mockResolvedValue([customGraphExploreEntry]),
    });

    await expect(listCreatorArticleAuthoritiesV1({
      reader,
      principal: { ...principal, wallets: [launchStampProvenance.launchWallet] },
      signal: new AbortController().signal,
    })).resolves.toEqual([
      expect.objectContaining({
        tokenAddress: STAMP_TOKEN,
        creatorAddress: launchStampProvenance.launchWallet,
        source: "canonical-launch-stamp-router",
        name: "Custom Graph",
      }),
    ]);
  });

  it.each([
    {
      name: "launching wallet",
      registry: custom({
        tokenAddress: STAMP_TOKEN,
        launchingWallet: OTHER,
        poolId: STAMP_POOL_ID,
      }),
    },
    {
      name: "pool binding",
      registry: custom({
        tokenAddress: STAMP_TOKEN,
        launchingWallet: launchStampProvenance.launchWallet,
        poolId: `0x${"99".repeat(32)}`,
      }),
    },
  ])("fails closed when Registry and Router disagree on $name", async ({ registry }) => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([registry]),
      readRouter: vi.fn().mockResolvedValue([customGraphExploreEntry]),
    });

    await expect(reader.read(new AbortController().signal)).rejects.toThrow(
      "Creator article token authority is ambiguous",
    );
  });

  it("fails closed when Router authority is duplicated", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([]),
      readRouter: vi.fn().mockResolvedValue([
        customGraphExploreEntry,
        customGraphExploreEntry,
      ]),
    });

    await expect(listCreatorArticleAuthoritiesV1({
      reader,
      principal: { ...principal, wallets: [launchStampProvenance.launchWallet] },
      signal: new AbortController().signal,
    })).rejects.toThrow("Creator article token authority is ambiguous");
  });

  it("rejects a Router row whose launch stamp is not valid", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([]),
      readCustom: vi.fn().mockResolvedValue([]),
      readRouter: vi.fn().mockResolvedValue([{
        ...customGraphExploreEntry,
        creatorAddress: CREATOR,
        launchStampProvenance: {
          ...launchStampProvenance,
          launchWallet: "0x0000000000000000000000000000000000000000" as const,
        },
      } satisfies ExploreEntry]),
    });

    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal,
      tokenAddress: STAMP_TOKEN,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 404 });
  });
});
