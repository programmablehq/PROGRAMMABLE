import "server-only";
import { boundedEvmFetch } from "@/lib/server/evm-bounded-fetch";
import { createPublicClient, http, decodeFunctionResult, encodeFunctionData, encodeAbiParameters, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { readHyperEvmLaunchEvidence } from "@/lib/server/hyperevm-explore";
import type { FinalizedCustomLaunchMetadataV1 } from "@/lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1";
import { EVM_FEE_CLAIM_SCHEMA, EVM_FEE_VAULT_ABI, EVM_SWAP_SCHEMA, EVM_SWAP_PROTOCOLS, EVM_TOKEN_ABI, EVM_PERMIT2_ABI, NATIVE, buildEvmCustomSwap, buildEvmCustomApproval, evmCustomPreparationDigest, parseEvmCustomSwapRequest, type EvmCustomSwapDescriptor, type EvmCustomSwapPreparation, type EvmCustomSwapTransaction, type EvmFeeClaimPreparation } from "@/lib/swap/evm-custom";
import quoteArtifact from "@/lib/swap/evm-quote-artifact.json";
type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hex = (v: unknown): Hex => { if (typeof v !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(v))
  throw Error("Malformed RPC result"); return v as Hex; };
const quantity = (v: unknown) => { if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v))
  throw Error("Malformed RPC quantity"); return BigInt(v); };
export async function estimateHyperEvmGas(rpcs: readonly [Rpc, Rpc], transaction: {
  from: Address; to: Address; data: Hex; value: string;
}) {
  // dRPC rejects HyperEVM estimates with the optional block parameter. The
  // execution and quote reads remain pinned to their verified block above.
  const estimates = await Promise.all(rpcs.map(r => r("eth_estimateGas", [transaction]).then(quantity)));
  return (estimates[0] > estimates[1] ? estimates[0] : estimates[1]) * 120n / 100n;
}
const STAMP = parseAbi(["function launchIdByToken(address) view returns(bytes32)", "function componentRuntimeCodeHash(address) view returns(bytes32)", "function launchStamp(bytes32) view returns((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash))"]);
const QUOTE = parseAbi(["function quote(address,address,address,address,uint160,uint48,bytes) returns(uint256)"]);
const clients = new Map<string, ReturnType<typeof createPublicClient>>();
const paused = new Map<string, number>();
let activePreparations = 0;
const inflight = new Map<string, Promise<EvmCustomSwapPreparation>>();
const inflightFeeClaims = new Map<string, Promise<EvmFeeClaimPreparation>>();
const origins = new Map<string, {
  expires: number;
  value: Promise<EvmCustomSwapDescriptor>;
}>();
export class EvmSwapError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}
export function hyperEvmSwapRpcs(): readonly [
  Rpc,
  Rpc
] {
  const endpoints = [process.env.HYPEREVM_RPC_PRIMARY_URL, process.env.HYPEREVM_RPC_SECONDARY_URL ?? "https://rpc.hyperliquid.xyz/evm"];
  const hosts = endpoints.map(value => { if (!value)
    throw new EvmSwapError("HyperEVM trading is temporarily unavailable."); const u = new URL(value); if (u.protocol !== "https:" || u.username || u.password || u.hash)
    throw new EvmSwapError("HyperEVM trading is temporarily unavailable."); return u.hostname; });
  if (hosts[0] === hosts[1] || !hosts.includes("rpc.hyperliquid.xyz"))
    throw new EvmSwapError("Independent HyperEVM providers are required.");
  return endpoints.map(endpoint => {
    let client = clients.get(endpoint!);
    if (!client) {
      client = createPublicClient({ transport: http(endpoint, { retryCount: 0, timeout: 10000, fetchFn: boundedEvmFetch, batch: { batchSize: 16, wait: 2 } }) });
      clients.set(endpoint!, client);
    }
    let reads = 0;
    const selected = client;
    return async (method: string, params: readonly unknown[]) => {
      if (++reads > 60 || (paused.get(endpoint!) ?? 0) > Date.now())
        throw new EvmSwapError("Trade checks are busy. Try again shortly.", 429);
      try {
        return await selected.request({ method, params } as never);
      }
      catch (error) {
        if (/429|rate.?limit|quota|503/i.test(String(error)))
          paused.set(endpoint!, Date.now() + 15000);
        throw new EvmSwapError("The trade could not be simulated. Check your balance and try again.");
      }
    };
  }) as unknown as readonly [
    Rpc,
    Rpc
  ];
}
const agree = async (rpcs: readonly [
  Rpc,
  Rpc
], method: string, params: readonly unknown[]) => {
  const values = await Promise.all(rpcs.map(r => r(method, params)));
  const comparable = values.map(value => {
    if (method === "eth_getTransactionReceipt" && value !== null) return receiptForConsensus(value);
    if (method !== "eth_getBlockByNumber" || value === null || typeof value !== "object" || Array.isArray(value)) return value;
    // HyperEVM providers serialize the same block differently. `size` is
    // transport metadata; the block hash and all remaining fields must agree.
    const block = { ...value as Record<string, unknown> };
    delete block.size;
    return block;
  });
  if (canonicalBrowserJsonV2(comparable[0]) !== canonicalBrowserJsonV2(comparable[1]))
    throw new EvmSwapError("Chain data is updating. Try again shortly.");
  return values[0];
};
export { agree as readHyperEvmRpcAgreement };

