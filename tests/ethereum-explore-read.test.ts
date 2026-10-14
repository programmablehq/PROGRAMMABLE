vi.mock("@/lib/server/confirming-launches", () => ({ readConfirmingEthereumLaunches: vi.fn().mockResolvedValue([]) }));
import { describe, expect, it, vi } from "vitest";
import { canonicalTokenExploreEntryV1 } from "@/lib/explore-entry-v1";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
import { shardRouterTradeEntry } from "./shard-router-trade-fixture";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/market-data/classic-launch-catalog.server", () => ({ readClassicLaunchCatalogV1: vi.fn() }));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readWebsiteRouterCustomIdentitySnapshotV1: vi.fn() }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexMarkets: vi.fn(async () => new Map()) }));
vi.mock("@/lib/server/codex-token-metadata", () => ({ readCodexTokenMetadata: vi.fn(async () => new Map()) }));
import { readConfirmingEthereumLaunches } from "@/lib/server/confirming-launches";
import { readCodexTokenMetadata } from "@/lib/server/codex-token-metadata";
import { readEthereumCustomExploreCatalog, readEthereumUnifiedExploreCatalog, readEthereumLaunches, readEthereumToken, readEthereumTokenPresentation } from "@/lib/server/ethereum-explore";
const hex = (n: number, size: number) => `0x${n.toString(16).padStart(size, "0")}` as `0x${string}`;
function entry(n: number): CanonicalTokenExploreEntry {
  return canonicalTokenExploreEntryV1({ id: `1:${hex(n,40)}`, name: `Coin ${n}`, symbol: `C${n}`, tokenAddress: hex(n,40),
    hookAddress: hex(100,40), poolId: hex(n,64), creatorAddress: hex(101,40), launchTransactionHash: hex(n,64),
    launchBlockNumber: String(n), launchLogIndex: n, launchedAt: "2026-09-08T01:00:00.000Z", tokenDecimals: 18,
    totalSwapFeeBps: 100, launchModel: "classic", liquidityPath: "meme" });
}
const source = (entries: CanonicalTokenExploreEntry[], status: "current" | "last-known-good" = "current") =>
  async () => ({ entries, status, generatedAt: "2026-09-09T02:00:00.000Z" });
const unavailable = async (): Promise<never> => { throw new Error("source unavailable"); };

