"use client";
import Image from "next/image";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ChevronDown, ImagePlus, LoaderCircle, X } from "lucide-react";
import { isAddress, parseEther } from "viem";
import { prepareTokenImage, TOKEN_IMAGE_ACCEPT } from "@/lib/token-image";
import { ChainMark } from "@/components/chain-mark";
import { coinBio, type CoinSetup, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import type { ImageReceipt } from "@/lib/custom-ai/studio";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { CoinSelect } from "./coin-select";
import styles from "./workspace.module.css";

export type CoinEditorImage = { blob: Blob; url: string };
export type CoinDetailsControls = { focus: (field: "name" | "symbol" | "image") => void };
export function CoinDetails({settings,onChange,chatRevision,disabled,headers,localPreview,cacheKey,imageReceipt,onImageReceipt,onImage,onImageBusy,controlsRef,stage,summary,description,imageURI,feeCore=true}:{
  settings:CoinSetup;onChange:(patch:CoinSetupPatch)=>void;chatRevision:number;disabled:boolean;
  headers:AISessionHeaders;localPreview:boolean;cacheKey:string;imageReceipt?:ImageReceipt;
  onImageReceipt:(receipt:ImageReceipt|undefined)=>void;onImage:(image:CoinEditorImage|undefined)=>void;onImageBusy?:(busy:boolean)=>void;
  controlsRef?:Ref<CoinDetailsControls>;stage:string;summary?:string;description?:string;imageURI?:string;feeCore?:boolean;
}) {
  const [detailsOpen,setDetailsOpen]=useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageRequest = useRef(0);
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  const [imageBusy, setImageBusy] = useState(false);
  useEffect(()=>{onImageBusy?.(imageBusy);},[imageBusy,onImageBusy]);
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
      else if (feeCore && parseEther(settings.initialBuy) < 10n ** 16n) buyError = "Minimum 0.01 ETH";
    }
  }
  const imageURL=imageURI??imageReceipt?.url??image?.url;
  useEffect(()=>{onImage(image);},[image,onImage]);
  useImperativeHandle(controlsRef,()=>({focus(field){if(field==="image"){fileInput.current?.click();return;}setDetailsOpen(true);requestAnimationFrame(()=>document.getElementById(`custom-ai-${field}`)?.focus());}}),[]);
  return <>
    <section className={styles.coinPreview} aria-label="Coin preview">
      <div className={styles.coinHeading}>
      <div className={styles.artworkWrap}>
        <button type="button" className={styles.artwork} disabled={disabled || imageBusy}
          aria-label={imageURL ? "Change coin image" : "Choose coin image"} aria-busy={imageBusy}
          aria-describedby={imageError ? "custom-ai-image-error" : undefined} onClick={() => fileInput.current?.click()}>
          {imageURL ? <Image src={imageURL} alt={`${settings.name || "Your coin"} preview`} fill sizes="72px" unoptimized
            onError={() => setImageError("The image could not load. Choose another image")} />
            : <><ImagePlus size={24} strokeWidth={1.5} aria-hidden="true" /><span className={styles.srOnly}>Choose image</span></>}
          {imageBusy && <span className={styles.imageLoading}><LoaderCircle size={22} aria-hidden="true" /><span className={styles.srOnly}>Preparing image</span></span>}
        </button>
        {(image || imageReceipt) && <button type="button" className={styles.removeImage} disabled={disabled || imageBusy} aria-label="Remove coin image"
          onClick={() => { imageRequest.current++; setImage(undefined); onImageReceipt(undefined); setImageError(""); void writeDraftCache(`${cacheKey}:image`, null).catch(() => undefined); }}><X size={14} aria-hidden="true" /></button>}
        <input ref={fileInput} className={styles.srOnly} type="file" tabIndex={-1} aria-label="Coin image file"
          accept={TOKEN_IMAGE_ACCEPT} disabled={disabled || imageBusy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseImage(file); }} />
      </div>
      <div className={styles.coinIdentity}><span className={styles.coinStage}>{stage}</span>
        <h2>{settings.name.trim() || "Your coin"}</h2><span>${settings.symbol.trim() || "COIN"}</span></div>
      </div>
      <p id="custom-ai-image-error" className={styles.error} role="alert">{imageError}</p>
      {(description || summary) && <details className={styles.designSummary}><summary>About this coin</summary><p className={styles.coinBio}>{description ?? coinBio(settings.name, summary!)}</p></details>}
    </section>

    <form className={styles.coinForm} onSubmit={event => event.preventDefault()}>
      <details className={styles.coinDetails} open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary><span>Coin details</span><span className={styles.settingsSummary}>{settings.chainId === 1 ? "Ethereum" : "Robinhood"} · {isEth ? "ETH" : "Custom pair"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <fieldset disabled={disabled}>
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
        <p className={buyError ? styles.error : styles.note} id="custom-ai-buy-help">{buyError || (feeCore ? isEth ? "Minimum 0.01 ETH" : "Minimum 0.01 ETH equivalent" : "The selected launch route confirms the required amount.")}</p>
      </fieldset>
      </details>
    </form>
  </>;
}
