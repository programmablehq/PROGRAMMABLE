import "server-only";
import { getAddress, keccak256, type Hex } from "viem";
import { customAIChain } from "./chain.server";
import { CustomAIError } from "./types";
import { matchesRuntime } from "./runtime";
import template from "./feed-code.json";
import type { EventRule, FeedBinding } from "./feed";

type ConfiguredFeed = { id: string; chainId: 1 | 4663; address: `0x${string}`; runtimeHash: Hex; title: string; sourceUrl: string; unit: string };
export function feedCatalog(): ConfiguredFeed[] {
  const raw = process.env.CUSTOM_AI_EVENT_FEEDS;
  if (!raw) return [];
  if (raw.length > 64_000) throw new CustomAIError("feed", "The data feed catalog is unavailable.", 503);
  const feeds = JSON.parse(raw) as ConfiguredFeed[];
  if (!Array.isArray(feeds) || feeds.length > 64 || feeds.some(f => !/^[a-z0-9-]{1,80}$/.test(f.id)
    || ![1,4663].includes(f.chainId) || !/^0x[0-9a-fA-F]{40}$/.test(f.address) || !/^0x[0-9a-fA-F]{64}$/.test(f.runtimeHash)
    || typeof f.title !== "string" || f.title.length > 160 || typeof f.unit !== "string" || f.unit.length > 100
    || typeof f.sourceUrl !== "string" || !/^https:\/\//.test(f.sourceUrl))) throw new CustomAIError("feed", "The data feed catalog is unavailable.", 503);
  for (const feed of feeds) {
    const url = new URL(feed.sourceUrl);
    if (url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|password|auth/i.test(key))) throw new CustomAIError("feed", "Use a public source URL without credentials.", 503);
  }
  return feeds.map(({ id, chainId, address, runtimeHash, title, sourceUrl, unit }) => ({ id, chainId, address, runtimeHash, title, sourceUrl, unit }));
}

export async function prepareEventFeed(rule: EventRule, chainId: 1 | 4663): Promise<FeedBinding> {
  const entry = feedCatalog().find(f => f.id === rule.id && f.chainId === chainId);
  if (!entry) throw new CustomAIError("feed", "That event feed is not connected on this network yet. The previous draft is unchanged.", 422);
  const chain = await customAIChain(chainId), address = getAddress(entry.address);
  const runtimeCode = await chain.code(address);
  if (keccak256(runtimeCode) !== entry.runtimeHash || !matchesRuntime(runtimeCode, { ...template, runtimeTemplate: template.runtimeTemplate as Hex })) {
    throw new CustomAIError("feed", "The event feed code changed. The previous draft is unchanged.", 422);
  }
  const [minimum, maximum, maxAge] = await Promise.all([
    chain.call(address, "function minimum() view returns (int256)"), chain.call(address, "function maximum() view returns (int256)"),
    chain.call(address, "function maxAge() view returns (uint64)"),
  ]);
  await chain.finish();
  if (BigInt(rule.threshold) <= BigInt(String(minimum)) || BigInt(rule.threshold) > BigInt(String(maximum))
    || Number(maxAge) < 1 || Number(maxAge) > 86400) throw new CustomAIError("feed", "The threshold is outside the feed's supported range.", 422);
  return { ...entry, rule, address, runtimeCode, minimum: String(minimum), maximum: String(maximum), maxAge: Number(maxAge) };
}
