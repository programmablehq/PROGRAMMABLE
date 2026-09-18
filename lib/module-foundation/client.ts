import { foundationFactoryNativeAbi } from "./abi";
import { assertFoundationAtomicEth, assertFoundationLaunchCall, type FoundationEthFunding } from "./atomic-launch";
import {
  createPublicClient, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi,
  fallback, getAddress, getCreate2Address, http, keccak256, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { assertFoundationNativeBalance, assertFoundationWrapRuntime, foundationWrappedAmount, prepareFoundationNativeFunding } from "./native-funding";
import { robinhoodChain } from "@/lib/chains";
import { hasUnsafeDisplayCharacters, isValidTokenSymbol, MAX_METADATA_URL_BYTES, MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { moduleTokenMetadata, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { foundationFactoryV2Abi, foundationHookAbi, foundationLedgerAbi, foundationMetadataParameters, foundationPermit2Abi, foundationQuoterAbi, foundationTokenAbi,
  type FoundationContractModule, type FoundationLaunchParameters, type FoundationLaunchRecord, type FoundationMetadata } from "./abi";
import { FOUNDATION_ABI_ID, FOUNDATION_CHAIN_ID, foundationCreatorFeeBps, FOUNDATION_INFRASTRUCTURE,
  FOUNDATION_INT128_MAX, FOUNDATION_PLATFORM_RECIPIENT, FOUNDATION_ZERO_HASH, FOUNDATION_DEAD_ADDRESS, FOUNDATION_FACTORY_V2_ID, FOUNDATION_LP_CUSTODY_DEAD_ID } from "./constants";
import { foundationParseAmount, planFoundationPrice } from "./price";
import { parseFoundationStartPrice, planFoundationStartPrice, type FoundationStartPrice } from "./start-price";
import { buildFoundationExactInput, foundationPoolId, foundationPoolKey, type FoundationPool } from "./route";
import type { FoundationPrepareModuleActionInputV1 } from "./action-runtime";
import { readFoundationAssetPins, readFoundationModulePackages, withFoundationModulePackages } from "./metadata";
import { refreshFoundationAssetsV1, type FoundationAssetPinV1 } from "./assets";
import type { FoundationCatalogV1 } from "./catalog";
import type { FoundationModuleSelection } from "./ui-types";
import type { OpenConfigContext } from "@/packages/classic-modules/src/open-config.mjs";
import { assertFoundationV2Result, decodeFoundationLaunchResult, foundationFactoryAbiFor, foundationFactoryVersion, readFoundationLaunchRecord, readFoundationV2Positions,
  foundationV2PositionCalls, foundationV2PositionSpecs, verifyFoundationV2PositionData, type FoundationDeploymentBinding } from "./protocol";
export type { FoundationDeploymentBinding } from "./protocol";

export function createFoundationClient(): PublicClient {
  return createPublicClient({ chain: robinhoodChain, transport: fallback([
    http("https://rpc-robinhood.blockmachine.io", { timeout: 20_000, retryCount: 0 }),
    http("https://rpc.mainnet.chain.robinhood.com", { timeout: 20_000, retryCount: 0 }),
  ], { rank: false, retryCount: 0 }), batch: { multicall: false } });
}

export interface FoundationTransaction {
  from: Address; to: Address; data: Hex; value: bigint;
}
export interface FoundationPreparedStep {
  label: string; kind: "wrap" | "approve" | "launch" | "buy" | "sell" | "claim" | "module-action";
  transaction: FoundationTransaction; gasUsed: bigint;
  effect: string; spender?: Address; amount?: bigint;
}
export interface FoundationCheckpoint { blockNumber: bigint; blockHash: Hex; timestamp: bigint }
export interface FoundationBalanceCheck { token: Address; account: Address; delta?: bigint; minimumDelta?: bigint; newToken?: boolean }

const preparedSequences = new WeakSet<object>();
function sealFoundationSequence<T extends object>(value: T): T {
  const snapshot = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== "object" || Object.isFrozen(node)) return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  };
  freeze(snapshot);
  preparedSequences.add(snapshot);
  return snapshot;
}
/** Only this SDK's successful, privately recorded simulation can enter the wallet boundary. */
export function assertFoundationPreparedSequence(value: object): void {
  if (!preparedSequences.has(value)) throw new Error("Prepare and simulate this operation before continuing in the wallet.");
}

/** Only the successful source, role and RPC action validator may create a wallet-capable action. */
export async function prepareFoundationModuleAction(input: FoundationPrepareModuleActionInputV1) {
  const { prepareFoundationModuleActionV1 } = await import("./action-runtime");
  return sealFoundationSequence(await prepareFoundationModuleActionV1(input));
}

export async function assertFoundationInfrastructure(client: PublicClient, binding: FoundationDeploymentBinding, blockNumber?: bigint): Promise<FoundationCheckpoint> {
  const factoryVersion = foundationFactoryVersion(binding), factoryAbi = foundationFactoryAbiFor(binding);
  if (await client.getChainId() !== FOUNDATION_CHAIN_ID) throw new Error("The RPC is connected to a different network.");
  const block = await client.getBlock(blockNumber === undefined ? { blockTag: "latest" } : { blockNumber });
  if (block.number === null || !block.hash || block.number < binding.startBlock
    || (blockNumber === undefined && Math.abs(Date.now() / 1_000 - Number(block.timestamp)) > 120)) {
    throw new Error("Current source-bound chain state is unavailable.");
  }
  const pins = [...Object.entries(FOUNDATION_INFRASTRUCTURE), ["factory", binding.factory], ["hookDeployer", binding.hookDeployer]] as const;
  await Promise.all(pins.map(async ([role, pin]) => {
    const code = await client.getCode({ address: pin.address, blockNumber: block.number! });
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== pin.runtimeCodeHash.toLowerCase()) throw new Error(`The ${role} runtime does not match this release.`);
  }));
  const version = await client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: "VERSION_ID", blockNumber: block.number });
  if (version.toLowerCase() !== (factoryVersion === "v2" ? FOUNDATION_FACTORY_V2_ID : FOUNDATION_ABI_ID).toLowerCase()) throw new Error("This factory uses a different reviewed factory version.");
  if (factoryVersion === "v2") {
    const [moduleAbi, custody, recipient, roundingRecipient, fee] = await Promise.all([
      client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "MODULE_ABI_ID", blockNumber: block.number }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "LP_CUSTODY_ID", blockNumber: block.number }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "LP_RECIPIENT", blockNumber: block.number }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "ROUNDING_INVENTORY_RECIPIENT", blockNumber: block.number }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "LP_FEE", blockNumber: block.number }),
    ]);
    if (moduleAbi !== FOUNDATION_ABI_ID || custody !== FOUNDATION_LP_CUSTODY_DEAD_ID || getAddress(recipient) !== FOUNDATION_DEAD_ADDRESS
      || getAddress(roundingRecipient) !== FOUNDATION_DEAD_ADDRESS || fee !== 0) throw new Error("The V2 factory's irreversible LP custody or module interface is inconsistent.");
  }
  await Promise.all((["poolManager", "positionManager", "universalRouter", "permit2", "hookDeployer"] as const).map(async role => {
    const actual = await client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: role, blockNumber: block.number! });
    const expected = role === "hookDeployer" ? binding.hookDeployer.address : FOUNDATION_INFRASTRUCTURE[role].address;
    if (getAddress(actual) !== getAddress(expected)) throw new Error(`The factory's ${role} binding changed.`);
  }));
  return { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp };
}

