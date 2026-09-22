import "server-only";

import { formatUnits, getAddress, type Address, type Hex } from "viem";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import {
  getStockPairedQuoteAssetsForRelease,
} from "@/lib/stock-paired";
import { getConfiguredStockPairedReleases } from "@/lib/stock-paired-release";
import type { CreatorClaim, CreatorProfile, ExploreSnapshot } from "@/lib/onchain/types";
import type { ClassicV3ProfileRewards } from "@/lib/profile/classic-v3-rewards";
import type { StockPairedProfileRewards } from "@/lib/profile/stock-paired-rewards";
import type { LauncherToken } from "@/lib/tokens";

import {
  BITQUERY_HTTP_ENDPOINT,
  BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE,
} from "./bitquery.server";
import {
  BitqueryResponseBodyError,
  readBoundedBitqueryResponseText,
} from "./bitquery-response.server";

const REQUEST_TIMEOUT_MS = 8_000;
const MAXIMUM_RESPONSE_BYTES = 4_000_000;
const PROFILE_EVENT_LIMIT = 10_000;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const NATIVE_QUOTE = "0x0000000000000000000000000000000000000000" as Address;

type FetchImplementation = typeof fetch;
type ReaderOptions = Readonly<{
  fetchImpl?: FetchImplementation;
  token?: string | null;
  signal?: AbortSignal;
}>;
type JsonRecord = Record<string, unknown>;

type ParsedEvent = Readonly<{
  name: string;
  contract: Address;
  blockNumber: string;
  blockHash: Hex;
  blockTime: string;
  transactionHash: Hex;
  transactionIndex: number;
  transactionFrom: Address;
  logIndex: number;
  arguments: ReadonlyMap<string, unknown>;
  argumentItems: readonly Readonly<{
    index: number;
    name: string;
    path: readonly Readonly<{ index: number; name: string }>[];
    value: unknown;
  }>[];
}>;

type ParsedCall = Readonly<{
  transactionHash: Hex;
  arguments: readonly Readonly<{
    index: number;
    name: string;
    path: readonly Readonly<{ index: number; name: string }>[];
    value: unknown;
  }>[];
}>;

type Launch = Readonly<{
  model: "classic-v2" | "classic-v3" | "stock-paired";
  creator: Address;
  token: Address;
  poolId: Hex;
  hook: Address;
  vault: Address;
  quoteAsset: Address;
  positionRecipient: Address;
  positionTokenId: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  launchHash: Hex;
  releaseVersion: LauncherToken["launchModelVersion"];
  event: ParsedEvent;
}>;

type TokenMetadata = Readonly<{
  name: string;
  symbol: string;
}>;

type RewardAllocation = Readonly<{
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
}>;

type RewardState = Readonly<{
  allocations: readonly RewardAllocation[];
  checkpointedByBeneficiary: ReadonlyMap<string, bigint>;
  claimedByBeneficiary: ReadonlyMap<string, bigint>;
  accrued: bigint;
  totalReceived: bigint;
}>;

type LaunchInput = Readonly<{
  name: string | null;
  symbol: string | null;
  allocations: readonly RewardAllocation[];
}>;

export class BitqueryProfileError extends Error {
  override name = "BitqueryProfileError";

  constructor(
    readonly category: "configuration" | "transport" | "response" | "integrity",
  ) {
    super("Profile data is temporarily unavailable");
  }
}

