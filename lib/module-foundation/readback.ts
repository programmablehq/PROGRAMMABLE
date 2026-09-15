import {
  BaseError, ContractFunctionRevertedError, decodeEventLog, decodeFunctionResult, encodeAbiParameters,
  encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, parseAbiParameters, toEventSelector,
  type Address, type Hex, type PublicClient,
} from "viem";
import {
  foundationFactoryAbi, foundationHookAbi, foundationMetadataParameters, foundationTokenAbi,
  type FoundationLaunchParameters, type FoundationLaunchResult,
} from "./abi";
import {
  assertFoundationInfrastructure, assertFoundationPool, readFoundationQuote,
  type FoundationCheckpoint, type FoundationDeploymentBinding, type FoundationPreparedStep, type FoundationTransaction,
} from "./client";
import {
  FOUNDATION_ABI_ID, FOUNDATION_INFRASTRUCTURE, FOUNDATION_INT128_MAX, FOUNDATION_PLATFORM_BPS,
  FOUNDATION_PLATFORM_RECIPIENT, FOUNDATION_SUPPLY, FOUNDATION_TICK_SPACING, foundationCreatorFeeBps,
} from "./constants";
import { FOUNDATION_MAX_TICK, FOUNDATION_MIN_TICK } from "./price";
import { foundationPoolId, type FoundationPool } from "./route";

// These additions follow contracts/src/module-foundation and the pinned PositionManager's PositionInfoLibrary.
export const foundationReadbackAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "struct ModuleContext { address host; address token; address quote; address creator; address ledger; bytes32 poolId; }",
  "function initialTick() view returns (int24)",
  "function compositionHash() view returns (bytes32)",
  "function moduleCount() view returns (uint256)",
  "function moduleAt(uint256 index) view returns (Module)",
  "function context() view returns (ModuleContext)",
  "function configurationHash() view returns (bytes32)",
  "function poolManager() view returns (address)",
  "function hook() view returns (address)",
  "function quote() view returns (address)",
  "function creator() view returns (address)",
  "function positionManager() view returns (address)",
  "function positionManagerCodeHash() view returns (bytes32)",
  "function positionId() view returns (uint256)",
  "function beneficiary() view returns (address)",
  "function ownerOf(uint256 id) view returns (address)",
  "function getApproved(uint256 id) view returns (address)",
  "function getPoolAndPositionInfo(uint256 id) view returns (PoolKey poolKey,uint256 info)",
  "function getPositionLiquidity(uint256 id) view returns (uint128)",
  "function platformReceived() view returns (uint256)",
  "function platformClaimed() view returns (uint256)",
  "function creatorReceived() view returns (uint256)",
  "function creatorCredited() view returns (uint256)",
  "function creatorClaimed() view returns (uint256)",
  "function moduleClaimedTotal() view returns (uint256)",
  "function creatorShareBps() view returns (uint16)",
  "function moduleShareBps(address module) view returns (uint16)",
  "function moduleCredited(address module) view returns (uint256)",
  "function moduleClaimed(address module) view returns (uint256)",
  "function outstandingBacking() view returns (uint256)",
  "function unallocatedCreatorDust() view returns (uint256)",
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "event FoundationLaunched(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,address baseVault,uint256 basePositionId,uint256 creatorPositionId,bytes32 metadataHash,bytes32 compositionHash,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount)",
  "event FoundationSwap(bytes32 indexed poolId,address indexed router,bool buy,bool exactInput,uint256 grossQuote,uint256 platformQuote,uint256 creatorQuote,int128 coreAmount0,int128 coreAmount1)",
]);

export interface FoundationFeeCarry { platform: number; creator: number }
export interface FoundationPositionReadback {
  positionId: bigint;
  status: "active" | "closed";
  owner: Address | null;
  tickLower: number | null;
  tickUpper: number | null;
  liquidity: bigint;
}

const sameAddress = (a: Address, b: Address) => getAddress(a) === getAddress(b);
const sameHex = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
const min = (a: bigint, b: bigint) => a < b ? a : b;
const descriptorParameters = parseAbiParameters("(bytes32 moduleId,uint16 abiVersion,uint8 phases,uint8 resources,uint32 beforeGas,uint32 afterGas,uint32 actionGas,bool failOpenAfter,bytes32 exclusiveGroup)");
const selectionsParameters = parseAbiParameters("bytes32,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[]");
const launchTopic = toEventSelector("FoundationLaunched(address,address,bytes32,address,address,address,address,uint256,uint256,bytes32,bytes32,uint256,uint256)");
const swapTopic = toEventSelector("FoundationSwap(bytes32,address,bool,bool,uint256,uint256,uint256,int128,int128)");

