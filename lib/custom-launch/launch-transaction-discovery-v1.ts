import { toHex, type Hex } from "viem";
import { projectionHash, projectionObject } from "./launch-projection-v1";
import type { LaunchSendAttemptV1 } from "./launch-send-journal-v1";
import { recoverUniversalLaunchTransactionV1, type LaunchWalletProviderV1 } from "./wallet-handoff-plan-v1";

const quantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Transaction history is temporarily unavailable.");
  return BigInt(value);
};

/** Read-only discovery. An absent/replaced transaction never releases the send lock. */
export async function discoverUniversalLaunchTransactionV1(provider: LaunchWalletProviderV1, attempt: LaunchSendAttemptV1,
  resource: unknown, signal?: AbortSignal): Promise<Hex | null> {
  let reads = 0;
  const request: LaunchWalletProviderV1["request"] = async input => {
    signal?.throwIfAborted();
    if (++reads > 96) throw new Error("Transaction history search will retry shortly.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const result = await Promise.race([provider.request(input), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Transaction history is temporarily unavailable.")), 15000);
        abort = () => reject(signal?.reason ?? new Error("Transaction search cancelled."));
        signal?.addEventListener("abort", abort, { once: true });
      })]);
      signal?.throwIfAborted();
      return result;
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
  };
  // Background discovery must never ask the wallet to switch networks or sign.
  if (await request({ method: "eth_chainId" }) !== "0x1237") return null;
  const nonce = quantity(attempt.nonce);
  const head = quantity(await request({ method: "eth_blockNumber" }));
  const count = async (block: bigint) => quantity(await request({ method: "eth_getTransactionCount", params: [attempt.controller, toHex(block)] }));
  if (await count(head) <= nonce) return null;

  // Locate the first block that consumed this nonce without downloading block ranges.
  let upper = head, lower = 0n, distance = 128n;
  while (upper > 0n) {
    lower = head > distance ? head - distance : 0n;
    if (await count(lower) <= nonce) break;
    if (lower === 0n) return null;
    upper = lower; distance *= 2n;
  }
  while (upper - lower > 1n) {
    const middle = (upper + lower) / 2n;
    if (await count(middle) > nonce) upper = middle;
    else lower = middle;
  }
  const block = await request({ method: "eth_getBlockByNumber", params: [toHex(upper), true] });
  if (!projectionObject(block) || !projectionHash(block.hash) || quantity(block.number) !== upper || !Array.isArray(block.transactions)) return null;
  const matches = block.transactions.filter(transaction => projectionObject(transaction)
    && typeof transaction.from === "string" && transaction.from.toLowerCase() === attempt.controller.toLowerCase()
    && quantity(transaction.nonce) === nonce);
  // Delegation authorizations can also consume a nonce without this launch being sent.
  if (matches.length !== 1 || !projectionObject(matches[0]) || !projectionHash(matches[0].hash)) return null;
  const hash = await recoverUniversalLaunchTransactionV1({ request }, attempt, matches[0].hash, resource);
  const canonical = await request({ method: "eth_getBlockByNumber", params: [toHex(upper), false] });
  if (!projectionObject(canonical) || canonical.hash !== block.hash) return null;
  return hash;
}
