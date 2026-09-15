import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, keccak256, parseAbiParameters, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { foundationFactoryAbi, foundationMetadataParameters, type FoundationLaunchParameters } from "@/lib/module-foundation/abi";
import { FOUNDATION_INFRASTRUCTURE, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import { foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";
import { foundationReadbackAbi } from "@/lib/module-foundation/readback";
import type { FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import { discoverFoundationLaunch, locateFoundationCreationTransaction, readFoundationLaunchIndex } from "@/lib/module-foundation/discovery";

vi.mock("@/lib/module-foundation/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-foundation/client")>();
  return { ...actual, assertFoundationInfrastructure: vi.fn(async (_client, _binding, blockNumber?: bigint) => {
    const number = blockNumber ?? 200n;
    return { blockNumber: number, blockHash: toHex(number, { size: 32 }), timestamp: number * 10n };
  }) };
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const addr = (n: number) => getAddress(toHex(BigInt(n) << 144n, { size: 20 }));
const hash = (n: number | bigint) => toHex(n, { size: 32 });
const token = addr(1), quote = addr(2), creator = addr(3), factory = addr(4), hook = addr(5), ledger = addr(6), vault = addr(7);
const instance = addr(8), foreign = addr(9), code = "0x60006000" as const;
const binding: FoundationDeploymentBinding = { sourceCommit: "a".repeat(40), releaseDigest: hash(1), startBlock: 1n,
  factory: { address: factory, runtimeCodeHash: keccak256(code) }, hookDeployer: { address: addr(10), runtimeCodeHash: keccak256(code) } };
const metadata = { name: "Example", symbol: "EXM", description: "Source-bound discovery", imageURI: "https://example.com/image.png", website: "", socialData: "0x" as Hex };
const metadataHash = keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata]));
const descriptor = { moduleId: hash(55), abiVersion: 1, phases: 4, resources: 1, beforeGas: 0, afterGas: 0,
  actionGas: 10_000, failOpenAfter: false, exclusiveGroup: hash(0) };
const selection = { factory: addr(11), factoryCodeHash: keccak256(code), moduleCodeHash: keccak256(code),
  descriptorHash: keccak256(encodeAbiParameters(parseAbiParameters("(bytes32 moduleId,uint16 abiVersion,uint8 phases,uint8 resources,uint32 beforeGas,uint32 afterGas,uint32 actionGas,bool failOpenAfter,bytes32 exclusiveGroup)"), [descriptor])),
  configuration: "0x12345678" as Hex, creatorShareBps: 4_000 };
const parameters: FoundationLaunchParameters = { metadata, quote, quoteDecimals: 6, initialTick: 0, creatorFeeBps: 1_000,
  additionalQuoteAmount: 0n, initialBuyQuoteAmount: 0n, initialBuyMinimumTokenAmount: 0n, deadline: 1_500n,
  tokenSalt: hash(30), hookSalt: hash(31), modules: [selection] };
const compositionHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[]"),
  ["0xeec95424459934ec69cc14945be8c29d8a064b8b90ffb60a279c9c9bef35cfc1", parameters.modules]));
const pool = { token, quote, hook, poolId: foundationPoolId(foundationPoolKey({ token, quote, hook })) };
const key = foundationPoolKey(pool);
const record = { token, hook, ledger, poolId: pool.poolId, baseVault: vault, basePositionId: 77n, creatorPositionId: 0n, initialBuyTokenAmount: 0n };
const inputData = encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [parameters] });
const txHash = hash(40);

function launchLog(options: { token?: Address; blockNumber?: bigint; logIndex?: number; transactionHash?: Hex } = {}) {
  const selectedToken = options.token ?? token, blockNumber = options.blockNumber ?? 100n;
  const id = foundationPoolId(foundationPoolKey({ token: selectedToken, quote, hook }));
  return { address: factory, blockNumber, blockHash: hash(blockNumber), transactionIndex: 2,
    transactionHash: options.transactionHash ?? txHash, logIndex: options.logIndex ?? 3, removed: false,
    topics: encodeEventTopics({ abi: foundationReadbackAbi, eventName: "FoundationLaunched", args: { token: selectedToken, creator, poolId: id } }),
    data: encodeAbiParameters(parseAbiParameters("address,address,address,address,uint256,uint256,bytes32,bytes32,uint256,uint256"),
      [hook, ledger, quote, vault, 77n, 0n, metadataHash, compositionHash, 0n, 0n]) };
}

