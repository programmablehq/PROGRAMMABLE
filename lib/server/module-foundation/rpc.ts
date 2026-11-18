import "server-only";
import { setTimeout as cancellableDelay } from "node:timers/promises";
import { createPublicClient, custom, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { productionMainnetRpcPair } from "@/lib/onchain/website-rpc-providers.server";
import { TradeRpcExecutionRevertedV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const nextRequest = new Map<string, number>();
const pause = (ms: number, signal?: AbortSignal) => signal
  ? cancellableDelay(ms, undefined, { signal })
  : new Promise<void>(resolve => setTimeout(resolve, ms));

/** Preserve EVM reverts when adapting the paced reader to viem. */
export function foundationMainnetReadClient(rpc: TradeRpcV1) {
  return createPublicClient({ chain: mainnet, transport: custom({
    async request({ method, params }) {
      try { return await rpc(method, params ?? []); }
      catch (error) {
        if (error instanceof TradeRpcExecutionRevertedV1) {
          throw Object.assign(new Error("execution reverted"), { code: 3, data: error.data });
        }
        throw error;
      }
    },
  }, { retryCount: 0 }) });
}

/** Share the request budget across quote contexts in this server instance.
 * Leave capacity for the website's other reads on the same provider account. */
async function pace(endpoint: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const now = Date.now(), slot = Math.max(now, nextRequest.get(endpoint) ?? now);
  if (slot - now > 8_000) throw new Error("The quote provider is busy.");
  nextRequest.set(endpoint, slot + 50);
  if (slot > now) await pause(slot - now, signal);
}

class ProviderRateLimit extends Error {
  constructor(readonly delayMs = 1_000) { super("The quote provider is busy."); }
}

/** Two existing, independently operated Ethereum providers. Never expose their URLs in errors. */
export function foundationMainnetRpcs(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch, signal?: AbortSignal): readonly [TradeRpcV1, TradeRpcV1] {
  const pair = productionMainnetRpcPair(env);
  const transport = (endpoint: string): TradeRpcV1 => {
    const request: TradeRpcV1 = async (method, params) => {
      await pace(endpoint, signal);
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetcher(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (response.status === 429) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after") ?? 1);
        // Long provider outages must not hold a launch open until its price expires.
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2) throw new Error();
        throw new ProviderRateLimit(Math.max(500, seconds * 1_000));
      }
      if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 1_048_576) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 1_048_576) throw new Error(); chunks.push(part.value);
      } } finally { await reader.cancel().catch(() => undefined); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (data?.code === -32007 || data?.error?.code === -32007) throw new ProviderRateLimit();
      if (!data || data.jsonrpc !== "2.0" || data.id !== 1) throw new Error();
      if (method === "eth_call" && data.error?.code === 3 && !Object.hasOwn(data, "result")
        && typeof data.error.message === "string" && /^execution reverted\b/i.test(data.error.message)
        && typeof data.error.data === "string" && /^0x(?:[0-9a-f]{2}){0,32768}$/i.test(data.error.data)) {
        throw new TradeRpcExecutionRevertedV1(data.error.data.toLowerCase() as Hex);
      }
      if (data.error || !Object.hasOwn(data, "result")) throw new Error();
      return data.result;
    };
    return async (method, params) => {
      try {
        try { return await request(method, params); }
        catch (error) {
          if (!(error instanceof ProviderRateLimit)) throw error;
          await pause(error.delayMs, signal);
          return await request(method, params);
        }
      } catch (error) {
        if (error instanceof TradeRpcExecutionRevertedV1) throw error;
        throw new Error("An Ethereum provider is temporarily unavailable.");
      }
    };
  };
  return [transport(pair.primary.url), transport(pair.secondary.url)];
}
