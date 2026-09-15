import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, erc20Abi, getAddress, toHex, type PublicClient } from "viem";
import { assertFoundationPool, simulateFoundationSequence, type FoundationDeploymentBinding, type FoundationPreparedStep } from "@/lib/module-foundation/client";
import { foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";

const token = getAddress("0x1000000000000000000000000000000000000000");
const quote = getAddress("0x2000000000000000000000000000000000000000");
const hook = getAddress("0x30000000000000000000000000000000000020cc");
const account = getAddress("0x4000000000000000000000000000000000000000");
const factory = getAddress("0x5000000000000000000000000000000000000000");
const ledger = getAddress("0x6000000000000000000000000000000000000000");
const zero = getAddress("0x0000000000000000000000000000000000000000");
const hash = toHex(1, { size: 32 });
const binding: FoundationDeploymentBinding = { releaseDigest: hash, sourceCommit: "a".repeat(40), startBlock: 1n,
  factory: { address: factory, runtimeCodeHash: hash }, hookDeployer: { address: factory, runtimeCodeHash: hash } };
const pool = { token, quote, hook, poolId: foundationPoolId(foundationPoolKey({ token, quote, hook })) };
const step: FoundationPreparedStep = { label: "Swap", kind: "buy", transaction: { from: account, to: factory, data: "0x1234", value: 0n }, gasUsed: 0n, effect: "Spend 10; receive at least 8." };
const checkpoint = { blockNumber: 1n, blockHash: hash, timestamp: 1n };
const success = (data: `0x${string}`) => ({ status: "success", data, gasUsed: 1n });
const balance = (value: bigint) => success(encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: value }));

describe("foundation pool provenance", () => {
  it("rejects an unregistered pool even when its key hash is internally consistent", async () => {
    const readContract = vi.fn(async () => ({ token: zero, hook, ledger, poolId: pool.poolId, baseVault: factory, basePositionId: 1n }));
    await expect(assertFoundationPool({ readContract } as unknown as PublicClient, binding, pool, 1n)).rejects.toThrow("not a launch");
    expect(readContract).toHaveBeenCalledTimes(1);
  });
  it("rejects swapped quote identity after a valid factory registration", async () => {
    const values: Record<string, unknown> = {
      launchOf: { token, hook, ledger, poolId: pool.poolId, baseVault: factory, basePositionId: 1n },
      initializer: factory, token, quote: account, ledger, poolId: pool.poolId,
      poolKey: foundationPoolKey({ token, quote, hook }), creatorFeeBps: 100, creator: account,
    };
    const client = { readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]) } as unknown as PublicClient;
    await expect(assertFoundationPool(client, binding, pool, 1n)).rejects.toThrow("identity is inconsistent");
  });
});

describe("ephemeral sequence balance evidence", () => {
  it("rejects a successful router return with insufficient real net output", async () => {
    const client = { simulateCalls: vi.fn(async () => ({ results: [balance(100n), balance(10n), success("0x"), balance(90n), balance(17n)] })) } as unknown as PublicClient;
    await expect(simulateFoundationSequence(client, [step], checkpoint,
      [{ token: quote, account, delta: -10n }, { token, account, minimumDelta: 8n }])).rejects.toThrow("actual simulated wallet balances");
  });
  it("verifies both debit and net output and binds the original block", async () => {
    const client = { simulateCalls: vi.fn(async () => ({ results: [balance(100n), balance(10n), success("0x"), balance(90n), balance(18n)] })),
      getBlock: vi.fn(async () => ({ hash })) } as unknown as PublicClient;
    const checked = await simulateFoundationSequence(client, [step], checkpoint,
      [{ token: quote, account, delta: -10n }, { token, account, minimumDelta: 8n }]);
    expect(checked.balances.map(item => item.delta)).toEqual([-10n, 8n]);
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 1n });
  });
  it("rejects state changes and a false-returning ERC20 approval", async () => {
    const client = { simulateCalls: vi.fn(async () => ({ results: [success(toHex(0n, { size: 32 }))] })) } as unknown as PublicClient;
    await expect(simulateFoundationSequence(client, [{ ...step, kind: "approve" }], checkpoint)).rejects.toThrow("rejected its approval");
    const changed = { simulateCalls: vi.fn(async () => ({ results: [success("0x")] })), getBlock: vi.fn(async () => ({ hash: toHex(2, { size: 32 }) })) } as unknown as PublicClient;
    await expect(simulateFoundationSequence(changed, [step], checkpoint)).rejects.toThrow("Chain state changed");
  });
});