export function safeBitqueryProfileError(error: unknown) {
  return error instanceof BitqueryProfileError
    ? { name: error.name, category: error.category }
    : { name: "BitqueryProfileError", category: "unexpected" };
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function address(value: unknown): Address | null {
  const valueText = text(value);
  return valueText && /^0x[0-9a-f]{40}$/iu.test(valueText)
    ? getAddress(valueText)
    : null;
}

function bytes32(value: unknown): Hex | null {
  const valueText = text(value);
  return valueText && /^0x[0-9a-f]{64}$/iu.test(valueText)
    ? valueText.toLowerCase() as Hex
    : null;
}

function uintText(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  const valueText = text(value);
  return valueText && /^(?:0|[1-9][0-9]*)$/u.test(valueText)
    ? valueText
    : null;
}

function uint(value: unknown): bigint | null {
  const valueText = uintText(value);
  return valueText === null ? null : BigInt(valueText);
}

function safeInteger(value: unknown): number | null {
  const parsed = uint(value);
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(parsed)
    : null;
}

function isoTime(value: unknown): string | null {
  const valueText = text(value);
  if (!valueText || !Number.isFinite(Date.parse(valueText))) return null;
  return new Date(valueText).toISOString();
}

function argumentValue(value: unknown): unknown {
  const item = record(value);
  const union = record(item?.Value);
  if (!item || !union) return null;
  return union.address ?? union.bigInteger ?? union.hex ?? union.integer ??
    union.string ?? union.bool ?? null;
}

function parseEvent(value: unknown): ParsedEvent | null {
  const row = record(value);
  const block = record(row?.Block);
  const log = record(row?.Log);
  const signature = record(log?.Signature);
  const transaction = record(row?.Transaction);
  const name = text(signature?.Name);
  const contract = address(log?.SmartContract);
  const blockNumber = uintText(block?.Number);
  const blockHash = bytes32(block?.Hash);
  const blockTime = isoTime(block?.Time);
  const transactionHash = bytes32(transaction?.Hash);
  const transactionIndex = safeInteger(transaction?.Index);
  const transactionFrom = address(transaction?.From);
  const logIndex = safeInteger(log?.Index);
  if (
    !name || !contract || !blockNumber || !blockHash || !blockTime ||
    !transactionHash || transactionIndex === null || !transactionFrom ||
    logIndex === null
  ) return null;

  const argumentsMap = new Map<string, unknown>();
  const argumentItems: ParsedEvent["argumentItems"][number][] = [];
  for (const item of array(row?.Arguments)) {
    const itemRecord = record(item);
    const itemName = text(itemRecord?.Name)?.toLowerCase();
    const index = safeInteger(itemRecord?.Index);
    if (!itemName || index === null) continue;
    const value = argumentValue(item);
    const path = array(itemRecord?.Path).flatMap((pathItem) => {
      const pathRecord = record(pathItem);
      const pathIndex = safeInteger(pathRecord?.Index);
      const pathName = text(pathRecord?.Name);
      return pathIndex === null || !pathName
        ? []
        : [{ index: pathIndex, name: pathName }];
    });
    argumentItems.push({ index, name: itemName, path, value });
    if (!argumentsMap.has(itemName)) argumentsMap.set(itemName, value);
  }
  return {
    name,
    contract,
    blockNumber,
    blockHash,
    blockTime,
    transactionHash,
    transactionIndex,
    transactionFrom,
    logIndex,
    arguments: argumentsMap,
    argumentItems,
  };
}

function parseCall(value: unknown): ParsedCall | null {
  const row = record(value);
  const transactionHash = bytes32(record(row?.Transaction)?.Hash);
  if (!row || !transactionHash) return null;
  const argumentsList = array(row.Arguments).flatMap((value) => {
    const item = record(value);
    const index = safeInteger(item?.Index);
    const name = text(item?.Name);
    if (!item || index === null || !name) return [];
    const path = array(item.Path).flatMap((value) => {
      const entry = record(value);
      const entryIndex = safeInteger(entry?.Index);
      const entryName = text(entry?.Name);
      return entryIndex === null || !entryName
        ? []
        : [{ index: entryIndex, name: entryName }];
    });
    return [{ index, name, path, value: argumentValue(item) }];
  });
  return { transactionHash, arguments: argumentsList };
}

function argument(event: ParsedEvent, name: string) {
  return event.arguments.get(name.toLowerCase());
}

async function executeBitquery(
  query: string,
  variables: Record<string, unknown>,
  options: ReaderOptions,
): Promise<JsonRecord> {
  const token = options.token ??
    process.env[BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE];
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new BitqueryProfileError("configuration");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(BITQUERY_HTTP_ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!response.ok) throw new BitqueryProfileError("transport");
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new BitqueryProfileError("response");
    }
    let source: string;
    try {
      source = await readBoundedBitqueryResponseText(
        response,
        MAXIMUM_RESPONSE_BYTES,
      );
    } catch (error) {
      if (!(error instanceof BitqueryResponseBodyError)) throw error;
      throw new BitqueryProfileError(
        error.kind === "unavailable" ? "transport" : "response",
      );
    }
    const envelope = record(JSON.parse(source));
    if (!envelope || array(envelope.errors).length > 0) {
      throw new BitqueryProfileError("response");
    }
    const data = record(envelope.data);
    if (!data) throw new BitqueryProfileError("response");
    return data;
  } catch (error) {
    if (error instanceof BitqueryProfileError) throw error;
    throw new BitqueryProfileError("transport");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

const EVENT_SELECTION = `
  Block { Number Hash Time }
  Transaction { Hash Index From }
  Log { Index SmartContract Signature { Name } }
  Arguments {
    Index
    Name
    Path { Index Name }
    Value {
      ... on EVM_ABI_Address_Value_Arg { address }
      ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
      ... on EVM_ABI_Bytes_Value_Arg { hex }
      ... on EVM_ABI_Integer_Value_Arg { integer }
      ... on EVM_ABI_String_Value_Arg { string }
      ... on EVM_ABI_Boolean_Value_Arg { bool }
    }
  }
`;

const PROFILE_QUERY = `query ProgrammableBitqueryProfile(
  $launchSources: [String!]!
  $callTargets: [String!]!
  $hooks: [String!]!
) {
  EVM(network: eth, dataset: combined) {
    launches: Events(
      limit: { count: ${PROFILE_EVENT_LIMIT} }
      orderBy: [{ ascending: Block_Number }, { ascending: Transaction_Index }, { ascending: Log_Index }]
      where: {
        TransactionStatus: { Success: true }
        Log: { SmartContract: { in: $launchSources } }
      }
    ) { ${EVENT_SELECTION} }
    launchCalls: Calls(
      limit: { count: ${PROFILE_EVENT_LIMIT} }
      where: {
        TransactionStatus: { Success: true }
        Call: { To: { in: $callTargets }, Signature: { Name: { is: "launch" } } }
      }
    ) {
      Transaction { Hash }
      Arguments {
        Index
        Name
        Path { Index Name }
        Value {
          ... on EVM_ABI_Address_Value_Arg { address }
          ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
          ... on EVM_ABI_Bytes_Value_Arg { hex }
          ... on EVM_ABI_Integer_Value_Arg { integer }
          ... on EVM_ABI_String_Value_Arg { string }
          ... on EVM_ABI_Boolean_Value_Arg { bool }
        }
      }
    }
    hookEvents: Events(
      limit: { count: ${PROFILE_EVENT_LIMIT} }
      orderBy: [{ ascending: Block_Number }, { ascending: Transaction_Index }, { ascending: Log_Index }]
      where: {
        TransactionStatus: { Success: true }
        Log: {
          SmartContract: { in: $hooks }
          Signature: { Name: { in: ["NativeSwapFeesAccrued", "QuoteSwapFeesAccrued", "CreatorFeesClaimed"] } }
        }
      }
    ) { ${EVENT_SELECTION} }
  }
}`;

const VAULT_QUERY = `query ProgrammableBitqueryProfileVaults($vaults: [String!]!) {
  EVM(network: eth, dataset: combined) {
    vaultEvents: Events(
      limit: { count: ${PROFILE_EVENT_LIMIT} }
      orderBy: [{ ascending: Block_Number }, { ascending: Transaction_Index }, { ascending: Log_Index }]
      where: {
        TransactionStatus: { Success: true }
        Log: {
          SmartContract: { in: $vaults }
          Signature: { Name: { in: ["BeneficiaryFeesClaimed", "CreatorFeesCheckpointed", "PayoutWalletChanged", "CtoRewardConfigurationActivated", "PayoutAddressUpdated"] } }
        }
      }
    ) { ${EVENT_SELECTION} }
  }
}`;

function tokenMetadataQuery(tokens: readonly Address[]) {
  return {
    query: `query ProgrammableBitqueryProfileTokens($tokens: [String!]!) {
      EVM(network: eth, dataset: combined) {
        metadata: DEXTradeByTokens(
          limit: { count: ${Math.max(1, tokens.length)} }
          limitBy: { count: 1, by: Trade_Currency_SmartContract }
          orderBy: { descending: Block_Time }
          where: { Trade: { Currency: { SmartContract: { in: $tokens } } } }
        ) {
          Trade { Currency { SmartContract Name Symbol } }
        }
      }
    }`,
    variables: { tokens: tokens.map((token) => token.toLowerCase()) },
  };
}

function callArgumentKey(argument: ParsedCall["arguments"][number]) {
  return [...argument.path.map((item) => item.name), argument.name]
    .join(".")
    .replaceAll("_", "")
    .toLowerCase();
}

function callArrayIndex(
  argument: ParsedCall["arguments"][number],
  field: string,
) {
  const normalized = field.replaceAll("_", "").toLowerCase();
  const matching = [...argument.path]
    .reverse()
    .find((item) => item.name.replaceAll("_", "").toLowerCase().includes(normalized));
  return matching?.index ?? argument.index;
}

function parseLaunchInputs(calls: readonly ParsedCall[]) {
  const inputs = new Map<string, LaunchInput>();
  for (const call of calls) {
    const beneficiaries = new Map<number, Address>();
    const shares = new Map<number, number>();
    let name: string | null = null;
    let symbol: string | null = null;
    for (const item of call.arguments) {
      const key = callArgumentKey(item);
      if (key.endsWith(".name") || key === "name") {
        name ??= text(item.value);
      } else if (key.endsWith(".symbol") || key === "symbol") {
        symbol ??= text(item.value);
      }
      if (key.includes("rewardbeneficiaries")) {
        const beneficiary = address(item.value);
        if (beneficiary) {
          beneficiaries.set(callArrayIndex(item, "rewardbeneficiaries"), beneficiary);
        }
      }
      if (key.includes("rewardsharesbps")) {
        const share = safeInteger(item.value);
        if (share !== null) {
          shares.set(callArrayIndex(item, "rewardsharesbps"), share);
        }
      }
    }
    const allocations = [...beneficiaries]
      .sort(([left], [right]) => left - right)
      .flatMap(([index, beneficiary]) => {
        const shareBps = shares.get(index);
        return shareBps === undefined
          ? []
          : [{ beneficiary, payoutAddress: beneficiary, shareBps }];
      });
    if (
      allocations.length > 0 &&
      allocations.reduce((sum, item) => sum + item.shareBps, 0) !== 10_000
    ) {
      throw new BitqueryProfileError("integrity");
    }
    const key = call.transactionHash.toLowerCase();
    const previous = inputs.get(key);
    inputs.set(key, {
      name: previous?.name ?? name,
      symbol: previous?.symbol ?? symbol,
      allocations: previous?.allocations.length
        ? previous.allocations
        : allocations,
    });
  }
  return inputs;
}

function compareEvents(left: ParsedEvent, right: ParsedEvent) {
  const blockDifference = BigInt(left.blockNumber) - BigInt(right.blockNumber);
  if (blockDifference !== 0n) return blockDifference < 0n ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

function assertCompleteResult(value: unknown) {
  if (array(value).length >= PROFILE_EVENT_LIMIT) {
    throw new BitqueryProfileError("integrity");
  }
}

function configuredSources() {
  const production = appDeployments.production;
  const classicV2Launcher = getAddress(production.memeLaunch);
  const classicV2Hook = getAddress(production.ethCreatorFeeHook);
  const classicLauncher = getAddress(production.memeLaunchV2);
  const classicHook = getAddress(production.ethCreatorFeeHookV3);
  const stockReleases = getConfiguredStockPairedReleases();
  const historical = production.historicalV1Deployment;
  const classicV1Launcher = getAddress(historical.memeLaunch);
  const classicV1Hook = getAddress(historical.ethCreatorFeeHook);
  return {
    classicV1Launcher,
    classicV1Hook,
    classicV2Launcher,
    classicV2Hook,
    classicLauncher,
    classicHook,
    launchers: [
      classicV1Launcher,
      classicV2Launcher,
      classicLauncher,
      ...stockReleases.map((release) => release.addresses.launcher),
    ],
    coordinators: stockReleases.map((release) => release.addresses.ethLaunchCoordinator),
    hooks: [
      classicV1Hook,
      classicV2Hook,
      classicHook,
      ...stockReleases.map((release) => release.addresses.feeHook),
    ],
    stockReleases,
  };
}

function parseLaunches(events: readonly ParsedEvent[]): readonly Launch[] {
  const sources = configuredSources();
  const directClassic = new Map([
    [sources.classicV1Launcher.toLowerCase(), {
      hook: sources.classicV1Hook,
      releaseVersion: undefined,
    }],
    [sources.classicV2Launcher.toLowerCase(), {
      hook: sources.classicV2Hook,
      releaseVersion: undefined,
    }],
  ]);
  const stockByLauncher = new Map(
    sources.stockReleases.map((release) => [
      release.addresses.launcher.toLowerCase(),
      release,
    ]),
  );
  const coordinatedCreator = new Map(
    events.flatMap((event) => {
      if (event.name !== "StockPairedEthTokenLaunched") return [];
      const creator = address(argument(event, "creator"));
      const token = address(argument(event, "token"));
      return creator && token
        ? [[`${event.transactionHash.toLowerCase()}:${token.toLowerCase()}`, creator] as const]
        : [];
    }),
  );
  return events.flatMap((event): Launch[] => {
    if (event.name === "MemeTokenLaunched") {
      const configured = directClassic.get(event.contract.toLowerCase());
      const creator = address(argument(event, "creator"));
      const token = address(argument(event, "token"));
      const poolId = bytes32(argument(event, "poolId"));
      const hook = address(argument(event, "feeHook"));
      const positionRecipient = address(argument(event, "positionRecipient"));
      const positionTokenId = uintText(argument(event, "positionTokenId"));
      const totalSwapFeeBps = safeInteger(argument(event, "totalSwapFeeBps"));
      const launchHash = bytes32(argument(event, "launchHash"));
      if (
        !configured || !creator || !token || !poolId || !hook ||
        !positionRecipient || !positionTokenId || totalSwapFeeBps === null ||
        !launchHash || hook.toLowerCase() !== configured.hook.toLowerCase()
      ) return [];
      return [{
        model: "classic-v2",
        creator,
        token,
        poolId,
        hook,
        vault: creator,
        quoteAsset: NATIVE_QUOTE,
        positionRecipient,
        positionTokenId,
        buySwapFeeBps: totalSwapFeeBps,
        sellSwapFeeBps: totalSwapFeeBps,
        launchHash,
        releaseVersion: configured.releaseVersion,
        event,
      }];
    }
    if (
      event.name === "MemeTokenLaunchedV2" &&
      event.contract.toLowerCase() === sources.classicLauncher.toLowerCase()
    ) {
      const creator = address(argument(event, "deployer"));
      const token = address(argument(event, "token"));
      const poolId = bytes32(argument(event, "poolId"));
      const hook = address(argument(event, "feeHook"));
      const vault = address(argument(event, "rewardVault"));
      const positionRecipient = address(argument(event, "positionRecipient"));
      const positionTokenId = uintText(argument(event, "positionTokenId"));
      const buySwapFeeBps = safeInteger(argument(event, "buySwapFeeBps"));
      const sellSwapFeeBps = safeInteger(argument(event, "sellSwapFeeBps"));
      const launchHash = bytes32(argument(event, "launchHash"));
      if (
        !creator || !token || !poolId || !hook || !vault ||
        !positionRecipient || !positionTokenId || buySwapFeeBps === null ||
        sellSwapFeeBps === null || !launchHash ||
        hook.toLowerCase() !== sources.classicHook.toLowerCase()
      ) return [];
      return [{
        model: "classic-v3",
        creator,
        token,
        poolId,
        hook,
        vault,
        quoteAsset: NATIVE_QUOTE,
        positionRecipient,
        positionTokenId,
        buySwapFeeBps,
        sellSwapFeeBps,
        launchHash,
        releaseVersion: "classic-v3",
        event,
      }];
    }
    if (event.name !== "StockPairedTokenLaunched") return [];
    const release = stockByLauncher.get(event.contract.toLowerCase());
    const eventCreator = address(argument(event, "deployer"));
    const token = address(argument(event, "token"));
    const quoteAsset = address(argument(event, "quoteAsset"));
    const poolId = bytes32(argument(event, "poolId"));
    const vault = address(argument(event, "rewardVault"));
    const positionRecipient = address(argument(event, "positionRecipient"));
    const positionTokenId = uintText(argument(event, "positionTokenId"));
    const launchHash = bytes32(argument(event, "launchHash"));
    if (
      !release || !eventCreator || !token || !quoteAsset || !poolId || !vault ||
      !positionRecipient || !positionTokenId || !launchHash
    ) return [];
    const creator = coordinatedCreator.get(
      `${event.transactionHash.toLowerCase()}:${token.toLowerCase()}`,
    ) ?? eventCreator;
    return [{
      model: "stock-paired",
      creator,
      token,
      poolId,
      hook: release.addresses.feeHook,
      vault,
      quoteAsset,
      positionRecipient,
      positionTokenId,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      launchHash,
      releaseVersion: release.internalContractRelease,
      event,
    }];
  });
}

function parseMetadata(data: JsonRecord, tokens: readonly Address[]) {
  const evm = record(data.EVM);
  if (!evm) throw new BitqueryProfileError("response");
  assertCompleteResult(evm.launches);
  assertCompleteResult(evm.launchCalls);
  assertCompleteResult(evm.hookEvents);
  const byToken = new Map<string, TokenMetadata>();
  for (const value of array(evm.metadata)) {
    const currency = record(record(value)?.Trade)?.Currency;
    const metadata = record(currency);
    const token = address(metadata?.SmartContract);
    const name = text(metadata?.Name);
    const symbol = text(metadata?.Symbol);
    if (token && name && symbol) {
      byToken.set(token.toLowerCase(), { name, symbol });
    }
  }
  for (const token of tokens) {
    if (!byToken.has(token.toLowerCase())) {
      byToken.set(token.toLowerCase(), {
        name: `Token ${token.slice(0, 6)}`,
        symbol: token.slice(2, 6).toUpperCase(),
      });
    }
  }
  return byToken;
}

function quoteSymbol(quoteAsset: Address) {
  for (const release of configuredSources().stockReleases) {
    const asset = getStockPairedQuoteAssetsForRelease(release).find(
      (candidate) => candidate.address.toLowerCase() === quoteAsset.toLowerCase(),
    );
    if (asset) return asset.symbol;
  }
  return quoteAsset;
}

function latestSnapshot(events: readonly ParsedEvent[]): ExploreSnapshot | null {
  const latest = events.reduce<ParsedEvent | null>((current, event) => {
    if (!current || BigInt(event.blockNumber) > BigInt(current.blockNumber)) return event;
    return current;
  }, null);
  return latest
    ? {
        chainId: 1,
        blockNumber: latest.blockNumber,
        blockHash: latest.blockHash,
        blockTimestamp: latest.blockTime,
        confirmations: 0,
      }
    : null;
}

function launchToken(launch: Launch, metadata: TokenMetadata): LauncherToken {
  return {
    id: launch.token.toLowerCase(),
    name: metadata.name,
    symbol: metadata.symbol,
    tokenAddress: launch.token,
    hookAddress: launch.hook,
    poolId: launch.poolId,
    creatorAddress: launch.creator,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId,
    launchHash: launch.launchHash,
    launchBlockNumber: launch.event.blockNumber,
    launchTransactionHash: launch.event.transactionHash,
    launchTransactionIndex: launch.event.transactionIndex,
    launchLogIndex: launch.event.logIndex,
    launchedAt: launch.event.blockTime,
    totalSupply: "1000000000",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    ...(launch.model === "stock-paired"
      ? {
          quoteAssetAddress: launch.quoteAsset,
          quoteAssetSymbol: quoteSymbol(launch.quoteAsset),
          rewardVaultAddress: launch.vault,
          launchModel: "stock-paired" as const,
          launchModelVersion: launch.releaseVersion,
        }
      : {
          rewardVaultAddress: launch.vault,
          launchModel: "classic" as const,
          ...(launch.model === "classic-v3"
            ? { launchModelVersion: "classic-v3" as const }
            : {}),
        }),
    buyHookFeeBps: launch.buySwapFeeBps,
    sellHookFeeBps: launch.sellSwapFeeBps,
    totalSwapFeeBps:
      launch.buySwapFeeBps === launch.sellSwapFeeBps
        ? launch.buySwapFeeBps
        : null,
    liquidityPath: "meme",
  };
}

function eventAmount(event: ParsedEvent, name: string) {
  return uint(argument(event, name)) ?? 0n;
}

function allocate(
  amount: bigint,
  allocations: readonly RewardAllocation[],
  balances: Map<string, bigint>,
) {
  let allocated = 0n;
  allocations.forEach((allocation, index) => {
    const value = index === allocations.length - 1
      ? amount - allocated
      : amount * BigInt(allocation.shareBps) / 10_000n;
    allocated += value;
    const key = allocation.payoutAddress.toLowerCase();
    balances.set(key, (balances.get(key) ?? 0n) + value);
  });
}

function eventConfiguration(event: ParsedEvent): readonly RewardAllocation[] | null {
  const beneficiaries = new Map<number, Address>();
  const shares = new Map<number, number>();
  for (const item of event.argumentItems) {
    const key = [...item.path.map((path) => path.name), item.name]
      .join(".")
      .replaceAll("_", "")
      .toLowerCase();
    const pathIndex = [...item.path].reverse().find((path) =>
      path.name.replaceAll("_", "").toLowerCase().includes(
        key.includes("sharesbps") ? "sharesbps" : "beneficiaries",
      )
    )?.index ?? item.index;
    if (key.includes("beneficiaries")) {
      const beneficiary = address(item.value);
      if (beneficiary) beneficiaries.set(pathIndex, beneficiary);
    } else if (key.includes("sharesbps")) {
      const share = safeInteger(item.value);
      if (share !== null) shares.set(pathIndex, share);
    }
  }
  const result = [...beneficiaries]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, beneficiary]) => {
      const shareBps = shares.get(index);
      return shareBps === undefined
        ? []
        : [{ beneficiary, payoutAddress: beneficiary, shareBps }];
    });
  return result.length > 0 && result.reduce((sum, item) => sum + item.shareBps, 0) === 10_000
    ? result
    : null;
}

