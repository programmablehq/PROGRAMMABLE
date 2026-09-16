import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoundationReviewChecks } from "../components/module-review-admin-console";
import { parseFoundationReviewArtifact, parseReviewPlan, type AnyFoundationProtocolBuild } from "../lib/module-mode/review-contract";
import v2 from "./fixtures/module-foundation-review-v2.json";
import v1 from "./fixtures/module-foundation-review.json";

// Display-only fixture checks. Injected conformance flags confer no review or release authority.
describe("Foundation protocol conformance display", () => {
  it.each([["v1", v1.protocol, 10], ["v2", v2, 12]] as const)("renders every exact %s backend check without treating it as module cases", (_version, fixture, expectedCount) => {
    const supplied = fixture.artifact as unknown as AnyFoundationProtocolBuild;
    const plan = parseReviewPlan(fixture.plan, supplied.subject);
    const artifact = parseFoundationReviewArtifact(fixture.artifact, supplied.subject, plan) as AnyFoundationProtocolBuild;
    const html = renderToStaticMarkup(createElement(FoundationReviewChecks, { artifact }));
    expect(html).toContain("Foundation protocol conformance");
    expect((html.match(/<td>Pass<\/td>/g) ?? []).length).toBe(expectedCount);
    for (const key of Object.keys(artifact.tests.checks)) expect(html).toContain(key.replace(/([a-z])([A-Z0-9])/g, "$1 $2"));
    if (_version === "v2") {
      expect(html).toContain("direct Dead Position Custody");
      expect(html).toContain("rounding Inventory To Dead");
    }
  });
});