function receiptForConsensus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EvmSwapError("Invalid HyperEVM receipt.");
  const receipt = { ...value as Record<string, unknown> };
  if (![receipt.transactionHash, receipt.blockHash].every(hash => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash))) {
    throw new EvmSwapError("Invalid HyperEVM receipt identity.");
  }
  if (!Array.isArray(receipt.logs)) throw new EvmSwapError("Invalid HyperEVM receipt logs.");
  let previousIndex = -1n;
  const logs = receipt.logs.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new EvmSwapError("Invalid HyperEVM receipt logs.");
    const log = { ...value as Record<string, unknown> }, index = quantity(log.logIndex);
    if (log.transactionHash !== receipt.transactionHash || log.blockHash !== receipt.blockHash
      || quantity(log.blockNumber) !== quantity(receipt.blockNumber)
      || quantity(log.transactionIndex) !== quantity(receipt.transactionIndex)
      || index <= previousIndex || log.removed !== false
      || typeof log.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(log.address)
      || typeof log.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data)
      || !Array.isArray(log.topics) || log.topics.length > 4
      || log.topics.some(topic => typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic))) {
      throw new EvmSwapError("Invalid HyperEVM receipt logs.");
    }
    previousIndex = index;
    delete log.transactionIndex;
    delete log.logIndex;
    return log;
  });
  delete receipt.transactionIndex;
  return { ...receipt, logs };
}
export async function readHyperEvmSwapCheckpoint(rpcs: readonly [
  Rpc,
  Rpc
]) {
  const heads = await Promise.all(rpcs.map(r => r("eth_blockNumber", []).then(quantity)));
  const number = heads[0] < heads[1] ? heads[0] : heads[1];
  const raw = await agree(rpcs, "eth_getBlockByNumber", [toHex(number), false]) as {
    number: Hex;
    hash: Hex;
    timestamp: Hex;
  };
  if (!raw?.hash || quantity(raw.number) !== number || Date.now() / 1000 - Number(quantity(raw.timestamp)) > 120)
    throw new EvmSwapError("HyperEVM data is temporarily stale.");
  return { number, hash: hex(raw.hash) };
}
async function call(rpcs: readonly [
  Rpc,
  Rpc
], to: Address, data: Hex, reference: unknown) { return hex(await agree(rpcs, "eth_call", [{ to, data }, reference])); }
async function origin(launch: FinalizedCustomLaunchMetadataV1, rpcs: readonly [
  Rpc,
  Rpc
]): Promise<EvmCustomSwapDescriptor> {
  const p = EVM_SWAP_PROTOCOLS[999];
  if (!launch.poolKey || !launch.creator || !launch.routingFeePolicy || !same(launch.router, p.router) || !same(launch.poolManager, p.poolManager))
    throw new EvmSwapError("This launch has no verified trading route.");
  const reference = { blockHash: launch.finality.blockHash, requireCanonical: true };
  const [receiptRaw, stampRaw, launchIdRaw, ...codes] = await Promise.all([
    agree(rpcs, "eth_getTransactionReceipt", [launch.finality.transactionHash]),
    call(rpcs, getAddress(p.router), encodeFunctionData({ abi: STAMP, functionName: "launchStamp", args: [launch.routerLaunchId] }), reference),
    call(rpcs, getAddress(p.router), encodeFunctionData({ abi: STAMP, functionName: "launchIdByToken", args: [launch.token] }), reference),
    ...([p.router, p.poolManager, p.universalRouter, p.permit2] as Address[]).map(a => agree(rpcs, "eth_getCode", [a, reference]).then(hex)),
  ]);
  const receipt = receiptRaw as {
    status: Hex;
    blockHash: Hex;
    blockNumber: Hex;
    to: Address;
  };
  if (quantity(receipt.status) !== 1n || !same(receipt.blockHash, launch.finality.blockHash) || quantity(receipt.blockNumber) !== BigInt(launch.finality.blockNumber) || !same(receipt.to, p.router))
    throw new EvmSwapError("Launch finality could not be verified.");
  const hashes = [p.routerHash, p.poolManagerHash, p.universalRouterHash, p.permit2Hash];
  if (codes.some((code, i) => keccak256(code) !== hashes[i]))
    throw new EvmSwapError("Trading contracts changed.");
  const stamp = decodeFunctionResult({ abi: STAMP, functionName: "launchStamp", data: stampRaw });
  const binding = launch.routingFeePolicy.stampBinding;
  const key = launch.poolKey;
  const poolKeyHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [keccak256(toHex("ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)")), key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  if (!same(decodeFunctionResult({ abi: STAMP, functionName: "launchIdByToken", data: launchIdRaw }), launch.routerLaunchId) || !same(stamp.token, launch.token) || !same(stamp.hook, launch.hook) || !same(stamp.launchWallet, launch.creator) || !same(stamp.poolManager, p.poolManager) || !same(stamp.poolId, launch.poolId) || !same(stamp.poolKeyHash, poolKeyHash) || !same(stamp.stampHash, binding.stampHash) || !same(stamp.permitDigest, binding.permitDigest) || !same(stamp.routePayloadHash, binding.routePayloadHash))
    throw new EvmSwapError("Launch trading evidence changed.");
  const quote = same(key.currency0, launch.token) ? key.currency1 : key.currency0;
  const decimals = async (token: Address) => same(token, NATIVE) ? 18 : Number(decodeFunctionResult({ abi: EVM_TOKEN_ABI, functionName: "decimals", data: await call(rpcs, token, encodeFunctionData({ abi: EVM_TOKEN_ABI, functionName: "decimals" }), reference) }));
  const [tokenDecimals, quoteDecimals] = await Promise.all([decimals(launch.token), decimals(quote)]);
  if ([tokenDecimals, quoteDecimals].some(v => !Number.isInteger(v) || v < 0 || v > 36))
    throw new EvmSwapError("Unsupported token precision.");
  return { chainId: 999, token: launch.token, creator: launch.creator, poolId: launch.poolId, poolKey: key, launchId: launch.routerLaunchId, launchTransaction: launch.finality.transactionHash, stampHash: binding.stampHash, tokenDecimals, quoteDecimals, quoteSymbol: same(quote, NATIVE) ? "HYPE" : `${quote.slice(0, 6)}…${quote.slice(-4)}`, quoteAsset: quote };
}
export async function readHyperEvmSwapDescriptor(token: string, rpcs = hyperEvmSwapRpcs(), readLaunch = readHyperEvmLaunchEvidence) {
  if (!/^0x[0-9a-f]{40}$/i.test(token))
    throw new EvmSwapError("Invalid token.", 400);
  const launch = await readLaunch(token);
  if (!launch)
    throw new EvmSwapError("This launch is not indexed yet.", 404);
  const key = launch.finality.transactionHash, prior = origins.get(key);
  if (prior && prior.expires > Date.now())
    return prior.value;
  const value = origin(launch, rpcs).catch(error => { origins.delete(key); throw error; });
  if (origins.size >= 128)
    origins.delete(origins.keys().next().value!);
  origins.set(key, { expires: Date.now() + 300000, value });
  return value;
}
export async function prepareHyperEvmSwap(input: unknown, dependencies: {
  rpcs?: readonly [
    Rpc,
    Rpc
  ];
  readLaunch?: typeof readHyperEvmLaunchEvidence;
} = {}) {
  let request: ReturnType<typeof parseEvmCustomSwapRequest>;
  try { request = parseEvmCustomSwapRequest(input); }
  catch { throw new EvmSwapError("Invalid trade request.", 400); }
  const now = Math.floor(Date.now() / 1000);
  if (request.chainId !== 999)
    throw new EvmSwapError("Unsupported trade chain.", 400);
  if (BigInt(request.deadline) < BigInt(now + 30) || BigInt(request.deadline) > BigInt(now + 1200))
    throw new EvmSwapError("Refresh your trade request.", 400);
  const key = canonicalBrowserJsonV2(request);
  const prior = inflight.get(key);
  if (prior)
    return prior;
  if (activePreparations >= 8)
    throw new EvmSwapError("Trade checks are busy. Try again shortly.", 429);
  activePreparations++;
  const work = (async () => {
    const rpcs = dependencies.rpcs ?? hyperEvmSwapRpcs();
    const descriptor = await readHyperEvmSwapDescriptor(request.token, rpcs, dependencies.readLaunch);
    const block = await readHyperEvmSwapCheckpoint(rpcs), reference = { blockHash: block.hash, requireCanonical: true }, p = EVM_SWAP_PROTOCOLS[999];
    const inputToken = request.buy ? descriptor.quoteAsset : descriptor.token, output = request.buy ? descriptor.token : descriptor.quoteAsset;
    // The same caller and balances are used; only quote helper code and transient approvals are overridden.
    const tx = buildEvmCustomSwap(descriptor, request, "0");
    const callData = encodeFunctionData({ abi: QUOTE, functionName: "quote", args: [inputToken, output, getAddress(p.permit2), getAddress(p.universalRouter), BigInt(request.amountIn), Number(request.deadline), tx.data] });
    const amountOut = decodeFunctionResult({ abi: QUOTE, functionName: "quote", data: hex(await agree(rpcs, "eth_call", [{ from: request.owner, to: request.owner, data: callData }, reference, { [request.owner]: { code: quoteArtifact.runtime } }])) });
    const minimumOut = amountOut * BigInt(10000 - request.slippageBps) / 10000n;
    if (minimumOut <= 0n)
      throw new EvmSwapError("The trade amount is too small.", 400);
    let transaction: EvmCustomSwapTransaction = buildEvmCustomSwap(descriptor, request, minimumOut.toString());
    if (!same(inputToken, NATIVE)) {
      const [erc, permit] = await Promise.all([
        call(rpcs, inputToken, encodeFunctionData({ abi: EVM_TOKEN_ABI, functionName: "allowance", args: [request.owner, getAddress(p.permit2)] }), reference),
        call(rpcs, getAddress(p.permit2), encodeFunctionData({ abi: EVM_PERMIT2_ABI, functionName: "allowance", args: [request.owner, inputToken, getAddress(p.universalRouter)] }), reference)
      ]);
      const allowance = decodeFunctionResult({ abi: EVM_TOKEN_ABI, functionName: "allowance", data: erc });
      const [permitted, expiration] = decodeFunctionResult({ abi: EVM_PERMIT2_ABI, functionName: "allowance", data: permit });
      if (allowance < BigInt(request.amountIn))
        transaction = buildEvmCustomApproval(request, descriptor, "token-approval");
      else if (permitted < BigInt(request.amountIn) || BigInt(expiration) < BigInt(request.deadline))
        transaction = buildEvmCustomApproval(request, descriptor, "permit2-approval");
    }
    const gas = await estimateHyperEvmGas(rpcs, { from: transaction.from, to: transaction.to, data: transaction.data, value: toHex(BigInt(transaction.value)) });
    if (gas < 21000n || gas > 3000000n)
      throw new EvmSwapError("Trade gas limit is not supported.");
    transaction = { ...transaction, gasLimit: gas.toString() };
    const body: Omit<EvmCustomSwapPreparation, "preparationDigest"> = { schemaVersion: EVM_SWAP_SCHEMA, status: transaction.kind === "swap" ? "ready" as const : "approval-required" as const, request, descriptor, quote: { amountOut: amountOut.toString(), minimumOut: minimumOut.toString(), blockNumber: block.number.toString(), blockHash: block.hash, validUntil: Math.floor(Date.now() / 1000) + 25 }, transaction };
    return { ...body, preparationDigest: evmCustomPreparationDigest(body) };
  })().finally(() => { activePreparations--; inflight.delete(key); });
  inflight.set(key, work);
  return work;
}
const HOOK_FEES = parseAbi(["function feeVault() view returns(address)", "function openingTaxVault() view returns(address)"]);
export async function prepareHyperEvmFeeClaim(input: unknown, dependencies: {
  rpcs?: readonly [Rpc, Rpc];
  readLaunch?: typeof readHyperEvmLaunchEvidence;
} = {}) {
  const q = input as {
    chainId: 999;
    token: Address;
    owner: Address;
    vaultKind: "fees" | "opening";
    recipientKind: "creator" | "platform";
  };
  if (!q || Object.keys(q).sort().join() !== "chainId,owner,recipientKind,token,vaultKind" || q.chainId !== 999 || ![q.owner, q.token].every(v => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v)) || !["fees", "opening"].includes(q.vaultKind) || !["creator", "platform"].includes(q.recipientKind))
    throw new EvmSwapError("Invalid fee claim.", 400);
  const key = canonicalBrowserJsonV2(q), prior = inflightFeeClaims.get(key);
  if (prior) return prior;
  if (activePreparations >= 8)
    throw new EvmSwapError("Transaction checks are busy. Try again shortly.", 429);
  activePreparations++;
  const work = (async () => {
    const rpcs = dependencies.rpcs ?? hyperEvmSwapRpcs(), descriptor = await readHyperEvmSwapDescriptor(q.token, rpcs, dependencies.readLaunch), block = await readHyperEvmSwapCheckpoint(rpcs), reference = { blockHash: block.hash, requireCanonical: true };
    const fn = q.vaultKind === "fees" ? "feeVault" : "openingTaxVault";
    const vault = decodeFunctionResult({ abi: HOOK_FEES, functionName: fn, data: await call(rpcs, descriptor.poolKey.hooks, encodeFunctionData({ abi: HOOK_FEES, functionName: fn }), reference) });
    const read = async (fn: "kernel" | "poolManager" | "creatorRecipient" | "PLATFORM_RECIPIENT" | "creatorAccrued" | "platformAccrued") => decodeFunctionResult({ abi: EVM_FEE_VAULT_ABI, functionName: fn, data: await call(rpcs, vault, encodeFunctionData({ abi: EVM_FEE_VAULT_ABI, functionName: fn }), reference) });
    const [kernel, manager, recipientRaw, amountRaw] = await Promise.all([read("kernel"), read("poolManager"), read(q.recipientKind === "creator" ? "creatorRecipient" : "PLATFORM_RECIPIENT"), read(q.recipientKind === "creator" ? "creatorAccrued" : "platformAccrued")]);
    if (typeof kernel !== "string" || !same(kernel, descriptor.poolKey.hooks) || typeof manager !== "string" || !same(manager, EVM_SWAP_PROTOCOLS[999].poolManager) || typeof recipientRaw !== "string" || typeof amountRaw !== "bigint")
      throw new EvmSwapError("Fee vault binding changed.");
    if (q.recipientKind === "platform" && !same(recipientRaw, EVM_SWAP_PROTOCOLS[999].platformTreasury))
      throw new EvmSwapError("Fee recipient changed.");
    if (amountRaw === 0n)
      throw new EvmSwapError("No fees are available to claim.", 409);
    const data = encodeFunctionData({ abi: EVM_FEE_VAULT_ABI, functionName: q.recipientKind === "creator" ? "claimCreator" : "claimPlatform" });
    const gas = await estimateHyperEvmGas(rpcs, { from: q.owner, to: vault, data, value: "0x0" });
    if (gas > 1000000n)
      throw new EvmSwapError("Fee claim gas limit is too high.");
    const body: Omit<EvmFeeClaimPreparation, "preparationDigest"> = { schemaVersion: EVM_FEE_CLAIM_SCHEMA, request: q, descriptor, vault, recipient: recipientRaw as Address, amount: amountRaw.toString(), validUntil: Math.floor(Date.now() / 1000) + 30, transaction: { from: q.owner, to: vault, data, value: "0" as const, gasLimit: gas.toString() } };
    return { ...body, preparationDigest: canonicalBrowserSha256V2(EVM_FEE_CLAIM_SCHEMA, body) };
  })().finally(() => { activePreparations--; inflightFeeClaims.delete(key); });
  inflightFeeClaims.set(key, work);
  return work;
}
