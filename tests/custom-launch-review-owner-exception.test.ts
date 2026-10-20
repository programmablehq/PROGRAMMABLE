import { describe, expect, it } from "vitest";
import { customLaunchOwnerException, type CustomLaunchReview } from "../lib/custom-launch-review";

const review: CustomLaunchReview = {
  schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "30000000-0000-4000-8000-000000000001",
  subjectHash: `sha256:${"1".repeat(64)}`, chainId: "1", controller: `0x${"1".repeat(40)}`,
  state: "rejected", revision: 3, submittedAt: "2026-10-20T15:59:38Z", approvedAt: null, expiresAt: null, reason: null,
};
const exception = { schemaVersion: "programmable.owner-review-exception.v1" as const, id: "example",
  reviewId: review.reviewId, subjectHash: review.subjectHash, chainId: review.chainId, controller: review.controller,
  technicalEvidenceStatus: "not-certified" as const, approvalReason: "Owner decision; checks remain unverified." };

describe("owner exception display is tied to the authenticated review identity", () => {
  it("does not make ordinary or changed reviews eligible", () => {
    expect(customLaunchOwnerException(review)).toBeNull();
    for (const change of [{ reviewId: "other" }, { subjectHash: "other" }, { chainId: "4663" }, { controller: `0x${"2".repeat(40)}` }]) {
      expect(customLaunchOwnerException({ ...review, ownerException: { ...exception, ...change } })).toBeNull();
    }
  });
  it("displays the distinct owner decision without turning it into passing test evidence", () => {
    expect(customLaunchOwnerException({ ...review, ownerException: exception })).toEqual(exception);
    expect(exception.technicalEvidenceStatus).toBe("not-certified");
  });
});