async function assertCanonical(client: PublicClient, checkpoint: FoundationCheckpoint) {
  const current = await client.getBlock({ blockNumber: checkpoint.blockNumber });
  if (current.number !== checkpoint.blockNumber || !current.hash || !sameHex(current.hash, checkpoint.blockHash)) {
    throw new Error("The readback block is no longer canonical. Refresh the chain state.");
  }
}

/** Exact carry arithmetic for an explicitly known gross amount. A net amount does not identify a unique gross. */
export function foundationFeesFromGross(grossQuote: bigint, creatorFeeBps: number, carry: FoundationFeeCarry) {
  foundationCreatorFeeBps(creatorFeeBps);
  if (grossQuote <= 0n || grossQuote > FOUNDATION_INT128_MAX
    || [carry.platform, carry.creator].some(value => !Number.isInteger(value) || value < 0 || value >= 10_000)) {
    throw new Error("Invalid gross quote amount or fee carry.");
  }
  const platform = grossQuote * BigInt(FOUNDATION_PLATFORM_BPS) + BigInt(carry.platform);
  const creator = grossQuote * BigInt(creatorFeeBps) + BigInt(carry.creator);
  const platformQuote = platform / 10_000n, creatorQuote = creator / 10_000n;
  const netQuote = grossQuote - platformQuote - creatorQuote;
  return { grossQuote, platformQuote, creatorQuote, totalQuote: platformQuote + creatorQuote, netQuote,
    positiveNet: netQuote > 0n,
    nextCarry: { platform: Number(platform % 10_000n), creator: Number(creator % 10_000n) } };
}

function budget(credited: bigint, claimed: bigint) {
  if (credited < claimed) throw new Error("A fee budget reports claims exceeding its credits.");
  const outstanding = credited - claimed;
  // One withdrawal is bounded to int128 by FoundationLedgerV1; larger budgets require several claims.
  return { credited, claimed, outstanding, withdrawable: min(outstanding, FOUNDATION_INT128_MAX) };
}

function isBurnedOwnerError(error: unknown) {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk(item => item instanceof ContractFunctionRevertedError);
  return cause instanceof ContractFunctionRevertedError && (cause.reason === "NOT_MINTED"
    || (cause.data?.errorName === "Error" && cause.data.args?.[0] === "NOT_MINTED"));
}

async function readPosition(client: PublicClient, id: bigint, pool: FoundationPool, blockNumber: bigint,
  expectedTicks: readonly [number, number], fixedOwner?: Address): Promise<FoundationPositionReadback> {
  const address = FOUNDATION_INFRASTRUCTURE.positionManager.address;
  const [position, liquidity, owner] = await Promise.all([
    client.readContract({ address, abi: foundationReadbackAbi, functionName: "getPoolAndPositionInfo", args: [id], blockNumber }),
    client.readContract({ address, abi: foundationReadbackAbi, functionName: "getPositionLiquidity", args: [id], blockNumber }),
    client.readContract({ address, abi: foundationReadbackAbi, functionName: "ownerOf", args: [id], blockNumber })
      .then(value => ({ value, error: null }), error => ({ value: null, error: error as unknown })),
  ]);
  const [key, info] = position;
  if (owner.error) {
    // The pinned PM clears PositionInfo when burning. A transport failure is never reported as a closed NFT.
    if (!fixedOwner && isBurnedOwnerError(owner.error) && info === 0n && liquidity === 0n
      && BigInt(key.currency0) === 0n && BigInt(key.currency1) === 0n && BigInt(key.hooks) === 0n
      && key.fee === 0 && key.tickSpacing === 0) {
      return { positionId: id, status: "closed", owner: null, tickLower: null, tickUpper: null, liquidity: 0n };
    }
    throw owner.error;
  }
  const tickLower = Number(BigInt.asIntN(24, info >> 8n));
  const tickUpper = Number(BigInt.asIntN(24, info >> 32n));
  if (!owner.value || BigInt(owner.value) === 0n || (fixedOwner && !sameAddress(owner.value, fixedOwner))) {
    throw new Error("The base position NFT is not owned by its permanent vault.");
  }
  if (!sameHex(foundationPoolId(key), pool.poolId) || (info >> 56n) !== (BigInt(pool.poolId) >> 56n)
    || tickLower !== expectedTicks[0] || tickUpper !== expectedTicks[1]) {
    throw new Error("A launch position belongs to a foreign pool or different tick range.");
  }
  if (fixedOwner) {
    const approved = await client.readContract({ address, abi: foundationReadbackAbi, functionName: "getApproved", args: [id], blockNumber });
    if (BigInt(approved) !== 0n || liquidity === 0n) throw new Error("The permanent base position has an unexpected approval or no liquidity.");
  }
  return { positionId: id, status: "active", owner: getAddress(owner.value), tickLower, tickUpper, liquidity };
}

