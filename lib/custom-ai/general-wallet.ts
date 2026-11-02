import { formatEther, type Hex } from "viem";
import type { LaunchResource } from "@/components/developer-launch-history";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import { customLaunchReviewAllowsSigning } from "@/lib/custom-launch-review";
import { customLaunchWalletHandoffExpiredV1 } from "@/lib/custom-launch/developer-launch-truth-v1";
import { prepareCustomLaunchRouterReviewV3, readCustomGraphFinalizedTransactionV3, type CustomLaunchRouterReviewV3 } from "@/lib/custom-launch/wallet-handoff-v3";
import { readLaunchPlanResourceV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import type { LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import { readGeneralLaunchStatus, type GeneralPreparationView, type GeneralLaunchStatus } from "./general-preparation";
import type { AISessionHeaders } from "./client";

export type GeneralWalletSubject = Readonly<{ chainId: 1 | 4663 | 8453 | 999; controller: string; resourceId: string;
  requestHash: `sha256:${string}`; rawRequestSha256: `sha256:${string}` | null; deadline: string }>;
export type GeneralWalletResource = { kind: "graph"; launch: LaunchResource } | { kind: "plan"; plan: LaunchPlanRecordV1 };
export type GeneralGraphWalletReview = Readonly<{ router: CustomLaunchRouterReviewV3; projectBinding: unknown }>;
const fail = (message = "The wallet step does not match your original saved submission."): never => { throw Error(message); };

export function generalWalletSubject(saved: GeneralPreparationView, status: GeneralLaunchStatus): GeneralWalletSubject {
  const id = saved.submission?.state === "completed" ? saved.submission.resourceId : undefined;
  if (!id || !saved.requestHash || saved.packState !== "complete") return fail();
  const checked = readGeneralLaunchStatus({ status }, { account: saved.account, chainId: saved.chainId, resourceId: id,
    requestHash: saved.requestHash, deadline: String(saved.expiresAt / 1000),reviewId:saved.submission?.reviewId,reviewSubjectHash:saved.submission?.reviewSubjectHash });
  return Object.freeze({ chainId: saved.chainId, controller: saved.account, resourceId: id, requestHash: checked.requestHash,
    rawRequestSha256: checked.rawRequestSha256, deadline: checked.deadline! });
}
export function generalWalletDetailUrl(subject: GeneralWalletSubject): string {
  if (![1, 4663, 8453, 999].includes(subject.chainId) || !/^0x[a-f0-9]{40}$/iu.test(subject.controller)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(subject.resourceId)
    || !/^sha256:[a-f0-9]{64}$/u.test(subject.requestHash)) return fail();
  const query = new URLSearchParams({ walletAddress: subject.controller, ...(subject.chainId === 4663 ? { source: "custom_launch_plan_v1" }
    : { version: "v3", ...(subject.chainId === 1 ? {} : { chainId: String(subject.chainId) }) }) });
  return `/api/developer/${subject.chainId === 4663 ? "custom-launch-plans" : "custom-launches"}/${subject.resourceId}?${query}`;
}
export async function readGeneralWalletResource(subject: GeneralWalletSubject, body: unknown): Promise<GeneralWalletResource> {
  generalWalletDetailUrl(subject);
  if (subject.chainId === 4663) {
    if (!body || typeof body !== "object") return fail();
    const wrapper = body as Record<string, unknown>, rows = wrapper.launches;
    if (wrapper.schemaVersion !== "programmable.website-launch-history.v1" || wrapper.nextCursor !== null || !Array.isArray(rows) || rows.length !== 1) return fail();
    const row = rows[0];
    if (!row || row.sourceVersion !== "custom_launch_plan_v1" || typeof row.controller !== "string" || row.controller.toLowerCase() !== subject.controller.toLowerCase()) return fail();
    const plan = readLaunchPlanResourceV1(row.resource);
    if (plan.planId !== subject.resourceId || plan.planHash !== subject.requestHash || plan.rawRequestSha256 !== subject.rawRequestSha256
      || plan.plan.controller.address.toLowerCase() !== subject.controller.toLowerCase() || plan.plan.budgets.deadline !== subject.deadline
      || !["accepted", "preflight_complete", "launch_ready", "action_required", "analysis_pending", "reserved", "wallet_action_ready", "broadcast", "mined", "final", "source_verified", "indexed", "publicly_visible", "expired"].includes(plan.status)
      || plan.steps.some(step => !["pending", "wallet_action_ready", "broadcast", "mined", "final", "failed"].includes(step.status))) return fail();
    return { kind: "plan", plan };
  }
  // Reuse the established full-resource parser. Load its UI chunk only after
  // an explicit request for the wallet details, never during status polling.
  const { parseLaunch } = await import("@/components/developer-launch-history");
  const launch = parseLaunch(body, subject.controller, String(subject.chainId) as "1" | "8453" | "999");
  if (!launch || launch.routeId !== "custom-launch:create:v3" || launch.launchId !== subject.resourceId || launch.requestHash !== subject.requestHash) return fail();
  return { kind: "graph", launch };
}
export async function reviewGeneralGraphWallet(subject: GeneralWalletSubject, resource: GeneralWalletResource, now = Date.now()): Promise<GeneralGraphWalletReview> {
  if (resource.kind !== "graph" || subject.chainId === 4663) return fail();
  const launch = resource.launch;
  if (launch.launchId !== subject.resourceId || launch.requestHash !== subject.requestHash || launch.ownerWallet.toLowerCase() !== subject.controller.toLowerCase()
    || launch.status !== "authorized" || launch.manualReview && !customLaunchReviewAllowsSigning(launch.manualReview, now)
    || customLaunchWalletHandoffExpiredV1(launch, now)) return fail("This submission is not currently approved for a wallet transaction. Check its current details.");
  const { walletProjectRequestBindingV1 } = await import("@/components/developer-launch-history");
  const projectBinding = walletProjectRequestBindingV1(launch);
  if (!projectBinding) return fail("The original project details could not be verified. Refresh this submission before continuing.");
  const router = prepareCustomLaunchRouterReviewV3(launch.output, subject.controller);
  if (router.walletAction.chainId !== String(subject.chainId)) return fail();
  return { router, projectBinding };
}
export function sameGeneralGraphWalletReview(before: GeneralGraphWalletReview, after: GeneralGraphWalletReview): boolean {
  return canonicalBrowserJsonV2(before) === canonicalBrowserJsonV2(after);
}
/** Caller must load the owned full resource through readGeneralWalletResource.
 * A compact status, a successful proof hint or an HTTP 200 is insufficient. */
export async function generalGraphFinalizedReceipt(subject: GeneralWalletSubject, resource: GeneralWalletResource): Promise<Hex | null> {
  if (resource.kind !== "graph" || subject.chainId === 4663 || resource.launch.status !== "finalized") return null;
  const launch = resource.launch, output = launch.output;
  if (launch.launchId !== subject.resourceId || launch.requestHash !== subject.requestHash || launch.ownerWallet.toLowerCase() !== subject.controller.toLowerCase()
    || !launch.onchainLaunchId || !output || output.schemaVersion !== "programmable.custom-launch-authorization-result.v3" || output.integrationState !== "ready"
    || output.stage !== "onchain-observation" || output.actionRequired !== null) return fail();
  const { walletProjectRequestBindingV1 } = await import("@/components/developer-launch-history");
  if (!walletProjectRequestBindingV1(launch)) return fail();
  const artifact = output.artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return fail();
  const stamp = artifact.stampRequest, permit = artifact.permit;
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp) || stamp.launchId !== launch.onchainLaunchId
    || !permit || typeof permit !== "object" || Array.isArray(permit) || typeof permit.launchWallet !== "string"
    || permit.launchWallet.toLowerCase() !== subject.controller.toLowerCase() || String(permit.chainId) !== String(subject.chainId)) return fail();
  return readCustomGraphFinalizedTransactionV3(output.onchain, { chainId: String(subject.chainId) as "1" | "8453" | "999", onchainLaunchId: launch.onchainLaunchId });
}
export async function generalWalletRequest(subject: GeneralWalletSubject, headers: AISessionHeaders, signal: AbortSignal,
  options: { stepId: string; transactionHash: Hex } | undefined = undefined, fetcher: typeof fetch = fetch): Promise<unknown> {
  let url = generalWalletDetailUrl(subject);
  if (options) {
    if (subject.chainId !== 4663 || !/^[a-zA-Z0-9:._-]{1,256}$/u.test(options.stepId) || !/^0x[a-f0-9]{64}$/iu.test(options.transactionHash)) return fail();
    const parsed = new URL(url, "https://programmable.market");
    parsed.pathname += `/steps/${encodeURIComponent(options.stepId)}/proofs`; url = parsed.pathname + parsed.search;
  }
  return generalWalletJson(url, headers, signal, options ? { schemaVersion: "programmable.custom-launch-plan-step-proof.v1", transactionHash: options.transactionHash.toLowerCase() } : undefined,
    options ? 1_048_576 : 67_108_864, fetcher);
}
/** Explicit preparation through the existing owner/review endpoint. Never
 * called by mounting this panel or by compact status polling. */
