import { describe, expect, it, vi } from "vitest";
import {
  ContractFunctionRevertedError, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult,
  getAddress, keccak256, parseAbiParameters, toHex, type Address, type Hex, type PublicClient,
} from "viem";
import { foundationFactoryAbi, foundationMetadataParameters, type FoundationLaunchParameters } from "@/lib/module-foundation/abi";
import { FOUNDATION_ABI_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_INT128_MAX, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import { foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";
import type { FoundationDeploymentBinding, FoundationPreparedStep } from "@/lib/module-foundation/client";
import {
  foundationFeesFromGross, foundationReadbackAbi, readFoundationPoolDetails, simulateFoundationTradeFees,
  verifyFoundationLaunchReceipt, type FoundationExpectedLaunch,
} from "@/lib/module-foundation/readback";

// Infrastructure bytecode is covered by the client checks; these fixtures exercise the actual factory/pool validator.
vi.mock("@/lib/module-foundation/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-foundation/client")>();
  return { ...actual, assertFoundationInfrastructure: vi.fn(async () => ({ blockNumber: 100n, blockHash: toHex(100, { size: 32 }), timestamp: 1_000n })) };
});

const address = (n: number) => getAddress(toHex(BigInt(n) << 144n, { size: 20 }));
const hash = (n: number) => toHex(n, { size: 32 });
const token = address(1), quote = address(2), creator = address(3), factory = address(4);
const hook = getAddress("0x50000000000000000000000000000000000020cc");
const ledger = address(6), vault = address(7), moduleAddress = address(8), otherOwner = address(9);
const code = "0x60006000" as const;
const binding: FoundationDeploymentBinding = { releaseDigest: hash(1), sourceCommit: "a".repeat(40), startBlock: 1n,
  factory: { address: factory, runtimeCodeHash: keccak256(code) }, hookDeployer: { address: address(10), runtimeCodeHash: keccak256(code) } };
const pool = { token, quote, hook, poolId: foundationPoolId(foundationPoolKey({ token, quote, hook })) };
const key = foundationPoolKey(pool);
const checkpoint = { blockNumber: 100n, blockHash: hash(100), timestamp: 1_000n };
const metadata = { name: "Example", symbol: "EXM", description: "A fixed supply coin.", imageURI: "https://example.com/image.png", website: "https://example.com", socialData: "0x" as Hex };
const metadataHash = keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata]));
const descriptor = { moduleId: hash(20), abiVersion: 1, phases: 4, resources: 1, beforeGas: 0, afterGas: 0,
  actionGas: 10_000, failOpenAfter: false, exclusiveGroup: hash(0) };
const moduleSelection = { factory: address(11), factoryCodeHash: keccak256(code), moduleCodeHash: keccak256(code),
  descriptorHash: keccak256(encodeAbiParameters(parseAbiParameters("(bytes32 moduleId,uint16 abiVersion,uint8 phases,uint8 resources,uint32 beforeGas,uint32 afterGas,uint32 actionGas,bool failOpenAfter,bytes32 exclusiveGroup)"), [descriptor])),
  configuration: "0x1234" as Hex, creatorShareBps: 4_000 };
const parameters: FoundationLaunchParameters = { metadata, quote, quoteDecimals: 6, initialTick: 0, creatorFeeBps: 1_000,
  additionalQuoteAmount: 10_000n, initialBuyQuoteAmount: 10_000n, initialBuyMinimumTokenAmount: 80n,
  deadline: 1_300n, tokenSalt: hash(30), hookSalt: hash(31), modules: [moduleSelection] };
const compositionHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[]"), [FOUNDATION_ABI_ID, parameters.modules]));
const record = { token, hook, ledger, poolId: pool.poolId, baseVault: vault, basePositionId: 77n, creatorPositionId: 78n, initialBuyTokenAmount: 90n };
const launchTransaction = { from: creator, to: factory, value: 0n, data: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [parameters] }) };
const expected: FoundationExpectedLaunch = { transaction: launchTransaction, parameters, metadataHash,
  result: { ...record, baseVault: address(12), basePositionId: 50n, creatorPositionId: 51n, initialBuyTokenAmount: 100n } };
