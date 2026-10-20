vi.mock("@/lib/server/confirming-launches", () => ({ readConfirmingEthereumLaunches: vi.fn().mockResolvedValue([]) }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(),
  readToken: vi.fn(),
  readEthereumToken: vi.fn(),
  readBaseToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../lib/server/module-foundation/recent-launch-store", () => ({
  findRecentFoundationLaunch: vi.fn(async () => null),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("../lib/server/robinhood-index/read", () => ({
  readRobinhoodToken: mocks.readToken,
  readRobinhoodTokenPresentation: vi.fn(async () => ({ presentation: null })),
}));
vi.mock("../lib/server/ethereum-explore", () => ({
  readEthereumToken: mocks.readEthereumToken,
  readEthereumTokenPresentation: vi.fn(async () => ({ presentation: null })),
}));

vi.mock("../lib/server/base-explore", () => ({ readBaseToken: mocks.readBaseToken }));

import { readConfirmingEthereumLaunches } from "@/lib/server/confirming-launches";
import ExplorePage from "../app/explore/page";
import ExploreChainPage from "../app/explore/[chain]/page";
import TokenPage, { generateMetadata as tokenMetadata } from "../app/token/[address]/page";
import { AppShell } from "../components/app-shell";
import { exploreChainIdFromSlug } from "../lib/explore-chain";
import { resolveTokenPage } from "../lib/server/token-page";

const address = "0x1111111111111111111111111111111111111111";
const token = { tokenAddress: address, name: "Example token" };

beforeEach(() => {
  mocks.cookie.mockReset();
  mocks.readBaseToken.mockReset().mockResolvedValue({ chainId: 8453, status: "ready", token: null, updatedAt: null });
  mocks.readToken.mockReset().mockResolvedValue({ status: "ready", token: null, updatedAt: null });
  mocks.readEthereumToken.mockReset().mockResolvedValue({ chainId: 1, status: "ready", token: null, updatedAt: null });
});

describe("Explore chain routes", () => {
  it("starts the app shell on Robinhood instead of overriding the provider default", () => {
    expect(AppShell({ children: null }).props.initialViewChainId).toBe(4663);
    expect(AppShell({ children: null, initialViewChainId: 1 }).props.initialViewChainId).toBe(1);
  });

  it("opens one combined catalog independently of wallet preferences and legacy query values", async () => {
    for (const query of [{}, { chain: "1" }, { chain: "4663" }, { chain: "8453" }]) {
      mocks.cookie.mockReturnValue({ value: "1" });
      expect((await ExplorePage({ searchParams: Promise.resolve(query) })).type.name).toBe("UnifiedLaunchesView");
      expect(mocks.cookie).not.toHaveBeenCalled();
    }
  });

  it("rejects unsupported and repeated legacy chain parameters", async () => {
    for (const chain of ["10", ["1", "4663"]]) {
      await expect(ExplorePage({ searchParams: Promise.resolve({ chain }) }))
        .rejects.toThrow("NOT_FOUND");
    }
  });

  it.each(["robinhood", "ethereum", "base"])("redirects the legacy %s bookmark to the same combined catalog", async chain => {
    expect(exploreChainIdFromSlug(chain)).not.toBeNull();
    await expect(ExploreChainPage({ params: Promise.resolve({ chain }) })).rejects.toThrow("REDIRECT:/explore");
  });

  it("does not interpret arbitrary path segments as a chain", async () => {
    expect(exploreChainIdFromSlug("unknown")).toBeNull();
    await expect(ExploreChainPage({ params: Promise.resolve({ chain: "unknown" }) }))
      .rejects.toThrow("NOT_FOUND");
  });
});

describe("verified token routing", () => {
  it("opens a refreshing observation page without changing the canonical transaction resolver", async () => {
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([{
      chainId: 1, confirmation: "confirming", observationExpiresAt: Date.now() + 30_000,
      category: "custom", mode: "custom", launchId: "launch", tokenAddress: address, hookAddress: address,
      creator: address, transactionHash: "tx", blockHash: "hash", blockNumber: "123", poolId: "pool",
      quoteAsset: address, launchedAt: "2026-10-11T16:05:47Z", name: "New", symbol: "NEW", decimals: 18,
    }]);
    expect(await resolveTokenPage(address, "1")).toMatchObject({ token: null });
    const page = await TokenPage({ params: Promise.resolve({ address }), searchParams: Promise.resolve({ chain: "1" }) });
    expect(page.props.children.type.name).toBe("ConfirmingLaunchView");
  });
  it("resolves a clean URL from the exact Robinhood record independently of cookies", async () => {
    mocks.cookie.mockReturnValue({ value: "1" });
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    expect(await resolveTokenPage(address)).toMatchObject({ chainId: 4663, token });
    expect(mocks.readToken).toHaveBeenCalledWith(address);
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it("keeps explicit Ethereum authoritative even when the address exists on Robinhood", async () => {
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    const ethereumResult = { chainId: 1, status: "ready", token: { ...token, name: "Ethereum token" }, updatedAt: null };
    mocks.readEthereumToken.mockResolvedValue(ethereumResult);
    expect(await resolveTokenPage(address, "1")).toEqual(ethereumResult);
    expect(mocks.readEthereumToken).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.readToken).not.toHaveBeenCalled();
  });

  it("keeps explicit Base authoritative without reading either other chain", async () => {
    const baseResult = { chainId: 8453, status: "ready", token: { ...token, name: "Base token" }, updatedAt: null };
    mocks.readBaseToken.mockResolvedValue(baseResult);
    expect(await resolveTokenPage(address, "8453")).toEqual(baseResult);
    expect(mocks.readBaseToken).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.readEthereumToken).not.toHaveBeenCalled();
    expect(mocks.readToken).not.toHaveBeenCalled();
  });

  it("keeps explicit Robinhood links scoped even when the index is unavailable", async () => {
    mocks.readToken.mockResolvedValue({ status: "unavailable", token: null, updatedAt: null });
    expect(await resolveTokenPage(address, "4663")).toMatchObject({ chainId: 4663, token: null });
  });

  it("does not infer Ethereum from an unknown address or a Robinhood index failure", async () => {
    expect(await resolveTokenPage(address)).toEqual({ chainId: null });
    mocks.readToken.mockResolvedValue({ status: "unavailable", token: null, updatedAt: null });
    expect(await resolveTokenPage(address)).toEqual({ chainId: null });
  });

  it("rejects invalid or repeated chain values before reading a token", async () => {
    expect(await resolveTokenPage(address, "10")).toBeNull();
    expect(await resolveTokenPage(address, ["1", "4663"])).toBeNull();
    expect(mocks.readToken).not.toHaveBeenCalled();
    expect(mocks.readEthereumToken).not.toHaveBeenCalled();
  });

  it("validates the address before reading any token data", async () => {
    await expect(TokenPage({
      params: Promise.resolve({ address: "not-an-address" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
    expect(mocks.readToken).not.toHaveBeenCalled();
    expect(mocks.readEthereumToken).not.toHaveBeenCalled();
  });

  it("uses the clean token URL as the canonical for old and new Robinhood links", async () => {
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    for (const search of [{}, { chain: "4663" }]) {
      expect(await tokenMetadata({
        params: Promise.resolve({ address }),
        searchParams: Promise.resolve(search),
      })).toMatchObject({
        title: "Example token · Programmable",
        alternates: { canonical: `/token/${address}` },
      });
    }
  });
});
