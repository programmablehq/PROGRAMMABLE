"use client";
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
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
import styles from "./workspace.module.css";
const GeneralLaunchWallet = lazy(() => import("./general-launch-wallet"));

function currentStatusMessage(status: string): string {
  if (["pending_review", "review_pending", "awaiting_review"].includes(status)) return "Your submission is waiting for review.";
  if (["action_required", "needs_changes", "changes_requested"].includes(status)) return "Your submission needs an update. Open its details to continue.";
  if (["authorized", "launch_ready", "wallet_action_ready", "awaiting_wallet_signature", "reserved"].includes(status)) return "Your submission has wallet steps to review.";
  if (["submitted", "broadcast", "confirming", "finality_pending"].includes(status)) return "Waiting for the transaction to confirm.";
  if (["completed", "confirmed", "final", "finalized", "source_verified", "indexed", "publicly_visible"].includes(status)) return "Your launch transactions are confirmed. Open the submission for source verification and Explore status.";
  if (status === "expired") return "This submission expired. Open its details to continue.";
  if (["failed", "rejected", "cancelled"].includes(status)) return "Open this submission to see its next step.";
  return "Your launch preparation is in progress.";
}

export function GeneralLaunchControls({ enabled, account, conversationId, scope, headers, project, intent, draftId, settings,
  imageId, disabled, pendingChange, editor, flush, onLaunchLocked }: {
  enabled: boolean; account: string; conversationId?: string; scope: string; headers: AISessionHeaders;
  project?: GeneralProjectView; intent?: LaunchIntent; draftId?: string; settings: CoinSetup;
  imageId?: string; disabled: boolean; pendingChange?: string; editor: RefObject<CoinDetailsControls | null>;
  flush: () => Promise<{ revision: number } | undefined>; onLaunchLocked: (locked: boolean) => void;
}) {
  const launch = useGeneralLaunch({ enabled, account, scope, headers });
  const controllerKey = `${scope}:${account.toLowerCase()}`;
  const [controller, setController] = useState({ key: controllerKey, kind: "" });
  const controllerKind = controller.key === controllerKey ? controller.kind : "";
  useEffect(() => { onLaunchLocked(launch.locked); return () => onLaunchLocked(false); }, [launch.locked, onLaunchLocked]);
  const saved = launch.preparation, sameSource = saved && saved.conversationId === conversationId && saved.sourceId === draftId
    && saved.projectHash === project?.projectHash && saved.artifactHash === project?.artifactHash && saved.chainId === settings.chainId
    && sameGeneralEditor(saved, settings, imageId) && !pendingChange;
  const uncertain = Boolean(launch.unconfirmedId || saved?.submission && saved.submission.state !== "completed");
  const href = saved ? generalSubmissionUrl(saved) : undefined, accepted = Boolean(sameSource && href);
  const history = href && !accepted ? saved : !href ? launch.previousSubmission : undefined;
  const historyHref = history ? generalSubmissionUrl(history) : undefined;
  let walletSubject: GeneralWalletSubject | undefined;
  try { if (accepted && saved && launch.currentStatus) walletSubject = generalWalletSubject(saved, launch.currentStatus); }
  catch { /* Keep the original submission link. A mismatched status cannot open a wallet step. */ }
  const complete = project?.compiled && project.scenarios?.passed && project.chainId === settings.chainId
    && intent && project.intentRevision === intent.revision && !intentHasOpenParts(intent) && !pendingChange;
  const detail = generalLaunchDetailIssue(settings, Boolean(imageId));
  const warmed = useRef<string | undefined>(undefined);
  const warmKey = JSON.stringify([scope, account.toLowerCase(), conversationId, draftId, project?.projectHash,
    project?.artifactHash, intent?.revision, settings, imageId, controllerKind]);
  useEffect(() => {
    if (!enabled || !launch.loaded || launch.busy || uncertain || accepted || disabled || detail || !complete
      || !project || !intent || !draftId || !conversationId || warmed.current === warmKey
      || settings.chainId === 4663 && controllerKind !== "eoa") return;
    warmed.current = warmKey;
    void launch.prepare(async signal => {
      const studio = await flush(); signal.throwIfAborted();
      if (!studio || studio.revision < 1) throw Error("Save this design before preparing its launch.");
      return { selection: { id: draftId, account, conversation: conversationId, studioRevision: studio.revision,
        chainId: settings.chainId, projectHash: project.projectHash, artifactHash: project.artifactHash, intentRevision: intent.revision },
        ...(settings.chainId === 4663 ? { controllerKind: "eoa" as const } : {}) };
    });
  }, [enabled, launch, uncertain, accepted, disabled, detail, complete, project, intent, draftId, conversationId,
    warmKey, flush, account, settings.chainId, controllerKind]);
  if (!enabled) return null;
  const detailLabel = detail ? { name: "Add coin name", symbol: "Add ticker", image: "Add coin image", description: "Add description", website: "Add project link", x: "Add X link" }[detail.field] : "";
  const checking = saved?.submission?.state === "sending";
  const label = !launch.loaded ? "Check saved submission" : uncertain ? checking ? "Check submission" : "Recover submission"
    : detail ? detailLabel : "Submit for review";
  const busyLabel = launch.phase === "warming" ? "Preparing launch…" : launch.phase === "preparing" ? "Preparing submission…" : launch.phase === "submitting" ? "Submitting…" : "Checking saved submission…";
  let status = launch.phase !== "idle" ? busyLabel : !launch.loaded ? "Your saved submission has not been checked yet."
    : uncertain ? "The original submission is saved. Check its result before starting another one."
    : accepted ? launch.currentStatus ? currentStatusMessage(launch.currentStatus.status) : "Submission received. Open it to see its review and wallet steps."
    : detail ? detail.message : !complete ? "Finish the saved contract design in the chat before submitting it."
    : "Submit this saved design for launch review.";
  if (saved && (uncertain || href) && !sameSource) status = `Saved submission: ${saved.coin?.name ?? "your previous coin"} on ${builderChain(saved.chainId).name}. ${status}`;

  async function proceed() {
    if (launch.busy || disabled) return;
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
  }

  return <section className={styles.generalLaunch} aria-label="Launch submission" aria-busy={launch.busy}>
    <p className={styles.note} role="status">{status}</p>
    {!uncertain && !accepted && settings.chainId === 4663 && <label className={styles.controllerChoice}>Launch wallet type
      <select value={controllerKind} disabled={disabled || launch.busy} onChange={event => setController({ key: controllerKey, kind: event.target.value })}>
        <option value="">Choose wallet type</option><option value="eoa">Standard wallet</option><option value="smart">Smart account</option>
      </select>
      {controllerKind === "smart" && <span>Smart account preparation for this design is not available yet.</span>}
    </label>}
    {accepted ? <a className={walletSubject ? styles.textButton : styles.createButton} href={href}>Open submission<ArrowRight size={16} aria-hidden="true" /></a>
      : <button type="button" className={styles.createButton} onClick={() => { void proceed(); }}
        aria-disabled={launch.busy || disabled || launch.loaded && !uncertain && !detail && (!complete || !conversationId || settings.chainId === 4663 && controllerKind !== "eoa")}
        disabled={disabled || launch.loaded && !uncertain && !detail && (!complete || !conversationId || settings.chainId === 4663 && controllerKind !== "eoa")}>
        {launch.busy ? busyLabel : label}<ArrowRight size={16} aria-hidden="true" /></button>}
    {!accepted && !uncertain && <p className={styles.note}>Submitting publishes this contract’s source. Wallet signatures and transactions are confirmed separately.</p>}
    {historyHref && <a className={styles.textButton} href={historyHref}>Open {history?.coin?.name ?? "previous"} submission</a>}
    {walletSubject && <Suspense fallback={<p className={styles.note} role="status">Loading launch controls…</p>}>
      <GeneralLaunchWallet key={JSON.stringify([scope, account.toLowerCase(), walletSubject.chainId, walletSubject.resourceId, walletSubject.requestHash])}
        subject={walletSubject} name={saved?.coin?.name ?? "Your saved coin"} headers={headers} disabled={disabled || launch.busy} onStatus={() => launch.refreshStatus()} />
    </Suspense>}
    {href && <button type="button" className={styles.textButton} disabled={launch.busy} onClick={() => { void launch.refreshStatus(); }}>Check current status</button>}
    {launch.statusError && <p className={styles.note} role="status">The current status could not be refreshed. Your saved submission is still available.</p>}
    {launch.error && <p className={styles.error} role="alert">{launch.error}</p>}
  </section>;
}
