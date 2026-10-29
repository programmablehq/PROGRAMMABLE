import "server-only";
import { keccak256, stringToHex } from "viem";
import { customAIChain } from "./chain.server";
import { ruleFeedIds, type RuleSpecV2 } from "./rule-spec";
import type { RuleFeedBinding } from "./rule-compiler.server";
import { CustomAIError } from "./types";
import { matchesRuntime } from "./runtime";
import feedCode from "./feed-v2-code.json";
export function configuredRuleFeeds(){
  const raw=process.env.CUSTOM_AI_EVENT_FEEDS_V2??"[]";
  if(raw.length>64000)return [];
  try{
    const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>64)return [];
    return values.filter(f=>f&&/^[a-z][a-z0-9-]{0,63}$/.test(f.id)&&[1,4663].includes(f.chainId)).map(f=>({
      id:f.id,chainId:f.chainId,title:typeof f.title==="string"?f.title.slice(0,120):f.id.replaceAll("-"," "),
      unit:typeof f.unit==="string"?f.unit.slice(0,32):f.id==="london-rain-v1"?"mm":"source units",
      decimals:Number.isSafeInteger(f.decimals)&&f.decimals>=0&&f.decimals<=18?f.decimals:f.id==="london-rain-v1"?3:0,
      sourceVersion:typeof f.sourceVersion==="string"?f.sourceVersion.slice(0,120):"",status:"configured; checked again before launch",
    }));
  }catch{return [];}
}
export async function resolveRuleFeeds(spec: RuleSpecV2, chainId: 1 | 4663): Promise<RuleFeedBinding[]> {
  const ids = ruleFeedIds(spec); if (!ids.length) return [];
  const raw = process.env.CUSTOM_AI_EVENT_FEEDS_V2 ?? "[]";
  if (raw.length > 64000) throw new CustomAIError("feed", "The connected data sources could not be read.", 503);
  const catalog = JSON.parse(raw) as (RuleFeedBinding & { chainId: number })[];
  if (!Array.isArray(catalog) || catalog.length > 64) throw new CustomAIError("feed", "The connected data sources could not be read.", 503);
  const chain = await customAIChain(chainId);
  const result: RuleFeedBinding[] = [];
  for (const id of ids) {
    const candidates = catalog.filter(f => f.id === id && f.chainId === chainId);
    if (candidates.length !== 1) throw new CustomAIError("feed", `The ${id.replaceAll("-", " ")} data source is not connected on this network yet. Your complete design is saved.`, 422);
    const f = candidates[0];
    if (!/^0x[0-9a-fA-F]{40}$/.test(f.address) || !/^0x[0-9a-fA-F]{64}$/.test(f.runtimeHash) || !f.sourceVersion) throw new CustomAIError("feed", "The connected data source has an invalid binding.", 503);
    const code = await chain.code(f.address);
    if (keccak256(code) !== f.runtimeHash || !matchesRuntime(code, feedCode as Parameters<typeof matchesRuntime>[1])) throw new CustomAIError("feed", "The data source has changed and must be checked again.", 503);
    const [minimum, maximum, maxAge, feedId, sourceVersion] = await Promise.all([chain.call(f.address, "function minimum() view returns (int256)"),
      chain.call(f.address, "function maximum() view returns (int256)"), chain.call(f.address, "function maxAge() view returns (uint64)"),
      chain.call(f.address, "function feedId() view returns (bytes32)"), chain.call(f.address, "function sourceVersion() view returns (bytes32)")]);
    if (feedId !== keccak256(stringToHex(id)) || sourceVersion !== keccak256(stringToHex(f.sourceVersion))) throw new CustomAIError("feed", "The data source identity does not match the chosen version.", 503);
    result.push({ id, address: f.address, runtimeHash: f.runtimeHash, runtimeCode: code, sourceVersion: f.sourceVersion,
      minimum: String(minimum), maximum: String(maximum), maxAge: Number(maxAge) });
  }
  await chain.finish(); return result;
}
