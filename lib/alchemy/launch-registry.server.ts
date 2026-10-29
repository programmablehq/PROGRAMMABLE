import "server-only";

import {
  isAddress,
  isHex,
  keccak256,
  toBytes,
  type Hex,
} from "viem";

import { resolveDurableExploreBlobToken } from "../onchain/durable-model";
import type { ReadyOnchainDeployment } from "../onchain/types";
import {
  CANONICAL_LAUNCH_STAMP_V1,
  isLaunchStampProvenanceV1,
  type LauncherToken,
} from "../tokens";

const ALCHEMY_LAUNCH_REGISTRY_DIRECTORY =
  "indexes/mainnet-classic-v2/alchemy-launch-registry-v1";
const LEGACY_SCHEMA_VERSION = "programmable-alchemy-launch-registry-v1";
const SCHEMA_VERSION = "programmable-alchemy-launch-registry-v2";
const ROUTER_SLICE_SCHEMA_VERSION =
  "programmable-launch-stamp-router-registry-v1";
const REPOSITORY_COMMIT = /^[0-9a-f]{40}$/u;
const VERCEL_BLOB_STRONG_ETAG = /^"[0-9a-f]{32}"$/iu;

export const LAUNCH_STAMP_ROUTER_BINDING = Object.freeze({
  chainId: CANONICAL_LAUNCH_STAMP_V1.chainId,
  routerAddress: CANONICAL_LAUNCH_STAMP_V1.routerAddress,
  routerRuntimeCodeHash: CANONICAL_LAUNCH_STAMP_V1.routerRuntimeCodeHash,
  poolManagerAddress: CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress,
  startBlock: CANONICAL_LAUNCH_STAMP_V1.routerStartBlock,
  finalityConfirmations: CANONICAL_LAUNCH_STAMP_V1.finalityConfirmations,
} as const);

export const LAUNCH_STAMP_ROUTER_INITIAL_CURSOR = Object.freeze({
  blockNumber: "25717611",
  blockHash:
    "0x2d42bd6f5cea0a09b7a76c5ca51569ac69e677cef0498b12730d6f1f7a979a5e",
} as const satisfies AlchemyLaunchCursor);

export type AlchemyLaunchCursor = Readonly<{
  blockNumber: string;
  blockHash: Hex;
}>;

export type AlchemyLaunchStampRouterRegistry = Readonly<{
  schemaVersion: typeof ROUTER_SLICE_SCHEMA_VERSION;
  binding: typeof LAUNCH_STAMP_ROUTER_BINDING;
  cursor: AlchemyLaunchCursor;
  tokens: readonly LauncherToken[];
}>;

export type AlchemyLaunchRegistry = Readonly<{
  generatedAt: string;
  repositoryCommit: string;
  chainId: number;
  cursor: AlchemyLaunchCursor;
  tokens: readonly LauncherToken[];
  launchStampRouter: AlchemyLaunchStampRouterRegistry;
}>;

type AlchemyLaunchRegistryEnvelope = Readonly<{
  schemaVersion: typeof LEGACY_SCHEMA_VERSION | typeof SCHEMA_VERSION;
  contentHash: Hex;
  payload: unknown;
}>;

export type AlchemyLaunchRegistryRead = Readonly<{
  registry: AlchemyLaunchRegistry;
  etag: string | null;
}>;

function contentHash(payload: AlchemyLaunchRegistry) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validIntegerString(value: unknown) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

function requiredRepositoryCommit(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!value || !REPOSITORY_COMMIT.test(value)) {
    throw new Error("Alchemy launch registry commit binding is unavailable");
  }
  return value;
}

type RegistryOptions = Readonly<{ scope?: "deployment" | "router" }>;

export function canonicalRouterRegistryBlobPathV1() {
  return ["indexes/mainnet-launch-stamp-router-v1",
    LAUNCH_STAMP_ROUTER_BINDING.routerAddress.toLowerCase(),
    LAUNCH_STAMP_ROUTER_BINDING.routerRuntimeCodeHash.toLowerCase(),
    "launch-registry.json"].join("/");
}

