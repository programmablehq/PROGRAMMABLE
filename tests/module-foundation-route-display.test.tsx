import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
const readers = vi.hoisted(() => ({ indexed: vi.fn(), recent: vi.fn(), presentation: vi.fn() }));
vi.mock("@/lib/server/token-page", () => ({ resolveTokenPage: readers.indexed }));
vi.mock("@/lib/server/confirming-launches", () => ({ readConfirmingEthereumLaunches: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ findRecentFoundationLaunch: readers.recent }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumTokenPresentation: readers.presentation }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodTokenPresentation: readers.presentation }));
vi.mock("@/lib/module-foundation/ethereum-release", () => ({ isEthereumModuleLaunchCandidate: () => true }));
vi.mock("@/components/module-foundation-market-host", () => ({ ModuleFoundationMarketHost: () => null }));
vi.mock("@/components/ethereum-token-view", () => ({ EthereumTokenView: () => null }));
vi.mock("@/components/robinhood-token-view", () => ({ RobinhoodTokenView: () => null }));
vi.mock("@/components/token-route-chain-sync", () => ({ TokenRouteChainSync: () => null }));
import FoundationCoinPage from "@/app/modules/[token]/page";
import TokenPage, { generateMetadata } from "@/app/token/[address]/page";

const token = { ...customGraphExploreEntry, symbol: "V4", quoteAssetSymbol: "CLAUS",
  quoteAssetAddress: `0x${"33".repeat(20)}` as const };
beforeEach(() => {
  vi.clearAllMocks(); readers.recent.mockResolvedValue(null);
  readers.indexed.mockResolvedValue({ chainId: 1, token, status: "ready" });
  readers.presentation.mockReturnValue(new Promise(() => {}));
});

it("keeps the indexed ticker and pair on a direct module URL without a price request", async () => {
  const page = await FoundationCoinPage({ params: Promise.resolve({ token: token.tokenAddress }), searchParams: Promise.resolve({ chainId: "1" }) });
  expect(page.props.initialLaunch).toMatchObject({ symbol: "V4", quoteSymbol: "CLAUS", quoteAsset: token.quoteAssetAddress, poolId: token.poolId });
  expect(readers.presentation).not.toHaveBeenCalled();
});

it("passes the Ethereum module identity while the optional presentation is still loading", async () => {
  const page = await TokenPage({ params: Promise.resolve({ address: token.tokenAddress }), searchParams: Promise.resolve({ chain: "1" }) });
  const host = page.props.children as ReactElement<{ initialLaunch: unknown }>;
  expect(host.props.initialLaunch).toMatchObject({ symbol: "V4", quoteSymbol: "CLAUS", quoteAsset: token.quoteAssetAddress });
  expect(readers.recent).not.toHaveBeenCalled();
});

it.each([undefined, "4663", "1"])("opens a confirmed launch before final indexing for chain %s", async chain => {
  const chainId = chain === "1" ? 1 : 4663;
  const row = { tokenAddress: token.tokenAddress, name: "Fresh coin", transactionHash: `0x${"ab".repeat(32)}` };
  const presentation = { chainId, tokenAddress: token.tokenAddress, market: null };
  readers.indexed.mockResolvedValue(chain === undefined ? { chainId: null } : { chainId, token: null, status: "syncing" });
  readers.recent.mockResolvedValue({ chainId, row, presentation });
  const page = await TokenPage({ params: Promise.resolve({ address: token.tokenAddress }), searchParams: Promise.resolve({ chain }) });
  const host = page.props.children as ReactElement<{ chainId: number; initialLaunch: unknown; transactionHash: string; initialPresentation: Promise<unknown> }>;
  expect(readers.recent).toHaveBeenCalledExactlyOnceWith(chainId, token.tokenAddress);
  expect(page.props.chainId).toBe(chainId);
  expect(host.props.initialLaunch).toBe(row);
  expect(host.props.transactionHash).toBe(row.transactionHash);
  expect(await host.props.initialPresentation).toBe(presentation);
  expect(readers.presentation).not.toHaveBeenCalled();
});

it.each([null, new Error("Recent store unavailable")])("keeps an unknown address unresolved when receipt evidence is unavailable: %s", async result => {
  readers.indexed.mockResolvedValue({ chainId: null });
  if (result instanceof Error) readers.recent.mockRejectedValue(result);
  else readers.recent.mockResolvedValue(result);
  const page = await TokenPage({ params: Promise.resolve({ address: token.tokenAddress }), searchParams: Promise.resolve({}) });
  expect(page.props.unresolved).toBe(true);
});

it.each(["1", "4663"])("uses receipt-confirmed identity in shared link metadata for chain %s", async chain => {
  readers.indexed.mockResolvedValue({ chainId: Number(chain), token: null });
  readers.recent.mockResolvedValue({ row: { tokenAddress: token.tokenAddress, name: "Fresh coin" } });
  const metadata = await generateMetadata({ params: Promise.resolve({ address: token.tokenAddress }), searchParams: Promise.resolve({ chain }) });
  expect(metadata.title).toBe("Fresh coin · Programmable");
  expect(metadata.alternates?.canonical).toBe(`/token/${token.tokenAddress}${chain === "1" ? "?chain=1" : ""}`);
  expect(metadata.description).not.toContain("finalized");
});
