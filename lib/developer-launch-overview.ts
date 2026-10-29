import { customLaunchReviewLabel, parseCustomLaunchReview } from "./custom-launch-review";
import { safePublicImageUrl } from "./safe-public-image-url";
export type LaunchOverviewSource = "legacy" | "custom_launch_plan_v1" | "multi_role_v2";
export type LaunchOverviewItem = { id: string; source: LaunchOverviewSource; chainId: "1" | "4663" | "8453" | "999"; name: string; symbol: string; image: string | null;
  createdAt: string; status: string; next: string; version?: "v1" | "v2" | "v3" | "v4"; };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function launchOverviewItem(resource: Record<string, unknown>, source: LaunchOverviewSource, now: number): LaunchOverviewItem {
  const id = String(resource.planId ?? resource.launchId ?? resource.requestId);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(id)) throw new Error("Invalid launch identity");
  const plan = object(resource.plan), wallet = object(resource.wallet), summary = object(wallet.launchSummary);
  const metadata = object(resource.projectMetadata), token = object(metadata.token), presentation = object(metadata.presentation);
  const publication = source === "legacy" ? { ...token, imageUrl: object(presentation.image).uri } : Object.keys(plan).length ? object(plan.publication) : summary;
  const version = source === "legacy" ? String(resource.routeId).split(":").at(-1) as LaunchOverviewItem["version"] : undefined;
  const chainId = source !== "legacy" || version === "v4" ? "4663" : object(resource.manualReview).chainId === "999" ? "999" : object(resource.manualReview).chainId === "8453" ? "8453" : "1";
  const raw = String(resource.status), steps = Array.isArray(resource.steps) ? resource.steps : [];
  const final = ["finalized", "publicly_visible", "final"].includes(raw);
  let status = final ? "Completed" : ["submitted", "sequencer_soft_confirmed", "ethereum_posted"].includes(raw) ? "Confirming" : "Preparing";
  let next = final ? "Launch completed" : status === "Confirming" ? "Confirmation is tracked automatically" : "Programmable is preparing your launch";
  if (!final && status !== "Confirming" && resource.manualReview) {
    const review = parseCustomLaunchReview(resource.manualReview);
    status = customLaunchReviewLabel(review, now);
    next = status === "Approved" ? "Open launch to continue" : status === "Review pending" ? "Programmable is reviewing" : status === "Replaced" ? "Open the successor request" : "Your team: open the review feedback";
    if (status === "Approved" && review.launchRequestedAt) { status = "Preparing"; next = "Preparation continues automatically"; }
  }
  if (!final && (["authorized", "awaiting_wallet_signature", "wallet_action_required", "wallet_action_ready"].includes(raw)
    || steps.some(step => object(step).status === "wallet_action_ready")) && ["Approved", "Preparing"].includes(status)) {
    status = "Ready to launch"; next = "Review the transaction and sign";
  }
  if (!final && ["failed", "cancelled"].includes(raw)) { status = raw === "failed" ? "Needs attention" : "Cancelled"; next = "Open launch for details"; }
  return { id, source, chainId, version, name: typeof publication.name === "string" && publication.name ? publication.name : "Custom launch",
    symbol: typeof publication.symbol === "string" ? publication.symbol.replace(/^\$+/u, "") : "", image: safePublicImageUrl(publication.imageUrl) ?? null,
    createdAt: typeof resource.createdAt === "string" ? resource.createdAt : "", status, next };
}
export function mergeLaunchOverview(current: LaunchOverviewItem[], incoming: LaunchOverviewItem[]) {
  return [...new Map([...current, ...incoming].map(item => [`${item.chainId}:${item.source}:${item.id}`, item])).values()]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
}
