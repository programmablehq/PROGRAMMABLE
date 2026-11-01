import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext, type LaunchProductionContext } from "../lib/custom-ai/launch-production";
import { createLaunchDependencyReader } from "../lib/custom-ai/dependency-observations.server";
import type { TradeRpcV1 } from "../lib/server/custom-launch/routed-trade-rpc-v1";
const chains = [1, 4663, 8453, 999] as const;
const NOW = 1_800_000_000_000, CODE = "0x60006000f3" as Hex, OTHER_CODE = "0x60016000f3" as Hex;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const round = (answer: bigint, updated = BigInt(NOW / 1000 - 5), roundId = 31n, answeredInRound = roundId, started = updated) =>
  encodeAbiParameters([{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }], [roundId, answer, started, updated, answeredInRound]);
function fixture(chain: typeof chains[number]) {
  const production = projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains], chain, protection);
  production.poolManager.runtimeCodeHash = keccak256(CODE);
  production.protectionBindings!.swapRouter.runtimeCodeHash = keccak256(CODE);
  production.protectionBindings!.nativeUsdFeed.runtimeCodeHash = keccak256(CODE);
  const { id: ignored, ...body } = production; void ignored;
  return createLaunchProductionContext(body);
}
function providers(production: LaunchProductionContext, override?: (provider: number, method: string, params: readonly unknown[], normal: unknown) => unknown) {
  const calls: { provider: number; method: string; params: readonly unknown[] }[] = [];
  const rpcs = [0, 1].map(provider => (async (method, params) => {
    calls.push({ provider, method, params: structuredClone(params) });
    let normal: unknown;
    if (method === "eth_chainId") normal = toHex(production.chainId);
    else if (method === "eth_getBlockByNumber") normal = { number: params[0] === "latest" ? "0x100" : params[0], hash: HASH, timestamp: toHex(NOW / 1000 - 2) };
    else if (method === "eth_getCode") normal = CODE;
    else if (method === "eth_call") {
      const input = params[0] as { to: string; data: string };
      normal = input.data === "0x313ce567" ? encodeAbiParameters([{ type: "uint8" }], [7])
        : input.to === production.protectionBindings!.sequencerUptimeFeed ? round(0n, undefined, 31n, 31n, BigInt(NOW / 1000 - 4000)) : round(2200_0000000n);
    } else throw Error("Unexpected provider request");
    return override ? override(provider, method, params, normal) : normal;
  }) satisfies TradeRpcV1) as [TradeRpcV1, TradeRpcV1];
  return { rpcs, calls };
}
const isOracle = (method: string, params: readonly unknown[], selector: string) => method === "eth_call" && (params[0] as { data?: string }).data === selector;

