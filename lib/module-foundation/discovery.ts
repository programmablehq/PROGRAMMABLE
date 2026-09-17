import {
  decodeAbiParameters, decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult,
  getAbiItem, getAddress, isHex, keccak256, parseAbiParameters,
  type Address, type Hex, type PublicClient,
} from "viem";
import { foundationFactoryV2Abi, foundationMetadataParameters, foundationTokenAbi } from "./abi";
import { assertFoundationInfrastructure, type FoundationCheckpoint, type FoundationDeploymentBinding } from "./client";
import { FOUNDATION_CHAIN_ID, FOUNDATION_LP_CUSTODY_DEAD_ID } from "./constants";
import { foundationReadbackAbi, verifyFoundationLaunchReceipt } from "./readback";
import { foundationPoolId, foundationPoolKey } from "./route";
import { assertFoundationV2Result, foundationFactoryAbiFor, foundationFactoryVersion, readFoundationLaunchRecord } from "./protocol";

export const FOUNDATION_DISCOVERY_MAX_BLOCKS = 5_000n;
const MAX_EXPLORER_BYTES = 65_536;
const MAX_CALLDATA_BYTES = 160_000; // Eight bounded 16 KiB module configurations plus ABI and token metadata.
const MAX_INDEX_LOGS = 2_000;
const EXPLORER_TIMEOUT_MS = 8_000;
const explorerOrigin = "https://robinhoodchain.blockscout.com";
const launchEvent = getAbiItem({ abi: foundationReadbackAbi, name: "FoundationLaunched" });
const launchEventV2 = getAbiItem({ abi: foundationFactoryV2Abi, name: "FoundationLaunchedV2" });
const cursorAbi = parseAbiParameters("uint8,uint256,address,bytes32,uint256,uint256,address,bytes32,uint256,uint32,uint32");
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const sameAddress = (a: Address, b: Address) => getAddress(a) === getAddress(b);
const sameHex = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
function decodeLaunchEvent(binding: FoundationDeploymentBinding, data: Hex, topics: [] | [Hex, ...Hex[]]) {
  if (foundationFactoryVersion(binding) === "v2") {
    const event = decodeEventLog({ abi: foundationFactoryV2Abi, eventName: "FoundationLaunchedV2", data, topics, strict: true }).args;
    assertFoundationV2Result(event.result);
    if (!sameAddress(event.token, event.result.token) || !sameAddress(event.hook, event.result.hook)
      || !sameAddress(event.ledger, event.result.ledger) || !sameHex(event.poolId, event.result.poolId)
      || !sameHex(event.custodyId, FOUNDATION_LP_CUSTODY_DEAD_ID)) throw new Error("The V2 event has inconsistent identities or custody.");
    return { ...event, ...event.result, factoryVersion: "v2" as const };
  }
  const event = decodeEventLog({ abi: foundationReadbackAbi, eventName: "FoundationLaunched", data, topics, strict: true }).args;
  return { ...event, factoryVersion: "v1" as const };
}

/** A locator supplies an untrusted candidate hash. It never establishes launch identity or execution authority. */
export type FoundationLaunchLocator = (token: Address, options?: { signal?: AbortSignal }) => Promise<Hex | null>;

function transactionHash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) {
    throw new Error("The launch locator returned an invalid transaction hash.");
  }
  return value as Hex;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Launch discovery cancelled.");
}