function registryPath(repositoryCommit: string, options: RegistryOptions = {}) {
  if (options.scope === "router") return canonicalRouterRegistryBlobPathV1();
  return `${ALCHEMY_LAUNCH_REGISTRY_DIRECTORY}/${repositoryCommit}.json`;
}

function normalizeVercelBlobEtag(value: string) {
  const normalized = value.trim();
  if (!VERCEL_BLOB_STRONG_ETAG.test(normalized)) {
    throw new Error("Alchemy launch registry ETag is invalid");
  }
  return normalized;
}

function validLaunchToken(value: unknown, cursorBlock: bigint) {
  if (!isRecord(value)) return false;
  if (
    !isAddress(String(value.tokenAddress ?? "")) ||
    !isAddress(String(value.hookAddress ?? "")) ||
    !isHex(String(value.poolId ?? ""), { strict: true }) ||
    String(value.poolId).length !== 66 ||
    !validIntegerString(value.launchBlockNumber) ||
    BigInt(value.launchBlockNumber as string) > cursorBlock ||
    !isHex(String(value.launchTransactionHash ?? ""), { strict: true }) ||
    String(value.launchTransactionHash).length !== 66 ||
    !Number.isSafeInteger(value.launchLogIndex) ||
    (value.launchLogIndex as number) < 0 ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    typeof value.launchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.launchedAt))
  ) {
    return false;
  }
  return true;
}

