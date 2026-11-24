import { parseCustomLaunchReview, type CustomLaunchReview } from "./custom-launch-review";

export type ReviewDecision = {
  review: CustomLaunchReview;
  choice: "approve" | "reject" | "request_information" | "replace" | "record_checks";
  reason: string;
  replacementReviewId?: string;
  report?: unknown;
};

export class ReviewHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function reviewHttpErrorForResponse(status: number, code: unknown) {
  switch (code) {
    case "REVIEW_PLATFORM_FEE_EVIDENCE_REQUIRED":
      return new ReviewHttpError("Record passing buy and sell checks for the 0.3% platform fee collected by this pool before approving.", status);
    case "REVIEW_EMBEDDED_DEADLINE_TOO_SHORT":
      return new ReviewHttpError("The embedded deadline does not cover the 24-hour launch window. Ask the team to repack it.", status);
    case "REVIEW_LAUNCH_PROTECTION_REQUIRED":
      return new ReviewHttpError("Save the launch protection report for this submission before approving.", status);
  }
  return new ReviewHttpError(status === 409 ? "This review changed. Refresh before deciding."
    : status === 403 ? "This wallet is not authorized to review launches."
    : "Could not load launch reviews. Try again.", status);
}

function uncertain(error: unknown) {
  return error instanceof ReviewHttpError ? error.status >= 500
    : error instanceof SyntaxError || error instanceof TypeError && /fetch|network/i.test(error.message)
      || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
}

function confirms(decision: ReviewDecision, next: CustomLaunchReview) {
  const prior = decision.review;
  if (next.reviewId !== prior.reviewId || next.subjectHash !== prior.subjectHash
    || next.chainId !== prior.chainId || next.controller.toLowerCase() !== prior.controller.toLowerCase()
    || next.revision !== prior.revision + 1) return false;
  const reason = decision.reason.trim();
  switch (decision.choice) {
    case "approve": return next.state === "approved" && (next.reason ?? "").trim() === reason;
    case "reject": return next.state === "rejected" && (next.reason ?? "").trim() === reason;
    case "replace": return next.supersededBy?.reviewId === decision.replacementReviewId;
    case "request_information": {
      const message = next.discussion?.at(-1);
      return message?.author === "reviewer" && message.message.trim() === reason
        && message.links.length === 0 && next.discussion?.length === (prior.discussion?.length ?? 0) + 1;
    }
    case "record_checks": {
      const report = decision.report as { reportSha256?: unknown } | undefined;
      return typeof report?.reportSha256 === "string" && /^sha256:[0-9a-f]{64}$/.test(report.reportSha256)
        && next.tradeChecks?.reportSha256 === report.reportSha256;
    }
  }
}

/** A lost response is not evidence that the mutation failed. Read once and
 * confirm the exact result; never repeat a review mutation automatically. */
export async function saveReviewDecision<T extends { review: unknown }>(
  decision: ReviewDecision, write: () => Promise<T>, read: () => Promise<T>,
): Promise<T> {
  try { return await write(); }
  catch (error) {
    if (!uncertain(error)) throw error;
    try {
      const latest = await read();
      if (confirms(decision, parseCustomLaunchReview(latest.review))) return latest;
    } catch { /* Retain an uncertain outcome when the read also fails. */ }
    throw new Error("The response was interrupted. Refresh this review to check its saved status before trying again.");
  }
}
