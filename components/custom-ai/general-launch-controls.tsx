"use client";
import { lazy, Suspense, useCallback, useEffect, useRef, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import type { CoinSetup } from "@/lib/custom-ai/coin-setup";
import { builderChain } from "@/lib/custom-ai/execution-routing";
import { generalLaunchDetailIssue } from "@/lib/custom-ai/general-details";
import { generalSubmissionUrl, sameGeneralEditor } from "@/lib/custom-ai/general-preparation";
import { generalWalletSubject, type GeneralWalletSubject } from "@/lib/custom-ai/general-wallet";
import { intentHasOpenParts, type LaunchIntent } from "@/lib/custom-ai/launch-intent";
import type { GeneralProjectView } from "@/lib/custom-ai/project-view";
import type { CoinDetailsControls } from "./coin-details";
import { useGeneralLaunch } from "./use-general-launch";
import { Disclosure } from "@/components/disclosure";
import styles from "./workspace.module.css";
const GeneralLaunchWallet = lazy(() => import("./general-launch-wallet"));
const ProductRuntimePanel=lazy(()=>import("./product-runtime"));

function currentStatusMessage(status: string, automaticApproved: boolean): string {
  if (["pending_review", "review_pending", "awaiting_review"].includes(status)) return automaticApproved
    ? "Automatic checks passed. Continue to prepare your wallet step."
    : "Preparing your coin for launch.";
  if (["action_required", "needs_changes", "changes_requested"].includes(status)) return "Your coin needs an update. Open the details to continue.";
  if (["authorized", "launch_ready", "wallet_action_ready", "awaiting_wallet_signature", "reserved"].includes(status)) return "Review the next step in your wallet.";
  if (["submitted", "broadcast", "confirming", "finality_pending"].includes(status)) return "Waiting for the transaction to confirm.";
  if (["completed", "confirmed", "final", "finalized", "source_verified", "indexed", "publicly_visible"].includes(status)) return "Your launch transactions are confirmed. Open the launch for verification and Explore status.";
  if (status === "expired") return "This launch request expired. Open its details to continue.";
  if (["failed", "rejected", "cancelled"].includes(status)) return "Open this launch to see its next step.";
  return "Preparing your launch.";
}

export function GeneralLaunchControls({ enabled, account, conversationId, scope, headers, project, intent, draftId, settings,
  imageId, disabled, pendingChange, editor, flush, onLaunchLocked, launchCommand, summarized=false,onLaunchResolved }: {
  enabled: boolean; account: string; conversationId?: string; scope: string; headers: AISessionHeaders;
  project?: GeneralProjectView; intent?: LaunchIntent; draftId?: string; settings: CoinSetup;
  imageId?: string; disabled: boolean; pendingChange?: string; editor: RefObject<CoinDetailsControls | null>;
  flush: () => Promise<{ revision: number } | undefined>; onLaunchLocked: (locked: boolean) => void;
  launchCommand?:{id:string;sourceId:string};
  summarized?: boolean;
  onLaunchResolved?:(sourceId:string)=>void;
}) {
  const launch = useGeneralLaunch({ enabled, account, scope, headers, observedSource: {
    conversationId, sourceId: draftId, projectHash: project?.projectHash, artifactHash: project?.artifactHash, chainId: settings.chainId,
  } });
  // The backend checks the actual controller code. Wallet classification is
  // not a form choice for the person creating a coin.
  const controllerKind = "eoa";
  const handledCommand=useRef<string|undefined>(undefined);
  useEffect(() => { onLaunchLocked(launch.locked); return () => onLaunchLocked(false); }, [launch.locked, onLaunchLocked]);
  const saved = launch.preparation, sameSource = saved && saved.conversationId === conversationId && saved.sourceId === draftId
    && saved.projectHash === project?.projectHash && saved.artifactHash === project?.artifactHash && saved.chainId === settings.chainId
    && sameGeneralEditor(saved, settings, imageId) && !pendingChange;
  const uncertain = Boolean(launch.unconfirmedId || saved?.submission && saved.submission.state !== "completed");
  const href = saved ? generalSubmissionUrl(saved) : undefined, accepted = Boolean(sameSource && href);
  const history = href && !accepted ? saved : !href ? launch.previousSubmission : undefined;
  const historyHref = history ? generalSubmissionUrl(history) : undefined;
  useEffect(()=>{
    if(accepted&&draftId&&["completed","confirmed","final","finalized","source_verified","indexed","publicly_visible"].includes(launch.currentStatus?.status??""))onLaunchResolved?.(draftId);
  },[accepted,draftId,launch.currentStatus?.status,onLaunchResolved]);
  let walletSubject: GeneralWalletSubject | undefined;
  try { if (accepted && saved && launch.currentStatus) walletSubject = generalWalletSubject(saved, launch.currentStatus); }
  catch { /* Keep the original submission link. A mismatched status cannot open a wallet step. */ }
  const complete = project?.coinPreparation?.eligible === true && project.compiled && project.scenarios?.passed && project.sourceReview === "passed" && project.chainId === settings.chainId
    && intent && project.intentRevision === intent.revision && !intentHasOpenParts(intent) && !pendingChange;
  const detail = generalLaunchDetailIssue(settings, Boolean(imageId));
  const warmed = useRef<string | undefined>(undefined);
  const warmKey = JSON.stringify([scope, account.toLowerCase(), conversationId, draftId, project?.projectHash,
    project?.artifactHash, intent?.revision, settings, imageId, controllerKind]);
  useEffect(() => {
    if (!enabled || !launch.loaded || launch.busy || uncertain || accepted || disabled || detail || !complete
      || !project || !intent || !draftId || !conversationId || warmed.current === warmKey
      || sameSource && saved?.packState === "complete" && saved.expiresAt > Date.now() + 5000
      || settings.chainId === 4663 && controllerKind !== "eoa") return;
    // Let a short burst of editing settle before packaging the latest values.
    // An explicit launch proceeds immediately and cancels this background work.
    const timer = setTimeout(() => {
      warmed.current = warmKey;
      void launch.prepare(async signal => {
        const studio = await flush(); signal.throwIfAborted();
        if (!studio || studio.revision < 1) throw Error("Save this design before preparing its launch.");
        return { selection: { id: draftId, account, conversation: conversationId, studioRevision: studio.revision,
          chainId: settings.chainId, projectHash: project.projectHash, artifactHash: project.artifactHash, intentRevision: intent.revision },
          ...(settings.chainId === 4663 ? { controllerKind: "eoa" as const } : {}) };
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [enabled, launch, uncertain, accepted, disabled, detail, complete, project, intent, draftId, conversationId,
    warmKey, flush, account, settings.chainId, controllerKind, sameSource, saved]);
  const detailLabel = detail ? { name: "Add coin name", symbol: "Add ticker", image: "Add coin image", initialBuy: "Check initial buy", description: "Add description", website: "Add project link", x: "Add X profile", socialPost: "Check X post link" }[detail.field] : "";
  const checking = saved?.submission?.state === "sending";
  const label = !launch.loaded ? "Check saved submission" : uncertain ? checking ? "Check submission" : "Recover submission"
    : detail ? detailLabel : "Launch coin";
  const busyLabel = launch.phase === "warming" ? "Preparing launch…" : launch.phase === "preparing" ? "Preparing launch…" : launch.phase === "submitting" ? "Submitting…" : "Checking saved launch…";
  let status = launch.phase !== "idle" ? busyLabel : !launch.loaded ? "Loading your saved launch…"
    : uncertain ? "Your earlier launch is saved. Check its result before starting another."
    : accepted ? launch.automatic?.state==="changes_required"?"Make the correction shown below in the chat."
      :launch.automatic?.state==="interrupted"?"The check stopped. Continue your saved launch."
        :launch.currentStatus ? currentStatusMessage(launch.currentStatus.status, launch.automatic?.state === "approved") : "Your coin is saved. Preparing the launch."
    : project?.sourceReview==="changes_required" ? "Ask the chat to make the correction."
    : detail ? detail.message : !complete ? "Finish your coin in the chat before launching."
    : "Your coin is built. Continue to launch.";
  if (saved && uncertain && !sameSource) status = `Saved submission: ${saved.coin?.name ?? "your previous coin"} on ${builderChain(saved.chainId).name}. ${status}`;

  const proceed=useCallback(async()=>{
    if (launch.busy || disabled) return;
    if(accepted){if(["interrupted","not_started"].includes(launch.automatic?.state??""))await launch.check();else await launch.refreshStatus();return;}
    if (!launch.loaded || checking) { await launch.refresh(); return; }
    if (uncertain) { await launch.recover(); return; }
    if (detail) { editor.current?.focus(detail.field); return; }
    if (!complete || !project || !intent || !draftId || !conversationId) return;
    await launch.submit(async signal => {
      const studio = await flush(); signal.throwIfAborted();
      if (!studio || studio.revision < 1) throw Error("Save the current chat before submitting this design.");
      return { selection: { id: draftId, account, conversation: conversationId, studioRevision: studio.revision,
        chainId: settings.chainId, projectHash: project.projectHash, artifactHash: project.artifactHash, intentRevision: intent.revision },
        ...(settings.chainId === 4663 ? { controllerKind: "eoa" as const } : {}) };
    });
  },[launch,disabled,accepted,checking,uncertain,detail,editor,complete,project,intent,draftId,conversationId,flush,settings.chainId,account]);
  useEffect(()=>{
    if(!enabled||!launchCommand||handledCommand.current===launchCommand.id||launchCommand.sourceId!==draftId
      ||disabled||launch.busy||!launch.loaded||!complete)return;
    handledCommand.current=launchCommand.id;void proceed();
  },[enabled,launchCommand,draftId,disabled,launch.busy,launch.loaded,complete,proceed]);
  if (!enabled) return null;
  if (!complete && !accepted && !uncertain) return <>
    {project?.coinPreparation?.missing.includes("coin-deployment") && <p className={styles.note} role="status">
      Source saved. A coin launch needs a token, hook, liquidity initializer and pool declaration.
    </p>}
    {historyHref && <Disclosure className={styles.previousSubmission}>
      <summary>Earlier submission</summary>
      <a className={styles.textButton} href={historyHref}>Open {history?.coin?.name ?? "previous"} submission</a>
    </Disclosure>}
  </>;

  return <section className={styles.generalLaunch} aria-label="Launch submission" aria-busy={launch.busy} hidden={summarized && !accepted && !uncertain}>
    <p className={styles.note} role="status">{status}</p>
    {accepted ? <a className={walletSubject ? styles.textButton : styles.createButton} href={href}>Open submission<ArrowRight size={16} aria-hidden="true" /></a>
      : <button type="button" className={styles.createButton} onClick={() => { void proceed(); }}
        aria-disabled={launch.busy || disabled || launch.loaded && !uncertain && !detail && (!complete || !conversationId || settings.chainId === 4663 && controllerKind !== "eoa")}
        disabled={disabled || launch.loaded && !uncertain && !detail && (!complete || !conversationId || settings.chainId === 4663 && controllerKind !== "eoa")}>
        {launch.busy ? busyLabel : label}<ArrowRight size={16} aria-hidden="true" /></button>}
    {!accepted && !uncertain && <p className={styles.note}>Publishing makes your contract code public. You confirm transactions in your wallet.</p>}
    {historyHref && <Disclosure className={styles.previousSubmission}>
      <summary>Earlier submission</summary>
      <a className={styles.textButton} href={historyHref}>Open {history?.coin?.name ?? "previous"} submission</a>
    </Disclosure>}
    {walletSubject && <Suspense fallback={<p className={styles.note} role="status">Loading launch controls…</p>}>
      <GeneralLaunchWallet key={JSON.stringify([scope, account.toLowerCase(), walletSubject.chainId, walletSubject.resourceId, walletSubject.requestHash])}
        subject={walletSubject} name={saved?.coin?.name ?? "Your saved coin"} headers={headers} disabled={disabled || launch.busy} onStatus={() => launch.refreshStatus()}
        preparing={walletSubject.chainId === 4663 && launch.currentStatus?.status === "analysis_pending"}
        prepareCommand={launch.automatic?.state==="approved"&&launchCommand&&launchCommand.sourceId===draftId?launchCommand.id:undefined} />
    </Suspense>}
    {accepted && href && <button type="button" className={styles.textButton} disabled={launch.busy} onClick={() => { void launch.refreshStatus(); }}>Check current status</button>}
    {accepted&&saved&&project?.implementation&&launch.currentStatus&&["completed","confirmed","final","finalized","source_verified","indexed","publicly_visible"].includes(launch.currentStatus.status)&&
      <Suspense fallback={null}><ProductRuntimePanel key={`${saved.id}:${account.toLowerCase()}`} preparationId={saved.id} sourceId={saved.sourceId}
        chainId={saved.chainId} headers={headers}/></Suspense>}
    {accepted&&["interrupted","not_started"].includes(launch.automatic?.state??"")&&<button type="button" className={styles.createButton}
      disabled={launch.busy||disabled} onClick={()=>{void launch.check();}}>Continue check<ArrowRight size={16} aria-hidden="true" /></button>}
    {accepted&&launch.automatic?.state==="changes_required"&&launch.automatic.findings.map(finding=><p className={styles.error} key={finding.code} role="status">{finding.message}</p>)}
    {launch.statusError && <p className={styles.note} role="status">The current status could not be refreshed. Your saved submission is still available.</p>}
    {launch.error && <p className={styles.error} role="alert">{launch.error}</p>}
  </section>;
}
