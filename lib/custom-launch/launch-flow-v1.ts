import type { LaunchPlanRecordV1, LaunchWalletStepV1 } from "./launch-plan-v1";
import type { Hex } from "viem";

export type LaunchFlowStepV1 = { id: string; label: string; status: LaunchWalletStepV1["status"]; stamp: boolean };
export const isLaunchStampStepV1 = (record: LaunchPlanRecordV1, actionIds: readonly string[]) => actionIds.some(id =>
  id === "platform:stampPlanV1" || record.plan.executor === "atomic_execute_and_stamp_v2" && id === "platform:executeAndStampV2"
  || record.plan.actions.some(action => action.actionId === id && action.authority.kind === "platform"));

/** The V1 stamp is created later by the issuer, but is part of the launch from its first review. */
export function launchFlowStepsV1(record: LaunchPlanRecordV1): LaunchFlowStepV1[] {
  if (record.plan.executor === "atomic_execute_and_stamp_v2") return record.steps.length
    ? record.steps.map(step => ({ id: step.stepId, label: "Launch and Programmable Stamp", status: step.status, stamp: true }))
    : [{ id: "platform:executeAndStampV2", label: "Launch and Programmable Stamp", status: "pending", stamp: true }];
  const label = (ids: readonly string[]) => {
    if (isLaunchStampStepV1(record, ids)) return "Programmable Stamp";
    const action = record.plan.actions.find(item => ids.includes(item.actionId));
    if (action?.kind === "deployEoaCreate" || action?.kind === "deployCreate" || action?.kind === "deployCreate2") return `Deploy ${action.componentId}`;
    if (action?.kind === "initializePool") return "Create market";
    if (action?.kind === "provideLiquidity") return "Add liquidity";
    return "Set up contracts";
  };
  const rows = record.steps.map(step => ({ id: step.stepId, label: label(step.actionIds), status: step.status, stamp: isLaunchStampStepV1(record, step.actionIds) }));
  if (!rows.length) {
    const calls = record.plan.actions.filter(action => action.authority.kind === "controller" && "execution" in action);
    rows.push(...calls.map(action => ({ id: action.actionId, label: label([action.actionId]), status: "pending" as const, stamp: false })));
  }
  if (!rows.some(row => row.stamp)) rows.push({ id: "platform:stampPlanV1", label: "Programmable Stamp", status: "pending", stamp: true });
  return rows;
}

export function launchFlowStateV1(record: LaunchPlanRecordV1): { title: string; description: string; terminal: boolean } {
  const atomic = record.plan.executor === "atomic_execute_and_stamp_v2";
  if (["final", "source_verified", "indexed", "publicly_visible"].includes(record.status)) return {
    title: "Confirming website indexing", description: "Your launch is final onchain. Programmable is checking the saved website record before opening your program.", terminal: true,
  };
  if (record.status === "expired") return { title: "Preparation expired", description: "Ask your bot to replan this launch using its existing completed steps. Keep this launch ID and every transaction receipt; completed deployments must be reused.", terminal: false };
  if (record.steps.some(step => step.status === "failed") || record.status === "action_required") return {
    title: "Launch needs attention", description: "Read the launch finding below and return it to the bot. Keep the current launch and completed transactions when preparing its successor.", terminal: false,
  };
  const waiting = record.steps.find(step => step.status === "broadcast" || step.status === "mined");
  if (waiting) return { title: waiting.status === "mined" ? "Waiting for finality" : "Transaction submitted", description: atomic
    ? "Tracking your combined launch and Stamp automatically. Your program opens after independent finality and website indexing."
    : "Tracking continues automatically. The next wallet step becomes available after this transaction is independently final.", terminal: false };
  const ready = record.steps.find(step => step.status === "wallet_action_ready");
  if (ready) return { title: !atomic && isLaunchStampStepV1(record, ready.actionIds) ? "Stamp ready to confirm" : "Ready to launch", description: atomic
    ? "One wallet transaction completes the project calls and Programmable Stamp together. Check the wallet and current cost before confirming."
    : "Check the wallet and current cost, then confirm this step in your wallet.", terminal: false };
  if (atomic && record.steps.length && record.steps.every(step => step.status === "final")) return {
    title: "Confirming launch evidence", description: "The combined transaction is final. Programmable is reconciling its launch and Stamp evidence before website indexing.", terminal: false,
  };
  if (record.steps.length && record.steps.every(step => step.status === "final")) return { title: "Preparing your Stamp", description: "Your contract steps are final. The issuer is preparing the bound Programmable Stamp. Keep this page or reopen the same launch link.", terminal: false };
  return { title: "Preparing your launch", description: "Programmable is checking the source and exact execution bytes. Your next wallet step will appear here automatically.", terminal: false };
}

/** A saved hash outranks a lagging ready response for presentation only. It never supplies
 * finality, changes original plan bytes, or grants permission to send again. */
export function launchFlowPresentationV1(record: LaunchPlanRecordV1, submission?: {
  stepId: string; transactionDigest: string; transactionHash: Hex | null;
} | null) {
  const pending = submission?.transactionHash && record.steps.find(step => step.stepId === submission.stepId
    && step.transactionDigest === submission.transactionDigest && ["pending", "wallet_action_ready"].includes(step.status));
  const view = pending && !["final", "source_verified", "indexed", "publicly_visible", "action_required"].includes(record.status)
    ? { ...record, status: "broadcast" as const, steps: record.steps.map(step => step === pending
      ? { ...step, status: "broadcast" as const, transactionHash: submission!.transactionHash } : step) } : record;
  return { steps: launchFlowStepsV1(view), state: launchFlowStateV1(view) };
}
