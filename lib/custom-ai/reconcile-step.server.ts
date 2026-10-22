import "server-only";
import { randomUUID } from "node:crypto";
import { objectV1, bytesV1, quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { asAddress, asHash, type CustomAIChain } from "./chain.server";
import { recoverStepHash } from "./step-recovery.server";
import { stepMatchesTransaction, type WalletSession } from "./launch-session";

/** A replacement can change gas or replace an expired request, but must reuse
 * the reserved nonce. Reconcile every candidate before authorizing any retry. */
export async function reconcileWalletStep(chain:CustomAIChain,session:WalletSession) {
  const last=session.steps.at(-1);
  if (!last || ["confirmed","failed"].includes(last.state)) return false;
  const candidates=session.steps.filter(step=>step.transaction.nonce===last.transaction.nonce);
  if (!candidates.some(step=>step.dispatchedAt || step.hash)) return false;
  const preparedBlock=candidates.reduce((low,step)=>BigInt(step.preparedBlock)<BigInt(low)?step.preparedBlock:low,last.preparedBlock);
  const hash=await recoverStepHash(chain,{...last,preparedBlock});
  if (!hash) return false;
  const tx=await chain.agreed("eth_getTransactionByHash",[hash],value=> {
    const row=objectV1(value);
    return {hash:asHash(row.hash),from:asAddress(row.from),to:row.to===null?null:asAddress(row.to),input:bytesV1(row.input),
      value:quantityV1(row.value).toString(),chainId:Number(quantityV1(row.chainId)),nonce:quantityV1(row.nonce).toString()};
  });
  if (tx.hash!==hash) throw Error("Recovered transaction hash changed");
  const matching=candidates.findLast(step=>stepMatchesTransaction(step,{...tx,value:BigInt(tx.value),nonce:BigInt(tx.nonce)}));
  if (!matching) {
    // A cancellation or unrelated replacement consumed the nonce. It proves
    // this saved operation did not execute; it is never reported as success.
    if (last.hash && last.hash!==hash) last.replacedHashes=[...(last.replacedHashes??[]),last.hash];
    last.hash=hash;last.state="failed";last.failureReason="replaced";session.state="failed";
    return true;
  }
  if (matching===last && last.hash===hash && last.state==="submitted") return false;
  if (matching!==last) {
    last.state="rejected";
    session.steps.push({...matching,id:randomUUID(),hash,state:"submitted"});
  } else {
    if(last.hash && last.hash!==hash)last.replacedHashes=[...(last.replacedHashes??[]),last.hash];
    last.hash=hash;last.state="submitted";
  }
  session.state="waiting";
  return true;
}
