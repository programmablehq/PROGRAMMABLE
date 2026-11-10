import "server-only";
import { productionMainnetRpcPair } from "@/lib/onchain/website-rpc-providers.server";
import { readBoundedUtf8BodyV1, discardBodyV1 } from "@/lib/server/custom-launch/bounded-utf8-body-v1";
import type { ProductReadRpc } from "./product/read-rpc";
import { createConstructorDependencyServices } from "./dependency-witness.server";
import type { LaunchProductionContext } from "./launch-production";
import { CustomAIError } from "./types";
import {allowedProductRuntimeRPC} from "./product/runtime-rpc";
import {allowedProductActionReadRPC,checkedProductActionReadCall,type ProductActionReadCall} from "./product/action-rpc";

type Chain = LaunchProductionContext["chainId"];
type Environment = Readonly<Record<string, string | undefined>>;
const unavailable = () => new CustomAIError("launch-dependency", "The selected chain's contract inputs could not be verified. Your design is saved.", 503);
type ProviderBudget = { active: number; starts: number[]; pausedUntil: number };
// Function/target permissions remain on each adapter. Provider pressure is
// shared by adapters using the same transport and endpoint in this process.
// A new saved action must not reset an exhausted provider's cooldown.
const providerBudgets = new WeakMap<typeof fetch, Map<string, ProviderBudget>>();
function providerBudget(fetcher: typeof fetch, url: string): ProviderBudget {
  let budgets = providerBudgets.get(fetcher);
  if (!budgets) { budgets = new Map(); providerBudgets.set(fetcher, budgets); }
  let budget = budgets.get(url);
  if (!budget) { budget = { active: 0, starts: [], pausedUntil: 0 }; budgets.set(url, budget); }
  return budget;
}
const address = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{40}$/iu.test(v);
const blockNumber = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{1,64}$/iu.test(v);
const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join() === expected;
const reference = (v: unknown) => {
  const b = object(v);
  return Boolean(b && keys(b, "blockHash,requireCanonical") && b.requireCanonical === true
    && typeof b.blockHash === "string" && /^0x[0-9a-f]{64}$/iu.test(b.blockHash));
};

/** Only the fixed observation and decimals trace protocol is allowed here.
 * No broadcasts, arbitrary tracers, logs scans or caller-selected gas budgets. */
function allowed(method: string, params: readonly unknown[], metadataOnly: boolean) {
  if (method === "eth_chainId") return params.length === 0;
  if (method === "eth_getBlockByNumber") return params.length === 2 && (params[0] === "latest" || blockNumber(params[0])) && params[1] === false;
  if (method === "eth_getCode") return params.length === 2 && address(params[0]) && reference(params[1]);
  const call = object(params[0]);
  if (metadataOnly) return method === "eth_call" && params.length === 2 && call && keys(call, "data,gas,to")
    && address(call.to) && call.gas === "0x186a0" && ["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd"].includes(String(call.data))
    && reference(params[1]);
  if (method === "eth_call") return params.length === 2 && call && keys(call, "data,to") && address(call.to)
    && ["0x313ce567", "0xfeaf968c"].includes(String(call.data)) && reference(params[1]);
  if (method !== "debug_traceCall" || params.length !== 3 || !call || !keys(call, "data,from,gas,to,value")
    || !address(call.from) || !address(call.to) || call.data !== "0x313ce567" || call.value !== "0x0"
    || call.gas !== "0x1e8480" || !blockNumber(params[1])) return false;
  const trace = object(params[2]), config = object(trace?.tracerConfig);
  return Boolean(trace && keys(trace, "timeout,tracer,tracerConfig") && trace.tracer === "prestateTracer"
    && trace.timeout === "5s" && config && keys(config, "diffMode") && config.diffMode === false);
}