function rewardState(
  launch: Launch,
  events: readonly ParsedEvent[],
  initialAllocations: readonly RewardAllocation[],
): RewardState {
  let accrued = 0n;
  let totalReceived = 0n;
  let allocations = [...initialAllocations];
  const checkpointed = new Map<string, bigint>();
  const claimed = new Map<string, bigint>();

  for (const event of events) {
    const poolId = bytes32(argument(event, "poolId"));
    const eventVault = address(argument(event, "rewardVault")) ?? event.contract;
    const samePool = poolId?.toLowerCase() === launch.poolId.toLowerCase();
    const sameVault = eventVault.toLowerCase() === launch.vault.toLowerCase();
    if (!samePool && !sameVault) continue;
    if (event.name === "NativeSwapFeesAccrued" || event.name === "QuoteSwapFeesAccrued") {
      accrued += eventAmount(event, "creatorFee");
    }
    if (event.name === "CreatorFeesClaimed") {
      const amount = eventAmount(event, "amount");
      accrued = accrued > amount ? accrued - amount : 0n;
      const creator = address(argument(event, "creator"));
      if (creator) {
        const key = creator.toLowerCase();
        claimed.set(key, (claimed.get(key) ?? 0n) + amount);
      }
    }
    if (event.name === "CreatorFeesCheckpointed") {
      const amount = eventAmount(event, "amount");
      totalReceived = eventAmount(event, "totalCreatorFeesReceived");
      if (amount > 0n && allocations.length > 0) {
        allocate(amount, allocations, checkpointed);
      }
    }
    if (event.name === "BeneficiaryFeesClaimed") {
      const beneficiary = address(argument(event, "beneficiary"));
      const amount = eventAmount(event, "amount");
      if (beneficiary) {
        const beneficiaryTotal = eventAmount(event, "beneficiaryTotalClaimed");
        claimed.set(
          beneficiary.toLowerCase(),
          beneficiaryTotal > 0n
            ? beneficiaryTotal
            : (claimed.get(beneficiary.toLowerCase()) ?? 0n) + amount,
        );
      }
      const received = eventAmount(event, "vaultTotalReceived");
      if (received > totalReceived) totalReceived = received;
    }
    if (event.name === "PayoutAddressUpdated") {
      const beneficiary = address(argument(event, "beneficiary"));
      const payout = address(argument(event, "newPayoutAddress"));
      const current = beneficiary
        ? allocations.find((item) => item.beneficiary.toLowerCase() === beneficiary.toLowerCase())
        : null;
      if (beneficiary && payout && current) {
        allocations = allocations.map((item) =>
          item.beneficiary.toLowerCase() === beneficiary.toLowerCase()
            ? { ...item, payoutAddress: payout }
            : item
        );
      }
    }
    if (event.name === "PayoutWalletChanged") {
      const allocationIndex = safeInteger(argument(event, "allocationIndex"));
      const previous = address(argument(event, "previousPayoutWallet"));
      const next = address(argument(event, "newPayoutWallet"));
      if (
        allocationIndex !== null && previous && next && allocations[allocationIndex]?.payoutAddress.toLowerCase() ===
          previous.toLowerCase()
      ) {
        allocations = allocations.map((item, index) =>
          index === allocationIndex
            ? { ...item, beneficiary: next, payoutAddress: next }
            : item
        );
      }
    }
    if (event.name === "CtoRewardConfigurationActivated") {
      const configuration = eventConfiguration(event);
      if (configuration) allocations = [...configuration];
    }
  }
  return {
    allocations,
    checkpointedByBeneficiary: checkpointed,
    claimedByBeneficiary: claimed,
    accrued,
    totalReceived,
  };
}

