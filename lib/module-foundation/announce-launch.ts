import type { Address, Hex } from "viem";
import type { FoundationChainId } from "./chains";

const requests = new Map<string, Promise<void>>();
type ReceiptHint = { chainId: FoundationChainId; token: Address; transactionHash: Hex };

async function sendHint(input: ReceiptHint): Promise<boolean> {
  let retryAfterMs = 0;
  for (const backoff of [0, 5_000, 20_000]) {
    const delay = Math.max(backoff, retryAfterMs);
    if (delay > 60_000) break;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    retryAfterMs = 0;
    try {
      const response = await fetch("/api/module-foundation/confirmed", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(input), keepalive: true, signal: AbortSignal.timeout(55_000),
      });
      await response.body?.cancel();
      if (response.ok || response.status === 400 || response.status === 403) return true;
      const seconds = response.headers.get("retry-after");
      if (seconds && /^\d+$/.test(seconds)) retryAfterMs = Number(seconds) * 1_000;
    } catch { /* Only the discovery hint needs another attempt. */ }
  }
  return false;
}

/** A receipt hint only; the server independently verifies the transaction before listing it. */
export function announceFoundationLaunch(input: ReceiptHint) {
  const key = `${input.chainId}:${input.token.toLowerCase()}:${input.transactionHash.toLowerCase()}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const task = sendHint(input).then(finished => {
    if (!finished && requests.get(key) === task) requests.delete(key);
  });
  if (requests.size >= 64) requests.delete(requests.keys().next().value!);
  requests.set(key, task);
  return task;
}
