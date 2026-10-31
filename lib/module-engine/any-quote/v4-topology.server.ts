import "server-only";
import type { Currency } from "@uniswap/sdk-core";
import type { Pool as V4Pool } from "@uniswap/v4-sdk";

// V4-only adaptation of Uniswap smart-order-router 4.31.10's pure
// computeAllRoutes traversal. Original license: SOR-LICENSE.
// Mixed-protocol routes, logging and synthetic ETH/WETH pools are excluded.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Route } = require("@uniswap/v4-sdk") as typeof import("@uniswap/v4-sdk");
const identity = (currency: Currency) => currency.isToken ? currency.address.toLowerCase() : "0x0000000000000000000000000000000000000000";

export function computeRealV4Routes(currencyIn: Currency, currencyOut: Currency, pools: V4Pool[], maxHops: 1 | 2): { pools: V4Pool[] }[] {
  const routes: { pools: V4Pool[] }[] = [];
  const used = pools.map(() => false);
  const path: V4Pool[] = [];
  const visited = new Set([identity(currencyIn)]);
  function walk(previous: Currency) {
    if (path.length && path.at(-1)!.involvesToken(currencyOut)) {
      routes.push(new Route([...path], currencyIn, currencyOut));
      return;
    }
    if (path.length >= maxHops) return;
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      if (used[i] || !pool.involvesToken(previous)) continue;
      const next = pool.token0.equals(previous) ? pool.token1 : pool.token0;
      const id = identity(next);
      if (visited.has(id)) continue;
      visited.add(id); used[i] = true; path.push(pool);
      walk(next);
      path.pop(); used[i] = false; visited.delete(id);
    }
  }
  walk(currencyIn);
  return routes;
}
