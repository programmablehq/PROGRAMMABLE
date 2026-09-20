import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import chainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
import { coinValuation, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/module-engine/any-quote/readiness.server", () => ({ readAnyQuoteUsdPriceV1: vi.fn() }));
import { readRobinhoodOnchainMarkets } from "@/lib/server/robinhood-market";

const address = (digit: string) => `0x${digit.repeat(40)}` as Hex;
const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const now = 1_790_000_000_000;
const INITIALIZE = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const INFRA = chainProfile.contracts.uniswap;
// Test runtimes have a deterministic pin; all production pins still come from the versioned profile.
vi.spyOn(INFRA.poolManager, "runtimeCodeHash", "get").mockReturnValue(keccak256("0x1234"));
vi.spyOn(INFRA.stateView, "runtimeCodeHash", "get").mockReturnValue(keccak256("0x5678"));

function fixture(options: { tokenIs0?: boolean; quote?: Hex; decimals?: number; liquidity?: bigint; supply?: bigint; staleFeed?: boolean; wrongPool?: boolean; changedBlock?: boolean } = {}) {
  const tokenAddress = address(options.tokenIs0 ? "1" : "9");
  const quoteAddress = options.quote ?? "0x0000000000000000000000000000000000000000";
  const key = { currency0: options.tokenIs0 ? tokenAddress : quoteAddress, currency1: options.tokenIs0 ? quoteAddress : tokenAddress,
    fee: 3000, tickSpacing: 60, hooks: address("4") };
  const poolId = keccak256(encodeAbiParameters([{ type: "tuple", components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
  ] }], [key]));
  const token = { tokenAddress, poolId, poolManager: INFRA.poolManager.address, hookAddress: key.hooks,
    transactionHash: hash("a"), blockHash: hash("b"), blockNumber: "100" };
  const checkpoint = { number: 200n, hash: hash("c"), timestamp: BigInt(now / 1000) - 1n };
  const event = { address: token.poolManager, removed: false, transactionHash: token.transactionHash, blockHash: token.blockHash, blockNumber: 100n,
    topics: encodeEventTopics({ abi: INITIALIZE, eventName: "Initialize", args: { id: options.wrongPool ? hash("f") : poolId,
      currency0: key.currency0, currency1: key.currency1 } }),
    data: encodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }], [3000, 60, key.hooks, 2n ** 97n, 0]),
  };
  let blockReads = 0;
  const rpc = {
    getChainId: vi.fn(async () => 4663),
    getBlock: vi.fn(async () => ({ ...checkpoint, hash: options.changedBlock && ++blockReads > 2 ? hash("e") : checkpoint.hash })),
    getCode: vi.fn(async ({ address: target }) => target.toLowerCase() === INFRA.poolManager.address.toLowerCase() ? "0x1234" : "0x5678"),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", transactionHash: token.transactionHash,
      blockHash: token.blockHash, blockNumber: 100n, logs: [event] })),
    readContract: vi.fn(async ({ address: target, functionName }) => {
      if (functionName === "getSlot0") return [2n ** 97n, 0, 0, 3000];
      if (functionName === "getLiquidity") return options.liquidity ?? 1000n;
      if (functionName === "totalSupply") return options.supply ?? 1_000_000_000n * 10n ** BigInt(options.decimals ?? 18);
      if (functionName === "latestRoundData") return [1n, 2000n * 10n ** 8n, 0n, BigInt(now / 1000) - (options.staleFeed ? 90000n : 30n), 1n];
      if (functionName === "decimals") return target.toLowerCase() === tokenAddress.toLowerCase() ? options.decimals ?? 18 : 8;
      throw new Error("Unexpected call");
    }),
  };
  return { token, rpc, checkpoint };
}
const read = (value: ReturnType<typeof fixture>) => readRobinhoodOnchainMarkets([value.token], { client: value.rpc as unknown as PublicClient, now: () => now });