interface Read { address: Address; functionName: string; args?: readonly unknown[]; blockNumber: bigint }
function fixture(custom?: (request: Read) => unknown) {
  const readContract = vi.fn(async (request: Read) => {
    const override = custom?.(request);
    if (override !== undefined) return override;
    const { address, functionName: name, args = [] } = request;
    if (address === factory) {
      if (name === "launchOf") { const target = args[0] as Address; return { ...record, token: target, poolId: foundationPoolId(foundationPoolKey({ token: target, quote, hook })) }; }
      if (name === "predictTokenAddress") return args[0] === creator ? token : foreign;
      if (name === "predictHookAddress") return hook;
    }
    if (address === hook) {
      const values: Record<string, unknown> = { initializer: factory, token, quote, creator, ledger, poolId: pool.poolId, poolKey: key,
        creatorFeeBps: 1_000, initialTick: 0, compositionHash, moduleCount: 1n, feeCarry: [0, 0],
        moduleAt: { instance, codeHash: keccak256(code), configurationHash: keccak256(selection.configuration), descriptor } };
      if (name in values) return values[name];
    }
    if (name === "metadataHash") return metadataHash;
    if (address === token || address === quote) {
      const values: Record<string, unknown> = { name: metadata.name, symbol: metadata.symbol, decimals: address === token ? 18 : 6,
        totalSupply: FOUNDATION_SUPPLY, balanceOf: 0n, metadata: [metadata.description, metadata.website, metadata.imageURI, metadata.socialData] };
      if (name in values) return values[name];
    }
    if (address === ledger) {
      const values: Record<string, unknown> = { poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address, hook, quote, creator,
        platformReceived: 0n, platformClaimed: 0n, creatorReceived: 0n, creatorCredited: 0n, creatorClaimed: 0n, moduleClaimedTotal: 0n,
        creatorShareBps: 6_000, moduleShareBps: 4_000, moduleCredited: 0n, moduleClaimed: 0n, outstandingBacking: 0n, unallocatedCreatorDust: 0n };
      if (name in values) return values[name];
    }
    if (address === instance) {
      if (name === "context") return { host: hook, token, quote, creator, ledger, poolId: pool.poolId };
      if (name === "configurationHash") return keccak256(selection.configuration);
    }
    if (address === vault) {
      const values: Record<string, unknown> = { positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address,
        positionManagerCodeHash: FOUNDATION_INFRASTRUCTURE.positionManager.runtimeCodeHash, positionId: 77n, beneficiary: creator };
      if (name in values) return values[name];
    }
    if (address === FOUNDATION_INFRASTRUCTURE.positionManager.address) {
      if (name === "ownerOf") return vault;
      if (name === "getApproved") return addr(0);
      if (name === "getPositionLiquidity") return 1_000n;
      if (name === "getPoolAndPositionInfo") return [key, (BigInt(pool.poolId) & ~((1n << 56n) - 1n)) | (887_220n << 32n)];
    }
    if (address === FOUNDATION_INFRASTRUCTURE.poolManager.address && name === "balanceOf") return 0n;
    if (address === FOUNDATION_INFRASTRUCTURE.stateView.address) {
      if (name === "getSlot0") return [1n << 96n, 0, 0, 0];
      if (name === "getLiquidity") return 1_000n;
    }
    throw new Error(`Unmocked read ${address} ${name}`);
  });
  const getTransaction = vi.fn(async () => ({ hash: txHash, from: creator, to: factory, input: inputData,
    value: 0n, blockNumber: 100n, blockHash: hash(100), transactionIndex: 2 }));
  const getTransactionReceipt = vi.fn(async () => ({ status: "success", transactionHash: txHash,
    from: creator, to: factory, blockNumber: 100n, blockHash: hash(100), transactionIndex: 2, logs: [launchLog()] }));
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: hash(blockNumber), timestamp: blockNumber * 10n }));
  const getLogs = vi.fn(async () => [launchLog()]);
  return { client: { readContract, getTransaction, getTransactionReceipt, getBlock, getLogs, getCode: vi.fn(async () => code) } as unknown as PublicClient,
    readContract, getTransaction, getTransactionReceipt, getBlock, getLogs };
}

