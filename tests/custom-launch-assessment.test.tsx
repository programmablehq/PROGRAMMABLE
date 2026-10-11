import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomLaunchAssessment } from "../components/custom-launch-assessment";

const subjectHash = `sha256:${"1".repeat(64)}`;
const report = { schemaVersion: "programmable.review-trade-report.v4", scope: "operator-local-fork-exact-scenario", mainnetTransactionsSent: false,
  subjectHash, chainId: "1", forkBlockNumber: "1234", status: "passed", checks: ["buy", "sell"].map(side => ({ side, status: "passed", fee: { status: "passed" } })) };
const render = (tradeChecks: unknown) => renderToStaticMarkup(createElement(CustomLaunchAssessment, { value: { trading: { status: "not_verified" } }, admin: true, subjectHash, chainId: "1", tradeChecks }));

describe("custom launch review evidence", () => {
  it("shows the exact saved fork result instead of the generic not-verified status", () => {
    const html = render(report);
    expect(html).toContain("Passed on fork: buy, sell and 0.30% platform fee collection.");
    expect(html).toContain("block 1234");
    expect(html).not.toContain("Current status: not verified");
    expect(html).toContain("live execution is checked separately");
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
});
