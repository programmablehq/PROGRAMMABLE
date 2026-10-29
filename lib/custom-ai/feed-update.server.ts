import "server-only";
import { encodeFunctionData, parseAbi, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { customAIChain } from "./chain.server";
import { prepareEventFeed } from "./feed.server";
import type { EventRule } from "./feed";
import { CustomAIError } from "./types";

export type ObservationAdapter = { url: string; valuePath: string[]; timestampPath: string[]; decimals: number; values?: Record<string, string> };
const pathValue = (value: unknown, path: string[]) => path.reduce<unknown>((current, key) => {
  if (["__proto__", "prototype", "constructor"].includes(key) || current === null || typeof current !== "object"
    || !Object.prototype.hasOwnProperty.call(current, key)) throw Error("Missing observation field");
  return (current as Record<string, unknown>)[key];
}, value);

export function normalizeObservation(payload: unknown, adapter: ObservationAdapter, now: number, maxAge: number, minimum: string, maximum: string) {
  if (!Number.isInteger(adapter.decimals) || adapter.decimals < 0 || adapter.decimals > 18
    || !adapter.valuePath.length || adapter.valuePath.length > 16 || !adapter.timestampPath.length || adapter.timestampPath.length > 16) throw Error("Invalid observation adapter");
  const raw = pathValue(payload, adapter.valuePath);
  const text = adapter.values ? adapter.values[String(raw)] : typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  if (typeof text !== "string" || !/^-?\d{1,30}(\.\d{1,18})?$/.test(text) || (text.split(".")[1]?.length ?? 0) > adapter.decimals) throw Error("Observation cannot be represented exactly");
  const value = parseUnits(text, adapter.decimals);
  const time = pathValue(payload, adapter.timestampPath);
  const observedAt = typeof time === "number" ? time : typeof time === "string" ? Date.parse(time) / 1000 : NaN;
  if (!Number.isSafeInteger(observedAt) || observedAt > now || now - observedAt > maxAge
    || value < BigInt(minimum) || value > BigInt(maximum)) throw Error("Observation is stale or outside its bounds");
  return { value, observedAt: BigInt(observedAt), validUntil: BigInt(observedAt + maxAge) };
}

/** Produces a source-bound, expiring update. It never sends a transaction or pays gas. */
export async function prepareFeedUpdate(input: { rule: EventRule; chainId: 1 | 4663; adapter: ObservationAdapter; signingKey: Hex }, signal?: AbortSignal) {
  const feed = await prepareEventFeed(input.rule, input.chainId);
  const url = new URL(input.adapter.url);
  // Adapters come from operator configuration, never a chat message or model result.
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== feed.sourceUrl) throw new CustomAIError("feed", "The observation URL differs from the bound source.", 422);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw Error("Observation provider unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing observation body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 256_000) throw Error("Observation response too large"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const chain = await customAIChain(input.chainId);
  const [id, signer, seq, previousTime] = await Promise.all([
    chain.call(feed.address, "function feedId() view returns (bytes32)"), chain.call(feed.address, "function signer() view returns (address)"),
    chain.call(feed.address, "function sequence() view returns (uint64)"), chain.call(feed.address, "function observedAt() view returns (uint64)"),
  ]);
  const observation = normalizeObservation(JSON.parse(Buffer.concat(chunks).toString("utf8")), input.adapter,
    Number(chain.block.timestamp), feed.maxAge, feed.minimum, feed.maximum);
  if (observation.observedAt < BigInt(String(previousTime))) throw Error("Observation would move backwards");
  const account = privateKeyToAccount(input.signingKey);
  if (account.address.toLowerCase() !== String(signer).toLowerCase()) throw Error("Incorrect observation signer");
  const sequence = BigInt(String(seq)) + 1n;
  if (sequence >= 1n << 64n) throw Error("Observation sequence exhausted");
  await chain.finish();
  const signature = await account.signTypedData({ domain: { name: "Programmable Custom AI Data", version: "1", chainId: input.chainId, verifyingContract: feed.address },
    types: { DataUpdate: [{ name: "feedId", type: "bytes32" }, { name: "sequence", type: "uint64" }, { name: "value", type: "int256" },
      { name: "observedAt", type: "uint64" }, { name: "validUntil", type: "uint64" }] }, primaryType: "DataUpdate",
    message: { feedId: id as Hex, sequence, ...observation } });
  return { chainId: input.chainId, sourceUrl: feed.sourceUrl, sequence: sequence.toString(), observedAt: observation.observedAt.toString(),
    validUntil: observation.validUntil.toString(), value: observation.value.toString(),
    transaction: { to: feed.address, value: "0x0", data: encodeFunctionData({ abi: parseAbi(["function update(uint64,int256,uint64,uint64,bytes)"]),
      functionName: "update", args: [sequence, observation.value, observation.observedAt, observation.validUntil, signature] }) } };
}

/** V2 weather observation preparation. Signing is local; dispatch belongs to the durable worker. */
export async function prepareWeatherFeedUpdate(input: {
  feed: import("./rule-compiler.server").RuleFeedBinding;
  definition: import("./feed-adapters/weather.server").WeatherFeedDefinition;
  chainId: 1 | 4663; signingKey: Hex;
}, signal?: AbortSignal) {
  const { readWeather } = await import("./feed-adapters/weather.server");
  const { keccak256, stringToHex } = await import("viem");
  const chain = await customAIChain(input.chainId), feed = input.feed;
  if (keccak256(await chain.code(feed.address)) !== feed.runtimeHash || feed.id !== input.definition.id || feed.sourceVersion !== input.definition.sourceVersion) throw Error("Weather feed binding changed");
  const [feedId, version, signer, previous] = await Promise.all([
    chain.call(feed.address,"function feedId() view returns(bytes32)"), chain.call(feed.address,"function sourceVersion() view returns(bytes32)"),
    chain.call(feed.address,"function signer() view returns(address)"),
    chain.call(feed.address,"function latestSnapshot() view returns(uint64,uint64,int256,int256,uint64,uint64,uint64,bool)"),
  ]);
  const account = privateKeyToAccount(input.signingKey);
  if (String(signer).toLowerCase() !== account.address.toLowerCase() || feedId !== keccak256(stringToHex(feed.id)) || version !== keccak256(stringToHex(feed.sourceVersion))) throw Error("Weather reporter or source changed");
  const p = previous as [bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean];
  const prior = p[0] === 0n ? undefined : { feedId:feed.id,sourceVersion:feed.sourceVersion,sequence:String(p[0]),transitionSequence:String(p[1]),value:String(p[2]),previousValue:String(p[3]),changedAt:Number(p[4]),observedAt:Number(p[5]),validUntil:Number(p[6]),fresh:p[7] };
  const observation = await readWeather(input.definition, prior, signal);
  if (prior && prior.observedAt === observation.observedAt) return null;
  if (BigInt(observation.value) < BigInt(feed.minimum) || BigInt(observation.value) > BigInt(feed.maximum)) throw Error("Weather value exceeds the bound feed range");
  await chain.finish();
  const sequence = p[0] + 1n;
  const message = { feedId:feedId as Hex,sourceVersion:version as Hex,sequence,value:BigInt(observation.value),observedAt:BigInt(observation.observedAt),validUntil:BigInt(observation.validUntil) };
  const signature = await account.signTypedData({domain:{name:"Programmable Custom AI Data",version:"2",chainId:input.chainId,verifyingContract:feed.address},
    primaryType:"DataUpdate",types:{DataUpdate:[{name:"feedId",type:"bytes32"},{name:"sourceVersion",type:"bytes32"},{name:"sequence",type:"uint64"},{name:"value",type:"int256"},{name:"observedAt",type:"uint64"},{name:"validUntil",type:"uint64"}]},message});
  return { observation, transaction:{to:feed.address,value:"0x0",data:encodeFunctionData({abi:parseAbi(["function update(uint64,int256,uint64,uint64,bytes)"]),functionName:"update",args:[sequence,message.value,message.observedAt,message.validUntil,signature]})} };
}
