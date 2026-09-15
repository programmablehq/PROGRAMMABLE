import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";

// Keep the actual source ABI/provenance/claim checks; supply a small, deterministic RPC runtime fixture.
vi.mock("@/lib/module-foundation/constants", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-foundation/constants")>();
  const { keccak256 } = await import("viem");
  return { ...actual, FOUNDATION_INFRASTRUCTURE: Object.fromEntries(Object.entries(actual.FOUNDATION_INFRASTRUCTURE)
    .map(([role, pin]) => [role, { ...pin, runtimeCodeHash: keccak256("0x60006000") }])) };
});

import { assertFoundationPreparedSequence, prepareFoundationClaim, type FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import { foundationLedgerAbi } from "@/lib/module-foundation/abi";
import { FOUNDATION_ABI_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_INT128_MAX, FOUNDATION_PLATFORM_RECIPIENT } from "@/lib/module-foundation/constants";
import { foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";

const caller = getAddress("0x1000000000000000000000000000000000000000");
const creator = getAddress("0x2000000000000000000000000000000000000000");
const token = getAddress("0x3000000000000000000000000000000000000000");
const quote = getAddress("0x4000000000000000000000000000000000000000");
const hook = getAddress("0x50000000000000000000000000000000000020cc");
const ledger = getAddress("0x6000000000000000000000000000000000000000");
const factory = getAddress("0x7000000000000000000000000000000000000000");
const hookDeployer = getAddress("0x8000000000000000000000000000000000000000");
const baseVault = getAddress("0x9000000000000000000000000000000000000000");
const hash = toHex(1n, { size: 32 }), blockNumber = 17n;
const pool = { token, quote, hook, poolId: foundationPoolId(foundationPoolKey({ token, quote, hook })) };
const binding: FoundationDeploymentBinding = { releaseDigest: hash, sourceCommit: "a".repeat(40), startBlock: 1n,
  factory: { address: factory, runtimeCodeHash: keccak256("0x60006000") },
  hookDeployer: { address: hookDeployer, runtimeCodeHash: keccak256("0x60006000") } };
const success = (data: Hex) => ({ status: "success", data, gasUsed: 40_000n });
const balance = (amount: bigint) => success(encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: amount }));