describe("bounded explorer candidate locator", () => {
  it("uses only a fixed public GET and ignores misleading explorer creator/verification fields", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ hash: token, creation_transaction_hash: txHash,
      creator_address_hash: foreign, is_verified: false, creation_status: "failed" }));
    expect(await locateFoundationCreationTransaction(token)).toBe(txHash);
    expect(fetch).toHaveBeenCalledWith(`https://robinhoodchain.blockscout.com/api/v2/addresses/${token}`,
      expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" }));
  });

  it.each([
    [{ hash: foreign, creation_transaction_hash: txHash }, "different token"],
    [{ creation_transaction_hash: "0x1234" }, "invalid transaction hash"],
    [{ creation_transaction_hash: hash(0) }, "invalid transaction hash"],
    [[], "response is invalid"],
  ])("rejects malformed candidate metadata %#", async (payload, error) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(payload));
    await expect(locateFoundationCreationTransaction(token)).rejects.toThrow(error as string);
  });

  it("returns no candidate for a missing address or null creation hash", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    expect(await locateFoundationCreationTransaction(token)).toBeNull();
    fetch.mockResolvedValue(Response.json({ creation_transaction_hash: null }));
    expect(await locateFoundationCreationTransaction(token)).toBeNull();
  });

  it("bounds both advertised and streamed response bytes and requires JSON", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }));
    await expect(locateFoundationCreationTransaction(token)).rejects.toThrow("size");
    fetch.mockResolvedValue(new Response(" ".repeat(65_537), { headers: { "content-type": "application/json" } }));
    await expect(locateFoundationCreationTransaction(token)).rejects.toThrow("size");
    fetch.mockResolvedValue(new Response("{}", { headers: { "content-type": "text/html" } }));
    await expect(locateFoundationCreationTransaction(token)).rejects.toThrow("temporarily unavailable");
  });

  it("times out a stalled lookup and respects pre-existing cancellation", async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = expect(locateFoundationCreationTransaction(token)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(locateFoundationCreationTransaction(token, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates unavailable public access so the caller can use an injected BFF locator", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(locateFoundationCreationTransaction(token)).rejects.toThrow("Failed to fetch");
  });
});