type ReadBundle = Readonly<{
  launches: readonly Launch[];
  events: readonly ParsedEvent[];
  metadata: ReadonlyMap<string, TokenMetadata>;
  launchInputs: ReadonlyMap<string, LaunchInput>;
  snapshot: ExploreSnapshot | null;
}>;

async function readBundle(account: Address, options: ReaderOptions): Promise<ReadBundle> {
  const sources = configuredSources();
  const data = await executeBitquery(PROFILE_QUERY, {
    launchSources: [...sources.launchers, ...sources.coordinators]
      .map((value) => value.toLowerCase()),
    callTargets: [...sources.launchers, ...sources.coordinators]
      .map((value) => value.toLowerCase()),
    hooks: sources.hooks.map((value) => value.toLowerCase()),
  }, options);
  const evm = record(data.EVM);
  if (!evm) throw new BitqueryProfileError("response");
  const baseEvents = [...array(evm.launches), ...array(evm.hookEvents)]
    .map(parseEvent)
    .filter((event): event is ParsedEvent => event !== null);
  const launchInputs = parseLaunchInputs(
    array(evm.launchCalls).map(parseCall).filter((call): call is ParsedCall => call !== null),
  );
  const allLaunches = parseLaunches(baseEvents);
  const vaults = [...new Set(
    allLaunches
      .filter((launch) => launch.model !== "classic-v2")
      .map((launch) => launch.vault.toLowerCase()),
  )];
  const vaultData = vaults.length === 0
    ? null
    : await executeBitquery(VAULT_QUERY, { vaults }, options);
  const vaultEvm = vaultData === null ? null : record(vaultData.EVM);
  if (vaultData !== null && !vaultEvm) throw new BitqueryProfileError("response");
  assertCompleteResult(vaultEvm?.vaultEvents);
  const parsed = [
    ...baseEvents,
    ...array(vaultEvm?.vaultEvents)
      .map(parseEvent)
      .filter((event): event is ParsedEvent => event !== null),
  ].sort(compareEvents);
  const launches = allLaunches.filter(
    (launch) => launch.creator.toLowerCase() === account.toLowerCase() ||
      (launchInputs.get(launch.event.transactionHash.toLowerCase())?.allocations ?? [])
        .some((allocation) => allocation.beneficiary.toLowerCase() === account.toLowerCase()) ||
      parsed.some((event) => event.contract.toLowerCase() === launch.vault.toLowerCase() &&
        [...event.arguments.values()].some((value) => address(value)?.toLowerCase() === account.toLowerCase())),
  );
  const uniqueTokens = [...new Set(launches.map((launch) => launch.token.toLowerCase()))]
    .map(getAddress);
  const metadata = uniqueTokens.length === 0
    ? new Map<string, TokenMetadata>()
    : parseMetadata(
        await executeBitquery(
          tokenMetadataQuery(uniqueTokens).query,
          tokenMetadataQuery(uniqueTokens).variables,
          options,
        ),
        uniqueTokens,
      );
  return {
    launches,
    events: parsed,
    metadata,
    launchInputs,
    snapshot: latestSnapshot(parsed),
  };
}

