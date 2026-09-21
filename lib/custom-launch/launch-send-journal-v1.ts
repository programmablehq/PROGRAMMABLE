import type { Hex } from "viem";
import { errorIsExplicitWalletRejection } from "@/lib/wallet-request-lock";
import type { UniversalLaunchWalletReviewV1 } from "./wallet-handoff-plan-v1";

const PREFIX = "programmable:custom-launch-send:v1";
const EVENT = "programmable:custom-launch-send-change";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LaunchSendAttemptV1 = {
  schemaVersion: "programmable.custom-launch-send.v1";
  sourceVersion: UniversalLaunchWalletReviewV1["sourceVersion"];
  launchId: string; stepId: string; binding: string;
  controller: string; chainId: "4663"; nonce: Hex;
  transaction: UniversalLaunchWalletReviewV1["transaction"];
  startedAt: string; transactionHash: Hex | null;
};
const key = (controller: string) => {
  if (!/^0x[0-9a-f]{40}$/i.test(controller)) throw new Error("The recovery controller is invalid.");
  return `${PREFIX}:4663:${controller.toLowerCase()}`;
};
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); };
const storage = () => window.localStorage;

export function readLaunchSendJournalV1(controller: string, store: StorageLike = storage()): string | null {
  try { return store.getItem(key(controller)); }
  catch { return "unavailable"; }
}

/** Invalid storage also blocks a send; loss of evidence is never evidence of no broadcast. */
export function parseLaunchSendAttemptV1(raw: string | null, controller: string): LaunchSendAttemptV1 | null {
  if (raw === null) return null;
  try {
    const row = JSON.parse(raw) as LaunchSendAttemptV1;
    if (raw.length > 1_048_576 || row.schemaVersion !== "programmable.custom-launch-send.v1"
      || !["custom_launch_plan_v1", "multi_role_v2"].includes(row.sourceVersion)
      || !/^[0-9a-f-]{36}$/i.test(row.launchId) || typeof row.stepId !== "string" || !row.stepId
      || !/^sha256:[0-9a-f]{64}$/.test(row.binding) || row.chainId !== "4663"
      || row.controller.toLowerCase() !== controller.toLowerCase() || !/^0x[0-9a-f]+$/i.test(row.nonce)
      || row.transaction.chainId !== "0x1237" || row.transaction.from.toLowerCase() !== controller.toLowerCase()
      || row.transaction.nonce !== undefined && row.transaction.nonce !== row.nonce || !Number.isFinite(Date.parse(row.startedAt))
      || !(row.transactionHash === null || /^0x[0-9a-f]{64}$/i.test(row.transactionHash))) throw new Error();
    return row;
  } catch { throw new Error("The saved wallet attempt cannot be read. Restore its transaction receipt before continuing."); }
}

function save(row: LaunchSendAttemptV1, store: StorageLike): LaunchSendAttemptV1 {
  const raw = JSON.stringify(row);
  store.setItem(key(row.controller), raw);
  if (store.getItem(key(row.controller)) !== raw) throw new Error("The wallet recovery record could not be saved. No new transaction can be sent.");
  notify();
  return row;
}

/** Call only inside the account's exclusive wallet lock, immediately before eth_sendTransaction. */
export function beginLaunchSendV1(review: UniversalLaunchWalletReviewV1, store: StorageLike = storage()): LaunchSendAttemptV1 {
  if (readLaunchSendJournalV1(review.transaction.from, store) !== null) {
    throw new Error("An earlier launch transaction needs recovery or finality. Continue its tracking before sending another transaction.");
  }
  const nonce = review.transaction.nonce ?? review.controllerNonce;
  if (!nonce) throw new Error("The wallet transaction needs a bound nonce before it can be sent.");
  return save({ schemaVersion: "programmable.custom-launch-send.v1", sourceVersion: review.sourceVersion,
    launchId: review.launchId, stepId: review.stepId, binding: review.binding, controller: review.transaction.from,
    chainId: "4663", nonce, transaction: review.transaction,
    startedAt: new Date().toISOString(), transactionHash: null }, store);
}

export function rememberLaunchHashV1(attempt: LaunchSendAttemptV1, hash: Hex, store: StorageLike = storage()): LaunchSendAttemptV1 {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("The wallet did not return a transaction hash. Recover the original transaction before continuing.");
  const saved = parseLaunchSendAttemptV1(readLaunchSendJournalV1(attempt.controller, store), attempt.controller);
  if (!saved || saved.binding !== attempt.binding || saved.launchId !== attempt.launchId || saved.nonce !== attempt.nonce
    || saved.transactionHash && saved.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("The saved wallet attempt changed. Reconcile its original transaction.");
  return save({ ...saved, transactionHash: hash.toLowerCase() as Hex }, store);
}

export function rejectLaunchSendV1(attempt: LaunchSendAttemptV1, error: unknown, store: StorageLike = storage()): void {
  if (!errorIsExplicitWalletRejection(error)) return;
  const raw = readLaunchSendJournalV1(attempt.controller, store);
  const saved = parseLaunchSendAttemptV1(raw, attempt.controller);
  if (saved && !saved.transactionHash && saved.binding === attempt.binding && saved.startedAt === attempt.startedAt) {
    store.removeItem(key(attempt.controller)); notify();
  }
}

/** A finalized backend step, including its exact original hash, is the only successful release. */
export function finalizeLaunchSendV1(attempt: LaunchSendAttemptV1, step: { transactionDigest: string; transactionHash: Hex | null; status: string }, store: StorageLike = storage()): void {
  if (step.status !== "final" || step.transactionDigest !== attempt.binding || !step.transactionHash
    || step.transactionHash.toLowerCase() !== attempt.transactionHash?.toLowerCase()) return;
  const saved = parseLaunchSendAttemptV1(readLaunchSendJournalV1(attempt.controller, store), attempt.controller);
  if (saved && saved.binding === attempt.binding && saved.transactionHash === attempt.transactionHash) {
    store.removeItem(key(attempt.controller)); notify();
  }
}

export function subscribeLaunchSendV1(callback: () => void): () => void {
  window.addEventListener("storage", callback); window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
