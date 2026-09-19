import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { Actions, V4Planner, URVersion } from "@uniswap/v4-sdk";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { FOUNDATION_CHAIN_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_INT128_MAX, FOUNDATION_LP_FEE, FOUNDATION_TICK_SPACING } from "./constants";
import { FOUNDATION_WETH } from "./native-funding";
import { requireAnyQuoteNativeUnlockRouteV1 } from "@/lib/module-engine/any-quote/route";
import type { AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";

export interface FoundationPoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface FoundationPool { token: Address; quote: Address; hook: Address; poolId: Hex }
const executeAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);

export function foundationPoolKey(pool: Omit<FoundationPool, "poolId">): FoundationPoolKey {
  const token = getAddress(pool.token), quote = getAddress(pool.quote), hook = getAddress(pool.hook);
  if (BigInt(token) === 0n || BigInt(quote) === 0n || BigInt(hook) === 0n || token === quote || token === hook || quote === hook) throw new Error("Invalid launch pool identity.");
  return { currency0: BigInt(token) < BigInt(quote) ? token : quote,
    currency1: BigInt(token) < BigInt(quote) ? quote : token, fee: FOUNDATION_LP_FEE,
    tickSpacing: FOUNDATION_TICK_SPACING, hooks: hook };
}

export function foundationPoolId(key: FoundationPoolKey): Hex {
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error("Pool currencies must be ordered.");
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

/** Single-pool official UR 2.1.1 route. Existing router donations cannot fund a user's swap. */
export function buildFoundationExactInput(input: { pool: FoundationPool; owner: Address; recipient: Address;
  side: "buy" | "sell"; amountIn: bigint; minimumOutput: bigint; deadline: bigint; now?: bigint }) {
  const now = input.now ?? BigInt(Math.floor(Date.now() / 1_000));
  if ((input.side !== "buy" && input.side !== "sell") || input.amountIn <= 0n || input.amountIn > FOUNDATION_INT128_MAX
    || input.minimumOutput <= 0n || input.minimumOutput > FOUNDATION_INT128_MAX
    || input.deadline <= now || input.deadline > now + 300n) throw new Error("Invalid trade amounts or deadline.");
  const owner = getAddress(input.owner), recipient = getAddress(input.recipient);
  const key = foundationPoolKey(input.pool);
  if (foundationPoolId(key).toLowerCase() !== input.pool.poolId.toLowerCase()) throw new Error("Pool identity does not match its key.");
  if (BigInt(owner) <= 2n || BigInt(recipient) <= 2n) throw new Error("A wallet address is required.");
  const currencyIn = input.side === "buy" ? getAddress(input.pool.quote) : getAddress(input.pool.token);
  const currencyOut = input.side === "buy" ? getAddress(input.pool.token) : getAddress(input.pool.quote);
  const v4 = new V4Planner();
  v4.addAction(Actions.SWAP_EXACT_IN_SINGLE, [[
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], currencyIn === key.currency0,
    input.amountIn.toString(), input.minimumOutput.toString(), "0", "0x",
  ]], URVersion.V2_1_1);
  v4.addAction(Actions.SETTLE, [currencyIn, input.amountIn.toString(), true], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE, [currencyOut, recipient, "0"], URVersion.V2_1_1);
  const router = new RoutePlanner();
  router.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  const commands = router.commands as Hex, inputs = router.inputs as Hex[];
  return { chainId: FOUNDATION_CHAIN_ID, routerVersion: "2.1.1" as const, poolId: input.pool.poolId, currencyIn, currencyOut,
    commands, inputs, deadline: input.deadline, minimumOutput: input.minimumOutput,
    transaction: { from: owner, to: FOUNDATION_INFRASTRUCTURE.universalRouter.address,
      data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }), value: 0n },
    approval: { owner, token: currencyIn, spender: FOUNDATION_INFRASTRUCTURE.permit2.address,
      permit2Spender: FOUNDATION_INFRASTRUCTURE.universalRouter.address, amount: input.amountIn, expiration: input.deadline },
  };
}

