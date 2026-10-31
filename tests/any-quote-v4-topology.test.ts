import { createRequire } from "node:module";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { computeRealV4Routes } from "../lib/module-engine/any-quote/v4-topology.server";
const require = createRequire(import.meta.url);
const { Ether, Token } = require("@uniswap/sdk-core") as typeof import("@uniswap/sdk-core");
const { Pool } = require("@uniswap/v4-sdk") as typeof import("@uniswap/v4-sdk");
const { computeAllV4Routes } = require("@uniswap/smart-order-router/build/main/routers/alpha-router/functions/compute-all-routes.js") as typeof import("@uniswap/smart-order-router/build/main/routers/alpha-router/functions/compute-all-routes.js");
const { HooksOptions } = require("@uniswap/smart-order-router/build/main/util/hooksOptions.js") as typeof import("@uniswap/smart-order-router/build/main/util/hooksOptions.js");
const { log } = require("@uniswap/smart-order-router/build/main/util/log.js");
const logSpy = vi.spyOn(log, "info").mockImplementation(() => undefined);
afterAll(() => logSpy.mockRestore());

describe("bounded V4 topology without production SOR logging dependencies", () => {
  it("matches the pinned SDK on every four-currency graph for one and two hops", () => {
    const native = Ether.onChain(1);
    const currencies = [native, native.wrapped, new Token(1, "0x1000000000000000000000000000000000000001", 18), new Token(1, "0x2000000000000000000000000000000000000002", 18)];
    const all = currencies.flatMap((left, i) => currencies.slice(i + 1).map(right => new Pool(left, right, 3000, 60, "0x0000000000000000000000000000000000000000", (1n << 96n).toString(), "1000000", 0)));
    let comparisons = 0;
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const pools = all.filter((_, index) => mask & 1 << index);
      for (const hops of [1, 2] as const) {
        const old = computeAllV4Routes(currencies[0], currencies[3], pools, hops, HooksOptions.HOOKS_INCLUSIVE);
        const next = computeRealV4Routes(currencies[0], currencies[3], pools, hops);
        expect(next.map(route => route.pools.map(pool => pool.poolId))).toEqual(old.map(route => route.pools.map(pool => pool.poolId)));
        expect(next.every(route => route.pools.length <= hops && route.pools.every(pool => pool.tickSpacing > 0))).toBe(true);
        comparisons++;
      }
    }
    expect(comparisons).toBe(128);
  });
});