describe("canonical transaction discovery", () => {
  it("restores exact generic module selections through the real receipt and pool validators", async () => {
    const f = fixture(), locator = vi.fn(async () => txHash);
    const result = await discoverFoundationLaunch({ client: f.client, binding, token, locator });
    expect(result).toMatchObject({ evidence: "canonical-launch-discovery", token, transactionHash: txHash,
      moduleSelections: [selection], parameters, metadataHash });
    expect(result.receipt.evidence).toBe("canonical-receipt");
    expect(result.checkpoint.blockNumber).toBe(100n);
    expect(result.observedAt.blockNumber).toBe(200n);
    expect(f.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "predictTokenAddress", args: [creator, parameters.tokenSalt, metadata], blockNumber: 100n }));
  });

  it("accepts a candidate from a bounded index without contacting the explorer", async () => {
    const locator = vi.fn(async () => { throw new Error("must not run"); });
    await expect(discoverFoundationLaunch({ client: fixture().client, binding, token, locator, transactionHash: txHash })).resolves.toMatchObject({ transactionHash: txHash });
    expect(locator).not.toHaveBeenCalled();
  });

  it("rejects a foreign token before consulting any locator", async () => {
    const locator = vi.fn(async () => txHash);
    const f = fixture(r => r.functionName === "launchOf" ? { ...record, token: foreign } : undefined);
    await expect(discoverFoundationLaunch({ client: f.client, binding, token, locator })).rejects.toThrow("not registered");
    expect(locator).not.toHaveBeenCalled();
  });

  it("bounds transaction calldata before decoding and does not invent a missing locator result", async () => {
    const f = fixture();
    f.getTransaction.mockResolvedValue({ ...await f.getTransaction(), input: `0x${"00".repeat(160_001)}` as Hex });
    await expect(discoverFoundationLaunch({ client: f.client, binding, token, transactionHash: txHash })).rejects.toThrow("selected foundation factory");
    await expect(discoverFoundationLaunch({ client: fixture().client, binding, token, locator: async () => null })).rejects.toThrow("No creation transaction");
  });

  it.each([
    [{ to: foreign }, "selected foundation factory"],
    [{ from: foreign }, "different token or pool"],
    [{ value: 1n }, "selected foundation factory"],
    [{ input: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launchOf", args: [token] }) }, "does not call"],
    [{ input: `${inputData}00` as Hex }, "canonical ABI encoding"],
  ] as const)("rejects a candidate with altered transaction identity %#", async (change, error) => {
    const f = fixture();
    f.getTransaction.mockResolvedValue({ ...await f.getTransaction(), ...change });
    await expect(discoverFoundationLaunch({ client: f.client, binding, token, transactionHash: txHash })).rejects.toThrow(error);
  });

  it("rejects failed receipts, spoofed launch emitters and mismatched token metadata", async () => {
    const failed = fixture();
    failed.getTransactionReceipt.mockResolvedValue({ ...await failed.getTransactionReceipt(), status: "reverted" });
    await expect(discoverFoundationLaunch({ client: failed.client, binding, token, transactionHash: txHash })).rejects.toThrow("mined transaction");
    const spoofed = fixture();
    spoofed.getTransactionReceipt.mockResolvedValue({ ...await spoofed.getTransactionReceipt(), logs: [{ ...launchLog(), address: foreign }] });
    await expect(discoverFoundationLaunch({ client: spoofed.client, binding, token, transactionHash: txHash })).rejects.toThrow("expected factory");
    const changed = fixture(r => r.functionName === "metadataHash" ? hash(999) : undefined);
    await expect(discoverFoundationLaunch({ client: changed.client, binding, token, transactionHash: txHash })).rejects.toThrow("metadataHash");
  });

  it("rejects canonical state changing during lookup", async () => {
    const f = fixture();
    f.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber, hash: hash(blockNumber === 200n ? 201n : blockNumber), timestamp: blockNumber * 10n }));
    await expect(discoverFoundationLaunch({ client: f.client, binding, token, transactionHash: txHash })).rejects.toThrow("no longer canonical");
  });
});