const transactionHash = hash(40);

function packed(poolId: Hex, lower: number, upper: number) {
  return (BigInt(poolId) & ~((1n << 56n) - 1n)) | (BigInt.asUintN(24, BigInt(lower)) << 8n) | (BigInt.asUintN(24, BigInt(upper)) << 32n);
}

function launchLog(overrides: Partial<{ address: Address; poolId: Hex; metadataHash: Hex; compositionHash: Hex; basePositionId: bigint; creator: Address }> = {}) {
  return { address: overrides.address ?? factory, blockNumber: 100n, blockHash: hash(100), transactionHash, transactionIndex: 2, logIndex: 3, removed: false,
    topics: encodeEventTopics({ abi: foundationReadbackAbi, eventName: "FoundationLaunched",
      args: { token, creator: overrides.creator ?? creator, poolId: overrides.poolId ?? pool.poolId } }),
    data: encodeAbiParameters(parseAbiParameters("address,address,address,address,uint256,uint256,bytes32,bytes32,uint256,uint256"),
      [hook, ledger, quote, vault, overrides.basePositionId ?? 77n, 78n, overrides.metadataHash ?? metadataHash, overrides.compositionHash ?? compositionHash, 10_000n, 90n]) };
}

function swapLog(grossQuote = 10_000n, platformQuote = 30n, creatorQuote = 1_000n, eventPool = pool.poolId, emitter = hook) {
  return { address: emitter, topics: encodeEventTopics({ abi: foundationReadbackAbi, eventName: "FoundationSwap",
    args: { poolId: eventPool, router: FOUNDATION_INFRASTRUCTURE.universalRouter.address } }),
    data: encodeAbiParameters(parseAbiParameters("bool,bool,uint256,uint256,uint256,int128,int128"),
      [true, true, grossQuote, platformQuote, creatorQuote, 100n, -8_970n]) };
}

