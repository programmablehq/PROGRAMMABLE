import "server-only";
import { keccak256 } from "viem";
import { protectedOpeningPriceV1 } from "@/packages/launch/src/protected-opening-price.mjs";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import type { LaunchDependencyObservation } from "./dependency-observations.server";
import { CustomAIError } from "./types";

export type OpeningSourceSelection = {
  projectHash: `sha256:${string}`;
  artifactHash: `sha256:${string}`;
  supply: string;
  targetFdvUsd?: string;
};

const hash = /^sha256:(?!0{64}$)[a-f0-9]{64}$/u;
const integer = (value: unknown, bits: bigint): value is string => typeof value === "string"
  && /^(?:0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value) < (1n << bits);
const positive = (value: unknown, bits: bigint): value is string => integer(value, bits) && BigInt(value) > 0n;
const invalid = (): never => { throw new CustomAIError("launch-opening-context", "The opening price needs the current network observation and saved source. Your design is kept.", 422); };

/** Derive inputs using the original SDK math, without selecting a source or
 * submitting a launch. The caller must still bind these values into the exact
 * deployment and prove that the token really uses the selected supply. */
export function deriveObservedOpeningInputs(context: LaunchProductionContext, value: LaunchDependencyObservation,
  selection: OpeningSourceSelection, now = Date.now()) {
  try {
    const production = checkedLaunchProductionContext(context, context.chainId), observation = structuredClone(value);
    const pins = production.protectionBindings, { id, ...observedBody } = observation;
    if (!pins || !production.protectionPolicy?.required || !production.protections || !hash.test(selection.projectHash)
      || !hash.test(selection.artifactHash) || !positive(selection.supply, 127n)
      || canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1", observedBody) !== id
      || observation.version !== 1 || observation.authority !== "two-provider-observation" || observation.launchReady !== false
      || observation.productionId !== production.id || observation.chainId !== production.chainId
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(observation.observedAt) || !Number.isSafeInteger(observation.expiresAt)
      || now < observation.observedAt || now >= observation.expiresAt || observation.expiresAt > observation.observedAt + 10_000
      || !positive(observation.block.timestamp, 64n) || !integer(observation.block.number, 64n)
      || !/^0x(?!0{64}$)[a-f0-9]{64}$/u.test(observation.block.hash)
      || !Array.isArray(observation.rpcReads) || observation.rpcReads.length !== 2
      || observation.rpcReads.some(count => !Number.isSafeInteger(count) || count < 1 || count > 12)) return invalid();
    const blockTime = BigInt(observation.block.timestamp), time = BigInt(Math.floor(now / 1000));
    if (blockTime > time || time - blockTime > 90n || BigInt(observation.expiresAt) > (blockTime + 90n) * 1000n) return invalid();
    for (const [actual, expected] of [[observation.poolManager, production.poolManager],
      [observation.swapRouter, pins.swapRouter], [observation.nativeUsdFeed, pins.nativeUsdFeed]] as const) {
      if (actual.address.toLowerCase() !== expected.address.toLowerCase() || actual.runtimeCodeHash !== expected.runtimeCodeHash
        || !/^0x(?:[a-f0-9]{2}){1,24576}$/u.test(actual.runtimeCode) || keccak256(actual.runtimeCode) !== expected.runtimeCodeHash) return invalid();
    }
    const feed = observation.nativeUsdFeed;
    if (!Number.isInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 18 || !positive(feed.answer, 255n)
      || !positive(feed.roundId, 80n) || !positive(feed.answeredInRound, 80n) || BigInt(feed.answeredInRound) < BigInt(feed.roundId)
      || !positive(feed.updatedAt, 64n) || BigInt(feed.updatedAt) > blockTime
      || blockTime - BigInt(feed.updatedAt) > BigInt(pins.nativeUsdFeedMaxAgeSeconds)) return invalid();
    if (production.chainId === 8453) {
      const sequencer = observation.sequencer;
      if (!sequencer || !pins.sequencerUptimeFeed || sequencer.address.toLowerCase() !== pins.sequencerUptimeFeed.toLowerCase()
        || sequencer.graceSeconds !== 3600 || !positive(sequencer.startedAt, 64n) || blockTime - BigInt(sequencer.startedAt) <= 3600n
        || !/^0x(?:[a-f0-9]{2}){1,24576}$/u.test(sequencer.runtimeCode) || keccak256(sequencer.runtimeCode) !== sequencer.runtimeCodeHash) return invalid();
    } else if (observation.sequencer !== null) return invalid();
    const target = selection.targetFdvUsd ?? production.protections.minimumFdvUsd;
    if (!positive(target, 127n) || BigInt(target) < BigInt(production.protections.minimumFdvUsd)) return invalid();
    const price = protectedOpeningPriceV1({ supply: selection.supply, answer: BigInt(feed.answer), feedDecimals: feed.decimals, targetFdvUsd: target });
    const body = { version: 1 as const, scope: "observed-opening-inputs-v1" as const,
      chainId: production.chainId, productionId: production.id, observationId: observation.id,
      projectHash: selection.projectHash, artifactHash: selection.artifactHash, supply: selection.supply,
      targetFdvUsd: target, initialTick: price.initialTick, sqrtPriceX96: price.sqrtPriceX96.toString(),
      openingFdvUsd: price.openingFdvUsd.toString(), preparedAt: now, expiresAt: observation.expiresAt, launchReady: false as const };
    return { ...body, id: canonicalBrowserSha256V2("programmable.custom-ai-opening-inputs.v1", body) };
  } catch { return invalid(); }
}
