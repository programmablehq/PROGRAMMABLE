import "server-only";

import { unstable_cache } from "next/cache";

import { getWebsiteReadOnchainDeployment } from "../onchain/config";
import {
  safeOperationalRpcError,
  withOperationalRpcFailover,
} from "../onchain/operational-rpc-failover.server";
import { safeOfficialV4LiquidityEvidenceReadError } from
  "../onchain/uniswap-v4-subgraph";
import { readDurableExploreModel } from "../onchain/durable-model";
import { advanceExploreLaunchDiscovery } from "../onchain/read-model";
import type {
  ExploreReadModel,
  OnchainDeployment,
  ReadyOnchainDeployment,
} from "../onchain/types";
import type { LauncherToken } from "../tokens";
import {
  advanceLaunchStampRouterSlice,
  LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
} from "./launch-stamp.server";
import {
  readAlchemyLaunchRegistry,
  writeAlchemyLaunchRegistry,
  type AlchemyLaunchCursor,
  type AlchemyLaunchRegistry,
  type AlchemyLaunchStampRouterRegistry,
} from "./launch-registry.server";

export const ALCHEMY_EXPLORE_CACHE_TAG = "alchemy-explore-v1";

const ALCHEMY_RPC_HOST = "eth-mainnet.g.alchemy.com";
const ALCHEMY_RPC_PATH = /^\/v2\/([A-Za-z0-9_-]{8,256})$/u;
const ALCHEMY_PRICE_CACHE_TTL_MS = 10_000;
const MAX_ALCHEMY_PRICE_ADDRESSES = 20;
const MAX_CONCURRENT_ALCHEMY_PRICE_BATCHES = 5;
const MAX_ALCHEMY_PRICE_AGE_MS = 5 * 60 * 1_000;
const MAX_ALCHEMY_PRICE_CLOCK_SKEW_MS = 60 * 1_000;
const MAX_PRICE_CACHE_ENTRIES = 100;
const LAUNCH_CURSOR_PERSIST_INTERVAL_BLOCKS = 64n;
const USD_WAD = 10n ** 18n;

type AlchemyPrice = Readonly<{
  currency: string;
  value: string;
  lastUpdatedAt: string;
}>;

type AlchemyPriceResult = Readonly<{
  network: string;
  address: string;
  prices: readonly AlchemyPrice[];
  error?: string | null;
}>;

type AlchemyPriceResponse = Readonly<{
  data: readonly AlchemyPriceResult[];
}>;

const priceCache = new Map<
  string,
  Readonly<{
    expiresAt: number;
    value: Promise<ReadonlyMap<string, bigint>>;
  }>
>();

function requiredAlchemyRpcUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL?.trim();
  if (!value) {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ALCHEMY_RPC_HOST ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !ALCHEMY_RPC_PATH.test(parsed.pathname)
  ) {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is invalid");
  }
  return parsed;
}

function alchemyApiKey(environment: NodeJS.ProcessEnv = process.env) {
  const explicit = environment.PROGRAMMABLE_ALCHEMY_API_KEY?.trim();
  if (explicit && /^[A-Za-z0-9_-]{8,256}$/u.test(explicit)) {
    return explicit;
  }
  const match = requiredAlchemyRpcUrl(environment).pathname.match(
    ALCHEMY_RPC_PATH,
  );
  if (!match?.[1]) throw new Error("Alchemy API key is invalid");
  return match[1];
}

export function getAlchemyOnchainDeployment(): OnchainDeployment {
  return getWebsiteReadOnchainDeployment("production");
}

async function readAlchemyExploreModelUncached(): Promise<ExploreReadModel> {
  return (
    await refreshAlchemyExploreRegistry({
      includeLatest: true,
      requirePersistence: false,
    })
  ).model;
}

const readCachedAlchemyExploreModel = unstable_cache(
  readAlchemyExploreModelUncached,
  [ALCHEMY_EXPLORE_CACHE_TAG],
  {
    revalidate: 5,
    tags: [ALCHEMY_EXPLORE_CACHE_TAG],
  },
);

export async function readAlchemyExploreModel() {
  return readCachedAlchemyExploreModel();
}

export type AlchemyRouterCustomIdentitySourceV1 = Readonly<{
  generatedAt: string;
  status: "current" | "last-known-good";
  reorgDetected: boolean;
  slice: Pick<AlchemyLaunchStampRouterRegistry, "cursor" | "tokens">;
}>;

export async function readAlchemyRouterCustomIdentitySourceV1(): Promise<
  AlchemyRouterCustomIdentitySourceV1
