import "server-only";
import { randomUUID } from "node:crypto";
import { toHex, type Address, type Hex } from "viem";
import { bytesV1, objectV1, quantityV1, tradeBlockV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { asAddress, asHash, type CustomAIChain } from "./chain.server";
import { stepMatchesTransaction, type WalletSession, type LaunchStep } from "./launch-session";
import { CustomAIError } from "./types";
export async function pendingNonce(chain: CustomAIChain, account: Address) {
  const [latest, pending] = await Promise.all(["latest", "pending"].map(tag =>
    chain.agreed("eth_getTransactionCount", [account, tag], value => quantityV1(value).toString())));
  if (latest !== pending) throw new CustomAIError("pending", "Wait for your pending wallet transaction to finish first.", 409);
  return BigInt(latest);
}
export async function verifiedStepReceipt(chain: CustomAIChain, step: LaunchStep) {
  if (!step.hash) return { state: "pending" as const, receipt: null };
  const tx = await chain.agreed("eth_getTransactionByHash", [step.hash], value => {
    if (value === null) return null;
    const row = objectV1(value);
    return { from: asAddress(row.from), to: row.to === null ? null : asAddress(row.to), input: bytesV1(row.input),
      hash: asHash(row.hash), value: quantityV1(row.value).toString(), chainId: Number(quantityV1(row.chainId)), nonce: quantityV1(row.nonce).toString() };
  });
  if (!tx) return { state: "pending" as const, receipt: null };
  if (tx.hash.toLowerCase() !== step.hash.toLowerCase() || !stepMatchesTransaction(step, { ...tx, value: BigInt(tx.value), nonce: BigInt(tx.nonce) })) {
    throw new CustomAIError("conflict", "The wallet transaction differs from the saved request. Keep this launch for recovery.", 409);
  }
  const receipt = await chain.agreed("eth_getTransactionReceipt", [step.hash], value => {
    if (value === null) return null;
    const row = objectV1(value);
    return { hash: asHash(row.transactionHash), blockHash: asHash(row.blockHash), block: quantityV1(row.blockNumber).toString(), status: quantityV1(row.status).toString(), logs: row.logs };
  });
  if (!receipt || BigInt(receipt.block) > BigInt(chain.block.number)) return { state: "pending" as const, receipt: null };
  const block = await chain.agreed("eth_getBlockByNumber", [toHex(BigInt(receipt.block)), false], tradeBlockV1);
  if (receipt.hash !== step.hash || block.hash !== receipt.blockHash) throw new CustomAIError("chain", "The network changed. Check this launch again.", 503);
  if (!["0", "1"].includes(receipt.status)) throw Error("Unknown transaction status");
  return { state: receipt.status === "1" ? "confirmed" as const : "failed" as const, receipt };
}

export async function receiptState(chain: CustomAIChain, step: LaunchStep) {
  return (await verifiedStepReceipt(chain, step)).state;
}

export async function makeStep(chain: CustomAIChain, session: WalletSession, kind: LaunchStep["kind"], to: Address | null, data: Hex, value = 0n, expiresAt = Math.floor(Date.now()/1000) + 120): Promise<LaunchStep> {
  const nonce = await pendingNonce(chain, session.account);
  const previous = session.steps.at(-1);
  const unresolved=previous && session.steps.some(step=>step.transaction.nonce===previous.transaction.nonce && step.dispatchedAt);
  if (previous && unresolved && ["prepared","dispatching","submitted"].includes(previous.state) && nonce !== BigInt(previous.transaction.nonce)) {
    throw new CustomAIError("recovery", "Your previous wallet request is confirming. Check it again shortly.", 409);
  }
  const transaction = { from: session.account, to, data, value: toHex(value), chainId: chain.chainId, nonce: toHex(nonce) };
  const estimates = await Promise.all(chain.rpcs.map(async rpc => quantityV1(await rpc("eth_estimateGas", [{ ...transaction, chainId: toHex(chain.chainId), ...(to === null ? { to: undefined } : {}) }]))));
  const gas = estimates.reduce((left,right) => left > right ? left : right);
  if (gas > 25_000_000n) throw new CustomAIError("gas", "This launch exceeds the transaction gas limit.", 422);
  await chain.finish();
  return { id: randomUUID(), kind, state: "prepared", transaction: { ...transaction, gas: toHex(BigInt(gas) * 120n / 100n + 10000n) },
    expiresAt, preparedBlock: chain.block.number };
}