export async function readFoundationQuote(client: PublicClient, raw: Address, account?: Address, blockNumber?: bigint) {
  const address = getAddress(raw);
  if (BigInt(address) <= 2n || Object.values(FOUNDATION_INFRASTRUCTURE).some(pin => pin.address === address)) throw new Error("Choose an ERC20 quote token.");
  const [code, name, symbol, decimals, totalSupply, balance] = await Promise.all([
    client.getCode({ address, blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "name", blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol", blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals", blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "totalSupply", blockNumber }),
    account ? client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [account], blockNumber }) : Promise.resolve(null),
  ]);
  if (!code || code === "0x" || decimals > 36 || totalSupply === 0n || utf8ByteLength(name) > 256 || utf8ByteLength(symbol) > 64
    || hasUnsafeDisplayCharacters(name) || hasUnsafeDisplayCharacters(symbol)) throw new Error("This quote token's metadata or decimals are unsupported.");
  return { address, name, symbol, decimals, codeHash: keccak256(code), balance,
    transferQualification: "exact-launch-simulation-required" as const };
}

/** Canonical factory registration, not a claimed pool key, establishes this source's guarantees. */
export async function assertFoundationPool(client: PublicClient, binding: FoundationDeploymentBinding, pool: FoundationPool, blockNumber: bigint) {
  const record = await readFoundationLaunchRecord(client, binding, getAddress(pool.token), blockNumber);
  if (BigInt(record.token) === 0n || getAddress(record.token) !== getAddress(pool.token)
    || getAddress(record.hook) !== getAddress(pool.hook) || record.poolId !== pool.poolId
    || BigInt(record.ledger) === 0n || (record.factoryVersion === "v1" && BigInt(record.baseVault) === 0n) || record.basePositionId === 0n) {
    throw new Error("This pool is not a launch from the selected foundation release.");
  }
  const [initializer, token, quote, ledger, poolId, key, creatorFeeBps, creator] = await Promise.all([
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "initializer", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "token", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "quote", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "ledger", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "poolId", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "poolKey", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "creatorFeeBps", blockNumber }),
    client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "creator", blockNumber }),
  ]);
  if (getAddress(initializer) !== getAddress(binding.factory.address) || getAddress(token) !== getAddress(pool.token)
    || getAddress(quote) !== getAddress(pool.quote) || getAddress(ledger) !== getAddress(record.ledger)
    || poolId !== pool.poolId || foundationPoolId(key) !== poolId
    || foundationPoolId(foundationPoolKey(pool)) !== poolId) throw new Error("The registered pool's onchain identity is inconsistent.");
  foundationCreatorFeeBps(creatorFeeBps);
  const positions = record.factoryVersion === "v2" ? await readFoundationV2Positions(client, record, pool.quote,
    await client.readContract({ address: pool.hook, abi: foundationHookAbi, functionName: "initialTick", blockNumber }), blockNumber) : undefined;
  return { record, key, creatorFeeBps, creator, positions };
}