function metadataFor(bundle: ReadBundle, launch: Launch) {
  const input = bundle.launchInputs.get(launch.event.transactionHash.toLowerCase());
  const indexed = bundle.metadata.get(launch.token.toLowerCase());
  return {
    name: input?.name ?? indexed?.name ?? launch.token,
    symbol: input?.symbol ?? indexed?.symbol ?? launch.token.slice(0, 10),
  };
}

export async function readBitqueryCreatorProfile(
  account: Address,
  options: ReaderOptions = {},
): Promise<CreatorProfile> {
  const bundle = await readBundle(account, options);
  const launches = bundle.launches.filter(
    (launch) =>
      launch.model === "classic-v2" &&
      launch.creator.toLowerCase() === account.toLowerCase(),
  );
  const tokens = launches.map((launch) => launchToken(launch, metadataFor(bundle, launch)));
  const tokenByPool = new Map(launches.map((launch) => [launch.poolId.toLowerCase(), launch]));
  const claims: CreatorClaim[] = bundle.events.flatMap((event) => {
    if (event.name !== "CreatorFeesClaimed") return [];
    const poolId = bytes32(argument(event, "poolId"));
    const creator = address(argument(event, "creator"));
    const recipient = address(argument(event, "recipient"));
    const caller = address(argument(event, "caller"));
    const amount = uint(argument(event, "amount"));
    const launch = poolId ? tokenByPool.get(poolId.toLowerCase()) : null;
    if (
      !poolId || !creator || !recipient || !caller || amount === null || !launch ||
      creator.toLowerCase() !== account.toLowerCase()
    ) return [];
    return [{
      poolId,
      tokenAddress: launch.token,
      creatorAddress: creator,
      recipientAddress: recipient,
      callerAddress: caller,
      amountWei: amount.toString(),
      amountEth: formatUnits(amount, 18),
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      claimedAt: event.blockTime,
    }];
  });
  const pools = launches.map((launch) => {
    const state = rewardState(launch, bundle.events, []);
    const claimed = state.claimedByBeneficiary.get(account.toLowerCase()) ?? 0n;
    const generated = state.accrued + claimed;
    const metadata = metadataFor(bundle, launch);
    return {
      tokenAddress: launch.token,
      name: metadata.name,
      symbol: metadata.symbol,
      poolId: launch.poolId,
      totalSwapFeeBps: launch.buySwapFeeBps,
      launchModel: "classic" as const,
      claimableCreatorFeesWei: state.accrued.toString(),
      claimableCreatorFeesEth: formatUnits(state.accrued, 18),
      generatedCreatorFeesWei: generated.toString(),
      generatedCreatorFeesEth: formatUnits(generated, 18),
    };
  });
  const claimable = pools.reduce((sum, pool) => sum + BigInt(pool.claimableCreatorFeesWei), 0n);
  const generated = pools.reduce((sum, pool) => sum + BigInt(pool.generatedCreatorFeesWei), 0n);
  return {
    status: "ready",
    account,
    tokens,
    pools,
    claims,
    totals: {
      claimableWei: claimable.toString(),
      claimableEth: formatUnits(claimable, 18),
      generatedWei: generated.toString(),
      generatedEth: formatUnits(generated, 18),
      claimedWei: claims.reduce((sum, claim) => sum + BigInt(claim.amountWei), 0n).toString(),
      claimedEth: formatUnits(
        claims.reduce((sum, claim) => sum + BigInt(claim.amountWei), 0n),
        18,
      ),
    },
    snapshot: bundle.snapshot ?? {
      chainId: 1,
      blockNumber: "0",
      blockHash: ZERO_HASH,
      confirmations: 0,
    },
  };
}

