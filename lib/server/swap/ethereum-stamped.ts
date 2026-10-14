import { ethereumPoolFeeMatchesPolicy } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import "server-only";
import { createPublicClient, decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, http, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { readFinalizedRouterCustomIdentitySnapshotCoreV1, type RouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { launchStampRouterReadAbi } from "@/lib/alchemy/launch-stamp.server";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { customTradePermit2Abi, customTradeTokenAbi } from "@/lib/custom-launch/trade-v1";
import { tradeActionRpcProviders } from "@/lib/server/action-rpc-quorum.server";
import { agreedTradeRpcV1, bytesV1, quantityV1, readAgreedTradeTraceV1, readTradeGasEstimateV1, successfulTradeFramesV1, tradeBlockV1, tradePostStateV1, type TradeRpcV1, type TradeTraceV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { ETHEREUM_STAMPED_SWAP_PROTOCOL as protocol, ETHEREUM_PERMIT2_APPROVAL_GRACE_SECONDS, EthereumStampedSwapError, ethereumStampedApprovalTransaction, ethereumStampedPreparationDigest, ethereumStampedProbeTransaction, ethereumStampedRuntimeBindings, ethereumStampedRuntimeDigest, ethereumStampedSwapRoute, ethereumStampedSwapTransaction, parseEthereumStampedSwapRequest, type EthereumStampedSwapPreparation, type EthereumSwapRuntimeBinding } from "@/lib/swap/ethereum-stamped";
import type { PreparedTradeTransaction } from "@/lib/prepared-transaction";
import { EthereumRpcBudget, EthereumRpcBudgetBusy, EthereumRpcProviderRateLimit, ethereumRpcRateLimited } from "./ethereum-rpc-budget";
import { readEthereumFeeClassificationV1 } from "@/lib/server/custom-launch/ethereum-routing-fee-policy-v1";
import { ETHEREUM_ROUTING_FEE_POLICY_V1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { ethereumNative30Market, ethereumRouteRequiresFee, ethereumRouteFeePolicy, type EthereumSwapFeeV1 } from "@/lib/swap/ethereum-stamped";
import { ethereumNative30RequiredAddressesV1, proveEthereumNative30RuntimeV1, type EthereumNative30RuntimeProofV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { proveEthereumNative30TradeAccrualV1 } from "@/lib/server/custom-launch/ethereum-native30-trade-v1";

const takeAbi = parseAbi(["function take(address currency,address to,uint256 amount)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const NATIVE = "0x0000000000000000000000000000000000000000";
const activePreparations = new Map<string, Promise<EthereumStampedSwapPreparation>>();
const transportClients = new Map<string, ReturnType<typeof createPublicClient>>();
const providerBudgets = new Map<string, EthereumRpcBudget>();
const unavailable = (code: string): never => { throw new EthereumStampedSwapError("This swap could not be checked. Please try again.", code); };

async function boundedFetch(input: string | URL | Request, init?: RequestInit) {
  const response = await fetch(input, { ...init, cache: "no-store" });
  if (response.status === 429) { await response.body?.cancel(); throw new EthereumRpcProviderRateLimit(); }
  if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 2_097_152) return unavailable("ETHEREUM_RPC_UNAVAILABLE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 2_097_152) { await reader.cancel(); return unavailable("ETHEREUM_RPC_RESPONSE_LIMIT"); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
}

/** Existing committed private providers; batched reads, no public fallback,
 * transaction submission, credentials in browser payloads or unlimited retry. */
export function productionEthereumSwapRpcs(): readonly [TradeRpcV1, TradeRpcV1] {
  const methods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_gasPrice", "eth_call", "eth_estimateGas", "debug_traceCall"]);
  return tradeActionRpcProviders(1).map(provider => {
    let client = transportClients.get(provider.identity);
    if (!client) {
      client = createPublicClient({ chain: mainnet, transport: http(provider.endpoint, { batch: { batchSize: 32, wait: 2 }, retryCount: 0, timeout: 10_000, fetchFn: boundedFetch }) });
      if (transportClients.size >= 4) transportClients.delete(transportClients.keys().next().value!);
      transportClients.set(provider.identity, client);
    }
    let budget = providerBudgets.get(provider.identity);
    if (!budget) {
      budget = new EthereumRpcBudget();
      if (providerBudgets.size >= 4) providerBudgets.delete(providerBudgets.keys().next().value!);
      providerBudgets.set(provider.identity, budget);
    }
    const selected = client, selectedBudget = budget; let reads = 0;
    return async (method: string, params: readonly unknown[]) => {
      if (!methods.has(method)) return unavailable("ETHEREUM_RPC_REQUEST_LIMIT");
      for (let attempt = 0; attempt < 2; attempt++) {
        if (++reads > 96) return unavailable("ETHEREUM_RPC_REQUEST_LIMIT");
        try {
          await selectedBudget.acquire();
          return await selected.request({ method, params } as never);
        } catch (error) {
          if (error instanceof EthereumRpcBudgetBusy) throw new EthereumStampedSwapError("Swap checks are busy. Please try again shortly.", "ETHEREUM_SWAP_BUSY", 429);
          if (attempt === 0 && ethereumRpcRateLimited(error)) { selectedBudget.pause(); continue; }
          return unavailable("ETHEREUM_RPC_UNAVAILABLE");
        }
      }
      return unavailable("ETHEREUM_RPC_UNAVAILABLE");
    };
  }) as unknown as readonly [TradeRpcV1, TradeRpcV1];
}

export interface EthereumSwapDependencies {
  readSnapshot?: () => Promise<RouterCustomIdentitySnapshotV1>;
  rpcs?: readonly [TradeRpcV1, TradeRpcV1];
  now?: () => bigint;
  readFeeClassification?: typeof readEthereumFeeClassificationV1;
}

/** Reuse only identical reads pinned to a canonical block, within one
 * preparation. A later preparation and the final canonical-block check stay fresh. */
function reusePinnedReads(read: TradeRpcV1): TradeRpcV1 {
  const saved = new Map<string, Promise<unknown>>();
  return (method, params) => {
    const reference = params[1];
    if (!["eth_call", "eth_getCode", "eth_getBalance"].includes(method)
      || !reference || typeof reference !== "object" || Array.isArray(reference)
      || !("blockHash" in reference) || typeof reference.blockHash !== "string"
      || !("requireCanonical" in reference) || reference.requireCanonical !== true) return read(method, params);
    const key = canonicalBrowserJsonV2([method, params]);
    const existing = saved.get(key);
    if (existing) return existing;
    const pending = read(method, params).catch(error => { saved.delete(key); throw error; });
    saved.set(key, pending);
    return pending;
  };
}

export async function prepareEthereumStampedSwap(value: unknown, dependencies: EthereumSwapDependencies = {}): Promise<EthereumStampedSwapPreparation> {
  const request = parseEthereumStampedSwapRequest(value);
  if (dependencies.rpcs || dependencies.readSnapshot || dependencies.now || dependencies.readFeeClassification) return prepare(request, dependencies);
  const key = canonicalBrowserSha256V2("programmable.ethereum-swap-inflight.v1", request);
  const existing = activePreparations.get(key);
  if (existing) return existing;
  if (activePreparations.size >= 4) throw new EthereumStampedSwapError("Swap checks are busy. Please try again shortly.", "ETHEREUM_SWAP_BUSY", 429);
  const pending = prepare(request, dependencies).finally(() => activePreparations.delete(key));
  activePreparations.set(key, pending);
  return pending;
}

async function prepare(request: ReturnType<typeof parseEthereumStampedSwapRequest>, dependencies: EthereumSwapDependencies): Promise<EthereumStampedSwapPreparation> {
  const snapshot = await (dependencies.readSnapshot ?? (() => readFinalizedRouterCustomIdentitySnapshotCoreV1({ signal: AbortSignal.timeout(10_000) })))();
  const entries = snapshot.entries.filter(entry => same(entry.tokenAddress, request.token));
  const classification = entries.length === 1
    ? await (dependencies.readFeeClassification ?? readEthereumFeeClassificationV1)(entries[0]!).catch(() => unavailable("ETHEREUM_FEE_POLICY_PENDING")) : undefined;
  const route = entries.length === 1 ? ethereumStampedSwapRoute(entries[0]!, classification) : null;
  // A saved finalized identity may survive an index refresh failure. It grants
  // no execution authority: recheck its canonical launch block and stamp, then
  // simulate the actual transaction against fresh independent RPC state.
  if (!route || route.routeBindingHash !== request.routeBindingHash) return unavailable("ETHEREUM_LAUNCH_ROUTE_CHANGED");
  const providers = dependencies.rpcs ?? productionEthereumSwapRpcs();
  const rpcs = [reusePinnedReads(providers[0]), reusePinnedReads(providers[1])] as const;
  const rpc = agreedTradeRpcV1(rpcs);
  const [chainId, tips] = await Promise.all([
    rpc("eth_chainId", [], value => quantityV1(value).toString()),
    Promise.all(rpcs.map(async read => tradeBlockV1(await read("eth_getBlockByNumber", ["latest", false])))),
  ]);
  if (chainId !== "1") return unavailable("ETHEREUM_CHAIN_MISMATCH");
  const height = tips.reduce((lowest, block) => BigInt(block.number) < lowest ? BigInt(block.number) : lowest, BigInt(tips[0]!.number));
  const tag = toHex(height), block = await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1);
  const now = dependencies.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  if (BigInt(block.number) !== height || now() > BigInt(block.timestamp) + 60n || BigInt(block.timestamp) > now() + 5n) return unavailable("ETHEREUM_CHECKPOINT_STALE");
  if (BigInt(request.deadline) <= now() || BigInt(request.deadline) > BigInt(block.timestamp) + 300n) throw new EthereumStampedSwapError("Get a fresh swap quote.", "ETHEREUM_DEADLINE_INVALID", 400);
  const reference = { blockHash: block.hash, requireCanonical: true }, stamp = route.stamp;
  if (height < BigInt(stamp.blockNumber) + 64n) return unavailable("ETHEREUM_LAUNCH_NOT_FINALIZED");
  const call = async (address: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>) =>
    bytesV1(await rpc("eth_call", [{ from: request.owner, to: address, data }, reference, ...(overrides ? [overrides] : [])], bytesV1));
  const tokenUint = async (functionName: "balanceOf" | "allowance", args: readonly Address[], overrides?: Record<string, Record<string, unknown>>) => {
    const raw = await call(request.token, encodeFunctionData({ abi: customTradeTokenAbi, functionName, args: args as never }), overrides);
    if (raw.length !== 66) return unavailable("ETHEREUM_TOKEN_READ_INVALID");
    return BigInt(raw);
  };
  const runtimeBindings = [...ethereumStampedRuntimeBindings(route)];
  const runtimeCodes: Record<string, Hex> = {};
  const [launchBlock] = await Promise.all([
    rpc("eth_getBlockByNumber", [toHex(BigInt(stamp.blockNumber)), false], tradeBlockV1),
    Promise.all(runtimeBindings.map(async expected => {
      const code = bytesV1(await rpc("eth_getCode", [expected.address, reference], bytesV1));
      if (code === "0x" || !same(keccak256(code), expected.runtimeCodeHash)) return unavailable("ETHEREUM_LAUNCH_RUNTIME_CHANGED");
      runtimeCodes[expected.address.toLowerCase()] = code;
    })),
  ]);
  if (!same(launchBlock.hash, stamp.blockHash) || launchBlock.number !== stamp.blockNumber) return unavailable("ETHEREUM_LAUNCH_CHECKPOINT_CHANGED");
  const router = getAddress(stamp.routerAddress);
  const [native30Proof, [proofData, poolData, recordData, decimalsData], [nativeBalance, gasPrice]] = await Promise.all([
    (async (): Promise<EthereumNative30RuntimeProofV1 | undefined> => {
      if (!ethereumRouteRequiresFee(route)) return;
      const market = ethereumNative30Market(route);
      const required = ethereumNative30RequiredAddressesV1(market, runtimeCodes[market.hooks.toLowerCase()] ?? "0x");
      if (!required) return;
      const extra = await Promise.all(required.filter(address => !runtimeCodes[address.toLowerCase()]).map(async address => {
        const code = bytesV1(await rpc("eth_getCode", [address, reference], bytesV1));
        if (code === "0x") return unavailable("ETHEREUM_POOL_FEE_RUNTIME_PENDING");
        runtimeCodes[address.toLowerCase()] = code;
        return { address, runtimeCodeHash: keccak256(code) };
      }));
      runtimeBindings.push(...extra);
      const proof = proveEthereumNative30RuntimeV1(market, runtimeCodes);
      if (!proof) return unavailable("ETHEREUM_POOL_FEE_RUNTIME_PENDING");
      return proof;
    })(),
    Promise.all([
      call(router, encodeFunctionData({ abi: launchStampRouterReadAbi, functionName: "stampProof", args: [request.token] })),
      call(router, encodeFunctionData({ abi: launchStampRouterReadAbi, functionName: "launchIdByPool", args: [getAddress(stamp.poolManagerAddress), stamp.poolId] })),
      call(router, encodeFunctionData({ abi: launchStampRouterReadAbi, functionName: "launchStamp", args: [stamp.launchId] })),
      call(request.token, encodeFunctionData({ abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" })),
    ]),
    Promise.all([
      rpc("eth_getBalance", [request.owner, reference], value => quantityV1(value).toString()),
      Promise.all(rpcs.map(async read => quantityV1(await read("eth_gasPrice", []))))
        .then(prices => prices.reduce((maximum, price) => price > maximum ? price : maximum, 0n).toString()),
    ]),
  ]);
  const proof = decodeFunctionResult({ abi: launchStampRouterReadAbi, functionName: "stampProof", data: proofData });
  const record = decodeFunctionResult({ abi: launchStampRouterReadAbi, functionName: "launchStamp", data: recordData });
  const fields = { launchWallet: stamp.launchWallet, token: request.token, hook: stamp.poolKey.hooks, poolManager: stamp.poolManagerAddress, poolId: stamp.poolId,
    poolKeyHash: stamp.poolKeyHash, componentSetHash: stamp.componentSetHash, routePayloadHash: stamp.routePayloadHash,
    routeLauncher: stamp.routeLauncherAddress, routeLauncherRuntimeCodeHash: stamp.routeLauncherRuntimeCodeHash,
    expectedResultHash: stamp.expectedResultHash, permitDigest: stamp.permitDigest, stampHash: stamp.stampHash };
  if (record.kind !== 1 || !same(proof[0], stamp.launchId) || !same(proof[1], stamp.stampHash) || !same(poolData, stamp.launchId)
    || Object.entries(fields).some(([key, expected]) => !same(record[key as keyof typeof record] as string, expected))
    || BigInt(decimalsData) !== BigInt(route.tokenDecimals)) return unavailable("ETHEREUM_STAMP_READBACK_CHANGED");
  let transaction: PreparedTradeTransaction | undefined;
  if (request.side === "sell") {
    const [balance, allowance, permitData] = await Promise.all([
      tokenUint("balanceOf", [request.owner]), tokenUint("allowance", [request.owner, getAddress(protocol.permit2.address)]),
      call(getAddress(protocol.permit2.address), encodeFunctionData({ abi: customTradePermit2Abi, functionName: "allowance",
        args: [request.owner, request.token, getAddress(protocol.router.address)] })),
    ]);
    if (balance < BigInt(request.amountIn)) throw new EthereumStampedSwapError("Enter an amount within your token balance.", "ETHEREUM_TOKEN_BALANCE", 400);
    const permit = decodeFunctionResult({ abi: customTradePermit2Abi, functionName: "allowance", data: permitData });
    if (allowance < BigInt(request.amountIn)) transaction = ethereumStampedApprovalTransaction(request, "token-to-permit2");
    else if (permit[0] < BigInt(request.amountIn) || BigInt(permit[1]) <= BigInt(request.deadline)) transaction = ethereumStampedApprovalTransaction(request, "permit2-to-router");
  } else if (BigInt(nativeBalance) <= BigInt(request.amountIn)) throw new EthereumStampedSwapError("Keep some ETH in your wallet for gas.", "ETHEREUM_NATIVE_BALANCE", 400);

  const requiresFee = ethereumRouteRequiresFee(route);
  const feePolicy = requiresFee ? ethereumRouteFeePolicy(route) : null;
  if (native30Proof && feePolicy && !ethereumPoolFeeMatchesPolicy(feePolicy.policy, native30Proof)) return unavailable("ETHEREUM_POOL_FEE_RECIPIENT_MISMATCH");
  const recipient = getAddress(feePolicy?.policy.defaultCollection.recipient ?? ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection.recipient);
  const [recipientBefore, routerNativeBefore] = await Promise.all([
    requiresFee && !native30Proof
      ? same(request.owner, recipient) ? nativeBalance : rpc("eth_getBalance", [recipient, reference], value => quantityV1(value).toString()) : "0",
    requiresFee ? rpc("eth_getBalance", [getAddress(protocol.router.address), reference], value => quantityV1(value).toString()) : "0",
  ]);
  let fee: EthereumSwapFeeV1 | undefined = requiresFee ? {
    policyHash: feePolicy!.policyHash, mode: native30Proof ? native30Proof.rateBps === 100 ? "pool_enforced_native100" : "pool_enforced_native30" : "programmable_routed",
    rateBps: feePolicy!.policy.rateBps, routedRateBps: native30Proof ? 0 : feePolicy!.policy.defaultCollection.routedRateBps, recipient,
    grossNativeAmount: "0", platformFeeAmount: "0", netNativeAmount: "0", native30Proof: native30Proof ?? null, accrual: null,
  } : undefined;
  const reached = new Set(runtimeBindings.map(binding => binding.address.toLowerCase()));
  const simulations: { trace: TradeTraceV1; posts: Record<string, Record<string, unknown>>[]; gasUsed: bigint; settlementDigest: `sha256:${string}` }[] = [];
  const simulate = async (tx: PreparedTradeTransaction) => {
    const simulated = { from: request.owner, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)), gas: "0x1e8480", gasPrice: "0x0" };
    const [{ trace, maximumGasUsed }, posts] = await Promise.all([
      readAgreedTradeTraceV1(rpcs, simulated, tag),
      Promise.all(rpcs.map(async read => tradePostStateV1(await read("debug_traceCall", [simulated, tag, { tracer: "prestateTracer", timeout: "10s", tracerConfig: { diffMode: true } }])))),
    ]);
    if (trace.failed || trace.type !== "CALL" || !same(trace.from, request.owner) || !trace.to || !same(trace.to, tx.to)
      || trace.input !== tx.data.toLowerCase() || trace.value !== tx.value || maximumGasUsed > 2_000_000n) return unavailable("ETHEREUM_SWAP_SIMULATION_FAILED");
    const frames = successfulTradeFramesV1(trace);
    if (frames.some(frame => ["CREATE", "CREATE2", "CALLCODE", "SELFDESTRUCT"].includes(frame.type))) return unavailable("ETHEREUM_SWAP_EXECUTION_UNSUPPORTED");
    for (const frame of frames) { reached.add(frame.from.toLowerCase()); if (frame.to) reached.add(frame.to.toLowerCase()); }
    if (reached.size > 96) return unavailable("ETHEREUM_SWAP_RUNTIME_LIMIT");
    const application = posts.map(post => Object.fromEntries(Object.entries(post).filter(([address]) => reached.has(address.toLowerCase()))));
    if (canonicalBrowserJsonV2(application[0]) !== canonicalBrowserJsonV2(application[1])) return unavailable("ETHEREUM_SWAP_EFFECT_DISAGREEMENT");
    const item = { trace, posts: application, gasUsed: maximumGasUsed, settlementDigest: canonicalBrowserSha256V2("programmable.ethereum-swap-poststate.v1", application[0]) };
    simulations.push(item);
    return item;
  };
  const readSettlement = async (simulation: Awaited<ReturnType<typeof simulate>>) => {
    const post = simulation.posts[0]!, owner = request.owner.toLowerCase();
    const nativeAfter = post[owner]?.balance === undefined ? BigInt(nativeBalance) : quantityV1(post[owner]!.balance);
    const [tokenBefore, tokenAfter] = await Promise.all([tokenUint("balanceOf", [request.owner]), tokenUint("balanceOf", [request.owner], post)]);
    // SWEEP returns pre-existing router dust as well as this transaction's
    // refund. Dust is neither paid input nor quoted swap output.
    const inputDecrease = request.side === "buy" ? BigInt(nativeBalance) - nativeAfter + BigInt(routerNativeBefore) : tokenBefore - tokenAfter;
    const outputIncrease = request.side === "buy" ? tokenAfter - tokenBefore : nativeAfter - BigInt(nativeBalance) - BigInt(routerNativeBefore);
    if (requiresFee) {
      const remaining = post[protocol.router.address.toLowerCase()]?.balance;
      if ((remaining === undefined ? BigInt(routerNativeBefore) : quantityV1(remaining)) !== 0n) return unavailable("ETHEREUM_REFUND_UNPROVEN");
    }
    const takes = successfulTradeFramesV1(simulation.trace).filter(frame => frame.type === "CALL" && frame.to && same(frame.to, protocol.poolManager.address) && same(frame.from, protocol.router.address)).flatMap(frame => {
      try { const decoded = decodeFunctionData({ abi: takeAbi, data: frame.input });
        return same(decoded.args[0], request.side === "buy" ? request.token : NATIVE) ? [{ recipient: decoded.args[1], amount: decoded.args[2] }] : []; } catch { return []; }
    });
    const charge = requiresFee && !native30Proof;
    let traderOutput = outputIncrease;
    let grossNative = request.side === "buy" ? BigInt(request.amountIn) : outputIncrease;
    let platform = 0n;
    if (charge && request.side === "sell") {
      // V4Router skips a zero-value TAKE_PORTION. Tiny positive outputs may
      // therefore contain only the trader's take, with a rounded fee of zero.
      const zeroFeeTake = takes.length === 1 && same(takes[0]!.recipient, request.owner)
        && takes[0]!.amount > 0n && takes[0]!.amount * BigInt(feePolicy!.policy.rateBps) / 10_000n === 0n;
      if (!zeroFeeTake && (takes.length !== 2 || !same(takes[0]!.recipient, recipient) || !same(takes[1]!.recipient, request.owner))) {
        return unavailable("ETHEREUM_FEE_TRANSFER_UNPROVEN");
      }
      traderOutput = takes[zeroFeeTake ? 0 : 1]!.amount;
      const paidFee = zeroFeeTake ? 0n : takes[0]!.amount;
      grossNative = paidFee + traderOutput;
      platform = grossNative * BigInt(feePolicy!.policy.rateBps) / 10_000n;
      if (paidFee !== platform || outputIncrease !== traderOutput + (same(request.owner, recipient) ? platform : 0n)) {
        return unavailable("ETHEREUM_FEE_TRANSFER_UNPROVEN");
      }
    } else if (takes.length !== 1 || !same(takes[0]!.recipient, request.owner) || takes[0]!.amount !== outputIncrease) {
      return unavailable("ETHEREUM_SWAP_SETTLEMENT_UNPROVEN");
    }
    if (charge && request.side === "buy") {
      platform = grossNative * BigInt(feePolicy!.policy.rateBps) / 10_000n;
      const payments = successfulTradeFramesV1(simulation.trace).filter(frame => frame.type === "CALL"
        && frame.to && same(frame.to, recipient) && same(frame.from, protocol.router.address)
        && frame.input === "0x" && BigInt(frame.value) > 0n);
      if (platform > 0n && (payments.length !== 1 || BigInt(payments[0]!.value) !== platform)) return unavailable("ETHEREUM_FEE_TRANSFER_UNPROVEN");
    }
    if (inputDecrease < 0n || inputDecrease > BigInt(request.amountIn) || traderOutput <= 0n) return unavailable("ETHEREUM_SWAP_SETTLEMENT_UNPROVEN");
    if (charge && !same(request.owner, recipient)) {
      const recipientAfter = post[recipient.toLowerCase()]?.balance === undefined ? BigInt(recipientBefore)
        : quantityV1(post[recipient.toLowerCase()]!.balance);
      if (recipientAfter - BigInt(recipientBefore) < platform) return unavailable("ETHEREUM_FEE_BALANCE_UNPROVEN");
    }
    let accrual: Record<string, unknown> | null = null;
    if (native30Proof) {
      accrual = await proveEthereumNative30TradeAccrualV1({ proof: native30Proof,
        request: { zeroForOne: request.side === "buy", amountIn: request.amountIn, nativeInput: inputDecrease.toString(), hookData: "0x" },
        router: getAddress(protocol.router.address), trace: simulation.trace, post, call });
      grossNative = BigInt(accrual.grossNativeAmount as string);
      platform = BigInt(accrual.platformAccruedIncrease as string);
    }
    if (fee) fee = { ...fee, grossNativeAmount: grossNative.toString(), platformFeeAmount: platform.toString(),
      netNativeAmount: (grossNative - platform).toString(), accrual };
    return traderOutput;
  };
  let amountOut = 0n;
  if (!transaction) {
    // Quote the actual wallet's transaction, including arbitrary hook fees and
    // transfer effects. A Quoter's different caller is not routing authority.
    amountOut = await readSettlement(await simulate(ethereumStampedProbeTransaction(route, request, native30Proof)));
    transaction = ethereumStampedSwapTransaction(route, request, amountOut, native30Proof);
  }
  const [finalSimulation, estimatedGas] = await Promise.all([
    simulate(transaction),
    readTradeGasEstimateV1(rpcs, { from: request.owner, to: transaction.to, data: transaction.data, value: toHex(BigInt(transaction.value)) }, tag),
  ]);
  if (transaction.kind === "swap") {
    if (await readSettlement(finalSimulation) !== amountOut) return unavailable("ETHEREUM_SWAP_QUOTE_CHANGED");
  } else if (transaction.kind === "token-to-permit2") {
    if (await tokenUint("allowance", [request.owner, getAddress(protocol.permit2.address)], finalSimulation.posts[0]) !== BigInt(request.amountIn)) return unavailable("ETHEREUM_APPROVAL_UNPROVEN");
  } else {
    const raw = await call(getAddress(protocol.permit2.address), encodeFunctionData({ abi: customTradePermit2Abi, functionName: "allowance", args: [request.owner, request.token, getAddress(protocol.router.address)] }), finalSimulation.posts[0]);
    const [amount, expiration] = decodeFunctionResult({ abi: customTradePermit2Abi, functionName: "allowance", data: raw });
    if (amount !== BigInt(request.amountIn) || BigInt(expiration) !== BigInt(request.deadline) + ETHEREUM_PERMIT2_APPROVAL_GRACE_SECONDS) return unavailable("ETHEREUM_APPROVAL_UNPROVEN");
  }
  // Capture all contracts actually reached, including DELEGATECALL targets.
  // Genesis proxy code is checked above; current implementations stay mutable.
  const missing = [...reached].filter(address => !runtimeBindings.some(binding => same(binding.address, address)));
  const observed = await Promise.all(missing.map(async address => {
    const code = bytesV1(await rpc("eth_getCode", [getAddress(address), reference], bytesV1));
    if (code === "0x" && simulations.some(simulation => successfulTradeFramesV1(simulation.trace).some(frame => frame.type === "DELEGATECALL" && frame.to && same(frame.to, address)))) return unavailable("ETHEREUM_SWAP_IMPLEMENTATION_UNPROVEN");
    return code === "0x" ? null : { address: getAddress(address), runtimeCodeHash: keccak256(code) };
  }));
  runtimeBindings.push(...observed.filter((binding): binding is EthereumSwapRuntimeBinding => binding !== null));
  runtimeBindings.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const gas = BigInt(estimatedGas);
  if (gas < finalSimulation.gasUsed || gas > 2_000_000n || BigInt(gasPrice) <= 0n) return unavailable("ETHEREUM_SWAP_GAS_INVALID");
  const gasLimit = (gas * 120n + 99n) / 100n, gasReserve = (gasLimit * BigInt(gasPrice) * 125n + 99n) / 100n;
  if (BigInt(nativeBalance) < BigInt(transaction.value) + gasReserve) throw new EthereumStampedSwapError("Keep some ETH in your wallet for gas.", "ETHEREUM_NATIVE_BALANCE", 400);
  if ((await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1)).hash !== block.hash || now() > BigInt(block.timestamp) + 60n) return unavailable("ETHEREUM_SWAP_CHECKPOINT_CHANGED");
  const validUntil = now() + 25n < BigInt(request.deadline) ? now() + 25n : BigInt(request.deadline);
  const body: Omit<EthereumStampedSwapPreparation, "preparationDigest"> = {
    schemaVersion: "programmable.ethereum-stamped-swap-preparation.v1", status: transaction.kind === "swap" ? "ready" : "approval-required", request,
    quote: { amountOut: amountOut.toString(), amountOutMinimum: (amountOut * (10_000n - BigInt(request.slippageBps)) / 10_000n).toString(), blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, validUntil: validUntil.toString() },
    transaction: { ...transaction, gasLimit: gasLimit.toString() },
    ...(fee ? { fee } : {}),
    evidence: { kind: "independent-rpc-simulation", runtimeBindings, runtimeBindingHash: ethereumStampedRuntimeDigest(runtimeBindings),
      executionDigest: canonicalBrowserSha256V2("programmable.ethereum-swap-execution.v1", simulations.map(item => ({ trace: item.trace, settlementDigest: item.settlementDigest }))) },
  };
  return { ...body, preparationDigest: ethereumStampedPreparationDigest(body) };
}