export function foundationMetadata(input: { name: string; symbol: string; description: string; imageURI: string; socialLinks: ModuleSocialLinks;
  modulePackageIds?: readonly Hex[]; moduleAssetPins?: readonly FoundationAssetPinV1[] }): FoundationMetadata {
  if (!input.name.trim() || input.name !== input.name.trim() || utf8ByteLength(input.name) > MAX_TOKEN_NAME_BYTES
    || hasUnsafeDisplayCharacters(input.name) || !isValidTokenSymbol(input.symbol)
    || utf8ByteLength(input.description) > MAX_TOKEN_DESCRIPTION_BYTES || hasUnsafeDisplayCharacters(input.description)
    || utf8ByteLength(input.imageURI) > MAX_METADATA_URL_BYTES) throw new Error("Check the coin name, symbol and description.");
  const image = new URL(input.imageURI);
  if (image.protocol !== "https:" || image.username || image.password) throw new Error("A stored HTTPS image is required.");
  const data = moduleTokenMetadata(input.description, input.imageURI, input.socialLinks);
  return { name: input.name, symbol: input.symbol, description: data.description, imageURI: data.image, website: data.website,
    socialData: withFoundationModulePackages(data.extraData, input.modulePackageIds ?? [], input.moduleAssetPins ?? []) };
}

export async function mineFoundationHook(deployer: Address, initCodeHash: Hex, signal?: AbortSignal, start = 0n) {
  const mask = (1n << 14n) - 1n, flags = 0x20ccn;
  for (let nonce = start; nonce < start + 1_000_000n; nonce++) {
    if (signal?.aborted) throw new Error("Launch preparation cancelled.");
    const salt = toHex(nonce, { size: 32 });
    const address = getCreate2Address({ from: deployer, salt, bytecodeHash: initCodeHash });
    if ((BigInt(address) & mask) === flags) return { salt, address };
    if (nonce % 1_024n === 0n) await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("No matching hook address was found in this bounded search.");
}

async function erc20Approvals(client: PublicClient, input: { account: Address; token: Address; spender: Address; amount: bigint; blockNumber: bigint }): Promise<FoundationPreparedStep[]> {
  if (input.amount === 0n) return [];
  if (input.amount < 0n || input.amount > FOUNDATION_INT128_MAX) throw new Error("Unsupported approval amount.");
  const allowance = await client.readContract({ address: input.token, abi: erc20Abi, functionName: "allowance", args: [input.account, input.spender], blockNumber: input.blockNumber });
  if (allowance >= input.amount) return [];
  return (allowance > 0n ? [0n, input.amount] : [input.amount]).map(amount => ({
    label: amount === 0n ? "Reset token allowance" : "Approve exact token amount", kind: "approve" as const,
    transaction: { from: input.account, to: input.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [input.spender, amount] }), value: 0n },
    gasUsed: 0n, effect: amount === 0n ? "Reset the existing allowance before changing it." : `Allow ${input.spender} to spend ${amount} raw token units.`, spender: input.spender, amount,
  }));
}

