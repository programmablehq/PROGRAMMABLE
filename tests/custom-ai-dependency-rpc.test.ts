import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { productionMainnetRpcEnvironment } from "../lib/onchain/website-rpc-providers.server";
import { createProductionConstructorDependencyResolver, createProductionDependencyRpcs } from "../lib/custom-ai/dependency-rpc.server";

const secret = "thisIsOnlyAFakeTestCredential123";
const env = {
  ...productionMainnetRpcEnvironment(`https://lb.drpc.live/ethereum/${secret}`, `https://read.ethereum-mainnet.quiknode.pro/${secret}/`),
  ROBINHOOD_V4_RPC_PRIMARY_URL: `https://lb.drpc.live/robinhood/${secret}`,
  ROBINHOOD_V4_RPC_SECONDARY_URL: `https://robinhood-mainnet.g.alchemy.com/v2/${secret}`,
  BASE_RPC_PRIMARY_URL: `https://lb.drpc.live/base/${secret}`,
  BASE_RPC_SECONDARY_URL: `https://base-mainnet.g.alchemy.com/v2/${secret}`,
  HYPEREVM_RPC_PRIMARY_URL: `https://lb.drpc.live/hyperliquid/${secret}`,
  HYPEREVM_RPC_SECONDARY_URL: `https://hyperliquid-mainnet.g.alchemy.com/v2/${secret}`,
};
const ok = (init?: RequestInit, result: unknown = "0x1") => Response.json({ jsonrpc: "2.0", id: JSON.parse(String(init?.body)).id, result });
const call = { from: `0x${"11".repeat(20)}`, to: `0x${"22".repeat(20)}`, data: "0x313ce567", value: "0x0", gas: "0x1e8480" };
const trace = { tracer: "prestateTracer", timeout: "5s", tracerConfig: { diffMode: false } };
describe("bounded production dependency transport", () => {
  it("selects the existing pair for only the requested chain without eager reads", async () => {
    const observed: string[] = [], fetcher = vi.fn(async (url, init) => { observed.push(String(url)); return ok(init); }) as unknown as typeof fetch;
    const rpcs = createProductionDependencyRpcs({ env, fetcher });
    createProductionConstructorDependencyResolver({ env, fetcher });
    expect(observed).toEqual([]);
    for (const chain of [1, 4663, 8453, 999] as const) {
      const pair = rpcs(chain); expect(rpcs(chain)).toBe(pair);
      expect(await Promise.all(pair.map(rpc => rpc("eth_chainId", [])))).toEqual(["0x1", "0x1"]);
    }
    expect(observed).toEqual([env.PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL, env.PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL,
      env.ROBINHOOD_V4_RPC_PRIMARY_URL, env.ROBINHOOD_V4_RPC_SECONDARY_URL, env.BASE_RPC_PRIMARY_URL, env.BASE_RPC_SECONDARY_URL,
      env.HYPEREVM_RPC_PRIMARY_URL, env.HYPEREVM_RPC_SECONDARY_URL]);
    expect(fetcher).toHaveBeenCalledTimes(8);
    for (const [, init] of (fetcher as ReturnType<typeof vi.fn>).mock.calls) expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("snapshots server settings and requires the selected chain's complete pair", () => {
    const settings = { ...env }, rpcs = createProductionDependencyRpcs({ env: settings });
    settings.BASE_RPC_PRIMARY_URL = "https://attacker.invalid/";
    expect(() => rpcs(8453)).not.toThrow();
    expect(() => createProductionDependencyRpcs({ env: {} })(8453)).toThrowError(/contract inputs/);
    expect(() => createProductionDependencyRpcs({ env: {} })(1)).toThrowError(/contract inputs/);
  });
  it.each([
    { BASE_RPC_PRIMARY_URL: "https://lb.drpc.live/robinhood/thisIsOnlyAFakeTestCredential123" },
    { BASE_RPC_SECONDARY_URL: "https://base-mainnet.g.alchemy.com/v2/thisIsOnlyAFakeTestCredential123?debug=1" },
    { BASE_RPC_SECONDARY_URL: "https://user:password@base-mainnet.g.alchemy.com/v2/thisIsOnlyAFakeTestCredential123" },
    { BASE_RPC_SECONDARY_PROVIDER_ID: "drpc" },
  ])("rejects changed provider/network identity before a read: %j", overrides => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(() => createProductionDependencyRpcs({ env: { ...env, ...overrides }, fetcher })(8453)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows the existing explicitly selected HyperEVM public witness without substituting it", async () => {
    const fetcher = vi.fn(async (_url, init) => ok(init)) as unknown as typeof fetch;
    const rpcs = createProductionDependencyRpcs({ env: { ...env, HYPEREVM_RPC_SECONDARY_URL: "https://rpc.hyperliquid.xyz/evm" }, fetcher });
    await rpcs(999)[1]("eth_chainId", []);
    expect(fetcher).toHaveBeenCalledWith("https://rpc.hyperliquid.xyz/evm", expect.anything());
    expect(() => createProductionDependencyRpcs({ env: { ...env, HYPEREVM_RPC_SECONDARY_URL: undefined } })(999)).toThrow();
  });
  it("accepts the fixed decimals trace and rejects arbitrary tracers, gas, scans and transactions", async () => {
    const fetcher = vi.fn(async (_url, init) => ok(init, {})) as unknown as typeof fetch;
    const rpc = createProductionDependencyRpcs({ env, fetcher })(8453)[0];
    await rpc("debug_traceCall", [call, "0x64", trace]);
    for (const [method, params] of [
      ["eth_sendRawTransaction", ["0x00"]], ["eth_getLogs", [{}]], ["eth_call", [{ to: call.to, data: "0x12345678" }, "latest"]],
      ["debug_traceCall", [call, "0x64", { ...trace, tracer: "arbitrary-javascript" }]],
      ["debug_traceCall", [{ ...call, gas: "0xffffffff" }, "0x64", trace]],
      ["debug_traceCall", [call, "latest", trace]],
    ] as [string, unknown[]][]) await expect(rpc(method, params)).rejects.toMatchObject({ code: "launch-dependency" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds response bytes and rejects mismatched JSON-RPC responses", async () => {
    for (const response of [Response.json({ jsonrpc: "2.0", id: 999, result: "0x1" }), new Response("x".repeat(524_289))]) {
      const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
      await expect(createProductionDependencyRpcs({ env, fetcher })(8453)[0]("eth_chainId", [])).rejects.toMatchObject({ code: "launch-dependency" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry exhausted providers and shares their cooldown across pair lookups", async () => {
    let now = 1_000;
    let requests = 0;
    const fetcher = vi.fn(async (_url, init) => ++requests === 1 ? new Response(null, { status: 429 }) : ok(init)) as unknown as typeof fetch;
    const rpcs = createProductionDependencyRpcs({ env, fetcher, now: () => now });
    await expect(rpcs(8453)[0]("eth_chainId", [])).rejects.toThrow();
    await expect(rpcs(8453)[0]("eth_chainId", [])).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 30_001; await rpcs(8453)[0]("eth_chainId", []); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds simultaneous and per-second requests without an accumulating queue", async () => {
    const complete: (() => void)[] = [];
    const fetcher = vi.fn((_url, init) => new Promise<Response>(resolve => { complete.push(() => resolve(ok(init))); })) as unknown as typeof fetch;
    const rpc = createProductionDependencyRpcs({ env, fetcher, now: () => 1_000 })(8453)[0];
    const pending = Array.from({ length: 4 }, () => rpc("eth_chainId", []));
    await expect(rpc("eth_chainId", [])).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(4);
    complete.forEach(resolve => resolve()); await Promise.all(pending);
    const immediate = vi.fn(async (_url, init) => ok(init)) as unknown as typeof fetch;
    const limited = createProductionDependencyRpcs({ env, fetcher: immediate, now: () => 1_000 })(8453)[0];
    for (let n = 0; n < 16; n++) await limited("eth_chainId", []);
    await expect(limited("eth_chainId", [])).rejects.toThrow(); expect(immediate).toHaveBeenCalledTimes(16);
  });
  it("does not expose provider URLs or error bodies", async () => {
    const fetcher = vi.fn(async () => { throw new Error(`secret ${env.BASE_RPC_PRIMARY_URL}`); }) as unknown as typeof fetch;
    const rpc = createProductionDependencyRpcs({ env, fetcher })(8453)[0];
    const result = await rpc("eth_chainId", []).catch(error => error);
    expect(String(result)).not.toContain(secret); expect(JSON.stringify(result)).not.toContain(secret);
  });
});