interface Read { address: Address; functionName: string; args?: readonly unknown[]; blockNumber: bigint }
function fixture(overrides: { read?: (request: Read) => unknown; blockHash?: Hex } = {}) {
  const readContract = vi.fn(async (request: Read) => {
    const custom = overrides.read?.(request);
    if (custom !== undefined) return custom;
    const { address: target, functionName: fn, args = [] } = request;
    if (target.toLowerCase() === factory.toLowerCase()) {
      if (fn === "launchOf") return record;
    }
    if (target.toLowerCase() === hook.toLowerCase()) {
      const values: Record<string, unknown> = { initializer: factory, token, quote, ledger, creator, poolId: pool.poolId,
        poolKey: key, creatorFeeBps: 1_000, initialTick: 0, compositionHash, moduleCount: 1n,
        moduleAt: { instance: moduleAddress, codeHash: keccak256(code), configurationHash: keccak256(moduleSelection.configuration), descriptor }, feeCarry: [0, 0] };
      if (fn in values) return values[fn];
    }
    if (target.toLowerCase() === token.toLowerCase()) {
      const values: Record<string, unknown> = { name: metadata.name, symbol: metadata.symbol, decimals: 18,
        totalSupply: FOUNDATION_SUPPLY - 42n, metadata: [metadata.description, metadata.website, metadata.imageURI, metadata.socialData],
        metadataHash, balanceOf: 5n };
      if (fn in values) return values[fn];
    }
    if (target.toLowerCase() === quote.toLowerCase()) {
      const values: Record<string, unknown> = { name: "Quote", symbol: "QTE", decimals: 6, totalSupply: 10n ** 18n, balanceOf: 1_000_000n };
      if (fn in values) return values[fn];
    }
    if (target.toLowerCase() === ledger.toLowerCase()) {
      const values: Record<string, unknown> = { poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address, hook, quote, creator,
        platformReceived: 30n, platformClaimed: 10n, creatorReceived: 1_000n, creatorCredited: 600n, creatorClaimed: 200n,
        moduleClaimedTotal: 150n, creatorShareBps: 6_000, moduleShareBps: 4_000, moduleCredited: 400n, moduleClaimed: 150n,
        outstandingBacking: 670n, unallocatedCreatorDust: 0n };
      if (fn in values) return values[fn];
    }
    if (target.toLowerCase() === moduleAddress.toLowerCase()) {
      if (fn === "context") return { host: hook, token, quote, creator, ledger, poolId: pool.poolId };
      if (fn === "configurationHash") return keccak256(moduleSelection.configuration);
    }
    if (target.toLowerCase() === vault.toLowerCase()) {
      const values: Record<string, unknown> = { positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address,
        positionManagerCodeHash: FOUNDATION_INFRASTRUCTURE.positionManager.runtimeCodeHash, positionId: 77n, beneficiary: creator };
      if (fn in values) return values[fn];
    }
    if (target.toLowerCase() === FOUNDATION_INFRASTRUCTURE.positionManager.address.toLowerCase()) {
      if (fn === "ownerOf") return args[0] === 77n ? vault : otherOwner;
      if (fn === "getApproved") return address(0);
      if (fn === "getPositionLiquidity") return 1_000n;
      if (fn === "getPoolAndPositionInfo") return [key, args[0] === 77n ? packed(pool.poolId, 0, 887_220) : packed(pool.poolId, -887_220, 0)];
    }
    if (target.toLowerCase() === FOUNDATION_INFRASTRUCTURE.poolManager.address.toLowerCase() && fn === "balanceOf") return 670n;
    if (target.toLowerCase() === FOUNDATION_INFRASTRUCTURE.stateView.address.toLowerCase()) {
      if (fn === "getSlot0") return [1n << 96n, 0, 0, 0];
      if (fn === "getLiquidity") return 1_000n;
    }
    throw new Error(`Unmocked read: ${target} ${fn}`);
  });
  const getBlock = vi.fn(async () => ({ number: 100n, hash: overrides.blockHash ?? hash(100), timestamp: 1_000n }));
  const getTransactionReceipt = vi.fn(async () => ({ status: "success", transactionHash, blockNumber: 100n, blockHash: hash(100),
    from: creator, to: factory, transactionIndex: 2, logs: [launchLog()] }));
  const getTransaction = vi.fn(async () => ({ hash: transactionHash, from: creator, to: factory, input: launchTransaction.data,
    value: 0n, blockNumber: 100n, blockHash: hash(100), transactionIndex: 2 }));
  const client = { readContract, getBlock, getCode: vi.fn(async () => code), getTransactionReceipt, getTransaction };
  return { client: client as unknown as PublicClient, readContract, getBlock, getTransactionReceipt, getTransaction };
}

