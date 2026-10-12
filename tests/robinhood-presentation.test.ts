import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";

const codex = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexMarkets: codex.read }));
const codexMetadata = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/server/codex-token-metadata", () => ({ readCodexTokenMetadata: codexMetadata.read }));
const moduleMetadata = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/server/module-mode/token-presentation", () => ({ readModuleTokenMetadata: moduleMetadata.read }));
const storage = vi.hoisted(() => ({ list: vi.fn(), token: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/read", () => ({
  readRobinhoodLaunches: storage.list,
  readRobinhoodTokenPresentation: storage.token,
}));

import { readRobinhoodMarkets, readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import { MODULE_DEFAULT_TOKEN_IMAGE } from "@/lib/module-mode/token-metadata";
import { GET } from "@/app/api/explore/robinhood/presentation/route";
// @ts-expect-error -- package fixtures are intentionally JavaScript.
import { validV4ProjectMetadata } from "../packages/launch/test/fixtures/v4.mjs";
// @ts-expect-error -- canonical metadata hashing is intentionally JavaScript.
import { hashProjectMetadata } from "../packages/launch/src/project-metadata.mjs";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const TOKEN: RobinhoodLaunch & { poolId: string } = {
  routerAddress: address("1"), launchId: hash("1"), tokenAddress: address("2"),
  hookAddress: address("3"), creator: address("4"), poolManager: address("5"),
  poolId: hash("2"), stampHash: hash("3"), transactionHash: hash("4"),
  blockNumber: "50000", blockHash: hash("5"), logIndex: 7,
  launchedAt: "2026-09-04T12:00:00.000Z", name: "Robinhood V4 Test", symbol: "RHV4", decimals: 18,
};

function finalizedLaunch() {
  const projectMetadata = validV4ProjectMetadata();
  const commitment = hashProjectMetadata(projectMetadata, { requireComplete: true });
  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata.v4", apiVersion: "v4",
    chainId: "4663", caip2: "eip155:4663", platformId: "programmable", category: "custom",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    projectMetadata, commitments: { metadata: commitment },
    onchain: {
      schemaVersion: "programmable.custom-launch-onchain-evidence.v3", chainId: "4663", caip2: "eip155:4663",
      terminal: true, checkpointType: "ethereum_finalized", router: TOKEN.routerAddress,
      routerLaunchId: TOKEN.launchId, transactionHash: TOKEN.transactionHash, commitments: { metadata: commitment },
      l2Inclusion: {
        chainId: "4663", caip2: "eip155:4663", receiptStatus: "success",
        transactionHash: TOKEN.transactionHash, blockNumber: TOKEN.blockNumber,
        blockHash: TOKEN.blockHash, launchEventLogIndex: TOKEN.logIndex,
      },
    },
    sourceVerification: { status: "exact_match", components: [
      { address: TOKEN.tokenAddress, status: "exact_match" },
      { address: TOKEN.hookAddress, status: "exact_match" },
    ] },
  };
}

function feed(launches = [finalizedLaunch()]) {
  return {
    schemaVersion: "programmable.custom-launch-list.v4", apiVersion: "v4", chainId: "4663", caip2: "eip155:4663",
    generatedAt: new Date().toISOString(), quality: {
      status: "ready", sourceRowCount: launches.length, publishedRowCount: launches.length, quarantinedRowCount: 0,
    }, launches, nextCursor: null as string | null,
  };
}

function market() {
  return { poolId: TOKEN.poolId, source: "codex" as const, priceUsd: 0.003, marketCapUsd: 3_000_000,
    fdvUsd: 8_000_000, liquidityUsd: 250_000, volume24hUsd: 0, change24hPercent: -2.5,
    observedAt: new Date().toISOString(), sourceUrl: "https://www.codex.io/" };
}

function sourceFetch(metadata: unknown = feed(), observation: unknown = new Map([[TOKEN.tokenAddress, market()]])) {
  codex.read.mockImplementation(async () => {
    if (observation instanceof Error) throw observation;
    return observation instanceof Map ? observation : new Map();
  });
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.programmable.market/v4/chains/4663/finalized-custom-launches")) {
      if (metadata instanceof Error) throw metadata;
      return metadata instanceof Response ? metadata : Response.json(metadata);
    }
    throw new Error("Unexpected source request");
  });
}