function sameHex(left: unknown, right: string) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function validBytes32(value: unknown) {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function validSafeNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validProof(
  value: unknown,
  launchId: string,
  stampHash: string,
) {
  return (
    isRecord(value) &&
    sameHex(value.launchId, launchId) &&
    sameHex(value.stampHash, stampHash)
  );
}

function validLaunchStampToken(value: unknown, cursorBlock: bigint) {
  if (!validLaunchToken(value, cursorBlock) || !isRecord(value)) return false;
  const provenance = value.launchStampProvenance;
  if (!isRecord(provenance)) return false;
  if (
    !isLaunchStampProvenanceV1(provenance, {
      chainId: LAUNCH_STAMP_ROUTER_BINDING.chainId,
      tokenAddress: value.tokenAddress as `0x${string}`,
      hookAddress: value.hookAddress as `0x${string}`,
      poolId: value.poolId as `0x${string}`,
      launchWallet: value.creatorAddress as `0x${string}` | undefined,
      transactionHash: value.launchTransactionHash as `0x${string}`,
      blockNumber: value.launchBlockNumber as string,
      transactionIndex: value.launchTransactionIndex as number,
      launchLogIndex: value.launchLogIndex as number,
    })
  ) {
    return false;
  }
  const launchId = String(provenance.launchId ?? "");
  const stampHash = String(provenance.stampHash ?? "");
  if (
    provenance.schemaVersion !== "programmable.launch-stamp-provenance.v1" ||
    provenance.chainId !== LAUNCH_STAMP_ROUTER_BINDING.chainId ||
    !sameHex(
      provenance.routerAddress,
      LAUNCH_STAMP_ROUTER_BINDING.routerAddress,
    ) ||
    !sameHex(
      provenance.routerRuntimeCodeHash,
      LAUNCH_STAMP_ROUTER_BINDING.routerRuntimeCodeHash,
    ) ||
    provenance.routerStartBlock !== LAUNCH_STAMP_ROUTER_BINDING.startBlock ||
    provenance.finalityConfirmations !==
      LAUNCH_STAMP_ROUTER_BINDING.finalityConfirmations ||
    (provenance.kind !== "custom-graph" && provenance.kind !== "classic") ||
    !isHex(launchId, { strict: true }) ||
    launchId.length !== 66 ||
    !isHex(stampHash, { strict: true }) ||
    stampHash.length !== 66 ||
    !isAddress(String(provenance.launchWallet ?? "")) ||
    !sameHex(provenance.launchWallet, String(value.creatorAddress)) ||
    !sameHex(provenance.transactionHash, String(value.launchTransactionHash)) ||
    provenance.blockNumber !== value.launchBlockNumber ||
    !validBytes32(provenance.blockHash) ||
    !validSafeNonNegativeInteger(provenance.transactionIndex) ||
    provenance.transactionIndex !== value.launchTransactionIndex ||
    !validSafeNonNegativeInteger(provenance.routeLogIndex) ||
    provenance.launchLogIndex !== value.launchLogIndex ||
    (provenance.routeLogIndex as number) >=
      (provenance.launchLogIndex as number) ||
    !validIntegerString(provenance.finalizedAtBlockNumber) ||
    !validBytes32(provenance.finalizedAtBlockHash) ||
    BigInt(provenance.finalizedAtBlockNumber as string) <
      BigInt(provenance.blockNumber as string) +
        BigInt(LAUNCH_STAMP_ROUTER_BINDING.finalityConfirmations) ||
    !sameHex(provenance.poolId, String(value.poolId)) ||
    !isAddress(String(provenance.poolManagerAddress ?? "")) ||
    !sameHex(
      provenance.poolManagerAddress,
      LAUNCH_STAMP_ROUTER_BINDING.poolManagerAddress,
    ) ||
    !isRecord(provenance.poolKey) ||
    !isAddress(String(provenance.poolKey.currency0 ?? "")) ||
    !isAddress(String(provenance.poolKey.currency1 ?? "")) ||
    !isAddress(String(provenance.poolKey.hooks ?? "")) ||
    !sameHex(provenance.poolKey.hooks, String(value.hookAddress)) ||
    !validSafeNonNegativeInteger(provenance.poolKey.fee) ||
    (
      (provenance.poolKey.fee as number) !== 0x80_00_00 &&
      (provenance.poolKey.fee as number) > 1_000_000
    ) ||
    !Number.isSafeInteger(provenance.poolKey.tickSpacing) ||
    (provenance.poolKey.tickSpacing as number) < 1 ||
    (provenance.poolKey.tickSpacing as number) > 32_767 ||
    !validBytes32(provenance.poolKeyHash) ||
    !validBytes32(provenance.componentSetHash) ||
    !validBytes32(provenance.routePayloadHash) ||
    !isAddress(String(provenance.routeLauncherAddress ?? "")) ||
    !validBytes32(provenance.routeLauncherRuntimeCodeHash) ||
    !validBytes32(provenance.expectedResultHash) ||
    !validBytes32(provenance.permitDigest) ||
    !Array.isArray(provenance.components) ||
    provenance.components.length < 2 ||
    !isRecord(provenance.tokenProof) ||
    !sameHex(provenance.tokenProof.tokenAddress, String(value.tokenAddress)) ||
    !validProof(provenance.tokenProof, launchId, stampHash) ||
    !isRecord(provenance.poolProof) ||
    !sameHex(
      provenance.poolProof.poolManagerAddress,
      String(provenance.poolManagerAddress),
    ) ||
    !sameHex(provenance.poolProof.poolId, String(value.poolId)) ||
    !validProof(provenance.poolProof, launchId, stampHash)
  ) {
    return false;
  }
  if (
    BigInt(String(provenance.poolKey.currency0)) >=
      BigInt(String(provenance.poolKey.currency1)) ||
    value.liquidityPath !== "programmable-v4" ||
    value.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
    value.totalSwapFeeBps !== null ||
    value.positionRecipient !== undefined ||
    value.positionTokenId !== undefined ||
    value.buyHookFeeBps !== undefined ||
    value.sellHookFeeBps !== undefined ||
    value.creatorFeeBps !== undefined ||
    value.buyCreatorFeeBps !== undefined ||
    value.sellCreatorFeeBps !== undefined ||
    value.growthFeeBps !== undefined ||
    value.programmableFeeBps !== undefined ||
    value.launcherFeeBps !== undefined ||
    value.transferTaxBps !== undefined ||
    (
      provenance.kind === "custom-graph" &&
      value.launchModel !== "custom-graph"
    ) ||
    (provenance.kind === "classic" && value.launchModel !== "classic")
  ) {
    return false;
  }
  const componentLogIndexes = new Set<number>();
  const componentAddresses = new Set<string>();
  for (const component of provenance.components) {
    if (
      !isRecord(component) ||
      !isAddress(String(component.address ?? "")) ||
      (
        component.kind !== "token" &&
        component.kind !== "hook" &&
        component.kind !== "other"
      ) ||
      (
        component.scope !== "exclusive" &&
        component.scope !== "shared-infrastructure"
      ) ||
      !validBytes32(component.runtimeCodeHash) ||
      !validSafeNonNegativeInteger(component.logIndex) ||
      (component.logIndex as number) >= (provenance.routeLogIndex as number) ||
      componentLogIndexes.has(component.logIndex as number) ||
      componentAddresses.has(String(component.address).toLowerCase()) ||
      (
        component.scope === "exclusive"
          ? !validProof(component.exclusiveProof, launchId, stampHash)
          : component.exclusiveProof !== null
      )
    ) {
      return false;
    }
    componentLogIndexes.add(component.logIndex as number);
    componentAddresses.add(String(component.address).toLowerCase());
  }
  const tokenComponent = provenance.components.find(
    (component) =>
      isRecord(component) &&
      component.kind === "token" &&
      component.scope === "exclusive" &&
      sameHex(component.address, String(value.tokenAddress)) &&
      validProof(component.exclusiveProof, launchId, stampHash),
  );
  const hookComponent = provenance.components.find(
    (component) =>
      isRecord(component) &&
      component.kind === "hook" &&
      sameHex(component.address, String(value.hookAddress)) &&
      (
        provenance.kind === "classic"
          ? component.scope === "shared-infrastructure" &&
            component.exclusiveProof === null
          : component.scope === "exclusive" &&
            validProof(component.exclusiveProof, launchId, stampHash)
      ),
  );
  return Boolean(
    tokenComponent &&
    hookComponent &&
    provenance.components.filter(
      (component) => isRecord(component) && component.kind === "token",
    ).length === 1 &&
    provenance.components.filter(
      (component) => isRecord(component) && component.kind === "hook",
    ).length === 1
  );
}

function initialLaunchStampRouterRegistry(): AlchemyLaunchStampRouterRegistry {
  return {
    schemaVersion: ROUTER_SLICE_SCHEMA_VERSION,
    binding: LAUNCH_STAMP_ROUTER_BINDING,
    cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR,
    tokens: [],
  };
}

function validateCursor(value: unknown) {
  return (
    isRecord(value) &&
    validIntegerString(value.blockNumber) &&
    isHex(String(value.blockHash ?? ""), { strict: true }) &&
    String(value.blockHash).length === 66
  );
}

function validateClassicPayload(
  payload: Record<string, unknown>,
  deployment: ReadyOnchainDeployment,
  options: RegistryOptions = {},
) {
  const repositoryCommit = requiredRepositoryCommit();
  if (
    payload.chainId !== deployment.chainId ||
    (options.scope === "router"
      ? typeof payload.repositoryCommit !== "string" || !REPOSITORY_COMMIT.test(payload.repositoryCommit)
      : payload.repositoryCommit !== repositoryCommit) ||
    typeof payload.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.generatedAt)) ||
    !validateCursor(payload.cursor) ||
    !Array.isArray(payload.tokens)
  ) {
    throw new Error("Alchemy launch registry payload is malformed");
  }
  const cursor = payload.cursor as AlchemyLaunchCursor;
  if (options.scope === "router" && (payload.tokens.length !== 0
    || cursor.blockNumber !== LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockNumber
    || !sameHex(cursor.blockHash, LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockHash))) {
    throw new Error("Canonical Router registry cannot contain a Classic slice");
  }
  const cursorBlock = BigInt(cursor.blockNumber);
  if (
    !payload.tokens.every(
      (token) =>
        validLaunchToken(token, cursorBlock) &&
        isRecord(token) &&
        token.launchStampProvenance === undefined,
    )
  ) {
    throw new Error("Alchemy launch registry contains an invalid token");
  }
  const tokenKeys = payload.tokens.map((token) =>
    String((token as LauncherToken).tokenAddress).toLowerCase(),
  );
  const eventKeys = payload.tokens.map((token) => {
    const launch = token as LauncherToken;
    return [
      launch.launchTransactionHash?.toLowerCase(),
      launch.launchLogIndex,
    ].join(":");
  });
  if (
    new Set(tokenKeys).size !== tokenKeys.length ||
    new Set(eventKeys).size !== eventKeys.length
  ) {
    throw new Error("Alchemy launch registry contains duplicate provenance");
  }
}