/** Current source-bound pool facts at one canonical block. Metadata remains untrusted display content. */
export async function readFoundationPoolDetails(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; token: Address; blockNumber?: bigint; account?: Address;
}) {
  const { client, binding } = input;
  const checkpoint = await assertFoundationInfrastructure(client, binding, input.blockNumber);
  const blockNumber = checkpoint.blockNumber, token = getAddress(input.token);
  const record = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi,
    functionName: "launchOf", args: [token], blockNumber });
  if (!sameAddress(record.token, token) || BigInt(record.token) === 0n || BigInt(record.hook) === 0n) {
    throw new Error("This token is not registered by the selected foundation factory.");
  }
  const quoteAddress = await client.readContract({ address: record.hook, abi: foundationHookAbi, functionName: "quote", blockNumber });
  const pool: FoundationPool = { token, quote: getAddress(quoteAddress), hook: getAddress(record.hook), poolId: record.poolId };
  const provenance = await assertFoundationPool(client, binding, pool, blockNumber);
  const hook = pool.hook, ledger = record.ledger, vault = record.baseVault;
  const [name, symbol, decimals, totalSupply, metadataValues, metadataHash, quote, initialTick, compositionHash,
    moduleCount, buyCarry, sellCarry, slot0, activeLiquidity, tokenBalance, vaultTokenBalance] = await Promise.all([
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "name", blockNumber }),
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "symbol", blockNumber }),
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "decimals", blockNumber }),
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "totalSupply", blockNumber }),
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "metadata", blockNumber }),
    client.readContract({ address: token, abi: foundationTokenAbi, functionName: "metadataHash", blockNumber }),
    readFoundationQuote(client, pool.quote, input.account, blockNumber),
    client.readContract({ address: hook, abi: foundationReadbackAbi, functionName: "initialTick", blockNumber }),
    client.readContract({ address: hook, abi: foundationReadbackAbi, functionName: "compositionHash", blockNumber }),
    client.readContract({ address: hook, abi: foundationReadbackAbi, functionName: "moduleCount", blockNumber }),
    client.readContract({ address: hook, abi: foundationHookAbi, functionName: "feeCarry", args: [true], blockNumber }),
    client.readContract({ address: hook, abi: foundationHookAbi, functionName: "feeCarry", args: [false], blockNumber }),
    client.readContract({ address: FOUNDATION_INFRASTRUCTURE.stateView.address, abi: foundationReadbackAbi, functionName: "getSlot0", args: [pool.poolId], blockNumber }),
    client.readContract({ address: FOUNDATION_INFRASTRUCTURE.stateView.address, abi: foundationReadbackAbi, functionName: "getLiquidity", args: [pool.poolId], blockNumber }),
    input.account ? client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [input.account], blockNumber }) : Promise.resolve(null),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault], blockNumber }),
  ]);
  const metadata = { name, symbol, description: metadataValues[0], imageURI: metadataValues[2], website: metadataValues[1], socialData: metadataValues[3] };
  if (!sameHex(keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata])), metadataHash)) {
    throw new Error("The token metadata does not match its bound metadataHash.");
  }
  if (decimals !== 18 || totalSupply > FOUNDATION_SUPPLY || moduleCount > 8n
    || initialTick <= FOUNDATION_MIN_TICK || initialTick >= FOUNDATION_MAX_TICK || initialTick % FOUNDATION_TICK_SPACING !== 0
    || slot0[0] === 0n || slot0[3] !== 0) throw new Error("The pool does not match this foundation's fixed configuration.");
  const token0 = sameAddress(token, provenance.key.currency0);
  const baseTicks = (token0 ? [initialTick, FOUNDATION_MAX_TICK] : [FOUNDATION_MIN_TICK, initialTick]) as [number, number];
  const creatorTicks = (token0 ? [FOUNDATION_MIN_TICK, initialTick] : [initialTick, FOUNDATION_MAX_TICK]) as [number, number];
  const [basePosition, creatorPosition, ledgerManager, ledgerHook, ledgerQuote, ledgerCreator,
    vaultManager, vaultManagerHash, vaultId, vaultBeneficiary, platformReceived, platformClaimed,
    creatorReceived, creatorCredited, creatorClaimed, moduleClaimedTotal, creatorShareBps, outstandingBacking,
    unallocatedCreatorDust, claimBacking, modules] = await Promise.all([
    readPosition(client, record.basePositionId, pool, blockNumber, baseTicks, vault),
    record.creatorPositionId === 0n ? Promise.resolve(null) : readPosition(client, record.creatorPositionId, pool, blockNumber, creatorTicks),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "poolManager", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "hook", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "quote", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "creator", blockNumber }),
    client.readContract({ address: vault, abi: foundationReadbackAbi, functionName: "positionManager", blockNumber }),
    client.readContract({ address: vault, abi: foundationReadbackAbi, functionName: "positionManagerCodeHash", blockNumber }),
    client.readContract({ address: vault, abi: foundationReadbackAbi, functionName: "positionId", blockNumber }),
    client.readContract({ address: vault, abi: foundationReadbackAbi, functionName: "beneficiary", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "platformReceived", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "platformClaimed", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "creatorReceived", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "creatorCredited", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "creatorClaimed", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "moduleClaimedTotal", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "creatorShareBps", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "outstandingBacking", blockNumber }),
    client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "unallocatedCreatorDust", blockNumber }),
    client.readContract({ address: FOUNDATION_INFRASTRUCTURE.poolManager.address, abi: foundationReadbackAbi,
      functionName: "balanceOf", args: [ledger, BigInt(pool.quote)], blockNumber }),
    Promise.all(Array.from({ length: Number(moduleCount) }, async (_, index) => {
      const { instance, codeHash, configurationHash, descriptor } = await client.readContract({ address: hook,
        abi: foundationReadbackAbi, functionName: "moduleAt", args: [BigInt(index)], blockNumber });
      const [integrityReads, shareBps, credited, claimed] = await Promise.all([
        Promise.allSettled([
          client.getCode({ address: instance, blockNumber }),
          client.readContract({ address: instance, abi: foundationReadbackAbi, functionName: "context", blockNumber }),
          client.readContract({ address: instance, abi: foundationReadbackAbi, functionName: "configurationHash", blockNumber }),
        ]),
        client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "moduleShareBps", args: [instance], blockNumber }),
        client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "moduleCredited", args: [instance], blockNumber }),
        client.readContract({ address: ledger, abi: foundationReadbackAbi, functionName: "moduleClaimed", args: [instance], blockNumber }),
      ]);
      const [codeRead, contextRead, configRead] = integrityReads;
      const context = contextRead.status === "fulfilled" ? contextRead.value : null;
      // Module failures must not hide independent platform or creator claim balances.
      const integrity = {
        codeMatches: codeRead.status === "fulfilled" ? !!codeRead.value && codeRead.value !== "0x" && sameHex(keccak256(codeRead.value), codeHash) : null,
        configurationMatches: configRead.status === "fulfilled" ? sameHex(configRead.value, configurationHash) : null,
        contextMatches: context ? sameAddress(context.host, hook) && sameAddress(context.token, token) && sameAddress(context.quote, pool.quote)
          && sameAddress(context.creator, provenance.creator) && sameAddress(context.ledger, ledger) && sameHex(context.poolId, pool.poolId) : null,
      };
      return { index, instance: getAddress(instance), codeHash, configurationHash, descriptor,
        descriptorHash: keccak256(encodeAbiParameters(descriptorParameters, [descriptor])),
        shareBps, ...budget(credited, claimed), integrity, withdrawal: "own-active-module-action" as const };
    })),
  ]);
  if (!sameAddress(ledgerManager, FOUNDATION_INFRASTRUCTURE.poolManager.address) || !sameAddress(ledgerHook, hook)
    || !sameAddress(ledgerQuote, pool.quote) || !sameAddress(ledgerCreator, provenance.creator)
    || !sameAddress(vaultManager, FOUNDATION_INFRASTRUCTURE.positionManager.address)
    || !sameHex(vaultManagerHash, FOUNDATION_INFRASTRUCTURE.positionManager.runtimeCodeHash)
    || vaultId !== record.basePositionId || !sameAddress(vaultBeneficiary, provenance.creator)) {
    throw new Error("The quote ledger or permanent vault has a foreign binding.");
  }
  const platform = budget(platformReceived, platformClaimed), creator = budget(creatorCredited, creatorClaimed);
  const moduleCredits = modules.reduce((sum, module) => sum + module.credited, 0n);
  const moduleClaims = modules.reduce((sum, module) => sum + module.claimed, 0n);
  if (creatorShareBps + modules.reduce((sum, module) => sum + module.shareBps, 0) !== 10_000
    || creatorCredited !== creatorReceived * BigInt(creatorShareBps) / 10_000n
    || modules.some(module => module.credited !== creatorReceived * BigInt(module.shareBps) / 10_000n)
    || creatorReceived - creatorCredited - moduleCredits !== unallocatedCreatorDust
    || moduleClaims !== moduleClaimedTotal || platformReceived + creatorReceived - platformClaimed - creatorClaimed - moduleClaims !== outstandingBacking
    || outstandingBacking < 0n || claimBacking < outstandingBacking) throw new Error("The quote fee ledger is inconsistent or under-backed.");
  await assertCanonical(client, checkpoint);
  return {
    evidence: "canonical-readback" as const, checkpoint, binding, record, pool, key: provenance.key,
    creator: getAddress(provenance.creator), creatorFeeBps: provenance.creatorFeeBps, compositionHash, initialTick,
    token: { address: token, ...metadata, decimals, totalSupply, originalSupply: FOUNDATION_SUPPLY, metadataHash, balance: tokenBalance },
    quote, market: { sqrtPriceX96: slot0[0], tick: slot0[1], protocolFee: slot0[2], lpFee: slot0[3], activeLiquidity },
    positions: { base: { ...basePosition, vault: getAddress(vault), beneficiary: getAddress(vaultBeneficiary), roundingInventory: vaultTokenBalance }, creator: creatorPosition },
    ledger: { address: getAddress(ledger), quote: pool.quote, claimBacking, outstandingBacking, unallocatedCreatorDust,
      platform: { ...platform, received: platformReceived, beneficiary: FOUNDATION_PLATFORM_RECIPIENT, bps: FOUNDATION_PLATFORM_BPS },
      creator: { ...creator, received: creatorReceived, beneficiary: getAddress(provenance.creator), shareBps: creatorShareBps },
      moduleClaimedTotal, modules },
    feeCarry: { buy: { platform: buyCarry[0], creator: buyCarry[1] }, sell: { platform: sellCarry[0], creator: sellCarry[1] } },
  };
}

