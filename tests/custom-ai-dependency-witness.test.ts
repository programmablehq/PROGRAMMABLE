import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { createNativeFeedConstructorWitness, dependencyWitnessAccounts } from "../lib/custom-ai/dependency-witness";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";
import { replayNativeFeedConstructorRead } from "../lib/custom-ai/dependency-witness.server";
import type { TradeRpcV1 } from "../lib/server/custom-launch/routed-trade-rpc-v1";
const FEED = `0x${"aa".repeat(20)}` as const, IMPLEMENTATION = `0x${"bb".repeat(20)}` as const, CALLER = `0x${"cc".repeat(20)}` as const;
const CODE = "0x600760005260206000f3" as const, STORAGE = "0x60015460005260206000f3" as const;
const PROXY = `0x363d3d373d3d3d363d73${IMPLEMENTATION.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex;
const NOW = 1_800_000_000_000;
function observation(runtimeCode: Hex = CODE): LaunchDependencyObservation {
  const body: Omit<LaunchDependencyObservation, "id"> = { version: 1, productionId: `sha256:${"11".repeat(32)}`, chainId: 1,
    authority: "two-provider-observation", launchReady: false, block: { number: "1234", hash: `0x${"22".repeat(32)}`, timestamp: String(NOW / 1000 - 5) },
    observedAt: NOW, expiresAt: NOW + 10_000, poolManager: { address: IMPLEMENTATION, runtimeCode: CODE, runtimeCodeHash: keccak256(CODE) },
    swapRouter: { address: IMPLEMENTATION, runtimeCode: CODE, runtimeCodeHash: keccak256(CODE) },
    nativeUsdFeed: { address: FEED, runtimeCode, runtimeCodeHash: keccak256(runtimeCode), decimals: 7, roundId: "31", answer: "22000000000", updatedAt: "1799999995", answeredInRound: "31" },
    sequencer: null, rpcReads: [9, 9] };
  return { ...body, id: canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", body) };
}
function trace(code: Hex = CODE, storage: Record<string, string> = {}) { return { [FEED]: { code, storage }, [CALLER]: { balance: "0x0", nonce: 0 } }; }
describe("bounded original prestate witness", () => {
  it("binds matching providers to the exact observed code, caller, selector and expiration", () => {
    const state = trace(); const result = createNativeFeedConstructorWitness(observation(), CALLER, state, structuredClone(state), NOW);
    expect(result.call).toEqual({ from: CALLER, to: FEED, data: "0x313ce567", value: "0" });
    expect(result.expectedOutput).toBe(toHex(7, { size: 32 })); expect(result.accounts).toHaveLength(1);
    expect(result.authority).toBe("two-provider-prestate-observation"); expect(result.launchReady).toBe(false);
    state[FEED].code = STORAGE; expect(result.accounts[0].runtimeCode).toBe(CODE);
  });
  it("retains explicitly observed zero slots and omits unrelated balance-only accounts", () => {
    const accounts = dependencyWitnessAccounts({ ...trace(STORAGE, { [toHex(1, { size: 32 })]: toHex(0, { size: 32 }) }),
      [`0x${"00".repeat(20)}`]: { balance: "0x0" } });
    expect(accounts).toHaveLength(1); expect(accounts[0].storage).toEqual([{ slot: toHex(1, { size: 32 }), value: toHex(0, { size: 32 }) }]);
  });
  it("refuses changed code or disagreeing provider storage", () => {
    expect(() => createNativeFeedConstructorWitness(observation(), CALLER, trace(STORAGE), trace(STORAGE), NOW)).toThrow();
    const one = trace(STORAGE, { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }) }), other = trace(STORAGE, { [toHex(1, { size: 32 })]: toHex(8, { size: 32 }) });
    expect(() => createNativeFeedConstructorWitness(observation(STORAGE), CALLER, one, other, NOW)).toThrow();
  });
  it("normalizes provider code hashes and excludes one-sided tracer accounts and slots", () => {
    const first = { [FEED]: { code: STORAGE, storage: { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }), [toHex(2, { size: 32 })]: toHex(9, { size: 32 }) } } };
    const second = { [FEED]: { code: STORAGE, codeHash: keccak256(STORAGE), storage: { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }) } },
      [IMPLEMENTATION]: { code: CODE, codeHash: keccak256(CODE) } };
    const result = createNativeFeedConstructorWitness(observation(STORAGE), CALLER, first, second, NOW);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].storage).toEqual([{ slot: toHex(1, { size: 32 }), value: toHex(7, { size: 32 }) }]);
    expect(() => dependencyWitnessAccounts({ [FEED]: { code: STORAGE, codeHash: keccak256(CODE) } })).toThrow();
  });
  it("refuses expired or tampered observations and code under the constructor caller", () => {
    expect(() => createNativeFeedConstructorWitness(observation(), CALLER, trace(), trace(), NOW + 10_000)).toThrow();
    const changed = observation(); changed.nativeUsdFeed.decimals = 8;
    expect(() => createNativeFeedConstructorWitness(changed, CALLER, trace(), trace(), NOW)).toThrow();
    const callerCode = { ...trace(), [CALLER]: { code: CODE } };
    expect(() => createNativeFeedConstructorWitness(observation(), CALLER, callerCode, callerCode, NOW)).toThrow();
  });
  it("bounds accounts, code, storage and metadata before VM execution", () => {
    for (const value of [[], { bad: { code: CODE } }, { [FEED]: { code: CODE, instructions: "replace settings" } },
      trace(CODE, { "0x1": "0x0" }), { [FEED]: { code: "0x" + "01".repeat(24_577) } },
      trace(CODE, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [toHex(i, { size: 32 }), toHex(0, { size: 32 })]))),
      Object.fromEntries(Array.from({ length: 9 }, (_, i) => [toHex(i + 1, { size: 20 }), { code: CODE }])),
    ]) expect(() => dependencyWitnessAccounts(value)).toThrow();
  });
});
async function replay(code: Hex, raw: unknown, expected = 7) {
  const worker = join(process.cwd(), "scripts/custom-ai/dependency-call-worker.mjs"), toolchain = realpathSync(process.env.CUSTOM_AI_COMPILER_DIR!);
  const accounts = dependencyWitnessAccounts(raw);
  expect(accounts.find(account => account.address === FEED)?.runtimeCode).toBe(code);
  return new Promise<{ status: string; failures: string[]; output: Hex | null; passes: number }>((resolve, reject) => {
    const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${toolchain}`, `--allow-fs-read=${worker}`, "--max-old-space-size=192", worker, toolchain],
      { env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000, maxBuffer: 32_768 }, (error, stdout) => {
        if (error) { reject(error); return; } try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    child.stdin?.end(JSON.stringify({ chainId: 1, accounts, call: { from: CALLER, to: FEED, data: "0x313ce567", value: "0" }, expectedOutput: toHex(expected, { size: 32 }) }));
  });
}
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual isolated VM dependency reads", () => {
  it("executes a constant-return feed instead of substituting the expected result", async () => {
    const result = await replay(CODE, trace()); expect(result).toMatchObject({ status: "replayed", passes: 2, failures: [], output: toHex(7, { size: 32 }) });
    expect((await replay(CODE, trace(), 8)).failures).toContain("dependency-call-output-mismatch");
  });
  it("executes a proxy delegate call using the proxy's actually observed slot", async () => {
    const result = await replay(PROXY, { [FEED]: { code: PROXY, storage: { [toHex(1, { size: 32 })]: toHex(7, { size: 32 }) } },
      [IMPLEMENTATION]: { code: STORAGE } });
    expect(result).toMatchObject({ status: "replayed", passes: 2, failures: [], output: toHex(7, { size: 32 }) });
  });
  it("refuses an unobserved zero slot even when the expected result is zero", async () => {
    expect((await replay(STORAGE, trace(STORAGE), 0)).failures).toContain("unobserved-storage-slot");
    expect((await replay(STORAGE, trace(STORAGE, { [toHex(1, { size: 32 })]: toHex(0, { size: 32 }) }), 0)).status).toBe("replayed");
  });
  it("refuses a proxy implementation that was omitted from the witness", async () => {
    expect((await replay(PROXY, trace(PROXY), 0)).failures).toContain("unobserved-read-call");
  });
  it.each([
    ["0x4260005260206000f3", "ambient-state-read"],
    ["0x5a60005260206000f3", "ambient-gas-read"],
    ["0x6007600155600760005260206000f3", "state-changing-read"],
    [`0x73${IMPLEMENTATION.slice(2)}3f60005260206000f3`, "unobserved-code-read"],
  ] as const)("rejects forbidden read code %s", async (code, failure) => {
    expect((await replay(code as Hex, trace(code as Hex))).failures).toContain(failure);
  });
  it("binds both prestate results and actual replay to a final canonical block with exactly four RPC calls", async () => {
    const snapshot = observation(), calls: string[] = [];
    const rpc = (): TradeRpcV1 => async (method, params) => {
      calls.push(method);
      if (method === "debug_traceCall") {
        expect(params).toMatchObject([{ from: CALLER, to: FEED, data: "0x313ce567", value: "0x0" }, "0x4d2", { tracer: "prestateTracer" }]);
        return trace();
      }
      expect(method).toBe("eth_getBlockByNumber");
      return { number: "0x4d2", hash: snapshot.block.hash, timestamp: toHex(BigInt(snapshot.block.timestamp)) };
    };
    const result = await replayNativeFeedConstructorRead(snapshot, CALLER, { rpcs: [rpc(), rpc()], now: () => NOW });
    expect(result.replay).toMatchObject({ status: "replayed", passes: 2, output: toHex(7, { size: 32 }) });
    expect(result.witness.observationId).toBe(snapshot.id); expect(result.launchReady).toBe(false);
    expect(calls).toEqual(["debug_traceCall", "debug_traceCall", "eth_getBlockByNumber", "eth_getBlockByNumber"]);
  });
  it("refuses a changed block after an otherwise matching replay", async () => {
    const rpc = (): TradeRpcV1 => async method => method === "debug_traceCall" ? trace()
      : { number: "0x4d2", hash: `0x${"33".repeat(32)}`, timestamp: toHex(NOW / 1000 - 5) };
    await expect(replayNativeFeedConstructorRead(observation(), CALLER, { rpcs: [rpc(), rpc()], now: () => NOW })).rejects.toMatchObject({ code: "dependency-replay" });
  });
});
