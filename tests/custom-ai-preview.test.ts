import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../lib/module-engine/any-quote/readiness.server", () => ({ readAnyQuoteUsdPriceV1: vi.fn() }));
import type { AnyQuoteUsdReferenceV1 } from "../lib/module-engine/any-quote/readiness.server";
import { checkedQuote, createLaunchPreviewGate, prepareLaunchPreview } from "../lib/custom-ai/preview.server";
import { initialBuyRaw, parseCoinSettings, previewMatches } from "../lib/custom-ai/preview";
import type { Draft } from "../lib/custom-ai/types";
import { foundationChainProfile } from "../lib/module-foundation/chains";
import type { QuoteCheck } from "../lib/custom-ai/quote.server";

const now = 1_800_000_000;
const settings = parseCoinSettings({ name: "Example", symbol: "EX", imageURI: "ipfs://example", chainId: 1,
  quote: "0x1000000000000000000000000000000000000001", initialBuy: "0.25" });
const reference = (): AnyQuoteUsdReferenceV1 => ({ chainId: 1, quoteAsset: settings.quote, decimals: 18,
  checkpoint: { number: "100", hash: `0x${"11".repeat(32)}`, timestamp: String(now - 5) },
  price: { usd: { numerator: "2500", denominator: "1" }, source: "chainlink", observedAt: String(now - 10),
    validUntil: String(now + 60), heartbeatSeconds: 120, evidenceHash: `0x${"22".repeat(32)}` } });
const draft: Draft = { source: "fixture", sourceHash: "a".repeat(64), compiled: true, diagnostics: [],
  lifecycle: { status: "passed", scope: "isolated-core-with-synthetic-quotes", bundleHash: "d".repeat(64), cases: 600, scenarios: [], diagnostics: [] },
  validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "b".repeat(64), cases: 416, samples: [], deployments: [] },
  artifact: { compiler: "0.8.26", optimizerRuns: 200, evmVersion: "cancun", abi: [], initCode: "0x00", runtimeTemplate: "0x00", immutableReferences: {} } };
const ethReference = (): AnyQuoteUsdReferenceV1 => ({ ...reference(), quoteAsset: foundationChainProfile(1).wrappedEth.address });
const dependencies = () => ({ compile: vi.fn(async () => draft),
  price: vi.fn(async ({ quoteAsset }: { quoteAsset: string }) => quoteAsset.toLowerCase() === settings.quote.toLowerCase() ? reference() : ethReference()), now: () => now });