/** Reuse qualified native v4 hops, with the actual Foundation pool's own key. */
export function foundationNativeTradePath(pool: FoundationPool, side: "buy" | "sell", route: AnyQuoteExternalRouteV1) {
  const key = foundationPoolKey(pool), buy = side === "buy";
  if (foundationPoolId(key).toLowerCase() !== pool.poolId.toLowerCase()) throw new Error("Pool identity changed.");
  const hops = requireAnyQuoteNativeUnlockRouteV1(route, side);
  if (getAddress(buy ? hops.at(-1)!.tokenOut : hops[0].tokenIn) !== getAddress(pool.quote)) throw new Error("The ETH route uses another quote token.");
  if (hops.some(hop => getAddress(hop.tokenIn) === getAddress(pool.token) || getAddress(hop.tokenOut) === getAddress(pool.token)
    || hop.poolId.toLowerCase() === pool.poolId.toLowerCase())) throw new Error("The ETH route repeats the launch pool.");
  const path = hops.map(hop => ({ intermediateCurrency: hop.tokenOut, fee: hop.key.fee,
    tickSpacing: hop.key.tickSpacing, hooks: hop.key.hooks, hookData: hop.hookData }));
  const launchHop = { intermediateCurrency: buy ? pool.token : pool.quote, fee: key.fee,
    tickSpacing: key.tickSpacing, hooks: key.hooks, hookData: "0x" as Hex };
  if (buy) path.push(launchHop); else path.unshift(launchHop);
  return path;
}

/** Official UR commands: native v4 routing, or exact wrapping/unwrapping for the WETH quote. */
export function buildFoundationNativeExactInput(input: Parameters<typeof buildFoundationExactInput>[0] & { externalRoute?: AnyQuoteExternalRouteV1 }) {
  const base = buildFoundationExactInput(input), buy = input.side === "buy";
  const wrapped = getAddress(input.pool.quote) === FOUNDATION_WETH;
  const path = wrapped ? null : input.externalRoute ? foundationNativeTradePath(input.pool, input.side, input.externalRoute) : null;
  const now = input.now ?? BigInt(Math.floor(Date.now() / 1_000));
  if (!wrapped && (!path || BigInt(input.externalRoute!.validUntil) <= now)) throw new Error("A current ETH route is required.");
  const router = new RoutePlanner(), v4 = new V4Planner();
  const routerRecipient = "0x0000000000000000000000000000000000000002";
  if (wrapped && buy) router.addCommand(CommandType.WRAP_ETH, [routerRecipient, input.amountIn.toString()], false, UniversalRouterVersion.V2_1_1);
  const currencyIn = buy ? zeroAddress : getAddress(input.pool.token);
  const currencyOut = buy ? getAddress(input.pool.token) : zeroAddress;
  const settleCurrency = wrapped ? base.currencyIn : currencyIn, takeCurrency = wrapped ? base.currencyOut : currencyOut;
  if (path) v4.addAction(Actions.SWAP_EXACT_IN, [[currencyIn,
    path.map(hop => [hop.intermediateCurrency, hop.fee, hop.tickSpacing, hop.hooks, hop.hookData]), [],
    input.amountIn.toString(), input.minimumOutput.toString()]], URVersion.V2_1_1);
  else {
    const key = foundationPoolKey(input.pool);
    v4.addAction(Actions.SWAP_EXACT_IN_SINGLE, [[[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      base.currencyIn === key.currency0, input.amountIn.toString(), input.minimumOutput.toString(), "0", "0x"]], URVersion.V2_1_1);
  }
  // Explicit input settlement prevents a partial fill from leaving spendable router funds.
  v4.addAction(Actions.SETTLE, [settleCurrency, input.amountIn.toString(), !buy], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE, [takeCurrency, wrapped && !buy ? routerRecipient : getAddress(input.recipient), "0"], URVersion.V2_1_1);
  router.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  if (wrapped && !buy) router.addCommand(CommandType.UNWRAP_WETH, [getAddress(input.recipient), input.minimumOutput.toString()], false, UniversalRouterVersion.V2_1_1);
  const commands = router.commands as Hex, inputs = router.inputs as Hex[];
  return { ...base, currencyIn, currencyOut, commands, inputs,
    transaction: { ...base.transaction, data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }),
      value: buy ? input.amountIn : 0n }, approval: buy ? null : base.approval };
}