function validateRouterSlice(value: unknown): AlchemyLaunchStampRouterRegistry {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ROUTER_SLICE_SCHEMA_VERSION ||
    !isRecord(value.binding) ||
    value.binding.chainId !== LAUNCH_STAMP_ROUTER_BINDING.chainId ||
    !sameHex(value.binding.routerAddress, LAUNCH_STAMP_ROUTER_BINDING.routerAddress) ||
    !sameHex(
      value.binding.routerRuntimeCodeHash,
      LAUNCH_STAMP_ROUTER_BINDING.routerRuntimeCodeHash,
    ) ||
    !sameHex(
      value.binding.poolManagerAddress,
      LAUNCH_STAMP_ROUTER_BINDING.poolManagerAddress,
    ) ||
    value.binding.startBlock !== LAUNCH_STAMP_ROUTER_BINDING.startBlock ||
    value.binding.finalityConfirmations !==
      LAUNCH_STAMP_ROUTER_BINDING.finalityConfirmations ||
    !validateCursor(value.cursor) ||
    !Array.isArray(value.tokens)
  ) {
    throw new Error("Alchemy launch stamp Router registry is malformed");
  }
  const cursor = value.cursor as AlchemyLaunchCursor;
  const cursorBlock = BigInt(cursor.blockNumber);
  if (
    cursorBlock < BigInt(LAUNCH_STAMP_ROUTER_INITIAL_CURSOR.blockNumber) ||
    !value.tokens.every((token) => validLaunchStampToken(token, cursorBlock))
  ) {
    throw new Error("Alchemy launch stamp Router registry contains an invalid token");
  }
  const tokenKeys = value.tokens.map((token) =>
    String((token as LauncherToken).tokenAddress).toLowerCase(),
  );
  const launchKeys = value.tokens.map((token) =>
    String((token as LauncherToken & { launchStampProvenance: { launchId: string } })
      .launchStampProvenance.launchId).toLowerCase(),
  );
  const poolKeys = value.tokens.map((token) =>
    String((token as LauncherToken).poolId).toLowerCase(),
  );
  const eventKeys = value.tokens.map((token) => {
    const launch = token as LauncherToken;
    return `${launch.launchTransactionHash?.toLowerCase()}:${launch.launchLogIndex}`;
  });
  if (
    new Set(tokenKeys).size !== tokenKeys.length ||
    new Set(launchKeys).size !== launchKeys.length ||
    new Set(poolKeys).size !== poolKeys.length ||
    new Set(eventKeys).size !== eventKeys.length
  ) {
    throw new Error("Alchemy launch stamp Router registry contains duplicate provenance");
  }
  return value as unknown as AlchemyLaunchStampRouterRegistry;
}

