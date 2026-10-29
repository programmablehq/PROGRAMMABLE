"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ImagePlus, LoaderCircle, X } from "lucide-react";
import { isAddress, parseEther } from "viem";
import { prepareTokenImage, TOKEN_IMAGE_ACCEPT } from "@/lib/token-image";
import { ChainMark } from "@/components/chain-mark";
import { coinBio, setupQuoteAddress, type CoinSetup, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { Draft } from "@/lib/custom-ai/types";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { CoinSelect } from "./coin-select";
import { useCustomAILaunch } from "./use-launch";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import type { ImageReceipt } from "@/lib/custom-ai/studio";
import styles from "./workspace.module.css";
import { useWallet } from "@/components/wallet-provider";
import { aiRequest } from "@/lib/custom-ai/client";
import { designReadiness, type LaunchPreparation } from "@/lib/custom-ai/readiness";
import { RuleReview } from "./rule-review";

export function CustomAILaunchPreview({ draft, disabled, settings: editingSettings, chatRevision, onChange, draftId, headers, localPreview, cacheKey, onLaunchLocked, imageReceipt, onImageReceipt, pendingChange, onKeepRules, onStartAnother }: {
  draft?: Draft; disabled: boolean; settings: CoinSetup; chatRevision: number; onChange: (patch: CoinSetupPatch) => void;
  draftId?: string; headers: AISessionHeaders; localPreview: boolean;
  cacheKey: string;
  onLaunchLocked: (locked: boolean) => void;
  imageReceipt?: ImageReceipt; onImageReceipt: (receipt: ImageReceipt | undefined) => void;
  pendingChange?: string; onKeepRules: () => void; onStartAnother: () => void;
}) {
  const account = useWallet().wallet?.account;
  const [preparation, setPreparation] = useState<LaunchPreparation>();
  const headersRef = useRef(headers);
  useEffect(() => { headersRef.current = headers; }, [headers]);
  const preparationKey = JSON.stringify([editingSettings, account, imageReceipt?.id, draft?.sourceHash]);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageRequest = useRef(0);
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  const reviewedSourceHash = !pendingChange && draft?.verification?.status === "passed" && draft.verification.sourceHash === draft.sourceHash ? draft.sourceHash : undefined;
  const launch = useCustomAILaunch({ settings: editingSettings, draftId, reviewedSourceHash, image: image?.blob, imageReceipt, headers, localPreview, readyTicket: preparation?.inputKey === preparationKey && preparation?.revision === draft?.sourceHash ? preparation?.ticket : undefined });
  const bound = launch.saved?.session;
  const settings: CoinSetup = useMemo(() => bound ? { ...editingSettings, name: bound.settings.name, symbol: bound.settings.symbol,
    chainId: bound.chainId, initialBuy: bound.settings.initialBuy,
    pairToken: bound.settings.quote.toLowerCase() === setupQuoteAddress({ ...editingSettings, chainId: bound.chainId, pairToken: "ETH" }).toLowerCase() ? "ETH" : bound.settings.quote } : editingSettings, [bound, editingSettings]);
  const imageURL = bound?.settings.imageURI ?? imageReceipt?.url ?? image?.url;
  useEffect(() => { onLaunchLocked(launch.locked); }, [launch.locked, onLaunchLocked]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [customPair, setCustomPair] = useState(false);
  const [pairInput, setPairInput] = useState("");
  const [pairError, setPairError] = useState("");
  const [buyTouched, setBuyTouched] = useState(false);
  const isEth = settings.pairToken === "ETH";
  const hasCustomPair = customPair || !isEth;
  const lastSettings = useRef(settings);
  const lastChatRevision = useRef(chatRevision);

  useEffect(() => {
    let cancelled = false;
    void readDraftCache<Blob>(`${cacheKey}:image`).then(blob => {
      if (!cancelled && imageRequest.current === 0 && blob instanceof Blob) setImage({ blob, url: URL.createObjectURL(blob) });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [cacheKey]);

  useEffect(() => () => { imageRequest.current++; }, []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => {
    if (settings.chainId !== lastSettings.current.chainId || settings.pairToken !== lastSettings.current.pairToken
      || chatRevision !== lastChatRevision.current) {
      setCustomPair(!isEth); setPairInput(isEth ? "" : settings.pairToken); setPairError(""); setBuyTouched(false);
    }
    lastSettings.current = settings;
    lastChatRevision.current = chatRevision;
  }, [settings, isEth, chatRevision]);

  async function chooseImage(file?: File) {
    if (!file) return;
    const request = ++imageRequest.current;
    onImageReceipt(undefined);
    setImageBusy(true); setImageError("");
    try {
      const blob = await prepareTokenImage(file);
      if (request !== imageRequest.current) return;
      setImage({ blob, url: URL.createObjectURL(blob) });
      void writeDraftCache(`${cacheKey}:image`, blob).catch(() => setImageError("Keep this tab open; the image could not be saved on this device"));
      if (!localPreview && !cacheKey.endsWith(":signed-out")) {
        const response = await fetch("/api/custom-ai/image", { method: "POST", headers: { ...await headers(), "Content-Type": "image/webp" }, body: blob });
        const receipt = await response.json();
        if (!response.ok) throw Error(receipt.error || "The image could not be uploaded");
        if (request === imageRequest.current) onImageReceipt(receipt);
      }
    } catch (error) {
      if (request === imageRequest.current) setImageError(error instanceof Error ? error.message : "Choose another image");
    } finally { if (request === imageRequest.current) setImageBusy(false); }
  }

  function applyPair() {
    const address = pairInput.trim();
    if (!isAddress(address) || BigInt(address) < 3n) { setPairError("Enter a valid token address"); return; }
    setPairError(""); onChange({ pairToken: address });
  }

  let buyError = "";
  if (buyTouched) {
    if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(settings.initialBuy) || !/[1-9]/.test(settings.initialBuy)) buyError = "Enter an initial buy";
    else if (isEth) {
      if ((settings.initialBuy.split(".")[1]?.length ?? 0) > 18) buyError = "Use up to 18 decimal places";
      else if (parseEther(settings.initialBuy) < 10n ** 16n) buyError = "Minimum 0.01 ETH";
    }
  }
  const readiness = designReadiness({ sourceHash: draft?.sourceHash, checked: Boolean(reviewedSourceHash), pendingChange,
    name: settings.name, symbol: settings.symbol, image: Boolean(imageURL), connected: Boolean(account) });
  useEffect(() => {
    if (localPreview || !account || !draftId || !reviewedSourceHash || !imageReceipt || disabled || launch.locked || !editingSettings.name.trim() || !editingSettings.symbol.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreparation({ state: "working", message: "Preparing your launch…", revision: reviewedSourceHash, inputKey: preparationKey, expiresAt: 0 });
      void aiRequest<LaunchPreparation>("/readiness", () => headersRef.current(), { draftId, account, imageId: imageReceipt.id,
        settings: { name: editingSettings.name, symbol: editingSettings.symbol, chainId: editingSettings.chainId,
          quote: setupQuoteAddress(editingSettings), initialBuy: editingSettings.initialBuy, imageURI: imageReceipt.url } }, controller.signal)
        .then(result => setPreparation({ ...result, inputKey: preparationKey })).catch(error => { if (!controller.signal.aborted) setPreparation({ state: "blocked", message: error instanceof Error ? error.message : "The launch preparation could not finish.", revision: reviewedSourceHash, inputKey: preparationKey, expiresAt: 0 }); });
    }, 750);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [localPreview, account, draftId, reviewedSourceHash, imageReceipt, disabled, launch.locked, editingSettings, preparationKey]);
  useEffect(() => {
    if (preparation?.state !== "ready") return;
    const timer = setTimeout(() => setPreparation(current => current === preparation ? undefined : current), Math.max(0, preparation.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preparation]);
  const currentPreparation = preparation?.inputKey === preparationKey && preparation?.revision === reviewedSourceHash ? preparation : undefined;
  const summary = draft?.validation?.status === "passed" ? draft.hookSummary : undefined;

  return <aside className={styles.coinPanel} aria-label="Coin preview and details">
    <section className={styles.coinPreview} aria-label="Coin preview">
      <div className={styles.artworkWrap}>
        <button type="button" className={styles.artwork} disabled={imageBusy || launch.locked || launch.busy}
          aria-label={imageURL ? "Change coin image" : "Choose coin image"} aria-busy={imageBusy}
          aria-describedby={imageError ? "custom-ai-image-error" : undefined} onClick={() => fileInput.current?.click()}>
          {imageURL ? <Image src={imageURL} alt={`${settings.name || "Your coin"} preview`} fill sizes="240px" unoptimized
            onError={() => setImageError("The image could not load. Choose another image")} />
            : <><ImagePlus size={28} strokeWidth={1.5} aria-hidden="true" /><span>Choose image</span></>}
          {imageBusy && <span className={styles.imageLoading}><LoaderCircle size={22} aria-hidden="true" /><span className={styles.srOnly}>Preparing image</span></span>}
        </button>
        {(image || imageReceipt) && <button type="button" className={styles.removeImage} disabled={imageBusy || launch.locked || launch.busy} aria-label="Remove coin image"
          onClick={() => { imageRequest.current++; setImage(undefined); onImageReceipt(undefined); setImageError(""); void writeDraftCache(`${cacheKey}:image`, null).catch(() => undefined); }}><X size={14} aria-hidden="true" /></button>}
        <input ref={fileInput} className={styles.srOnly} type="file" tabIndex={-1} aria-label="Coin image file"
          accept={TOKEN_IMAGE_ACCEPT} disabled={imageBusy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseImage(file); }} />
      </div>
      <p id="custom-ai-image-error" className={styles.error} role="alert">{imageError}</p>
      <div className={styles.coinIdentity}><h2>{settings.name.trim() || "Your coin"}</h2><span>${settings.symbol.trim() || "COIN"}</span></div>
      {(bound?.description || summary) && <p className={styles.coinBio}>{bound?.description ?? coinBio(settings.name, summary!)}</p>}
    </section>

    <form className={styles.coinForm} onSubmit={event => event.preventDefault()}>
      <fieldset disabled={disabled || launch.locked || launch.busy}>
        <legend className={styles.srOnly}>Coin details</legend>
        <div className={styles.fieldPair}>
          <label htmlFor="custom-ai-name">Name<input id="custom-ai-name" value={settings.name} placeholder="Coin name" maxLength={48} autoComplete="off"
            onChange={event => onChange({ name: event.target.value })} /></label>
          <label htmlFor="custom-ai-symbol">Ticker<div className={styles.tickerInput}><span aria-hidden="true">$</span><input id="custom-ai-symbol" value={settings.symbol} placeholder="COIN" maxLength={12} autoComplete="off" spellCheck={false}
            onChange={event => onChange({ symbol: event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase() })} /></div></label>
        </div>
        <div className={`${styles.fieldPair} ${styles.networkPair}`}>
          <div>
            <span className={styles.fieldLabel} id="custom-ai-chain-label">Chain</span>
            <div className={styles.chainOptions} role="group" aria-labelledby="custom-ai-chain-label">
              {([{ id: 1, name: "Ethereum" }, { id: 4663, name: "Robinhood" }] as const).map(chain =>
                <button key={chain.id} type="button" disabled={disabled} title={chain.name} aria-label={chain.name}
                  aria-pressed={settings.chainId === chain.id} onClick={() => onChange({ chainId: chain.id })}>
                  <span aria-hidden="true"><ChainMark chainId={chain.id} className={styles.chainLogo} /></span>
                </button>)}
            </div>
          </div>
          <CoinSelect label="Pair" value={hasCustomPair ? "custom" : "ETH"} disabled={disabled}
            options={[{ value: "ETH", label: "ETH" }, { value: "custom", label: "Token address" }]}
            onChange={value => { setCustomPair(value === "custom"); setPairError("");
              if (value === "ETH") onChange({ pairToken: "ETH" });
              else requestAnimationFrame(() => document.getElementById("custom-ai-pair")?.focus()); }} />
        </div>
        {hasCustomPair && <label htmlFor="custom-ai-pair">Token address
          <input id="custom-ai-pair" value={pairInput} placeholder="0x…" autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-invalid={Boolean(pairError) || undefined} aria-describedby={pairError ? "custom-ai-pair-error" : undefined}
            onChange={event => { setPairInput(event.target.value); setPairError(""); }} onBlur={applyPair}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyPair(); } }} />
        </label>}
        <p id="custom-ai-pair-error" className={styles.error} role="alert">{pairError}</p>
        <label htmlFor="custom-ai-buy">Initial buy
          <div className={styles.amountInput}><input id="custom-ai-buy" value={settings.initialBuy} inputMode="decimal" autoComplete="off"
            placeholder={isEth ? "0.01" : "Amount"} aria-invalid={Boolean(buyError) || undefined} aria-describedby="custom-ai-buy-help"
            onChange={event => onChange({ initialBuy: event.target.value })} onBlur={() => setBuyTouched(true)} />
            <span aria-hidden="true">{isEth ? "ETH" : "Tokens"}</span></div>
        </label>
        <p className={buyError ? styles.error : styles.note} id="custom-ai-buy-help">{buyError || (isEth ? "Minimum 0.01 ETH" : "Minimum 0.01 ETH equivalent")}</p>
      </fieldset>
      {!bound && <RuleReview draft={draft} pendingChange={pendingChange} reviewed={Boolean(reviewedSourceHash)} disabled={disabled}
        quoteLabel={isEth ? "ETH" : "pair tokens"}
        onReview={() => undefined} onKeepRules={onKeepRules} />}
      {!bound && <p className={`${styles.note} ${styles.preparationStatus}`} role="status">{currentPreparation?.message ?? readiness.message}</p>}
      {bound?.quoteNotice && <p className={styles.note}>{bound.quoteNotice}</p>}
      <button type="button" className={styles.createButton} disabled={localPreview || disabled || imageBusy || launch.busy}
        onClick={() => { if (bound?.state === "confirmed") { if (launch.startAnother()) onStartAnother(); } else void launch.proceed(); }}>
        {bound?.state === "confirmed" ? "Create another coin" : launch.label}<ArrowRight size={16} aria-hidden="true" /></button>
      {launch.message && <p className={styles.note} role="status">{launch.message}</p>}
      {bound?.state === "confirmed" && bound.token && <a href={`/token/${bound.token}?chain=${bound.chainId}`} className={styles.note}>View {bound.settings.name}</a>}
      {launch.error && <p className={styles.error} role="alert">{launch.error}</p>}
    </form>
  </aside>;
}
