"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { sha256, type Address, type Hex } from "viem";
import { prepareTokenImage, isProgrammableTokenImageUrl } from "@/lib/token-image";
import { validateModuleSocialLinks, type ModuleSocialKind, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { foundationDecimalError, foundationReviewError, foundationSelectionErrors, isFoundationCreatorFee, type FoundationAvailability, type FoundationConfigurationField, type FoundationImage, type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationModuleDescriptor, type FoundationModuleSelection, type FoundationQuoteAsset, type FoundationTransactionResult, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { foundationCreatorFeesEqual } from "@/lib/module-foundation/creator-fees";
import { FOUNDATION_DEFAULT_IMAGE, isFoundationDefaultImage } from "@/lib/module-foundation/default-image";
import { normalizeFoundationSocialInput, normalizeFoundationSocialInputs } from "@/lib/module-foundation/social-input";
import { ModuleFoundationTransactionResult } from "./module-foundation-review";
import styles from "./module-foundation-ui.module.css";

type EditableDraft = Omit<FoundationLaunchDraft, "image" | "quoteAsset" | "creatorFeeBps" | "creatorBuyFeeBps" | "creatorSellFeeBps"> & { creatorFeeBps: number; quoteAsset: string; image: FoundationImage | null };
type LocalImage = { blob: Blob; preview: string; sha256: Hex };
type Phase = "editing" | "uploading" | "preparing" | "signing" | "result";
type Errors = Record<string, string>;

export interface ModuleFoundationBuilderProps {
  availability: FoundationAvailability;
  /** Custody of the currently verified launch factory; unknown while availability loads. */
  factoryVersion?: "v1" | "v2" | "v3";
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
  suggestedInitialBuy?: string;
  launchProgress?: string;
  /** Host-owned durable wallet operation guard, including uncertain submissions. */
  submissionBlocked?: string;
}

const SOCIAL_LABELS: Record<ModuleSocialKind, string> = { website: "Website", twitter: "X / Twitter", telegram: "Telegram", discord: "Discord", github: "GitHub", gitbook: "Docs" };
const EMPTY_MODULES: FoundationModuleSelection[] = [];

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "This step could not complete. Please try again.";
  return message.length <= 320 ? message : "This step could not complete. Your coin details are kept. Please try again.";
}

function initialForm(initial: Partial<FoundationLaunchDraft> | undefined, quotes: readonly FoundationQuoteAsset[], chainId: number): EditableDraft {
  const quote = quotes.find(asset => asset.chainId === chainId && asset.supported && asset.supportsNativeEth);
  return { name: initial?.name ?? "", symbol: initial?.symbol ?? "", description: initial?.description ?? "", image: initial?.image ?? null,
    socialLinks: initial?.socialLinks ?? {}, quoteAsset: initial?.quoteAsset ?? quote?.address ?? "", creatorFeeBps: initial?.creatorFeeBps ?? (initial?.creatorBuyFeeBps === initial?.creatorSellFeeBps ? initial?.creatorBuyFeeBps : 0) ?? 0,
    initialBuy: initial?.initialBuy ?? "", additionalLiquidity: "0", modules: initial?.modules ?? EMPTY_MODULES };
}

export function ModuleFoundationBuilder({ availability, contextKey, catalog, quoteAssets, onResolveQuote, onUploadImage, onPrepareLaunch, onConfirmLaunch, onRefreshResult, onBack, onRetryAvailability, walletAction, initialDraft, suggestedInitialBuy, launchProgress, submissionBlocked }: ModuleFoundationBuilderProps) {
  const [draft, setDraft] = useState<EditableDraft>(() => initialForm(initialDraft, quoteAssets, availability.chainId));
  const [buyEdited, setBuyEdited] = useState(initialDraft?.initialBuy !== undefined);
  const initialBuy = buyEdited ? draft.initialBuy : suggestedInitialBuy ?? "";
  const [localImage, setLocalImage] = useState<LocalImage | null>(null);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [imageError, setImageError] = useState("");
  const [quoteLookup, setQuoteLookup] = useState<{ address: string; status: "checking" | "resolved" | "error"; contextKey: string; asset?: FoundationQuoteAsset; message?: string } | null>(null);
  const [customQuote, setCustomQuote] = useState(Boolean(initialDraft?.quoteAsset && !quoteAssets.some(asset => asset.supportsNativeEth && asset.address.toLowerCase() === initialDraft.quoteAsset?.toLowerCase())));
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
  const quoteResolver = useRef(onResolveQuote);
  const pendingQuote = useRef<{ key: string; promise: Promise<FoundationQuoteAsset | undefined> } | null>(null);
  const lock = useRef(false);
  const refreshLock = useRef(false);
  const automaticRefreshes = useRef(0);
  const submittedContext = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (currentContext.current !== contextKey) { quoteGeneration.current += 1; pendingQuote.current = null; }
    currentContext.current = contextKey; quoteResolver.current = onResolveQuote;
  }, [contextKey, onResolveQuote]);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current += 1; quoteGeneration.current += 1; }; }, []);
  useEffect(() => () => { if (localImage) URL.revokeObjectURL(localImage.preview); }, [localImage]);

  const busy = phase === "uploading" || phase === "preparing" || phase === "signing";
  const nativeQuote = quoteAssets.find(asset => asset.chainId === availability.chainId && asset.supported && asset.supportsNativeEth);
  const quoteAddress = customQuote ? draft.quoteAsset.trim() : nativeQuote?.address ?? "";
  const knownQuote = quoteAssets.find(asset => asset.address.toLowerCase() === quoteAddress.toLowerCase() && asset.chainId === availability.chainId);
  const lookedUpQuote = customQuote && quoteLookup?.address.toLowerCase() === quoteAddress.toLowerCase() && quoteLookup.status === "resolved" && quoteLookup.contextKey === contextKey ? quoteLookup.asset : undefined;
  const quote = knownQuote ?? lookedUpQuote;
  const quoteSymbol = !customQuote || quote?.supportsNativeEth ? "ETH" : quote?.symbol || "TOKEN";
  const imageSource = localImage?.preview ?? draft.image?.url;
  const modulesError = foundationSelectionErrors(draft.modules, catalog);
  const unavailable = availability.status !== "ready";
  const locked = busy || phase === "result";
  const canResolveQuote = Boolean(onResolveQuote);

  function update<K extends keyof EditableDraft>(key: K, value: EditableDraft[K]) {
    if (key === "initialBuy") setBuyEdited(true);
    generation.current += 1;
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setError(""); setPhase("editing");
  }

  function updateSocial(key: ModuleSocialKind, value: string) {
    update("socialLinks", { ...draft.socialLinks, [key]: value });
    setErrors(current => { const next = { ...current }; delete next[`social-${key}`]; return next; });
  }

  function chooseMarket(custom: boolean) {
    if (custom === customQuote) return;
    quoteGeneration.current += 1;
    pendingQuote.current = null;
    setCustomQuote(custom);
    setQuoteLookup(null);
    update("quoteAsset", "");
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

  const resolveQuote = useCallback((): Promise<FoundationQuoteAsset | undefined> => {
    const resolver = quoteResolver.current;
    if (!resolver || !/^0x[0-9a-fA-F]{40}$/.test(quoteAddress)) return Promise.resolve(undefined);
    const key = `${contextKey}:${availability.chainId}:${quoteAddress.toLowerCase()}`;
    if (pendingQuote.current?.key === key) return pendingQuote.current.promise;
    const request = ++quoteGeneration.current;
    const isCurrent = () => active.current && request === quoteGeneration.current && currentContext.current === contextKey;
    setAnnouncement("");
    setQuoteLookup({ address: quoteAddress, status: "checking", contextKey });
    const promise = Promise.resolve().then(() => resolver(quoteAddress as Address)).then(asset => {
      if (!isCurrent()) return;
      if (asset.address.toLowerCase() !== quoteAddress.toLowerCase() || asset.chainId !== availability.chainId || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) throw new Error("This token could not be verified. Check its address and try again.");
      setQuoteLookup({ address: quoteAddress, status: "resolved", asset, contextKey });
      setErrors(current => { const next = { ...current }; delete next.quoteAsset; return next; });
      setAnnouncement(asset.supported ? `${asset.symbol} is supported for this launch.` : asset.reason ?? "This token is not supported.");
      return asset;
    }).catch(caught => {
      if (isCurrent()) {
        pendingQuote.current = null;
        setQuoteLookup({ address: quoteAddress, status: "error", message: cleanError(caught), contextKey });
      }
      return undefined;
    });
    pendingQuote.current = { key, promise };
    return promise;
  }, [availability.chainId, contextKey, quoteAddress]);

  useEffect(() => {
    if (!customQuote || !canResolveQuote || knownQuote || !/^0x[0-9a-fA-F]{40}$/.test(quoteAddress)) return;
    const timer = window.setTimeout(() => void resolveQuote(), 300);
    return () => window.clearTimeout(timer);
  }, [customQuote, canResolveQuote, knownQuote, quoteAddress, resolveQuote]);

  function toggleModule(descriptor: FoundationModuleDescriptor) {
    if (draft.modules.some(selection => selection.id === descriptor.id)) update("modules", draft.modules.filter(selection => selection.id !== descriptor.id));
    else update("modules", [...draft.modules, { id: descriptor.id, version: descriptor.version, digest: descriptor.digest,
      configuration: Object.fromEntries(descriptor.fields.map(field => [field.key, field.defaultValue ?? (field.kind === "boolean" ? false : "")])) }]);
  }

  function validate(selectedQuote: FoundationQuoteAsset | undefined): { errors: Errors; links: ModuleSocialLinks } {
    const next: Errors = {};
    if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 48) next.name = "Enter a coin name of up to 48 bytes.";
    if (!/^[A-Za-z0-9]{1,12}$/.test(draft.symbol.trim())) next.symbol = "Use 1 to 12 letters or numbers.";
    if (new TextEncoder().encode(draft.description.trim()).length > 280) next.description = "Use a description of up to 280 bytes.";
    if (draft.image && !isFoundationDefaultImage(draft.image) && !isProgrammableTokenImageUrl(draft.image.url)) next.image = "Choose an image to save with this launch.";
    if (!selectedQuote?.supported || selectedQuote.chainId !== availability.chainId) next.quoteAsset = selectedQuote?.reason ?? (customQuote ? /^0x[0-9a-fA-F]{40}$/.test(quoteAddress) ? "This token could not be verified. Try launching again." : "Enter a token contract address on Robinhood Chain." : "ETH is still loading. Try again in a moment.");
    if (!isFoundationCreatorFee(draft.creatorFeeBps)) next.creatorFeeBps = "Choose a whole percentage from 0% to 10%.";
    const buyError = foundationDecimalError(initialBuy, 18, false);
    if (buyError) next.initialBuy = buyError;
    if (modulesError.length) next.modules = modulesError.join(" ");
    const socials = validateModuleSocialLinks(normalizeFoundationSocialInputs(draft.socialLinks));
    if (!socials.ok) for (const issue of socials.issues) next[`social-${issue.path.split("/").at(-1)}`] = issue.message.replace(/GitBook/g, "Docs");
    return { errors: next, links: socials.ok ? socials.links : {} };
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (lock.current || imagePreparing || locked || unavailable || submissionBlocked) return;
    if (walletAction) { try { await walletAction.onClick(); } catch (caught) { setError(cleanError(caught)); } return; }
    setAnnouncement("");
    const request = ++generation.current;
    const context = currentContext.current;
    const assertCurrent = () => {
      if (!active.current || generation.current !== request || currentContext.current !== context) throw new Error("Your wallet or launch version changed. Create the launch again; your coin details are kept.");
    };
    lock.current = true;
    try {
      let selectedQuote = quote;
      if (customQuote && !selectedQuote && /^0x[0-9a-fA-F]{40}$/.test(quoteAddress)) {
        setPhase("preparing");
        selectedQuote = await resolveQuote();
        assertCurrent();
      }
      const checked = validate(selectedQuote);
      setErrors(checked.errors); setError("");
      if (Object.keys(checked.errors).length) {
        setPhase("editing");
        setAnnouncement("Check the highlighted fields before creating your coin.");
        requestAnimationFrame(() => {
          const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
          let disclosure = invalid?.closest("details");
          while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest("details") ?? null; }
          invalid?.focus();
        });
        return;
      }
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
      const prepared = await onPrepareLaunch({ ...draft, name: draft.name.trim(), symbol: draft.symbol.trim().toUpperCase(), description: draft.description.trim(), quoteAsset: selectedQuote!.address,
        socialLinks: checked.links, image: savedImage, initialBuy, additionalLiquidity: "0" });
      assertCurrent();
      if (!prepared) { setPhase("editing"); return; }
      const invalid = foundationReviewError(prepared, context);
      if (invalid) throw new Error(invalid);
      if (prepared.quote.address.toLowerCase() !== selectedQuote!.address.toLowerCase() || prepared.chainId !== availability.chainId || !foundationCreatorFeesEqual(prepared, draft) || prepared.transactions.length === 0) throw new Error("Your coin settings changed. Create the launch again.");
      assertCurrent();
      setPhase("signing");
      const receipt = await onConfirmLaunch(prepared);
      if (active.current) { automaticRefreshes.current = 0; submittedContext.current = context; setResult(receipt); setPhase("result"); }
    } catch (caught) { if (active.current) { setError(cleanError(caught)); setPhase("editing"); } }
    finally { lock.current = false; }
  }

  const refreshResult = useCallback(async () => {
    if (!result || !onRefreshResult || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try { const next = await onRefreshResult(result); if (active.current) { setResult(next); setError(""); } }
    catch (caught) { if (active.current) setError(cleanError(caught)); }
    finally { refreshLock.current = false; if (active.current) setRefreshing(false); }
  }, [result, onRefreshResult]);

  useEffect(() => {
    if (phase !== "result" || !result || !onRefreshResult || refreshing || contextKey !== submittedContext.current
      || automaticRefreshes.current >= 10 || (result.status !== "submitted" && result.status !== "unconfirmed"
        && !(result.status === "confirmed" && result.verificationStatus === "pending"))) return;
    // Read only the saved transaction; a delayed receipt must never trigger another wallet request.
    const timer = window.setTimeout(() => { automaticRefreshes.current += 1; void refreshResult(); },
      Math.min(2_000 * 2 ** automaticRefreshes.current, 15_000));
    return () => window.clearTimeout(timer);
  }, [contextKey, onRefreshResult, phase, refreshResult, refreshing, result]);

  function edit() {
    if (busy) return;
    setPhase("editing"); setError(""); generation.current += 1;
    requestAnimationFrame(() => document.getElementById("foundation-name")?.focus());
  }

  const actionLabel = walletAction?.label ?? (phase === "uploading" ? "Saving image…" : phase === "preparing" ? "Preparing launch…" : phase === "signing" ? launchProgress || "Opening coin…" : "Create Launch");
  return <div className={`${styles.page} ${styles.builderPage}`}>
    <div className={styles.topline}>{onBack ? <button type="button" className={styles.backButton} disabled={busy} onClick={onBack}><ArrowLeftIcon size={16} aria-hidden="true" /> All launch modes</button> : <span className={styles.eyebrow}>Module Mode</span>}<span className={styles.network}>{availability.chainName}</span></div>
    <header className={styles.pageHeading}><h1>Launch a Coin</h1></header>
    {availability.status === "unavailable" ? <div className={styles.launchStatus} role="status"><span>Launching is temporarily unavailable.</span>{onRetryAvailability ? <button type="button" className={styles.textButton} onClick={onRetryAvailability}>Retry</button> : null}</div> : null}
    {submissionBlocked ? <div className={styles.availability} role="status"><strong>A wallet operation needs checking</strong><p>{submissionBlocked}</p></div> : null}
    <div className={styles.layout}>
      <div className={styles.mainColumn}>
        {result && phase === "result" ? <><ModuleFoundationTransactionResult result={result} onRefresh={onRefreshResult ? () => void refreshResult() : undefined} refreshing={refreshing} />{result.status === "reverted" || (result.status === "confirmed" && !result.tokenUrl && result.operationComplete === false && result.verificationStatus !== "pending") ? <button type="button" className={styles.secondaryButton} onClick={() => { setResult(null); edit(); }}>Return to coin details</button> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}</> : <form ref={form} className={styles.form} noValidate onSubmit={event => void prepare(event)}>
          <fieldset className={styles.fieldset} disabled={locked || imagePreparing}>
            <section className={styles.formSection} aria-labelledby="foundation-coin-heading">
              <h2 id="foundation-coin-heading" className={styles.srOnly}>Coin details</h2>
              <div className={styles.imageRow}>
                <button type="button" className={styles.imageButton} onClick={() => imageInput.current?.click()} aria-label={imageSource ? "Change coin image" : "Choose coin image"} data-invalid={Boolean(errors.image || imageError) || undefined} aria-describedby={errors.image || imageError ? "foundation-image-error" : undefined} disabled={locked || imagePreparing}>
                  {imageSource ? <Image src={imageSource} alt="Selected coin artwork" width={96} height={96} unoptimized onError={() => setImageError("The image could not load. Choose another image.")} /> : <ImageIcon size={28} aria-hidden="true" />}
                </button>
                <div className={styles.imageCopy}><button type="button" className={styles.secondaryButton} onClick={() => imageInput.current?.click()} disabled={locked || imagePreparing}>{imagePreparing ? "Preparing image…" : imageSource ? "Change image" : "Add image"}</button></div>
                {imageSource ? <button type="button" className={styles.iconButton} aria-label="Remove coin image" disabled={locked || imagePreparing} onClick={() => { setLocalImage(null); update("image", null); setImageError(""); }}><XIcon size={18} aria-hidden="true" /></button> : null}
                <input ref={imageInput} className={styles.srOnly} type="file" tabIndex={-1} aria-label="Coin image file" accept="image/jpeg,image/png,image/webp" disabled={locked || imagePreparing} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseImage(file); }} />
              </div>
              <p className={styles.error} id="foundation-image-error">{errors.image || imageError || ""}</p>
              <div className={styles.nameFields}><Field label="Name" id="foundation-name" error={errors.name}><input id="foundation-name" name="name" autoComplete="off" maxLength={48} value={draft.name} placeholder="Coin name" aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? "foundation-name-error" : undefined} onChange={event => update("name", event.target.value)} /></Field><Field label="Ticker" id="foundation-symbol" error={errors.symbol}><input id="foundation-symbol" name="symbol" autoComplete="off" spellCheck={false} maxLength={12} value={draft.symbol} placeholder="COIN" aria-invalid={Boolean(errors.symbol) || undefined} aria-describedby={errors.symbol ? "foundation-symbol-error" : undefined} onChange={event => update("symbol", event.target.value.toUpperCase())} /></Field></div>
              <Field label="Description" id="foundation-description" error={errors.description}><textarea id="foundation-description" name="description" maxLength={280} rows={2} value={draft.description} placeholder="A few words about your coin" aria-invalid={Boolean(errors.description) || undefined} aria-describedby={errors.description ? "foundation-description-error" : undefined} onChange={event => update("description", event.target.value)} /></Field>
              <div className={styles.twoFields}>{(["website", "twitter"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div>
              <details className={styles.socialDetails}><summary>Add More Links <CaretDownIcon size={14} aria-hidden="true" /></summary><div className={styles.twoFields}>{(["telegram", "discord", "github", "gitbook"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div></details>
              {errors["social-socialLinks"] ? <p className={styles.error}>{errors["social-socialLinks"]}</p> : null}
            </section>
            <section className={styles.formSection} aria-labelledby="foundation-market-heading">
              <h2 id="foundation-market-heading" className={styles.marketLabel}>Pair with</h2>
              <div className={styles.pairChoices} role="group" aria-labelledby="foundation-market-heading">
                <button id={!customQuote ? "foundation-quote" : undefined} type="button" aria-pressed={!customQuote} aria-describedby={!customQuote && errors.quoteAsset ? "foundation-quote-error" : undefined} data-invalid={!customQuote && Boolean(errors.quoteAsset) || undefined} onClick={() => chooseMarket(false)}><svg className={styles.ethereumMark} width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" /><path d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z" /><path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" /></svg><span>Classic</span>{!customQuote ? <CheckIcon size={16} aria-hidden="true" /> : null}</button>
                {onResolveQuote ? <button type="button" aria-pressed={customQuote} aria-controls="foundation-custom-pair" aria-expanded={customQuote} onClick={() => chooseMarket(true)}><PlusIcon size={20} aria-hidden="true" /><span>Other <small>(Stocks or Meme Coins)</small></span>{customQuote ? <CheckIcon size={16} aria-hidden="true" /> : null}</button> : null}
              </div>
              {customQuote ? <div id="foundation-custom-pair" className={styles.customPair}><Field label="Token address" id="foundation-quote" error={errors.quoteAsset}>
                <input id="foundation-quote" name="quoteAsset" autoComplete="off" spellCheck={false} placeholder="0x…" value={draft.quoteAsset} aria-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={`foundation-quote-help${errors.quoteAsset ? " foundation-quote-error" : ""}`} onChange={event => { quoteGeneration.current += 1; pendingQuote.current = null; setQuoteLookup(null); update("quoteAsset", event.target.value); }} />
                <p id="foundation-quote-help" className={quote?.supported ? styles.saved : styles.help} role="status">{quote?.supported ? <><CheckIcon size={14} aria-hidden="true" />{quote.name} · {quoteSymbol}</> : errors.quoteAsset ? null : quoteLookup?.contextKey === contextKey && quoteLookup.status === "checking" ? "Checking token…" : quote?.reason ?? "Paste a token contract address on Robinhood Chain."}</p>
                {quoteLookup?.address.toLowerCase() === quoteAddress.toLowerCase() && quoteLookup.contextKey === contextKey && quoteLookup.status === "error" ? <p className={styles.error} role="alert">{quoteLookup.message}</p> : null}
              </Field></div> : errors.quoteAsset ? <p id="foundation-quote-error" className={styles.error}>{errors.quoteAsset}</p> : null}
              <div className={styles.creatorFees} role="group" aria-labelledby="foundation-creator-fees-heading">
                <h3 id="foundation-creator-fees-heading" className={styles.marketLabel}>Creator fees <span className={styles.muted}>(Platform Fee 0.3%)</span></h3>
                <CreatorFeeField value={draft.creatorFeeBps} error={errors.creatorFeeBps} onChange={value => update("creatorFeeBps", value)} />
              </div>
              <Field label="First buy" id="foundation-initial-buy" error={errors.initialBuy}><div className={styles.amountInput}><input id="foundation-initial-buy" name="initialBuy" inputMode="decimal" autoComplete="off" required value={initialBuy} placeholder="ETH amount" aria-invalid={Boolean(errors.initialBuy) || undefined} aria-describedby={errors.initialBuy ? "foundation-initial-buy-error" : undefined} onChange={event => update("initialBuy", event.target.value)} /><span>ETH</span></div></Field>
            </section>
            {catalog.length || draft.modules.length ? <section className={styles.formSection} aria-labelledby="foundation-modules-heading"><div className={styles.sectionHeading}><div className={styles.sectionTitle}><h2 id="foundation-modules-heading">Modules</h2>{draft.modules.length ? <span className={styles.muted}>{draft.modules.length} selected</span> : null}</div></div>
              {catalog.length ? <div className={styles.catalog}>{catalog.map(descriptor => {
                const selection = draft.modules.find(item => item.id === descriptor.id);
                return <div className={styles.module} key={`${descriptor.id}:${descriptor.version}`}><div className={styles.moduleHeading}><div><h3>{descriptor.name}</h3><p>{descriptor.description}</p></div><button className={selection ? styles.selectedButton : styles.secondaryButton} type="button" aria-pressed={Boolean(selection)} disabled={locked || (!descriptor.available && !selection)} onClick={() => toggleModule(descriptor)}>{selection ? <><CheckIcon size={16} aria-hidden="true" /> Remove</> : <><PlusIcon size={16} aria-hidden="true" /> Add</>}</button></div>{!descriptor.available ? <p className={styles.help}>{descriptor.unavailableReason ?? "This module is currently unavailable."}</p> : null}{selection ? <div className={styles.moduleFields}>{descriptor.fields.map(field => <ModuleField key={field.key} field={field} id={`foundation-module-${encodeURIComponent(descriptor.id)}-${encodeURIComponent(field.key)}`} value={selection.configuration[field.key]} showErrors={Boolean(errors.modules)} onChange={value => update("modules", draft.modules.map(item => item.id === descriptor.id ? { ...item, configuration: { ...item.configuration, [field.key]: value } } : item))} />)}<details className={styles.transactionDetails}><summary>Module capabilities and version</summary><p className={styles.help}>Version {descriptor.version}</p><ul className={styles.notes}>{descriptor.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></details></div> : null}</div>;
              })}</div> : null}
              {errors.modules ? <p className={styles.error} role="alert">{errors.modules}</p> : null}
            </section> : null}
          </fieldset>
          <div className={styles.formFooter}><p className={styles.error} role="alert">{error}</p><button type="submit" className={styles.primaryButton} disabled={locked || imagePreparing || unavailable || Boolean(submissionBlocked) || walletAction?.busy} aria-busy={busy || walletAction?.busy}>{actionLabel}<ArrowRightIcon size={18} aria-hidden="true" /></button></div>
        </form>}
      </div>
      <aside className={styles.preview} aria-label="Coin preview">
        <div className={styles.previewHeading}><span>Preview</span></div>
        <div className={styles.previewArtwork}><Image src={imageSource ?? FOUNDATION_DEFAULT_IMAGE.url} alt={`${draft.name.trim() || "Coin"} preview`} width={320} height={320} loading="eager" unoptimized /></div>
        <div className={styles.previewContent}><div className={styles.coinName}><h2>{draft.name.trim() || "Your coin"}</h2><span>${draft.symbol.trim() || "COIN"}</span></div>{draft.description.trim() ? <p className={styles.previewDescription}>{draft.description.trim()}</p> : null}<div className={styles.previewMarket}><span>Pair</span><strong>{draft.symbol.trim() || "COIN"} / {quoteSymbol}</strong></div><div className={styles.previewFoot}><span>{availability.chainName}</span><span>Uniswap v4</span></div></div>
      </aside>
    </div>
    <p className={styles.srOnly} role="status">{announcement || (phase === "uploading" ? "Saving the exact selected image." : phase === "preparing" ? "Preparing a current launch simulation." : "")}</p>
  </div>;
}

function Field({ label, id, error, hint, children }: { label: React.ReactNode; id: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}{hint ? <p id={`${id}-help`} className={styles.help}>{hint}</p> : null}{error ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}</div>;
}

function CreatorFeeField({ value, error, onChange }: { value: number; error?: string; onChange: (value: number) => void }) {
  const id = "foundation-creator-fee";
  return <Field label="Buy & Sell" id={id} error={error}><div className={styles.feeControls}>
    <button type="button" aria-label="Decrease creator fee" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 100))}><MinusIcon size={16} aria-hidden="true" /></button>
    <div><input id={id} name="creatorFeeBps" type="number" min={0} max={10} step={1} value={value / 100} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(Number(event.target.value) * 100)} /><span>%</span></div>
    <button type="button" aria-label="Increase creator fee" disabled={value >= 1000} onClick={() => onChange(Math.min(1000, value + 100))}><PlusIcon size={16} aria-hidden="true" /></button>
  </div></Field>;
}

function SocialField({ kind, value, error, onChange }: { kind: ModuleSocialKind; value: string; error?: string; onChange: (value: string) => void }) {
  const id = `foundation-social-${kind}`;
  return <Field label={SOCIAL_LABELS[kind]} id={id} error={error}><input id={id} name={kind} type={kind === "twitter" ? "text" : "url"} autoComplete="off" autoCapitalize="none" spellCheck={false} value={value} placeholder={kind === "twitter" ? "@username" : kind === "website" ? "example.com" : "https://…"} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} onBlur={() => { const normalized = normalizeFoundationSocialInput(kind, value); if (normalized !== value) onChange(normalized); }} /></Field>;
}

function ModuleField({ field, id, value, showErrors, onChange }: { field: FoundationConfigurationField; id: string; value: string | boolean | undefined; showErrors?: boolean; onChange: (value: string | boolean) => void }) {
  if (field.kind === "boolean") return <label className={styles.checkLabel}><input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /><span><strong>{field.label}</strong>{field.description ? <small>{field.description}</small> : null}</span></label>;
  const missing = Boolean(showErrors && field.required && (value === undefined || value === ""));
  return <Field label={field.label} id={id} hint={field.description} error={missing ? `Complete ${field.label}.` : undefined}>{field.kind === "select" ? <select id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} aria-describedby={[field.description ? `${id}-help` : "", missing ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} autoComplete="off" spellCheck={false} inputMode={field.kind === "decimal" ? "decimal" : field.kind === "integer" ? "numeric" : "text"} aria-describedby={[field.description ? `${id}-help` : "", missing ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} onChange={event => onChange(event.target.value)} />}</Field>;
}