describe("actual bounded dependency observations (synthetic provider fixtures, no live RPC)", () => {
  it.each(chains)("binds chain %s code, actual decimals and fresh oracle round to one block", async chain => {
    const production = fixture(chain), { rpcs, calls } = providers(production);
    const result = await createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production);
    expect(result).toMatchObject({ chainId: chain, productionId: production.id, authority: "two-provider-observation", launchReady: false,
      block: { hash: HASH }, nativeUsdFeed: { decimals: 7, answer: "22000000000", roundId: "31" } });
    expect(result.poolManager.runtimeCodeHash).toBe(keccak256(result.poolManager.runtimeCode));
    expect(result.sequencer?.graceSeconds ?? null).toBe(chain === 8453 ? 3600 : null);
    expect(result.rpcReads).toEqual(chain === 8453 ? [11, 11] : [9, 9]);
    expect(result.expiresAt).toBe(NOW + 10_000);
    for (const call of calls.filter(call => ["eth_getCode", "eth_call"].includes(call.method)))
      expect(call.params[1]).toEqual({ blockHash: HASH, requireCanonical: true });
    expect(calls.filter(call => call.method === "eth_getBlockByNumber" && call.params[0] !== "latest").every(call =>
      call.params[0] === (chain === 4663 ? "0xf0" : "0xfe"))).toBe(true);
  });
  it("shares simultaneous captures, returns separate values, caches for ten seconds and refreshes explicitly", async () => {
    const production = fixture(1), { rpcs, calls } = providers(production); let now = NOW;
    const read = createLaunchDependencyReader({ rpcs: () => rpcs, now: () => now });
    const values = await Promise.all(Array.from({ length: 25 }, () => read(production)));
    expect(calls).toHaveLength(18); values[0].nativeUsdFeed.decimals = 18;
    expect((await read(production)).nativeUsdFeed.decimals).toBe(7); expect(calls).toHaveLength(18);
    await read(production, undefined, { fresh: true }); expect(calls).toHaveLength(36);
    now += 10_001; await read(production); expect(calls).toHaveLength(54);
  });
  it.each(["code", "decimals", "round", "chain"])("refuses disagreement in %s without choosing one provider", async kind => {
    const production = fixture(1), { rpcs } = providers(production, (i, method, params, normal) => {
      if (i !== 1) return normal;
      if (kind === "code" && method === "eth_getCode") return OTHER_CODE;
      if (kind === "decimals" && isOracle(method, params, "0x313ce567")) return encodeAbiParameters([{ type: "uint8" }], [8]);
      if (kind === "round" && isOracle(method, params, "0xfeaf968c")) return round(1n);
      if (kind === "chain" && method === "eth_chainId") return "0x2105";
      return normal;
    });
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toMatchObject({ code: "dependency-observation" });
  });
  it("stops before oracle calls when the agreed runtime hash has changed", async () => {
    const production = fixture(1), { rpcs, calls } = providers(production, (_, method, params, normal) =>
      method === "eth_getCode" && params[0] === production.protectionBindings!.nativeUsdFeed.address ? OTHER_CODE : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
    expect(calls.some(call => call.method === "eth_call")).toBe(false);
  });
  it.each([
    round(0n), round(-1n), round(1n, 0n), round(1n, BigInt(NOW / 1000 + 1)),
    round(1n, BigInt(NOW / 1000 - 3603)), round(1n, undefined, 0n), round(1n, undefined, 31n, 30n), "0x00",
  ])("refuses an invalid oracle round %s", async bad => {
    const production = fixture(1), { rpcs } = providers(production, (_, method, params, normal) => isOracle(method, params, "0xfeaf968c") ? bad : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
  });
  it.each([19, 255])("rejects unsupported observed precision %i without guessing eight", async decimals => {
    const production = fixture(1), { rpcs } = providers(production, (_, method, params, normal) =>
      isOracle(method, params, "0x313ce567") ? encodeAbiParameters([{ type: "uint8" }], [decimals]) : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
  });
  it.each([0, 3599, 3600])("refuses a Base sequencer within %i seconds of its reported restart", async elapsed => {
    const production = fixture(8453), { rpcs } = providers(production, (_, method, params, normal) =>
      method === "eth_call" && (params[0] as { to: string }).to === production.protectionBindings!.sequencerUptimeFeed
        ? round(0n, undefined, 31n, 31n, BigInt(NOW / 1000 - 2 - elapsed)) : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
  });
  it("refuses a down Base sequencer", async () => {
    const production = fixture(8453), { rpcs } = providers(production, (_, method, params, normal) =>
      method === "eth_call" && (params[0] as { to: string }).to === production.protectionBindings!.sequencerUptimeFeed ? round(1n) : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
  });
  it("does not return success after the observed block is reorganized", async () => {
    const production = fixture(1), counts = [0, 0];
    const { rpcs } = providers(production, (i, method, params, normal) => method === "eth_getBlockByNumber" && params[0] !== "latest" && ++counts[i] > 1
      ? { ...(normal as object), hash: `0x${"cd".repeat(32)}` } : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
  });
  it("does not serve stale success after a failed refresh, and suppresses repeated outage reads", async () => {
    const production = fixture(1); let broken = false, now = NOW;
    const { rpcs, calls } = providers(production, (_, method, params, normal) => { if (broken) throw Error("provider unavailable"); return normal; });
    const read = createLaunchDependencyReader({ rpcs: () => rpcs, now: () => now });
    await read(production); now += 10_001; broken = true;
    await expect(read(production)).rejects.toThrow(); const count = calls.length;
    await expect(read(production, undefined, { fresh: true })).rejects.toThrow(); expect(calls).toHaveLength(count);
    now += 5001; await expect(read(production)).rejects.toThrow(); expect(calls.length).toBe(count + 2);
  });
  it("keeps a shared capture alive when one caller stops", async () => {
    const production = fixture(1), { rpcs, calls } = providers(production);
    const read = createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW }), stop = new AbortController();
    const first = read(production, stop.signal), second = read(production);
    stop.abort(new Error("caller stopped"));
    await expect(first).rejects.toThrow("caller stopped"); expect((await second).nativeUsdFeed.decimals).toBe(7); expect(calls).toHaveLength(18);
  });
  it("rejects unsupported or tampered source contexts before requesting any provider", async () => {
    const production = fixture(1), supplied = vi.fn(); const read = createLaunchDependencyReader({ rpcs: supplied, now: () => NOW });
    production.protectionBindings!.nativeUsdFeedMaxAgeSeconds++;
    await expect(read(production)).rejects.toThrow(); expect(supplied).not.toHaveBeenCalled();
    const { id: ignored, protectionBindings: omitted, ...body } = fixture(1); void ignored; void omitted;
    await expect(read(createLaunchProductionContext({ ...body, version: 2 }))).rejects.toThrow(); expect(supplied).not.toHaveBeenCalled();
  });
  it("bounds a stalled observation and starts no follow-up reads after its deadline", async () => {
    vi.useFakeTimers();
    try {
      const first = vi.fn(() => new Promise<unknown>(() => undefined)), second = vi.fn(() => new Promise<unknown>(() => undefined));
      const read = createLaunchDependencyReader({ rpcs: () => [first, second], now: () => NOW });
      const result = expect(read(fixture(1))).rejects.toMatchObject({ code: "dependency-observation" });
      await vi.advanceTimersByTimeAsync(30_001); await result;
      expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("does not let an older in-flight profile replace the current cached observation", async () => {
    const old = fixture(1), { id: ignored, ...body } = old; void ignored;
    const current = createLaunchProductionContext({ ...body, tradeFee: { ...old.tradeFee, ratePpm: 4000 } });
    let release!: () => void, count = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = providers(old), next = providers(current);
    const read = createLaunchDependencyReader({ now: () => NOW, rpcs: () => ++count === 1
      ? first.rpcs.map(rpc => (async (method, params) => { await gate; return rpc(method, params); }) satisfies TradeRpcV1) as [TradeRpcV1, TradeRpcV1]
      : next.rpcs });
    const older = read(old); const latest = await read(current); release();
    expect((await older).productionId).toBe(old.id); expect(latest.productionId).toBe(current.id);
    expect((await read(current)).id).toBe(latest.id); expect(count).toBe(2);
  });
  it.each([-6, 91])("refuses a block whose observed age is %i seconds", async age => {
    const production = fixture(1), { rpcs, calls } = providers(production, (_, method, params, normal) =>
      method === "eth_getBlockByNumber" ? { ...(normal as object), timestamp: toHex(NOW / 1000 - age) } : normal);
    await expect(createLaunchDependencyReader({ rpcs: () => rpcs, now: () => NOW })(production)).rejects.toThrow();
    expect(calls.some(call => call.method === "eth_getCode")).toBe(false);
  });
});
