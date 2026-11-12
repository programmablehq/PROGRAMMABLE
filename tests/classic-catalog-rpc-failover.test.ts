import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, TimeoutError } from "viem";
import config from "../config/classic-launch-catalog.v1.json";
import { classicLaunchEvents } from "../lib/market-data/classic-launch-proof";

const rpc = vi.hoisted(() => ({ clients: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <T>(read: T) => read }));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => rpc.clients.shift(),
}));
vi.mock("../lib/onchain/config", () => ({
  getWebsiteReadOnchainDeployment: () => ({
    status: "ready", rpcUrl: "https://primary.example/private-key",
    rpcUrlSecondary: "https://secondary.example/private-key",
    rpcProviderIds: { primary: "drpc", secondary: "quicknode" },
  }),
}));

import { readClassicCatalogGroup } from "../lib/market-data/classic-launch-catalog.server";

const source = config.sources[1]!;
const token = "0x1111111111111111111111111111111111111111";
const creator = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}` as const;
const pool = `0x${"cd".repeat(32)}` as const;
const block = String(source.startBlock + 1);

function logs() {
  const values = [
    { deployer: creator, token, poolId: pool, feeHook: source.hook, rewardVault: creator,
      positionRecipient: creator, positionTokenId: 1n, buySwapFeeBps: 100, sellSwapFeeBps: 200,
      rewardConfigurationHash: hash, launchHash: hash },
    { token, totalSupply: 1000n, tokenLiquidityAmount: 900n, lockedTokenDust: 1n,
      initialTick: 100, tickLower: 0, tickUpper: 200, lpFeePips: 0, launchHash: hash },
    { deployer: creator, token, poolId: pool, nativeAmount: 1n, tokenAmount: 99n, launchHash: hash },
    { deployer: creator, token, custody: "0x0000000000000000000000000000000000000000",
      mode: 0, durationDays: 0, cliffDays: 0, configurationHash: hash, launchHash: hash },
  ];
  return JSON.stringify(classicLaunchEvents.map((event, index) => {
    const args = values[index]! as Record<string, unknown>;
    const inputs = event.inputs.filter(input => !("indexed" in input && input.indexed));
    return { address: source.launcher, blockNumber: block, blockHash: hash,
      transactionHash: hash, transactionIndex: 0, logIndex: index, removed: false,
      topics: encodeEventTopics({ abi: [event], eventName: event.name, args } as never),
      data: encodeAbiParameters(inputs, inputs.map(input => args[input.name]) as never) };
  }));
}

function client(overrides: { name?: unknown; blockHash?: string } = {}) {
  return {
    getBlock: vi.fn(async () => ({ number: BigInt(block), hash: overrides.blockHash ?? hash, timestamp: 1_700_000_000n })),
    multicall: vi.fn(async () => [
      { status: "success", result: overrides.name ?? "Classic" },
      { status: "success", result: "CLASSIC" },
      { status: "success", result: 18 },
      { status: "failure", error: new Error("Optional metadata unavailable") },
      { status: "success", result: source.launcher },
    ]),
  };
}

beforeEach(() => { rpc.clients = []; });

describe("Classic catalog metadata RPC recovery", () => {
  it("uses the secondary when multicall reports a required metadata transport failure", async () => {
    const primary = client();
    const secondary = client();
    const results = await primary.multicall();
    results[0] = { status: "failure", error: new TimeoutError({ url: "https://primary.example/private-key" }) };
    primary.multicall.mockReset().mockResolvedValue(results);
    rpc.clients = [primary, secondary];

    await expect(readClassicCatalogGroup(logs())).resolves.toMatchObject([{ tokenAddress: token, name: "Classic", symbol: "CLASSIC" }]);
    expect(primary.multicall).toHaveBeenCalledOnce();
    expect(secondary.multicall).toHaveBeenCalledOnce();
    expect(secondary.getBlock).toHaveBeenCalledWith({ blockNumber: BigInt(block), includeTransactions: false });
  });

  it("does not rotate providers to accept invalid token metadata", async () => {
    const primary = client({ name: "unsafe\u0000name" });
    const secondary = client();
    rpc.clients = [primary, secondary];
    await expect(readClassicCatalogGroup(logs())).rejects.toThrow("Canonical Classic launch data is unavailable");
    expect(secondary.multicall).not.toHaveBeenCalled();
  });

  it("does not rotate providers to accept a mismatching launch block", async () => {
    const primary = client({ blockHash: pool });
    const secondary = client();
    rpc.clients = [primary, secondary];
    await expect(readClassicCatalogGroup(logs())).rejects.toThrow("Canonical Classic launch data is unavailable");
    expect(secondary.multicall).not.toHaveBeenCalled();
  });
});
