import "server-only";
import { boundedEvmFetch } from "@/lib/server/evm-bounded-fetch";
import { unstable_cache } from "next/cache";
import { createPublicClient, http, encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from "viem";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
const VIEW = "0x1656326235cb9E34Cb58CaDe53AE30789AB32A1A", FEED = "0x2b25BC41D55de29F3A2e163F8Eebf63966B25b57", NATIVE = "0x0000000000000000000000000000000000000000";
const VIEW_HASH = "0xd655ab42f4f80273ba93b07b8ac024a1ea834f0c24bdd50a7ec04e87633b1ad5", FEED_HASH = "0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2";
const STATE = parseAbi(["function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)", "function getLiquidity(bytes32) view returns(uint128)"]);
const PRICE = parseAbi(["function decimals() view returns(uint8)", "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)"]);
const TOKEN = parseAbi(["function decimals() view returns(uint8)", "function totalSupply() view returns(uint256)"]);
export type HyperEvmMarketIdentity = {
  tokenAddress: string;
  poolId: string;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
};
let client: ReturnType<typeof createPublicClient> | undefined;
const rpc = () => client ??= createPublicClient({ transport: http(process.env.HYPEREVM_RPC_PRIMARY_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 5000, retryCount: 0, fetchFn: boundedEvmFetch, batch: { batchSize: 48, wait: 5 } }) });
let point: Promise<{
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  price: bigint;
}> | undefined, expires = 0;
async function checkpoint() {
  if (point && expires > Date.now())
    return point;
  if (!point && expires > Date.now())
    throw Error("Market provider is cooling down");
  expires = Date.now() + 10000;
  point = (async () => {
    const c = rpc();
    const [chain, b] = await Promise.all([c.getChainId(), c.getBlock()]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (chain !== 999 || b.number === null || !b.hash || b.timestamp > now + 10n || now - b.timestamp > 60n)
      throw Error("Market checkpoint unavailable");
    const [code, feedCode, decimals, round] = await Promise.all([c.getBytecode({ address: VIEW, blockNumber: b.number }), c.getBytecode({ address: FEED, blockNumber: b.number }), c.readContract({ address: FEED, abi: PRICE, functionName: "decimals", blockNumber: b.number }), c.readContract({ address: FEED, abi: PRICE, functionName: "latestRoundData", blockNumber: b.number })]);
    if (!code || keccak256(code) !== VIEW_HASH || !feedCode || keccak256(feedCode) !== FEED_HASH || decimals !== 18 || round[1] <= 0n || round[3] === 0n || round[3] > b.timestamp || b.timestamp - round[3] > 86520n || round[4] < round[0])
      throw Error("HYPE price unavailable");
    return { number: b.number, hash: b.hash, timestamp: b.timestamp, price: round[1] };
  })().catch(error => { point = undefined; expires = Date.now() + 15000; throw error; });
  return point;
}
async function readOne(identity: HyperEvmMarketIdentity): Promise<RobinhoodCoinMarket> {
  const p = identity.poolKey, c = rpc(), b = await checkpoint(), token = identity.tokenAddress as Address;
  const tokenIs0 = p.currency0.toLowerCase() === token.toLowerCase();
  const quote = tokenIs0 ? p.currency1 : p.currency0;
  if (quote.toLowerCase() !== NATIVE || (tokenIs0 ? p.currency0 : p.currency1).toLowerCase() !== token.toLowerCase())
    throw Error("No native quote");
  const id = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [p.currency0 as Address, p.currency1 as Address, p.fee, p.tickSpacing, p.hooks as Address]));
  if (id.toLowerCase() !== identity.poolId.toLowerCase())
    throw Error("Pool changed");
  const [slot, liquidity, decimals, supply] = await Promise.all([
    c.readContract({ address: VIEW, abi: STATE, functionName: "getSlot0", args: [id], blockNumber: b.number }), c.readContract({ address: VIEW, abi: STATE, functionName: "getLiquidity", args: [id], blockNumber: b.number }),
    c.readContract({ address: token, abi: TOKEN, functionName: "decimals", blockNumber: b.number }), c.readContract({ address: token, abi: TOKEN, functionName: "totalSupply", blockNumber: b.number })
  ]);
  const square = slot[0] * slot[0], q = 1n << 192n;
  if (!square || !liquidity || !supply || decimals > 36)
    throw Error("Inactive pool");
  const numerator = (tokenIs0 ? square : q) * b.price, denominator = (tokenIs0 ? q : square) * 10n ** 18n;
  const priceUsd = Number(numerator * 10n ** BigInt(decimals) / denominator) / 1e18, fdvUsd = Number(numerator * supply / denominator) / 1e18;
  if (!Number.isFinite(priceUsd) || !Number.isFinite(fdvUsd) || priceUsd <= 0 || fdvUsd <= 0)
    throw Error("Invalid pool valuation");
  return { poolId: identity.poolId, source: "uniswap-v4", valuationKind: "fdv", priceUsd, fdvUsd, marketCapUsd: null, liquidityUsd: null, volume24hUsd: null, change24hPercent: null, quoteAsset: { address: NATIVE, symbol: "HYPE" }, blockNumber: b.number.toString(), blockHash: b.hash, observedAt: new Date(Number(b.timestamp) * 1000).toISOString(), sourceUrl: `https://hyperevmscan.io/block/${b.number}` };
}
const cachedRead = unstable_cache(readOne, ["hyperevm-native-spot-v1"], { revalidate: 120 });
/** At most ten missing native pools per read. No historical scan or invented volume. */
export async function enrichHyperEvmMarkets(tokens: readonly {
  tokenAddress: string;
  poolId?: string | null;
  poolKey?: unknown;
}[], known: ReadonlyMap<string, RobinhoodCoinMarket>) {
  const result = new Map(known), missing = tokens.filter(t => !known.get(t.tokenAddress.toLowerCase())?.priceUsd && t.poolId && t.poolKey).slice(0, 10);
  await Promise.all(missing.map(async (token) => { try {
    const value = await cachedRead(token as HyperEvmMarketIdentity);
    result.set(token.tokenAddress.toLowerCase(), { ...known.get(token.tokenAddress.toLowerCase()), ...value });
  }
  catch { /* Keep authoritative launch metadata available while the quote is unavailable. */ } }));
  return result;
}
