import "server-only";

import { getAddress, isAddress } from "viem";

import { readFinalizedRouterCustomExploreEntriesV1 } from
  "../../alchemy/router-custom-public.server";
import { readClassicLaunchCatalogV1 } from
  "../../market-data/classic-launch-catalog.server";
import {
  isLaunchStampProvenanceV1,
  type ExploreEntry,
} from "../../tokens";
import type { LaunchPartnerAttributionV1 } from
  "../../launch-partner-attribution";
import { readProductionCustomExploreDirectoryV1 } from
  "../custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../custom-launch/public-readiness";
import type { AuthenticatedWalletPrincipalV1 } from "./wallet-principal.server";

const MAIN_TOKEN = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";

export type CreatorArticleAuthorityV1 = Readonly<{
  chainId: 1;
  tokenAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  source:
    | "codex-classic-launches"
    | "canonical-classic-launcher-rpc"
    | "registry.custom-launched"
    | "canonical-launch-stamp-router"
    | "official-main-token";
  name: string;
  symbol: string | null;
  imageUrl: string | null;
  partnerAttribution?: LaunchPartnerAttributionV1;
  hasArticle?: boolean;
}>;

export interface CreatorArticleAuthorityReaderV1 {
  read(signal: AbortSignal): Promise<readonly CreatorArticleAuthorityV1[]>;
}

type CreatorArticleAuthorityCandidateV1 = Readonly<{
  lane: "classic" | "custom" | "router";
  authority: CreatorArticleAuthorityV1;
  poolId: string | null;
}>;

function mergeCreatorArticleAuthorityCandidateV1(
  existing: CreatorArticleAuthorityCandidateV1,
  candidate: CreatorArticleAuthorityCandidateV1,
) {
  const isRegistryRouterDuplicate =
    (existing.lane === "custom" && candidate.lane === "router")
    || (existing.lane === "router" && candidate.lane === "custom");
  if (
    isRegistryRouterDuplicate
    && existing.authority.creatorAddress.toLowerCase()
      === candidate.authority.creatorAddress.toLowerCase()
    && existing.poolId !== null
    && candidate.poolId !== null
    && existing.poolId === candidate.poolId
  ) {
    return existing.lane === "router" ? existing : candidate;
  }
  throw new TypeError("Creator article token authority is ambiguous");
}