function endpoint(value: string | undefined, host: string, path: RegExp) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash
      || !path.test(url.pathname)) throw unavailable();
    return url.href;
  } catch { throw unavailable(); }
}
function selectedEndpoints(chain: Chain, env: Environment): readonly [string, string] {
  if (chain === 1) {
    try { const pair = productionMainnetRpcPair(env); return [pair.primary.url, pair.secondary.url]; }
    catch { throw unavailable(); }
  }
  if(chain===99901) {
    for(const [role,provider,domain,authentication] of [["PRIMARY","alchemy","alchemy.com","provider-credential"],["SECONDARY","kinetiq","kinetiq.xyz","public"]]) {
      for(const [field,expected] of [["PROVIDER_ID",provider],["TRUST_DOMAIN",domain],["AUTHENTICATION",authentication]]) {
        const configured=env[`ELYSIUM_RPC_${role}_${field}`];
        if(configured!==undefined&&configured!==expected)throw unavailable();
      }
    }
    return [endpoint(env.ELYSIUM_RPC_PRIMARY_URL,"elysium-mainnet.g.alchemy.com",/^\/v2\/[A-Za-z0-9_-]{16,256}$/u),
      endpoint(env.ELYSIUM_RPC_SECONDARY_URL??"https://rpc.elysium.kinetiq.xyz","rpc.elysium.kinetiq.xyz",/^\/$/u)];
  }
  const prefix = chain === 4663 ? "ROBINHOOD_V4" : chain === 8453 ? "BASE" : chain === 999 ? "HYPEREVM" : undefined;
  if (!prefix) throw unavailable();
  const network = chain === 4663 ? "robinhood" : chain === 8453 ? "base" : "hyperliquid";
  const primary = env[`${prefix}_RPC_PRIMARY_URL`] ?? (chain === 4663 ? env.ROBINHOOD_RPC_URL : undefined);
  const secondary = env[`${prefix}_RPC_SECONDARY_URL`] ?? (chain === 4663 ? env.ROBINHOOD_SECONDARY_RPC_URL : undefined);
  for (const [role, provider, domain] of [["PRIMARY", "drpc", "drpc.org"], ["SECONDARY", "alchemy", "alchemy.com"]]) {
    const publicHyper = chain === 999 && role === "SECONDARY" && secondary === "https://rpc.hyperliquid.xyz/evm";
    const expectedProvider = publicHyper ? "hyperliquid" : provider, expectedDomain = publicHyper ? "hyperliquid.xyz" : domain;
    for (const [field, expected] of [["PROVIDER_ID", expectedProvider], ["TRUST_DOMAIN", expectedDomain], ["AUTHENTICATION", publicHyper ? "public" : "provider-credential"]]) {
      const configured = env[`${prefix}_RPC_${role}_${field}`];
      if (configured !== undefined && configured !== expected) throw unavailable();
    }
  }
  return [endpoint(primary, "lb.drpc.live", new RegExp(`^/${network}/[A-Za-z0-9_-]{16,512}$`, "u")),
    chain === 999 && secondary === "https://rpc.hyperliquid.xyz/evm" ? secondary
      : endpoint(secondary, `${network}-mainnet.g.alchemy.com`, /^\/v2\/[A-Za-z0-9_-]{16,256}$/u)];
}

/** Lazy, server-owned provider selection. Reuses the existing production roles;
 * nothing is read until a selected project actually needs observations. */
export function createProductionDependencyRpcs(options: { env?: Environment; fetcher?: typeof fetch; now?: () => number; metadataOnly?: boolean; productRuntime?:boolean; productActionRead?:ProductActionReadCall } = {}) {
  if([options.metadataOnly,options.productRuntime,Boolean(options.productActionRead)].filter(Boolean).length>1)throw new TypeError("Choose one bounded RPC read protocol.");
  const actionRead=options.productActionRead?checkedProductActionReadCall(options.productActionRead):undefined;
  const env = { ...(options.env ?? process.env) }, fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  const pairs = new Map<Chain, readonly [ProductReadRpc, ProductReadRpc]>();
  const providers = new Map<string, ProductReadRpc>();
  let sequence = 0;
  const readFor = (url: string): ProductReadRpc => {
    const previous = providers.get(url); if (previous) return previous;
    const state = providerBudget(fetcher, url);
    const read: ProductReadRpc = async (method, params, signal) => {
      signal?.throwIfAborted();
      if (!Array.isArray(params) || !(actionRead?allowedProductActionReadRPC(method,params,actionRead):options.productRuntime?allowedProductRuntimeRPC(method,params):allowed(method, params, options.metadataOnly === true))) throw unavailable();
      const time = now(); state.starts = state.starts.filter(start => start > time - 1_000);
      if (state.active >= 4 || state.starts.length >= 16 || state.pausedUntil > time) throw unavailable();
      state.active++; state.starts.push(time);
      const id = ++sequence, controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const requestSignal = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
        const response = await fetcher(url, { method: "POST", redirect: "error", cache: "no-store", signal: requestSignal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
        if (!response.ok || !response.body) {
          discardBodyV1(response);
          if ([402, 429, 503].includes(response.status)) state.pausedUntil = now() + 30_000;
          throw unavailable();
        }
        const result = object(JSON.parse(await readBoundedUtf8BodyV1(response, 524_288, { signal: requestSignal, timeoutMs: 10_000 })));
        if (!result || result.jsonrpc !== "2.0" || result.id !== id || Object.hasOwn(result, "error") || !Object.hasOwn(result, "result")) {
          if ([-32005, -32007].includes(Number(object(result?.error)?.code))) state.pausedUntil = now() + 30_000;
          throw unavailable();
        }
        return result.result;
      } catch { throw unavailable(); }
      finally { clearTimeout(timer); state.active--; }
    };
    providers.set(url, read); return read;
  };
  return (chain: Chain): readonly [ProductReadRpc, ProductReadRpc] => {
    if(actionRead&&actionRead.chainId!==chain)throw unavailable();
    let pair = pairs.get(chain);
    if (!pair) { const urls = selectedEndpoints(chain, env); pair = [readFor(urls[0]), readFor(urls[1])]; pairs.set(chain, pair); }
    return pair;
  };
}

export function createProductionConstructorDependencyResolver(options: Parameters<typeof createProductionDependencyRpcs>[0] = {}) {
  return createProductionConstructorDependencyServices(options).resolve;
}

export function createProductionConstructorDependencyServices(options: Parameters<typeof createProductionDependencyRpcs>[0] = {}) {
  return createConstructorDependencyServices({ rpcs: createProductionDependencyRpcs(options), now: options.now ?? Date.now });
}
