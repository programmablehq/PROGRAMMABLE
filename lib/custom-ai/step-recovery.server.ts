import "server-only";
import { toHex } from "viem";
import { objectV1, quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { asAddress, asHash, type CustomAIChain } from "./chain.server";
import { CustomAIError } from "./types";
import type { LaunchStep } from "./launch-session";

/** Recover a mined dispatch by sender and nonce, even if the wallet response
 * was lost. Both readers must identify the same canonical block and hash. */
export async function recoverStepHash(chain: CustomAIChain, step: LaunchStep) {
  const nonce = BigInt(step.transaction.nonce);
  const count = (height: bigint) => chain.agreed("eth_getTransactionCount", [step.transaction.from, toHex(height)],
    value => quantityV1(value).toString()).then(BigInt);
  let low = BigInt(step.preparedBlock), high = BigInt(chain.block.number);
  if (high < low || await count(high) <= nonce) return undefined;
  if (low > 0n && await count(low - 1n) > nonce) throw new CustomAIError("recovery", "The saved nonce predates this request. Keep this launch for recovery.", 409);
  for (let reads = 0; low < high; reads++) {
    if (reads >= 32) throw new CustomAIError("recovery", "This transaction needs a manual network check. Your launch is saved.", 503);
    const middle = (low + high) / 2n;
    if (await count(middle) > nonce) high = middle; else low = middle + 1n;
  }
  const found = await chain.agreed("eth_getBlockByNumber", [toHex(low), true], value => {
    const block = objectV1(value);
    if (quantityV1(block.number) !== low || !Array.isArray(block.transactions)) throw Error("Incomplete recovery block");
    const matches = block.transactions.map(objectV1).filter(tx =>
      asAddress(tx.from).toLowerCase() === step.transaction.from.toLowerCase() && quantityV1(tx.nonce) === nonce);
    if (matches.length !== 1 || asHash(matches[0].blockHash) !== asHash(block.hash)) throw Error("Inconsistent recovery block");
    return { blockHash: asHash(block.hash), hash: asHash(matches[0].hash) };
  });
  await chain.finish();
  return found.hash;
}