/** Executes every approval and operation in one ephemeral RPC state, never a broadcast or fabricated allowance slot. */
export async function simulateFoundationSequence(client: PublicClient, steps: readonly FoundationPreparedStep[], checkpoint: FoundationCheckpoint, checks: readonly FoundationBalanceCheck[] = [], postReads: readonly { to: Address; data: Hex }[] = []) {
  if (steps.length === 0 || steps.length > 8) throw new Error("Invalid transaction sequence.");
  const account = steps[0].transaction.from;
  if (steps.some(step => getAddress(step.transaction.from) !== getAddress(account))) throw new Error("A sequence must have one payer.");
  if (checks.length > 4) throw new Error("Too many balance checks.");
  if (postReads.length > 11) throw new Error("Too many launch NFT and settlement checks.");
  const readBalance = (check: FoundationBalanceCheck) => ({ to: check.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [check.account] }) });
  for (const check of checks.filter(check => check.newToken)) {
    const code = await client.getCode({ address: check.token, blockNumber: checkpoint.blockNumber });
    if (code && code !== "0x") throw new Error("The predicted new token already exists.");
  }
  await assertFoundationWrapRuntime(client, steps, checkpoint.blockNumber);
  const previousChecks = checks.filter(check => !check.newToken);
  const offset = previousChecks.length;
  const simulation = await client.simulateCalls({ account, blockNumber: checkpoint.blockNumber,
    calls: [...previousChecks.map(readBalance),
      ...steps.map(step => ({ to: step.transaction.to, data: step.transaction.data, value: step.transaction.value })),
      ...checks.map(readBalance), ...postReads],
  });
  if (simulation.results.length !== offset + steps.length + checks.length + postReads.length) throw new Error("The simulation did not cover every transaction, balance and NFT check.");
  const results = simulation.results.slice(offset, offset + steps.length).map((result, index) => {
    if (result.status !== "success") throw new Error(`Simulation failed at ${steps[index].label}: ${result.error.message}`);
    // A non-reverting false ERC20 approval is still a failed approval.
    if (steps[index].kind === "approve" && result.data !== "0x" && /^0x0{64}$/.test(result.data)) throw new Error("The token rejected its approval.");
    return { data: result.data, gasUsed: result.gasUsed };
  });
  const balanceAt = (index: number) => {
    const result = simulation.results[index];
    if (result.status !== "success") throw new Error("A simulated wallet balance could not be read.");
    return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: result.data });
  };
  const balances = checks.map((check, index) => {
    const before = check.newToken ? 0n : balanceAt(previousChecks.indexOf(check));
    const after = balanceAt(offset + steps.length + index), delta = after - before;
    const wrapped = steps.some(step => step.kind === "wrap" && getAddress(step.transaction.to) === getAddress(check.token))
      && getAddress(check.account) === getAddress(account) ? foundationWrappedAmount(steps, check.token) : 0n;
    if ((check.delta !== undefined && delta !== check.delta + wrapped) || (check.minimumDelta !== undefined && delta < check.minimumDelta + wrapped)) {
      throw new Error("The actual simulated wallet balances do not meet the reviewed amounts.");
    }
    return { token: check.token, account: check.account, before, after, delta };
  });
  const block = await client.getBlock({ blockNumber: checkpoint.blockNumber });
  if (block.hash !== checkpoint.blockHash) throw new Error("Chain state changed during simulation. Review again.");
  const postData = simulation.results.slice(offset + steps.length + checks.length).map(result => {
    if (result.status !== "success") throw new Error("A simulated launch NFT could not be read.");
    return result.data;
  });
  return { results, steps: steps.map((step, index) => ({ ...step, gasUsed: results[index].gasUsed })), checkpoint, balances, postData };
}