beforeEach(() => { vi.clearAllMocks(); codex.read.mockResolvedValue(new Map()); codexMetadata.read.mockResolvedValue(new Map()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Robinhood optional coin presentation", () => {
  it("uses Codex module artwork without extra blockchain metadata reads", async () => {
    const token = { ...TOKEN, sourceKind: "module-native-v1" } as unknown as RobinhoodLaunch;
    const metadata = { imageUrl: "https://example.com/coin.png", description: "Coin", links: [] };
    codexMetadata.read.mockResolvedValue(new Map([[token.tokenAddress.toLowerCase(), metadata]]));
    const [value] = await readRobinhoodPresentations([token], new Map());
    expect(value).toMatchObject(metadata);
    expect(moduleMetadata.read).not.toHaveBeenCalled();
  });
  it("joins the committed artwork to the saved launch and keeps exact-pool MC separate from FDV", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value).toMatchObject({ tokenAddress: TOKEN.tokenAddress, imageUrl: "https://example.com/token.png",
      links: [{ label: "Website", url: "https://example.com/" }, { label: "X", url: "https://x.com/programmable" }],
      market: { poolId: TOKEN.poolId, priceUsd: 0.003, marketCapUsd: 3_000_000, liquidityUsd: 250_000,
        volume24hUsd: 0, change24hPercent: -2.5, sourceUrl: "https://www.codex.io/" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      "https://api.programmable.market/v4/chains/4663/finalized-custom-launches?limit=25",
    ]));
  });

  it.each([
    ["chain", (value: ReturnType<typeof finalizedLaunch>) => { value.chainId = "1"; }],
    ["router", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.router = address("9"); }],
    ["launch", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.routerLaunchId = hash("9"); }],
    ["receipt", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.transactionHash = hash("9"); }],
    ["block", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.blockHash = hash("9"); }],
    ["log", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.launchEventLogIndex++; }],
    ["token", (value: ReturnType<typeof finalizedLaunch>) => { value.sourceVerification.components[0].address = address("9"); }],
    ["hook", (value: ReturnType<typeof finalizedLaunch>) => { value.sourceVerification.components[1].address = address("9"); }],
    ["metadata hash", (value: ReturnType<typeof finalizedLaunch>) => { value.projectMetadata.presentation.description = "Changed after commitment"; }],
    ["finality", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.terminal = false; }],
  ])("does not attach metadata with a different %s, but keeps the coin and market", async (_, mutate) => {
    const launch = finalizedLaunch();
    mutate(launch);
    vi.stubGlobal("fetch", sourceFetch(feed([launch])));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.tokenAddress).toBe(TOKEN.tokenAddress);
    expect(value.imageUrl).toBeNull();
    expect(value.description).toBeNull();
    expect(value.market?.marketCapUsd).toBe(3_000_000);
  });

  it("resolves committed IPFS artwork through the established public gateway", async () => {
    const launch = finalizedLaunch();
    const cid = "QmYwAPJzv5CZsnAzt8auVZRnGi1Wm4eQNf6gMss5QZb7S6";
    launch.projectMetadata.presentation.image.uri = `ipfs://${cid}`;
    const commitment = hashProjectMetadata(launch.projectMetadata, { requireComplete: true });
    launch.commitments.metadata = commitment;
    launch.onchain.commitments.metadata = commitment;
    vi.stubGlobal("fetch", sourceFetch(feed([launch])));
    expect((await readRobinhoodPresentations([TOKEN]))[0].imageUrl).toBe(`https://ipfs.io/ipfs/${cid}`);
  });

  it("keeps successful artwork when the market provider fails", async () => {
    vi.stubGlobal("fetch", sourceFetch(feed(), new Error("offline")));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.market).toBeNull();
    expect(value.imageUrl).toBe("https://example.com/token.png");
  });

  it("keeps successful market data when the metadata provider fails", async () => {
    vi.stubGlobal("fetch", sourceFetch(new Error("offline")));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.imageUrl).toBeNull();
    expect(value.market?.marketCapUsd).toBe(3_000_000);
  });

  it("keeps one module coin's artwork when another coin's metadata read fails", async () => {
    const first = { ...TOKEN, sourceKind: "module-native-v1", tokenAddress: address("6") } as unknown as RobinhoodLaunch;
    const second = { ...TOKEN, sourceKind: "module-native-v1", tokenAddress: address("7") } as unknown as RobinhoodLaunch;
    moduleMetadata.read.mockImplementation(async ([token]: RobinhoodLaunch[]) => {
      if (token.tokenAddress === second.tokenAddress) throw new Error("RPC timeout");
      return new Map([[first.tokenAddress.toLowerCase(), {
        imageUrl: "https://example.com/first.png", description: null, links: [],
      }]]);
    });
    const values = await readRobinhoodPresentations([first, second], new Map());
    expect(values.map(value => value.imageUrl)).toEqual([
      "https://example.com/first.png", MODULE_DEFAULT_TOKEN_IMAGE,
    ]);
    expect(moduleMetadata.read).toHaveBeenCalledTimes(2);
  });

  it("uses only the known main-token artwork when both providers are unavailable", async () => {
    vi.stubGlobal("fetch", sourceFetch(new Error("offline"), new Error("offline")));
    const main = { ...TOKEN, tokenAddress: "0xC60bA256B44334A0Cd2C7242E98B88f031abB006" };
    const values = await readRobinhoodPresentations([main, TOKEN]);
    expect(values[0].imageUrl).toBe("/brand/projects/programmable-main-token-v1.webp");
    expect(values[1].imageUrl).toBeNull();
    expect(values).toHaveLength(2);
  });

  it("does not give selected coins platform-supplied artwork or links", async () => {
    vi.stubGlobal("fetch", sourceFetch(new Error("offline"), new Error("offline")));
    const tokens = ["0x105f6435a4ab3c03c13d4a0db67961344694d0cc", "0x34cd7dd63c550a78a3228c199474189b88565ac9"]
      .map(tokenAddress => ({ ...TOKEN, tokenAddress }));
    for (const value of await readRobinhoodPresentations(tokens)) {
      expect(value.imageUrl).toBeNull();
      expect(value.links).toEqual([]);
    }
  });

  it("rejects stale metadata and oversized responses without affecting token identity", async () => {
    const stale = feed();
    stale.generatedAt = "2020-01-01T00:00:00.000Z";
    const oversized = new Response("{}", { headers: { "content-type": "application/json", "content-length": "2000001" } });
    vi.stubGlobal("fetch", sourceFetch(stale, oversized));
    expect(await readRobinhoodPresentations([TOKEN])).toEqual([
      { tokenAddress: TOKEN.tokenAddress, imageUrl: null, description: null, links: [], market: null },
    ]);
  });

  it("does not send provider requests for no tokens or an excessive batch", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    expect(await readRobinhoodPresentations([])).toEqual([]);
    await expect(readRobinhoodPresentations(Array(51).fill(TOKEN))).rejects.toThrow("Invalid presentation request");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Robinhood catalog market observations", () => {
  it("uses complete Codex metadata without another finalized-feed or module-RPC lookup", async () => {
    const fetcher = sourceFetch(new Error("metadata feed must not be called"));
    vi.stubGlobal("fetch", fetcher);
    const details = { imageUrl: "https://example.com/codex.png", description: "Codex description",
      links: [{ label: "Website", url: "https://example.com/" }] };
    codexMetadata.read.mockResolvedValue(new Map([[TOKEN.tokenAddress, details]]));
    const [value] = await readRobinhoodPresentations([TOKEN], new Map());
    expect(value).toMatchObject(details);
    expect(fetcher).not.toHaveBeenCalled();
    expect(moduleMetadata.read).not.toHaveBeenCalled();
  });
  it("does not start another provider when Codex has no observation", async () => {
    const fetcher = sourceFetch(feed(), new Map());
    vi.stubGlobal("fetch", fetcher);
    expect(await readRobinhoodMarkets([TOKEN])).toEqual(new Map());
    expect(fetcher).not.toHaveBeenCalled();
    expect(codex.read).toHaveBeenCalledTimes(1);
  });

  it("discards expired Codex observations", async () => {
    sourceFetch(feed(), new Map([[TOKEN.tokenAddress, {...market(), observedAt:"2020-01-01T00:00:00.000Z"}]]));
    expect(await readRobinhoodMarkets([TOKEN])).toEqual(new Map());
  });

  it("passes the full catalog to Codex using the verified token and pool identities", async () => {
    const tokens = Array.from({length:151},(_,i)=>({...TOKEN,
      tokenAddress:`0x${(i+1).toString(16).padStart(40,"0")}`,poolId:`0x${(i+1).toString(16).padStart(64,"0")}`}));
    await readRobinhoodMarkets(tokens.toReversed());
    expect(codex.read).toHaveBeenCalledTimes(1);
    expect(codex.read.mock.calls[0][0]).toHaveLength(151);
    expect(codex.read.mock.calls[0][0][0]).toMatchObject({tokenAddress:tokens[0].tokenAddress,poolId:tokens[0].poolId});
  });

  it("uses the supplied catalog observation for card values without fetching prices again", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    const market = { poolId: TOKEN.poolId, priceUsd: 2, marketCapUsd: 42, liquidityUsd: null,
      volume24hUsd: null, change24hPercent: null, observedAt: new Date().toISOString(), sourceUrl: "https://www.codex.io/" };
    const result = await readRobinhoodPresentations([TOKEN], new Map([[TOKEN.tokenAddress, market]]));
    expect(result[0].market).toBe(market);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("finalized-custom-launches");
  });
});

