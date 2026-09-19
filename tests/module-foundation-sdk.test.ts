import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { Actions } from "@uniswap/v4-sdk";
import { FOUNDATION_INFRASTRUCTURE, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import { foundationParseAmount, planFoundationPrice } from "@/lib/module-foundation/price";
import { buildFoundationExactInput, buildFoundationNativeExactInput, foundationNativeTradePath, foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";
import { FOUNDATION_WETH } from "@/lib/module-foundation/native-funding";
import type { AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";

const low = getAddress("0x1000000000000000000000000000000000000000");
const high = getAddress("0xf000000000000000000000000000000000000000");
const hook = getAddress("0x20000000000000000000000000000000000020cc");
const user = getAddress("0x3000000000000000000000000000000000000000");
const recipient = getAddress("0x4000000000000000000000000000000000000000");

describe("foundation starting position", () => {
  for (const decimals of [6, 8, 18]) for (const tokenLow of [true, false]) {
    it(`funds each position from its real asset, ${decimals} decimals, tokenLow=${tokenLow}`, () => {
      const valuationQuoteRaw = 5_000n * 10n ** BigInt(decimals), additionalQuoteRaw = 25n * 10n ** BigInt(decimals);
      const price = planFoundationPrice({ token: tokenLow ? low : high, quote: tokenLow ? high : low, valuationQuoteRaw, additionalQuoteRaw });
      expect(price.initialTick % 60 === 0).toBe(true);
      expect(price.base.liquidity).toBeGreaterThan(0n);
      expect(price.base.principal + price.base.dust).toBe(FOUNDATION_SUPPLY);
      expect(price.creator!.principal + price.creator!.dust).toBe(additionalQuoteRaw);
      expect(price.creator!.liquidity).toBeGreaterThan(0n);
      expect(tokenLow ? price.base.tickLower : price.base.tickUpper).toBe(price.initialTick);
      expect(tokenLow ? price.creator!.tickUpper : price.creator!.tickLower).toBe(price.initialTick);
      const { numerator: n, denominator: d } = price.actualValuationQuote;
      // Nearest 60-spaced tick differs by less than 0.31%, independently checked as a ratio.
      expect(n * 10_000n / (d * valuationQuoteRaw)).toBeGreaterThanOrEqual(9_969n);
      expect(n * 10_000n / (d * valuationQuoteRaw)).toBeLessThanOrEqual(10_031n);
    });
  }
  it("can start with zero quote capital and does not invent a second position", () => {
    const result = planFoundationPrice({ token: low, quote: high, valuationQuoteRaw: 5_000n * 10n ** 6n });
    expect(result.creator).toBeNull();
    expect(result.base.principal).toBeLessThanOrEqual(FOUNDATION_SUPPLY);
  });
  it("requires exact units and a representable positive price", () => {
    expect(foundationParseAmount("1.000001", 6)).toBe(1_000_001n);
    for (const value of ["1.0000001", "1e6", "-1", " 1", "1.", "NaN"]) expect(() => foundationParseAmount(value, 6)).toThrow();
    expect(() => foundationParseAmount("0", 6, false)).toThrow();
    expect(() => planFoundationPrice({ token: low, quote: low, valuationQuoteRaw: 1n })).toThrow();
  });
});

describe("official foundation route", () => {
  for (const side of ["buy", "sell"] as const) {
    it(`uses official native wrapping commands for a WETH-quoted ${side}`, () => {
      const pool = { token: low, quote: FOUNDATION_WETH, hook, poolId: foundationPoolId(foundationPoolKey({ token: low, quote: FOUNDATION_WETH, hook })) };
      const route = buildFoundationNativeExactInput({ pool, owner: user, recipient, side, amountIn: 10_000n, minimumOutput: 250n, deadline: 1_100n, now: 1_000n });
      expect(route.commands).toBe(side === "buy" ? "0x0b10" : "0x100c");
      expect(route.transaction.value).toBe(side === "buy" ? 10_000n : 0n);
      expect(side === "buy" ? route.currencyIn : route.currencyOut).toBe(zeroAddress);
      expect(side === "buy" ? route.approval : route.approval?.token).toBe(side === "buy" ? null : low);
    });

    it(`joins an ETH route to the actual Foundation pool for ${side}`, () => {
      const pool = { token: low, quote: high, hook, poolId: foundationPoolId(foundationPoolKey({ token: low, quote: high, hook })) };
      const key = { currency0: zeroAddress, currency1: high, fee: 3000, tickSpacing: 60, hooks: zeroAddress };
      const route: AnyQuoteExternalRouteV1 = { provider: "uniswap-trading-api", chainId: 4663,
        tokenIn: side === "buy" ? FOUNDATION_WETH : high, tokenOut: side === "buy" ? high : FOUNDATION_WETH,
        amountIn: "10000", amountOut: "1000", validUntil: "1100", evidenceHash: `0x${"00".repeat(32)}` as Hex,
        checkpoint: { number: "1", hash: `0x${"00".repeat(32)}` as Hex, timestamp: "1000" },
        hops: [{ protocol: "V4", tokenIn: side === "buy" ? zeroAddress : high, tokenOut: side === "buy" ? high : zeroAddress,
          key, poolId: foundationPoolId(key), hookData: "0x" }] };
      const path = foundationNativeTradePath(pool, side, route);
      const launchHop = side === "buy" ? path.at(-1)! : path[0];
      expect(launchHop.tickSpacing).toBe(60);
      expect(launchHop.fee).toBe(0);
      expect(launchHop.hooks).toBe(hook);
      const built = buildFoundationNativeExactInput({ pool, owner: user, recipient, side, amountIn: 10_000n,
        minimumOutput: 250n, deadline: 1_300n, now: 1_000n, externalRoute: route });
      expect(built.commands).toBe("0x10");
      expect(() => buildFoundationNativeExactInput({ pool, owner: user, recipient, side, amountIn: 10_000n,
        minimumOutput: 250n, deadline: 1_300n, now: 1_100n, externalRoute: route })).toThrow("current ETH route");
    });
  }
  for (const side of ["buy", "sell"] as const) for (const tokenLow of [true, false]) {
    it(`binds ${side} input and recipient with empty hook data, tokenLow=${tokenLow}`, () => {
      const identity = { token: tokenLow ? low : high, quote: tokenLow ? high : low, hook };
      const key = foundationPoolKey(identity), poolId = foundationPoolId(key);
      const route = buildFoundationExactInput({ pool: { ...identity, poolId }, owner: user, recipient, side,
        amountIn: 10_000n, minimumOutput: 250n, deadline: 1_100n, now: 1_000n });
      expect(route.transaction.to).toBe(FOUNDATION_INFRASTRUCTURE.universalRouter.address);
      expect(route.transaction.value).toBe(0n);
      const decoded = decodeFunctionData({ abi: parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]), data: route.transaction.data });
      expect(decoded.args![0]).toBe("0x10"); // V4_SWAP; ALLOW_REVERT flag clear.
      expect(decoded.args![2]).toBe(1_100n);
      const [actions, parameters] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), route.inputs[0]);
      expect(actions).toBe(`0x${[Actions.SWAP_EXACT_IN_SINGLE, Actions.SETTLE, Actions.TAKE].map(x => x.toString(16).padStart(2, "0")).join("")}`);
      const [swap] = decodeAbiParameters(parseAbiParameters("((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"), parameters[0]);
      expect(swap[2]).toBe(10_000n);
      expect(swap[3]).toBe(250n);
      expect(swap[5]).toBe("0x");
      expect(decodeAbiParameters(parseAbiParameters("address,uint256,bool"), parameters[1])).toEqual([route.currencyIn, 10_000n, true]);
      expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), parameters[2])).toEqual([route.currencyOut, recipient, 0n]);
    });
  }
  it("rejects mismatched pool identity, zero minimum and recipient sentinels", () => {
    const identity = { token: low, quote: high, hook };
    const base = { pool: { ...identity, poolId: foundationPoolId(foundationPoolKey(identity)) }, owner: user,
      recipient, side: "buy" as const, amountIn: 100n, minimumOutput: 1n, deadline: 1_100n, now: 1_000n };
    expect(() => buildFoundationExactInput({ ...base, minimumOutput: 0n })).toThrow();
    expect(() => buildFoundationExactInput({ ...base, recipient: "0x0000000000000000000000000000000000000001" as Address })).toThrow();
    expect(() => buildFoundationExactInput({ ...base, pool: { ...base.pool, hook: recipient } })).toThrow();
    expect(() => buildFoundationExactInput({ ...base, deadline: 1_301n })).toThrow();
  });
});
