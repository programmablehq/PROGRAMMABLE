"use client";
import { TOKEN_IMAGE_ACCEPT } from "@/lib/token-image";
import { useLaunchStatusPolling } from "./use-launch-status-polling";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { sha256, type Address, type Hex } from "viem";
import { prepareTokenImage, isProgrammableTokenImageUrl } from "@/lib/token-image";
import { validateModuleSocialLinks, type ModuleSocialKind, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { foundationInitialBuyError } from "@/lib/module-foundation/first-buy";
import { foundationDecimalError, foundationReviewError, foundationSelectionErrors, isFoundationCreatorFee, type FoundationAvailability, type FoundationImage, type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationModuleDescriptor, type FoundationModuleSelection, type FoundationQuoteAsset, type FoundationTransactionResult, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { foundationCreatorFeesEqual } from "@/lib/module-foundation/creator-fees";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { FOUNDATION_DEFAULT_IMAGE, isFoundationDefaultImage } from "@/lib/module-foundation/default-image";
import { FoundationLaunchPreparation } from "@/lib/module-foundation/launch-preparation";
import { FoundationLaunchBalanceError, foundationLaunchBalanceError } from "@/lib/module-foundation/launch-balance";
import { normalizeFoundationSocialInput, normalizeFoundationSocialInputs } from "@/lib/module-foundation/social-input";
import { ModuleFoundationTransactionResult } from "./module-foundation-review";
import { ModuleFoundationPairDialog } from "./module-foundation-pair-dialog";
import { ModuleFoundationConfigField } from "./module-foundation-config-field";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import styles from "./module-foundation-ui.module.css";
import { FoundationStudio } from "./module-studio/studio";
import type { FoundationStudioDraft } from "@/lib/module-foundation/studio";
import { clearFoundationLaunchDraft, readFoundationLaunchDraft, rememberFoundationLaunchDraft } from "@/lib/module-foundation/launch-draft";
import { foundationLaunchFeedback } from "@/lib/launch-feedback";

type EditableDraft = FoundationStudioDraft;
type LocalImage = { blob: Blob; preview: string; sha256: Hex };
type Phase = "editing" | "uploading" | "preparing" | "signing" | "result";
type Errors = Record<string, string>;

export interface ModuleFoundationBuilderProps {
  layout?: "form" | "studio";
  previousLaunchAction?: ReactNode;
  recoveryAction?: ReactNode;
  networkControl?: ReactNode;
  availability: FoundationAvailability;
  /** Custody of the currently verified launch factory; unknown while availability loads. */
  platformFeeBps?: 30 | 100;
  factoryVersion?: "v1" | "v2" | "v3";
  /** Changes whenever the authenticated wallet, chain or source release changes. */
  contextKey: string;
  catalog: readonly FoundationModuleDescriptor[];
  quoteAssets: readonly FoundationQuoteAsset[];
  nativeBalance?: bigint;
  onCheckFunding?: (initialBuy: string) => Promise<void>;
  onResolveQuote?: (address: Address) => Promise<FoundationQuoteAsset>;
  onResolveSuggestedInitialBuy?: () => Promise<string>;
  onUploadImage: (input: { image: { kind: "local"; sha256: Hex; mimeType: "image/webp"; bytes: number }; blob: Blob }) => Promise<FoundationImage>;
  onPrepareLaunch: (draft: FoundationLaunchDraft) => Promise<FoundationLaunchReview | null>;
  /** Read-only preparation while editing; must not acknowledge saved results or request the wallet. */
  onWarmLaunch?: (draft: FoundationLaunchDraft, signal: AbortSignal) => Promise<FoundationLaunchReview | null>;
  onConfirmLaunch: (review: FoundationLaunchReview) => Promise<FoundationTransactionResult>;
  onRefreshResult?: (result: FoundationTransactionResult) => Promise<FoundationTransactionResult>;
  onBack?: () => void;
  onRetryAvailability?: () => void;
  walletAction?: FoundationWalletAction;
  initialDraft?: Partial<FoundationLaunchDraft>;
  /** Keep editable fields and image bytes across navigation in this browser tab. */
  persistDraft?: boolean;
  suggestedInitialBuy?: string;
  minimumInitialBuy?: string;
  launchProgress?: string;
  /** Host-owned durable wallet operation guard, including uncertain submissions. */
  submissionBlocked?: string;
}

const SOCIAL_LABELS: Record<ModuleSocialKind, string> = { website: "Website", twitter: "X / Twitter", telegram: "Telegram", discord: "Discord", github: "GitHub", gitbook: "Docs" };
const EMPTY_MODULES: FoundationModuleSelection[] = [];

type LaunchErrorStage = "details" | "image" | "simulation" | "wallet" | "result";

function cleanError(error: unknown, stage: LaunchErrorStage = "details") {
  return foundationLaunchFeedback(error, stage);
}

function initialForm(initial: Partial<FoundationLaunchDraft> | undefined, quotes: readonly FoundationQuoteAsset[], chainId: number): EditableDraft {
  const quote = quotes.find(asset => asset.chainId === chainId && asset.supported && asset.supportsNativeEth);
  return { name: initial?.name ?? "", symbol: initial?.symbol ?? "", description: initial?.description ?? "", image: initial?.image ?? null,
    socialLinks: initial?.socialLinks ?? {}, quoteAsset: initial?.quoteAsset ?? quote?.address ?? "", creatorFeeBps: initial?.creatorFeeBps ?? (initial?.creatorBuyFeeBps === initial?.creatorSellFeeBps ? initial?.creatorBuyFeeBps : 0) ?? 0,
    initialBuy: initial?.initialBuy ?? "", ...(initial?.quoteValuation !== undefined ? { quoteValuation: initial.quoteValuation } : {}), additionalLiquidity: "0", modules: initial?.modules ?? EMPTY_MODULES };
}

export function ModuleFoundationBuilder({ platformFeeBps = 30, layout = "form", previousLaunchAction, recoveryAction, networkControl, availability, contextKey, catalog, quoteAssets, nativeBalance, onCheckFunding, onResolveQuote, onResolveSuggestedInitialBuy, onUploadImage, onPrepareLaunch, onWarmLaunch, onConfirmLaunch, onRefreshResult, onBack, onRetryAvailability, walletAction, initialDraft, persistDraft = false, suggestedInitialBuy, minimumInitialBuy, launchProgress, submissionBlocked }: ModuleFoundationBuilderProps) {
  const [restored] = useState(() => persistDraft && !initialDraft ? readFoundationLaunchDraft(availability.chainId) : null);
  const [draft, setDraft] = useState<EditableDraft>(() => restored?.draft ?? initialForm(initialDraft, quoteAssets, availability.chainId));
  const [buyEdited, setBuyEdited] = useState(restored?.buyEdited ?? (initialDraft?.initialBuy !== undefined));
  const initialBuy = buyEdited ? draft.initialBuy : suggestedInitialBuy ?? "";
  const [localImage, setLocalImage] = useState<LocalImage | null>(null);
  const [imageRestored, setImageRestored] = useState(!restored?.localImage);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [imageError, setImageError] = useState("");
  const [quoteLookup, setQuoteLookup] = useState<{ address: string; status: "checking" | "resolved" | "error"; contextKey: string; asset?: FoundationQuoteAsset; message?: string } | null>(null);
  const [customQuote, setCustomQuote] = useState(restored?.customQuote ?? Boolean(initialDraft?.quoteAsset && initialDraft.quoteAsset.toLowerCase() !== foundationChainProfile(availability.chainId).wrappedEth.address.toLowerCase() && !quoteAssets.some(asset => asset.supportsNativeEth && asset.address.toLowerCase() === initialDraft.quoteAsset?.toLowerCase())));
  const [modulePickerView, setModulePickerView] = useState<"modules" | "quote" | null>(null);
  const [phase, setPhase] = useState<Phase>("editing");
  const [errors, setErrors] = useState<Errors>({});
  const [operationError, setError] = useState("");
  const [walletError, setWalletError] = useState<{ context: string; message: string } | null>(null);
  const fundingError = !walletAction && phase === "editing" ? foundationLaunchBalanceError(nativeBalance, initialBuy, availability.chainName) : undefined;
  const error = walletAction && walletError?.context === contextKey ? walletError.message : fundingError || operationError;
  const [announcement, setAnnouncement] = useState("");
  const [result, setResult] = useState<FoundationTransactionResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const imageGeneration = useRef(0);
  const quoteGeneration = useRef(0);
  const active = useRef(true);
  const currentContext = useRef(contextKey);
  const quoteResolver = useRef(onResolveQuote);
  const pendingQuote = useRef<{ key: string; promise: Promise<FoundationQuoteAsset | undefined> } | null>(null);
  const lock = useRef(false);
  const refreshLock = useRef(false);
  const submittedContext = useRef<string | null>(null);
  const launchPreparation = useRef(new FoundationLaunchPreparation());
  const warmLaunch = useRef(onWarmLaunch);
  const imageUploader = useRef(onUploadImage);
  const selectedImage = useRef(localImage);
  const imageUpload = useRef<{ key: string; promise: Promise<FoundationImage> } | null>(null);
  const [warmRetry, setWarmRetry] = useState(0);
  useEffect(() => {
    if (!restored?.localImage) return;
    const preview = URL.createObjectURL(restored.localImage.blob);
    // The browser URL must be allocated after commit and revoked on unmount, including Strict Mode cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalImage({ ...restored.localImage, preview });
    setImageRestored(true);
    return () => URL.revokeObjectURL(preview);
  }, [restored]);
  useEffect(() => {
    if (!persistDraft || !imageRestored) return;
    if (phase === "result" && result?.status !== "reverted") clearFoundationLaunchDraft(availability.chainId);
    else rememberFoundationLaunchDraft(availability.chainId, { draft, buyEdited, customQuote, localImage });
  }, [persistDraft, imageRestored, availability.chainId, draft, buyEdited, customQuote, localImage, phase, result]);
  useLayoutEffect(() => {
    if (currentContext.current !== contextKey) {
      quoteGeneration.current += 1; pendingQuote.current = null;
      launchPreparation.current.invalidate(); imageUpload.current = null;
      if (selectedImage.current) setDraft(current => ({ ...current, image: null }));
    }
    currentContext.current = contextKey; quoteResolver.current = onResolveQuote;
    warmLaunch.current = onWarmLaunch; imageUploader.current = onUploadImage; selectedImage.current = localImage;
  }, [contextKey, onResolveQuote, onWarmLaunch, onUploadImage, localImage]);
  useEffect(() => {
    active.current = true;
    const preparation = launchPreparation.current;
    return () => { active.current = false; imageGeneration.current += 1; generation.current += 1; quoteGeneration.current += 1; preparation.invalidate(); };
  }, []);
  useEffect(() => () => { if (localImage) URL.revokeObjectURL(localImage.preview); }, [localImage]);

  const busy = phase === "uploading" || phase === "preparing" || phase === "signing";
  const nativeQuote = quoteAssets.find(asset => asset.chainId === availability.chainId && asset.supported && asset.supportsNativeEth);
  const quoteAddress = customQuote ? draft.quoteAsset.trim() : nativeQuote?.address ?? foundationChainProfile(availability.chainId).wrappedEth.address;
  const knownQuote = quoteAssets.find(asset => asset.address.toLowerCase() === quoteAddress.toLowerCase() && asset.chainId === availability.chainId);
  const lookedUpQuote = quoteLookup?.address.toLowerCase() === quoteAddress.toLowerCase() && quoteLookup.status === "resolved" && quoteLookup.contextKey === contextKey ? quoteLookup.asset : undefined;
  const quote = knownQuote ?? lookedUpQuote;
  const quoteSymbol = !customQuote || quote?.supportsNativeEth ? "ETH" : quote?.symbol || "TOKEN";
  const currentQuoteLookup = quoteLookup?.address.toLowerCase() === quoteAddress.toLowerCase()
    && quoteLookup.contextKey === contextKey ? quoteLookup : undefined;
  const quoteStatus = !customQuote ? undefined : quote
    ? quote.supported ? `${quote.name} · ${quote.symbol}` : quote.reason || "This token is not supported for this launch."
    : currentQuoteLookup?.status === "checking" ? "Checking token…" : currentQuoteLookup?.message;
  const imageSource = localImage?.preview ?? draft.image?.url;
  const modulesError = foundationSelectionErrors(draft.modules, catalog);
  const unavailable = availability.status !== "ready";
  const locked = busy || phase === "result";
  const canResolveQuote = Boolean(onResolveQuote);
  const moduleCount = draft.modules.length + (customQuote ? 1 : 0);

  function update<K extends keyof EditableDraft>(key: K, value: EditableDraft[K]) {
    if (key === "initialBuy") setBuyEdited(true);
    generation.current += 1;
    launchPreparation.current.invalidate();
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (key === "quoteAsset" || (key === "quoteValuation" && value === undefined)) delete next.quoteValuation;
      return next;
    });
    setErrors(current => { const next = { ...current }; delete next[key]; if (key === "quoteAsset") delete next.quoteValuation; if (key === "quoteValuation") delete next.initialBuy; if (key === "socialLinks") for (const name of Object.keys(next)) if (name.startsWith("social-")) delete next[name]; return next; });
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
    const request = ++imageGeneration.current;
    generation.current += 1;
    launchPreparation.current.invalidate();
    setImagePreparing(true); setImageError("");
    try {
      const blob = await prepareTokenImage(file);
      if (blob.type !== "image/webp") throw new Error("This browser could not prepare a WebP image. Try a different browser.");
      const digest = sha256(new Uint8Array(await blob.arrayBuffer()));
      if (!active.current || imageGeneration.current !== request) return;
      const preview = URL.createObjectURL(blob);
      setLocalImage({ blob, preview, sha256: digest });
      setDraft(current => ({ ...current, image: null }));
      setErrors(current => { const next = { ...current }; delete next.image; return next; });
      setAnnouncement("Image selected.");
    } catch (caught) { if (active.current && imageGeneration.current === request) setImageError(cleanError(caught, "image")); }
    finally { if (active.current && imageGeneration.current === request) setImagePreparing(false); }
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
      throw caught;
    });
    pendingQuote.current = { key, promise };
    return promise;
  }, [availability.chainId, contextKey, quoteAddress]);

  useEffect(() => {
    if (!customQuote || !canResolveQuote || knownQuote || lookedUpQuote || !/^0x[0-9a-fA-F]{40}$/.test(quoteAddress)) return;
    const timer = window.setTimeout(() => void resolveQuote().catch(() => undefined), 300);
    return () => window.clearTimeout(timer);
  }, [customQuote, canResolveQuote, knownQuote, lookedUpQuote, quoteAddress, resolveQuote]);

  function validate(selectedQuote: FoundationQuoteAsset | undefined, buyAmount: string): { errors: Errors; links: ModuleSocialLinks } {
    const next: Errors = {};
    if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 48) next.name = "Enter a coin name of up to 48 bytes.";
    if (!/^[A-Za-z0-9]{1,12}$/.test(draft.symbol.trim())) next.symbol = "Use 1 to 12 letters or numbers.";
    if (new TextEncoder().encode(draft.description.trim()).length > 280) next.description = "Use a description of up to 280 bytes.";
    if (draft.image && !isFoundationDefaultImage(draft.image) && !isProgrammableTokenImageUrl(draft.image.url)) next.image = "Choose an image to save with this launch.";
    if (!selectedQuote?.supported || selectedQuote.chainId !== availability.chainId || (!customQuote && !selectedQuote.supportsNativeEth)) next.quoteAsset = selectedQuote?.reason ?? (customQuote ? /^0x[0-9a-fA-F]{40}$/.test(quoteAddress) ? "This token could not be verified. Try launching again." : `Enter a token contract address on ${availability.chainName}.` : "ETH pairing could not be verified. Try again.");
    if (!isFoundationCreatorFee(draft.creatorFeeBps)) next.creatorFeeBps = "Choose a whole percentage from 0% to 10%.";
    const buyError = foundationInitialBuyError(buyAmount, minimumInitialBuy);
    if (buyError) next.initialBuy = buyError;
    if (draft.quoteValuation !== undefined) {
      const priceError = foundationDecimalError(draft.quoteValuation, selectedQuote?.decimals ?? 18, false);
      if (priceError) next.quoteValuation = priceError;
    }
    if (modulesError.length) next.modules = modulesError.join(" ");
    const socials = validateModuleSocialLinks(normalizeFoundationSocialInputs(draft.socialLinks));
    if (!socials.ok) for (const issue of socials.issues) next[`social-${issue.path.split("/").at(-1)}`] = issue.message.replace(/GitBook/g, "Docs");
    return { errors: next, links: socials.ok ? socials.links : {} };
  }

  function saveImage(image: LocalImage, context: string): Promise<FoundationImage> {
    const key = `${context}:${image.sha256}`;
    if (imageUpload.current?.key === key) return imageUpload.current.promise;
    const promise = imageUploader.current({ image: { kind: "local", sha256: image.sha256, mimeType: "image/webp", bytes: image.blob.size }, blob: image.blob }).then(saved => {
      if (!isProgrammableTokenImageUrl(saved.url) || saved.sha256.toLowerCase() !== image.sha256.toLowerCase()) throw new Error("The saved image does not match your selected image. Choose the image again.");
      if (!active.current || currentContext.current !== context || selectedImage.current?.sha256 !== image.sha256) throw new Error("Your wallet or selected image changed. Choose the image again.");
      setDraft(current => ({ ...current, image: saved }));
      setImageError("");
      return saved;
    }).catch(caught => { if (imageUpload.current?.key === key) imageUpload.current = null; throw caught; });
    imageUpload.current = { key, promise };
    return promise;
  }

  const canWarm = Boolean(onWarmLaunch && !walletAction && !unavailable && !submissionBlocked && !fundingError && !imagePreparing && phase !== "result");
  // Saving a selected image does not need to hold up the eventual launch click.
  useEffect(() => {
    if (!canWarm || !localImage || draft.image) return;
    const context = contextKey, image = localImage;
    const timer = window.setTimeout(() => {
      void saveImage(image, context).catch(caught => {
        if (active.current && currentContext.current === context && selectedImage.current?.sha256 === image.sha256) setImageError(cleanError(caught, "image"));
      });
    }, 400);
    return () => window.clearTimeout(timer);
    // The uploader lives in a ref so a parent render cannot restart the same upload.
  }, [canWarm, contextKey, localImage, draft.image]);

  const warmValidation = validate(quote ? { ...quote } : undefined, initialBuy);
  const warmDraft: FoundationLaunchDraft | null = canWarm && !imageError && !Object.keys(warmValidation.errors).length && (!localImage || draft.image)
    ? { ...draft, name: draft.name.trim(), symbol: draft.symbol.trim().toUpperCase(), description: draft.description.trim(),
      quoteAsset: quote!.address, socialLinks: warmValidation.links, image: draft.image ?? FOUNDATION_DEFAULT_IMAGE, initialBuy, additionalLiquidity: "0" }
    : null;
  const warmKey = warmDraft ? JSON.stringify({ contextKey, draft: warmDraft }) : "";
  useEffect(() => {
    const preparation = launchPreparation.current;
    if (!warmKey) { preparation.invalidate(); return; }
    const snapshot = JSON.parse(warmKey) as { contextKey: string; draft: FoundationLaunchDraft };
    let current = true;
    let refreshTimer: number | undefined;
    let attempts = 0;
    const run = () => {
      const prepareWarm = warmLaunch.current;
      if (!prepareWarm || !current || lock.current) return;
      attempts += 1;
      void preparation.prepare(snapshot.draft, snapshot.contextKey, prepareWarm)
        .then(review => {
          if (!review || !current || attempts >= 3) return;
          // Keep a short price reference ready while the owner is still editing. Never poll an idle/hidden tab forever.
          refreshTimer = window.setTimeout(() => {
            if (document.visibilityState === "visible" && document.hasFocus() && form.current?.contains(document.activeElement)) run();
          }, Math.max(1_000, review.expiresAt * 1_000 - Date.now() - 14_000));
        })
        .catch(() => { /* The explicit launch action reports preparation errors. */ });
    };
    const timer = window.setTimeout(run, 800);
    return () => { current = false; window.clearTimeout(timer); window.clearTimeout(refreshTimer); preparation.invalidate(); };
    // Only exact draft/context changes should start RPC work, never callback identity or progress renders.
  }, [warmKey, warmRetry, availability.chainId]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (lock.current || imagePreparing || locked || unavailable || submissionBlocked) return;
    if (walletAction) {
      lock.current = true;
      const context = currentContext.current;
      setWalletError(null); setError("");
      try { await walletAction.onClick(); }
      catch (caught) {
        if (active.current && currentContext.current === context) setWalletError({ context, message: cleanError(caught) });
      }
      finally { lock.current = false; }
      return;
    }
    setAnnouncement("");
    const request = ++generation.current;
    let errorStage: LaunchErrorStage = "details";
    const context = currentContext.current;
    const assertCurrent = () => {
      if (!active.current || generation.current !== request || currentContext.current !== context) throw new Error("Your wallet or launch version changed. Create the launch again; your coin details are kept.");
    };
    lock.current = true;
    try {
      setPhase("preparing");
      setError("");
      let selectedQuote = quote;
      if (!selectedQuote && /^0x[0-9a-fA-F]{40}$/.test(quoteAddress)) {
        selectedQuote = await resolveQuote();
        assertCurrent();
      }
      let launchInitialBuy = initialBuy;
      if (!buyEdited && !launchInitialBuy && onResolveSuggestedInitialBuy) {
        launchInitialBuy = await onResolveSuggestedInitialBuy();
        assertCurrent();
      }
      const checked = validate(selectedQuote, launchInitialBuy);
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
      await onCheckFunding?.(launchInitialBuy);
      assertCurrent();
      let savedImage = draft.image;
      if (!savedImage && localImage) {
        errorStage = "image";
        setPhase("uploading");
        savedImage = await saveImage(localImage, context);
        assertCurrent();
        if (!isProgrammableTokenImageUrl(savedImage.url) || savedImage.sha256.toLowerCase() !== localImage.sha256.toLowerCase()) throw new Error("The saved image does not match your selected image. Choose the image again.");
        setDraft(current => ({ ...current, image: savedImage }));
        setAnnouncement("Image saved. Preparing the launch simulation.");
      }
      savedImage ??= FOUNDATION_DEFAULT_IMAGE;
      errorStage = "simulation";
      assertCurrent(); setPhase("preparing");
      const launchDraft: FoundationLaunchDraft = { ...draft, name: draft.name.trim(), symbol: draft.symbol.trim().toUpperCase(), description: draft.description.trim(), quoteAsset: selectedQuote!.address,
        socialLinks: checked.links, image: savedImage, initialBuy: launchInitialBuy, additionalLiquidity: "0" };
      const prepared = await launchPreparation.current.prepare(launchDraft, context,
        (value, signal) => warmLaunch.current ? warmLaunch.current(value, signal) : onPrepareLaunch(value));
      assertCurrent();
      if (!prepared) { setPhase("editing"); return; }
      const invalid = foundationReviewError(prepared, context);
      if (invalid) throw new Error(invalid);
      if (prepared.quote.address.toLowerCase() !== selectedQuote!.address.toLowerCase() || prepared.chainId !== availability.chainId || !foundationCreatorFeesEqual(prepared, draft) || prepared.transactions.length === 0) throw new Error("Your coin settings changed. Create the launch again.");
      assertCurrent();
      setPhase("signing");
      errorStage = "wallet";
      const receipt = await onConfirmLaunch(prepared);
      if (active.current) { submittedContext.current = context; setResult(receipt); setPhase("result"); }
    } catch (caught) {
      if (active.current && generation.current === request) {
        setPhase("editing");
        // Context changes already invalidate the old preparation. Its late failure must
        // not cancel the new wallet's preparation or announce an unrelated error.
        if (currentContext.current !== context) return;
        launchPreparation.current.invalidate();
        // Funding messages follow the live balance, so a deposit clears them without a reload.
        setError(caught instanceof FoundationLaunchBalanceError ? "" : cleanError(caught, errorStage));
        const failure = caught as { code?: number; walletRequestAttempted?: boolean; walletRequestRejected?: boolean } | null;
        if (errorStage === "wallet" && (failure?.code === 4001 || failure?.walletRequestAttempted === false || failure?.walletRequestRejected === true)) setWarmRetry(value => value + 1);
      }
    }
    finally { lock.current = false; }
  }

  const refreshResult = useCallback(async () => {
    if (!result || !onRefreshResult || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try { const next = await onRefreshResult(result); if (active.current) { setResult(next); setError(""); } }
    catch (caught) { if (active.current) setError(cleanError(caught, "result")); }
    finally { refreshLock.current = false; if (active.current) setRefreshing(false); }
  }, [result, onRefreshResult]);

  useLaunchStatusPolling(`${contextKey}:${result?.transactionHash ?? ""}`,
    phase === "result" && Boolean(result) && Boolean(onRefreshResult) && !refreshing,
    async () => {
      if (contextKey !== submittedContext.current || !result || result.status === "reverted"
        || result.status === "confirmed" && result.verificationStatus !== "pending") return;
      await refreshResult();
    }, 15_000);

  function edit() {
    if (busy) return;
    setPhase("editing"); setError(""); generation.current += 1;
    requestAnimationFrame(() => document.getElementById("foundation-name")?.focus());
  }

  const actionLabel = walletAction?.label ?? (availability.status === "checking" ? "Checking launch…" : phase === "uploading" ? "Saving image…" : phase === "signing" ? launchProgress || "Opening coin…" : phase === "preparing" ? "Preparing launch…" : "Launch coin");
  if (layout === "studio" && phase !== "result") return <FoundationStudio draft={draft} catalog={catalog} imageSource={imageSource} platformFeeBps={platformFeeBps}
    previousLaunchAction={previousLaunchAction} recoveryAction={recoveryAction} networkControl={networkControl} quoteSymbol={quoteSymbol} quoteStatus={quoteStatus}
    initialBuy={initialBuy} actionLabel={actionLabel} imagePreparing={imagePreparing} disabled={locked} busy={busy || walletAction?.busy}
    actionDisabled={imagePreparing || unavailable || Boolean(submissionBlocked) || walletAction?.busy} status={launchProgress || (availability.status === "checking" ? "Connecting to the launch network. You can fill in your coin details while we check." : availability.status !== "ready" ? availability.reason || actionLabel : undefined)}
    error={error || (recoveryAction ? undefined : submissionBlocked)} errors={{ ...errors, ...(imageError ? { image: imageError } : {}) }}
    customQuote={customQuote} canResolveQuote={canResolveQuote} modulesLoading={availability.status === "checking" && !catalog.length} formRef={form} imageInput={imageInput}
    onSocialChange={updateSocial} onImageError={() => setImageError("The image could not load. Choose another image.")}
    onEnableQuote={() => chooseMarket(true)} onRetryAvailability={availability.status === "unavailable" ? onRetryAvailability : undefined}
    emptyModulesMessage={availability.status === "checking" ? "Loading modules…" : availability.status === "unavailable" ? "Modules could not load." : "No modules available"}
    onUpdate={update} onChooseImage={file => void chooseImage(file)} onRemoveImage={() => { imageGeneration.current += 1; setImagePreparing(false); setLocalImage(null); update("image", null); setImageError(""); }}
    onQuoteChange={address => { if (!customQuote) { quoteGeneration.current += 1; pendingQuote.current = null; setCustomQuote(true); setQuoteLookup(null); } update("quoteAsset", address); }}
    onDefaultQuote={() => chooseMarket(false)} onSubmit={event => void prepare(event)} onBack={onBack} />;
  return <div className={`${styles.page} ${styles.builderPage}`}>
    <div className={styles.topline}>{onBack ? <button type="button" className={styles.backButton} disabled={busy} onClick={onBack}><ArrowLeftIcon size={16} aria-hidden="true" /> Home</button> : <span className={styles.eyebrow}>Module Mode</span>}{networkControl ?? <span className={styles.network}>{availability.chainName}</span>}</div>
    <header className={styles.pageHeading}><h1>Launch a Coin</h1></header>
    {availability.status === "checking" ? <div className={styles.launchStatus} role="status">Checking launch availability…</div> : null}
    {availability.status === "unavailable" ? <div className={styles.launchStatus} role="status"><span>Launching is temporarily unavailable.</span>{onRetryAvailability ? <button type="button" className={styles.textButton} onClick={onRetryAvailability}>Retry</button> : null}</div> : null}
    {submissionBlocked && !launchProgress ? <div className={styles.availability} role="status"><strong>A wallet operation needs checking</strong><p>{submissionBlocked}</p></div> : null}
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
                <input ref={imageInput} className={styles.srOnly} type="file" tabIndex={-1} aria-label="Coin image file" accept={TOKEN_IMAGE_ACCEPT} disabled={locked || imagePreparing} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseImage(file); }} />
              </div>
              <p className={styles.error} id="foundation-image-error">{errors.image || imageError || ""}</p>
              <div className={styles.nameFields}><Field label="Name" id="foundation-name" error={errors.name}><input id="foundation-name" name="name" autoComplete="off" maxLength={48} value={draft.name} placeholder="Coin name" aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? "foundation-name-error" : undefined} onChange={event => update("name", event.target.value)} /></Field><Field label="Ticker" id="foundation-symbol" error={errors.symbol}><input id="foundation-symbol" name="symbol" autoComplete="off" spellCheck={false} maxLength={12} value={draft.symbol} placeholder="COIN" aria-invalid={Boolean(errors.symbol) || undefined} aria-describedby={errors.symbol ? "foundation-symbol-error" : undefined} onChange={event => update("symbol", event.target.value.toUpperCase())} /></Field></div>
              <Field label="Description" id="foundation-description" error={errors.description}><textarea id="foundation-description" name="description" maxLength={280} rows={2} value={draft.description} placeholder="A few words about your coin" aria-invalid={Boolean(errors.description) || undefined} aria-describedby={errors.description ? "foundation-description-error" : undefined} onChange={event => update("description", event.target.value)} /></Field>
              <div className={styles.twoFields}>{(["website", "twitter"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div>
              <details className={styles.socialDetails}><summary>Add More Links <CaretDownIcon size={14} aria-hidden="true" /></summary><div className={styles.twoFields}>{(["telegram", "discord", "github", "gitbook"] as const).map(key => <SocialField key={key} kind={key} value={draft.socialLinks[key] ?? ""} onChange={value => updateSocial(key, value)} error={errors[`social-${key}`]} />)}</div></details>
              {errors["social-socialLinks"] ? <p className={styles.error}>{errors["social-socialLinks"]}</p> : null}
            </section>
            <section className={styles.formSection} aria-labelledby="foundation-market-heading">
              <div className={styles.moduleSectionHeading}>
                <h2 id="foundation-market-heading" className={styles.marketLabel}>Modules</h2>
                {onResolveQuote || catalog.length ? <button id="foundation-add-module" type="button" className={styles.addModuleButton} onClick={() => setModulePickerView("modules")}><PlusIcon size={16} aria-hidden="true" /> Add module</button> : null}
              </div>
              {customQuote ? <div className={styles.attachedModule}>
                <PlugsConnectedIcon size={24} aria-hidden="true" />
                <button id="foundation-quote" type="button" className={styles.moduleEdit} aria-label="Edit pair module" data-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={errors.quoteAsset ? "foundation-quote-error" : undefined} onClick={() => setModulePickerView("quote")}>
                  <strong>Any Quote Pool</strong><span>{quote?.supported ? `${quote.name} · ${quoteSymbol}` : `${quoteAddress.slice(0, 6)}…${quoteAddress.slice(-4)}`}</span>
                </button>
                <button type="button" className={styles.iconButton} aria-label="Remove pair module" onClick={() => { chooseMarket(false); requestAnimationFrame(() => document.getElementById("foundation-add-module")?.focus()); }}><XIcon size={18} aria-hidden="true" /></button>
              </div> : <div id="foundation-quote" tabIndex={errors.quoteAsset ? -1 : undefined} className={styles.classicPair} data-invalid={Boolean(errors.quoteAsset) || undefined} aria-describedby={errors.quoteAsset ? "foundation-quote-error" : undefined}>
                <svg className={styles.ethereumMark} width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" /><path d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z" /><path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" /></svg>
                <span>Classic <span className={styles.muted}>· Paired with ETH</span></span>
              </div>}
              {errors.quoteAsset ? <p id="foundation-quote-error" className={styles.error}>{errors.quoteAsset}</p> : null}
              {customQuote ? <section aria-label="Starting value">
                <div className={styles.sideButtons} role="group" aria-label="Starting value currency">
                  <button type="button" aria-pressed={draft.quoteValuation === undefined} onClick={() => update("quoteValuation", undefined)}>Automatic USD</button>
                  <button type="button" aria-pressed={draft.quoteValuation !== undefined} onClick={() => update("quoteValuation", draft.quoteValuation ?? "")}>Set in {quoteSymbol}</button>
                </div>
                {draft.quoteValuation !== undefined ? <>
                  <Field id="foundation-quote-valuation" label={`Starting market cap · ${quoteSymbol}`} error={errors.quoteValuation}>
                    <input id="foundation-quote-valuation" name="quoteValuation" inputMode="decimal" autoComplete="off" value={draft.quoteValuation} placeholder="Enter a value" aria-invalid={Boolean(errors.quoteValuation) || undefined} aria-describedby={errors.quoteValuation ? "foundation-quote-valuation-error foundation-quote-value-help" : "foundation-quote-value-help"} onChange={event => update("quoteValuation", event.target.value)} />
                  </Field>
                  <p id="foundation-quote-value-help" className={styles.help}>Total supply value in {quoteSymbol}. The ETH first buy is included in your launch.</p>
                </> : null}
              </section> : null}
              {draft.modules.length ? <div className={styles.catalog}>{catalog.filter(descriptor => draft.modules.some(item => item.id === descriptor.id)).map(descriptor => {
                const selection = draft.modules.find(item => item.id === descriptor.id)!;
                return <div className={styles.module} key={`${descriptor.id}:${descriptor.version}`}><div className={styles.moduleHeading}><div><h3>{descriptor.name}</h3><p>{descriptor.description}</p></div><button className={styles.iconButton} type="button" aria-label={`Remove ${descriptor.name}`} onClick={() => update("modules", draft.modules.filter(item => item.id !== descriptor.id))}><XIcon size={18} aria-hidden="true" /></button></div>{!descriptor.available ? <p className={styles.help}>{descriptor.unavailableReason ?? "This module is currently unavailable."}</p> : null}<div className={styles.moduleFields}>{descriptor.fields.map(field => <ModuleFoundationConfigField key={field.key} field={field} id={`foundation-module-${encodeURIComponent(descriptor.id)}-${encodeURIComponent(field.key)}`} value={selection.configuration[field.key]} showErrors={Boolean(errors.modules)} onChange={value => update("modules", draft.modules.map(item => item.id === descriptor.id ? { ...item, configuration: { ...item.configuration, [field.key]: value } } : item))} />)}<details className={styles.transactionDetails}><summary>Module capabilities and version</summary><p className={styles.help}>Version {descriptor.version}</p><ul className={styles.notes}>{descriptor.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></details></div></div>;
              })}</div> : null}
              {errors.modules ? <p className={styles.error} role="alert">{errors.modules}</p> : null}
              <div className={styles.feesBuyRow}>
                <CreatorFeeField platformFeeBps={platformFeeBps} value={draft.creatorFeeBps} error={errors.creatorFeeBps} onChange={value => update("creatorFeeBps", value)} />
                <Field label="First buy · min. $2" id="foundation-initial-buy" error={errors.initialBuy}><div className={styles.amountInput}><input id="foundation-initial-buy" name="initialBuy" inputMode="decimal" autoComplete="off" required value={initialBuy} placeholder="ETH amount" aria-invalid={Boolean(errors.initialBuy) || undefined} aria-describedby={errors.initialBuy ? "foundation-initial-buy-error" : undefined} onChange={event => update("initialBuy", event.target.value)} /><span>ETH</span></div></Field>
              </div>
            </section>
          </fieldset>
          <div className={styles.formFooter}><p className={styles.error} role="alert">{error}</p>{phase === "preparing" ? <p className={styles.help} role="status">Checking your launch. Your wallet will open when it is ready.</p> : null}<button type="submit" className={styles.primaryButton} disabled={locked || imagePreparing || unavailable || Boolean(submissionBlocked) || walletAction?.busy} aria-busy={busy || walletAction?.busy}><span>{actionLabel}</span><ArrowRightIcon size={18} aria-hidden="true" /></button></div>
        </form>}
      </div>
      <aside className={styles.preview} aria-label="Coin preview">
        <div className={styles.previewHeading}><span>Preview</span>{moduleCount ? <span className={styles.moduleBadge}>+{moduleCount} {moduleCount === 1 ? "module" : "modules"}</span> : null}</div>
        <div className={styles.previewArtwork}><Image src={imageSource ?? FOUNDATION_DEFAULT_IMAGE.url} alt={`${draft.name.trim() || "Coin"} preview`} width={320} height={320} loading="eager" unoptimized /></div>
        <div className={styles.previewContent}><div className={styles.coinName}><h2>{draft.name.trim() || "Your coin"}</h2><span>${draft.symbol.trim() || "COIN"}</span></div>{draft.description.trim() ? <p className={styles.previewDescription}>{draft.description.trim()}</p> : null}<div className={styles.previewMarket}><span>Pair</span><strong>{draft.symbol.trim() || "COIN"} / {quoteSymbol}</strong></div><div className={styles.previewModules}>{customQuote ? <span><PlugsConnectedIcon size={16} aria-hidden="true" /> Any Quote Pool</span> : null}{draft.modules.map(selection => <span key={selection.id}>{catalog.find(item => item.id === selection.id)?.name ?? selection.id}</span>)}</div><div className={styles.previewFoot}><span>{availability.chainName}</span><span>Uniswap v4</span></div></div>
      </aside>
    </div>
    {modulePickerView && !locked ? <ModuleFoundationPairDialog key={contextKey} chainId={availability.chainId} quoteAssets={quoteAssets}
      initialView={modulePickerView} catalog={catalog} selectedModules={draft.modules}
      onApplyModule={selection => {
        update("modules", [...draft.modules.filter(item => item.id !== selection.id), selection]);
        setAnnouncement(`${catalog.find(item => item.id === selection.id)?.name ?? "Module"} saved.`);
      }}
      initialAddress={customQuote ? quoteAddress : undefined} initialAsset={customQuote ? quote : undefined} onResolveQuote={onResolveQuote}
      onClose={() => setModulePickerView(null)} onApply={asset => {
        quoteGeneration.current += 1; pendingQuote.current = null;
        setCustomQuote(true); setQuoteLookup({ address: asset.address, status: "resolved", contextKey, asset });
        update("quoteAsset", asset.address); setAnnouncement(`${asset.symbol} pair module added.`);
      }} /> : null}
    <p className={styles.srOnly} role="status">{announcement || (phase === "uploading" ? "Saving the exact selected image." : phase === "preparing" ? "Preparing a current launch simulation." : "")}</p>
  </div>;
}

function Field({ label, id, error, hint, children }: { label: React.ReactNode; id: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}{hint ? <p id={`${id}-help`} className={styles.help}>{hint}</p> : null}{error ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}</div>;
}

function CreatorFeeField({ value, error, onChange, platformFeeBps }: { platformFeeBps: 30 | 100; value: number; error?: string; onChange: (value: number) => void }) {
  const id = "foundation-creator-fee";
  return <Field label="Creator fees" id={id} hint={`Buy & Sell (Platform Fee ${platformFeeBps / 100}%)`} error={error}><div className={styles.feeControls}>
    <button type="button" aria-label="Decrease creator fee" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 100))}><MinusIcon size={16} aria-hidden="true" /></button>
    <div><input id={id} name="creatorFeeBps" type="number" min={0} max={10} step={1} value={value / 100} aria-invalid={Boolean(error) || undefined} aria-describedby={[`${id}-help`, error ? `${id}-error` : ""].filter(Boolean).join(" ")} onChange={event => onChange(Number(event.target.value) * 100)} /><span>%</span></div>
    <button type="button" aria-label="Increase creator fee" disabled={value >= 1000} onClick={() => onChange(Math.min(1000, value + 100))}><PlusIcon size={16} aria-hidden="true" /></button>
  </div></Field>;
}

function SocialField({ kind, value, error, onChange }: { kind: ModuleSocialKind; value: string; error?: string; onChange: (value: string) => void }) {
  const id = `foundation-social-${kind}`;
  return <Field label={SOCIAL_LABELS[kind]} id={id} error={error}><input id={id} name={kind} type={kind === "twitter" ? "text" : "url"} autoComplete="off" autoCapitalize="none" spellCheck={false} value={value} placeholder={kind === "twitter" ? "@username" : kind === "website" ? "example.com" : "https://…"} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} onBlur={() => { const normalized = normalizeFoundationSocialInput(kind, value); if (normalized !== value) onChange(normalized); }} /></Field>;
}
