import "server-only";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { agreedTradeRpcV1, bytesV1, quantityV1, readTradeCheckpointV1, tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import { CustomAIError } from "./types";

const ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const TTL_MS = 10_000, NEGATIVE_TTL_MS = 5_000, MAX_READS_PER_PROVIDER = 12;
const unavailable = () => new CustomAIError("dependency-observation", "The launch dependencies could not be checked at a recent shared block. Your source is saved.", 503);
type ObservedCode = { address: Address; runtimeCode: Hex; runtimeCodeHash: Hex };
export type LaunchDependencyObservation = {
  version: 1; id: `sha256:${string}`; productionId: `sha256:${string}`;
  chainId: LaunchProductionContext["chainId"];
  authority: "two-provider-observation"; launchReady: false;
  block: { number: string; hash: Hex; timestamp: string };
  observedAt: number; expiresAt: number;
  poolManager: ObservedCode; swapRouter: ObservedCode;
  nativeUsdFeed: ObservedCode & { decimals: number; roundId: string; answer: string; updatedAt: string; answeredInRound: string };
  sequencer: (ObservedCode & { startedAt: string; graceSeconds: 3600 }) | null;
  rpcReads: readonly [number, number];
};

/** Capture actual code and call results at one shared canonical block. This is
 * input for later execution/review, not a storage witness, runtime replay or
 * launch approval. The caller supplies the existing trusted provider pair;
 * no URL, key, provider or budget is selected from a generated project. */
export function createLaunchDependencyReader(dependencies: {
  rpcs: (chainId: LaunchProductionContext["chainId"]) => readonly [TradeRpcV1, TradeRpcV1];
  now: () => number;
}) {
  type Entry = { id: string; until: number; pending?: Promise<LaunchDependencyObservation>; value?: LaunchDependencyObservation };
  const cache = new Map<LaunchProductionContext["chainId"], Entry>();
  async function capture(production: LaunchProductionContext): Promise<LaunchDependencyObservation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(unavailable()), 30_000);
    try { return await captureBounded(production, controller.signal); }
    finally { clearTimeout(timeout); }
  }
  async function captureBounded(production: LaunchProductionContext, signal: AbortSignal): Promise<LaunchDependencyObservation> {
    const pins = production.protectionBindings;
    if (production.version !== 3 || !pins) throw unavailable();
    const reads: [number, number] = [0, 0];
    const providers = dependencies.rpcs(production.chainId);
    if (providers.length !== 2 || providers[0] === providers[1]) throw unavailable();
    const rpcs = providers.map((rpc, index): TradeRpcV1 => async (method, params) => {
      signal.throwIfAborted();
      if (++reads[index] > MAX_READS_PER_PROVIDER) throw unavailable();
      return new Promise((resolve, reject) => {
        const stop = () => { signal.removeEventListener("abort", stop); reject(signal.reason); };
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) { stop(); return; }
        Promise.resolve().then(() => rpc(method, params)).then(value => {
          signal.removeEventListener("abort", stop); if (!signal.aborted) resolve(value);
        }, error => { signal.removeEventListener("abort", stop); if (!signal.aborted) reject(error); });
      });
    }) as [TradeRpcV1, TradeRpcV1];
    const agree = agreedTradeRpcV1(rpcs);
    if (await agree("eth_chainId", [], value => quantityV1(value).toString()) !== String(production.chainId)) throw unavailable();
    const block = await readTradeCheckpointV1(rpcs, production.chainId === 4663 ? 16n : 2n);
    const reference = { blockHash: block.hash, requireCanonical: true };
    function fresh() {
      const age = BigInt(Math.floor(dependencies.now() / 1000)) - BigInt(block.timestamp);
      if (age < -5n || age > 90n) throw unavailable();
    }
    fresh();
    async function code(address: Address, expected?: Hex): Promise<ObservedCode> {
      const runtimeCode = await agree("eth_getCode", [address, reference], value => {
        const code = bytesV1(value);
        if (code.length <= 2 || code.length > 2 + 24_576 * 2) throw unavailable();
        return code;
      });
      const runtimeCodeHash = keccak256(runtimeCode);
      if (expected !== undefined && runtimeCodeHash !== expected) throw unavailable();
      return { address, runtimeCode, runtimeCodeHash };
    }
    async function call(address: Address, functionName: "decimals" | "latestRoundData") {
      const data = encodeFunctionData({ abi: ABI, functionName });
      const output = await agree("eth_call", [{ to: address, data }, reference], value => {
        const bytes = bytesV1(value);
        if (bytes.length !== 2 + (functionName === "decimals" ? 32 : 160) * 2) throw unavailable();
        return bytes;
      });
      return decodeFunctionResult({ abi: ABI, functionName, data: output });
    }
    // Check the pinned code first. Do not call an oracle after an altered code
    // hash has already made the observation unusable.
    const [poolManager, swapRouter, feedCode, sequencerCode] = await Promise.all([
      code(production.poolManager.address, production.poolManager.runtimeCodeHash),
      code(pins.swapRouter.address, pins.swapRouter.runtimeCodeHash),
      code(pins.nativeUsdFeed.address, pins.nativeUsdFeed.runtimeCodeHash),
      pins.sequencerUptimeFeed ? code(pins.sequencerUptimeFeed) : null,
    ]);
    const [decimalsResult, roundResult, sequencerResult] = await Promise.all([
      call(feedCode.address, "decimals"), call(feedCode.address, "latestRoundData"),
      sequencerCode ? call(sequencerCode.address, "latestRoundData") : null,
    ]);
    if (typeof decimalsResult !== "number" || decimalsResult < 0 || decimalsResult > 18 || !Array.isArray(roundResult)) throw unavailable();
    const [roundId, answer, , updatedAt, answeredInRound] = roundResult;
    const timestamp = BigInt(block.timestamp);
    if (roundId <= 0n || answer <= 0n || updatedAt <= 0n || updatedAt > timestamp
      || timestamp - updatedAt > BigInt(pins.nativeUsdFeedMaxAgeSeconds) || answeredInRound < roundId) throw unavailable();
    let sequencer: LaunchDependencyObservation["sequencer"] = null;
    if (sequencerCode) {
      if (!Array.isArray(sequencerResult)) throw unavailable();
      const [, status, startedAt] = sequencerResult;
      if (status !== 0n || startedAt <= 0n || startedAt > timestamp || timestamp - startedAt <= 3600n) throw unavailable();
      sequencer = { ...sequencerCode, startedAt: startedAt.toString(), graceSeconds: 3600 };
    }
    const final = await agree("eth_getBlockByNumber", [toHex(BigInt(block.number)), false], tradeBlockV1);
    if (final.hash !== block.hash || final.number !== block.number || final.timestamp !== block.timestamp) throw unavailable();
    fresh();
    const observedAt = dependencies.now();
    const body = { version: 1 as const, productionId: production.id, chainId: production.chainId,
      authority: "two-provider-observation" as const, launchReady: false as const, block, observedAt,
      expiresAt: Math.min(observedAt + TTL_MS, (Number(block.timestamp) + 90) * 1000), poolManager, swapRouter,
      nativeUsdFeed: { ...feedCode, decimals: decimalsResult, roundId: roundId.toString(), answer: answer.toString(),
        updatedAt: updatedAt.toString(), answeredInRound: answeredInRound.toString() }, sequencer, rpcReads: reads };
    return { ...body, id: canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", body) };
  }
  return async function read(value: LaunchProductionContext, signal?: AbortSignal, options: { fresh?: boolean } = {}) {
    signal?.throwIfAborted();
    const production = checkedLaunchProductionContext(value, value.chainId);
    if (production.version !== 3 || !production.protectionBindings) throw unavailable();
    let entry = cache.get(production.chainId);
    if (entry?.id !== production.id) entry = undefined;
    const time = dependencies.now();
    if (!entry?.pending && entry && entry.until > time) {
      if (!entry.value) throw unavailable();
      if (!options.fresh) return structuredClone(entry.value);
    }
    let pending = entry?.pending;
    if (!pending) {
      const next: Entry = { id: production.id, until: 0 };
      cache.set(production.chainId, next);
      pending = capture(production).then(value => {
        // An older request cannot replace the cache after the profile changed.
        if (cache.get(production.chainId) === next) cache.set(production.chainId, { id: production.id, until: value.expiresAt, value });
        return value;
      }, () => {
        if (cache.get(production.chainId) === next) cache.set(production.chainId, { id: production.id, until: dependencies.now() + NEGATIVE_TTL_MS });
        throw unavailable();
      });
      next.pending = pending;
    }
    if (!signal) return structuredClone(await pending);
    return new Promise<LaunchDependencyObservation>((resolve, reject) => {
      const stop = () => { signal.removeEventListener("abort", stop); reject(signal.reason); };
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      pending.then(value => { signal.removeEventListener("abort", stop); if (!signal.aborted) resolve(structuredClone(value)); },
        error => { signal.removeEventListener("abort", stop); if (!signal.aborted) reject(error); });
    });
  };
}
