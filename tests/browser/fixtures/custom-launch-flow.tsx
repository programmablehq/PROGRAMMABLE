import { createRoot } from "react-dom/client";
import { DeveloperUniversalLaunchHistory } from "../../../components/developer-universal-launch-history";
import { beginLaunchSendV1, rejectLaunchSendV1, rememberLaunchHashV1 } from "../../../lib/custom-launch/launch-send-journal-v1";
import { canonicalBrowserSha256V2 as digest } from "../../../lib/custom-launch/browser-authority-v2";
import type { UniversalLaunchWalletInputV1, UniversalLaunchWalletReviewV1 } from "../../../lib/custom-launch/wallet-handoff-plan-v1";
import type { LaunchPlanRecordV1, LaunchWalletStepV1 } from "../../../lib/custom-launch/launch-plan-v1";
import { verifyAtomicWalletReviewV2 } from "../../../lib/custom-launch/atomic-wallet-review-v2";
import { atomicBindingFixture, atomicRecordFixture } from "../../fixtures/atomic-launch-v2";
import { bindStep, component, controller, hash, projectionFixture, recordFixture, stamp } from "../../fixtures/universal-launch-v1";
import styles from "../../../components/developer-api-keys.module.css";
import "../../../app/globals.css";
import "../../../app/interface.css";
import "../../../app/programmable-experience.css";
import "../../../app/webde-final-ui.css";

// Deliberately local browser fixtures. These exercise the product components and durable journal,
// never production wallet authority or real onchain execution.
const mode = new URLSearchParams(window.location.search).get("scenario") ?? "ready";
const atomic = mode.startsWith("atomic");
const base = recordFixture();
// The API keeps each plan immutable. Reloading this fixture must preserve its exact budgets and calldata too.
const fixtureCreatedAtKey = "fixture:launch-created-at";
const savedCreatedAt = localStorage.getItem(fixtureCreatedAtKey);
const now = savedCreatedAt && /^[1-9][0-9]{0,11}$/.test(savedCreatedAt) ? Number(savedCreatedAt) : Math.floor(Date.now() / 1000);
localStorage.setItem(fixtureCreatedAtKey, String(now));
const plan = { ...base.plan, admissionPolicy: "programmable.custom-launch-policy.provenance.v1" as const, feeObligations: [],
  publication: { visibility: "listed" as const, name: "Open Signal", symbol: "SIGNAL", description: "An independent coin and hook prepared through your Programmable API key.", primaryComponentId: "settlement" },
  budgets: { ...base.plan.budgets, validAfter: String(now - 60), deadline: String(now + 3300) } };
const planHash = digest("programmable.custom-launch-plan.v1", plan);
let record: LaunchPlanRecordV1 = { ...base, plan, planHash, rawRequestSha256: planHash, updatedAt: new Date().toISOString(),
  steps: [bindStep({ ...base.steps[0], transaction: { ...base.steps[0].transaction, deadline: plan.budgets.deadline } })] };
if (atomic) record = atomicRecordFixture(record);
if (mode === "atomic-mismatch") record = { ...record, steps: [bindStep({ ...record.steps[0], transaction: { ...record.steps[0].transaction, to: component } })] };
const control = {
  mode, indexed: false, proofCalls: 0, navigated: "", requests: [] as { method: string; params: readonly unknown[] }[],
  sends: () => Number(localStorage.getItem("fixture:launch-sends") ?? 0),
  finalize: () => {
    const steps: LaunchWalletStepV1[] = record.steps.map(step => ({ ...step, status: "final", transactionHash: hash }));
    if (!atomic && !steps.some(step => step.actionIds.includes("platform:stampPlanV1"))) steps.push(bindStep({ ...record.steps[0],
      stepId: "stamp", actionIds: ["platform:stampPlanV1"], status: "final", transactionHash: hash,
      transaction: { ...record.steps[0].transaction, to: stamp, nonce: "8" } }));
    record = { ...record, status: "final", steps, updatedAt: new Date().toISOString() };
  },
  setIndexed: () => { control.indexed = true; },
};
declare global { interface Window { __customLaunchFixture: typeof control } }
window.__customLaunchFixture = control;
if (mode === "stamp") record = { ...record, steps: [ { ...record.steps[0], status: "final", transactionHash: hash },
  bindStep({ ...record.steps[0], stepId: "stamp", actionIds: ["platform:stampPlanV1"], transaction: { ...record.steps[0].transaction, nonce: "8" } }) ] };
if (mode === "issuer") record = { ...record, status: "analysis_pending", steps: [{ ...record.steps[0], status: "final", transactionHash: hash }] };
if (mode === "expired") record = { ...record, status: "expired", steps: record.steps.map(step => ({ ...step, status: "pending" })) };
if (mode === "finality") record = { ...record, status: "mined", steps: record.steps.map(step => ({ ...step, status: "mined", transactionHash: hash })) };
if (mode.startsWith("release-change")) record = { ...record, steps: record.steps.map(step => ({ ...step, status: "pending" })),
  continuation: { schemaVersion: "programmable.custom-launch-plan-continuation.v1", status: "replan_required",
    originalManifestDigest: record.manifestDigest, currentManifestDigest: `sha256:${"bb".repeat(32)}`,
    replanUrl: `/v4/chains/4663/custom-launch-plans/${record.planId}:replan` } };
