import { vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, erc20Abi,
  getAbiItem, getAddress, keccak256, parseAbiParameters, toHex, type Address, type Hex, type PublicClient } from "viem";
import { foundationFactoryV2Abi, foundationMetadataParameters, type FoundationLaunchParameters, type FoundationLaunchResultV2 } from "@/lib/module-foundation/abi";
import { FOUNDATION_ABI_ID, FOUNDATION_DEAD_ADDRESS, FOUNDATION_FACTORY_V2_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_LP_CUSTODY_DEAD_ID, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import { foundationPositionAbi, foundationV2PositionSpecs, type FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";
import { planFoundationPrice } from "@/lib/module-foundation/price";
import { foundationPoolId, foundationPoolKey } from "@/lib/module-foundation/route";
import type { FoundationPreparedStep, FoundationBalanceCheck } from "@/lib/module-foundation/client";

// Synthetic, process-local SDK boundary data; these objects are not source/review or deployment authority.
export const v2Address = (n: number) => getAddress(toHex(BigInt(n) << 144n, { size: 20 }));
export const v2Hash = (n: number) => toHex(n, { size: 32 });
export const v2Code = "0x60006000" as const;
export const v2Now = 1_800_000_000_000;
export interface V2Read { address: Address; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }

export function foundationV2Fixture(optionalPosition = true) {
  const token = v2Address(1), quote = v2Address(2), account = v2Address(3), factory = v2Address(4), ledger = v2Address(6);
  const hook = getAddress("0x50000000000000000000000000000000000020cc"), deployer = v2Address(10);
  const binding: FoundationDeploymentBinding = { factoryVersion: "v2", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
    releaseDigest: v2Hash(1), sourceCommit: "a".repeat(40), startBlock: 1n,
    factory: { address: factory, runtimeCodeHash: keccak256(v2Code) }, hookDeployer: { address: deployer, runtimeCodeHash: keccak256(v2Code) } };
  const checkpoint = { blockNumber: 100n, blockHash: v2Hash(100), timestamp: BigInt(v2Now / 1_000) };
  const additional = optionalPosition ? 1_000_000n : 0n;
  const price = planFoundationPrice({ token, quote, valuationQuoteRaw: 100_000_000_000n, additionalQuoteRaw: additional });
  const metadata = { name: "Example V2", symbol: "EXV2", description: "Local custody fixture.", imageURI: "https://example.com/image.png", website: "", socialData: "0x" as Hex };
  const parameters: FoundationLaunchParameters = { metadata, quote, quoteDecimals: 6, initialTick: price.initialTick,
    creatorFeeBps: 100, additionalQuoteAmount: additional, initialBuyQuoteAmount: 10_000n, initialBuyMinimumTokenAmount: 80n,
    deadline: checkpoint.timestamp + 300n, tokenSalt: v2Hash(30), hookSalt: v2Hash(31), modules: [] };
  const key = foundationPoolKey({ token, quote, hook }), poolId = foundationPoolId(key), transactionHash = v2Hash(40);
  const result: FoundationLaunchResultV2 = { token, hook, ledger, poolId, basePositionOwner: FOUNDATION_DEAD_ADDRESS,
    creatorPositionOwner: optionalPosition ? FOUNDATION_DEAD_ADDRESS : v2Address(0), roundingInventoryRecipient: FOUNDATION_DEAD_ADDRESS,
    basePositionId: 77n, creatorPositionId: optionalPosition ? 78n : 0n, initialBuyTokenAmount: 90n,
    baseTokenPrincipal: price.base.principal, baseTokenRounding: price.base.dust,
    creatorQuotePrincipal: price.creator?.principal ?? 0n, actualQuoteRefund: price.creator?.dust ?? 0n };
  const metadataHash = keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata]));
  const compositionHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[]"), [FOUNDATION_ABI_ID, []]));
  const transaction = { from: account, to: factory, value: 0n, data: encodeFunctionData({ abi: foundationFactoryV2Abi, functionName: "launch", args: [parameters] }) };
  const steps: FoundationPreparedStep[] = [{ label: "Launch", kind: "launch", transaction, gasUsed: 100n, effect: "Mint LP NFTs directly to DEAD." }];
  const checks: FoundationBalanceCheck[] = [{ token: quote, account, minimumDelta: -parameters.initialBuyQuoteAmount - additional },
    { token, account, newToken: true, minimumDelta: parameters.initialBuyMinimumTokenAmount }];
  const state = { result, newToken: false, extraRefund: 0n, quoteDeltaAdjustment: 0n, factoryQuoteAfter: 13n, factoryTokenAfter: 0n,
    inventoryBalance: result.baseTokenRounding, chainId: 4663,
    factoryValues: { VERSION_ID: FOUNDATION_FACTORY_V2_ID, MODULE_ABI_ID: FOUNDATION_ABI_ID, LP_CUSTODY_ID: FOUNDATION_LP_CUSTODY_DEAD_ID,
      LP_RECIPIENT: FOUNDATION_DEAD_ADDRESS, ROUNDING_INVENTORY_RECIPIENT: FOUNDATION_DEAD_ADDRESS, LP_FEE: 0 } as Record<string, unknown>,
    owner: new Map<bigint, Address>(), approved: new Map<bigint, Address>(), liquidity: new Map<bigint, bigint>(),
    poolInfo: new Map<bigint, bigint>(), readOverride: undefined as ((read: V2Read) => unknown) | undefined,
  };
  const currentResult = () => ({ ...state.result, actualQuoteRefund: state.result.actualQuoteRefund + state.extraRefund });
  const specs = foundationV2PositionSpecs(result, quote, price.initialTick, { base: price.base.liquidity, creator: price.creator?.liquidity });
  for (const spec of specs) {
    state.owner.set(spec.id, FOUNDATION_DEAD_ADDRESS); state.approved.set(spec.id, v2Address(0)); state.liquidity.set(spec.id, spec.liquidity!);
    state.poolInfo.set(spec.id, (BigInt(poolId) & ~((1n << 56n) - 1n)) | (BigInt.asUintN(24, BigInt(spec.lower)) << 8n) | (BigInt.asUintN(24, BigInt(spec.upper)) << 32n));
  }
  const readContract = vi.fn(async (r: V2Read): Promise<unknown> => {
    const override = state.readOverride?.(r); if (override !== undefined) return override;
    const fn = r.functionName, args = r.args ?? [], target = getAddress(r.address);
    if (target === factory) {
      if (fn === "launchOf") return currentResult();
      if (fn in state.factoryValues) return state.factoryValues[fn];
      if (fn === "hookDeployer") return deployer;
      if (fn in FOUNDATION_INFRASTRUCTURE) return FOUNDATION_INFRASTRUCTURE[fn as keyof typeof FOUNDATION_INFRASTRUCTURE].address;
      if (fn === "predictTokenAddress") return token;
      if (fn === "predictHookAddress") return hook;
    }
    if (target === hook) return ({ initializer: factory, token, quote, ledger, creator: account, poolId, poolKey: key,
      creatorFeeBps: 100, initialTick: parameters.initialTick, compositionHash, moduleCount: 0n, feeCarry: [0, 0] } as Record<string, unknown>)[fn];
    if (target === token) return ({ name: metadata.name, symbol: metadata.symbol, decimals: 18, totalSupply: FOUNDATION_SUPPLY,
      metadata: [metadata.description, metadata.website, metadata.imageURI, metadata.socialData], metadataHash,
      balanceOf: fn === "balanceOf" && getAddress(args[0] as Address) === FOUNDATION_DEAD_ADDRESS ? state.inventoryBalance : 90n } as Record<string, unknown>)[fn];
    if (target === quote) return ({ name: "Quote", symbol: "QTE", decimals: 6, totalSupply: 10n ** 18n,
      balanceOf: args[0] === factory ? 13n : 1_000_000_000n } as Record<string, unknown>)[fn];
    if (target === ledger) return ({ poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address, hook, quote, creator: account,
      platformReceived: 30n, platformClaimed: 10n, creatorReceived: 100n, creatorCredited: 100n, creatorClaimed: 20n,
      moduleClaimedTotal: 0n, creatorShareBps: 10_000, outstandingBacking: 100n, unallocatedCreatorDust: 0n } as Record<string, unknown>)[fn];
    if (target === FOUNDATION_INFRASTRUCTURE.poolManager.address && fn === "balanceOf") return 100n;
    if (target === FOUNDATION_INFRASTRUCTURE.stateView.address) return fn === "getSlot0" ? [price.sqrtPriceX96, price.initialTick, 0, 0] : price.base.liquidity;
    throw new Error(`Unexpected fixture read ${fn}`);
  });
  const nftData = (data: Hex) => {
    const decoded = decodeFunctionData({ abi: foundationPositionAbi, data }), id = decoded.args[0];
    if (decoded.functionName === "ownerOf") return encodeFunctionResult({ abi: foundationPositionAbi, functionName: "ownerOf", result: state.owner.get(id)! });
    if (decoded.functionName === "getApproved") return encodeFunctionResult({ abi: foundationPositionAbi, functionName: "getApproved", result: state.approved.get(id)! });
    if (decoded.functionName === "getPositionLiquidity") return encodeFunctionResult({ abi: foundationPositionAbi, functionName: "getPositionLiquidity", result: state.liquidity.get(id)! });
    return encodeFunctionResult({ abi: foundationPositionAbi, functionName: "getPoolAndPositionInfo", result: [key, state.poolInfo.get(id)!] });
  };
  const commonLog = { blockNumber: 100n, blockHash: checkpoint.blockHash, transactionHash, transactionIndex: 2, removed: false };
  const launchLog = () => ({ ...commonLog, address: factory, logIndex: 3,
    topics: encodeEventTopics({ abi: foundationFactoryV2Abi, eventName: "FoundationLaunchedV2", args: { token, creator: account, poolId } }),
    data: encodeAbiParameters(getAbiItem({ abi: foundationFactoryV2Abi, name: "FoundationLaunchedV2" }).inputs.filter(item => !("indexed" in item && item.indexed)),
      [hook, ledger, quote, metadataHash, compositionHash, FOUNDATION_LP_CUSTODY_DEAD_ID, parameters.initialBuyQuoteAmount, currentResult()]),
  });
  const mintLog = (id: bigint, from = v2Address(0), to = FOUNDATION_DEAD_ADDRESS) => ({ ...commonLog,
    address: FOUNDATION_INFRASTRUCTURE.positionManager.address, logIndex: Number(id), data: "0x" as Hex,
    topics: encodeEventTopics({ abi: foundationPositionAbi, eventName: "Transfer", args: { from, to, id } }) });
  const getBlock = vi.fn(async () => ({ number: 100n, hash: checkpoint.blockHash, timestamp: checkpoint.timestamp }));
  const getTransactionReceipt = vi.fn(async () => ({ status: "success", transactionHash, blockNumber: 100n, blockHash: checkpoint.blockHash,
    from: account, to: factory, transactionIndex: 2, logs: [launchLog(), ...specs.map(spec => mintLog(spec.id))] }));
  const getTransaction = vi.fn(async () => ({ hash: transactionHash, from: account, to: factory, input: transaction.data, value: 0n,
    blockNumber: 100n, blockHash: checkpoint.blockHash, transactionIndex: 2, chainId: 4663 }));
  const simulateCalls = vi.fn(async ({ calls }: { calls: readonly { to: Address; data: Hex }[] }) => {
    let launched = false;
    return { results: calls.map(call => {
      let data: Hex;
      if (call.to === factory) { launched = true; data = encodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launch", result: currentResult() }); }
      else if (call.to === FOUNDATION_INFRASTRUCTURE.positionManager.address) data = nftData(call.data);
      else {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
        if (decoded.functionName !== "balanceOf") throw new Error("Unexpected simulated method");
        const recipient = getAddress(decoded.args[0]);
        const balance = call.to === quote ? recipient === factory ? state.factoryQuoteAfter
          : 1_000_000_000n + (launched ? currentResult().actualQuoteRefund - parameters.initialBuyQuoteAmount - additional + state.quoteDeltaAdjustment : 0n)
          : recipient === account ? (launched ? currentResult().initialBuyTokenAmount : 0n)
            : recipient === factory ? state.factoryTokenAfter : state.inventoryBalance;
        data = encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: balance });
      }
      return { status: "success" as const, data, gasUsed: 100n };
    }) };
  });
  const client = { getChainId: vi.fn(async () => state.chainId), readContract, getBlock, getTransactionReceipt, getTransaction,
    getCode: vi.fn(async ({ address }: { address: Address }) => state.newToken && address === token ? "0x" : v2Code),
    call: vi.fn(async ({ to, data }: { to: Address; data: Hex }) => {
      if (to !== FOUNDATION_INFRASTRUCTURE.positionManager.address) throw new Error("Unexpected call target");
      return { data: nftData(data) };
    }), simulateCalls, getLogs: vi.fn(async () => [launchLog()]),
  };
  return { client: client as unknown as PublicClient, methods: client, state, binding, checkpoint, parameters, result, price,
    steps, checks, token, quote, account, factory, hook, ledger, pool: { token, quote, hook, poolId }, key, metadataHash,
    expected: { transaction, parameters, result: { ...result }, metadataHash }, transactionHash, launchLog, mintLog };
}