export async function readBitqueryClassicV3Profile(
  account: Address,
  options: ReaderOptions = {},
): Promise<ClassicV3ProfileRewards> {
  const bundle = await readBundle(account, options);
  const rewards = bundle.launches
    .filter((launch) => launch.model === "classic-v3")
    .flatMap((launch) => {
      const initialAllocations = bundle.launchInputs.get(
        launch.event.transactionHash.toLowerCase(),
      )?.allocations ?? [];
      const state = rewardState(launch, bundle.events, initialAllocations);
      const metadata = metadataFor(bundle, launch);
      const allocation = state.allocations.find((item) =>
        item.beneficiary.toLowerCase() === account.toLowerCase()
      );
      if (!allocation) return [];
      const claimed = state.claimedByBeneficiary.get(account.toLowerCase()) ?? 0n;
      const checkpointed = state.checkpointedByBeneficiary.get(account.toLowerCase()) ?? 0n;
      const prospective = state.accrued * BigInt(allocation.shareBps) / 10_000n;
      const claimable = checkpointed + prospective > claimed
        ? checkpointed + prospective - claimed
        : 0n;
      const beneficiaries = state.allocations.map((item, allocationIndex) => ({
        allocationIndex,
        beneficiary: item.beneficiary,
        payoutAddress: item.payoutAddress,
        shareBps: item.shareBps,
      }));
      return [{
        tokenAddress: launch.token,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        poolId: launch.poolId,
        vaultAddress: launch.vault,
        beneficiary: account,
        payoutAddress: allocation.payoutAddress,
        shareBps: allocation.shareBps,
        ownedAllocations: beneficiaries.filter((item) =>
          item.payoutAddress.toLowerCase() === account.toLowerCase()
        ),
        claimableWei: claimable.toString(),
        claimableEth: formatUnits(claimable, 18),
        claimedWei: claimed.toString(),
        claimedEth: formatUnits(claimed, 18),
        buySwapFeeBps: launch.buySwapFeeBps,
        sellSwapFeeBps: launch.sellSwapFeeBps,
        platformFeeBps: 10 as const,
        beneficiaries,
        launchTransactionHash: launch.event.transactionHash,
      }];
    });
  return { status: "ready", account, chainId: 1, rewards };
}

