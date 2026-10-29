import {describe, expect, it, vi} from "vitest";
import {ReviewHttpError, saveReviewDecision, type ReviewDecision} from "../lib/custom-launch-review-decision";
import type {CustomLaunchReview} from "../lib/custom-launch-review";

const before: CustomLaunchReview = {
  schemaVersion:"programmable.custom-launch-manual-review.v1",reviewId:"11111111-1111-4111-8111-111111111111",
  subjectHash:`sha256:${"1".repeat(64)}`,chainId:"999",controller:`0x${"2".repeat(40)}`,
  state:"pending",revision:7,submittedAt:"2026-10-29T00:00:00Z",approvedAt:null,expiresAt:null,reason:null,
};
const reason="Exact launch checked";
const reportSha256=`sha256:${"3".repeat(64)}`;
const replacementReviewId="22222222-2222-4222-8222-222222222222";

describe("review decisions after an interrupted response",()=>{
  it("returns a normal successful write without extra reads",async()=>{
    const value={review:{...before,revision:8,state:"approved" as const,reason}};
    const write=vi.fn().mockResolvedValue(value),read=vi.fn();
    expect(await saveReviewDecision({review:before,choice:"approve",reason},write,read)).toBe(value);
    expect(write).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();
  });

  it.each([
    {choice:"approve",changes:{state:"approved",reason}},
    {choice:"reject",changes:{state:"rejected",reason}},
    {choice:"record_checks",changes:{tradeChecks:{schemaVersion:"programmable.review-trade-report.v4",reportSha256}}},
    {choice:"replace",changes:{supersededBy:{reviewId:replacementReviewId,launchId:replacementReviewId}}},
    {choice:"request_information",changes:{discussion:[{revision:8,createdAt:"2026-10-29T00:01:00Z",author:"reviewer",message:reason,links:[]}] }},
  ])("recovers the saved $choice with one read and no repeated write",async({choice,changes})=>{
    const latest={review:{...before,...changes,revision:8}};
    const write=vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),read=vi.fn().mockResolvedValue(latest);
    const decision={review:before,choice,reason,report:{reportSha256},replacementReviewId} as ReviewDecision;
    expect(await saveReviewDecision(decision,write,read)).toBe(latest);
    expect(write).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    {revision:7},{revision:9},{subjectHash:`sha256:${"4".repeat(64)}`},
    {chainId:"1"},{controller:`0x${"5".repeat(40)}`},{reason:"Another decision"},
  ])("does not claim an unrelated or stale result was saved: %j",async changes=>{
    const write=vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const read=vi.fn().mockResolvedValue({review:{...before,state:"approved",reason,revision:8,...changes}});
    await expect(saveReviewDecision({review:before,choice:"approve",reason},write,read)).rejects.toThrow("Refresh this review");
    expect(write).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit permission errors and does not perform recovery reads",async()=>{
    const error=new ReviewHttpError("Not allowed",403),read=vi.fn();
    await expect(saveReviewDecision({review:before,choice:"approve",reason},async()=>{throw error;},read)).rejects.toBe(error);
    expect(read).not.toHaveBeenCalled();
  });

  it("reconciles a server error but leaves an unavailable read uncertain",async()=>{
    const write=vi.fn().mockRejectedValue(new ReviewHttpError("Unavailable",502));
    const read=vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    await expect(saveReviewDecision({review:before,choice:"approve",reason},write,read)).rejects.toThrow("Refresh this review");
    expect(write).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
  });
});