/** Read both minted NFTs inside the same simulated state; result tuple owners alone are insufficient. */
export async function simulateFoundationV2Launch(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; parameters: FoundationLaunchParameters;
  steps: readonly FoundationPreparedStep[]; checkpoint: FoundationCheckpoint; checks: readonly FoundationBalanceCheck[];
  expected: { token: Address; hook: Address; poolId: Hex }; price: ReturnType<typeof planFoundationPrice>;
}) {
  if (foundationFactoryVersion(input.binding) !== "v2") throw new Error("V2 NFT checks require an exact V2 source binding.");
  const launch = input.steps.at(-1);
  const launchCall = launch ? assertFoundationLaunchCall(input.binding, launch.transaction, input.parameters) : null;
  if (!launch || launch.kind !== "launch" || getAddress(launch.transaction.to) !== getAddress(input.binding.factory.address)
    || input.checks.length < 2 || input.checks.length > 4 || getAddress(input.checks[0].token) !== getAddress(input.parameters.quote)
    || getAddress(input.checks[1].token) !== getAddress(input.expected.token) || input.checks[0].newToken === true || input.checks[1].newToken !== true
    || input.checks.some(check => getAddress(check.account) !== getAddress(launch.transaction.from))) {
    throw new Error("The V2 launch calldata and wallet checks must match the reviewed request.");
  }
  const factoryQuoteBefore = await input.client.readContract({ address: input.parameters.quote, abi: erc20Abi,
    functionName: "balanceOf", args: [input.binding.factory.address], blockNumber: input.checkpoint.blockNumber });
  const decode = (simulation: Awaited<ReturnType<typeof simulateFoundationSequence>>) => {
    const result = decodeFoundationLaunchResult(input.binding, simulation.results.at(-1)!.data);
    if (result.factoryVersion !== "v2") throw new Error("The launch result has a different factory version.");
    assertFoundationV2Result(result, input.parameters);
    if (getAddress(result.token) !== getAddress(input.expected.token) || getAddress(result.hook) !== getAddress(input.expected.hook)
      || result.poolId !== input.expected.poolId || result.baseTokenPrincipal !== input.price.base.principal
      || result.baseTokenRounding !== input.price.base.dust || result.creatorQuotePrincipal !== (input.price.creator?.principal ?? 0n)
      || simulation.balances[0]?.delta !== foundationWrappedAmount(input.steps, input.parameters.quote) + result.actualQuoteRefund - (launchCall?.native ? 0n : input.parameters.initialBuyQuoteAmount + input.parameters.additionalQuoteAmount)
      || result.initialBuyTokenAmount !== simulation.balances[1]?.delta) throw new Error("The V2 simulated launch differs from its exact source, principal or wallet movement.");
    return result;
  };
  const first = await simulateFoundationSequence(input.client, input.steps, input.checkpoint, input.checks);
  const predicted = decode(first);
  const specs = foundationV2PositionSpecs(predicted, input.parameters.quote, input.parameters.initialTick,
    { base: input.price.base.liquidity, creator: input.price.creator?.liquidity });
  const nftCalls = foundationV2PositionCalls(specs);
  const settlementCalls = [
    { to: input.parameters.quote, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [input.binding.factory.address] }) },
    { to: predicted.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [input.binding.factory.address] }) },
    { to: predicted.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [FOUNDATION_DEAD_ADDRESS] }) },
  ];
  const simulation = await simulateFoundationSequence(input.client, input.steps, input.checkpoint, input.checks, [...nftCalls, ...settlementCalls]);
  const result = decode(simulation);
  if (result.basePositionId !== predicted.basePositionId || result.creatorPositionId !== predicted.creatorPositionId) throw new Error("The simulated NFT identities changed within one checkpoint.");
  const positions = verifyFoundationV2PositionData(specs, result.poolId, simulation.postData.slice(0, nftCalls.length));
  const [quoteAfter, tokenAfter, roundingAfter] = simulation.postData.slice(nftCalls.length).map(data => decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data }));
  if (quoteAfter !== factoryQuoteBefore || tokenAfter !== 0n || roundingAfter < result.baseTokenRounding) throw new Error("The V2 factory quote refund or token rounding settlement is incomplete.");
  return { result, simulation, positions };
}

