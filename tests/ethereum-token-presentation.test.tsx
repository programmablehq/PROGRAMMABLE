import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import type { ConfirmingLaunch } from "@/lib/confirming-launches";
const display = vi.hoisted(() => ({ items: [] as RobinhoodCoinPresentation[] }));
vi.mock("@/components/use-robinhood-presentation", () => ({ useRobinhoodPresentation: () => display }));
vi.mock("@/components/swap-panel", () => ({ SwapPanel: () => null }));
vi.mock("@/components/responsive-trade-panel", () => ({ ResponsiveTradePanel: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/launch-pair-modules", () => ({ LaunchPairModules: () => null }));
vi.mock("@/components/robinhood-chart", () => ({ RobinhoodChart: () => null }));
import { EthereumTokenView } from "@/components/ethereum-token-view";

const token = { ...customGraphExploreEntry, description: "Old description", imageUrl: "https://example.com/old.png",
  links: [{ kind: "website" as const, url: "https://example.com/old" }] };
const presentation = { chainId: 1 as const, tokenAddress: token.tokenAddress, name: "Updated coin", symbol: "NEW",
  description: "Current description", imageUrl: "https://example.com/new.png", links: [{ label: "X", url: "https://x.com/new" }], market: null };
const render = () => renderToStaticMarkup(<EthereumTokenView address={token.tokenAddress} token={token} status="ready" updatedAt={null} />);
beforeEach(() => { display.items = []; });
describe("Ethereum live public presentation", () => {
  it("renders the normal coin market immediately from a receipt-backed identity", () => {
    display.items = [presentation];
    const launch: ConfirmingLaunch = {
      chainId: 1, confirmation: "confirming", observationExpiresAt: Date.now() + 30_000,
      category: "custom", mode: "custom", launchId: token.id, tokenAddress: token.tokenAddress,
      hookAddress: token.hookAddress, creator: token.creatorAddress!, transactionHash: token.launchTransactionHash!,
      blockNumber: token.launchBlockNumber!, blockHash: `0x${"ab".repeat(32)}`, poolId: token.poolId,
      quoteAsset: "0x0000000000000000000000000000000000000000", launchedAt: token.launchedAt,
      name: token.name, symbol: token.symbol, decimals: 18,
    };
    const html = renderToStaticMarkup(<EthereumTokenView address={token.tokenAddress} token={null}
      observedLaunch={launch} status="partial" updatedAt={null} />);
    expect(html).toContain("Updated coin");
    expect(html).toContain("NEW / ETH");
    expect(html).toContain("https://example.com/new.png");
    expect(html).toContain("Market Cap");
    expect(html).toContain("Copy address");
    expect(html).not.toContain("Confirming");
    expect(html).not.toContain("Launch not found");
    expect(html).not.toContain("final verification");
  });
  it("renders updated name, symbol, artwork and links from the matching presentation refresh", () => {
    display.items = [presentation];
    const html = render();
    expect(html).toContain("Updated coin"); expect(html).toContain("NEW / ETH"); expect(html).not.toContain("$NEW"); expect(html).toContain("https://example.com/new.png");
    expect(html).toContain('href="https://x.com/new"'); expect(html).toContain("Current description");
    expect(html).not.toContain("Old description"); expect(token.name).toBe(customGraphExploreEntry.name);
  });
  it("keeps known metadata when a partial refresh omits its description, links and image", () => {
    display.items = [{ ...presentation, description: null, imageUrl: null, links: [] }];
    const html = render();
    expect(html).toContain("Old description"); expect(html).toContain("https://example.com/old");
    expect(html).toContain("https://example.com/old.png");
  });
  it("does not borrow display data from a different token or chain", () => {
    display.items = [{ ...presentation, chainId: 4663 }, { ...presentation, tokenAddress: "0x3333333333333333333333333333333333333333" }];
    const html = render();
    expect(html).toContain(token.name); expect(html).toContain("Old description"); expect(html).not.toContain("Updated coin");
  });
});
