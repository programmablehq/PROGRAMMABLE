import { keccak256, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { LaunchSendAttemptV1 } from "./launch-send-journal-v1";

export type LaunchSendResolutionV1 = {
  schemaVersion: "programmable.launch-send-resolution.v1";
  attemptHash: string; outcome: "failed" | "replaced";
  transactionHash: Hex; blockHash: Hex; blockNumber: string;
  controller: string; nonce: string; to: string | null; dataHash: Hex; value: string; status: "0x0" | "0x1";
  checkpoint: { blockHash: Hex; blockNumber: string };
};
export const launchSendAttemptHashV1 = (attempt: LaunchSendAttemptV1) => canonicalBrowserSha256V2("programmable.launch-send-attempt.v1", attempt);
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
const integer = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);

/** A trusted same-origin response must still match this exact unresolved attempt. */
export function checkedLaunchSendResolutionV1(attempt: LaunchSendAttemptV1, value: unknown): LaunchSendResolutionV1 {
  const proof = value as LaunchSendResolutionV1;
  if (!proof || proof.schemaVersion !== "programmable.launch-send-resolution.v1" || proof.attemptHash !== launchSendAttemptHashV1(attempt)
    || !["failed", "replaced"].includes(proof.outcome) || !hash(proof.transactionHash) || !hash(proof.blockHash)
    || proof.controller?.toLowerCase() !== attempt.controller.toLowerCase() || !integer(proof.nonce) || BigInt(proof.nonce) !== BigInt(attempt.nonce)
    || !integer(proof.value) || !integer(proof.blockNumber) || !hash(proof.dataHash)
    || !(proof.to === null || typeof proof.to === "string" && /^0x[0-9a-f]{40}$/i.test(proof.to))
    || !proof.checkpoint || !integer(proof.checkpoint.blockNumber) || !hash(proof.checkpoint.blockHash)
    || BigInt(proof.checkpoint.blockNumber) < BigInt(proof.blockNumber)) throw Error("The prior transaction resolution does not match this wallet attempt.");
  const sameCall = proof.to?.toLowerCase() === (attempt.transaction.to?.toLowerCase() ?? undefined)
    && proof.dataHash === keccak256(attempt.transaction.data) && BigInt(proof.value) === BigInt(attempt.transaction.value);
  if (proof.outcome === "failed" ? proof.status !== "0x0" : proof.status !== "0x1" || sameCall
    || attempt.transactionHash?.toLowerCase() === proof.transactionHash.toLowerCase()) throw Error("The original launch still needs confirmation.");
  return proof;
}
