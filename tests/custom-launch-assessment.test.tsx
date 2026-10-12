import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomLaunchAssessment } from "../components/custom-launch-assessment";
import type { CustomLaunchReview } from "../lib/custom-launch-review";

const subjectHash = `sha256:${"1".repeat(64)}`;
const report = { schemaVersion: "programmable.review-trade-report.v4", scope: "operator-local-fork-exact-scenario", mainnetTransactionsSent: false,
  subjectHash, chainId: "1", forkBlockNumber: "1234", status: "passed", checks: ["buy", "sell"].map(side => ({ side, status: "passed", fee: { status: "passed" } })) };
const render = (tradeChecks: unknown) => renderToStaticMarkup(createElement(CustomLaunchAssessment, { value: { trading: { status: "not_verified" } }, admin: true, subjectHash, chainId: "1", tradeChecks }));
const review: CustomLaunchReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "10000000-0000-4000-8000-000000000001",
  subjectHash, chainId: "1", controller: `0x${"1".repeat(40)}`, state: "approved", revision: 3, submittedAt: "2026-10-11T00:00:00Z",
  approvedAt: "2026-10-11T01:00:00Z", expiresAt: "2026-10-12T01:00:00Z", reason: "Initial purchase checked on the exact fork." };

describe("custom launch review evidence", () => {
  it("shows the exact saved fork result instead of the generic not-verified status", () => {
    const html = render(report);
    expect(html).toContain("Passed on fork: buy, sell and the recorded platform fee collection.");
    expect(html).toContain("Platform fee checked: 0.3%");
    expect(html).toContain("Historical evidence does not meet the 1% requirement");
    expect(html).toContain("block 1234");
    expect(html).not.toContain("Current status: not verified");
    expect(html).toContain("live execution is checked separately");
  });
  it("recognizes current pool fee evidence without relabelling the historical rate", () => {
    const html = render({ ...report, platformFeeBps: 100, feeCollection: "pool",
      feePolicyVersion: "programmable.custom-launch-pool-fee.v1", digestEncoding: "canonical-json-v1" });
    expect(html).toContain("Platform fee checked: 1%");
    expect(html).toContain("Current 1% pool fee requirement met.");
    expect(html).not.toContain("Historical evidence");
  });
  it("keeps absent, stale, wrong-chain and inconsistent reports pending", () => {
    for (const value of [null, { ...report, subjectHash: "different" }, { ...report, chainId: "4663" }, { ...report, checks: [] }]) {
      expect(render(value)).toContain("checks are pending for this version");
      expect(render(value)).not.toContain("Passed on fork");
    }
  });
  it("shows a failed recorded scenario and surfaces early repair guidance", () => {
    expect(render({ ...report, status: "failed", checks: [{ side: "buy", status: "failed", fee: { status: "failed" } }, report.checks[1]] })).toContain("Fork check failed");
    const html = renderToStaticMarkup(createElement(CustomLaunchAssessment, { value: { preparation: { notes: [{ message: "Update the old router reference.", location: "Hook.sol:CAP_ROUTER" }] } }, admin: true }));
    expect(html).toContain("Before launch");
    expect(html).toContain("Update the old router reference.");
  });
  it("puts pre-review heuristics behind the exact review without inventing purchase proof", () => {
    const props = { value: { preparation: { notes: [{ code: "INITIAL_BUY_NOT_ESTABLISHED", message: "The initial buy is not established." }] } },
      review, subjectHash, chainId: "1" };
    const html = renderToStaticMarkup(createElement(CustomLaunchAssessment, props));
    expect(html).toContain("Automated hints from before review");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain("The initial buy is not established.");
    expect(html).not.toContain("Initial buy verified");
    for (const changed of [{ ...review, state: "pending" as const }, { ...review, subjectHash: "different" }, { ...review, chainId: "4663" as const }]) {
      const unreviewed = renderToStaticMarkup(createElement(CustomLaunchAssessment, { ...props, review: changed }));
      expect(unreviewed).toContain("<details open");
      expect(unreviewed).toContain("Initial buy needs review");
    }
  });
  it("keeps real embedded deadline warnings visible after approval", () => {
    const html = renderToStaticMarkup(createElement(CustomLaunchAssessment, { review, subjectHash, chainId: "1",
      value: { timing: { deadlines: [{ path: "/actions/1/deadline", state: "expired" }] } } }));
    expect(html).toContain("Embedded deadline needs attention");
    expect(html).toContain("already expired");
  });
});