export function validateAlchemyLaunchRegistryEnvelope(
  value: unknown,
  deployment: ReadyOnchainDeployment,
  options: RegistryOptions = {},
): AlchemyLaunchRegistry {
  if (
    !isRecord(value) ||
    (
      value.schemaVersion !== LEGACY_SCHEMA_VERSION &&
      value.schemaVersion !== SCHEMA_VERSION
    ) ||
    typeof value.contentHash !== "string" ||
    !isRecord(value.payload)
  ) {
    throw new Error("Alchemy launch registry envelope is malformed");
  }
  const payload = value.payload;
  if (
    keccak256(toBytes(JSON.stringify(payload))).toLowerCase() !==
      value.contentHash.toLowerCase()
  ) {
    throw new Error("Alchemy launch registry content hash is invalid");
  }
  validateClassicPayload(payload, deployment, options);
  if (options.scope === "router" && value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Canonical Router registry requires exact Router provenance");
  }
  if (value.schemaVersion === LEGACY_SCHEMA_VERSION) {
    return {
      ...(payload as unknown as Omit<AlchemyLaunchRegistry, "launchStampRouter">),
      launchStampRouter: initialLaunchStampRouterRegistry(),
    };
  }
  const launchStampRouter = validateRouterSlice(payload.launchStampRouter);
  const classicTokenKeys = new Set(
    (payload.tokens as readonly LauncherToken[]).map((token) =>
      token.tokenAddress.toLowerCase(),
    ),
  );
  if (
    launchStampRouter.tokens.some((token) =>
      classicTokenKeys.has(token.tokenAddress.toLowerCase()),
    )
  ) {
    throw new Error("Alchemy launch registry slices contain duplicate tokens");
  }
  return {
    ...(payload as unknown as AlchemyLaunchRegistry),
    launchStampRouter,
  };
}