describe("Custom AI launch preview", () => {
  it("binds current source, artifact, chain, settings and price without granting launch authority", async () => {
    const deps = dependencies();
    const preview = await prepareLaunchPreview({ source: "fixture", settings, canLaunch: true, validated: true }, undefined, deps);
    expect(deps.compile).toHaveBeenCalledWith("fixture", undefined);
    expect(deps.price).toHaveBeenCalledWith({ quoteAsset: settings.quote }, { chainId: 1, pricePurpose: "module-launch" });
    expect(preview.canLaunch).toBe(false);
    expect(preview.quote.status).toBe("price-checked");
    expect(preview.platformFeeBps).toBe(50);
    expect(preview.maximumTotalFeeBps).toBe(1500);
    expect(preview.supply).toBe("1000000000");
    expect(preview.startFdvUsd).toBe("15000");
    expect(previewMatches(preview, draft.sourceHash, settings, now * 1000)).toBe(true);
    expect(previewMatches(preview, "different", settings, now * 1000)).toBe(false);
    expect(previewMatches(preview, draft.sourceHash, { ...settings, name: "Changed" }, now * 1000)).toBe(false);
    expect(previewMatches(preview, draft.sourceHash, settings, preview.expiresAt * 1000)).toBe(false);
    const revised = await prepareLaunchPreview({ source: "fixture", settings: { ...settings, initialBuy: "1" } }, undefined, deps);
    expect(revised.binding).not.toBe(preview.binding);
    const newArtifact = { ...draft, validation: { ...draft.validation!, artifactHash: "c".repeat(64) } };
    const rebuilt = await prepareLaunchPreview({ source: "fixture", settings }, undefined, { ...deps, compile: async () => newArtifact });
    expect(rebuilt.binding).not.toBe(preview.binding);
  });
  it("enforces 0.01 WETH before running expensive checks on either chain", async () => {
    for (const chainId of [1, 4663] as const) {
      const wethSettings = { ...settings, chainId, quote: foundationChainProfile(chainId).wrappedEth.address };
      for (const initialBuy of ["0", "0.0", "0.009999999999999999"]) {
        const deps = dependencies();
        await expect(prepareLaunchPreview({ source: "fixture", settings: { ...wethSettings, initialBuy } }, undefined, deps)).rejects.toThrow("0.01");
        expect(deps.compile).not.toHaveBeenCalled();
      }
      expect(parseCoinSettings({ ...wethSettings, initialBuy: "0.01" }).initialBuy).toBe("0.01");
    }
  });
  it("converts the minimum using fresh ETH evidence and rounds quote units up", () => {
    const quote = reference(); quote.decimals = 6;
    quote.price.usd = { numerator: "3", denominator: "1" };
    const eth = ethReference(); eth.price.usd = { numerator: "2500", denominator: "1" };
    expect(() => checkedQuote(quote, eth, { ...settings, initialBuy: "8.333333" }, now)).toThrow("8.333334");
    const result = checkedQuote(quote, eth, { ...settings, initialBuy: "8.333334" }, now);
    expect(result.quote.minimumInitialBuyRaw).toBe("8333334");
    expect(result.quote.ethUsdE18).toBe("2500000000000000000000");
    eth.price.validUntil = String(now + 10);
    expect(checkedQuote(quote, eth, { ...settings, initialBuy: "10" }, now).expiresAt).toBe(now + 10);
  });
  it("rejects missing, stale or wrong-chain ETH evidence", async () => {
    for (const kind of ["chain", "token", "stale"] as const) {
      const eth = ethReference();
      if (kind === "chain") eth.chainId = 4663;
      if (kind === "token") eth.quoteAsset = settings.quote;
      if (kind === "stale") eth.price.observedAt = String(now - 121);
      expect(() => checkedQuote(reference(), eth, settings, now)).toThrow();
    }
    const result = await prepareLaunchPreview({ source: "fixture", settings }, undefined, {
      ...dependencies(), price: async ({ quoteAsset }) => {
        if (quoteAsset === settings.quote) return reference();
        throw Error("ETH unavailable");
      },
    });
    expect(result.quote.status).toBe("unavailable");
    expect(result.pending).toContain("quote-price");
  });
  it("reuses the same WETH reference without a duplicate price read", async () => {
    const deps = dependencies();
    const selected = { ...settings, quote: ethReference().quoteAsset, initialBuy: "0.01" };
    const result = await prepareLaunchPreview({ source: "fixture", settings: selected }, undefined, deps);
    expect(deps.price).toHaveBeenCalledTimes(1);
    expect(result.quote).toMatchObject({ status: "price-checked", minimumInitialBuyRaw: "10000000000000000" });
  });
  it("reports a below-minimum custom-pair amount as input error, not a provider outage", async () => {
    await expect(prepareLaunchPreview({ source: "fixture", settings: { ...settings, initialBuy: "0.001" } }, undefined, dependencies())).rejects.toMatchObject({ code: "initial-buy-minimum" });
  });
  it("fails closed on a compiler-only draft or a failed validator", async () => {
    for (const validation of [undefined, { ...draft.validation!, status: "blocked" as const }]) {
      await expect(prepareLaunchPreview({ source: "fixture", settings }, undefined,
        { ...dependencies(), compile: async () => ({ ...draft, validation }) })).rejects.toThrow("must pass its checks");
    }
    await expect(prepareLaunchPreview({ source: "fixture", settings }, undefined,
      { ...dependencies(), compile: async () => ({ ...draft, lifecycle: undefined }) })).rejects.toThrow("must pass its checks");
  });
  it("matches the core's UTF-8 metadata limits and required image", () => {
    expect(parseCoinSettings({ ...settings, name: "é".repeat(24) }).name).toHaveLength(24);
    for (const change of [{ name: "é".repeat(25) }, { name: "x".repeat(49) }, { imageURI: "" },
      { imageURI: "javascript:alert(1)" }, { imageURI: "https://secret@host.test/image.png" }]) {
      expect(() => parseCoinSettings({ ...settings, ...change })).toThrow();
    }
  });
  it("rejects Base Module Mode and malformed quote addresses without running checks", async () => {
    const deps = dependencies();
    for (const change of [{ chainId: 8453 }, { quote: "0x0000000000000000000000000000000000000000" }, { initialBuy: "1e20" }]) {
      await expect(prepareLaunchPreview({ source: "fixture", settings: { ...settings, ...change } }, undefined, deps)).rejects.toThrow();
    }
    expect(deps.compile).not.toHaveBeenCalled();
    expect(deps.price).not.toHaveBeenCalled();
  });
  it("rejects excess decimal precision instead of silently rounding money", () => {
    expect(initialBuyRaw("1.000001", 6)).toBe("1000001");
    expect(initialBuyRaw("0", 0)).toBe("0");
    expect(() => initialBuyRaw("1.0000001", 6)).toThrow("6 decimal places");
    expect(() => initialBuyRaw("1.0", 0)).toThrow("0 decimal places");
    expect(() => initialBuyRaw("999999999999999999999999999999999999999", 18)).toThrow("transaction limit");
  });
  it("uses the verified feed heartbeat without manufacturing a fresh oracle round", () => {
    const value = reference();
    value.price.observedAt = String(now - 900); value.price.heartbeatSeconds = 7200;
    expect(checkedQuote(value, ethReference(), settings, now).quote.status).toBe("price-checked");
    expect(value.price.observedAt).toBe(String(now - 900));
  });
  it.each(["chain", "address", "stale-price", "future-price", "stale-block", "expired", "zero", "zero-denominator"])("rejects %s price evidence", kind => {
    const value = reference();
    if (kind === "chain") value.chainId = 4663;
    if (kind === "address") value.quoteAsset = "0x2000000000000000000000000000000000000002";
    if (kind === "stale-price") value.price.observedAt = String(now - 121);
    if (kind === "future-price") value.price.observedAt = String(now + 1);
    if (kind === "stale-block") value.checkpoint.timestamp = String(now - 61);
    if (kind === "expired") value.price.validUntil = String(now);
    if (kind === "zero") value.price.usd.numerator = "0";
    if (kind === "zero-denominator") value.price.usd.denominator = "0";
    expect(() => checkedQuote(value, ethReference(), settings, now)).toThrow();
  });
  it("keeps a provider outage distinct from incompatible token mechanics, with no private error output", async () => {
    const preview = await prepareLaunchPreview({ source: "fixture", settings }, undefined, {
      ...dependencies(), price: async () => { throw new Error("https://provider.invalid/private-key"); },
    });
    expect(preview.canLaunch).toBe(false);
    expect(preview.quote.status).toBe("unavailable");
    expect(JSON.stringify(preview)).not.toContain("private-key");
    expect(preview.pending).toContain("quote-transfer-and-control-checks");
  });
  it("coalesces identical in-flight checks and releases capacity after errors", async () => {
    const gate = createLaunchPreviewGate();
    let finish!: (result: Awaited<ReturnType<typeof prepareLaunchPreview>>) => void;
    const run = vi.fn(() => new Promise<Awaited<ReturnType<typeof prepareLaunchPreview>>>(resolve => { finish = resolve; }));
    const a = gate({ source: "a" }, run), b = gate({ source: "a" }, run);
    await Promise.resolve();
    const result = await prepareLaunchPreview({ source: "fixture", settings }, undefined, dependencies());
    finish(result); await Promise.all([a, b]);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(gate({ source: "b" }, async () => { throw Error("stop"); })).rejects.toThrow("stop");
    expect(await gate({ source: "b" }, async () => result)).toBe(result);
  });
  it("binds pair checks to the selected chain, address, decimals and freshness", async () => {
    const checked: QuoteCheck = { status: "compatible", chainId: 1, address: settings.quote,
      runtimeHash: `0x${"33".repeat(32)}`, decimals: 18, checkedAt: now - 20,
      blockNumber: "100", blockHash: `0x${"11".repeat(32)}`, controlCheck: "verified-wrapped-native-runtime",
      transferCheck: "passed", evidenceHash: "d".repeat(64) };
    const valid = await prepareLaunchPreview({ source: "fixture", settings }, undefined,
      { ...dependencies(), quote: async () => checked });
    expect(valid.pending).not.toContain("quote-transfer-and-control-checks");
    expect(valid.expiresAt).toBe(now + 40);
    expect(valid.canLaunch).toBe(false);
    for (const changed of [{ chainId: 4663 }, { address: "0x2000000000000000000000000000000000000002" },
      { decimals: 6 }, { checkedAt: now - 60 }, { checkedAt: now + 1 }]) {
      const result = await prepareLaunchPreview({ source: "fixture", settings }, undefined,
        { ...dependencies(), quote: async () => ({ ...checked, ...changed } as QuoteCheck) });
      expect(result.quoteCheck).toBeUndefined();
      expect(result.pending).toContain("quote-transfer-and-control-checks");
    }
  });
});