describe("canonical foundation pool readback", () => {
  it("reads metadata, actual transferred NFT owner, signed ticks, independent budgets and burned supply at one block", async () => {
    const f = fixture();
    const result = await readFoundationPoolDetails({ client: f.client, binding, token, account: creator });
    expect(result.evidence).toBe("canonical-readback");
    expect(result.token).toMatchObject({ metadataHash, totalSupply: FOUNDATION_SUPPLY - 42n, decimals: 18 });
    expect(result.positions.base).toMatchObject({ owner: vault, tickLower: 0, tickUpper: 887_220 });
    expect(result.positions.creator).toMatchObject({ owner: otherOwner, tickLower: -887_220, tickUpper: 0 });
    expect(result.ledger.platform).toMatchObject({ credited: 30n, claimed: 10n, withdrawable: 20n });
    expect(result.ledger.creator).toMatchObject({ received: 1_000n, credited: 600n, claimed: 200n, withdrawable: 400n });
    expect(result.ledger.modules[0]).toMatchObject({ credited: 400n, claimed: 150n, withdrawable: 250n,
      integrity: { codeMatches: true, contextMatches: true, configurationMatches: true } });
    expect(f.readContract.mock.calls.every(([call]) => call.blockNumber === 100n)).toBe(true);
    expect(f.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });

  it.each([
    ["foreign factory record", (r: Read) => r.functionName === "launchOf" ? { ...record, token: otherOwner } : undefined, "not registered"],
    ["foreign hook key", (r: Read) => r.functionName === "poolKey" ? { ...key, fee: 500 } : undefined, "identity is inconsistent"],
    ["metadata mismatch", (r: Read) => r.functionName === "metadataHash" ? hash(999) : undefined, "metadataHash"],
    ["base owner mismatch", (r: Read) => r.functionName === "ownerOf" && r.args?.[0] === 77n ? creator : undefined, "permanent vault"],
    ["foreign NFT pool", (r: Read) => r.functionName === "getPoolAndPositionInfo" ? [{ ...key, fee: 500 }, packed(pool.poolId, 0, 887_220)] : undefined, "foreign pool"],
    ["foreign vault manager", (r: Read) => r.address === vault && r.functionName === "positionManager" ? otherOwner : undefined, "foreign binding"],
    ["unbacked fee credits", (r: Read) => r.address === FOUNDATION_INFRASTRUCTURE.poolManager.address && r.functionName === "balanceOf" ? 669n : undefined, "under-backed"],
  ] as const)("rejects %s", async (_, read, error) => {
    await expect(readFoundationPoolDetails({ client: fixture({ read }).client, binding, token })).rejects.toThrow(error);
  });

  it("keeps independent claim balances readable when an optional module getter reverts", async () => {
    const f = fixture({ read: r => { if (r.address === moduleAddress && r.functionName === "context") throw new Error("module failure"); } });
    const result = await readFoundationPoolDetails({ client: f.client, binding, token });
    expect(result.ledger.platform.withdrawable).toBe(20n);
    expect(result.ledger.modules[0].integrity.contextMatches).toBeNull();
  });

  it("distinguishes an outstanding budget from the maximum amount withdrawable in one claim", async () => {
    const received = FOUNDATION_INT128_MAX + 100n, backing = received + 640n;
    const f = fixture({ read: r => {
      if (r.address === ledger && r.functionName === "platformReceived") return received;
      if (r.functionName === "outstandingBacking") return backing;
      if (r.address === FOUNDATION_INFRASTRUCTURE.poolManager.address && r.functionName === "balanceOf") return backing;
    } });
    const result = await readFoundationPoolDetails({ client: f.client, binding, token });
    expect(result.ledger.platform.outstanding).toBe(FOUNDATION_INT128_MAX + 90n);
    expect(result.ledger.platform.withdrawable).toBe(FOUNDATION_INT128_MAX);
  });

  it("recognizes a cleared, burned creator NFT without treating transport errors as a burn", async () => {
    const emptyKey = { currency0: address(0), currency1: address(0), fee: 0, tickSpacing: 0, hooks: address(0) };
    const read = (r: Read) => {
      if (r.args?.[0] !== 78n) return undefined;
      if (r.functionName === "getPoolAndPositionInfo") return [emptyKey, 0n];
      if (r.functionName === "getPositionLiquidity") return 0n;
      if (r.functionName === "ownerOf") throw new ContractFunctionRevertedError({ abi: foundationReadbackAbi, functionName: "ownerOf", message: "NOT_MINTED" });
    };
    const result = await readFoundationPoolDetails({ client: fixture({ read }).client, binding, token });
    expect(result.positions.creator).toMatchObject({ status: "closed", owner: null, liquidity: 0n, tickLower: null });
    const failed = fixture({ read: r => { if (r.functionName === "ownerOf" && r.args?.[0] === 78n) throw new Error("RPC unavailable"); } });
    await expect(readFoundationPoolDetails({ client: failed.client, binding, token })).rejects.toThrow("RPC unavailable");
  });

  it("rejects a reorganization during reads", async () => {
    await expect(readFoundationPoolDetails({ client: fixture({ blockHash: hash(101) }).client, binding, token })).rejects.toThrow("no longer canonical");
  });
});

describe("source-bound launch receipt", () => {
  it("verifies the empty-composition Solidity ABI vector including its version domain", async () => {
    // Independent Foundry cast abi-encode f(bytes32,(address,bytes32,bytes32,bytes32,bytes,uint16)[]) + cast keccak.
    // Hook constructor: keccak256(abi.encode(T.ABI_ID, selections)); the empty array still needs the version word.
    const emptyComposition = "0xb0d03e00a72be7da678fd858d1d2bce1a1d1dc499635c0271b302e86e96b6fbe" as const;
    const p = { ...parameters, modules: [] };
    const transaction = { ...launchTransaction, data: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [p] }) };
    const f = fixture({ read: r => {
      const replacements: Record<string, unknown> = { moduleCount: 0n, compositionHash: emptyComposition,
        creatorCredited: 1_000n, creatorShareBps: 10_000, moduleClaimedTotal: 0n, outstandingBacking: 820n };
      if (r.functionName in replacements) return replacements[r.functionName];
      if (r.address === FOUNDATION_INFRASTRUCTURE.poolManager.address && r.functionName === "balanceOf") return 820n;
    } });
    f.getTransaction.mockResolvedValue({ ...await f.getTransaction(), input: transaction.data });
    f.getTransactionReceipt.mockResolvedValue({ ...await f.getTransactionReceipt(), logs: [launchLog({ compositionHash: emptyComposition })] });
    const result = await verifyFoundationLaunchReceipt({ client: f.client, binding, transactionHash,
      expected: { ...expected, parameters: p, transaction } });
    expect(result.event.compositionHash).toBe(emptyComposition);
    expect(result.details.ledger.modules).toEqual([]);
  });

  it("accepts actual minted position IDs and base vault after global counters changed since simulation", async () => {
    const result = await verifyFoundationLaunchReceipt({ client: fixture().client, binding, transactionHash, expected });
    expect(result.evidence).toBe("canonical-receipt");
    expect(result.event.basePositionId).toBe(77n);
    expect(result.details.positions.base.vault).toBe(vault);
    expect(result.event.initialBuyTokenAmount).toBe(90n);
  });

  it.each([
    ["spoofed emitter", { address: otherOwner }, "expected factory"],
    ["foreign pool", { poolId: hash(404) }, "differs from"],
    ["wrong metadata", { metadataHash: hash(404) }, "differs from"],
    ["wrong creator", { creator: otherOwner }, "differs from"],
    ["event NFT inconsistent with registry", { basePositionId: 79n }, "disagrees with"],
  ] as const)("rejects %s", async (_, change, error) => {
    const f = fixture();
    const receipt = await f.getTransactionReceipt();
    f.getTransactionReceipt.mockResolvedValue({ ...receipt, logs: [launchLog(change)] });
    await expect(verifyFoundationLaunchReceipt({ client: f.client, binding, transactionHash, expected })).rejects.toThrow(error);
  });

  it("rejects a foreign mined sender, altered calldata, duplicate event and noncanonical receipt block", async () => {
    for (const change of [{ from: otherOwner }, { input: "0x" as Hex }]) {
      const f = fixture();
      f.getTransaction.mockResolvedValue({ ...await f.getTransaction(), ...change });
      await expect(verifyFoundationLaunchReceipt({ client: f.client, binding, transactionHash, expected })).rejects.toThrow("mined transaction");
    }
    const duplicated = fixture();
    duplicated.getTransactionReceipt.mockResolvedValue({ ...await duplicated.getTransactionReceipt(), logs: [launchLog(), launchLog()] });
    await expect(verifyFoundationLaunchReceipt({ client: duplicated.client, binding, transactionHash, expected })).rejects.toThrow("exactly one");
    await expect(verifyFoundationLaunchReceipt({ client: fixture({ blockHash: hash(101) }).client, binding, transactionHash, expected })).rejects.toThrow("canonical");
  });

  it("rejects reviewed metadata substitution before fetching a receipt", async () => {
    const f = fixture();
    await expect(verifyFoundationLaunchReceipt({ client: f.client, binding, transactionHash, expected: { ...expected, metadataHash: hash(404) } })).rejects.toThrow("reviewed parameters");
    expect(f.getTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe("actual simulated quote fees", () => {
  const step: FoundationPreparedStep = { kind: "buy", label: "Buy", transaction: { from: creator,
    to: FOUNDATION_INFRASTRUCTURE.universalRouter.address, data: "0x1234", value: 0n }, gasUsed: 0n, effect: "Buy token." };
  const success = (data: Hex, logs?: ReturnType<typeof swapLog>[]) => ({ status: "success", data, gasUsed: 1n, ...(logs ? { logs } : {}) });
  const counter = (n: bigint) => success(encodeFunctionResult({ abi: foundationReadbackAbi, functionName: "platformReceived", result: n }));
  const simulate = (logs?: ReturnType<typeof swapLog>[], platform = 30n, creatorFee = 1_000n) => {
    const f = fixture();
    const simulateCalls = vi.fn(async () => ({ results: [counter(500n), counter(2_000n), success("0x", logs), counter(500n + platform), counter(2_000n + creatorFee)] }));
    return { client: Object.assign(f.client, { simulateCalls }), simulateCalls };
  };

  it("reconciles real gross swap logs against before/after cumulative ledger counters", async () => {
    const f = simulate([swapLog()]);
    const result = await simulateFoundationTradeFees({ client: f.client, binding, pool, steps: [step], checkpoint });
    expect(result).toMatchObject({ platformQuote: 30n, creatorQuote: 1_000n, totalQuote: 1_030n, grossQuote: 10_000n,
      evidence: "simulated-ledger-delta", nextCarry: { buy: { platform: 0, creator: 0 }, sell: { platform: 0, creator: 0 } } });
    const call = f.simulateCalls.mock.calls[0] as unknown as [{ calls: { to: Address }[]; blockNumber: bigint }];
    expect(call[0].calls.map(item => item.to)).toEqual([ledger, ledger, step.transaction.to, ledger, ledger]);
    expect(call[0].blockNumber).toBe(100n);
  });

  it("reports exact fees with unknown gross when a provider omits simulation logs", async () => {
    const result = await simulateFoundationTradeFees({ client: simulate().client, binding, pool, steps: [step], checkpoint });
    expect(result).toMatchObject({ platformQuote: 30n, creatorQuote: 1_000n, grossQuote: null, grossEvidence: null, nextCarry: null });
  });

  it.each([
    [[swapLog(10_000n, 30n, 1_000n, hash(404))], 30n, "foreign pool"],
    [[swapLog(10_000n, 30n, 1_000n, pool.poolId, otherOwner)], 30n, "reconcile"],
    [[swapLog()], 31n, "reconcile"],
    [[swapLog(10_000n, 29n)], 29n, "carry arithmetic"],
  ] as const)("rejects unbound or inconsistent simulation evidence %#", async (logs, platform, message) => {
    await expect(simulateFoundationTradeFees({ client: simulate([...logs], platform).client, binding, pool, steps: [step], checkpoint })).rejects.toThrow(message);
  });

  it("keeps distinct gross solutions for the same net and rejects amount/carry overflow", () => {
    const byNet = new Map<bigint, bigint>();
    let duplicate: [bigint, bigint] | null = null;
    for (let gross = 1n; gross < 1_000n; gross++) {
      const fees = foundationFeesFromGross(gross, 1_000, { platform: 0, creator: 0 });
      const earlier = byNet.get(fees.netQuote);
      if (earlier !== undefined) { duplicate = [earlier, gross]; break; }
      byNet.set(fees.netQuote, gross);
    }
    expect(duplicate).not.toBeNull();
    const first = foundationFeesFromGross(duplicate![0], 1_000, { platform: 0, creator: 0 });
    const second = foundationFeesFromGross(duplicate![1], 1_000, { platform: 0, creator: 0 });
    expect(first.netQuote).toBe(second.netQuote);
    expect(first.totalQuote).not.toBe(second.totalQuote);
    expect(foundationFeesFromGross(1n, 1_000, { platform: 9_999, creator: 9_999 }).positiveNet).toBe(false);
    expect(() => foundationFeesFromGross(FOUNDATION_INT128_MAX + 1n, 1_000, { platform: 0, creator: 0 })).toThrow("Invalid gross");
    expect(() => foundationFeesFromGross(1n, 1_000, { platform: 10_000, creator: 0 })).toThrow("Invalid gross");
  });
});
