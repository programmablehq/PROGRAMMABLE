import {
  createPublicClient, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi,
  fallback, getAddress, getCreate2Address, http, keccak256, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { robinhoodChain } from "@/lib/chains";
import { hasUnsafeDisplayCharacters, isValidTokenSymbol, MAX_METADATA_URL_BYTES, MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { moduleTokenMetadata, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { foundationFactoryAbi, foundationHookAbi, foundationLedgerAbi, foundationMetadataParameters, foundationPermit2Abi, foundationQuoterAbi, foundationTokenAbi,
  type FoundationContractModule, type FoundationLaunchParameters, type FoundationLaunchResult, type FoundationMetadata } from "./abi";
import { FOUNDATION_ABI_ID, FOUNDATION_CHAIN_ID, foundationCreatorFeeBps, FOUNDATION_INFRASTRUCTURE,
  FOUNDATION_INT128_MAX, FOUNDATION_PLATFORM_RECIPIENT, FOUNDATION_ZERO_HASH } from "./constants";
import { foundationParseAmount, planFoundationPrice } from "./price";
import { buildFoundationExactInput, foundationPoolId, foundationPoolKey, type FoundationPool } from "./route";
import type { FoundationPrepareModuleActionInputV1 } from "./action-runtime";
import { readFoundationAssetPins, readFoundationModulePackages, withFoundationModulePackages } from "./metadata";
import { refreshFoundationAssetsV1, type FoundationAssetPinV1 } from "./assets";

export function createFoundationClient(): PublicClient {
  return createPublicClient({ chain: robinhoodChain, transport: fallback([
    http("https://rpc-robinhood.blockmachine.io", { timeout: 20_000, retryCount: 0 }),
    http("https://rpc.mainnet.chain.robinhood.com", { timeout: 20_000, retryCount: 0 }),
  ], { rank: false, retryCount: 0 }), batch: { multicall: false } });
}

/** Source/runtime pins only. The caller must independently resolve release authority before presenting execution. */
export interface FoundationDeploymentBinding {
  releaseDigest: Hex;
  sourceCommit: string;
  startBlock: bigint;
  factory: { address: Address; runtimeCodeHash: Hex };
  hookDeployer: { address: Address; runtimeCodeHash: Hex };
}
export interface FoundationTransaction {
  from: Address; to: Address; data: Hex; value: bigint;
}
export interface FoundationPreparedStep {
  label: string; kind: "approve" | "launch" | "buy" | "sell" | "claim" | "module-action";
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
  const version = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName: "VERSION_ID", blockNumber: block.number });
  if (version !== FOUNDATION_ABI_ID) throw new Error("This factory uses a different module interface.");
  await Promise.all((["poolManager", "positionManager", "universalRouter", "permit2", "hookDeployer"] as const).map(async role => {
    const actual = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName: role, blockNumber: block.number! });
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
  const record = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi,
    functionName: "launchOf", args: [getAddress(pool.token)], blockNumber });
  if (BigInt(record.token) === 0n || getAddress(record.token) !== getAddress(pool.token)
    || getAddress(record.hook) !== getAddress(pool.hook) || record.poolId !== pool.poolId
    || BigInt(record.ledger) === 0n || BigInt(record.baseVault) === 0n || record.basePositionId === 0n) {
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
  return { record, key, creatorFeeBps, creator };
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
export async function simulateFoundationSequence(client: PublicClient, steps: readonly FoundationPreparedStep[], checkpoint: FoundationCheckpoint, checks: readonly FoundationBalanceCheck[] = []) {
  if (steps.length === 0 || steps.length > 8) throw new Error("Invalid transaction sequence.");
  const account = steps[0].transaction.from;
  if (steps.some(step => getAddress(step.transaction.from) !== getAddress(account))) throw new Error("A sequence must have one payer.");
  if (checks.length > 4) throw new Error("Too many balance checks.");
  const readBalance = (check: FoundationBalanceCheck) => ({ to: check.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [check.account] }) });
  for (const check of checks.filter(check => check.newToken)) {
    const code = await client.getCode({ address: check.token, blockNumber: checkpoint.blockNumber });
    if (code && code !== "0x") throw new Error("The predicted new token already exists.");
  }
  const previousChecks = checks.filter(check => !check.newToken);
  const offset = previousChecks.length;
  const simulation = await client.simulateCalls({ account, blockNumber: checkpoint.blockNumber,
    calls: [...previousChecks.map(readBalance),
      ...steps.map(step => ({ to: step.transaction.to, data: step.transaction.data, value: step.transaction.value })),
      ...checks.map(readBalance)],
  });
  if (simulation.results.length !== offset + steps.length + checks.length) throw new Error("The simulation did not cover every transaction and balance check.");
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
    if ((check.delta !== undefined && delta !== check.delta) || (check.minimumDelta !== undefined && delta < check.minimumDelta)) {
      throw new Error("The actual simulated wallet balances do not meet the reviewed amounts.");
    }
    return { token: check.token, account: check.account, before, after, delta };
  });
  const block = await client.getBlock({ blockNumber: checkpoint.blockNumber });
  if (block.hash !== checkpoint.blockHash) throw new Error("Chain state changed during simulation. Review again.");
  return { results, steps: steps.map((step, index) => ({ ...step, gasUsed: results[index].gasUsed })), checkpoint, balances };
}