/** Fixed public origin, no credentials or redirects, bounded streaming body and timeout. CORS may require an injected BFF locator. */
export const locateFoundationCreationTransaction: FoundationLaunchLocator = async (rawToken, options = {}) => {
  const token = getAddress(rawToken);
  if (BigInt(token) === 0n) throw new Error("A token address is required.");
  checkAbort(options.signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Launch history lookup timed out.")), EXPLORER_TIMEOUT_MS);
  try {
    const response = await fetch(`${explorerOrigin}/api/v2/addresses/${token}`, {
      method: "GET", headers: { accept: "application/json" }, credentials: "omit", redirect: "error",
      cache: "no-store", signal: controller.signal,
    });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw new Error("Launch history is temporarily unavailable.");
    }
    const length = response.headers.get("content-length");
    if ((length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_EXPLORER_BYTES)) || !response.body) {
      await response.body?.cancel();
      throw new Error("The launch history response exceeds its supported size.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_EXPLORER_BYTES) throw new Error("The launch history response exceeds its supported size.");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("The launch history response is invalid.");
    const object = payload as Record<string, unknown>;
    if (object.hash !== undefined && (typeof object.hash !== "string" || !sameAddress(getAddress(object.hash), token))) {
      throw new Error("The launch locator returned a different token.");
    }
    // Explorer creator, verification, implementation and creation-status claims are intentionally unused.
    const candidate = object.creation_transaction_hash;
    return candidate === null || candidate === undefined ? null : transactionHash(candidate);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
};

async function assertCanonical(client: PublicClient, checkpoint: FoundationCheckpoint) {
  const block = await client.getBlock({ blockNumber: checkpoint.blockNumber });
  if (block.number !== checkpoint.blockNumber || !block.hash || !sameHex(block.hash, checkpoint.blockHash)) {
    throw new Error("The launch discovery block is no longer canonical. Refresh the history.");
  }
}

/** Restore generic selections from a direct, successful factory launch. Internal calls need separate trace evidence. */
export async function discoverFoundationLaunch(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; token: Address;
  locator?: FoundationLaunchLocator; transactionHash?: Hex; signal?: AbortSignal;
}) {
  const { client, binding } = input, token = getAddress(input.token), factoryAbi = foundationFactoryAbiFor(binding);
  checkAbort(input.signal);
  const observedAt = await assertFoundationInfrastructure(client, binding);
  const record = await readFoundationLaunchRecord(client, binding, token, observedAt.blockNumber);
  if (BigInt(token) === 0n || !sameAddress(record.token, token) || BigInt(record.hook) === 0n || BigInt(record.ledger) === 0n) {
    throw new Error("This token is not registered by the selected foundation factory.");
  }
  const candidate = input.transactionHash ?? await (input.locator ?? locateFoundationCreationTransaction)(token, { signal: input.signal });
  checkAbort(input.signal);
  if (candidate === null) throw new Error("No creation transaction was found. A bounded recent launch lookup can supply another candidate.");
  const hash = transactionHash(candidate);
  const mined = await client.getTransaction({ hash });
  if (!sameHex(mined.hash, hash) || !mined.to || !sameAddress(mined.to, binding.factory.address) || BigInt(mined.from) === 0n
    || mined.value !== 0n || mined.blockNumber === null || !mined.blockHash || mined.blockNumber < binding.startBlock
    || mined.blockNumber > observedAt.blockNumber || mined.input.length > MAX_CALLDATA_BYTES * 2 + 2) {
    throw new Error("The candidate is not a mined transaction to the selected foundation factory.");
  }
  const decoded = decodeFunctionData({ abi: factoryAbi, data: mined.input });
  if (decoded.functionName !== "launch") throw new Error("The candidate transaction does not call foundation launch.");
  const parameters = decoded.args[0];
  if (!sameHex(encodeFunctionData({ abi: factoryAbi, functionName: "launch", args: [parameters] }), mined.input)) {
    throw new Error("The launch calldata is not its exact canonical ABI encoding.");
  }
  const [predictedToken, predictedHook] = await Promise.all([
    client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: "predictTokenAddress",
      args: [mined.from, parameters.tokenSalt, parameters.metadata], blockNumber: mined.blockNumber }),
    client.readContract({ address: binding.factory.address, abi: factoryAbi, functionName: "predictHookAddress",
      args: [mined.from, token, parameters], blockNumber: mined.blockNumber }),
  ]);
  const key = foundationPoolKey({ token, quote: parameters.quote, hook: predictedHook });
  if (!sameAddress(predictedToken, token) || !sameAddress(predictedHook, record.hook) || !sameHex(foundationPoolId(key), record.poolId)) {
    throw new Error("The candidate launch parameters belong to a different token or pool.");
  }
  const metadataHash = keccak256(encodeAbiParameters(foundationMetadataParameters, [parameters.metadata]));
  const transaction = { from: getAddress(mined.from), to: getAddress(mined.to), data: mined.input, value: mined.value };
  const receipt = await verifyFoundationLaunchReceipt({ client, binding, transactionHash: hash,
    expected: { transaction, parameters, result: record, metadataHash } });
  checkAbort(input.signal);
  await assertCanonical(client, observedAt);
  return { evidence: "canonical-launch-discovery" as const, sourceKind: "module-foundation-v1" as const,
    token, transactionHash: hash, transaction, parameters, moduleSelections: parameters.modules,
    metadataHash, receipt, checkpoint: receipt.checkpoint, observedAt };
}