export async function readAlchemyLaunchRegistry(
  deployment: ReadyOnchainDeployment,
  initialCursor: AlchemyLaunchCursor,
  options: RegistryOptions = {},
): Promise<AlchemyLaunchRegistryRead> {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error("Alchemy launch registry storage is not configured");
  const repositoryCommit = requiredRepositoryCommit();
  const { get } = await import("@vercel/blob");
  const result = await get(registryPath(repositoryCommit, options), {
    access: "private",
    token,
    useCache: false,
    headers: { "accept-encoding": "identity" },
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return {
      registry: {
        generatedAt: new Date().toISOString(),
        repositoryCommit,
        chainId: deployment.chainId,
        cursor: initialCursor,
        tokens: [],
        launchStampRouter: initialLaunchStampRouterRegistry(),
      },
      etag: null,
    };
  }
  const text = await new Response(result.stream).text();
  if (Buffer.byteLength(text, "utf8") > 16 * 1_024 * 1_024) {
    throw new Error("Alchemy launch registry exceeds its read bound");
  }
  const registry = validateAlchemyLaunchRegistryEnvelope(
    JSON.parse(text),
    deployment,
    options,
  );
  return { registry: options.scope === "router" ? { ...registry, repositoryCommit } : registry,
    etag: normalizeVercelBlobEtag(result.blob.etag) };
}

export async function writeAlchemyLaunchRegistry(
  deployment: ReadyOnchainDeployment,
  registry: AlchemyLaunchRegistry,
  expectedEtag: string | null,
  options: RegistryOptions = {},
) {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error("Alchemy launch registry storage is not configured");
  const repositoryCommit = requiredRepositoryCommit();
  const storedRegistry = options.scope === "router" ? { ...registry, repositoryCommit,
    cursor: LAUNCH_STAMP_ROUTER_INITIAL_CURSOR, tokens: [] } : registry;
  const validated = validateAlchemyLaunchRegistryEnvelope(
    {
      schemaVersion: SCHEMA_VERSION,
      contentHash: contentHash(storedRegistry),
      payload: storedRegistry,
    },
    deployment,
    options,
  );
  const envelope: AlchemyLaunchRegistryEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    contentHash: contentHash(validated),
    payload: validated,
  };
  const { get, put } = await import("@vercel/blob");
  const path = registryPath(repositoryCommit, options);
  try {
    return await put(path, JSON.stringify(envelope), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: expectedEtag !== null,
      cacheControlMaxAge: 60,
      ...(expectedEtag ? { ifMatch: expectedEtag } : {}),
      token,
    });
  } catch (error) {
    if (expectedEtag === null) {
      const existing = await get(path, {
        access: "private",
        token,
        useCache: false,
        headers: { "accept-encoding": "identity" },
      });
      if (existing?.statusCode === 200) {
        const conflict = new Error("Alchemy launch registry was created concurrently");
        conflict.name = "AlchemyLaunchRegistryCreateConflictError";
        throw conflict;
      }
    }
    throw error;
  }
}