function fixture(options: { beneficiary?: "platform" | "creator"; credited?: bigint; claimed?: bigint;
  received?: bigint; returned?: bigint; ledgerOverrides?: Record<string, unknown>; registeredLedger?: Address } = {}) {
  const beneficiary = options.beneficiary ?? "creator";
  const credited = options.credited ?? 120n, claimed = options.claimed ?? 20n;
  const available = credited - claimed, amount = available > FOUNDATION_INT128_MAX ? FOUNDATION_INT128_MAX : available;
  const received = options.received ?? amount, returned = options.returned ?? amount;
  const readContract = vi.fn(async ({ address, functionName }: { address: Address; functionName: string }) => {
    if (getAddress(address) === factory) {
      if (functionName === "VERSION_ID") return FOUNDATION_ABI_ID;
      if (functionName === "hookDeployer") return hookDeployer;
      if (functionName === "launchOf") return { token, hook, ledger: options.registeredLedger ?? ledger,
        baseVault, basePositionId: 1n, creatorPositionId: 0n, initialBuyTokenAmount: 0n, poolId: pool.poolId };
      if (functionName in FOUNDATION_INFRASTRUCTURE) return FOUNDATION_INFRASTRUCTURE[functionName as keyof typeof FOUNDATION_INFRASTRUCTURE].address;
    }
    if (getAddress(address) === hook) {
      const values: Record<string, unknown> = { initializer: factory, token, quote, ledger, poolId: pool.poolId,
        poolKey: foundationPoolKey(pool), creatorFeeBps: 100, creator };
      if (functionName in values) return values[functionName];
    }
    if (getAddress(address) === ledger) {
      const values: Record<string, unknown> = { poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address, hook, quote, creator,
        platformReceived: credited, platformClaimed: claimed, creatorCredited: credited, creatorClaimed: claimed,
        ...options.ledgerOverrides };
      if (functionName in values) return values[functionName];
    }
    throw new Error(`Unexpected RPC read: ${address}/${functionName}`);
  });
  const simulateCalls = vi.fn(async (request: unknown) => {
    expect(request).toMatchObject({ account: caller, blockNumber });
    return { results: [balance(500n),
      success(encodeFunctionResult({ abi: foundationLedgerAbi, functionName: beneficiary === "platform" ? "claimPlatform" : "claimCreator", result: returned })),
      balance(500n + received)] };
  });
  const client = { getChainId: vi.fn(async () => 4663), getBlock: vi.fn(async () => ({ number: blockNumber, hash, timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
    getCode: vi.fn(async () => "0x60006000"), readContract, simulateCalls } as unknown as PublicClient;
  return { client, readContract, simulateCalls, prepare: () => prepareFoundationClaim({ client, binding, account: caller, pool, beneficiary }) };
}

describe("foundation fixed-recipient fee payouts", () => {
  it.each(["platform", "creator"] as const)("lets another wallet trigger %s payment while binding real quote checks to its fixed recipient", async beneficiary => {
    const { prepare, readContract, simulateCalls } = fixture({ beneficiary });
    const sequence = await prepare();
    const recipient = beneficiary === "platform" ? FOUNDATION_PLATFORM_RECIPIENT : creator;
    expect(sequence.account).toBe(caller);
    expect(sequence.recipient).toBe(recipient);
    expect(sequence.recipient).not.toBe(caller);
    expect(sequence.minimumOutput).toBe(100n);
    expect(sequence.steps).toHaveLength(1);
    expect(sequence.steps[0].transaction).toMatchObject({ from: caller, to: ledger, value: 0n });
    expect(decodeFunctionData({ abi: foundationLedgerAbi, data: sequence.steps[0].transaction.data }))
      .toEqual({ functionName: beneficiary === "platform" ? "claimPlatform" : "claimCreator", args: undefined });
    const request = simulateCalls.mock.calls[0][0] as unknown as { account: Address; blockNumber: bigint; calls: { to: Address; data: Hex }[] };
    expect(request.account).toBe(caller);
    expect(request.blockNumber).toBe(blockNumber);
    for (const call of [request.calls[0], request.calls[2]]) {
      expect(call.to).toBe(quote);
      expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "balanceOf", args: [recipient] });
    }
    expect(sequence.balances).toEqual([{ token: quote, account: recipient, before: 500n, after: 600n, delta: 100n }]);
    expect(readContract.mock.calls.every(([request]) => (request as { blockNumber?: bigint }).blockNumber === blockNumber)).toBe(true);
    expect(() => assertFoundationPreparedSequence(sequence)).not.toThrow();
    expect(Object.isFrozen(sequence.steps[0].transaction)).toBe(true);
    expect(() => assertFoundationPreparedSequence(structuredClone(sequence))).toThrow("Prepare and simulate");
  });

  it.each(["poolManager", "hook", "quote", "creator"])("rejects a ledger whose %s points at another launch or recipient before simulating a payout", async field => {
    const { prepare, simulateCalls } = fixture({ ledgerOverrides: { [field]: caller } });
    await expect(prepare()).rejects.toThrow("ledger is bound to a different launch");
    expect(simulateCalls).not.toHaveBeenCalled();
  });

  it("rejects a spoofed factory ledger even if the caller provides a self-consistent pool key", async () => {
    const { prepare, simulateCalls } = fixture({ registeredLedger: caller });
    await expect(prepare()).rejects.toThrow("identity is inconsistent");
    expect(simulateCalls).not.toHaveBeenCalled();
  });

  it("rejects nominal claim success when the fixed recipient's real net balance receives less", async () => {
    const { prepare } = fixture({ received: 99n, returned: 100n });
    await expect(prepare()).rejects.toThrow("actual simulated wallet balances");
  });

  it.each([99n, 101n])("rejects a claim return of %s when real net payout was 100", async returned => {
    await expect(fixture({ returned }).prepare()).rejects.toThrow("simulated payout did not reach its fixed recipient");
  });

  it.each([{ credited: 20n, claimed: 20n }, { credited: 19n, claimed: 20n }])("does not prepare an empty or inconsistent fee account: $credited/$claimed", async values => {
    const { prepare, simulateCalls } = fixture(values);
    await expect(prepare()).rejects.toThrow("no accrued fees");
    expect(simulateCalls).not.toHaveBeenCalled();
  });

  it("respects the ledger's int128 tranche while preserving the fixed recipient and actual payout check", async () => {
    const sequence = await fixture({ beneficiary: "platform", credited: FOUNDATION_INT128_MAX + 100n, claimed: 0n }).prepare();
    expect(sequence.minimumOutput).toBe(FOUNDATION_INT128_MAX);
    expect(sequence.balances[0].delta).toBe(FOUNDATION_INT128_MAX);
    expect(sequence.recipient).toBe(FOUNDATION_PLATFORM_RECIPIENT);
  });
});
