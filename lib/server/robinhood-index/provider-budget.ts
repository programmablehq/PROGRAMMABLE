import { setTimeout as delay } from "node:timers/promises";
import type { EIP1193RequestOptions } from "viem";

type RpcArgs = { method: string; params?: readonly unknown[] };
type RpcRequest = (args: RpcArgs, options?: EIP1193RequestOptions) => Promise<unknown>;
type Timing = { now(): number; wait(ms: number, signal: AbortSignal): Promise<void> };

/** One provider and one index operation: pace reads and reuse only pinned state. */
export function budgetIndexProvider(request: RpcRequest, signal: AbortSignal, timing: Timing = {
  now: () => Date.now(),
  wait: (ms: number, abort: AbortSignal) => delay(ms, undefined, { signal: abort }),
}): RpcRequest {
  let tail = Promise.resolve();
  let lastStarted = -Infinity;
  const pinned = new Map<string, Promise<unknown>>();
  return (args, options) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    const block = args.params?.[1];
    const fixedBlock = typeof block === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(block);
    const key = fixedBlock && ["eth_call", "eth_getCode"].includes(args.method) ? JSON.stringify(args) : null;
    const cached = key ? pinned.get(key) : undefined;
    if (cached) return cached;
    const result = tail.then(async () => {
      signal.throwIfAborted();
      const remaining = 250 - (timing.now() - lastStarted);
      if (remaining > 0) await timing.wait(remaining, signal);
      signal.throwIfAborted();
      lastStarted = timing.now();
      return request(args, options);
    });
    tail = result.then(() => undefined, () => undefined);
    if (key && pinned.size < 256) {
      pinned.set(key, result);
      void result.then(value => {
        // Failed, empty or malformed observations are not reusable evidence.
        if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value) || value.length > 262_146) pinned.delete(key);
      }, () => { pinned.delete(key); });
    }
    return result;
  };
}