export async function startGeneralWalletLaunch(subject: GeneralWalletSubject, headers: AISessionHeaders, signal: AbortSignal): Promise<void> {
  generalWalletDetailUrl(subject);
  await generalWalletJson("/api/custom-launch-reviews/start", headers, signal,
    { chainId: String(subject.chainId), launchId: subject.resourceId, walletAddress: subject.controller }, 1_048_576);
}
async function generalWalletJson(url: string, headers: AISessionHeaders, signal: AbortSignal, body: unknown | undefined, maximum: number, fetcher: typeof fetch = fetch): Promise<unknown> {
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  lifetime.throwIfAborted(); const credentials = await headers(); lifetime.throwIfAborted();
  const response = await fetcher(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal: lifetime,
    headers: { Accept: "application/json", ...credentials, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { void response.body?.cancel().catch(() => {}); return fail("This wallet step could not be refreshed. Your original submission is saved."); }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || Number(response.headers.get("content-length") ?? 0) > maximum || !response.body) {
    void response.body?.cancel().catch(() => {}); return fail();
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let total = 0, text = "", done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  lifetime.addEventListener("abort", abort, { once: true });
  try {
    for (;;) { lifetime.throwIfAborted(); const result = await reader.read(); lifetime.throwIfAborted(); if (result.done) { done = true; break; }
      total += result.value.byteLength; if (total > maximum) return fail(); text += decoder.decode(result.value, { stream: true }); }
    text += decoder.decode(); lifetime.throwIfAborted(); return JSON.parse(text) as unknown;
  } finally { lifetime.removeEventListener("abort", abort); if (!done) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export const generalWalletValue = (value: string, chainId: GeneralWalletSubject["chainId"]) => `${formatEther(BigInt(value))} ${chainId === 999 ? "HYPE" : "ETH"}`;