describe("canonical Robinhood onchain market fallback", () => {
  it("values an ETH quote from exact receipt, official pool state and current total supply at one block", async () => {
    const value = fixture();
    const market = (await read(value)).get(value.token.tokenAddress)!;
    expect(market).toMatchObject({ source: "uniswap-v4", valuationKind: "fdv", priceUsd: 500, fdvUsd: 500_000_000_000,
      marketCapUsd: null, liquidityUsd: null, volume24hUsd: null, change24hPercent: null, blockNumber: "200", blockHash: hash("c"),
      observedAt: new Date(now - 1000).toISOString(), sourceUrl: "https://robinhoodchain.blockscout.com/block/200" });
    expect(value.rpc.readContract.mock.calls.every(([call]) => call.blockNumber === 200n)).toBe(true);
  });

  it("uses actual token decimals and supply without assuming one billion circulating tokens", async () => {
    const value = fixture({ decimals: 6, supply: 8_000_000n });
    const market = (await read(value)).get(value.token.tokenAddress)!;
    expect(market.priceUsd).toBe(0.0000000005);
    expect(market.fdvUsd).toBe(0.000000004);
    expect(market.marketCapUsd).toBeNull();
  });

  it("supports either token ordering and a non-native ERC20 quote via the existing quote price authority", async () => {
    const value = fixture({ tokenIs0: true, quote: address("8"), decimals: 6 });
    const quotePrice = vi.fn().mockResolvedValue({ chainId: 4663, quoteAsset: address("8"), decimals: 6,
      checkpoint: { number: "200", hash: hash("c"), timestamp: value.checkpoint.timestamp.toString() },
      price: { usd: { numerator: "3", denominator: "2" }, validUntil: String(now / 1000 + 30),
        observedAt: String(now / 1000 - 1), heartbeatSeconds: 45 } });
    const market = (await readRobinhoodOnchainMarkets([value.token], { client: value.rpc as unknown as PublicClient, now: () => now, quotePrice })).get(value.token.tokenAddress)!;
    expect(quotePrice).toHaveBeenCalledWith({ quoteAsset: address("8") });
    expect(market).toMatchObject({ priceUsd: 6, fdvUsd: 6_000_000_000, marketCapUsd: null });
  });

  it.each([{ liquidity: 0n }, { supply: 0n }, { decimals: 37 }, { staleFeed: true }, { wrongPool: true }, { changedBlock: true }])(
    "omits unverifiable or inactive observations: %o", async options => {
      expect(await read(fixture(options))).toEqual(new Map());
    },
  );

  it("rejects another chain, stale head, or changed official runtime", async () => {
    const wrongChain = fixture(); wrongChain.rpc.getChainId.mockResolvedValue(1);
    await expect(read(wrongChain)).rejects.toThrow("Market chain mismatch");
    const stale = fixture(); stale.rpc.getBlock.mockResolvedValue({ ...stale.checkpoint, timestamp: BigInt(now / 1000) - 61n });
    await expect(read(stale)).rejects.toThrow("checkpoint unavailable");
    const code = fixture(); code.rpc.getCode.mockResolvedValue("0x9999" as "0x1234");
    await expect(read(code)).rejects.toThrow("infrastructure mismatch");
  });

  it("retains other verified pools if one receipt is unavailable", async () => {
    const value = fixture();
    const wrong = { ...value.token, tokenAddress: address("2") };
    expect((await readRobinhoodOnchainMarkets([wrong, value.token], { client: value.rpc as unknown as PublicClient, now: () => now })).size).toBe(1);
  });
});

describe("valuation display selection", () => {
  const market = (value: Partial<RobinhoodCoinMarket>) => value as RobinhoodCoinMarket;
  it("uses one Market Cap label and preserves the basis of a total-supply fallback", () => {
    expect(coinValuation(market({ marketCapUsd: 12, fdvUsd: 30 }))).toEqual({ label: "Market Cap", value: 12 });
    expect(coinValuation(market({ marketCapUsd: null, fdvUsd: 30 }))).toEqual({ label: "Market Cap", value: 30, title: "Based on total token supply" });
    expect(coinValuation(market({ marketCapUsd: NaN, fdvUsd: 0 }))).toEqual({ label: "Market Cap", value: 0, title: "Based on total token supply" });
    expect(coinValuation(market({ marketCapUsd: Infinity, fdvUsd: -1 }))).toEqual({ label: "Market Cap", value: null });
    expect(coinValuation(null)).toEqual({ label: "Market Cap", value: null });
  });
});
