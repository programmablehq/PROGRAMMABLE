import "server-only";
import { decodeFunctionResult, encodeFunctionData, toHex, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { objectV1, quantityV1, bytesV1, tradeBlockV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { customAIChain, type CustomAIChain } from "./chain.server";
import { currentCustomAIDeployment, verifyCustomAIDeployment } from "./deployment.server";
import { customAIFactoryAbi, reconcileCustomAILaunch, type LaunchOrder } from "./launch-plan";
import type { CanonicalLaunchState, LaunchJournal } from "./wallet";

/** All completion evidence comes from the configured independent readers.
 * A receipt alone never changes an uncertain wallet dispatch into finality. */
export async function readCustomAILaunchState(order: LaunchOrder, journal: LaunchJournal | null,
  supplied?: CustomAIChain): Promise<CanonicalLaunchState> {
  const deployment = currentCustomAIDeployment(order.chainId);
  if (!deployment || deployment.factory.address.toLowerCase() !== order.factory.toLowerCase()) throw Error("The launch factory is not registered.");
  if (journal && journal.order.planHash !== order.planHash) throw Error("The saved journal belongs to another launch.");
  const chain = supplied ?? await customAIChain(order.chainId);
  await verifyCustomAIDeployment(chain, deployment);
  const data = encodeFunctionData({ abi: customAIFactoryAbi, functionName: "launchOf", args: [order.account, order.parameters.launchSalt] });
  const readAt = async (blockHash: Hex) => decodeFunctionResult({ abi: customAIFactoryAbi, functionName: "launchOf",
    data: await chain.agreed("eth_call", [{ to: order.factory, data }, { blockHash, requireCanonical: true }], bytesV1) });
  const current = await readAt(chain.block.hash);
  const finalizedTips = await Promise.all(chain.rpcs.map(async rpc => tradeBlockV1(await rpc("eth_getBlockByNumber", ["finalized", false]))));
  const height = finalizedTips.reduce((h, b) => BigInt(b.number) < h ? BigInt(b.number) : h, BigInt(chain.block.number));
  const finalized = await chain.agreed("eth_getBlockByNumber", [toHex(height), false], tradeBlockV1);
  const completed = await readAt(finalized.hash);
  let transaction, receipt: "pending" | "success" | "reverted" | undefined;
  if (journal?.transactionHash) {
    const observed = await chain.agreed("eth_getTransactionByHash", [journal.transactionHash], value => {
      if (value === null) return null;
      const tx = objectV1(value);
      return { hash: bytesV1(tx.hash), from: bytesV1(tx.from), to: tx.to === null ? null : bytesV1(tx.to),
        input: bytesV1(tx.input), value: quantityV1(tx.value).toString(), chainId: quantityV1(tx.chainId).toString() };
    });
    if (observed) {
      if (observed.hash !== journal.transactionHash.toLowerCase()) throw Error("The transaction reader returned another transaction.");
      transaction = { ...observed, from: observed.from as Address, to: observed.to as Address | null,
        value: BigInt(observed.value), chainId: Number(observed.chainId) };
    }
    const mined = await chain.agreed("eth_getTransactionReceipt", [journal.transactionHash], value => {
      if (value === null) return null;
      const r = objectV1(value);
      return { transactionHash: bytesV1(r.transactionHash), blockHash: bytesV1(r.blockHash),
        blockNumber: quantityV1(r.blockNumber).toString(), status: quantityV1(r.status).toString() };
    });
    if (mined) {
      const block = await chain.agreed("eth_getBlockByNumber", [toHex(BigInt(mined.blockNumber)), false], tradeBlockV1);
      if (block.hash !== mined.blockHash || mined.transactionHash !== journal.transactionHash.toLowerCase()) throw Error("The transaction receipt changed.");
      if (mined.status !== "0" && mined.status !== "1") throw Error("Unknown receipt status.");
      receipt = mined.status === "0" ? "reverted" : "success";
    } else receipt = "pending";
  }
  await chain.finish();
  const observation = { chainId: order.chainId, factory: order.factory, account: order.account, launchSalt: order.parameters.launchSalt,
    finalizedPlanHash: completed.planHash, finalizedToken: completed.token,
    dispatch: journal?.state === "dispatching" ? "uncertain" as const : journal?.state === "submitted" ? "submitted" as const : "not-sent" as const,
    transaction, receipt };
  const result = reconcileCustomAILaunch(order, observation);
  if (result.state === "confirmed" || result.state === "conflict") return result;
  if (current.token !== zeroAddress || current.planHash !== zeroHash) {
    return current.planHash === order.planHash && current.token.toLowerCase() === order.predictedToken.toLowerCase()
      ? { state: "pending", canSend: false } : { state: "conflict", canSend: false };
  }
  return result;
}
