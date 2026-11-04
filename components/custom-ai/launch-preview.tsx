"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import { setupQuoteAddress, type CoinSetup, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { Draft } from "@/lib/custom-ai/types";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { useCustomAILaunch } from "./use-launch";
import type { ImageReceipt } from "@/lib/custom-ai/studio";
import styles from "./workspace.module.css";
import { CoinDetails, type CoinDetailsControls, type CoinEditorImage } from "./coin-details";
import { useWallet } from "@/components/wallet-provider";
import { aiRequest } from "@/lib/custom-ai/client";
import { designReadiness, type LaunchPreparation } from "@/lib/custom-ai/readiness";
import { RuleReview } from "./rule-review";
import { intentHasOpenParts, intentMatchesCandidate, type LaunchIntent } from "@/lib/custom-ai/launch-intent";

export function CustomAILaunchPreview({ draft, intent, disabled, settings: editingSettings, chatRevision, onChange, draftId, headers, localPreview, cacheKey, onLaunchLocked, imageReceipt, onImageReceipt, pendingChange, onKeepRules, onStartAnother, onEditRule, children,launchCommand,editorControls,onImageBusy }: {
  draft?: Draft; intent?: LaunchIntent; disabled: boolean; settings: CoinSetup; chatRevision: number; onChange: (patch: CoinSetupPatch) => void;
  draftId?: string; headers: AISessionHeaders; localPreview: boolean;
  cacheKey: string;
  onLaunchLocked: (locked: boolean) => void;
  imageReceipt?: ImageReceipt; onImageReceipt: (receipt: ImageReceipt | undefined) => void;
  pendingChange?: string; onKeepRules: () => void; onStartAnother: () => void;
  onEditRule: (requirementId: string) => void;
  children?:ReactNode;
  launchCommand?:{id:string;sourceId:string};
  editorControls?:RefObject<CoinDetailsControls|null>;onImageBusy?:(busy:boolean)=>void;
}) {
  const account = useWallet().wallet?.account;
  const [preparation, setPreparation] = useState<LaunchPreparation>();
  const headersRef = useRef(headers);
  useEffect(() => { headersRef.current = headers; }, [headers]);
  const preparationKey = JSON.stringify([editingSettings, account, imageReceipt?.id, draft?.sourceHash]);
  const ownEditor=useRef<CoinDetailsControls>(null),editor=editorControls??ownEditor;
  const launchButton=useRef<HTMLButtonElement>(null),handledCommand=useRef<string|undefined>(undefined);
  const [image,setImage]=useState<CoinEditorImage>();
  const [imageBusy,setImageBusy]=useState(false);
  const [pairPending,setPairPending]=useState(false);
  const imageStatus=useCallback((busy:boolean)=>{setImageBusy(busy);onImageBusy?.(busy);},[onImageBusy]);
  const reviewedSourceHash = !pendingChange && draft?.compiled && draft.validation?.status === "passed"
    && draft.verification?.status === "passed" && draft.verification.sourceHash === draft.sourceHash
    && intentMatchesCandidate(intent, draft) ? draft.sourceHash : undefined;
  const launch = useCustomAILaunch({ settings: editingSettings, draftId, reviewedSourceHash, image: image?.blob, imageReceipt, headers, localPreview, readyTicket: preparation?.inputKey === preparationKey && preparation?.revision === draft?.sourceHash ? preparation?.ticket : undefined });
  const savedSession = launch.saved?.session;
  const bound = savedSession && savedSession.draftId===draftId ? savedSession : undefined;
  const otherLaunch = launch.saved && !bound && launch.saved.session.state!=="confirmed" ? launch.saved.session : undefined;
  const settings: CoinSetup = useMemo(() => bound ? { ...editingSettings, name: bound.settings.name, symbol: bound.settings.symbol,
    chainId: bound.chainId, initialBuy: bound.settings.initialBuy,
    pairToken: bound.settings.quote.toLowerCase() === setupQuoteAddress({ ...editingSettings, chainId: bound.chainId, pairToken: "ETH" }).toLowerCase() ? "ETH" : bound.settings.quote } : editingSettings, [bound, editingSettings]);
  const imageURL = bound?.settings.imageURI ?? imageReceipt?.url ?? image?.url;
  useEffect(() => { onLaunchLocked(launch.locked); }, [launch.locked, onLaunchLocked]);
  const readiness = designReadiness({ sourceHash: draft?.sourceHash, checked: Boolean(reviewedSourceHash), pendingChange, pairPending, openRequirements: intent ? intentHasOpenParts(intent) : false,
    name: settings.name, symbol: settings.symbol, image: Boolean(imageURL), connected: Boolean(account) });
  useEffect(() => {
    if (localPreview || !account || !draftId || !reviewedSourceHash || !imageReceipt || disabled || pairPending || launch.locked || !editingSettings.name.trim() || !editingSettings.symbol.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreparation({ state: "working", message: "Preparing your launch…", revision: reviewedSourceHash, inputKey: preparationKey, expiresAt: 0 });
      void aiRequest<LaunchPreparation>("/readiness", () => headersRef.current(), { draftId, account, imageId: imageReceipt.id,
        settings: { name: editingSettings.name, symbol: editingSettings.symbol, chainId: editingSettings.chainId,
          quote: setupQuoteAddress(editingSettings), initialBuy: editingSettings.initialBuy, imageURI: imageReceipt.url } }, controller.signal)
        .then(result => setPreparation({ ...result, inputKey: preparationKey })).catch(error => { if (!controller.signal.aborted) setPreparation({ state: "blocked", message: error instanceof Error ? error.message : "The launch preparation could not finish.", revision: reviewedSourceHash, inputKey: preparationKey, expiresAt: 0 }); });
    }, 750);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [localPreview, account, draftId, reviewedSourceHash, imageReceipt, disabled, pairPending, launch.locked, editingSettings, preparationKey]);
  useEffect(() => {
    if (preparation?.state !== "ready") return;
    const timer = setTimeout(() => setPreparation(current => current === preparation ? undefined : current), Math.max(0, preparation.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preparation]);
  const currentPreparation = preparation?.inputKey === preparationKey && preparation?.revision === reviewedSourceHash ? preparation : undefined;
  const summary = draft?.validation?.status === "passed" ? draft.hookSummary : undefined;
  const missingField = readiness.missingFields?.[0];
  const missingLabel = missingField ? { name: "Add coin name", symbol: "Add ticker", image: "Add coin image" }[missingField] : undefined;
  const addMissingDetail=useCallback(()=>{if(missingField)editor.current?.focus(missingField);},[missingField,editor]);
  useEffect(()=>{
    if(!launchCommand||handledCommand.current===launchCommand.id||launchCommand.sourceId!==draftId||disabled||imageBusy||pairPending||otherLaunch||launch.busy||!launch.loaded)return;
    handledCommand.current=launchCommand.id;
    launchButton.current?.scrollIntoView({block:"nearest"});launchButton.current?.focus();
    if(missingField){addMissingDetail();return;}
    if(!localPreview&&reviewedSourceHash&&readiness.state==="design-ready"&&!bound)void launch.prepare();
  },[launchCommand,draftId,disabled,imageBusy,pairPending,otherLaunch,launch,missingField,addMissingDetail,localPreview,reviewedSourceHash,readiness.state,bound]);

  return <aside className={styles.coinPanel} aria-label="Coin preview and details">
    <CoinDetails settings={settings} onChange={onChange} chatRevision={chatRevision} disabled={disabled||launch.locked||launch.busy}
      headers={headers} localPreview={localPreview} cacheKey={cacheKey} imageReceipt={imageReceipt} onImageReceipt={onImageReceipt}
      onImage={setImage} onImageBusy={imageStatus} onPairPending={setPairPending} controlsRef={editor} stage={bound?.state==="confirmed"?"Published coin":reviewedSourceHash?"Checked draft":"Coin preview"}
      imageURI={bound?.settings.imageURI} summary={summary} description={bound?.description}/>
    {otherLaunch&&<section className={styles.coinForm} aria-label="Saved launch recovery">
      <p className={styles.note}>Finish the saved launch for {otherLaunch.settings.name} before starting this coin.</p>
      <button type="button" className={styles.createButton} disabled={disabled||launch.busy} onClick={()=>{void launch.proceed();}}>{launch.label}<ArrowRight size={16} aria-hidden="true" /></button>
      {launch.message&&<p className={styles.note} role="status">{launch.message}</p>}
      {launch.error&&<p className={styles.error} role="alert">{launch.error}</p>}
    </section>}
    {!otherLaunch&&(bound || draft || Boolean(intent?.requirements.length)) && <form className={styles.coinForm} onSubmit={event=>event.preventDefault()}>
      {!bound && <RuleReview draft={draft} intent={intent} pendingChange={pendingChange} reviewed={Boolean(reviewedSourceHash)} disabled={disabled}
        quoteLabel={settings.pairToken==="ETH" ? "ETH" : "pair tokens"}
        onReview={() => undefined} onKeepRules={onKeepRules} onEditRule={onEditRule} />}
      {!bound && <p className={`${styles.note} ${styles.preparationStatus}`} role="status">{currentPreparation?.message ?? readiness.message}</p>}
      {bound?.quoteNotice && <p className={styles.note}>{bound.quoteNotice}</p>}
      <button ref={launchButton} type="button" className={styles.createButton} disabled={disabled || imageBusy || !bound && pairPending || launch.busy
        || !missingField && (localPreview || !bound && readiness.state !== "design-ready")}
        onClick={() => { if (!bound && missingField) addMissingDetail(); else if (bound?.state === "confirmed") { if (launch.startAnother()) onStartAnother(); } else void launch.proceed(); }}>
        {!bound && missingLabel ? missingLabel : bound?.state === "confirmed" ? "Create another coin" : launch.label}<ArrowRight size={16} aria-hidden="true" /></button>
      {launch.message && <p className={styles.note} role="status">{launch.message}</p>}
      {bound?.state === "confirmed" && bound.token && <a href={`/token/${bound.token}?chain=${bound.chainId}`} className={styles.note}>View {bound.settings.name}</a>}
      {launch.error && <p className={styles.error} role="alert">{launch.error}</p>}
    </form>}
    {children}
  </aside>;
}