export type FoundationPoolDetails = Awaited<ReturnType<typeof readFoundationPoolDetails>>;

export interface FoundationExpectedLaunch {
  transaction: FoundationTransaction;
  parameters: FoundationLaunchParameters;
  result: FoundationLaunchResult;
  metadataHash: Hex;
}

/** Verifies inclusion and exact intent against the canonical receipt block, without claiming finality. */
export async function verifyFoundationLaunchReceipt(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; transactionHash: Hex; expected: FoundationExpectedLaunch;
}) {
  const { client, binding, expected, transactionHash } = input;
  const planned = expected.transaction, p = expected.parameters;
  if (!sameAddress(planned.to, binding.factory.address) || planned.value !== 0n
    || !sameHex(planned.data, encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [p] }))
    || !sameHex(expected.metadataHash, keccak256(encodeAbiParameters(foundationMetadataParameters, [p.metadata])))) {
    throw new Error("The expected launch transaction or metadata does not match its reviewed parameters.");
  }
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: transactionHash }), client.getTransaction({ hash: transactionHash }),
  ]);
  if (receipt.status !== "success" || !sameHex(receipt.transactionHash, transactionHash) || !sameHex(transaction.hash, transactionHash)
    || !receipt.to || !transaction.to || !sameAddress(receipt.to, binding.factory.address) || !sameAddress(transaction.to, planned.to)
    || !sameAddress(receipt.from, planned.from) || !sameAddress(transaction.from, planned.from)
    || !sameHex(transaction.input, planned.data) || transaction.value !== planned.value
    || transaction.blockNumber !== receipt.blockNumber || !transaction.blockHash || !sameHex(transaction.blockHash, receipt.blockHash)
    || transaction.transactionIndex !== receipt.transactionIndex) {
    throw new Error("The mined transaction does not match the expected factory launch.");
  }
  const candidates = receipt.logs.filter(log => sameAddress(log.address, binding.factory.address) && log.topics[0]
    && sameHex(log.topics[0], launchTopic));
  if (candidates.length !== 1) throw new Error("The receipt must contain exactly one launch event emitted by the expected factory.");
  const log = candidates[0];
  if (log.removed || log.blockNumber !== receipt.blockNumber || !log.blockHash || !sameHex(log.blockHash, receipt.blockHash)
    || !log.transactionHash || !sameHex(log.transactionHash, transactionHash) || log.transactionIndex !== receipt.transactionIndex || log.logIndex === null) {
    throw new Error("The launch event is not bound to this canonical receipt.");
  }
  const event = decodeEventLog({ abi: foundationReadbackAbi, eventName: "FoundationLaunched", data: log.data, topics: log.topics, strict: true }).args;
  const r = expected.result;
  if (!sameAddress(event.token, r.token) || !sameAddress(event.creator, planned.from) || !sameHex(event.poolId, r.poolId)
    || !sameAddress(event.hook, r.hook) || !sameAddress(event.ledger, r.ledger) || !sameAddress(event.quote, p.quote)
    || BigInt(event.baseVault) === 0n || event.basePositionId === 0n
    || !sameHex(event.metadataHash, expected.metadataHash) || !sameHex(event.compositionHash, keccak256(encodeAbiParameters(selectionsParameters, [FOUNDATION_ABI_ID, p.modules])))
    || event.initialBuyQuoteAmount !== p.initialBuyQuoteAmount || event.initialBuyTokenAmount < p.initialBuyMinimumTokenAmount
    || (p.initialBuyQuoteAmount === 0n && event.initialBuyTokenAmount !== 0n)
    || (p.additionalQuoteAmount > 0n) !== (event.creatorPositionId > 0n)) {
    throw new Error("The launch event differs from the expected metadata, pool, positions or funding.");
  }
  const details = await readFoundationPoolDetails({ client, binding, token: r.token, blockNumber: receipt.blockNumber });
  if (!sameHex(details.checkpoint.blockHash, receipt.blockHash) || !sameHex(details.token.metadataHash, event.metadataHash)
    || !sameAddress(details.creator, planned.from) || details.initialTick !== p.initialTick || details.creatorFeeBps !== p.creatorFeeBps
    || !sameAddress(details.pool.quote, event.quote) || !sameAddress(details.record.hook, event.hook)
    || !sameAddress(details.record.ledger, event.ledger) || !sameAddress(details.record.baseVault, event.baseVault)
    || !sameHex(details.record.poolId, event.poolId) || !sameHex(details.compositionHash, event.compositionHash)
    || details.record.basePositionId !== event.basePositionId || details.record.creatorPositionId !== event.creatorPositionId
    || details.record.initialBuyTokenAmount !== event.initialBuyTokenAmount) {
    throw new Error("The launch receipt disagrees with canonical factory and token state.");
  }
  return { evidence: "canonical-receipt" as const, transactionHash, checkpoint: details.checkpoint,
    transactionIndex: receipt.transactionIndex, logIndex: log.logIndex, event, details };
}