describe("bounded canonical launch index", () => {
  const window = { fromBlock: 1n, toBlock: 200n };

  it("paginates newest first within one explicit source-bound block window", async () => {
    const f = fixture();
    const older = launchLog({ token: addr(12), blockNumber: 99n, transactionHash: hash(42) });
    f.getLogs.mockResolvedValue([older, launchLog()]);
    const first = await readFoundationLaunchIndex({ client: f.client, binding, ...window, pageSize: 1 });
    expect(first.entries.map(item => item.blockNumber)).toEqual([100n]);
    expect(first.nextCursor).not.toBeNull();
    const second = await readFoundationLaunchIndex({ client: f.client, binding, ...window, pageSize: 1, cursor: first.nextCursor! });
    expect(second.entries.map(item => item.blockNumber)).toEqual([99n]);
    expect(second.nextCursor).toBeNull();
    expect(f.getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: factory, fromBlock: 1n, toBlock: 200n, strict: true }));
    expect(first.evidence).toBe("canonical-launch-index");
  });

  it("passes an indexed token filter and returns a candidate usable by the verified discovery", async () => {
    const f = fixture();
    const page = await readFoundationLaunchIndex({ client: f.client, binding, token, ...window });
    expect(f.getLogs).toHaveBeenCalledWith(expect.objectContaining({ args: { token } }));
    const result = await discoverFoundationLaunch({ client: f.client, binding, token, transactionHash: page.entries[0].transactionHash });
    expect(result.moduleSelections).toEqual([selection]);
  });

  it("continues within the same block without skipping or repeating a later log", async () => {
    const f = fixture();
    f.getLogs.mockResolvedValue([launchLog(), launchLog({ token: addr(12), logIndex: 4, transactionHash: hash(42) })]);
    const first = await readFoundationLaunchIndex({ client: f.client, binding, ...window, pageSize: 1 });
    const second = await readFoundationLaunchIndex({ client: f.client, binding, ...window, pageSize: 1, cursor: first.nextCursor! });
    expect([first.entries[0].logIndex, second.entries[0].logIndex]).toEqual([4, 3]);
    expect(second.nextCursor).toBeNull();
  });

  it("accepts exactly 5,000 inclusive blocks", async () => {
    const f = fixture();
    await expect(readFoundationLaunchIndex({ client: f.client, binding, fromBlock: 1n, toBlock: 5_000n })).resolves.toMatchObject({ fromBlock: 1n, toBlock: 5_000n });
  });

  it.each([
    [{ fromBlock: 1n, toBlock: 5_001n }, "at most 5,000"],
    [{ fromBlock: 2n, toBlock: 1n }, "at most 5,000"],
    [{ fromBlock: 0n, toBlock: 200n }, "at most 5,000"],
    [{ fromBlock: 1n, toBlock: 200n, pageSize: 101 }, "page size"],
  ])("rejects unbounded or invalid ranges %# before getLogs", async (range, error) => {
    const f = fixture();
    await expect(readFoundationLaunchIndex({ client: f.client, binding, ...range })).rejects.toThrow(error);
    expect(f.getLogs).not.toHaveBeenCalled();
  });

  it("binds pagination to its release, filter, block window and anchor hash", async () => {
    const f = fixture();
    f.getLogs.mockResolvedValue([launchLog(), launchLog({ token: addr(12), blockNumber: 99n, transactionHash: hash(42) })]);
    const page = await readFoundationLaunchIndex({ client: f.client, binding, ...window, pageSize: 1 });
    for (const change of [{ token }, { fromBlock: 2n }, { binding: { ...binding, releaseDigest: hash(404) } }]) {
      await expect(readFoundationLaunchIndex({ client: f.client, binding, ...window, ...change, cursor: page.nextCursor! })).rejects.toThrow("cursor belongs");
    }
    const raw = page.nextCursor!;
    // The eighth ABI word is the canonical anchor hash.
    const changed = `${raw.slice(0, 2 + 7 * 64)}${hash(201).slice(2)}${raw.slice(2 + 8 * 64)}` as Hex;
    await expect(readFoundationLaunchIndex({ client: f.client, binding, ...window, cursor: changed })).rejects.toThrow("cursor belongs");
  });

  it("rejects spoofed origins, out-of-window logs, wrong token filters and duplicate logs", async () => {
    for (const log of [{ ...launchLog(), address: foreign }, launchLog({ blockNumber: 201n })]) {
      const f = fixture(); f.getLogs.mockResolvedValue([log]);
      await expect(readFoundationLaunchIndex({ client: f.client, binding, ...window })).rejects.toThrow("invalid origin");
    }
    const wrong = fixture(); wrong.getLogs.mockResolvedValue([launchLog({ token: addr(12) })]);
    await expect(readFoundationLaunchIndex({ client: wrong.client, binding, ...window, token })).rejects.toThrow("requested token");
    const duplicate = fixture(); duplicate.getLogs.mockResolvedValue([launchLog(), launchLog()]);
    await expect(readFoundationLaunchIndex({ client: duplicate.client, binding, ...window })).rejects.toThrow("duplicate");
  });

  it("rejects noncanonical blocks and factory or metadata disagreement", async () => {
    const f = fixture(); f.getLogs.mockResolvedValue([{ ...launchLog(), blockHash: hash(101) }]);
    await expect(readFoundationLaunchIndex({ client: f.client, binding, ...window })).rejects.toThrow("canonical block");
    for (const read of [(r: Read) => r.functionName === "launchOf" ? { ...record, basePositionId: 1n } : undefined,
      (r: Read) => r.functionName === "metadataHash" ? hash(404) : undefined]) {
      await expect(readFoundationLaunchIndex({ client: fixture(read).client, binding, ...window })).rejects.toThrow("canonical factory or token");
    }
  });

  it("stops oversized result sets and keeps an empty window explicitly scoped", async () => {
    const f = fixture(); f.getLogs.mockResolvedValue(Array.from({ length: 2_001 }, () => launchLog()));
    await expect(readFoundationLaunchIndex({ client: f.client, binding, ...window })).rejects.toThrow("smaller block window");
    f.getLogs.mockResolvedValue([]);
    expect(await readFoundationLaunchIndex({ client: f.client, binding, ...window })).toMatchObject({ ...window, entries: [], nextCursor: null });
  });
});