export async function prepareFoundationLaunch(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; account: Address; metadata: FoundationMetadata; quote: Address;
  startPrice: FoundationStartPrice; initialBuy: string; additionalLiquidity: string; creatorFeeBps: number;
  modules: readonly FoundationContractModule[]; tokenSalt: Hex; slippageBps: number; signal?: AbortSignal; ethFunding?: FoundationEthFunding;
}) {
  const { client, binding } = input, account = getAddress(input.account), factoryAbi = foundationFactoryAbiFor(binding);
  const modulePackageIds = readFoundationModulePackages(input.metadata.socialData, input.modules.length);
  if (input.modules.length > 0 && !modulePackageIds) throw new Error("Bind the original module source identities into the coin metadata before preparing.");
  const checkpoint = await assertFoundationInfrastructure(client, binding);
  const quote = await readFoundationQuote(client, input.quote, account, checkpoint.blockNumber);
  const additionalQuoteAmount = foundationParseAmount(input.additionalLiquidity, quote.decimals);
  const initialBuyQuoteAmount = foundationParseAmount(input.initialBuy, quote.decimals);
  const startPrice = parseFoundationStartPrice(input.startPrice, quote);
  const priceBlock = await client.getBlock({ blockNumber: BigInt(startPrice.checkpoint.number) });
  if (priceBlock.hash !== startPrice.checkpoint.hash || priceBlock.timestamp !== BigInt(startPrice.checkpoint.timestamp)
    || BigInt(startPrice.checkpoint.number) > checkpoint.blockNumber) throw new Error("The starting price changed with chain state. Review again.");
  const funding = additionalQuoteAmount + initialBuyQuoteAmount;
  if (funding > FOUNDATION_INT128_MAX) throw new Error("The initial buy exceeds the supported amount.");
  const ethFunding = input.ethFunding;
  if (ethFunding) {
    await assertFoundationAtomicEth(client, binding, checkpoint.blockNumber);
    if (ethFunding.quoteAmount !== funding || ethFunding.maximumEth <= 0n || ethFunding.maximumEth > FOUNDATION_INT128_MAX) throw new Error("The ETH funding amount does not match the launch.");
  }
  const nativeFunding = ethFunding ? [] : await prepareFoundationNativeFunding({ client, account, quote, amount: funding, blockNumber: checkpoint.blockNumber });
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 1_000) throw new Error("Choose slippage between 0.01% and 10%.");
  const token = await client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: "predictTokenAddress",
    args: [account, input.tokenSalt, input.metadata], blockNumber: checkpoint.blockNumber });
  const moduleAssetPins = readFoundationAssetPins(input.metadata.socialData);
  if (moduleAssetPins.some(pin => [token, quote.address].some(base => getAddress(pin[0]) === getAddress(base)))
    || (moduleAssetPins.length > 0 && input.modules.length === 0)) throw new Error("Only additional module assets can be bound to this launch.");
  if (moduleAssetPins.length) await refreshFoundationAssetsV1({ client, pins: moduleAssetPins, checkpoint });
  const price = planFoundationStartPrice({ token, quote, startPrice, additionalQuoteRaw: additionalQuoteAmount });
  const p: FoundationLaunchParameters = { metadata: input.metadata, quote: quote.address, quoteDecimals: quote.decimals,
    initialTick: price.initialTick, creatorFeeBps: foundationCreatorFeeBps(input.creatorFeeBps),
    additionalQuoteAmount, initialBuyQuoteAmount, initialBuyMinimumTokenAmount: initialBuyQuoteAmount > 0n ? 1n : 0n,
    deadline: checkpoint.timestamp + 300n, tokenSalt: input.tokenSalt, hookSalt: FOUNDATION_ZERO_HASH, modules: input.modules };
  const initCodeHash = await client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: "hookInitCodeHash",
    args: [account, token, p], blockNumber: checkpoint.blockNumber });
  const hook = await mineFoundationHook(binding.hookDeployer.address, initCodeHash, input.signal);
  p.hookSalt = hook.salt;
  const key = foundationPoolKey({ token, quote: quote.address, hook: hook.address }), poolId = foundationPoolId(key);
  const approvals = ethFunding ? [] : await erc20Approvals(client, { account, token: quote.address, spender: binding.factory.address, amount: funding, blockNumber: checkpoint.blockNumber });
  const launchStep = (): FoundationPreparedStep => ({ label: "Launch coin and pool", kind: "launch", gasUsed: 0n,
    transaction: { from: account, to: binding.factory.address, value: ethFunding?.maximumEth ?? 0n, data: ethFunding
      ? encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launchWithEth", args: [p, ethFunding.pool] })
      : encodeFunctionData({ abi: factoryAbi, functionName: "launch", args: [p] }) },
    effect: foundationFactoryVersion(binding) === "v2"
      ? `Create the coin and mint the base LP NFT and any optional LP NFT directly to DEAD. Their principal and any LP-position proceeds are irretrievable. Spend at most ${funding} raw quote units; return unused quote.`
      : `Create the coin, bind the pool and positions, and spend at most ${funding} raw quote units.`, amount: funding });
  const checks = (): FoundationBalanceCheck[] => [
    foundationFactoryVersion(binding) === "v2" ? { token: quote.address, account, minimumDelta: ethFunding ? 0n : -funding }
      : { token: quote.address, account, delta: -initialBuyQuoteAmount - (price.creator?.principal ?? 0n) },
    { token, account, newToken: true, minimumDelta: p.initialBuyMinimumTokenAmount },
    ...moduleAssetPins.map(([asset]) => ({ token: asset, account, minimumDelta: 0n })),
  ];
  let simulation = await simulateFoundationSequence(client, [...nativeFunding, ...approvals, launchStep()], checkpoint, checks());
  let result: FoundationLaunchRecord = decodeFoundationLaunchResult(binding, simulation.results.at(-1)!.data);
  if (initialBuyQuoteAmount > 0n) {
    p.initialBuyMinimumTokenAmount = result.initialBuyTokenAmount * BigInt(10_000 - input.slippageBps) / 10_000n;
    if (p.initialBuyMinimumTokenAmount === 0n) throw new Error("The initial buy is too small for a positive minimum output.");
    if (foundationFactoryVersion(binding) === "v1") {
      simulation = await simulateFoundationSequence(client, [...nativeFunding, ...approvals, launchStep()], checkpoint, checks());
      result = decodeFoundationLaunchResult(binding, simulation.results.at(-1)!.data);
    }
  }
  if (foundationFactoryVersion(binding) === "v2") {
    const checked = await simulateFoundationV2Launch({ client, binding, parameters: p, steps: [...nativeFunding, ...approvals, launchStep()], checkpoint,
      checks: checks(), expected: { token, hook: hook.address, poolId }, price });
    result = checked.result; simulation = checked.simulation;
  }
  if (getAddress(result.token) !== getAddress(token) || getAddress(result.hook) !== getAddress(hook.address)
    || result.poolId !== poolId || result.basePositionId === 0n || result.initialBuyTokenAmount < p.initialBuyMinimumTokenAmount
    || result.initialBuyTokenAmount !== simulation.balances[1].delta
    || (additionalQuoteAmount > 0n) !== (result.creatorPositionId > 0n)) throw new Error("The simulated launch does not match its plan.");
  if (ethFunding || nativeFunding.length) await assertFoundationNativeBalance(client, account, simulation.steps, checkpoint.blockNumber);
  // Mining and simulation can consume the reference lifetime. Never present an expired review.
  parseFoundationStartPrice(startPrice, quote);
  const priceExpiry = BigInt(startPrice.price.validUntil);
  return sealFoundationSequence({ kind: "launch" as const, sourceKind: "module-foundation-v1" as const, account, binding,
    checkpoint, expiresAt: priceExpiry < p.deadline ? priceExpiry : p.deadline, quote, ethFunding, parameters: p, result, factoryVersion: result.factoryVersion, price, startPrice, poolKey: key, modulePackageIds: modulePackageIds ?? [],
    moduleAssetPins, balanceChecks: checks(),
    metadataHash: keccak256(encodeAbiParameters(foundationMetadataParameters, [input.metadata])),
    steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const });
}