> {
  const refreshed = await refreshAlchemyExploreRegistry({
    includeLatest: false,
    requirePersistence: false,
    routerOnly: true,
  });
  return Object.freeze({
    generatedAt: refreshed.registryGeneratedAt,
    status: refreshed.launchStampRouterCaughtUp
      ? "current"
      : "last-known-good",
    reorgDetected: refreshed.launchStampRouterRebuiltAfterReorg,
    slice: refreshed.launchStampRouter,
  });
}

type AlchemyRegistryRefreshOptions = Readonly<{
  forcePersist?: boolean;
  includeLatest?: boolean;
  persist?: boolean;
  requirePersistence?: boolean;
  /** Custom Hook discovery does not depend on retired Classic launch readers. */
  routerOnly?: boolean;
}>;

type ReadyExploreModel = Extract<ExploreReadModel, { status: "ready" }>;

function routerBootstrapModel(deployment: ReadyOnchainDeployment): ReadyExploreModel {
  return {
    status: "ready",
    tokens: [],
    snapshot: {
      chainId: deployment.chainId,
      ...LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
      confirmations: Number(deployment.confirmations),
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

async function readClassicBaseModel(
  deployment: ReadyOnchainDeployment,
): Promise<ReadyExploreModel | null> {
  const read = await readDurableExploreModel(deployment, Number.MAX_SAFE_INTEGER);
  if (read.status !== "ready") {
    if (read.reason === "missing") return null;
    throw new Error(
      `Durable Alchemy registry is ${read.reason}: ${read.detail}`,
    );
  }
  const model = read.envelope.payload.model;
  if (
    model.status !== "ready" ||
    model.snapshot.chainId !== deployment.chainId
  ) {
    throw new Error("Durable Alchemy registry is not ready");
  }
  return model;
}

function sameLaunch(left: LauncherToken, right: LauncherToken) {
  return (
    left.tokenAddress.toLowerCase() === right.tokenAddress.toLowerCase() &&
    left.launchTransactionHash?.toLowerCase() ===
      right.launchTransactionHash?.toLowerCase() &&
    left.launchLogIndex === right.launchLogIndex
  );
}

function sameHex(left: string | undefined, right: string | undefined) {
  return left?.toLowerCase() === right?.toLowerCase();
}

function sameLaunchStampBinding(left: LauncherToken, right: LauncherToken) {
  const leftStamp = left.launchStampProvenance;
  const rightStamp = right.launchStampProvenance;
  if (leftStamp && rightStamp) {
    return (
      sameHex(leftStamp.launchId, rightStamp.launchId) &&
      sameHex(leftStamp.stampHash, rightStamp.stampHash) &&
      sameHex(leftStamp.routerAddress, rightStamp.routerAddress)
    );
  }
  return (
    sameHex(left.launchTransactionHash, right.launchTransactionHash) &&
    sameHex(left.poolId, right.poolId) &&
    sameHex(left.hookAddress, right.hookAddress)
  );
}

function mergeDefinedToken(
  existing: LauncherToken,
  stamped: LauncherToken,
): LauncherToken {
  if (stamped.launchStampProvenance) {
    return {
      ...stamped,
      launchDiscoverySource:
        stamped.launchDiscoverySource ??
        existing.launchDiscoverySource ??
        "operational-launch-overlay",
    };
  }
  const merged = { ...existing } as LauncherToken & Record<string, unknown>;
  for (const [key, value] of Object.entries(stamped)) {
    if (value !== undefined && (value !== null || merged[key] === undefined)) {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeLaunchOverlay(
  base: ReadyExploreModel,
  overlayTokens: readonly LauncherToken[],
) {
  const tokens = new Map(
    base.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  for (const token of overlayTokens) {
    const key = token.tokenAddress.toLowerCase();
    const existing = tokens.get(key);
    if (existing && !sameLaunch(existing, token)) {
      throw new Error(`Alchemy launch overlay conflicts for ${token.tokenAddress}`);
    }
    tokens.set(key, {
      ...token,
      launchDiscoverySource: "operational-launch-overlay",
    });
  }
  return { ...base, tokens: [...tokens.values()] } satisfies ReadyExploreModel;
}

function mergeLaunchStampRouterOverlay(
  base: ReadyExploreModel,
  routerTokens: readonly LauncherToken[],
) {
  const tokens = new Map(
    base.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  for (const token of routerTokens) {
    const key = token.tokenAddress.toLowerCase();
    const existing = tokens.get(key);
    if (existing && !sameLaunchStampBinding(existing, token)) {
      throw new Error(
        `Alchemy launch stamp Router overlay conflicts for ${token.tokenAddress}`,
      );
    }
    tokens.set(
      key,
      existing
        ? mergeDefinedToken(existing, token)
        : {
            ...token,
            launchDiscoverySource: "operational-launch-overlay",
          },
    );
  }
  return { ...base, tokens: [...tokens.values()] } satisfies ReadyExploreModel;
}

function overlayTokensAfterBase(
  base: ReadyExploreModel,
  tokens: readonly LauncherToken[],
) {
  const baseTokens = new Map(
    base.tokens.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  const output: LauncherToken[] = [];
  for (const token of tokens) {
    const existing = baseTokens.get(token.tokenAddress.toLowerCase());
    if (existing) {
      if (!sameLaunch(existing, token)) {
        throw new Error(`Durable registry conflicts for ${token.tokenAddress}`);
      }
      continue;
    }
    output.push(token);
  }
  return output;
}

function registryTokenIdentity(registry: AlchemyLaunchRegistry) {
  return JSON.stringify({
    classic: registry.tokens.map((token) => [
      token.tokenAddress.toLowerCase(),
      token.launchTransactionHash?.toLowerCase(),
      token.launchLogIndex,
    ]),
    router: registry.launchStampRouter.tokens.map((token) => [
      token.tokenAddress.toLowerCase(),
      token.launchStampProvenance?.launchId.toLowerCase(),
      token.launchStampProvenance?.stampHash.toLowerCase(),
      token.launchTransactionHash?.toLowerCase(),
      token.launchLogIndex,
    ]),
  });
}

function cursorRequiresPersistence(
  next: AlchemyLaunchCursor,
  previous: AlchemyLaunchCursor,
) {
  const nextBlock = BigInt(next.blockNumber);
  const previousBlock = BigInt(previous.blockNumber);
  return (
    nextBlock < previousBlock ||
    nextBlock - previousBlock >= LAUNCH_CURSOR_PERSIST_INTERVAL_BLOCKS ||
    (
      nextBlock === previousBlock &&
      next.blockHash.toLowerCase() !== previous.blockHash.toLowerCase()
    )
  );
}

function persistentOverlayTokensAfterBase(
  base: ReadyExploreModel,
  tokens: readonly LauncherToken[],
) {
  return overlayTokensAfterBase(base, tokens).map((token) => {
    const persistent = { ...token };
    delete persistent.launchDiscoverySource;
    return persistent;
  });
}

function withoutRouterTokenDuplicates(
  classicTokens: readonly LauncherToken[],
  routerTokens: readonly LauncherToken[],
) {
  const routerTokenKeys = new Set(
    routerTokens.map((token) => token.tokenAddress.toLowerCase()),
  );
  return classicTokens.filter(
    (token) => !routerTokenKeys.has(token.tokenAddress.toLowerCase()),
  );
}

async function refreshAlchemyExploreRegistryOnce(
  options: AlchemyRegistryRefreshOptions = {},
  deployment = getAlchemyOnchainDeployment(),
) {
  if (deployment.status !== "ready") {
    throw new Error("Alchemy production deployment is not ready");
  }
  // The Router registry has its own finalized cursor and stores an empty
  // Classic slice at the bootstrap block. Read Classic only for the mixed view.
  const classicBase = options.routerOnly ? null : await readClassicBaseModel(deployment);
  const base = classicBase ?? routerBootstrapModel(deployment);
  const initialCursor: AlchemyLaunchCursor = {
    blockNumber: base.snapshot.blockNumber,
    blockHash: base.snapshot.blockHash,
  };
  const stored = options.routerOnly
    ? await readAlchemyLaunchRegistry(deployment, initialCursor, { scope: "router" })
    : await readAlchemyLaunchRegistry(deployment, initialCursor);
  const baseBlock = BigInt(base.snapshot.blockNumber);
  const storedCursorBlock = BigInt(stored.registry.cursor.blockNumber);
  const compactedTokens = overlayTokensAfterBase(
    base,
    stored.registry.tokens,
  );
  const cursor = storedCursorBlock >= baseBlock
    ? stored.registry.cursor
    : initialCursor;
  const cursorModel: ReadyExploreModel = {
    ...mergeLaunchOverlay(base, compactedTokens),
    snapshot: {
      ...base.snapshot,
      blockNumber: cursor.blockNumber,
      blockHash: cursor.blockHash,
    },
  };
  const confirmed = classicBase
    ? await advanceExploreLaunchDiscovery(
      deployment,
      cursorModel,
      "confirmed",
    )
    : cursorModel;
  const routerAdvance = await advanceLaunchStampRouterSlice(
    deployment,
    {
      cursor: stored.registry.launchStampRouter.cursor,
      tokens: stored.registry.launchStampRouter.tokens,
    },
  );
  const confirmedRegistry: AlchemyLaunchRegistry = {
    generatedAt: new Date().toISOString(),
    repositoryCommit: stored.registry.repositoryCommit,
    chainId: deployment.chainId,
    cursor: {
      blockNumber: confirmed.snapshot.blockNumber,
      blockHash: confirmed.snapshot.blockHash,
    },
    tokens: withoutRouterTokenDuplicates(
      persistentOverlayTokensAfterBase(base, confirmed.tokens),
      routerAdvance.slice.tokens,
    ),
    launchStampRouter: {
      ...stored.registry.launchStampRouter,
      cursor: routerAdvance.slice.cursor,
      tokens: routerAdvance.slice.tokens,
    },
  };
  const registryChanged =
    registryTokenIdentity(confirmedRegistry) !==
      registryTokenIdentity(stored.registry) ||
    cursorRequiresPersistence(
      confirmedRegistry.cursor,
      stored.registry.cursor,
    ) ||
    cursorRequiresPersistence(
      confirmedRegistry.launchStampRouter.cursor,
      stored.registry.launchStampRouter.cursor,
    ) || routerAdvance.rebuiltAfterReorg;
  let persisted = false;
  if (
    options.persist !== false &&
    (options.forcePersist || registryChanged)
  ) {
    try {
      if (options.routerOnly) {
        await writeAlchemyLaunchRegistry(deployment, confirmedRegistry, stored.etag, { scope: "router" });
      } else {
        await writeAlchemyLaunchRegistry(deployment, confirmedRegistry, stored.etag);
      }
      persisted = true;
    } catch (error) {
      if (options.requirePersistence) throw error;
      console.warn("Alchemy registry persistence failed", safeAlchemyError(error));
    }
  }
  const servedCursorModel = !classicBase || options.includeLatest === false
    ? confirmed
    : await advanceExploreLaunchDiscovery(deployment, confirmed, "latest");
  const classicModel: ReadyExploreModel = {
    ...mergeLaunchOverlay(
      base,
      overlayTokensAfterBase(base, servedCursorModel.tokens),
    ),
    launchDiscoverySnapshot: servedCursorModel.snapshot,
  };
  const model = mergeLaunchStampRouterOverlay(
    classicModel,
    confirmedRegistry.launchStampRouter.tokens,
  );
  return {
    model,
    baseBlockNumber: base.snapshot.blockNumber,
    confirmedBlockNumber: confirmed.snapshot.blockNumber,
    servedBlockNumber: servedCursorModel.snapshot.blockNumber,
    launchStampRouterBlockNumber:
      confirmedRegistry.launchStampRouter.cursor.blockNumber,
    launchStampRouter: confirmedRegistry.launchStampRouter,
    launchStampRouterCaughtUp: routerAdvance.caughtUp === true,
    launchStampRouterRebuiltAfterReorg: routerAdvance.rebuiltAfterReorg,
    registryGeneratedAt: confirmedRegistry.generatedAt,
    persisted,
    registryChanged,
  } as const;
}

export async function refreshAlchemyExploreRegistry(
  options: AlchemyRegistryRefreshOptions = {},
) {
  const deployment = getAlchemyOnchainDeployment();
  return withOperationalRpcFailover(deployment, async (rpcDeployment) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await refreshAlchemyExploreRegistryOnce(
          options,
          rpcDeployment,
        );
      } catch (error) {
        if (
          attempt === 1 &&
          error instanceof Error &&
          (
            error.name === "BlobPreconditionFailedError" ||
            error.name === "AlchemyLaunchRegistryCreateConflictError"
          )
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Alchemy registry refresh retry exhausted");
  });
}

export function safeAlchemyError(error: unknown) {
  const officialV4LiquidityError =
    safeOfficialV4LiquidityEvidenceReadError(error);
  if (officialV4LiquidityError) return officialV4LiquidityError;
  return safeOperationalRpcError(error);
}

function decimalUsdToWad(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").slice(0, 18).padEnd(18, "0");
  return whole * USD_WAD + BigInt(fraction || "0");
}

function parsePriceResponse(value: unknown, nowMs = Date.now()) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { data?: unknown }).data)
  ) {
    throw new Error("Alchemy Prices returned an invalid response");
  }

  const prices = new Map<string, bigint>();
  for (const candidate of (value as AlchemyPriceResponse).data) {
    if (
      !candidate ||
      typeof candidate.address !== "string" ||
      candidate.network !== "eth-mainnet" ||
      !Array.isArray(candidate.prices)
    ) {
      continue;
    }
    const usd = candidate.prices.find(
      (price) => price?.currency?.toUpperCase() === "USD",
    );
    if (
      !usd ||
      typeof usd.value !== "string" ||
      typeof usd.lastUpdatedAt !== "string"
    ) {
      continue;
    }
    const updatedAt = Date.parse(usd.lastUpdatedAt);
    const age = nowMs - updatedAt;
    if (
      !Number.isFinite(updatedAt) ||
      age < -MAX_ALCHEMY_PRICE_CLOCK_SKEW_MS ||
      age > MAX_ALCHEMY_PRICE_AGE_MS
    ) {
      continue;
    }
    const wad = decimalUsdToWad(usd.value);
    if (wad !== null && wad > 0n) {
      prices.set(candidate.address.toLowerCase(), wad);
    }
  }
  return prices;
}

async function requestAlchemyPrices(addresses: readonly string[]) {
  const response = await fetch(
    "https://api.g.alchemy.com/prices/v1/tokens/by-address",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${alchemyApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addresses: addresses.map((address) => ({
          network: "eth-mainnet",
          address,
        })),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Alchemy Prices failed with status ${response.status}`);
  }
  return parsePriceResponse(await response.json());
}

async function currentAlchemyPrices(addresses: readonly string[]) {
  const unique = [
    ...new Set(addresses.map((address) => address.toLowerCase())),
  ];
  if (unique.length === 0) return new Map<string, bigint>();

  const key = unique.join(",");
  const cached = priceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const batches = Array.from(
    { length: Math.ceil(unique.length / MAX_ALCHEMY_PRICE_ADDRESSES) },
    (_, index) =>
      unique.slice(
        index * MAX_ALCHEMY_PRICE_ADDRESSES,
        (index + 1) * MAX_ALCHEMY_PRICE_ADDRESSES,
      ),
  );
  const value = (async () => {
    const results: Array<ReadonlyMap<string, bigint>> = [];
    for (
      let offset = 0;
      offset < batches.length;
      offset += MAX_CONCURRENT_ALCHEMY_PRICE_BATCHES
    ) {
      results.push(
        ...(await Promise.all(
          batches
            .slice(offset, offset + MAX_CONCURRENT_ALCHEMY_PRICE_BATCHES)
            .map(requestAlchemyPrices),
        )),
      );
    }
    return results;
  })()
    .then((results) => {
      const merged = new Map<string, bigint>();
      for (const result of results) {
        for (const [address, price] of result) merged.set(address, price);
      }
      return merged;
    })
    .catch((error) => {
      if (priceCache.get(key)?.value === value) priceCache.delete(key);
      throw error;
    });
  priceCache.set(key, {
    expiresAt: Date.now() + ALCHEMY_PRICE_CACHE_TTL_MS,
    value,
  });
  while (priceCache.size > MAX_PRICE_CACHE_ENTRIES) {
    const oldest = priceCache.keys().next().value;
    if (oldest === undefined) break;
    priceCache.delete(oldest);
  }
  return value;
}

function enrichTokenPrice(
  token: LauncherToken,
  priceUsdWad: bigint | undefined,
) {
  if (
    priceUsdWad === undefined ||
    token.totalSupplyRaw === undefined ||
    token.tokenDecimals === undefined ||
    !/^\d+$/u.test(token.totalSupplyRaw) ||
    !Number.isInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) {
    return token;
  }

  const marketCapUsdWad =
    (BigInt(token.totalSupplyRaw) * priceUsdWad) /
    10n ** BigInt(token.tokenDecimals);
  return {
    ...token,
    tokenPriceUsdWad: priceUsdWad.toString(),
    fdvUsdWad: marketCapUsdWad.toString(),
  };
}

export async function enrichTokensWithAlchemyPrices(
  tokens: readonly LauncherToken[],
) {
  if (tokens.length === 0) return [...tokens];
  try {
    const prices = await currentAlchemyPrices(
      tokens.map((token) => token.tokenAddress),
    );
    return tokens.map((token) =>
      enrichTokenPrice(
        token,
        prices.get(token.tokenAddress.toLowerCase()),
      ),
    );
  } catch (error) {
    console.warn("Alchemy price enrichment failed", error);
    return [...tokens];
  }
}