describe("Ethereum verified Explore adapter", () => {
  it("keeps a fresh receipt's public presentation available without promoting it to a canonical token", async () => {
    const launch = { chainId: 1 as const, confirmation: "confirming" as const, observationExpiresAt: Date.now() + 30_000,
      category: "custom" as const, mode: "custom" as const, tokenAddress: hex(7,40), name: "New coin", symbol: "NEW",
      hookAddress: hex(8,40), launchId: hex(9,64), creator: hex(10,40), transactionHash: hex(11,64), blockHash: hex(12,64),
      blockNumber: "123", poolId: hex(13,64), quoteAsset: hex(0,40), launchedAt: "2026-10-14T20:05:35Z", decimals: 18 };
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([launch]);
    vi.mocked(readCodexTokenMetadata).mockResolvedValueOnce(new Map([[launch.tokenAddress, {
      imageUrl: "https://example.com/new.png", description: "New project", links: [{ label: "X", url: "https://x.com/new" }],
    }]]));
    const result = await readEthereumTokenPresentation(launch.tokenAddress);
    expect(result.token).toBeNull();
    expect(result.status).toBe("partial");
    expect(result.presentation).toMatchObject({ tokenAddress: launch.tokenAddress, name: "New coin", symbol: "NEW",
      imageUrl: "https://example.com/new.png", links: [{ label: "X", url: "https://x.com/new" }] });
    expect(result.presentation).not.toHaveProperty("launchStampProvenance");
    vi.mocked(readConfirmingEthereumLaunches).mockResolvedValueOnce([{ ...launch, observationExpiresAt: Date.now() - 1 }]);
    expect((await readEthereumTokenPresentation(launch.tokenAddress)).presentation).toBeNull();
  });
  it("adds only the selected verified Classic identity to unified discovery", async () => {
    const helixAddress = "0x9C355950bd5634eF2b2935d356075C7c19b2386a";
    const helix: CanonicalTokenExploreEntry = { ...entry(1), tokenAddress: helixAddress };
    const classic = vi.fn(source([helix, entry(2)]));
    const custom = vi.fn(source([customGraphExploreEntry]));
    const catalog = await readEthereumUnifiedExploreCatalog({ classic, custom });
    expect(catalog.status).toBe("ready");
    expect(catalog.entries).toEqual([customGraphExploreEntry, helix]);
    expect(classic).toHaveBeenCalledTimes(1); expect(custom).toHaveBeenCalledTimes(1);
    const absent = await readEthereumUnifiedExploreCatalog({ classic: source([]), custom });
    expect(absent.entries).toEqual([customGraphExploreEntry]);
    const partial = await readEthereumUnifiedExploreCatalog({ classic: unavailable, custom });
    expect(partial).toMatchObject({ status: "partial", entries: [customGraphExploreEntry] });
    const customUnavailable = await readEthereumUnifiedExploreCatalog({ classic, custom: unavailable });
    expect(customUnavailable).toMatchObject({ status: "partial", entries: [helix] });
  });
  it("refreshes public presentation after identity checks without changing the canonical source evidence", async () => {
    const evidence = { source: "canonical-launch-stamp-router" as const, asOfBlock: "26113816", asOfBlockHash: hex(10,64),
      commitment: `sha256:${"ab".repeat(32)}`, generatedAt: "2026-10-03T19:23:00Z" };
    const original = structuredClone(customGraphExploreEntry);
    const custom = async () => ({ entries: [customGraphExploreEntry], status: "current" as const, generatedAt: evidence.generatedAt, evidence });
    const metadata = vi.fn(async (entries: readonly CanonicalTokenExploreEntry[]) => entries.map(entry => ({ ...entry,
      name: "Renamed coin", symbol: "NEW", imageUrl: "https://example.com/coin.png", links: [{ kind: "x" as const, url: "https://x.com/coin" }] })));
    const catalog = await readEthereumCustomExploreCatalog({ custom, metadata });
    expect(catalog.entries[0]?.name).toBe("Renamed coin"); expect(catalog.sourceEvidence).toEqual(evidence);
    expect(metadata).toHaveBeenCalledWith([customGraphExploreEntry], evidence);
    const token = await readEthereumToken(customGraphExploreEntry.tokenAddress, { classic: source([]), custom, metadata });
    expect(token.token?.name).toBe("Renamed coin"); expect(token.token?.imageUrl).toBe("https://example.com/coin.png");
    expect(token.token?.launchStampProvenance).toEqual(original.launchStampProvenance);
    expect(customGraphExploreEntry).toEqual(original);
    metadata.mockClear();
    const canonical = await readEthereumToken(customGraphExploreEntry.tokenAddress,
      { classic: source([]), custom, metadata }, { publicPresentation: false });
    expect(canonical.token).toEqual(original);
    expect(metadata).not.toHaveBeenCalled();
  });
  it("keeps verified launches available when the optional metadata reader fails", async () => {
    const evidence = { source: "canonical-launch-stamp-router" as const, asOfBlock: "26113816", asOfBlockHash: hex(10,64),
      commitment: `sha256:${"ab".repeat(32)}`, generatedAt: "2026-10-03T19:23:00Z" };
    const custom = async () => ({ entries: [customGraphExploreEntry], status: "current" as const, generatedAt: evidence.generatedAt, evidence });
    const metadata = vi.fn(async (): Promise<never> => { throw new Error("optional metadata unavailable"); });
    expect((await readEthereumCustomExploreCatalog({ custom, metadata })).entries).toEqual([customGraphExploreEntry]);
    expect((await readEthereumToken(customGraphExploreEntry.tokenAddress, { classic: source([]), custom, metadata })).token).toEqual(customGraphExploreEntry);
  });
  it("hides SHARD from both discovery feeds without dropping its canonical token record or new launches", async () => {
    const custom = source([shardRouterTradeEntry, customGraphExploreEntry]);
    const catalog = await readEthereumCustomExploreCatalog({ custom });
    expect(catalog.status).toBe("ready");
    expect(catalog.entries.map(item => item.tokenAddress)).toEqual([customGraphExploreEntry.tokenAddress]);
    const page = await readEthereumLaunches(1, "", undefined, 10, { classic: source([]), custom });
    expect(page.items.some(item => item.tokenAddress === shardRouterTradeEntry.tokenAddress)).toBe(false);
    expect(page.items.some(item => item.tokenAddress === customGraphExploreEntry.tokenAddress)).toBe(true);
    const token = await readEthereumToken(shardRouterTradeEntry.tokenAddress, { classic: source([]), custom });
    expect(token.token?.tokenAddress).toBe(shardRouterTradeEntry.tokenAddress);
  });
  it("searches and pages verified launch identities without inventing market values", async () => {
    const entries = Array.from({length:23},(_,i)=>entry(i+1));
    const dependencies = { classic: source(entries), custom: source([]) };
    const result = await readEthereumLaunches(2,"",{sort:"newest",mode:"all"},8,dependencies);
    expect(result.status).toBe("ready");
    expect(result.items.map(item=>item.name)).toEqual(entries.slice(7,15).toReversed().map(e=>e.name));
    expect(result.page).toEqual({number:2,size:8,totalItems:23,totalPages:3,hasMore:true});
    expect(result.presentations.every(item=>item.market===null)).toBe(true);
    const search = await readEthereumLaunches(1,"$C19",{sort:"newest"},8,dependencies);
    expect(search.items.map(item=>item.tokenAddress)).toEqual([entry(19).tokenAddress]);
  });
  it("retains available identities and explicitly reports a missing source", async () => {
    const result = await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)]),custom:unavailable});
    expect(result.status).toBe("partial"); expect(result.items).toHaveLength(1);
    expect(result.sources).toEqual({classic:"current",custom:"unavailable"});
  });
  it("never labels an unavailable or saved source as an empty ready index", async () => {
    const unavailableResult=await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:unavailable,custom:unavailable});
    expect(unavailableResult.status).toBe("unavailable"); expect(unavailableResult.items).toEqual([]);
    const saved=await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)],"last-known-good"),custom:source([])});
    expect(saved.status).toBe("stale"); expect(saved.updatedAt).toBe("2026-09-09T02:00:00.000Z");
  });
  it("rejects cross-source duplicate identities instead of silently selecting a record", async () => {
    await expect(readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)]),custom:source([entry(1)])})).rejects.toThrow("Conflicting Ethereum launch identities");
  });
  it("recovers a verified token after a cold source read fails", async () => {
    const classic = vi.fn().mockRejectedValueOnce(new Error("temporary source timeout"))
      .mockImplementation(source([entry(1)]));
    const result = await readEthereumToken(entry(1).tokenAddress, { classic, custom: source([]) });
    expect(result.status).toBe("ready");
    expect(result.token?.tokenAddress).toBe(entry(1).tokenAddress);
    expect(classic).toHaveBeenCalledTimes(2);
  });
  it("passes verified Custom Graph proof records to React as plain objects without changing their evidence", async () => {
    function nullPrototypeCopy(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(nullPrototypeCopy);
      if (value !== null && typeof value === "object") {
        return Object.assign(Object.create(null), Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, nullPrototypeCopy(child)]),
        ));
      }
      return value;
    }
    function expectClientObjects(value: unknown) {
      if (Array.isArray(value)) value.forEach(expectClientObjects);
      else if (value !== null && typeof value === "object") {
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
        Object.values(value).forEach(expectClientObjects);
      }
    }
    const stamp = nullPrototypeCopy(customGraphExploreEntry.launchStampProvenance) as
      NonNullable<CanonicalTokenExploreEntry["launchStampProvenance"]>;
    const verified = canonicalTokenExploreEntryV1({ ...customGraphExploreEntry, launchStampProvenance: stamp });
    expect(Object.getPrototypeOf(verified.launchStampProvenance)).toBeNull();
    const result = await readEthereumToken(verified.tokenAddress, { classic: source([]), custom: source([verified]) });
    expect(result.status).toBe("ready");
    expect(result.token).toEqual(verified);
    expectClientObjects(result.token);
    expect(canonicalTokenExploreEntryV1(result.token!)).toEqual(verified);
    expect(Object.getPrototypeOf(verified.launchStampProvenance)).toBeNull();
    expect(Object.getPrototypeOf(verified.launchStampProvenance!.components[0])).toBeNull();
  });
  it("bounds recovery and keeps a persistently missing source unavailable", async () => {
    const classic = vi.fn(unavailable);
    const result = await readEthereumToken(entry(1).tokenAddress, { classic, custom: source([]) });
    expect(result.status).toBe("partial");
    expect(result.token).toBeNull();
    expect(classic).toHaveBeenCalledTimes(2);
  });
  it("does not delay an existing identity or retry a complete missing-token result", async () => {
    const classic = vi.fn(source([entry(1)]));
    expect((await readEthereumToken(entry(1).tokenAddress, { classic, custom: unavailable })).token?.tokenAddress).toBe(entry(1).tokenAddress);
    expect(classic).toHaveBeenCalledTimes(1);
    classic.mockClear();
    const missing = await readEthereumToken(entry(2).tokenAddress, { classic, custom: source([]) });
    expect(missing.status).toBe("ready");
    expect(missing.token).toBeNull();
    expect(classic).toHaveBeenCalledTimes(1);
  });
  it("does not recover by selecting between conflicting token identities", async () => {
    const classic = vi.fn(source([entry(1)]));
    const result = await readEthereumToken(entry(1).tokenAddress, { classic, custom: source([entry(1)]) });
    expect(result.status).toBe("unavailable");
    expect(result.token).toBeNull();
    expect(classic).toHaveBeenCalledTimes(1);
  });
  it("restricts Ethereum filters to supported data and rejects ambiguous parameters", () => {
    expect(parseEthereumExploreQuery(new URLSearchParams("mode=classic&sort=oldest&pageSize=10"))?.filters).toEqual({mode:"classic",sort:"oldest"});
    expect(parseEthereumExploreQuery(new URLSearchParams("pageSize=6"))?.pageSize).toBe(6);
    expect(parseEthereumExploreQuery(new URLSearchParams("pageSize=8"))?.pageSize).toBe(8);
    for(const query of ["sort=highest","mode=module","page=0","page=1&page=2","chain=4663","pageSize=5"]) {
      expect(parseEthereumExploreQuery(new URLSearchParams(query))).toBeNull();
    }
  });
});
