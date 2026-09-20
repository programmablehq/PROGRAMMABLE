import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Explore index reset", () => {
  it("renders chain-specific views without a server index read or reactivation flag", () => {
    const page = read("app/explore/[chain]/page.tsx");

    expect(page).toContain("<RobinhoodLaunchesView chainId={chainId} />");
    expect(page).toContain("index: false");
    expect(page).not.toContain("@/app/api/explore/route");
    expect(page).not.toContain("ExploreView");
    expect(page).not.toContain("NextRequest");
    expect(page).not.toContain("Suspense");
    expect(page).not.toContain("websiteExploreIndexEnabledV1");
    expect(page).not.toContain("process.env");
  });

  it("keeps the reset UI free of index loaders, retries and previews", () => {
    const resetView = read("components/explore-index-reset-view.tsx");
    const landingGate = read("components/landing-explore-gate.tsx");
    const selector = read("components/explore-chain-selector.tsx");

    expect(resetView).toContain("No token data is loaded");
    expect(resetView).not.toContain("<ExploreChainSelector");
    expect(resetView).not.toContain("fetch(");
    expect(resetView).not.toContain("ExploreView");
    expect(resetView).not.toContain("setInterval");
    expect(landingGate).toContain("<RobinhoodLaunchesView embedded />");
    expect(landingGate).not.toContain('import("@/components/explore-view")');
    expect(landingGate).not.toContain("IntersectionObserver");
    expect(selector).not.toContain("/api/explore");
    expect(selector).not.toContain("fetch(");
  });
});