if (mode === "indexing" || mode === "atomic-indexing") control.finalize();

const review = (): UniversalLaunchWalletReviewV1 => {
  const step = record.steps.find(row => row.status === "wallet_action_ready") ?? record.steps[0];
  const decodedOperation = atomic ? verifyAtomicWalletReviewV2(record, step, atomicBindingFixture(record), BigInt(Math.floor(Date.now() / 1000))) : undefined;
  return { sourceVersion: "custom_launch_plan_v1", launchId: record.planId, stepId: step.stepId, binding: step.transactionDigest, controllerKind: "eoa",
    transaction: { chainId: "0x1237", from: controller, ...(step.transaction.to ? { to: step.transaction.to } : {}), data: step.transaction.data, value: "0x0",
      gas: `0x${BigInt(step.transaction.gasLimit).toString(16)}`, nonce: `0x${BigInt(step.transaction.nonce).toString(16)}` },
    valueWei: "0", maxGasCostWei: "21000000000000", deadline: plan.budgets.deadline, preconditions: [], postconditions: [], ...(decodedOperation ? { decodedOperation } : {}) };
};
if (["unknown", "release-change-unknown", "release-change-known"].includes(mode)
  && !localStorage.getItem(`programmable:custom-launch-send:v1:4663:${controller}`)) {
  const attempt = beginLaunchSendV1(review());
  if (mode === "release-change-known") rememberLaunchHashV1(attempt, hash);
}

window.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  if (url.pathname.includes("custom-launch-capabilities")) return Response.json({ fixture: true });
  if (url.pathname.includes("/proofs")) { control.proofCalls += 1; return control.mode === "tracking-error" ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ fixture: "proof recorded" }); }
  if (url.pathname.startsWith("/api/launch-projections/")) {
    if (!control.indexed) return Response.json({ schemaVersion: "programmable.website-indexed-launch.v1", status: "pending" }, { status: 202 });
    const projection = { ...projectionFixture(), planHash: record.planHash, manifestDigest: record.manifestDigest, publication: plan.publication };
    return Response.json({ schemaVersion: "programmable.website-indexed-launch.v1", status: "indexed", projection, href: `/token/${component}?chain=4663` });
  }
  if (url.pathname.startsWith("/api/developer/custom-launch-plans")) {
    if (mode === "api-error") return Response.json({ error: "temporarily unavailable" }, { status: 503 });
    if (url.searchParams.get("source") === "multi_role_v2") return Response.json({ schemaVersion: "programmable.website-launch-history.v1", launches: [], nextCursor: null });
    return Response.json({ schemaVersion: "programmable.website-launch-history.v1", launches: [{ sourceVersion: "custom_launch_plan_v1", controller, resource: record }], nextCursor: null });
  }
  throw new Error(`Unbound browser fixture request ${url.pathname}`);
};
async function sendWallet(input: UniversalLaunchWalletInputV1) {
  if (mode === "wrong-chain" && input.action === "review") throw new Error("Connect the exact controller account on Robinhood Chain before continuing.");
  if (input.action === "review" || input.action === "switch_chain") return review();
  if (input.action === "recover") {
    if (input.recoveryHash !== hash) throw new Error("This transaction does not match the saved launch call and nonce.");
    rememberLaunchHashV1(JSON.parse(localStorage.getItem(`programmable:custom-launch-send:v1:4663:${controller}`)!), hash);
    record = { ...record, status: "broadcast", steps: record.steps.map(step => ({ ...step, status: "broadcast", transactionHash: hash })), updatedAt: new Date().toISOString() };
    return hash;
  }
  const attempt = beginLaunchSendV1(review());
  control.requests.push({ method: "eth_sendTransaction", params: [attempt.transaction] });
  localStorage.setItem("fixture:launch-sends", String(control.sends() + 1));
  if (mode === "rejected") { const error = { code: 4001, message: "Wallet confirmation was cancelled. You can review the same launch again." }; rejectLaunchSendV1(attempt, error); throw new Error(error.message); }
  if (mode === "lost-response") throw new Error("The wallet response was interrupted. Recover the original transaction.");
  rememberLaunchHashV1(attempt, hash);
  record = { ...record, status: "broadcast", steps: record.steps.map(step => ({ ...step, status: "broadcast", transactionHash: hash })), updatedAt: new Date().toISOString() };
  return hash;
}
createRoot(document.getElementById("root")!).render(<main className={`${styles.page} page-width`}><header className={styles.hero}><div><p style={{ color: "var(--webde-muted)", fontSize: 12 }}>Local QA fixture · no real wallet or funds</p><h1>Launch history</h1><p className={styles.intro}>Track progress and complete your wallet steps.</p></div></header>
  <DeveloperUniversalLaunchHistory account={controller} initialLaunchId={record.planId} getAccessToken={async () => "fixture-session"} getIdentityToken={async () => null} sendWallet={sendWallet} /></main>);
