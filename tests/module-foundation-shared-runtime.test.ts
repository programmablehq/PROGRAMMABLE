import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [
  { getChainId: vi.fn(), getBlock: vi.fn(), getCode: vi.fn() },
  { getChainId: vi.fn(), getBlock: vi.fn(), getCode: vi.fn() },
], snapshot: vi.fn(), graph: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/module-foundation/rpc", () => ({
  foundationMainnetRpcs: () => [0, 1],
  foundationMainnetReadClient: (index: number) => fixture.clients[index],
}));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readFinalizedRouterCustomIdentitySnapshotCoreV1: fixture.snapshot }));
vi.mock("@/lib/server/module-foundation/ethereum-graph", () => ({ readFoundationEthereumGraphLaunch: fixture.graph }));
vi.mock("@/lib/server/module-foundation/owner-catalog", () => ({ withFoundationOwnerCatalogV1: async (value: unknown) => value }));
vi.mock("@/lib/onchain/config", () => ({ getOnchainDeployment: () => ({ status: "ready" }) }));
vi.mock("@/contracts/deployments/ethereum-module-release-v4.json", () => ({ default: { payload: { modules: [] } } }));
vi.mock("@/lib/module-foundation/ethereum-release", async () => {
  const { keccak256 } = await import("viem");
  const pin = { address: "0x1111111111111111111111111111111111111111", runtimeCodeHash: keccak256("0x6000") };
  return { ETHEREUM_MODULE_SOURCE: { startBlock: 1n }, ETHEREUM_MODULE_BINDING: { factory: pin, hookDeployer: pin },
    ethereumModuleSourceForStamp: () => ({ startBlock: 1n }) };
});

const tokens = ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"] as const;
const hash = `0x${"11".repeat(32)}`;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("PROGRAMMABLE_ETHEREUM_MODULE_MODE", "enabled");
  for (const client of fixture.clients) {
    client.getChainId.mockResolvedValue(1);
    client.getBlock.mockResolvedValue({ number: 100n, hash });
    client.getCode.mockResolvedValue("0x6000");
  }
  fixture.snapshot.mockResolvedValue({ entries: tokens.map(tokenAddress => ({ tokenAddress, launchStampProvenance: {
    launchId: hash, poolKey: { hooks: tokens[0] }, poolManagerAddress: tokens[0], poolId: hash,
    stampHash: hash, blockNumber: "100", blockHash: hash, transactionHash: hash, transactionIndex: 0, launchLogIndex: 0,
  } })) });
  fixture.graph.mockImplementation(async ({ token, anchor }: { token?: string; anchor: { token: string } }) => ({ binding: { token: token ?? anchor.token } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("shares the common two-provider runtime proof between distinct coins and the launch form", async () => {
  const { readEthereumFoundationAvailability: read } = await import("@/lib/server/module-foundation/ethereum-availability");
  const results = await Promise.all([read(tokens[0]), read(tokens[1]), read()]);
  expect(results.every(value => (value as { available: boolean }).available)).toBe(true);
  expect(fixture.graph).toHaveBeenCalledTimes(2);
  for (const client of fixture.clients) {
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(client.getCode).toHaveBeenCalledTimes(2);
  }
});

it("does not restart an identical in-flight verification when its normal cache period elapses", async () => {
  vi.useFakeTimers();
  const gate = Promise.withResolvers<number>();
  fixture.clients[0].getChainId.mockReturnValue(gate.promise);
  const { readEthereumFoundationAvailability: read } = await import("@/lib/server/module-foundation/ethereum-availability");
  const first = read();
  await vi.advanceTimersByTimeAsync(16_000);
  const second = read();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.clients[0].getChainId).toHaveBeenCalledTimes(1);
  gate.resolve(1);
  await Promise.all([first, second]);
});

it("revalidates expired runtime evidence and never keeps a failed proof", async () => {
  vi.useFakeTimers();
  const { readEthereumFoundationAvailability: read } = await import("@/lib/server/module-foundation/ethereum-availability");
  await read();
  await vi.advanceTimersByTimeAsync(15_001);
  fixture.clients[0].getCode.mockResolvedValue("0x6001");
  await expect(read()).rejects.toThrow("differs from its source");
  fixture.clients[0].getCode.mockResolvedValue("0x6000");
  await expect(read()).resolves.toMatchObject({ available: true });
  expect(fixture.clients[0].getChainId).toHaveBeenCalledTimes(3);
});
