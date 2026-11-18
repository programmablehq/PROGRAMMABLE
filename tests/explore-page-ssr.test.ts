import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStaticParams } from "@/app/explore/[chain]/page";
import { exploreChainIdFromSlug, exploreChainPath } from "@/lib/explore-chain";
import { VIEW_CHAIN_OPTIONS } from "@/lib/view-chain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Explore index reset", () => {
  it("builds the published bookmark for every supported chain", () => {
    const routes = generateStaticParams().map(({ chain }) => ({
      id: exploreChainIdFromSlug(chain),
      path: `/explore/${chain}`,
    }));
    for (const { id } of VIEW_CHAIN_OPTIONS) {
      expect(routes).toContainEqual({ id, path: exploreChainPath(id) });
    }
  });

  it("renders unified discovery without the retired index or a reactivation flag", () => {
    const page = read("app/explore/[chain]/page.tsx");

    expect(read("app/explore/page.tsx")).toContain("<UnifiedLaunchesView />");
    expect(page).toContain('redirect("/explore")');
    expect(read("app/explore/page.tsx")).toContain("index: false");
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
    expect(landingGate).toContain("<UnifiedLaunchesView embedded />");
    expect(landingGate).not.toContain('import("@/components/explore-view")');
    expect(landingGate).not.toContain("IntersectionObserver");
    expect(selector).not.toContain("/api/explore");
    expect(selector).not.toContain("fetch(");
  });
});
