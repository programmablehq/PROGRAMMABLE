import "server-only";
import { computeAllV4Routes } from "@uniswap/smart-order-router/build/main/routers/alpha-router/functions/compute-all-routes.js";
import { HooksOptions } from "@uniswap/smart-order-router/build/main/util/hooksOptions.js";
import { V4_ETH_WETH_FAKE_POOL } from "@uniswap/smart-order-router/build/main/util/pool.js";
import { type Address } from "viem";
import { ANY_QUOTE_CHAIN_ID, ANY_QUOTE_NATIVE, AnyQuoteErrorV1, anyQuoteSameAddressV1, type AnyQuoteV4PoolCandidateV1 } from "./types";
import { anyQuotePoolIdV1 } from "./route";
import { ANY_QUOTE_V4_MAX_POOL_CANDIDATES, anyQuoteV4CandidateHopV1 } from "./discovery.server";

// SOR's pinned CommonJS helper uses instanceof Pool. Use the same entry, as well as
// the package override, so Next cannot give this adapter a second ESM Pool class.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("@uniswap/v4-sdk") as typeof import("@uniswap/v4-sdk");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Ether, Token } = require("@uniswap/sdk-core") as typeof import("@uniswap/sdk-core");

export type AnyQuoteV4RoutingPoolV1 = AnyQuoteV4PoolCandidateV1 & {
  sqrtPriceX96: bigint; liquidity: bigint; tick: number;
};

/** Enumerate only the verified graph acquired by the bounded Initialize adapter.
 * SDK pool objects describe topology; quotes always come from the real Quoter.
 * The existing automatic index searches direct pools and one intermediate. */
export function enumerateAnyQuoteV4PathsV1(input: {
  pools: readonly AnyQuoteV4RoutingPoolV1[]; tokenIn: Address; tokenOut: Address; maxHops: 1 | 2;
}) {
  if (input.maxHops !== 1 && input.maxHops !== 2) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
  if (input.pools.length > 2 * ANY_QUOTE_V4_MAX_POOL_CANDIDATES) throw new AnyQuoteErrorV1("V4_DISCOVERY_CANDIDATE_LIMIT");
  const native = Ether.onChain(ANY_QUOTE_CHAIN_ID);
  // SOR 4.31.10's pure enumerator and formatter consult this map even for V4-only
  // routes. This missing-chain entry is internal wrap metadata, not pool data.
  // Never append it to the candidate array. Real PoolKeys must have positive
  // tick spacing, and the output is restricted again to the verified input IDs.
  V4_ETH_WETH_FAKE_POOL[ANY_QUOTE_CHAIN_ID] ??= new Pool(native, native.wrapped, 0, 0, ANY_QUOTE_NATIVE, (1n << 96n).toString(), 0, 0);
  // Decimals do not affect pool identity or topology. Do not use these objects
  // for SDK swap math, price qualification, or amount conversion.
  const currency = (address: Address) => anyQuoteSameAddressV1(address, ANY_QUOTE_NATIVE)
    ? native : new Token(ANY_QUOTE_CHAIN_ID, address, 18);
  const records = new Map<string, AnyQuoteV4RoutingPoolV1>();
  for (const record of input.pools) {
    if (anyQuotePoolIdV1(record.key).toLowerCase() !== record.poolId.toLowerCase()) throw new AnyQuoteErrorV1("V4_DISCOVERY_RESPONSE_INVALID");
    records.set(record.poolId.toLowerCase(), record);
  }
  const pools = [...records.values()].map(record => new Pool(currency(record.key.currency0), currency(record.key.currency1),
    record.key.fee, record.key.tickSpacing, record.key.hooks, record.sqrtPriceX96.toString(), record.liquidity.toString(), record.tick));
  const routes = computeAllV4Routes(currency(input.tokenIn), currency(input.tokenOut), pools, input.maxHops, HooksOptions.HOOKS_INCLUSIVE);
  if (routes.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) throw new AnyQuoteErrorV1("V4_DISCOVERY_CANDIDATE_LIMIT");
  return routes.map(route => {
    let tokenIn = input.tokenIn;
    const visited = new Set([tokenIn.toLowerCase()]);
    const hops = route.pools.map(pool => {
      const record = records.get(pool.poolId.toLowerCase());
      if (!record || pool.tickSpacing <= 0 || pool.chainId !== ANY_QUOTE_CHAIN_ID) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
      const hop = anyQuoteV4CandidateHopV1(record, tokenIn);
      if (visited.has(hop.tokenOut.toLowerCase())) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
      visited.add(hop.tokenOut.toLowerCase()); tokenIn = hop.tokenOut;
      return hop;
    });
    if (hops.length === 0 || hops.length > input.maxHops || !anyQuoteSameAddressV1(tokenIn, input.tokenOut)) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
    return hops;
  });
}