export interface FoundationTradeModuleReview {
  catalog: FoundationCatalogV1; selections: readonly FoundationModuleSelection[]; context?: OpenConfigContext;
}
export async function prepareFoundationTrade(input: { client: PublicClient; binding: FoundationDeploymentBinding; account: Address;
  pool: FoundationPool; side: "buy" | "sell"; amountIn: bigint; slippageBps: number; moduleReview?: FoundationTradeModuleReview }) {
  const { client, binding } = input, account = getAddress(input.account);
  let checkpoint = await assertFoundationInfrastructure(client, binding);
  if (input.amountIn <= 0n || input.amountIn > FOUNDATION_INT128_MAX || !Number.isInteger(input.slippageBps)
    || input.slippageBps < 1 || input.slippageBps > 1_000) throw new Error("Invalid trade amount or slippage.");
  const key = foundationPoolKey(input.pool);
  if (foundationPoolId(key) !== input.pool.poolId) throw new Error("The pool key changed.");
  const provenance = await assertFoundationPool(client, binding, input.pool, checkpoint.blockNumber);
  const moduleCount = await client.readContract({ address: input.pool.hook, abi: foundationHookAbi, functionName: "moduleCount", blockNumber: checkpoint.blockNumber });
  if (moduleCount > 8n || (moduleCount > 0n && (!input.moduleReview || BigInt(input.moduleReview.selections.length) !== moduleCount))) {
    throw new Error("Verify this pool's original admitted module sources before trading.");
  }
  const runtime = moduleCount > 0n ? await (await import("./action-runtime")).readFoundationActionRuntimeV1({
    client, binding, pool: input.pool, catalog: input.moduleReview!.catalog,
    selections: input.moduleReview!.selections, context: input.moduleReview!.context,
  }) : null;
  if (runtime) checkpoint = runtime.checkpoint;
  const moduleAssetPins = runtime?.moduleAssetPins ?? await readFoundationPoolAssetPins(client, input.pool, checkpoint);
  if (moduleCount === 0n && moduleAssetPins.length) throw new Error("A base pool cannot declare additional module assets.");
  const currencyIn = input.side === "buy" ? input.pool.quote : input.pool.token;
  const amountOut = (await client.simulateContract({ address: FOUNDATION_INFRASTRUCTURE.v4Quoter.address, abi: foundationQuoterAbi,
    functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: getAddress(currencyIn) === key.currency0,
      exactAmount: input.amountIn, hookData: "0x" }], blockNumber: checkpoint.blockNumber })).result[0];
  const minimumOutput = amountOut * BigInt(10_000 - input.slippageBps) / 10_000n;
  if (minimumOutput === 0n) throw new Error("The trade is too small for a positive minimum output.");
  const route = buildFoundationExactInput({ ...input, owner: account, recipient: account, minimumOutput,
    deadline: checkpoint.timestamp + 300n, now: checkpoint.timestamp });
  const approvals = await erc20Approvals(client, { account, token: currencyIn, spender: route.approval.spender, amount: input.amountIn, blockNumber: checkpoint.blockNumber });
  const allowance = await client.readContract({ address: route.approval.spender, abi: foundationPermit2Abi, functionName: "allowance",
    args: [account, currencyIn, route.approval.permit2Spender], blockNumber: checkpoint.blockNumber });
  if (allowance[0] < input.amountIn || allowance[1] < Number(route.deadline)) approvals.push({ label: "Authorize the Universal Router", kind: "approve",
    transaction: { from: account, to: route.approval.spender, data: encodeFunctionData({ abi: foundationPermit2Abi, functionName: "approve",
      args: [currencyIn, route.approval.permit2Spender, input.amountIn, Number(route.deadline)] }), value: 0n }, gasUsed: 0n,
    effect: `Authorize exactly ${input.amountIn} raw input units until ${route.deadline}.`, amount: input.amountIn, spender: route.approval.permit2Spender });
  const trade: FoundationPreparedStep = { label: input.side === "buy" ? "Buy coin" : "Sell coin", kind: input.side,
    transaction: route.transaction, gasUsed: 0n, effect: `Receive at least ${minimumOutput} raw output units after fees.`, amount: input.amountIn };
  const balanceChecks: FoundationBalanceCheck[] = [
    { token: route.currencyIn, account, delta: -input.amountIn },
    { token: route.currencyOut, account, minimumDelta: minimumOutput },
    ...moduleAssetPins.map(([asset]) => ({ token: asset, account, minimumDelta: 0n })),
  ];
  const simulation = await simulateFoundationSequence(client, [...approvals, trade], checkpoint, balanceChecks);
  return sealFoundationSequence({ kind: "trade" as const, sourceKind: "module-foundation-v1" as const, account, binding, checkpoint,
    expiresAt: route.deadline, pool: input.pool, side: input.side, amountIn: input.amountIn, amountOut, minimumOutput,
    route, provenance, moduleAssetPins, balanceChecks,
    moduleReview: runtime ? { selections: input.moduleReview!.selections, context: runtime.configurationContext } : null,
    steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const });
}