export async function readBitqueryClassicV3Launch(
  account: Address,
  transactionHash: Hex,
  options: ReaderOptions = {},
) {
  const bundle = await readBundle(account, options);
  const launch = bundle.launches.find((candidate) =>
    candidate.model === "classic-v3" &&
    candidate.creator.toLowerCase() === account.toLowerCase() &&
    candidate.event.transactionHash.toLowerCase() === transactionHash.toLowerCase()
  );
  if (!launch) return { status: "ready" as const, launch: null };
  const metadata = metadataFor(bundle, launch);
  return {
    status: "ready" as const,
    launch: {
      tokenAddress: launch.token,
      name: metadata.name,
      symbol: metadata.symbol,
      launchTransactionHash: launch.event.transactionHash,
    },
  };
}

export async function readBitqueryStockPairedProfile(
  account: Address,
  options: ReaderOptions = {},
): Promise<StockPairedProfileRewards> {
  const bundle = await readBundle(account, options);
  const rewards = bundle.launches
    .filter((launch) => launch.model === "stock-paired")
    .flatMap((launch) => {
      const initialAllocations = bundle.launchInputs.get(
        launch.event.transactionHash.toLowerCase(),
      )?.allocations ?? [];
      const state = rewardState(launch, bundle.events, initialAllocations);
      const metadata = metadataFor(bundle, launch);
      const allocation = state.allocations.find((item) =>
        item.beneficiary.toLowerCase() === account.toLowerCase()
      );
      if (!allocation) return [];
      const beneficiaries = state.allocations;
      const shareBps = allocation.shareBps;
      const claimed = state.claimedByBeneficiary.get(account.toLowerCase()) ?? 0n;
      const generated = (state.totalReceived + state.accrued) * BigInt(shareBps) / 10_000n;
      const claimable = generated > claimed ? generated - claimed : 0n;
      return [{
        model: "stock-paired" as const,
        tokenAddress: launch.token,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        hookAddress: launch.hook,
        poolId: launch.poolId,
        vaultAddress: launch.vault,
        quoteAsset: launch.quoteAsset,
        quoteAssetSymbol: quoteSymbol(launch.quoteAsset),
        beneficiary: account,
        payoutAddress: allocation.payoutAddress,
        shareBps,
        claimableRaw: claimable.toString(),
        claimable: formatUnits(claimable, 18),
        claimedRaw: claimed.toString(),
        claimed: formatUnits(claimed, 18),
        generatedRaw: generated.toString(),
        generated: formatUnits(generated, 18),
        creatorFeesPendingRaw: state.accrued.toString(),
        beneficiaries,
        buySwapFeeBps: 100 as const,
        sellSwapFeeBps: 100 as const,
        programmableFeeBps: 10 as const,
        launchTransactionHash: launch.event.transactionHash,
      }];
    });
  return {
    status: "ready",
    account,
    chainId: 1,
    snapshotBlock: bundle.snapshot?.blockNumber ?? "0",
    rewards,
  };
}