export type FoundationDiscoveredLaunch = Awaited<ReturnType<typeof discoverFoundationLaunch>>;

interface LogPosition { blockNumber: bigint; transactionIndex: number; logIndex: number }
const after = (a: LogPosition, b: LogPosition) => a.blockNumber < b.blockNumber
  || (a.blockNumber === b.blockNumber && (a.transactionIndex < b.transactionIndex
    || (a.transactionIndex === b.transactionIndex && a.logIndex < b.logIndex)));

async function mapBounded<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

/** Descending canonical event index inside an explicit window. Cursor pagination never expands the requested range. */
export async function readFoundationLaunchIndex(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; fromBlock: bigint; toBlock: bigint;
  token?: Address; pageSize?: number; cursor?: Hex; signal?: AbortSignal;
}) {
  const { client, binding, fromBlock, toBlock } = input, pageSize = input.pageSize ?? 25;
  if (typeof fromBlock !== "bigint" || typeof toBlock !== "bigint" || fromBlock < binding.startBlock || toBlock < fromBlock
    || toBlock - fromBlock + 1n > FOUNDATION_DISCOVERY_MAX_BLOCKS || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Choose an explicit launch-history range of at most 5,000 blocks and a page size from 1 to 100.");
  }
  const token = input.token ? getAddress(input.token) : null;
  if (token && BigInt(token) === 0n) throw new Error("A token filter must be a nonzero address.");
  checkAbort(input.signal);
  const checkpoint = await assertFoundationInfrastructure(client, binding, toBlock);
  if (checkpoint.blockNumber !== toBlock) throw new Error("The launch index anchor does not match its requested block.");
  let position: LogPosition | null = null;
  if (input.cursor) {
    if (!isHex(input.cursor) || input.cursor.length !== 11 * 64 + 2) throw new Error("Invalid launch-history cursor.");
    const [version, chainId, factory, releaseDigest, from, to, filter, anchorHash, blockNumber, transactionIndex, logIndex] = decodeAbiParameters(cursorAbi, input.cursor);
    if (version !== 1 || chainId !== BigInt(FOUNDATION_CHAIN_ID) || !sameAddress(factory, binding.factory.address)
      || !sameHex(releaseDigest, binding.releaseDigest) || from !== fromBlock || to !== toBlock
      || !sameAddress(filter, token ?? zeroAddress) || !sameHex(anchorHash, checkpoint.blockHash)
      || blockNumber < fromBlock || blockNumber > toBlock) throw new Error("The launch-history cursor belongs to a different window, filter or canonical chain.");
    position = { blockNumber, transactionIndex, logIndex };
  }
  const logs = await client.getLogs({ address: binding.factory.address, event: foundationFactoryVersion(binding) === "v2" ? launchEventV2 : launchEvent, strict: true,
    args: token ? { token } : undefined, fromBlock, toBlock });
  if (logs.length > MAX_INDEX_LOGS) throw new Error("This launch-history range is too busy. Choose a smaller block window.");
  const identities = new Set<string>();
  const parsed = logs.map(log => {
    if (!sameAddress(log.address, binding.factory.address) || log.removed || log.blockNumber < fromBlock || log.blockNumber > toBlock
      || !log.blockHash || !log.transactionHash || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0
      || !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0) throw new Error("A launch log has an invalid origin or block position.");
    const event = decodeLaunchEvent(binding, log.data, log.topics);
    if ((token && !sameAddress(event.token, token)) || BigInt(event.token) === 0n || BigInt(event.creator) === 0n
      || !sameHex(foundationPoolId(foundationPoolKey({ token: event.token, quote: event.quote, hook: event.hook })), event.poolId)) {
      throw new Error("A launch log does not match the requested token or foundation pool identity.");
    }
    const identity = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    if (identities.has(identity)) throw new Error("The launch index contains duplicate log positions.");
    identities.add(identity);
    return { ...event, blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: transactionHash(log.transactionHash),
      transactionIndex: log.transactionIndex, logIndex: log.logIndex };
  }).sort((a, b) => after(a, b) ? 1 : after(b, a) ? -1 : 0);
  const remaining = position ? parsed.filter(log => after(log, position!)) : parsed;
  const page = remaining.slice(0, pageSize);
  const blocks = new Map<string, Promise<Awaited<ReturnType<PublicClient["getBlock"]>>>>();
  const entries = await mapBounded(page, async entry => {
    checkAbort(input.signal);
    const blockKey = entry.blockNumber.toString();
    let blockRead = blocks.get(blockKey);
    if (!blockRead) { blockRead = client.getBlock({ blockNumber: entry.blockNumber }); blocks.set(blockKey, blockRead); }
    const [block, record, metadataHash] = await Promise.all([
      blockRead,
      readFoundationLaunchRecord(client, binding, entry.token, toBlock),
      client.readContract({ address: entry.token, abi: foundationTokenAbi, functionName: "metadataHash", blockNumber: toBlock }),
    ]);
    if (block.number !== entry.blockNumber || !block.hash || !sameHex(block.hash, entry.blockHash)) throw new Error("A launch log is no longer in its canonical block.");
    if (!sameAddress(record.token, entry.token) || !sameAddress(record.hook, entry.hook) || !sameAddress(record.ledger, entry.ledger)
      || record.factoryVersion !== entry.factoryVersion
      || (record.factoryVersion === "v1" && (entry.factoryVersion !== "v1" || !sameAddress(record.baseVault, entry.baseVault)))
      || (record.factoryVersion === "v2" && (entry.factoryVersion !== "v2"
        || !sameHex(encodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launchOf", result: record }),
          encodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launchOf", result: entry.result }))))
      || !sameHex(record.poolId, entry.poolId)
      || record.basePositionId !== entry.basePositionId || record.basePositionId === 0n || record.creatorPositionId !== entry.creatorPositionId
      || record.initialBuyTokenAmount !== entry.initialBuyTokenAmount || !sameHex(metadataHash, entry.metadataHash)) {
      throw new Error("A launch index entry disagrees with the canonical factory or token state.");
    }
    return { ...entry, sourceKind: "module-foundation-v1" as const };
  });
  checkAbort(input.signal);
  await assertCanonical(client, checkpoint);
  const last = entries.at(-1);
  const nextCursor = remaining.length > pageSize && last ? encodeAbiParameters(cursorAbi, [1, BigInt(FOUNDATION_CHAIN_ID),
    binding.factory.address, binding.releaseDigest, fromBlock, toBlock, token ?? zeroAddress, checkpoint.blockHash,
    last.blockNumber, last.transactionIndex, last.logIndex]) : null;
  return { evidence: "canonical-launch-index" as const, checkpoint, fromBlock, toBlock, token, entries, nextCursor };
}

export type FoundationLaunchIndexPage = Awaited<ReturnType<typeof readFoundationLaunchIndex>>;
