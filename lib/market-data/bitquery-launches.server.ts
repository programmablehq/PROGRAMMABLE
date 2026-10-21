import "server-only";

import { formatUnits } from "viem";

import classicV2Manifest from "../../contracts/deployments/mainnet-classic-v2.json";
import classicV3Manifest from "../../contracts/deployments/mainnet-classic-v3.json";
import stockV1Manifest from "../../contracts/deployments/mainnet-stock-paired-v1.json";
import stockV2Manifest from "../../contracts/deployments/mainnet-stock-paired-v2.json";
import stockV3Manifest from "../../contracts/deployments/mainnet-stock-paired-v3.json";
import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import {
  STOCK_PAIRED_CREATOR_FEE_BPS,
  STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
  STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
} from "../stock-paired";
import type { ExploreEntry, LauncherToken } from "../tokens";
import {
  BitqueryResponseBodyError,
  readBoundedBitqueryResponseText,
} from "./bitquery-response.server";

export const BITQUERY_LAUNCH_CATALOG_HTTP_ENDPOINT =
  "https://streaming.bitquery.io/graphql" as const;
export const BITQUERY_LAUNCH_CATALOG_TOKEN_ENVIRONMENT_VARIABLE =
  "BITQUERY_OAUTH_TOKEN" as const;

const REQUEST_TIMEOUT_MS = 12_000;
const MAXIMUM_RESPONSE_BYTES = 8_000_000;
const MAXIMUM_EVENT_ROWS = 10_000;
const MAXIMUM_LAUNCHES = 5_000;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

type FetchImplementation = typeof fetch;

export type BitqueryExploreEntriesV1 = Readonly<{
  source: "bitquery";
  generatedAt: string;
  asOfBlock: string | null;
  asOfBlockHash: `0x${string}` | null;
  entries: readonly ExploreEntry[];
}>;

export type BitqueryLaunchCatalogErrorCategory =
  | "configuration"
  | "transport"
  | "response"
  | "integrity";

export class BitqueryLaunchCatalogError extends Error {
  override name = "BitqueryLaunchCatalogError";

  constructor(readonly category: BitqueryLaunchCatalogErrorCategory) {
    super("Launch catalog is temporarily unavailable");
  }
}

export function safeBitqueryLaunchCatalogError(error: unknown): Readonly<{
  name: string;
  category: BitqueryLaunchCatalogErrorCategory | "unexpected";
}> {
  return error instanceof BitqueryLaunchCatalogError
    ? { name: error.name, category: error.category }
    : { name: "LaunchCatalogError", category: "unexpected" };
}

export type BitqueryLaunchCatalogReaderOptions = Readonly<{
  fetchImpl?: FetchImplementation;
  token?: string | null;
  now?: Date;
  signal?: AbortSignal;
}>;

type ReleaseDefinition = Readonly<{
  releaseId:
    | "classic-v2"
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3";
  model: "classic" | "stock-paired";
  launcher: `0x${string}`;
  hook: `0x${string}`;
  launchEvent: "MemeTokenLaunched" | "MemeTokenLaunchedV2" |
    "StockPairedTokenLaunched";
  liquidityEvent: "MemeLiquidityConfigured" | "MemeLiquidityConfiguredV2" |
    "StockPairedLiquidityConfigured";
}>;

type BitqueryEvent = Readonly<{
  name: string;
  contract: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  time: string;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
  arguments: ReadonlyMap<string, string>;
}>;

type TokenMetadata = Readonly<{
  name: string;
  symbol: string;
  decimals: number;
  indexedTotalSupply?: string;
}>;

type ParsedLaunch = Readonly<{
  release: ReleaseDefinition;
  event: BitqueryEvent;
  token: `0x${string}`;
  poolId: `0x${string}`;
  creator?: `0x${string}`;
  hook: `0x${string}`;
  quoteAsset?: `0x${string}`;
  rewardVault?: `0x${string}`;
  positionRecipient: `0x${string}`;
  positionTokenId: string;
  launchHash: `0x${string}`;
  buySwapFeeBps?: number;
  sellSwapFeeBps?: number;
  totalSwapFeeBps: number;
}>;

