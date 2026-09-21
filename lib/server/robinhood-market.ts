import "server-only";

import { unstable_cache } from "next/cache";
import {
  createPublicClient, decodeEventLog, encodeAbiParameters, erc20Abi, formatUnits,
  getAddress, http, keccak256, parseAbi, type Address, type Hex, type PublicClient,
} from "viem";
import { ROBINHOOD_BLOCK_EXPLORER_URL, ROBINHOOD_MAINNET_RPC_URL, robinhoodChain } from "@/lib/chains";
import chainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";

export type RobinhoodMarketIdentity = Pick<RobinhoodLaunch,
  "tokenAddress" | "poolId" | "poolManager" | "hookAddress" | "transactionHash" | "blockNumber" | "blockHash">;

type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
type Checkpoint = { number: bigint; hash: Hex; timestamp: bigint };
type QuotePrice = { numerator: bigint; denominator: bigint; decimals: number; checkpoint: Checkpoint };
const NATIVE = "0x0000000000000000000000000000000000000000";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const Q192 = 1n << 192n;
const WAD = 10n ** 18n;
const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const INITIALIZE = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const STATE = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const FEED = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uniswap = chainProfile.contracts.uniswap;

function client() {
  return createPublicClient({ chain: robinhoodChain,
    transport: http(ROBINHOOD_MAINNET_RPC_URL, { timeout: 4_000, retryCount: 0, batch: { wait: 10, batchSize: 50 } }) });
}

/** Derive the exact PoolKey from the already-indexed creation receipt, not an address/symbol search. */
async function readPoolKey(token: RobinhoodMarketIdentity, rpc: PublicClient): Promise<PoolKey> {
  if (!ADDRESS.test(token.tokenAddress) || !token.poolManager || !same(token.poolManager, uniswap.poolManager.address)
    || !token.hookAddress || !ADDRESS.test(token.hookAddress) || !token.poolId || !HASH.test(token.poolId)
    || !HASH.test(token.transactionHash) || !HASH.test(token.blockHash) || !/^[1-9][0-9]*$/.test(token.blockNumber)) {
    throw new Error("Market identity unavailable");
  }
  const receipt = await rpc.getTransactionReceipt({ hash: token.transactionHash as Hex });
  if (receipt.status !== "success" || !same(receipt.transactionHash, token.transactionHash)
    || receipt.blockNumber.toString() !== token.blockNumber || !same(receipt.blockHash, token.blockHash)) {
    throw new Error("Market origin changed");
  }
  const events = receipt.logs.flatMap(log => {
    if (!same(log.address, token.poolManager!) || log.removed || !same(log.blockHash, token.blockHash)
      || !same(log.transactionHash, token.transactionHash) || log.blockNumber !== receipt.blockNumber) return [];
    try {
      const event = decodeEventLog({ abi: INITIALIZE, data: log.data, topics: log.topics, strict: true });
      return same(event.args.id, token.poolId!) ? [event.args] : [];
    } catch { return []; }
  });
  if (events.length !== 1) throw new Error("Market pool origin unavailable");
  const { currency0, currency1, fee, tickSpacing, hooks } = events[0];
  const key = { currency0, currency1, fee, tickSpacing, hooks };
  const id = keccak256(encodeAbiParameters([{ type: "tuple", components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
  ] }], [key]));
  if (!same(id, token.poolId!) || !same(hooks, token.hookAddress)
    || (!same(currency0, token.tokenAddress) && !same(currency1, token.tokenAddress))) {
    throw new Error("Market pool identity mismatch");
  }
  return key;
}

const cachedPoolKey = unstable_cache(async (token: RobinhoodMarketIdentity) => readPoolKey(token, client()),
  ["robinhood-market-pool-origin-v1"], { revalidate: 86_400 });

