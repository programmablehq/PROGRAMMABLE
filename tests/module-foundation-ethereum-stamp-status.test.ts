import { expect, it, vi } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { readEthereumMissingIndexReason } from "@/lib/server/module-foundation/ethereum-stamp-status";
import { CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1 } from "@/lib/tokens";

vi.mock("@/lib/tokens", async original => {
  const actual = await original<typeof import("@/lib/tokens")>();
  const { keccak256 } = await import("viem");
  return { ...actual,
    CANONICAL_LAUNCH_STAMP_V1: { ...actual.CANONICAL_LAUNCH_STAMP_V1, routerRuntimeCodeHash: keccak256("0x6001") },
    CANONICAL_LAUNCH_STAMP_24H_V1: { ...actual.CANONICAL_LAUNCH_STAMP_24H_V1, routerRuntimeCodeHash: keccak256("0x6001") } };
});
const token: Address = "0x1111111111111111111111111111111111111111";
const blockNumber = 26_200_000n;
const empty = toHex(0n, { size: 32 }), stamp = toHex(1n, { size: 32 });
function fixture() {
  const clients = [0, 1].map(() => ({
    getCode: vi.fn(async () => "0x6001"),
    readContract: vi.fn<(request: { address: Address; blockNumber: bigint }) => Promise<Hex>>().mockResolvedValue(empty),
  }));
  const read = () => readEthereumMissingIndexReason({ token, blockNumber,
    clients: clients as unknown as Parameters<typeof readEthereumMissingIndexReason>[0]["clients"] });
  return { clients, read };
}

it("requires two verified providers before classifying a deployed token as unstamped", async () => {
  const { clients, read } = fixture();
  expect(await read()).toBe("MODULE_STAMP_MISSING");
  for (const client of clients) {
    expect(client.getCode).toHaveBeenCalledWith({ address: token, blockNumber });
    expect(client.readContract).toHaveBeenCalledTimes(2);
    for (const call of client.readContract.mock.calls) expect(call[0]).toMatchObject({ blockNumber });
  }
});

it.each([CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1])("preserves pending status for a stamp on $routerAddress", async router => {
  const { clients, read } = fixture();
  for (const client of clients) client.readContract.mockImplementation(async (...args: unknown[]) =>
    (args[0] as { address: string }).address === router.routerAddress ? stamp : empty);
  expect(await read()).toBe("MODULE_INDEX_PENDING");
});

it("does not call an unfinalized or not-yet-deployed token unstamped", async () => {
  const { clients, read } = fixture();
  for (const client of clients) client.getCode.mockResolvedValue("0x");
  expect(await read()).toBe("MODULE_INDEX_PENDING");
  expect(clients[0].readContract).not.toHaveBeenCalled();
});

it("does not turn a provider error or disagreement into a missing stamp", async () => {
  const { clients, read } = fixture();
  clients[0].readContract.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(read()).rejects.toThrow("RPC unavailable");
  clients[0].readContract.mockResolvedValueOnce(stamp);
  await expect(read()).rejects.toThrow("providers disagree");
  clients[0].getCode.mockResolvedValueOnce("0x6002");
  await expect(read()).rejects.toThrow("providers disagree");
});

it("rejects a router whose runtime does not match the published source", async () => {
  const { clients, read } = fixture();
  for (const client of clients) client.getCode.mockResolvedValue("0x6002");
  expect(keccak256("0x6002")).not.toBe(CANONICAL_LAUNCH_STAMP_V1.routerRuntimeCodeHash);
  await expect(read()).rejects.toThrow("router could not be verified");
});
