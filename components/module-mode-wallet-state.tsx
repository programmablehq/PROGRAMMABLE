import { errorIsExplicitWalletRejection } from "@/lib/wallet-rejection";
import { sha256, type Address, type Hex } from "viem";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { walletChainIdsEqual } from "@/lib/wallet-chain-id";
import type { ModuleModeDraft } from "@/lib/module-mode/builder";
import type { ModuleNativeWalletTransaction, PreparedModuleNativeTransaction } from "@/lib/module-mode/native-client";
import type { PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import type { FoundationWalletPreparation } from "@/lib/module-foundation/wallet";
import { isProgrammableTokenImageUrl, readTokenImageUploadResponse } from "@/lib/token-image";
import { withTokenImageUploadDeadline } from "@/lib/token-image-upload";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationSnapshot, parseModuleModeOperation, rememberModuleModeTransactionHash, subscribeToModuleModeOperation, type ModuleModeOperation, type ModuleModeRecoveryPreparation } from "@/lib/module-mode-operation-store";

export type PreparedModuleModeTransaction = PreparedModuleNativeTransaction | PreparedModuleEngineTransaction | FoundationWalletPreparation;

/** Select only the concrete source's private preparation validator. No source can fall back to another protocol. */
export async function revalidateModuleModeTransaction(prepared: PreparedModuleModeTransaction, account: Address): Promise<ModuleNativeWalletTransaction> {
  if (!prepared || typeof prepared !== "object") throw new Error("The transaction preparation is invalid.");
  if ("sourceKind" in prepared) {
    if (prepared.sourceKind === "module-foundation-v1") {
      const { revalidateFoundationWalletStep } = await import("@/lib/module-foundation/wallet");
      return revalidateFoundationWalletStep(prepared, account);
    }
    if (prepared.sourceKind !== "module-engine-v1") throw new Error("The transaction source is unsupported.");
    const { revalidateModuleEngineTransaction } = await import("@/lib/module-engine/client");
    return revalidateModuleEngineTransaction(prepared, account);
  }
  const { revalidateModuleNativeTransaction } = await import("@/lib/module-mode/native-client");
  return revalidateModuleNativeTransaction(prepared, account);
}

/** Shared durable boundary for reviewed engine launches and operations. The wallet provider still owns signing authority. */
export async function submitModuleModeOperation(prepared: ModuleModeRecoveryPreparation,
  send: (prepared: PreparedModuleModeTransaction) => Promise<Hex>): Promise<{ operation: ModuleModeOperation; transactionHash: Hex }> {
  let operation = await beginModuleModeOperation(prepared);
  let transactionHash: Hex;
  try { transactionHash = await send(prepared); }
  catch (error) {
    if (!moduleModeSubmissionIsUncertain(error, true)) {
      try { await clearModuleModeOperation(operation); } catch { /* Failed cleanup keeps the account blocked. */ }
    }
    throw error;
  }
  try { operation = await rememberModuleModeTransactionHash(operation, transactionHash); }
  catch { /* Preserve the returned hash; the original unknown record still blocks another send. */ }
  // The caller clears only after the exact receipt or recovery readback proves success or a revert.
  return { operation, transactionHash };
}

export function useModuleModeOperation(account: string | undefined): { operation: ModuleModeOperation | null; blocked: boolean; error: string | null } {
  const subscribe = useCallback((listener: () => void) => subscribeToModuleModeOperation(account, listener), [account]);
  const snapshot = useCallback(() => moduleModeOperationSnapshot(account), [account]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => {
    if (raw === null || !account) return { operation: null, blocked: false, error: null };
    try { return { operation: parseModuleModeOperation(raw, account), blocked: true, error: null }; }
    catch { return { operation: null, blocked: true, error: "Your saved transaction record cannot be read. Check your wallet activity before continuing. Another transaction will not be sent." }; }
  }, [raw, account]);
}

export interface ModuleModeWalletSnapshot {
  account?: string;
  chainId?: string;
  authenticated: boolean;
  sessionReady: boolean;
}

export function isModuleModeChain(chainId: string | undefined, targetChainId: FoundationChainId = 4663) {
  return walletChainIdsEqual(chainId, foundationChainProfile(targetChainId).chainId);
}

export function moduleModeWalletStep(wallet: ModuleModeWalletSnapshot, targetChainId: FoundationChainId = 4663): "connect" | "switch" | "prepare" {
  if (!wallet.authenticated || !wallet.sessionReady || !wallet.account) return "connect";
  return isModuleModeChain(wallet.chainId, targetChainId) ? "prepare" : "switch";
}

/** The wallet context accepts decimal network IDs; its EIP-1193 state uses hex. */
export async function switchModuleModeNetwork(switchNetwork: (chainId: string) => Promise<boolean>, targetChainId: FoundationChainId = 4663): Promise<void> {
  if (!await switchNetwork(String(foundationChainProfile(targetChainId).chainId))) {
    throw new Error("Your wallet connection could not be confirmed. Open your wallet and try again.");
  }
}

export function assertModuleModeWalletUnchanged(current: ModuleModeWalletSnapshot, expectedAccount: string, targetChainId: FoundationChainId = 4663) {
  if (moduleModeWalletStep(current, targetChainId) !== "prepare" || current.account?.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error("Your wallet or network changed. Return to the draft and prepare again with the current wallet.");
  }
}

/** Only a definite user rejection permits a fresh send attempt without reconciliation. */
export const isModuleModeWalletRejection = errorIsExplicitWalletRejection;

export function moduleModeSubmissionIsUncertain(error: unknown, providerCalled: boolean) {
  if (!providerCalled || isModuleModeWalletRejection(error)) return false;
  return (error as { walletRequestAttempted?: unknown } | null)?.walletRequestAttempted !== false;
}

/** Upload only the exact prepared file that the user reviewed. No draft mutation. */
export async function uploadModuleModeImage(input: {
  image: ModuleModeDraft["token"]["image"];
  blob?: Blob;
  getAccessToken: () => Promise<string | null>;
  assertCurrentSession: () => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ uri: string; sourceSha256?: Hex }> {
  input.assertCurrentSession();
  if (input.image.kind === "uri") return { uri: input.image.uri };
  const image = input.image;
  const blob = input.blob;
  if (!blob || blob.type !== input.image.mimeType || blob.size !== input.image.bytes) {
    throw new Error("The prepared image does not match your draft. Choose the image again.");
  }
  return withTokenImageUploadDeadline(async signal => {
    const digest = sha256(new Uint8Array(await blob.arrayBuffer()));
    signal.throwIfAborted();
    if (digest !== image.sha256) throw new Error("The image changed after review. Choose the image again before launching.");
    input.assertCurrentSession();
    const accessToken = await input.getAccessToken();
    signal.throwIfAborted();
    input.assertCurrentSession();
    if (!accessToken) throw new Error("Reconnect your wallet to upload the token image.");
    const form = new FormData();
    form.append("file", new File([blob], "token-image.webp", { type: "image/webp" }));
    const response = await (input.fetcher ?? fetch)("/api/token-image", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form,
      credentials: "same-origin", redirect: "error", signal,
    });
    const body = await readTokenImageUploadResponse(response);
    signal.throwIfAborted();
    input.assertCurrentSession();
    if (!response.ok || typeof body?.url !== "string" || !isProgrammableTokenImageUrl(body.url)) {
      throw new Error(response.status === 401 ? "Your session expired. Reconnect your wallet before preparing again." : "The token image could not be published. Your draft and original image are kept; try preparing again.");
    }
    return { uri: body.url, sourceSha256: digest };
  }, input.signal);
}