async function withinBudget<T>(read: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Market observation timed out")), Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}

async function bounded<T, R>(values: readonly T[], deadline: number, read: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  let next = 0;
  const results: PromiseSettledResult<R>[] = Array.from(values, () => ({ status: "rejected", reason: new Error("Market observation timed out") }));
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length && Date.now() < deadline) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await withinBudget(read(values[index]), deadline) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

function freshCheckpoint(value: { number: bigint | null; hash: Hex | null; timestamp: bigint }, now: bigint): Checkpoint {
  if (value.number === null || value.hash === null || value.timestamp > now + 10n || now - value.timestamp > 60n) {
    throw new Error("Current market checkpoint unavailable");
  }
  return { number: value.number, hash: value.hash, timestamp: value.timestamp };
}

function dollars(value: bigint) {
  const result = Number(formatUnits(value, 18));
  if (!Number.isFinite(result) || result <= 0) throw new Error("Current market valuation unavailable");
  return result;
}

/** A current pool spot valuation. Total supply means FDV; neither circulating cap, TVL nor candles are invented. */
export async function readRobinhoodOnchainMarkets(tokens: readonly RobinhoodMarketIdentity[], dependencies: {
  client?: PublicClient; now?: () => number; quotePrice?: typeof readAnyQuoteUsdPriceV1;
} = {}): Promise<Map<string, RobinhoodCoinMarket>> {
  const markets = new Map<string, RobinhoodCoinMarket>();
  if (tokens.length === 0) return markets;
  const deadline = Date.now() + 8_000;
  const rpc = dependencies.client ?? client(), now = BigInt(Math.floor((dependencies.now ?? Date.now)() / 1000));
  const [chain, head] = await Promise.all([rpc.getChainId(), rpc.getBlock({ blockTag: "latest" })]);
  if (chain !== 4663) throw new Error("Market chain mismatch");
  const checkpoint = freshCheckpoint(head, now);
  const infrastructure = new Map<string, Promise<void>>();
  const verifyCheckpoint = (point: Checkpoint): Promise<void> => {
    const key = point.hash.toLowerCase();
    if (!infrastructure.has(key)) infrastructure.set(key, (async () => {
      const [block, ...codes] = await Promise.all([
        rpc.getBlock({ blockNumber: point.number }),
        ...[uniswap.poolManager, uniswap.stateView].map(pin => rpc.getCode({ address: getAddress(pin.address), blockNumber: point.number })),
      ]);
      if (!block.hash || !same(block.hash, point.hash) || block.timestamp !== point.timestamp) throw new Error("Market checkpoint changed");
      [uniswap.poolManager, uniswap.stateView].forEach((pin, index) => {
        if (!codes[index] || !same(keccak256(codes[index]!), pin.runtimeCodeHash)) throw new Error("Market infrastructure mismatch");
      });
    })());
    return infrastructure.get(key)!;
  };
  await verifyCheckpoint(checkpoint);
  const quotes = new Map<string, Promise<QuotePrice>>();
  const nativePrice = async (): Promise<QuotePrice> => {
    const [[roundId, answer, , updatedAt, answeredInRound], decimals] = await Promise.all([
      rpc.readContract({ address: ETH_USD, abi: FEED, functionName: "latestRoundData", blockNumber: checkpoint.number }),
      rpc.readContract({ address: ETH_USD, abi: FEED, functionName: "decimals", blockNumber: checkpoint.number }),
    ]);
    if (roundId <= 0n || answer <= 0n || answeredInRound < roundId || updatedAt <= 0n || updatedAt > now
      || now - updatedAt > 86_400n || decimals > 36) throw new Error("Current ETH price unavailable");
    return { numerator: answer, denominator: 10n ** BigInt(decimals), decimals: 18, checkpoint };
  };
  const quote = (asset: Address): Promise<QuotePrice> => {
    const key = [NATIVE, WETH].includes(asset.toLowerCase()) ? NATIVE : asset.toLowerCase();
    if (!quotes.has(key)) quotes.set(key, key === NATIVE ? nativePrice() : (async () => {
      // Reuse the same authoritative feed / qualified AMM policy as Any Quote launches.
      const value = await withinBudget((dependencies.quotePrice ?? readAnyQuoteUsdPriceV1)({ quoteAsset: asset }), deadline);
      const point = freshCheckpoint({ number: BigInt(value.checkpoint.number), hash: value.checkpoint.hash,
        timestamp: BigInt(value.checkpoint.timestamp) }, now);
      if (value.chainId !== 4663 || !same(value.quoteAsset, asset) || value.decimals < 0 || value.decimals > 36
        || BigInt(value.price.validUntil) <= now || BigInt(value.price.observedAt) > now
        || now - BigInt(value.price.observedAt) > BigInt(value.price.heartbeatSeconds)) throw new Error("Current quote price unavailable");
      const numerator = BigInt(value.price.usd.numerator), denominator = BigInt(value.price.usd.denominator);
      if (numerator <= 0n || denominator <= 0n) throw new Error("Current quote price unavailable");
      await verifyCheckpoint(point);
      return { numerator, denominator, decimals: value.decimals, checkpoint: point };
    })());
    return quotes.get(key)!;
  };
  const results = await bounded(tokens, deadline, async token => {
    const key = dependencies.client ? await readPoolKey(token, rpc) : await cachedPoolKey(token);
    const tokenIs0 = same(key.currency0, token.tokenAddress), reference = await quote(tokenIs0 ? key.currency1 : key.currency0);
    const point = reference.checkpoint;
    const [[sqrtPriceX96], liquidity, totalSupply, decimals] = await Promise.all([
      rpc.readContract({ address: getAddress(uniswap.stateView.address), abi: STATE, functionName: "getSlot0", args: [token.poolId as Hex], blockNumber: point.number }),
      rpc.readContract({ address: getAddress(uniswap.stateView.address), abi: STATE, functionName: "getLiquidity", args: [token.poolId as Hex], blockNumber: point.number }),
      rpc.readContract({ address: getAddress(token.tokenAddress), abi: erc20Abi, functionName: "totalSupply", blockNumber: point.number }),
      rpc.readContract({ address: getAddress(token.tokenAddress), abi: erc20Abi, functionName: "decimals", blockNumber: point.number }),
    ]);
    if (sqrtPriceX96 <= 0n || liquidity <= 0n || totalSupply <= 0n || decimals > 36) throw new Error("Active market unavailable");
    const squared = sqrtPriceX96 * sqrtPriceX96;
    const numerator = (tokenIs0 ? squared : Q192) * reference.numerator * WAD;
    const denominator = (tokenIs0 ? Q192 : squared) * reference.denominator * 10n ** BigInt(reference.decimals);
    const priceUsd = dollars(numerator * 10n ** BigInt(decimals) / denominator);
    const fdvUsd = dollars(numerator * totalSupply / denominator);
    return [token.tokenAddress.toLowerCase(), {
      poolId: token.poolId!, source: "uniswap-v4", valuationKind: "fdv", priceUsd, marketCapUsd: null, fdvUsd,
      quoteAsset: { address: tokenIs0 ? key.currency1 : key.currency0, symbol: null },
      liquidityUsd: null, volume24hUsd: null, change24hPercent: null,
      observedAt: new Date(Number(point.timestamp) * 1000).toISOString(), blockNumber: point.number.toString(), blockHash: point.hash,
      sourceUrl: `${ROBINHOOD_BLOCK_EXPLORER_URL}/block/${point.number}`,
    } satisfies RobinhoodCoinMarket] as const;
  });
  // Detect a reorg between the price/supply reads and returning their observation.
  const accepted = new Map<string, boolean>();
  await Promise.all([...infrastructure.keys()].map(async hash => {
    const value = await rpc.getBlock({ blockHash: hash as Hex }).catch(() => null);
    const canonical = value?.number === undefined || value.number === null ? null : await rpc.getBlock({ blockNumber: value.number }).catch(() => null);
    accepted.set(hash, canonical?.hash?.toLowerCase() === hash);
  }));
  for (const result of results) if (result.status === "fulfilled" && accepted.get(result.value[1].blockHash.toLowerCase())) markets.set(...result.value);
  return markets;
}
