"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { sha256, type Address, type Hex } from "viem";
import { prepareTokenImage, isProgrammableTokenImageUrl } from "@/lib/token-image";
import { validateModuleSocialLinks, type ModuleSocialKind, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { foundationDecimalError, foundationReviewError, foundationSelectionErrors, isFoundationCreatorFee, type FoundationAvailability, type FoundationConfigurationField, type FoundationImage, type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationModuleDescriptor, type FoundationModuleSelection, type FoundationQuoteAsset, type FoundationTransactionResult, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { FOUNDATION_DEFAULT_IMAGE, isFoundationDefaultImage } from "@/lib/module-foundation/default-image";
import { FoundationFeeDisclosure, ModuleFoundationTransactionResult } from "./module-foundation-review";
import styles from "./module-foundation-ui.module.css";

type EditableDraft = Omit<FoundationLaunchDraft, "image" | "quoteAsset"> & { quoteAsset: string; image: FoundationImage | null };
type LocalImage = { blob: Blob; preview: string; sha256: Hex };
type Phase = "editing" | "uploading" | "preparing" | "signing" | "result";
type Errors = Record<string, string>;

export interface ModuleFoundationBuilderProps {
  availability: FoundationAvailability;
  /** Custody of the currently verified launch factory; unknown while availability loads. */
  factoryVersion?: "v1" | "v2";
  /** Changes whenever the authenticated wallet, chain or source release changes. */
  contextKey: string;
  catalog: readonly FoundationModuleDescriptor[];
  quoteAssets: readonly FoundationQuoteAsset[];
  onResolveQuote?: (address: Address) => Promise<FoundationQuoteAsset>;
  onUploadImage: (input: { image: { kind: "local"; sha256: Hex; mimeType: "image/webp"; bytes: number }; blob: Blob }) => Promise<FoundationImage>;
  onPrepareLaunch: (draft: FoundationLaunchDraft) => Promise<FoundationLaunchReview | null>;
  onConfirmLaunch: (review: FoundationLaunchReview) => Promise<FoundationTransactionResult>;
  onRefreshResult?: (result: FoundationTransactionResult) => Promise<FoundationTransactionResult>;
  onBack?: () => void;
  onRetryAvailability?: () => void;
  walletAction?: FoundationWalletAction;
  initialDraft?: Partial<FoundationLaunchDraft>;
  /** Host-owned durable wallet operation guard, including uncertain submissions. */
  submissionBlocked?: string;
}

const SOCIAL_LABELS: Record<ModuleSocialKind, string> = { website: "Website", twitter: "X / Twitter", telegram: "Telegram", discord: "Discord", github: "GitHub", gitbook: "GitBook" };
const EMPTY_MODULES: FoundationModuleSelection[] = [];

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "This step could not complete. Please try again.";
  return message.length <= 320 ? message : "This step could not complete. Your coin details are kept. Please try again.";
}

function initialForm(initial: Partial<FoundationLaunchDraft> | undefined, quotes: readonly FoundationQuoteAsset[], chainId: number): EditableDraft {
  const quote = quotes.find(asset => asset.chainId === chainId && asset.supported);
  return { name: initial?.name ?? "", symbol: initial?.symbol ?? "", description: initial?.description ?? "", image: initial?.image ?? null,
    socialLinks: initial?.socialLinks ?? {}, quoteAsset: initial?.quoteAsset ?? quote?.address ?? "", creatorFeeBps: initial?.creatorFeeBps ?? 0,
    initialBuy: initial?.initialBuy ?? "0", additionalLiquidity: "0", modules: initial?.modules ?? EMPTY_MODULES };
}

export function ModuleFoundationBuilder({ availability, contextKey, catalog, quoteAssets, onResolveQuote, onUploadImage, onPrepareLaunch, onConfirmLaunch, onRefreshResult, onBack, onRetryAvailability, walletAction, initialDraft, submissionBlocked }: ModuleFoundationBuilderProps) {
  const [draft, setDraft] = useState<EditableDraft>(() => initialForm(initialDraft, quoteAssets, availability.chainId));
  const [localImage, setLocalImage] = useState<LocalImage | null>(null);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [imageError, setImageError] = useState("");
  const [quoteLookup, setQuoteLookup] = useState<{ address: string; status: "checking" | "resolved" | "error"; contextKey: string; asset?: FoundationQuoteAsset; message?: string } | null>(null);
  const [customQuote, setCustomQuote] = useState(Boolean(initialDraft?.quoteAsset && !quoteAssets.some(asset => asset.address.toLowerCase() === initialDraft.quoteAsset?.toLowerCase())));
  const [phase, setPhase] = useState<Phase>("editing");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [result, setResult] = useState<FoundationTransactionResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const quoteGeneration = useRef(0);
  const active = useRef(true);
  const currentContext = useRef(contextKey);
  const lock = useRef(false);
  useEffect(() => { currentContext.current = contextKey; }, [contextKey]);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current += 1; quoteGeneration.current += 1; }; }, []);
  useEffect(() => () => { if (localImage) URL.revokeObjectURL(localImage.preview); }, [localImage]);

  const busy = phase === "uploading" || phase === "preparing" || phase === "signing";
  const quoteAddress = draft.quoteAsset || (!customQuote ? quoteAssets.find(asset => asset.chainId === availability.chainId && asset.supported)?.address ?? "" : "");
  const knownQuote = quoteAssets.find(asset => asset.address.toLowerCase() === quoteAddress.toLowerCase() && asset.chainId === availability.chainId);
  const lookedUpQuote = quoteLookup?.address.toLowerCase() === draft.quoteAsset.toLowerCase() && quoteLookup.status === "resolved" && quoteLookup.contextKey === contextKey ? quoteLookup.asset : undefined;
  const quote = knownQuote ?? lookedUpQuote;
  const quoteSymbol = quote?.supportsNativeEth ? "ETH" : quote?.symbol || "quote token";
  const imageSource = localImage?.preview ?? draft.image?.url;
  const modulesError = foundationSelectionErrors(draft.modules, catalog);
  const unavailable = availability.status !== "ready";
  const locked = busy || phase === "result";

  function update<K extends keyof EditableDraft>(key: K, value: EditableDraft[K]) {
    generation.current += 1;
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setError(""); setPhase("editing");
  }

  function updateSocial(key: ModuleSocialKind, value: string) {
    update("socialLinks", { ...draft.socialLinks, [key]: value });
    setErrors(current => { const next = { ...current }; delete next[`social-${key}`]; return next; });
  }

  async function chooseImage(file: File | undefined) {
    if (!file || locked) return;
    const request = ++generation.current;
    setImagePreparing(true); setImageError("");
    try {
      const blob = await prepareTokenImage(file);
      if (blob.type !== "image/webp") throw new Error("This browser could not prepare a WebP image. Try a different browser.");
      const digest = sha256(new Uint8Array(await blob.arrayBuffer()));
      if (!active.current || generation.current !== request) return;
      const preview = URL.createObjectURL(blob);
      setLocalImage({ blob, preview, sha256: digest });
      setDraft(current => ({ ...current, image: null }));
      setErrors(current => { const next = { ...current }; delete next.image; return next; });
      setAnnouncement("Image selected. It will be saved when you create the launch.");
    } catch (caught) { if (active.current && generation.current === request) setImageError(cleanError(caught)); }
    finally { if (active.current) setImagePreparing(false); }
  }

  async function resolveQuote() {
    if (!onResolveQuote || locked) return;
    const address = draft.quoteAsset.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { setErrors(current => ({ ...current, quoteAsset: "Enter an ERC20 token address on this network." })); return; }
    const request = ++quoteGeneration.current;
    const context = currentContext.current;
    setQuoteLookup({ address, status: "checking", contextKey: context });
    try {
      const asset = await onResolveQuote(address as Address);
      if (!active.current || request !== quoteGeneration.current || currentContext.current !== context) return;
      if (asset.address.toLowerCase() !== address.toLowerCase() || asset.chainId !== availability.chainId || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) throw new Error("The quote token could not be verified. Check its address and try again.");
      setQuoteLookup({ address, status: "resolved", asset, contextKey: context });
      setAnnouncement(asset.supported ? `${asset.symbol} is supported for this launch.` : asset.reason ?? "This quote token is not supported.");
    } catch (caught) { if (active.current && request === quoteGeneration.current) setQuoteLookup({ address, status: "error", message: cleanError(caught), contextKey: context }); }
  }

  function toggleModule(descriptor: FoundationModuleDescriptor) {
    if (draft.modules.some(selection => selection.id === descriptor.id)) update("modules", draft.modules.filter(selection => selection.id !== descriptor.id));
    else update("modules", [...draft.modules, { id: descriptor.id, version: descriptor.version, digest: descriptor.digest,
      configuration: Object.fromEntries(descriptor.fields.map(field => [field.key, field.defaultValue ?? (field.kind === "boolean" ? false : "")])) }]);
  }

  function validate(): { errors: Errors; links: ModuleSocialLinks } {
    const next: Errors = {};
    if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 48) next.name = "Enter a coin name of up to 48 bytes.";
    if (!/^[A-Za-z0-9]{1,12}$/.test(draft.symbol.trim())) next.symbol = "Use 1 to 12 letters or numbers.";
    if (new TextEncoder().encode(draft.description.trim()).length > 280) next.description = "Use a description of up to 280 bytes.";
    if (draft.image && !isFoundationDefaultImage(draft.image) && !isProgrammableTokenImageUrl(draft.image.url)) next.image = "Choose an image to save with this launch.";
    if (!quote?.supported || quote.chainId !== availability.chainId) next.quoteAsset = quote?.reason ?? "Choose and verify a supported quote token.";
    if (!isFoundationCreatorFee(draft.creatorFeeBps)) next.creatorFeeBps = "Choose 0% or a creator fee from 1% to 10%.";
    if (quote) {
      const buyError = foundationDecimalError(draft.initialBuy, 18);
      if (buyError) next.initialBuy = buyError;
    }
    if (modulesError.length) next.modules = modulesError.join(" ");
    const socials = validateModuleSocialLinks(draft.socialLinks);
    if (!socials.ok) for (const issue of socials.issues) next[`social-${issue.path.split("/").at(-1)}`] = issue.message;
    return { errors: next, links: socials.ok ? socials.links : {} };
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (lock.current || imagePreparing || locked || unavailable || submissionBlocked) return;
    if (walletAction) { try { await walletAction.onClick(); } catch (caught) { setError(cleanError(caught)); } return; }
    const checked = validate();
    setErrors(checked.errors); setError("");
    if (Object.keys(checked.errors).length) {
      setAnnouncement("Check the highlighted fields before creating your coin.");
      requestAnimationFrame(() => {
        const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
        let disclosure = invalid?.closest("details");
        while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest("details") ?? null; }
        invalid?.focus();
      });
      return;
    }
    setAnnouncement("");
    const request = ++generation.current;
    const context = currentContext.current;
    const assertCurrent = () => {
      if (!active.current || generation.current !== request || currentContext.current !== context) throw new Error("Your wallet or launch version changed. Create the launch again; your coin details are kept.");
    };
    lock.current = true;
    try {
      let savedImage = draft.image;
      if (!savedImage && localImage) {
        setPhase("uploading");
        savedImage = await onUploadImage({ image: { kind: "local", sha256: localImage.sha256, mimeType: "image/webp", bytes: localImage.blob.size }, blob: localImage.blob });
        assertCurrent();
        if (!isProgrammableTokenImageUrl(savedImage.url) || savedImage.sha256.toLowerCase() !== localImage.sha256.toLowerCase()) throw new Error("The saved image does not match your selected image. Choose the image again.");
        setDraft(current => ({ ...current, image: savedImage }));
        setAnnouncement("Image saved. Preparing the launch simulation.");
      }
      savedImage ??= FOUNDATION_DEFAULT_IMAGE;
      assertCurrent(); setPhase("preparing");
      const prepared = await onPrepareLaunch({ ...draft, name: draft.name.trim(), symbol: draft.symbol.trim().toUpperCase(), description: draft.description.trim(), quoteAsset: quote!.address,
        socialLinks: checked.links, image: savedImage, additionalLiquidity: "0" });
      assertCurrent();
      if (!prepared) { setPhase("editing"); return; }
      const invalid = foundationReviewError(prepared, context);
      if (invalid) throw new Error(invalid);
      if (prepared.quote.address.toLowerCase() !== quote!.address.toLowerCase() || prepared.chainId !== availability.chainId || prepared.creatorFeeBps !== draft.creatorFeeBps || prepared.transactions.length === 0) throw new Error("Your coin settings changed. Create the launch again.");
      assertCurrent();
      setPhase("signing");
      const receipt = await onConfirmLaunch(prepared);
      if (active.current) { setResult(receipt); setPhase("result"); }
    } catch (caught) { if (active.current) { setError(cleanError(caught)); setPhase("editing"); } }
    finally { lock.current = false; }
  }

  async function refreshResult() {
    if (!result || !onRefreshResult || refreshing) return;
    setRefreshing(true);
    try { const next = await onRefreshResult(result); if (active.current) setResult(next); }
    catch (caught) { if (active.current) setError(cleanError(caught)); }
    finally { if (active.current) setRefreshing(false); }
  }

  function edit() {
    if (busy) return;
    setPhase("editing"); setError(""); generation.current += 1;
    requestAnimationFrame(() => document.getElementById("foundation-name")?.focus());
  }

  const actionLabel = walletAction?.label ?? (phase === "uploading" ? "Saving image…" : phase === "preparing" ? "Preparing launch…" : phase === "signing" ? "Confirm in your wallet…" : "Create Launch");
  return <div className={styles.page}>
    <div className={styles.topline}>{onBack ? <button type="button" className={styles.backButton} disabled={busy} onClick={onBack}><ArrowLeftIcon size={16} aria-hidden="true" /> All launch modes</button> : <span className={styles.eyebrow}>Module Mode</span>}<span className={styles.network}>{availability.chainName}</span></div>
    <header className={styles.pageHeading}><h1>Create a coin</h1><p>A coin of your own. Built on Uniswap v4.</p></header>
    {unavailable ? <div className={styles.availability} role="status"><strong>{availability.status === "checking" ? "Checking launch availability" : "Launch is temporarily unavailable"}</strong><p>{availability.reason ?? (availability.status === "checking" ? "You can fill in your coin details while availability is checked." : "You can prepare your coin details. Wallet transactions open when this launch version is available.")}</p>{availability.status === "unavailable" && onRetryAvailability ? <button type="button" className={styles.secondaryButton} onClick={onRetryAvailability}>Recheck availability</button> : null}</div> : null}
    {submissionBlocked ? <div className={styles.availability} role="status"><strong>A wallet operation needs checking</strong><p>{submissionBlocked}</p></div> : null}
    <div className={styles.layout}>
      <div className={styles.mainColumn}>
        {result && phase === "result" ? <><ModuleFoundationTransactionResult result={result} onRefresh={onRefreshResult ? () => void refreshResult() : undefined} refreshing={refreshing} />{result.status === "reverted" || (result.status === "confirmed" && !result.tokenUrl && result.operationComplete === false && result.verificationStatus !== "pending") ? <button type="button" className={styles.secondaryButton} onClick={() => { setResult(null); edit(); }}>Return to coin details</button> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}</> : <form ref={form} className={styles.form} noValidate onSubmit={event => void prepare(event)}>
          <fieldset className={styles.fieldset} disabled={locked || imagePreparing}>
            <section className={styles.formSection} aria-labelledby="foundation-coin-heading">
              <div className={styles.sectionHeading}><h2 id="foundation-coin-heading">Your coin</h2><p>Give it a name, a face and a story.</p></div>
              <div className={styles.imageRow}>
                <button type="button" className={styles.imageButton} onClick={() => imageInput.current?.click()} aria-label={imageSource ? "Change coin image" : "Choose coin image"} data-invalid={Boolean(errors.image || imageError) || undefined} aria-describedby="foundation-image-help foundation-image-error" disabled={locked || imagePreparing}>
                  {imageSource ? <Image src={imageSource} alt="Selected coin artwork" width={96} height={96} unoptimized onError={() => setImageError("The image could not load. Choose another image.")} /> : <ImageIcon size={28} aria-hidden="true" />}
                </button>
                <div className={styles.imageCopy}><button type="button" className={styles.secondaryButton} onClick={() => imageInput.current?.click()} disabled={locked || imagePreparing}>{imagePreparing ? "Preparing image…" : imageSource ? "Change image" : "Choose image"}</button><p id="foundation-image-help" className={styles.help}>Optional · Default artwork if left empty<br />JPG, PNG or WebP · Up to 8 MB<br />Square crop · At least 256 × 256 pixels</p>{draft.image ? <p className={styles.saved}><CheckIcon size={14} aria-hidden="true" /> Image saved</p> : localImage ? <p className={styles.help}>Selected · saved when you create the coin</p> : null}</div>
                {imageSource ? <button type="button" className={styles.iconButton} aria-label="Remove coin image" disabled={locked || imagePreparing} onClick={() => { setLocalImage(null); update("image", null); setImageError(""); }}><XIcon size={18} aria-hidden="true" /></button> : null}
                <input ref={imageInput} className={styles.srOnly} type="file" tabIndex={-1} aria-label="Coin image file" accept="image/jpeg,image/png,image/webp" disabled={locked || imagePreparing} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseImage(file); }} />
              </div>
              <p className={styles.error} id="foundation-image-error">{errors.image || imageError || ""}</p>
              <div className={styles.nameFields}><Field label="Name" id="foundation-name" error={errors.name}><input id="foundation-name" name="name" autoComplete="off" maxLength={48} value={draft.name} placeholder="Coin name" aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? "foundation-name-error" : undefined} onChange={event => update("name", event.target.value)} /></Field><Field label="Symbol" id="foundation-symbol" error={errors.symbol}><input id="foundation-symbol" name="symbol" autoComplete="off" spellCheck={false} maxLength={12} value={draft.symbol} placeholder="COIN" aria-invalid={Boolean(errors.symbol) || undefined} aria-describedby={errors.symbol ? "foundation-symbol-error" : undefined} onChange={event => update("symbol", event.target.value.toUpperCase())} /></Field></div>
              <Field label="Description" optional id="foundation-description" error={errors.description}><textarea id="foundation-description" name="description" maxLength={280} rows={3} value={draft.description} placeholder="What is the story behind your coin?" aria-invalid={Boolean(errors.description) || undefined} aria-describedby={errors.description ? "foundation-description-error" : undefined} onChange={event => update("description", event.target.value)} /></Field>
              <div className={styles.twoFields}>{(["website", "twitter"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div>
              <details className={styles.socialDetails}><summary>Add more social links <span>Optional</span></summary><div className={styles.twoFields}>{(["telegram", "discord", "github", "gitbook"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div></details>
              {errors["social-socialLinks"] ? <p className={styles.error}>{errors["social-socialLinks"]}</p> : null}
            </section>
            <section className={styles.formSection} aria-labelledby="foundation-market-heading">
              <div className={styles.sectionHeading}><h2 id="foundation-market-heading">Your market</h2><p>Choose what people use to buy and sell your coin.</p></div>
              <Field label="Quote token" id="foundation-quote" error={errors.quoteAsset}>
                {!customQuote && quoteAssets.length ? <select id="foundation-quote" value={quoteAddress} aria-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={errors.quoteAsset ? "foundation-quote-error" : "foundation-quote-help"} onChange={event => { if (event.target.value === "custom") { setCustomQuote(true); update("quoteAsset", ""); } else { update("quoteAsset", event.target.value); } }}><option value="" disabled>Choose a quote token</option>{quoteAssets.filter(asset => asset.chainId === availability.chainId).map(asset => <option key={asset.address} value={asset.address} disabled={!asset.supported}>{asset.supportsNativeEth ? "ETH · Ethereum" : `${asset.symbol} · ${asset.name}`}{asset.supported ? "" : " · Unavailable"}</option>)}{onResolveQuote ? <option value="custom">Use another ERC20 token</option> : null}</select> : <div className={styles.quoteInput}><input id="foundation-quote" name="quoteAsset" autoComplete="off" spellCheck={false} placeholder="0x…" value={draft.quoteAsset} aria-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={errors.quoteAsset ? "foundation-quote-error" : "foundation-quote-help"} onChange={event => { quoteGeneration.current += 1; update("quoteAsset", event.target.value); }} />{onResolveQuote ? <button type="button" className={styles.secondaryButton} onClick={() => void resolveQuote()} disabled={locked || (quoteLookup?.status === "checking" && quoteLookup.contextKey === contextKey)}>{quoteLookup?.status === "checking" && quoteLookup.contextKey === contextKey ? "Checking…" : "Check token"}</button> : null}</div>}
                <p id="foundation-quote-help" className={styles.help}>{quote?.supportsNativeEth ? "The pool trades against ETH. Pay for the launch and optional initial buy with ETH." : quote?.supported ? `Trading pair: ${quote.symbol}. An optional initial buy is paid with ETH.` : quote?.reason ?? "Choose a supported ERC20 on this network. All amounts and swap fees use this token."}</p>
                {quoteLookup?.address === draft.quoteAsset && quoteLookup.contextKey === contextKey && quoteLookup.status === "error" ? <p className={styles.error}>{quoteLookup.message}</p> : null}
                {customQuote && quoteAssets.length ? <button type="button" className={styles.textButton} onClick={() => { setCustomQuote(false); update("quoteAsset", ""); }}>Choose from available tokens</button> : null}
              </Field>
              <div className={styles.twoFields}><Field label="Creator fee" id="foundation-creator-fee" error={errors.creatorFeeBps}><select id="foundation-creator-fee" value={draft.creatorFeeBps} onChange={event => update("creatorFeeBps", Number(event.target.value))}><option value={0}>0% · No creator fee</option>{Array.from({ length: 10 }, (_, index) => index + 1).map(percent => <option key={percent} value={percent * 100}>{percent}%</option>)}</select><p className={styles.help}>Your fee on each buy and sell.</p></Field><div className={styles.fixedFee}><span>Platform fee</span><strong>0.3% <small>Always added</small></strong><p className={styles.help}>Separate from your creator fee.</p></div></div>
              <Field label="Initial buy" id="foundation-initial-buy" optional error={errors.initialBuy} hint="Maximum ETH for your first purchase. Launch and buy share one wallet confirmation; unspent ETH is returned. Enter 0 to launch without buying."><div className={styles.amountInput}><input id="foundation-initial-buy" name="initialBuy" inputMode="decimal" autoComplete="off" value={draft.initialBuy} aria-invalid={Boolean(errors.initialBuy) || undefined} aria-describedby={`foundation-initial-buy-help${errors.initialBuy ? " foundation-initial-buy-error" : ""}`} onChange={event => update("initialBuy", event.target.value)} /><span>ETH</span></div></Field>
              <p className={styles.help}>The base pool starts with your coin supply. You do not need to fund its quote liquidity. Buying brings quote tokens into the pool; the base position principal is permanently locked.</p>
            </section>
            <section className={styles.formSection} aria-labelledby="foundation-modules-heading"><div className={styles.sectionHeading}><div className={styles.sectionTitle}><h2 id="foundation-modules-heading">Optional modules</h2><span className={styles.muted}>{draft.modules.length} selected</span></div><p>Your coin works with no additional modules.</p></div>
              {catalog.length ? <div className={styles.catalog}>{catalog.map(descriptor => {
                const selection = draft.modules.find(item => item.id === descriptor.id);
                return <div className={styles.module} key={`${descriptor.id}:${descriptor.version}`}><div className={styles.moduleHeading}><div><h3>{descriptor.name}</h3><p>{descriptor.description}</p></div><button className={selection ? styles.selectedButton : styles.secondaryButton} type="button" aria-pressed={Boolean(selection)} disabled={locked || (!descriptor.available && !selection)} onClick={() => toggleModule(descriptor)}>{selection ? <><CheckIcon size={16} aria-hidden="true" /> Remove</> : <><PlusIcon size={16} aria-hidden="true" /> Add</>}</button></div>{!descriptor.available ? <p className={styles.help}>{descriptor.unavailableReason ?? "This module is currently unavailable."}</p> : null}{selection ? <div className={styles.moduleFields}>{descriptor.fields.map(field => <ModuleField key={field.key} field={field} id={`foundation-module-${encodeURIComponent(descriptor.id)}-${encodeURIComponent(field.key)}`} value={selection.configuration[field.key]} showErrors={Boolean(errors.modules)} onChange={value => update("modules", draft.modules.map(item => item.id === descriptor.id ? { ...item, configuration: { ...item.configuration, [field.key]: value } } : item))} />)}<details className={styles.transactionDetails}><summary>Module capabilities and version</summary><p className={styles.help}>Version {descriptor.version}</p><ul className={styles.notes}>{descriptor.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></details></div> : null}</div>;
              })}</div> : <div className={styles.emptyModules}><CheckIcon size={20} aria-hidden="true" /><p><strong>Start with the essentials</strong><span>Coin, market and the fixed platform fee. Additional modules appear here when available.</span></p></div>}
              {errors.modules ? <p className={styles.error} role="alert">{errors.modules}</p> : null}
            </section>
          </fieldset>
          <div className={styles.formFooter}><p className={styles.error} role="alert">{error}</p><button type="submit" className={styles.primaryButton} disabled={locked || imagePreparing || unavailable || Boolean(submissionBlocked) || walletAction?.busy} aria-busy={busy || walletAction?.busy}>{actionLabel}<ArrowRightIcon size={18} aria-hidden="true" /></button><p className={styles.help}>Confirm the launch in your wallet. Your coin page opens automatically after confirmation.</p></div>
        </form>}
      </div>
      <aside className={styles.preview} aria-label="Coin preview">
        <div className={styles.previewHeading}><span>Coin preview</span><span>{phase === "result" ? "Submitted details" : "Your draft"}</span></div>
        <div className={styles.previewArtwork}>{imageSource ? <Image src={imageSource} alt={`${draft.name.trim() || "Coin"} preview`} width={320} height={240} loading="eager" unoptimized /> : <div className={styles.artworkPlaceholder}><ImageIcon size={36} weight="light" aria-hidden="true" /><span>Your coin image</span></div>}</div>
        <div className={styles.previewContent}><div className={styles.coinName}><h2>{draft.name.trim() || "Your coin"}</h2><span>{draft.symbol.trim() || "SYMBOL"}</span></div><p className={styles.previewDescription}>{draft.description.trim() || "Your coin’s story will appear here."}</p><div className={styles.previewMarket}><span>Trading pair</span><strong>{draft.symbol.trim() || "COIN"} / {quote ? quoteSymbol : "QUOTE"}</strong></div><FoundationFeeDisclosure creatorFeeBps={draft.creatorFeeBps} quoteSymbol={quoteSymbol} /><div className={styles.previewFoot}><span>Uniswap v4</span><span>{draft.modules.length ? `${draft.modules.length} optional ${draft.modules.length === 1 ? "module" : "modules"}` : "Base coin"}</span></div></div>
      </aside>
    </div>
    <p className={styles.srOnly} role="status">{announcement || (phase === "uploading" ? "Saving the exact selected image." : phase === "preparing" ? "Preparing a current launch simulation." : "")}</p>
  </div>;
}

function Field({ label, id, error, optional, hint, children }: { label: string; id: string; error?: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}{optional ? <span>Optional</span> : null}</label>{children}{hint ? <p id={`${id}-help`} className={styles.help}>{hint}</p> : null}{error ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}</div>;
}

function SocialField({ kind, value, error, onChange }: { kind: ModuleSocialKind; value: string; error?: string; onChange: (value: string) => void }) {
  const id = `foundation-social-${kind}`;
  return <Field label={SOCIAL_LABELS[kind]} id={id} error={error} optional><input id={id} name={kind} type="url" autoComplete="off" spellCheck={false} value={value} placeholder={kind === "twitter" ? "https://x.com/…" : "https://…"} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} /></Field>;
}

function ModuleField({ field, id, value, showErrors, onChange }: { field: FoundationConfigurationField; id: string; value: string | boolean | undefined; showErrors?: boolean; onChange: (value: string | boolean) => void }) {
  if (field.kind === "boolean") return <label className={styles.checkLabel}><input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /><span><strong>{field.label}</strong>{field.description ? <small>{field.description}</small> : null}</span></label>;
  const missing = Boolean(showErrors && field.required && (value === undefined || value === ""));
  return <Field label={field.label} id={id} hint={field.description} optional={!field.required} error={missing ? `Complete ${field.label}.` : undefined}>{field.kind === "select" ? <select id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} aria-describedby={[field.description ? `${id}-help` : "", missing ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} autoComplete="off" spellCheck={false} inputMode={field.kind === "decimal" ? "decimal" : field.kind === "integer" ? "numeric" : "text"} aria-describedby={[field.description ? `${id}-help` : "", missing ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)} />}</Field>;
}