/** Real cumulative ledger deltas in ephemeral state; available swap logs additionally identify actual gross amounts. */
export async function simulateFoundationTradeFees(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; pool: FoundationPool;
  steps: readonly FoundationPreparedStep[]; checkpoint: FoundationCheckpoint;
}) {
  const { client, binding, pool, steps, checkpoint } = input;
  if (steps.length === 0 || steps.length > 8 || !steps.some(step => step.kind === "buy" || step.kind === "sell")
    || steps.some(step => !["approve", "buy", "sell"].includes(step.kind))) throw new Error("An approval and trade sequence is required.");
  const account = steps[0].transaction.from;
  if (steps.some(step => !sameAddress(step.transaction.from, account))) throw new Error("A fee simulation must have one payer.");
  const observed = await assertFoundationInfrastructure(client, binding, checkpoint.blockNumber);
  if (!sameHex(observed.blockHash, checkpoint.blockHash)) throw new Error("The simulation checkpoint is no longer canonical.");
  const { record, creatorFeeBps } = await assertFoundationPool(client, binding, pool, checkpoint.blockNumber);
  const counters = ["platformReceived", "creatorReceived"] as const;
  const reads = counters.map(functionName => ({ to: record.ledger, data: encodeFunctionData({ abi: foundationReadbackAbi, functionName }) }));
  const [buy, sell] = await Promise.all([true, false].map(direction => client.readContract({ address: pool.hook,
    abi: foundationHookAbi, functionName: "feeCarry", args: [direction], blockNumber: checkpoint.blockNumber })));
  const simulation = await client.simulateCalls({ account, blockNumber: checkpoint.blockNumber,
    calls: [...reads, ...steps.map(step => ({ to: step.transaction.to, data: step.transaction.data, value: step.transaction.value })), ...reads] });
  if (simulation.results.length !== steps.length + 4 || simulation.results.some(result => result.status !== "success")) {
    throw new Error("The complete fee simulation did not succeed.");
  }
  const counterAt = (index: number, functionName: typeof counters[number]) =>
    decodeFunctionResult({ abi: foundationReadbackAbi, functionName, data: simulation.results[index].data });
  const platformQuote = counterAt(steps.length + 2, "platformReceived") - counterAt(0, "platformReceived");
  const creatorQuote = counterAt(steps.length + 3, "creatorReceived") - counterAt(1, "creatorReceived");
  if (platformQuote < 0n || creatorQuote < 0n) throw new Error("A cumulative fee counter decreased during simulation.");
  const operations = simulation.results.slice(2, -2);
  operations.forEach((result, index) => {
    if (steps[index].kind === "approve" && /^0x0{64}$/.test(result.data)) throw new Error("The token rejected its approval.");
  });
  const carries = { buy: { platform: buy[0], creator: buy[1] }, sell: { platform: sell[0], creator: sell[1] } };
  const swaps = operations.flatMap(result => (result.logs ?? []).filter(log => sameAddress(log.address, pool.hook)
    && log.topics[0] && sameHex(log.topics[0], swapTopic)).map(log => {
    const event = decodeEventLog({ abi: foundationReadbackAbi, eventName: "FoundationSwap", data: log.data, topics: log.topics, strict: true }).args;
    if (!sameHex(event.poolId, pool.poolId)) throw new Error("The simulated fee event belongs to a foreign pool.");
    const side = event.buy ? "buy" : "sell";
    const fees = foundationFeesFromGross(event.grossQuote, creatorFeeBps, carries[side]);
    if (!fees.positiveNet || fees.platformQuote !== event.platformQuote || fees.creatorQuote !== event.creatorQuote) {
      throw new Error("The simulated swap fees disagree with the bound carry arithmetic.");
    }
    carries[side] = fees.nextCarry;
    return { ...event, side };
  }));
  const logsComplete = operations.every(result => result.logs !== undefined);
  if ((logsComplete || swaps.length > 0) && (swaps.length === 0
    || swaps.reduce((sum, swap) => sum + swap.platformQuote, 0n) !== platformQuote
    || swaps.reduce((sum, swap) => sum + swap.creatorQuote, 0n) !== creatorQuote)) {
    throw new Error("The swap events do not reconcile with the actual quote ledger delta.");
  }
  await assertCanonical(client, checkpoint);
  return { evidence: "simulated-ledger-delta" as const, checkpoint, pool, ledger: record.ledger,
    quote: pool.quote, platformRecipient: FOUNDATION_PLATFORM_RECIPIENT, platformBps: FOUNDATION_PLATFORM_BPS,
    creatorFeeBps, platformQuote, creatorQuote, totalQuote: platformQuote + creatorQuote,
    grossQuote: swaps.length > 0 ? swaps.reduce((sum, swap) => sum + swap.grossQuote, 0n) : null,
    grossEvidence: swaps.length > 0 ? "canonical-hook-swap-events" as const : null, swaps,
    nextCarry: logsComplete ? carries : null };
}
