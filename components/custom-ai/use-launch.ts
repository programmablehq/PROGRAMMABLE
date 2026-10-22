"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWallet } from "@/components/wallet-provider";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { aiRequest } from "@/lib/custom-ai/client";
import { decodeLaunchValue } from "@/lib/custom-ai/wallet";
import { dismissFinishedLaunch, isFinishedLaunchDismissed, launchRequestId, readLocalLaunch, requestLaunch, saveLocalLaunch } from "@/lib/custom-ai/launch-client";
import { launchStepLabel, type StoredLaunchSession } from "@/lib/custom-ai/launch-session";
import { setupQuoteAddress, type CoinSetup } from "@/lib/custom-ai/coin-setup";
import type { ImageReceipt } from "@/lib/custom-ai/studio";

export function useCustomAILaunch(input: { settings: CoinSetup; draftId?: string; image?: Blob; imageReceipt?: ImageReceipt; headers: AISessionHeaders; localPreview: boolean }) {
  const wallet = useWallet();
  const [saved, setSaved] = useState<StoredLaunchSession | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef(saved);
  const operation = useRef(false);
  const identity = useRef(wallet.wallet?.account);
  const receipt = useRef<{ blob: Blob; id: string; url: string } | undefined>(undefined);
  const { headers } = input;
  const headersRef = useRef(headers);
  const account = wallet.wallet?.account;
  useLayoutEffect(() => {
    if (identity.current !== account) {
      current.current = null; setSaved(null); receipt.current = undefined; setError("");
    } else current.current = saved;
    identity.current = account; headersRef.current = headers;
  }, [saved, account, headers]);
  const remember = useCallback((value: StoredLaunchSession) => {
    saveLocalLaunch(value);
    if (identity.current?.toLowerCase() === value.session.account.toLowerCase()) { current.current = value; setSaved(value); }
  }, []);
  useEffect(() => {
    if (input.localPreview || !account) return;
    let cancelled = false;
    void aiRequest(`/launch?account=${account}`, () => headersRef.current()).then(raw => {
      if (cancelled) return;
      const saved = decodeLaunchValue(JSON.stringify(raw)) as StoredLaunchSession | null;
      const value = readLocalLaunch(account);
      // Prefer a local unacknowledged hash for the same server-owned request.
      const restored = value?.session.id === saved?.session.id && value?.session.steps.at(-1)?.hash ? value : saved;
      if (restored && !isFinishedLaunchDismissed(restored)) { setSaved(restored); current.current = restored; }
    }).catch(() => {
      if (cancelled) return;
      try { const local = readLocalLaunch(account); if (local && !isFinishedLaunchDismissed(local)) { setSaved(local); current.current = local; } }
      catch { setError("Your saved launch could not be read. Keep this browser's data for recovery."); }
    });
    return () => { cancelled = true; };
  }, [account, input.localPreview]);

  const refresh = useCallback(async (value: StoredLaunchSession) => {
    const local = readLocalLaunch(value.session.account);
    const last = local?.session.id === value.session.id ? local.session.steps.at(-1) : undefined;
    if (last?.hash && last.state === "submitted") {
      // Recover an acknowledgement lost after the wallet returned its hash.
      await requestLaunch(headersRef.current, { action: "submitted", id: value.session.id, stepId: last.id, hash: last.hash }).catch(() => undefined);
    }
    const updated = await requestLaunch(headersRef.current, { action: "next", id: value.session.id });
    remember(updated);
    return updated;
  }, [remember]);
  useEffect(() => {
    if (saved?.session.state !== "waiting" || input.localPreview) return;
    const timer = setInterval(() => {
      if (operation.current || !current.current || document.hidden) return;
      operation.current = true;
      void refresh(current.current).catch(cause => setError(cause instanceof Error ? cause.message : "The network check did not finish."))
        .finally(() => { operation.current = false; });
    }, 15000);
    return () => clearInterval(timer);
  }, [saved?.session.state, input.localPreview, refresh]);

  async function proceed() {
    if (operation.current || input.localPreview) return;
    if (!account) { wallet.openWallet(); return; }
    operation.current = true; setBusy(true); setError("");
    try {
      let value = current.current;
      const previousStep = value?.session.steps.at(-1);
      let justCreated = false;
      if (value?.session.state === "failed") {
        value = await requestLaunch(headersRef.current, { action: "retry", id: value.session.id });
        remember(value);
      }
      else if (value && value.session.state !== "confirmed") value = await refresh(value);
      else {
        if (!input.draftId) throw Error("Describe your hook in the chat first.");
        if (!input.image && !input.imageReceipt) throw Error("Choose your coin image first.");
        if (!input.settings.name.trim() || !input.settings.symbol.trim()) throw Error("Add a name and ticker first.");
        if (!input.imageReceipt && input.image && receipt.current?.blob !== input.image) {
          const response = await fetch("/api/custom-ai/image", { method: "POST", headers: { ...await headersRef.current(), "Content-Type": "image/webp" }, body: input.image });
          const uploaded = await response.json();
          if (!response.ok) throw Error(uploaded.error || "The image could not be uploaded.");
          receipt.current = { blob: input.image, id: uploaded.id, url: uploaded.url };
        }
        const image = input.imageReceipt ?? receipt.current!;
        const payload = { action: "create", account,
          draftId: input.draftId, imageId: image.id,
          settings: { name: input.settings.name, symbol: input.settings.symbol, chainId: input.settings.chainId,
            quote: setupQuoteAddress(input.settings), initialBuy: input.settings.initialBuy, imageURI: image.url } };
        value = await requestLaunch(headersRef.current, { ...payload, id: launchRequestId(account, payload) });
        remember(value);
        justCreated = true;
      }
      const step = value.session.steps.at(-1);
      // An expired request may have a new price/minimum. Show it before asking
      // the wallet to authorize that replacement.
      if (previousStep && step?.id !== previousStep.id) return;
      if (value.session.state === "ready" && step?.state === "prepared" && !(justCreated && value.session.quoteNotice)) {
        await wallet.sendCustomAIWalletStep(value.session.id, step);
        const local = readLocalLaunch(account);
        if (local) remember(local);
        await refresh(value);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The launch could not continue. Your progress is saved."); }
    finally { operation.current = false; setBusy(false); }
  }
  const pending = saved && saved.session.state !== "confirmed";
  const step = saved?.session.steps.at(-1);
  const label = busy ? "Preparing…" : saved?.session.state === "failed" ? "Try transaction again" : saved?.session.state === "waiting" ? "Check transaction"
    : saved?.session.state === "ready" && step ? launchStepLabel(step.kind) : "Create coin";
  function startAnother() {
    if (!saved || saved.session.state!=="confirmed") return false;
    try { dismissFinishedLaunch(saved);current.current=null;setSaved(null);receipt.current=undefined;setError("");return true; }
    catch {setError("The completed launch could not be saved. Keep this tab open.");return false;}
  }
  return { proceed, startAnother, busy, error, label, locked: Boolean(pending), saved,
    message: saved?.session.state === "confirmed" ? "Your coin is live."
      : saved?.session.state === "waiting" ? step?.kind === "launch" ? "Your launch is confirming." : "Waiting for the transaction to confirm."
      : saved?.session.state === "failed" ? step?.failureReason === "replaced" ? "This wallet request was replaced. Your earlier steps are saved." : "The transaction reverted. Your earlier steps are saved." : "" };
}
