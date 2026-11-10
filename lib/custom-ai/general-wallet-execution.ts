import { keccak256, type Hex } from "viem";
import { WalletRequestNotSubmittedError } from "@/lib/wallet-request-lock";
import { assertGraphWalletSendAvailable, beginGraphWalletAttempt, readGraphWalletAttempts, rejectGraphWalletAttempt, rememberGraphWalletHash,
  type GraphWalletAction, type GraphWalletContext, type GraphWalletAttempt } from "./general-wallet-attempt";

export type GeneralGraphWalletBoundary = Readonly<{
  context: GraphWalletContext;
  /** Synchronous final check of the original private scope and handoff. */
  assertCurrent(): void;
}>;

/** Runs INSIDE the existing account/network exclusive wallet lock, after
 * network/fee preparation. Never calls a wallet itself and never retries it. */
export async function executeGeneralGraphWalletSend(input: {
  action: GraphWalletAction; boundary?: GeneralGraphWalletBoundary; assertCurrent(): void;
  send(): Promise<Hex>; store?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}): Promise<Hex> {
  let attempt;
  try {
    input.assertCurrent(); input.boundary?.assertCurrent();
    // Also protects the older launch workspace from repeating an unresolved
    // Chat send after its five-minute generic wallet lease has expired.
    assertGraphWalletSendAvailable(input.action, input.store);
    if (input.boundary) attempt = beginGraphWalletAttempt(input.boundary.context, input.action, input.store);
  } catch (error) {
    throw new WalletRequestNotSubmittedError(error instanceof Error ? error.message : "The original wallet attempt could not be checked.");
  }
  try {
    const hash = await input.send();
    if (!/^0x(?!0{64}$)[a-f0-9]{64}$/iu.test(hash)) throw Error("The wallet did not return a valid transaction hash. Check its original activity before continuing.");
    if (attempt) {
      try { rememberGraphWalletHash(attempt, hash.toLowerCase() as Hex, input.store); }
      catch { /* Keep the unresolved durable record. Return the observed hash
        for display and independent backend discovery, as the Plan flow does. */ }
    }
    return hash;
  } catch (error) {
    if (attempt) rejectGraphWalletAttempt(attempt, error, input.store);
    throw error;
  }
}

export type GeneralGraphWalletRecovery = Readonly<{ attempt: GraphWalletAttempt; transactionHash: Hex; assertCurrent(): void }>;
/** Share the send lock without acquiring, expiring or clearing its lease. */
export async function withGeneralWalletJournalLock<Result>(controller: string, chainId: "1" | "4663" | "8453" | "999" | "99901", work: () => Promise<Result>): Promise<Result> {
  if (!/^0x[a-f0-9]{40}$/iu.test(controller) || !["1", "4663", "8453", "999", "99901"].includes(chainId) || !navigator.locks) throw Error("Safe transaction recovery is unavailable in this browser.");
  return navigator.locks.request(`programmable:wallet-request:v1:${chainId}:${controller.toLowerCase()}:exclusive`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw Error("The original wallet request is still open. Confirm or cancel it in your wallet first.");
    return work();
  });
}
/** Read-only provider recovery. Call under the same account/network Web Lock
 * as sends. A pasted hash is a hint; every original transaction field is read
 * from the connected network and matched before recording it. */
export async function recoverGeneralGraphWalletSend(input: GeneralGraphWalletRecovery & {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  store?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}): Promise<Hex> {
  input.assertCurrent();
  const { attempt, transactionHash } = input;
  const saved = readGraphWalletAttempts(attempt.controller, attempt.chainId, input.store).find(item => item.requestId === attempt.requestId);
  if (!saved || saved.requestHash !== attempt.requestHash || saved.actionHash !== attempt.actionHash || saved.startedAt !== attempt.startedAt
    || !/^0x(?!0{64}$)[a-f0-9]{64}$/iu.test(transactionHash) || saved.transactionHash && saved.transactionHash !== transactionHash.toLowerCase())
    throw Error("Restore the original saved transaction before continuing.");
  const [network, value] = await Promise.all([input.request({ method: "eth_chainId" }),
    input.request({ method: "eth_getTransactionByHash", params: [transactionHash] })]);
  input.assertCurrent();
  if (typeof network !== "string" || !/^0x[a-f0-9]+$/iu.test(network) || BigInt(network) !== BigInt(attempt.chainId)
    || !value || typeof value !== "object") throw Error("The original transaction was not found on the expected network.");
  const tx = value as Record<string, unknown>, data = tx.input ?? tx.data;
  if (typeof tx.hash !== "string" || tx.hash.toLowerCase() !== transactionHash.toLowerCase()
    || typeof tx.from !== "string" || tx.from.toLowerCase() !== saved.controller
    || typeof tx.to !== "string" || tx.to.toLowerCase() !== saved.to
    || typeof data !== "string" || !/^0x(?:[a-f0-9]{2})+$/iu.test(data) || keccak256(data as Hex) !== saved.dataHash
    || typeof tx.value !== "string" || !/^0x[a-f0-9]+$/iu.test(tx.value) || BigInt(tx.value) !== BigInt(saved.value)
    || tx.chainId !== undefined && (typeof tx.chainId !== "string" || !/^0x[a-f0-9]+$/iu.test(tx.chainId) || BigInt(tx.chainId) !== BigInt(attempt.chainId)))
    throw Error("This transaction does not match the original wallet attempt.");
  input.assertCurrent(); rememberGraphWalletHash(saved, transactionHash.toLowerCase() as Hex, input.store);
  return transactionHash.toLowerCase() as Hex;
}