export async function prepareFoundationLaunch(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; account: Address; metadata: FoundationMetadata; quote: Address;
  startValuationQuote: string; initialBuy: string; additionalLiquidity: string; creatorFeeBps: number;
  modules: readonly FoundationContractModule[]; tokenSalt: Hex; slippageBps: number; signal?: AbortSignal;
}) {
  const { client, binding } = input, account = getAddress(input.account);
  const modulePackageIds = readFoundationModulePackages(input.metadata.socialData, input.modules.length);
  if (input.modules.length > 0 && !modulePackageIds) throw new Error("Bind the original module source identities into the coin metadata before preparing.");
  const checkpoint = await assertFoundationInfrastructure(client, binding);
  const quote = await readFoundationQuote(client, input.quote, account, checkpoint.blockNumber);
  const additionalQuoteAmount = foundationParseAmount(input.additionalLiquidity, quote.decimals);
  const initialBuyQuoteAmount = foundationParseAmount(input.initialBuy, quote.decimals);
  const valuationQuoteRaw = foundationParseAmount(input.startValuationQuote, quote.decimals, false);
  const funding = additionalQuoteAmount + initialBuyQuoteAmount;
  if (funding > FOUNDATION_INT128_MAX || quote.balance === null || quote.balance < funding) throw new Error("Your quote-token balance does not cover this launch.");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 1_000) throw new Error("Choose slippage between 0.01% and 10%.");
  const token = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName: "predictTokenAddress",
    args: [account, input.tokenSalt, input.metadata], blockNumber: checkpoint.blockNumber });
  const moduleAssetPins = readFoundationAssetPins(input.metadata.socialData);
  if (moduleAssetPins.some(pin => [token, quote.address].some(base => getAddress(pin[0]) === getAddress(base)))
    || (moduleAssetPins.length > 0 && input.modules.length === 0)) throw new Error("Only additional module assets can be bound to this launch.");
  if (moduleAssetPins.length) await refreshFoundationAssetsV1({ client, pins: moduleAssetPins, checkpoint });
  const price = planFoundationPrice({ token, quote: quote.address, valuationQuoteRaw, additionalQuoteRaw: additionalQuoteAmount });
  const p: FoundationLaunchParameters = { metadata: input.metadata, quote: quote.address, quoteDecimals: quote.decimals,
    initialTick: price.initialTick, creatorFeeBps: foundationCreatorFeeBps(input.creatorFeeBps),
    additionalQuoteAmount, initialBuyQuoteAmount, initialBuyMinimumTokenAmount: initialBuyQuoteAmount > 0n ? 1n : 0n,
    deadline: checkpoint.timestamp + 300n, tokenSalt: input.tokenSalt, hookSalt: FOUNDATION_ZERO_HASH, modules: input.modules };
  const initCodeHash = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName: "hookInitCodeHash",
    args: [account, token, p], blockNumber: checkpoint.blockNumber });
  const hook = await mineFoundationHook(binding.hookDeployer.address, initCodeHash, input.signal);
  p.hookSalt = hook.salt;
  const key = foundationPoolKey({ token, quote: quote.address, hook: hook.address }), poolId = foundationPoolId(key);
  const approvals = await erc20Approvals(client, { account, token: quote.address, spender: binding.factory.address, amount: funding, blockNumber: checkpoint.blockNumber });
  const launchStep = (): FoundationPreparedStep => ({ label: "Launch coin and pool", kind: "launch", gasUsed: 0n,
    transaction: { from: account, to: binding.factory.address, value: 0n, data: encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [p] }) },
    effect: `Create the coin, bind the pool and positions, and spend at most ${funding} raw quote units.`, amount: funding });
  const checks = (): FoundationBalanceCheck[] => [
    { token: quote.address, account, delta: -initialBuyQuoteAmount - (price.creator?.principal ?? 0n) },
    { token, account, newToken: true, minimumDelta: p.initialBuyMinimumTokenAmount },
    ...moduleAssetPins.map(([asset]) => ({ token: asset, account, minimumDelta: 0n })),
  ];
  let simulation = await simulateFoundationSequence(client, [...approvals, launchStep()], checkpoint, checks());
  let result = decodeFunctionResult({ abi: foundationFactoryAbi, functionName: "launch", data: simulation.results.at(-1)!.data }) as FoundationLaunchResult;
  if (initialBuyQuoteAmount > 0n) {
    p.initialBuyMinimumTokenAmount = result.initialBuyTokenAmount * BigInt(10_000 - input.slippageBps) / 10_000n;
    if (p.initialBuyMinimumTokenAmount === 0n) throw new Error("The initial buy is too small for a positive minimum output.");
    simulation = await simulateFoundationSequence(client, [...approvals, launchStep()], checkpoint, checks());
    result = decodeFunctionResult({ abi: foundationFactoryAbi, functionName: "launch", data: simulation.results.at(-1)!.data }) as FoundationLaunchResult;
  }
  if (getAddress(result.token) !== getAddress(token) || getAddress(result.hook) !== getAddress(hook.address)
    || result.poolId !== poolId || result.basePositionId === 0n || result.initialBuyTokenAmount < p.initialBuyMinimumTokenAmount
    || result.initialBuyTokenAmount !== simulation.balances[1].delta
    || (additionalQuoteAmount > 0n) !== (result.creatorPositionId > 0n)) throw new Error("The simulated launch does not match its plan.");
  return sealFoundationSequence({ kind: "launch" as const, sourceKind: "module-foundation-v1" as const, account, binding,
    checkpoint, expiresAt: p.deadline, quote, parameters: p, result, price, poolKey: key, modulePackageIds: modulePackageIds ?? [],
    moduleAssetPins, balanceChecks: checks(),
    metadataHash: keccak256(encodeAbiParameters(foundationMetadataParameters, [input.metadata])),
    steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const });
}

export async function prepareFoundationTrade(input: { client: PublicClient; binding: FoundationDeploymentBinding; account: Address;
  pool: FoundationPool; side: "buy" | "sell"; amountIn: bigint; slippageBps: number }) {
  const { client, binding } = input, account = getAddress(input.account);
  const checkpoint = await assertFoundationInfrastructure(client, binding);
  if (input.amountIn <= 0n || input.amountIn > FOUNDATION_INT128_MAX || !Number.isInteger(input.slippageBps)
    || input.slippageBps < 1 || input.slippageBps > 1_000) throw new Error("Invalid trade amount or slippage.");
  const key = foundationPoolKey(input.pool);
  if (foundationPoolId(key) !== input.pool.poolId) throw new Error("The pool key changed.");
  const provenance = await assertFoundationPool(client, binding, input.pool, checkpoint.blockNumber);
  const moduleAssetPins = await readFoundationPoolAssetPins(client, input.pool, checkpoint);
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
    route, provenance, moduleAssetPins, balanceChecks, steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const });
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
