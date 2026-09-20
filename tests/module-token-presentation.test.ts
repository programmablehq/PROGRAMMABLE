import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, keccak256, stringToHex } from "viem";
import { foundationMetadataParameters, foundationTokenAbi } from "@/lib/module-foundation/abi";
import { MODULE_DEFAULT_TOKEN_IMAGE } from "@/lib/module-mode/token-metadata";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import type { RobinhoodModuleLaunch } from "@/lib/robinhood-launches";

vi.mock("server-only", () => ({}));
import { readModuleTokenMetadata } from "@/lib/server/module-mode/token-presentation";

const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const hash = (digit: string) => `0x${digit.repeat(64)}` as const;
const token: RobinhoodModuleLaunch = {
  sourceKind: "module-native-v1", sourceAddress: address("1"), sourceReleaseDigest: hash("1"),
  launchId: hash("2"), tokenAddress: address("2"), creator: address("3"), hookAddress: address("4"),
  poolManager: address("5"), poolId: hash("3"), routerAddress: null, stampHash: null,
  recipeHash: hash("4"), runtime: address("6"), launchKey: hash("5"), verificationDigest: hash("6"),
  modulePackageIds: [], moduleFamilyIds: [], transactionHash: hash("7"), blockNumber: "56000000",
  blockHash: hash("8"), logIndex: 3, launchedAt: "2026-09-07T08:00:00.000Z", name: "Coin", symbol: "COIN", decimals: 18,
};
function reply({ chain = "0x1237", creator = address("1"), malformed = false } = {}) {
  return [
    { jsonrpc: "2.0", id: 0, result: chain },
    { jsonrpc: "2.0", id: 1, result: malformed ? "0xff" : encodeFunctionResult({ abi: uerc20ReadAbi, functionName: "metadata", result: [
      "A coin description", "https://example.com/", "https://example.com/coin.png", stringToHex(JSON.stringify({
        v: 1, x: "https://x.com/coin", telegram: "https://t.me/coin", discord: "https://discord.gg/coin",
        github: "https://github.com/coin/repo", gitbook: "https://coin.gitbook.io/docs",
      })),
    ] }) },
    { jsonrpc: "2.0", id: 2, result: encodeFunctionResult({ abi: uerc20ReadAbi, functionName: "creator", result: creator }) },
  ];
}
afterEach(() => vi.unstubAllGlobals());

describe("Native module token presentation", () => {
  it("reads existing token images and all social fields from the canonical token getter in one batch", async () => {
    const fetcher = vi.fn(async () => Response.json(reply().reverse()));
    vi.stubGlobal("fetch", fetcher);
    const metadata = (await readModuleTokenMetadata([token])).get(token.tokenAddress);
    expect(metadata).toMatchObject({ imageUrl: "https://example.com/coin.png", description: "A coin description" });
    expect(metadata?.links.map(link => link.label)).toEqual(["Website", "X", "Telegram", "Discord", "GitHub", "GitBook"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["different chain", { chain: "0x1" }],
    ["different creator", { creator: address("9") }],
    ["malformed metadata", { malformed: true }],
  ])("omits optional metadata from a %s", async (_, options) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(reply(options))));
    expect((await readModuleTokenMetadata([token])).size).toBe(0);
  });

  it("does not confuse duplicate JSON RPC IDs with a complete batch", async () => {
    const values = reply(); values[2].id = 1;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(values)));
    expect((await readModuleTokenMetadata([token])).size).toBe(0);
  });

  it("leaves launch membership independent of a metadata outage and does not query Custom tokens", async () => {
    const fetcher = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetcher);
    expect((await readModuleTokenMetadata([token])).size).toBe(0);
    fetcher.mockClear();
    expect((await readModuleTokenMetadata([{ ...token, sourceKind: undefined }])).size).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe("Foundation token presentation", () => {
  const metadata = { name: "Coin", symbol: "COIN", description: "A coin description", imageURI: MODULE_DEFAULT_TOKEN_IMAGE,
    website: "https://programmable.market/", socialData: stringToHex(JSON.stringify({ v: 1, x: "https://x.com/programmable", gitbook: "https://docs.programmable.market/" })) };
  const metadataHash = keccak256(encodeAbiParameters(foundationMetadataParameters, [metadata]));
  function launch(factoryVersion: "v1" | "v2" | "v3") {
    return { sourceKind: "module-foundation-v1", sourceAddress: token.sourceAddress, sourceReleaseDigest: token.sourceReleaseDigest,
      factoryVersion, launchId: token.poolId, tokenAddress: token.tokenAddress, creator: token.creator, hookAddress: token.hookAddress,
      poolManager: token.poolManager, poolId: token.poolId, quoteAsset: address("9"), feeLedgerAddress: address("8"),
      metadataHash, compositionHash: hash("4"), routerAddress: null, stampHash: null, transactionHash: token.transactionHash,
      blockNumber: token.blockNumber, blockHash: token.blockHash, logIndex: token.logIndex, launchedAt: token.launchedAt,
      name: metadata.name, symbol: metadata.symbol, decimals: 18 } as unknown as RobinhoodModuleLaunch;
  }
  function response(changed = false, currentHash = metadataHash) {
    return [
      { jsonrpc: "2.0", id: 0, result: "0x1237" },
      { jsonrpc: "2.0", id: 1, result: encodeFunctionResult({ abi: foundationTokenAbi, functionName: "metadata", result: [
        metadata.description, metadata.website, changed ? "https://example.com/changed.png" : metadata.imageURI, metadata.socialData,
      ] }) },
      { jsonrpc: "2.0", id: 2, result: encodeFunctionResult({ abi: foundationTokenAbi, functionName: "metadataHash", result: currentHash }) },
    ];
  }

  it.each(["v1", "v2", "v3"] as const)("shows the committed default artwork, website, X and Docs for %s", async version => {
    const fetcher = vi.fn(async () => Response.json(response()));
    vi.stubGlobal("fetch", fetcher);
    const saved = launch(version);
    expect((await readModuleTokenMetadata([saved])).get(saved.tokenAddress)).toEqual({
      imageUrl: MODULE_DEFAULT_TOKEN_IMAGE, description: metadata.description,
      links: [{ label: "Website", url: metadata.website }, { label: "X", url: "https://x.com/programmable" },
        { label: "Docs", url: "https://docs.programmable.market/" }],
    });
    const request = JSON.parse((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string);
    expect(request[2].params[0].data).toBe(encodeFunctionData({ abi: foundationTokenAbi, functionName: "metadataHash" }));
  });

  it("recovers committed presentation when a launch was indexed during a name/symbol read outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([
      ...response(),
      { jsonrpc: "2.0", id: 3, result: encodeFunctionResult({ abi: foundationTokenAbi, functionName: "name", result: metadata.name }) },
      { jsonrpc: "2.0", id: 4, result: encodeFunctionResult({ abi: foundationTokenAbi, functionName: "symbol", result: metadata.symbol }) },
    ])));
    const saved = { ...launch("v3"), name: null, symbol: null };
    expect((await readModuleTokenMetadata([saved])).get(saved.tokenAddress)?.imageUrl).toBe(MODULE_DEFAULT_TOKEN_IMAGE);
  });

  it("rejects changed metadata or a hash that differs from the saved launch", async () => {
    for (const value of [response(true), response(false, hash("9"))]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
      expect((await readModuleTokenMetadata([launch("v3")])).size).toBe(0);
    }
  });
});