export function createCreatorArticleAuthorityReaderV1(input: Readonly<{
  readClassic(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
  readCustom(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
  readRouter(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
}>): CreatorArticleAuthorityReaderV1 {
  return Object.freeze({
    async read(signal: AbortSignal) {
      const [classic, custom, router] = await Promise.all([
        input.readClassic(signal).catch(() => Object.freeze([])),
        input.readCustom(signal).catch(() => Object.freeze([])),
        input.readRouter(signal).catch(() => Object.freeze([])),
      ]);
      const projects = new Map<string, CreatorArticleAuthorityCandidateV1>();
      const entries = [
        ...classic.map((entry) => Object.freeze({ lane: "classic" as const, entry })),
        ...custom.map((entry) => Object.freeze({ lane: "custom" as const, entry })),
        ...router.map((entry) => Object.freeze({ lane: "router" as const, entry })),
      ];
      for (const { lane, entry } of entries) {
        if (!entry.tokenAddress || !isAddress(entry.tokenAddress)) continue;
        const tokenAddress = getAddress(entry.tokenAddress);
        let creatorAddress: `0x${string}` | null = null;
        let source: CreatorArticleAuthorityV1["source"] | null = null;
        let poolId: string | null = null;
        if (lane === "classic" && entry.exploreKind === "token") {
          if (!entry.creatorAddress || !isAddress(entry.creatorAddress)) continue;
          creatorAddress = getAddress(entry.creatorAddress);
          source = tokenAddress.toLowerCase() === MAIN_TOKEN
            ? "official-main-token"
            : entry.launchModel === "classic"
                && ["classic-v3", "classic-v4"].includes(entry.launchModelVersion ?? "")
              ? "canonical-classic-launcher-rpc"
              : null;
        } else if (lane === "custom" && entry.exploreKind === "custom-project") {
          if (
            entry.chainId !== "1"
            || entry.launchCategoryProvenance.category !== "custom"
            || entry.launchCategoryProvenance.source !== "registry.custom-launched"
            || entry.launchingWallet.namespace !== "eip155:1"
            || !isAddress(entry.launchingWallet.value)
          ) continue;
          creatorAddress = getAddress(entry.launchingWallet.value);
          source = "registry.custom-launched";
          const poolIds = [...new Set(
            entry.markets.flatMap((market) =>
              market.poolId ? [market.poolId.toLowerCase()] : []),
          )];
          poolId = poolIds.length === 1 ? poolIds[0] : null;
        } else if (
          lane === "router"
          && entry.exploreKind === "token"
          && entry.launchModel === "custom-graph"
          && entry.launchModelVersion === "programmable-launch-stamp-router-v1"
          && entry.launchCategoryProvenance.category === "custom"
          && entry.launchCategoryProvenance.source ===
            "canonical-launch-stamp-router"
          && entry.launchStampProvenance?.kind === "custom-graph"
          && isLaunchStampProvenanceV1(entry.launchStampProvenance, {
            chainId: 1,
            tokenAddress,
            hookAddress: entry.hookAddress,
            poolId: entry.poolId,
          })
        ) {
          creatorAddress = getAddress(entry.launchStampProvenance.launchWallet);
          source = "canonical-launch-stamp-router";
          poolId = entry.poolId.toLowerCase();
        }
        if (source === null || creatorAddress === null) continue;
        const key = `1:${tokenAddress.toLowerCase()}`;
        const candidate = Object.freeze({
          lane,
          poolId,
          authority: Object.freeze({
            chainId: 1 as const,
            tokenAddress,
            creatorAddress,
            source,
            name: entry.name,
            symbol: entry.symbol ?? null,
            imageUrl: entry.imageUrl ?? null,
            ...(entry.partnerAttribution
              ? { partnerAttribution: entry.partnerAttribution }
              : {}),
          }),
        });
        const existing = projects.get(key);
        projects.set(
          key,
          existing
            ? mergeCreatorArticleAuthorityCandidateV1(existing, candidate)
            : candidate,
        );
      }
      const authorities = [...projects.values()].map(({ authority }) => authority);
      return Object.freeze(authorities.sort((left, right) =>
        left.tokenAddress.toLowerCase().localeCompare(
          right.tokenAddress.toLowerCase(),
        )));
    },
  });
}

export function createProductionCreatorArticleAuthorityReaderV1():
CreatorArticleAuthorityReaderV1 {
  return createCreatorArticleAuthorityReaderV1({
    async readClassic(signal) {
      const catalog = await readClassicLaunchCatalogV1({
        signal,
        deadlineMs: Date.now() + 7_500,
      });
      return catalog.entries;
    },
    async readCustom(signal) {
      if (!isCustomLaunchRegistryPublicReadEnabled()) return Object.freeze([]);
      return readProductionCustomExploreDirectoryV1(signal);
    },
    async readRouter(signal) {
      return readFinalizedRouterCustomExploreEntriesV1({
        signal,
        deadlineMs: Date.now() + 7_500,
      });
    },
  });
}

export async function requireCreatorArticleAuthorityV1(input: Readonly<{
  reader: CreatorArticleAuthorityReaderV1;
  principal: AuthenticatedWalletPrincipalV1;
  tokenAddress: string;
  signal: AbortSignal;
}>): Promise<CreatorArticleAuthorityV1> {
  if (!isAddress(input.tokenAddress)) throw new CreatorArticleAuthorityErrorV1(400, "invalid_token");
  const tokenAddress = getAddress(input.tokenAddress);
  const project = (await input.reader.read(input.signal)).find(
    (candidate) => candidate.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
  );
  if (!project) throw new CreatorArticleAuthorityErrorV1(404, "project_not_found");
  const wallets = new Set(input.principal.wallets.map((wallet) => wallet.toLowerCase()));
  if (!wallets.has(project.creatorAddress.toLowerCase())) {
    throw new CreatorArticleAuthorityErrorV1(403, "creator_wallet_required");
  }
  return project;
}

export async function listCreatorArticleAuthoritiesV1(input: Readonly<{
  reader: CreatorArticleAuthorityReaderV1;
  principal: AuthenticatedWalletPrincipalV1;
  signal: AbortSignal;
}>) {
  const wallets = new Set(input.principal.wallets.map((wallet) => wallet.toLowerCase()));
  return Object.freeze((await input.reader.read(input.signal)).filter(
    (project) => wallets.has(project.creatorAddress.toLowerCase()),
  ));
}

export class CreatorArticleAuthorityErrorV1 extends Error {
  constructor(readonly status: 400 | 403 | 404, readonly code: string) {
    super(code);
    this.name = "CreatorArticleAuthorityErrorV1";
  }
}
