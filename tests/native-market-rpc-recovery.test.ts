import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";

const state = vi.hoisted(() => ({
  chainId: 999, badCode: false,
  calls: [] as { endpoint: string; method: string; block?: bigint }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <T>(read: T) => read }));
vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: (url: string) => ({ url }),
    keccak256: (data: `0x${string}`) => data === "0x01"
      ? state.chainId === 999 ? "0xd655ab42f4f80273ba93b07b8ac024a1ea834f0c24bdd50a7ec04e87633b1ad5" : "0x213962cb8e24945a420ab6e609f9fee79a539472c952f12b8bfcbbbead5e8eba"
      : data === "0x02"
        ? state.chainId === 999 ? "0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2" : "0xfa352649c8e8706c4b815ccb5031e62c8091ad94acc1b60cd2b3c4e2854efc75"
        : actual.keccak256(data),
    createPublicClient: ({ transport }: { transport: { url: string } }) => {
      const endpoint = transport.url;
      return {
        getChainId: async () => { state.calls.push({ endpoint, method: "chain" }); return state.chainId; },
        getBlock: async () => ({ number: 100n, hash: `0x${"11".repeat(32)}`, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
        getBytecode: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
          state.calls.push({ endpoint, method: "code", block: blockNumber });
          if (endpoint.includes("primary")) {
            if (state.badCode) return "0x03";
            throw new actual.RpcRequestError({ url: endpoint,
              body: { method: "eth_getCode", params: [address, "0x64"] },
              error: { code: -32000, message: "unsupported block number" } });
          }
          return /^(0x165632|0x27ed73)/i.test(address) ? "0x01" : "0x02";
        },
        readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
          state.calls.push({ endpoint, method: functionName, block: blockNumber });
          const now = BigInt(Math.floor(Date.now() / 1000));
          return functionName === "latestRoundData" ? [1n, 100n * 10n ** 18n, now, now, 1n]
            : functionName === "decimals" ? 18 : functionName === "totalSupply" ? 10n ** 27n
              : functionName === "getLiquidity" ? 100n : [(1n << 96n) * 1000n, 0, 0, 0];
        },
      };
    },
  };
});

const token = "0x1111111111111111111111111111111111111111";
const native = "0x0000000000000000000000000000000000000000";
const hook = "0x2222222222222222222222222222222222222222";
const poolKey = { currency0: native, currency1: token, fee: 0, tickSpacing: 60, hooks: hook };
const poolId = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [native, token, 0, 60, hook],
));
const tokens = [{ tokenAddress: token, poolId, poolKey }];

beforeEach(() => { vi.resetModules(); state.calls = []; state.badCode = false; });
afterEach(() => { vi.unstubAllEnvs(); });

async function reader(chain: "hyper" | "elysium") {
  state.chainId = chain === "hyper" ? 999 : 99901;
  const prefix = chain === "hyper" ? "HYPEREVM" : "ELYSIUM";
  vi.stubEnv(`${prefix}_RPC_PRIMARY_URL`, "https://primary.example/private-key");
  vi.stubEnv(`${prefix}_RPC_SECONDARY_URL`, "https://secondary.example/private-key");
  return chain === "hyper"
    ? (await import("../lib/server/hyperevm-market")).enrichHyperEvmMarkets
    : (await import("../lib/server/elysium-market")).enrichElysiumMarkets;
}

it.each(["hyper", "elysium"] as const)("recovers the %s valuation using a complete secondary checkpoint", async chain => {
  const enrich = await reader(chain);
  const result = await enrich(tokens, new Map());
  expect(result.get(token)).toMatchObject({ blockNumber: "100", priceUsd: 0.0001,
    marketCapUsd: null, volume24hUsd: null, valuationKind: "fdv" });
  const reads = state.calls.filter(call => call.endpoint.includes("secondary") && call.method !== "chain");
  expect(reads.map(call => call.method)).toContain("getSlot0");
  expect(reads.every(call => call.block === 100n)).toBe(true);
  expect((await enrich(tokens, new Map())).get(token)?.priceUsd).toBe(0.0001);
  expect(state.calls.filter(call => call.endpoint.includes("primary") && call.method === "chain")).toHaveLength(1);
});

it.each(["hyper", "elysium"] as const)("keeps a %s runtime hash mismatch closed without trying another provider", async chain => {
  const enrich = await reader(chain);
  state.badCode = true;
  expect((await enrich(tokens, new Map())).size).toBe(0);
  expect((await enrich(tokens, new Map())).size).toBe(0);
  expect(state.calls.some(call => call.endpoint.includes("secondary"))).toBe(false);
});
