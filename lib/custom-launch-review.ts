import { parseReviewWorkflowV4, type ReviewWorkflowV4 } from "./custom-launch-review-workflow";
export type CustomLaunchReview = Readonly<ReviewWorkflowV4 & {
  schemaVersion: "programmable.custom-launch-manual-review.v1";
  reviewId: string;
  subjectHash: string;
  chainId: "1" | "4663" | "8453" | "999";
  controller: string;
  state: "pending" | "approved" | "rejected" | "expired";
  revision: number;
  submittedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  reason: string | null;
  requiresRepack?: boolean;
  reviewDueAt?: string;
  reviewOverdue?: boolean;
  launchRequestedAt?: string | null;
  launchDeadline?: string | null;
  ownerException?: Readonly<{
    schemaVersion: "programmable.owner-review-exception.v1";
    id: string; reviewId: string; subjectHash: string; chainId: string; controller: string;
    technicalEvidenceStatus: "not-certified"; approvalReason: string;
  }> | null;
}>;

/** Only display an exception supplied by the authenticated review service for
 * this exact identity. The server remains the approval authority. */
export function customLaunchOwnerException(review: CustomLaunchReview) {
  const e = review.ownerException;
  return e?.schemaVersion === "programmable.owner-review-exception.v1" && e.reviewId === review.reviewId
    && e.subjectHash === review.subjectHash && e.chainId === review.chainId
    && e.controller.toLowerCase() === review.controller.toLowerCase()
    && e.technicalEvidenceStatus === "not-certified" && typeof e.approvalReason === "string" ? e : null;
}

export function parseCustomLaunchReview(value: unknown): CustomLaunchReview {
  const v = value as CustomLaunchReview | undefined;
  if (!v || v.schemaVersion !== "programmable.custom-launch-manual-review.v1"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v.reviewId)
    || !/^sha256:[0-9a-f]{64}$/u.test(v.subjectHash) || !["1", "4663", "8453", "999"].includes(v.chainId)
    || !/^0x[0-9a-fA-F]{40}$/u.test(v.controller) || !["pending", "approved", "rejected", "expired"].includes(v.state)
    || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Number.isFinite(Date.parse(v.submittedAt))
    || (v.approvedAt !== null && !Number.isFinite(Date.parse(v.approvedAt)))
    || (v.expiresAt !== null && !Number.isFinite(Date.parse(v.expiresAt)))
    || (v.reason !== null && typeof v.reason !== "string")
    || (v.requiresRepack !== undefined && typeof v.requiresRepack !== "boolean")
    || (v.reviewDueAt !== undefined && !Number.isFinite(Date.parse(v.reviewDueAt)))
    || (v.reviewOverdue !== undefined && typeof v.reviewOverdue !== "boolean")
    || (v.launchRequestedAt !== undefined && v.launchRequestedAt !== null && !Number.isFinite(Date.parse(v.launchRequestedAt)))
    || (v.launchDeadline !== undefined && v.launchDeadline !== null && !Number.isFinite(Date.parse(v.launchDeadline)))) throw new Error("Invalid launch review");
  parseReviewWorkflowV4(v);
  return v;
}

export function customLaunchReviewAllowsSigning(review: CustomLaunchReview, now = Date.now()) {
  const approved = Date.parse(review.approvedAt ?? ""), expires = Date.parse(review.expiresAt ?? "");
  if (review.requiresRepack === true || review.state !== "approved" || approved > now || expires <= now || ![3_600_000, 86_400_000].includes(expires - approved)
    || review.launchRequestedAt === null || review.launchDeadline === null) return false;
  if (expires - approved === 86_400_000 && (!review.launchRequestedAt || !review.launchDeadline)) return false;
  if (review.launchRequestedAt !== undefined) {
    const started = Date.parse(review.launchRequestedAt), deadline = Date.parse(review.launchDeadline ?? "");
    if (!Number.isFinite(started) || !Number.isFinite(deadline) || started < approved || started > now || deadline <= now
      || deadline > expires || deadline <= started || deadline - started > 86_400_000) return false;
  }
  return true;
}

export function customLaunchReviewNeedsStart(review: CustomLaunchReview, now = Date.now()) {
  return customLaunchReviewLabel(review, now) === "Approved" && Date.parse(review.approvedAt!) <= now && review.launchRequestedAt === null;
}

export function customLaunchReviewOverdue(review: CustomLaunchReview, now = Date.now()) {
  return review.state === "pending" && now >= Date.parse(review.reviewDueAt ?? new Date(Date.parse(review.submittedAt) + 86_400_000).toISOString());
}

export function customLaunchReviewLabel(review: CustomLaunchReview, now = Date.now()) {
  if (review.supersededBy) return "Replaced";
  if (review.state === "rejected") return "Changes requested";
  if (review.requiresRepack === true) return "Update required";
  if (review.state === "approved") {
    const approved = Date.parse(review.approvedAt ?? ""), expires = Date.parse(review.expiresAt ?? "");
    // A fresh server approval can be slightly ahead of the browser clock.
    // Its status is approved even while signing waits for the start time.
    return expires > now && [3_600_000, 86_400_000].includes(expires - approved) ? "Approved" : "Approval expired";
  }
  return review.state === "pending" ? (review.discussion?.at(-1)?.author === "reviewer" ? "Reply requested" : "Review pending") : "Approval expired";
}

export function customLaunchReviewDescription(review: CustomLaunchReview) {
  if (review.supersededBy) return `Replaced by request ${review.supersededBy.launchId}. Continue with that request.`;
  if (review.state === "pending" && review.reason) return review.reason;
  if (review.state === "rejected" && review.reason) return review.reason;
  if (review.requiresRepack === true) return "Repack this launch with the current contract bindings for the 24-hour signing window, then submit it for review.";
  if (customLaunchReviewLabel(review) === "Approved") return `Approved. Launch by ${new Date(review.expiresAt!).toLocaleString()}.`;
  if (review.state === "pending") return customLaunchReviewOverdue(review)
    ? "Review is overdue. Your application remains open. Your 24-hour launch window starts only after approval."
    : "Your launch is waiting for Programmable approval. Review target: 24 hours from submission. Your separate 24-hour launch window starts after approval.";
  if (review.state === "rejected") return review.reason || "Programmable requested changes to this launch.";
  return "The approval window has ended. A new approval is required before signing.";
}