/** Call only after the pool's factory registration and token identity are verified. */
export async function readFoundationPoolAssetPins(client: PublicClient, pool: FoundationPool, checkpoint: FoundationCheckpoint) {
  const metadata = await client.readContract({ address: pool.token, abi: foundationTokenAbi, functionName: "metadata", blockNumber: checkpoint.blockNumber });
  const pins = readFoundationAssetPins(metadata[3]);
  if (pins.some(pin => [pool.token, pool.quote].some(base => getAddress(pin[0]) === getAddress(base)))) throw new Error("The module asset metadata repeats a base asset.");
  if (pins.length) await refreshFoundationAssetsV1({ client, pins, checkpoint });
  return pins;
}

/** Anyone may trigger a payout; its recipient is fixed by the ledger and cannot be supplied as calldata. */
export async function prepareFoundationClaim(input: { client: PublicClient; binding: FoundationDeploymentBinding;
  account: Address; pool: FoundationPool; beneficiary: "platform" | "creator" }) {
  const { client, binding, pool, beneficiary } = input, account = getAddress(input.account);
  if (beneficiary !== "platform" && beneficiary !== "creator") throw new Error("Choose an existing fee account.");
  const checkpoint = await assertFoundationInfrastructure(client, binding);
  const provenance = await assertFoundationPool(client, binding, pool, checkpoint.blockNumber);
  const ledger = provenance.record.ledger;
  const [manager, hook, quote, creator, credited, claimed] = await Promise.all([
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "poolManager", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "hook", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "quote", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creator", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: beneficiary === "platform" ? "platformReceived" : "creatorCredited", blockNumber: checkpoint.blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: beneficiary === "platform" ? "platformClaimed" : "creatorClaimed", blockNumber: checkpoint.blockNumber }),
  ]);
  if (getAddress(manager) !== FOUNDATION_INFRASTRUCTURE.poolManager.address || getAddress(hook) !== getAddress(pool.hook)
    || getAddress(quote) !== getAddress(pool.quote) || getAddress(creator) !== getAddress(provenance.creator)) throw new Error("The fee ledger is bound to a different launch.");
  const available = credited - claimed, amount = available > FOUNDATION_INT128_MAX ? FOUNDATION_INT128_MAX : available;
  if (amount <= 0n) throw new Error("There are no accrued fees to pay out.");
  const recipient = beneficiary === "platform" ? FOUNDATION_PLATFORM_RECIPIENT : getAddress(creator);
  const functionName = beneficiary === "platform" ? "claimPlatform" : "claimCreator";
  const step: FoundationPreparedStep = { label: beneficiary === "platform" ? "Pay out platform fees" : "Pay out creator fees", kind: "claim",
    transaction: { from: account, to: ledger, value: 0n, data: encodeFunctionData({ abi: foundationLedgerAbi, functionName }) },
    gasUsed: 0n, amount, effect: `Pay at least ${amount} raw quote units to the fixed recipient ${recipient}.` };
  const simulation = await simulateFoundationSequence(client, [step], checkpoint, [{ token: quote, account: recipient, minimumDelta: amount }]);
  const paid = decodeFunctionResult({ abi: foundationLedgerAbi, functionName, data: simulation.results[0].data });
  if (paid !== simulation.balances[0].delta) throw new Error("The simulated payout did not reach its fixed recipient.");
  return sealFoundationSequence({ kind: "claim" as const, sourceKind: "module-foundation-v1" as const, account, binding, checkpoint,
    expiresAt: checkpoint.timestamp + 120n, pool, beneficiary, recipient, minimumOutput: amount, provenance,
    steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const });
}
