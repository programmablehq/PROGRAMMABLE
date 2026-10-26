import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, sameRobinhoodExploreRequest } from "@/lib/robinhood-explore-filters";

vi.mock("@/components/view-chain", () => {
  const useViewChain = () => ({ hydrated: true, viewChainId: 4663, setViewChainId: vi.fn() });
  return { useViewChain, useRouteViewChain: useViewChain };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/explore/robinhood", useRouter: () => ({ push: vi.fn() }) }));
import { RobinhoodLaunchesView, UnifiedLaunchesView } from "@/components/robinhood-launches-view";
import { ChainMark } from "@/components/chain-mark";

describe("Explore request identity", () => {
  const request = { page: 2, q: "coin", sort: "newest" as const, mode: "module" as const };

  it("accepts only the currently selected page, search, order and launch type", () => {
    expect(sameRobinhoodExploreRequest({ ...request }, request)).toBe(true);
    for (const previous of [null, undefined, { ...request, page: 1 }, { ...request, q: "other" },
      { ...request, sort: "oldest" as const }, { ...request, mode: "custom" as const }]) {
      expect(sameRobinhoodExploreRequest(previous, request)).toBe(false);
    }
  });

  it("treats older unfiltered navigation state as All and includes launch type in filter count", () => {
    expect(sameRobinhoodExploreRequest({ ...request, mode: undefined }, { ...request, mode: "all" })).toBe(true);
    expect(activeExploreFilterCount(DEFAULT_EXPLORE_FILTERS)).toBe(0);
    expect(activeExploreFilterCount({ sort: "highest", mode: "module" })).toBe(1);
    expect(activeExploreFilterCount({ sort: "newest", mode: "custom" })).toBe(1);
    expect(activeExploreFilterCount({ sort: "activity", mode: "all" })).toBe(0);
    expect(activeExploreFilterCount({ sort: "newest", mode: "all", chain: 1 })).toBe(1);
    expect(sameRobinhoodExploreRequest({ ...request, chain: 1 }, { ...request, chain: 4663 })).toBe(false);
  });
});

describe("Explore toolbar and loading structure", () => {
  it("renders one catalog without a chain selector, even when the wallet context starts on Robinhood", () => {
    const html = renderToStaticMarkup(<UnifiedLaunchesView />);
    expect(html).toContain("Search Programmable launches by name, symbol or address");
    expect(html).toContain('aria-label="Programmable launches"');
    expect(html).not.toContain("Explore chain:");
    expect(html).not.toContain('role="listbox"');
  });
  it("renders only the chain logo, with an accessible chain name", () => {
    const rh = renderToStaticMarkup(<ChainMark chainId={4663} />), eth = renderToStaticMarkup(<ChainMark chainId={1} />);
    expect(rh).toContain('alt="Robinhood Chain"');
    expect(rh).not.toContain(">Robinhood Chain<");
    expect(eth).toContain('aria-label="Ethereum"');
    expect(eth).toContain("<svg");
    expect(eth).not.toContain("<span>Ethereum</span>");
  });

  it("loads the explicit Ethereum chain with an enabled search and its own list", () => {
    const html = renderToStaticMarkup(<RobinhoodLaunchesView chainId={1} />);
    expect(html).toContain("Search Ethereum launches by name, symbol or address");
    expect(html).toContain('aria-label="Ethereum launches"');
    expect(html).not.toContain("indexing is being rebuilt");
    expect(html).not.toContain('aria-label="Robinhood launches"');
  });
  it("keeps accessible arrows beside the chain and Filters controls without a separate page or mode row", () => {
    const html = renderToStaticMarkup(<RobinhoodLaunchesView chainId={4663} />);
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
    expect(html).toContain('aria-label="Launch pages"');
    expect(html.indexOf('aria-label="Filters"')).toBeLessThan(html.indexOf('aria-label="Previous page"'));
    expect(html).not.toContain('aria-label="Launch type"');
    expect(html).not.toContain('aria-label="Sort launches"');
    expect(html).not.toContain(">Newest</button>");
    expect(html).not.toContain(">24h volume</button>");
    expect(html).not.toContain(">Market cap</button>");
    expect(html).not.toContain("Page 1 of");
    expect(html).not.toContain(">Previous<");
    expect(html).not.toContain(">Next<");
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html).toContain('aria-label="Robinhood launches" aria-busy="true"');
  });
});