type ParsedLiquidity = Readonly<{
  event: BitqueryEvent;
  token: `0x${string}`;
  quoteAsset?: `0x${string}`;
  totalSupplyRaw: string;
  tokenLiquidityAmountRaw: string;
  lockedTokenDustRaw: string;
  initialTick: number;
  tickLower: number;
  tickUpper: number;
  lpFeePips: number;
  launchHash: `0x${string}`;
}>;

const RELEASES = Object.freeze([
  releaseDefinition({
    releaseId: "classic-v2",
    model: "classic",
    manifest: classicV2Manifest,
    launcherKey: "memeLauncher",
    launchEvent: "MemeTokenLaunched",
    liquidityEvent: "MemeLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "classic-v3",
    model: "classic",
    manifest: classicV3Manifest,
    launcherKey: "launcher",
    launchEvent: "MemeTokenLaunchedV2",
    liquidityEvent: "MemeLiquidityConfiguredV2",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v1",
    model: "stock-paired",
    manifest: stockV1Manifest,
    launcherKey: "launcher",
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v2",
    model: "stock-paired",
    manifest: stockV2Manifest,
    launcherKey: "launcher",
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
  releaseDefinition({
    releaseId: "stock-paired-v3",
    model: "stock-paired",
    manifest: stockV3Manifest,
    launcherKey: "launcher",
    launchEvent: "StockPairedTokenLaunched",
    liquidityEvent: "StockPairedLiquidityConfigured",
  }),
]) satisfies readonly ReleaseDefinition[];

const RELEASE_BY_LAUNCHER = new Map(
  RELEASES.map((release) => [release.launcher, release] as const),
);

export async function readBitqueryExploreEntriesV1(
  options: BitqueryLaunchCatalogReaderOptions = {},
): Promise<BitqueryExploreEntriesV1> {
  const token = resolveToken(options.token);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const eventsEnvelope = await requestBitquery(
    launchEventsQuery(),
    {
      launchers: RELEASES.map((release) => release.launcher),
      eventNames: [...new Set(RELEASES.flatMap((release) => [
        release.launchEvent,
        release.liquidityEvent,
      ]))],
    },
    { fetchImpl, token, signal: options.signal },
  );
  const evm = record(eventsEnvelope.EVM);
  if (evm === null) throw new BitqueryLaunchCatalogError("response");
  const events = array(evm.events).map(parseBitqueryEvent);
  if (events.length >= MAXIMUM_EVENT_ROWS) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  const { launches, liquidities } = parseLaunchEvents(events);
  if (launches.length > MAXIMUM_LAUNCHES) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  if (launches.length === 0) {
    return {
      source: "bitquery",
      generatedAt: now.toISOString(),
      asOfBlock: null,
      asOfBlockHash: null,
      entries: [],
    };
  }

  const pools = [...new Set(launches.map((launch) => launch.poolId))].sort();
  const tokenAddresses = [...new Set(launches.flatMap((launch) => [
    launch.token,
    ...(launch.quoteAsset ? [launch.quoteAsset] : []),
  ]))].sort();
  const metadataEnvelope = await requestBitquery(
    tokenMetadataQuery(pools.length, tokenAddresses.length),
    { pools, tokenAddresses },
    { fetchImpl, token, signal: options.signal },
  );
  const metadata = parseTokenMetadata(metadataEnvelope, tokenAddresses);
  const entries = launches.map((launch) => buildExploreEntry(
    launch,
    requireLiquidity(launch, liquidities),
    metadata,
  ));
  assertUniqueCatalog(entries);
  const latestEvent = events.reduce<BitqueryEvent | null>((latest, event) =>
    latest === null || BigInt(event.blockNumber) > BigInt(latest.blockNumber)
      ? event
      : latest, null);
  return {
    source: "bitquery",
    generatedAt: now.toISOString(),
    asOfBlock: latestEvent?.blockNumber ?? null,
    asOfBlockHash: latestEvent?.blockHash ?? null,
    entries: entries.sort(compareEntries),
  };
}

function releaseDefinition(input: Readonly<{
  releaseId: ReleaseDefinition["releaseId"];
  model: ReleaseDefinition["model"];
  manifest: unknown;
  launcherKey: "launcher" | "memeLauncher";
  launchEvent: ReleaseDefinition["launchEvent"];
  liquidityEvent: ReleaseDefinition["liquidityEvent"];
}>): ReleaseDefinition {
  const manifest = record(input.manifest);
  const addresses = record(manifest?.addresses);
  const launcher = canonicalAddress(addresses?.[input.launcherKey]);
  const hook = canonicalAddress(addresses?.feeHook);
  if (manifest?.chainId !== 1 || launcher === null || hook === null) {
    throw new BitqueryLaunchCatalogError("configuration");
  }
  return {
    releaseId: input.releaseId,
    model: input.model,
    launcher,
    hook,
    launchEvent: input.launchEvent,
    liquidityEvent: input.liquidityEvent,
  };
}

function launchEventsQuery(): string {
  return `query ProgrammableLaunchCatalog(
    $launchers: [String!]!
    $eventNames: [String!]!
  ) {
    EVM(network: eth, dataset: combined) {
      events: Events(
        limit: { count: ${MAXIMUM_EVENT_ROWS} }
        orderBy: [
          { ascending: Block_Number }
          { ascending: Transaction_Index }
          { ascending: Log_Index }
        ]
        where: {
          TransactionStatus: { Success: true }
          Log: {
            SmartContract: { in: $launchers }
            Signature: { Name: { in: $eventNames } }
          }
        }
      ) {
        Block { Number Hash Time }
        Transaction { Hash Index }
        Log { Index SmartContract Signature { Name Signature } }
        Arguments {
          Index
          Name
          Type
          Value {
            ... on EVM_ABI_Address_Value_Arg { address }
            ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
            ... on EVM_ABI_Bytes_Value_Arg { hex }
            ... on EVM_ABI_Integer_Value_Arg { integer }
          }
        }
      }
    }
  }`;
}

function tokenMetadataQuery(poolCount: number, tokenCount: number): string {
  return `query ProgrammableLaunchTokenMetadata(
    $pools: [String!]!
    $tokenAddresses: [String!]!
  ) {
    EVM(network: eth, dataset: combined) {
      transferMetadata: Transfers(
        limit: { count: ${Math.max(1, tokenCount)} }
        limitBy: { by: Transfer_Currency_SmartContract, count: 1 }
        orderBy: [
          { descending: Block_Number }
          { descending: Transaction_Index }
          { descending: Log_Index }
        ]
        where: {
          TransactionStatus: { Success: true }
          Transfer: {
            Currency: {
              SmartContract: { in: $tokenAddresses }
              Fungible: true
            }
          }
        }
      ) {
        Transfer {
          Currency { SmartContract Name Symbol Decimals }
        }
      }
      poolMetadata: DEXTrades(
        limit: { count: ${Math.max(1, poolCount)} }
        limitBy: { by: Trade_PoolId, count: 1 }
        orderBy: [
          { descending: Block_Number }
          { descending: Transaction_Index }
          { descending: Log_Index }
        ]
        where: {
          TransactionStatus: { Success: true }
          Trade: {
            Dex: { ProtocolName: { is: "uniswap_v4" } }
            PoolId: { in: $pools }
          }
        }
      ) {
        Trade {
          PoolId
          Buy { Currency { SmartContract Name Symbol Decimals } }
          Sell { Currency { SmartContract Name Symbol Decimals } }
        }
      }
    }
    Trading {
      tokenMetadata: Tokens(
        limit: { count: ${Math.max(1, tokenCount)} }
        limitBy: { by: Token_Address, count: 1 }
        orderBy: { descending: Block_Time }
        where: { Token: { Address: { in: $tokenAddresses } } }
      ) {
        Token { Address Name Symbol }
        Supply { TotalSupply }
      }
    }
  }`;
}

async function requestBitquery(
  query: string,
  variables: Readonly<Record<string, unknown>>,
  options: Readonly<{
    fetchImpl: FetchImplementation;
    token: string;
    signal?: AbortSignal;
  }>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await options.fetchImpl(
      BITQUERY_LAUNCH_CATALOG_HTTP_ENDPOINT,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new BitqueryLaunchCatalogError("transport");
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.includes("application/json")) {
      throw new BitqueryLaunchCatalogError("response");
    }
    let source: string;
    try {
      source = await readBoundedBitqueryResponseText(
        response,
        MAXIMUM_RESPONSE_BYTES,
      );
    } catch (error) {
      if (!(error instanceof BitqueryResponseBodyError)) throw error;
      throw new BitqueryLaunchCatalogError(
        error.kind === "unavailable" ? "transport" : "response",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(source);
    } catch {
      throw new BitqueryLaunchCatalogError("response");
    }
    const envelope = record(payload);
    const data = record(envelope?.data);
    if (data === null || array(envelope?.errors).length > 0) {
      throw new BitqueryLaunchCatalogError("response");
    }
    return data;
  } catch (error) {
    if (error instanceof BitqueryLaunchCatalogError) throw error;
    throw new BitqueryLaunchCatalogError("transport");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function parseBitqueryEvent(value: unknown): BitqueryEvent {
  const row = record(value);
  const block = record(row?.Block);
  const transaction = record(row?.Transaction);
  const log = record(row?.Log);
  const signature = record(log?.Signature);
  const contract = canonicalAddress(log?.SmartContract);
  const blockNumber = canonicalUnsignedInteger(block?.Number);
  const blockHash = canonicalBytes32(block?.Hash);
  const time = isoTime(block?.Time);
  const transactionHash = canonicalTransactionHash(transaction?.Hash);
  const transactionIndex = nonNegativeSafeInteger(transaction?.Index);
  const logIndex = nonNegativeSafeInteger(log?.Index);
  const name = nonEmptyString(signature?.Name);
  if (
    contract === null || blockNumber === null || blockHash === null ||
    time === null || transactionHash === null || transactionIndex === null ||
    logIndex === null || name === null
  ) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  const args = new Map<string, string>();
  for (const raw of array(row?.Arguments)) {
    const argument = record(raw);
    const argumentName = nonEmptyString(argument?.Name);
    const argumentValue = abiValue(record(argument?.Value));
    if (
      argumentName === null || argumentValue === null ||
      args.has(argumentName)
    ) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    args.set(argumentName, argumentValue);
  }
  return {
    name,
    contract,
    blockNumber,
    blockHash,
    time,
    transactionHash,
    transactionIndex,
    logIndex,
    arguments: args,
  };
}

function parseLaunchEvents(events: readonly BitqueryEvent[]): Readonly<{
  launches: ParsedLaunch[];
  liquidities: ParsedLiquidity[];
}> {
  const launches: ParsedLaunch[] = [];
  const liquidities: ParsedLiquidity[] = [];
  const coordinates = new Set<string>();
  for (const event of events) {
    const coordinate = `${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`;
    if (coordinates.has(coordinate)) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    coordinates.add(coordinate);
    const release = RELEASE_BY_LAUNCHER.get(event.contract);
    if (
      release === undefined ||
      (event.name !== release.launchEvent && event.name !== release.liquidityEvent)
    ) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    if (event.name === release.launchEvent) {
      launches.push(parseLaunch(release, event));
    } else {
      liquidities.push(parseLiquidity(release, event));
    }
  }
  return { launches, liquidities };
}

function parseLaunch(
  release: ReleaseDefinition,
  event: BitqueryEvent,
): ParsedLaunch {
  const args = event.arguments;
  const token = requiredAddress(args, "token");
  const poolId = requiredBytes32(args, "poolId");
  const positionRecipient = requiredAddress(args, "positionRecipient");
  const positionTokenId = requiredUnsigned(args, "positionTokenId");
  const launchHash = requiredBytes32(args, "launchHash");
  if (release.releaseId === "classic-v2") {
    const hook = requiredAddress(args, "feeHook");
    if (hook !== release.hook) throw new BitqueryLaunchCatalogError("integrity");
    return {
      release,
      event,
      token,
      poolId,
      creator: requiredAddress(args, "creator"),
      hook,
      positionRecipient,
      positionTokenId,
      launchHash,
      totalSwapFeeBps: requiredSmallUnsigned(args, "totalSwapFeeBps", 10_000),
    };
  }
  if (release.releaseId === "classic-v3") {
    const hook = requiredAddress(args, "feeHook");
    const buySwapFeeBps = requiredSmallUnsigned(args, "buySwapFeeBps", 10_000);
    const sellSwapFeeBps = requiredSmallUnsigned(args, "sellSwapFeeBps", 10_000);
    if (hook !== release.hook) throw new BitqueryLaunchCatalogError("integrity");
    return {
      release,
      event,
      token,
      poolId,
      creator: requiredAddress(args, "deployer"),
      hook,
      rewardVault: requiredAddress(args, "rewardVault"),
      positionRecipient,
      positionTokenId,
      launchHash,
      buySwapFeeBps,
      sellSwapFeeBps,
      totalSwapFeeBps: Math.max(buySwapFeeBps, sellSwapFeeBps),
    };
  }
  return {
    release,
    event,
    token,
    poolId,
    hook: release.hook,
    quoteAsset: requiredAddress(args, "quoteAsset"),
    rewardVault: requiredAddress(args, "rewardVault"),
    positionRecipient,
    positionTokenId,
    launchHash,
    totalSwapFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
  };
}

function parseLiquidity(
  release: ReleaseDefinition,
  event: BitqueryEvent,
): ParsedLiquidity {
  const args = event.arguments;
  return {
    event,
    token: requiredAddress(args, "token"),
    ...(release.model === "stock-paired"
      ? { quoteAsset: requiredAddress(args, "quoteAsset") }
      : {}),
    totalSupplyRaw: requiredUnsigned(args, "totalSupply"),
    tokenLiquidityAmountRaw: requiredUnsigned(args, "tokenLiquidityAmount"),
    lockedTokenDustRaw: requiredUnsigned(args, "lockedTokenDust"),
    initialTick: requiredSignedSafeInteger(args, "initialTick"),
    tickLower: requiredSignedSafeInteger(args, "tickLower"),
    tickUpper: requiredSignedSafeInteger(args, "tickUpper"),
    lpFeePips: requiredSmallUnsigned(args, "lpFeePips", 1_000_000),
    launchHash: requiredBytes32(args, "launchHash"),
  };
}

function requireLiquidity(
  launch: ParsedLaunch,
  liquidities: readonly ParsedLiquidity[],
): ParsedLiquidity {
  const matches = liquidities.filter((liquidity) =>
    liquidity.event.contract === launch.event.contract &&
    liquidity.event.transactionHash === launch.event.transactionHash &&
    liquidity.token === launch.token &&
    liquidity.launchHash === launch.launchHash &&
    liquidity.quoteAsset === launch.quoteAsset
  );
  if (matches.length !== 1) throw new BitqueryLaunchCatalogError("integrity");
  return matches[0]!;
}

function parseTokenMetadata(
  envelope: Readonly<Record<string, unknown>>,
  expectedAddresses: readonly `0x${string}`[],
): ReadonlyMap<string, TokenMetadata> {
  const evm = record(envelope.EVM);
  const trading = record(envelope.Trading);
  if (evm === null || trading === null) {
    throw new BitqueryLaunchCatalogError("response");
  }
  const expected = new Set(expectedAddresses);
  const metadata = new Map<string, TokenMetadata>();
  for (const raw of array(evm.transferMetadata)) {
    const currency = record(record(record(raw)?.Transfer)?.Currency);
    addCurrencyMetadata(metadata, expected, currency);
  }
  for (const raw of array(evm.poolMetadata)) {
    const trade = record(record(raw)?.Trade);
    for (const sideName of ["Buy", "Sell"] as const) {
      const currency = record(record(trade?.[sideName])?.Currency);
      addCurrencyMetadata(metadata, expected, currency);
    }
  }
  for (const raw of array(trading.tokenMetadata)) {
    const row = record(raw);
    const token = record(row?.Token);
    const supply = record(row?.Supply);
    const address = canonicalAddress(token?.Address);
    if (address === null || !expected.has(address)) continue;
    const current = metadata.get(address);
    const name = nonEmptyString(token?.Name);
    const symbol = nonEmptyString(token?.Symbol);
    const indexedTotalSupply = positiveDecimal(supply?.TotalSupply);
    if (
      current && name !== null && symbol !== null &&
      (current.name !== name || current.symbol !== symbol)
    ) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    if (current && indexedTotalSupply !== null) {
      metadata.set(address, { ...current, indexedTotalSupply });
    }
  }
  return metadata;
}

function addCurrencyMetadata(
  metadata: Map<string, TokenMetadata>,
  expected: ReadonlySet<string>,
  currency: Record<string, unknown> | null,
): void {
  const address = canonicalAddress(currency?.SmartContract);
  if (address === null || !expected.has(address) || currency === null) return;
  const candidate = currencyMetadata(currency);
  const current = metadata.get(address);
  if (current && !sameMetadata(current, candidate)) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  metadata.set(address, candidate);
}

function buildExploreEntry(
  launch: ParsedLaunch,
  liquidity: ParsedLiquidity,
  metadata: ReadonlyMap<string, TokenMetadata>,
): ExploreEntry {
  const tokenMetadata = metadata.get(launch.token);
  if (tokenMetadata === undefined) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  const quoteMetadata = launch.quoteAsset
    ? metadata.get(launch.quoteAsset)
    : undefined;
  if (launch.quoteAsset && quoteMetadata === undefined) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  const token: LauncherToken = {
    id: `1:${launch.token}`,
    name: tokenMetadata.name,
    symbol: tokenMetadata.symbol,
    tokenAddress: launch.token,
    hookAddress: launch.hook,
    poolId: launch.poolId,
    ...(launch.creator ? { creatorAddress: launch.creator } : {}),
    ...(launch.rewardVault ? { rewardVaultAddress: launch.rewardVault } : {}),
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId,
    launchHash: launch.launchHash,
    launchBlockNumber: launch.event.blockNumber,
    launchTransactionHash: launch.event.transactionHash,
    launchTransactionIndex: launch.event.transactionIndex,
    launchLogIndex: launch.event.logIndex,
    launchedAt: launch.event.time,
    totalSupply: formatUnits(
      BigInt(liquidity.totalSupplyRaw),
      tokenMetadata.decimals,
    ),
    totalSupplyRaw: liquidity.totalSupplyRaw,
    tokenDecimals: tokenMetadata.decimals,
    tokenLiquidityAmountRaw: liquidity.tokenLiquidityAmountRaw,
    lockedTokenDustRaw: liquidity.lockedTokenDustRaw,
    initialTick: liquidity.initialTick,
    tickLower: liquidity.tickLower,
    tickUpper: liquidity.tickUpper,
    lpFeePips: liquidity.lpFeePips,
    ...(launch.quoteAsset && quoteMetadata
      ? {
          quoteAssetAddress: launch.quoteAsset,
          quoteAssetName: quoteMetadata.name,
          quoteAssetSymbol: quoteMetadata.symbol,
        }
      : {}),
    ...(launch.buySwapFeeBps === undefined
      ? {}
      : { buyHookFeeBps: launch.buySwapFeeBps }),
    ...(launch.sellSwapFeeBps === undefined
      ? {}
      : { sellHookFeeBps: launch.sellSwapFeeBps }),
    ...(launch.release.model === "stock-paired"
      ? {
          buyHookFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
          sellHookFeeBps: STOCK_PAIRED_TOTAL_SWAP_FEE_BPS,
          creatorFeeBps: STOCK_PAIRED_CREATOR_FEE_BPS,
          programmableFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
          launcherFeeBps: STOCK_PAIRED_PROGRAMMABLE_FEE_BPS,
          transferTaxBps: 0,
        }
      : {}),
    totalSwapFeeBps: launch.totalSwapFeeBps,
    launchModel: launch.release.model,
    ...(launch.release.releaseId === "classic-v3" ||
        launch.release.releaseId === "stock-paired-v1" ||
        launch.release.releaseId === "stock-paired-v2" ||
        launch.release.releaseId === "stock-paired-v3"
      ? { launchModelVersion: launch.release.releaseId }
      : {}),
    liquidityPath: "meme",
  };
  return canonicalTokenExploreEntryV1(token);
}

function assertUniqueCatalog(entries: readonly ExploreEntry[]): void {
  const tokens = new Set<string>();
  const pools = new Set<string>();
  for (const entry of entries) {
    const token = entry.tokenAddress?.toLowerCase();
    if (!token || tokens.has(token)) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    tokens.add(token);
    if (entry.exploreKind !== "token" || pools.has(entry.poolId)) {
      throw new BitqueryLaunchCatalogError("integrity");
    }
    pools.add(entry.poolId);
  }
}

function compareEntries(first: ExploreEntry, second: ExploreEntry): number {
  if (first.launchedAt !== second.launchedAt) {
    return second.launchedAt.localeCompare(first.launchedAt);
  }
  return first.id.localeCompare(second.id);
}

function resolveToken(provided: string | null | undefined): string {
  const token = provided === undefined
    ? process.env[BITQUERY_LAUNCH_CATALOG_TOKEN_ENVIRONMENT_VARIABLE]
    : provided;
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new BitqueryLaunchCatalogError("configuration");
  }
  return token.trim();
}

function requiredAddress(
  values: ReadonlyMap<string, string>,
  name: string,
): `0x${string}` {
  const value = canonicalAddress(values.get(name));
  if (value === null) throw new BitqueryLaunchCatalogError("integrity");
  return value;
}

function requiredBytes32(
  values: ReadonlyMap<string, string>,
  name: string,
): `0x${string}` {
  const value = canonicalBytes32(values.get(name));
  if (value === null) throw new BitqueryLaunchCatalogError("integrity");
  return value;
}

function requiredUnsigned(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = canonicalUnsignedInteger(values.get(name));
  if (value === null) throw new BitqueryLaunchCatalogError("integrity");
  return value;
}

function requiredSmallUnsigned(
  values: ReadonlyMap<string, string>,
  name: string,
  maximum: number,
): number {
  const value = requiredUnsigned(values, name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  return parsed;
}

function requiredSignedSafeInteger(
  values: ReadonlyMap<string, string>,
  name: string,
): number {
  const value = values.get(name);
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u.test(value)) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  return parsed;
}

function abiValue(value: Record<string, unknown> | null): string | null {
  if (value === null) return null;
  const present = ["address", "bigInteger", "hex", "integer"]
    .filter((key) => value[key] !== null && value[key] !== undefined);
  if (present.length !== 1) return null;
  const item = value[present[0]!];
  if (typeof item === "number" && Number.isSafeInteger(item)) {
    return item.toString();
  }
  return typeof item === "string" ? item : null;
}

function currencyMetadata(value: Record<string, unknown>): TokenMetadata {
  const name = nonEmptyString(value.Name);
  const symbol = nonEmptyString(value.Symbol);
  const decimals = nonNegativeSafeInteger(value.Decimals);
  if (name === null || symbol === null || decimals === null || decimals > 255) {
    throw new BitqueryLaunchCatalogError("integrity");
  }
  return { name, symbol, decimals };
}

function sameMetadata(first: TokenMetadata, second: TokenMetadata): boolean {
  return first.name === second.name && first.symbol === second.symbol &&
    first.decimals === second.decimals;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalBytes32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalTransactionHash(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return TRANSACTION_HASH.test(normalized)
    ? normalized as `0x${string}`
    : null;
}

function canonicalUnsignedInteger(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value.toString();
  }
  return typeof value === "string" && UNSIGNED_INTEGER.test(value)
    ? value
    : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  const integer = canonicalUnsignedInteger(value);
  if (integer === null) return null;
  const parsed = Number(integer);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function positiveDecimal(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  ) return null;
  return Number(value) > 0 ? value : null;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