describe("Robinhood presentation HTTP boundary", () => {
  const endpoint = "https://website.invalid/api/explore/robinhood/presentation";
  it.each([
    "chain=1", "page=0", "page=1000000", "page=1&page=2", "q=a&q=b", `q=${"x".repeat(129)}`,
    "age=invalid", "sort=market-cap", "age=7d&age=30d", `token=${TOKEN.tokenAddress}&age=7d`,
    "token=bad", `token=${TOKEN.tokenAddress}&page=1`, `token=${TOKEN.tokenAddress}&token=${TOKEN.tokenAddress}`,
  ])("rejects invalid query %s before storage or providers", async (query) => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(new Request(`${endpoint}?${query}`))).status).toBe(400);
    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not look up unverified token addresses at a provider", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    storage.token.mockResolvedValue({ token: null, status: "ready", presentation: null });
    const response = await GET(new Request(`${endpoint}?token=${TOKEN.tokenAddress}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not add a CDN cache lifetime to a single-token market observation", async () => {
    vi.stubGlobal("fetch", sourceFetch());
    storage.token.mockResolvedValue({ token: TOKEN, status: "ready", presentation: {
      tokenAddress: TOKEN.tokenAddress, imageUrl: null, description: null, links: [], market: { priceUsd: 0.003 },
    } });
    const response = await GET(new Request(`${endpoint}?token=${TOKEN.tokenAddress}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).items[0].market.priceUsd).toBe(0.003);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses the selected page presentation without a second provider observation", async () => {
    vi.stubGlobal("fetch", sourceFetch());
    storage.list.mockResolvedValue({ items: [TOKEN], presentations: [{ tokenAddress: TOKEN.tokenAddress, market: null }] });
    const response = await GET(new Request(`${endpoint}?page=2&q=RHV4`));
    expect(storage.list).toHaveBeenCalledWith(2, "RHV4", { sort: "newest", mode: "all" }, 50);
    expect(storage.token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect((await response.json()).items[0].tokenAddress).toBe(TOKEN.tokenAddress);
  });
  it("enriches the same filtered page as the launch list", async () => {
    vi.stubGlobal("fetch", sourceFetch());
    storage.list.mockResolvedValue({ items: [TOKEN], presentations: [{ tokenAddress: TOKEN.tokenAddress, market: null }] });
    const response = await GET(new Request(`${endpoint}?page=2&q=RHV4&sort=lowest`));
    expect(response.status).toBe(200);
    expect(storage.list).toHaveBeenCalledWith(2, "RHV4", { sort: "lowest", mode: "all" }, 50);
  });
});
